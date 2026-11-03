// The only tools the private reviewer gets: list, read and search files inside the
// repository. There is no tool that runs code, writes files or reaches the network, so
// nothing the repository says can make the reviewer do those things. Every path is
// resolved and checked to stay inside the repository root (the same rule as Airlock's
// backstop), including through symlinks.

import { open, readdir, realpath, stat } from 'node:fs/promises';
import path from 'node:path';

export const LIMITS = {
  readLines: 400,
  readBytes: 64 * 1024,
  grepMatches: 120,
  grepFileBytes: 2 * 1024 * 1024,
  listEntries: 500,
};

const SKIP_DIRS = new Set(['.git', 'node_modules']);

/** OpenAI-style function definitions sent to the model. */
export const TOOL_DEFINITIONS = [
  {
    type: 'function' as const,
    function: {
      name: 'list_files',
      description: 'List files under a folder of the repository (recursive). Use a glob-like suffix filter such as ".js" or "package.json" to narrow it.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          path: { type: 'string', description: 'Folder relative to the repository root. Default: the root.' },
          filter: { type: 'string', description: 'Only paths that end with this text, e.g. ".sh".' },
        },
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'read_file',
      description: `Read a file of the repository with line numbers. Returns at most ${LIMITS.readLines} lines per call; use start_line to read further.`,
      parameters: {
        type: 'object',
        additionalProperties: false,
        required: ['path'],
        properties: {
          path: { type: 'string', description: 'File path relative to the repository root.' },
          start_line: { type: 'integer', minimum: 1, description: 'First line to return (1-based). Default 1.' },
        },
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'grep',
      description: 'Search file contents with a JavaScript regular expression (case-insensitive). Returns matching lines with file and line number.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        required: ['pattern'],
        properties: {
          pattern: { type: 'string', description: 'Regular expression, e.g. "child_process|exec\\\\(".' },
          path: { type: 'string', description: 'Folder or file to search, relative to the root. Default: the whole repository.' },
        },
      },
    },
  },
];

export type ToolName = 'list_files' | 'read_file' | 'grep';

export class ToolError extends Error {}

export class RepoTools {
  readonly root: string;
  #realRoot: Promise<string>;

  constructor(root: string) {
    this.root = path.resolve(root);
    this.#realRoot = realpath(this.root);
  }

  /** Runs one tool call. Errors come back as text the model can read, never as a throw. */
  async call(name: string, rawArgs: string | Record<string, unknown>): Promise<string> {
    let args: Record<string, unknown>;
    try {
      args = typeof rawArgs === 'string' ? (rawArgs.trim() ? (JSON.parse(rawArgs) as Record<string, unknown>) : {}) : rawArgs;
      if (!args || typeof args !== 'object' || Array.isArray(args)) throw new ToolError('arguments must be a JSON object');
    } catch (error) {
      return `Error: could not read the arguments (${(error as Error).message}).`;
    }
    try {
      switch (name) {
        case 'list_files': return await this.listFiles(optionalString(args.path) ?? '.', optionalString(args.filter));
        case 'read_file': return await this.readFile(requiredString(args.path, 'path'), optionalInt(args.start_line) ?? 1);
        case 'grep': return await this.grep(requiredString(args.pattern, 'pattern'), optionalString(args.path) ?? '.');
        default: return `Error: there is no tool called "${name}". The tools are list_files, read_file and grep.`;
      }
    } catch (error) {
      if (error instanceof ToolError) return `Error: ${error.message}`;
      const code = (error as NodeJS.ErrnoException).code;
      if (code === 'ENOENT') return 'Error: no such file or folder in the repository.';
      if (code === 'EISDIR') return 'Error: that is a folder; use list_files.';
      if (code === 'ENOTDIR') return 'Error: that is a file; use read_file.';
      return `Error: ${(error as Error).message}`;
    }
  }

  /** Resolves a repository-relative path, refusing anything that lands outside the root. */
  async resolve(relative: string): Promise<string> {
    const realRoot = await this.#realRoot;
    const target = path.resolve(this.root, relative.replace(/^\/+/, ''));
    let real = target;
    try {
      real = await realpath(target);
    } catch {
      // Missing paths are reported by the caller; judge them as written.
    }
    const rel = path.relative(realRoot, real);
    if (rel.startsWith('..') || path.isAbsolute(rel)) throw new ToolError('that path is outside the repository.');
    return real;
  }

  /** The repository-relative form of an absolute path, with forward slashes. */
  relative(full: string): string {
    return path.relative(this.root, full).split(path.sep).join('/') || '.';
  }

  async listFiles(folder: string, filter?: string): Promise<string> {
    const start = await this.resolve(folder);
    const out: string[] = [];
    let more = 0;
    for await (const file of this.walk(start)) {
      const rel = this.relative(file);
      if (filter && !rel.endsWith(filter)) continue;
      if (out.length >= LIMITS.listEntries) {
        more += 1;
        continue;
      }
      out.push(`${rel} ${(await stat(file)).size}`);
    }
    if (out.length === 0) return 'No files.';
    return `${out.join('\n')}${more ? `\n... and ${more} more; narrow it with path or filter.` : ''}`;
  }

  async readFile(file: string, startLine: number): Promise<string> {
    const full = await this.resolve(file);
    const info = await stat(full);
    if (info.isDirectory()) throw new ToolError('that is a folder; use list_files.');
    const head = await readHead(full, Math.min(info.size, 8 * 1024 * 1024));
    if (looksBinary(head)) return `${this.relative(full)} is a binary file (${info.size} bytes); it can't be shown as text.`;
    const lines = head.toString('utf8').split('\n');
    const first = Math.max(1, startLine);
    const shown: string[] = [];
    let bytes = 0;
    let last = first - 1;
    for (let i = first - 1; i < lines.length && shown.length < LIMITS.readLines; i++) {
      const text = lines[i] ?? '';
      const line = `${String(i + 1).padStart(5)}  ${text.length > 2000 ? `${text.slice(0, 2000)}… [line cut at 2000 characters]` : text}`;
      if (bytes + line.length > LIMITS.readBytes && shown.length > 0) break;
      shown.push(line);
      bytes += line.length + 1;
      last = i + 1;
    }
    if (shown.length === 0) return `${this.relative(full)} has ${lines.length} lines; start_line ${first} is past the end.`;
    const rest = lines.length - last;
    return `${this.relative(full)} (lines ${first}-${last} of ${lines.length})\n${shown.join('\n')}${rest > 0 ? `\n[${rest} more lines; call read_file with start_line ${last + 1}]` : ''}`;
  }

  async grep(pattern: string, where: string): Promise<string> {
    let regex: RegExp;
    try {
      regex = new RegExp(pattern, 'i');
    } catch (error) {
      throw new ToolError(`that is not a valid regular expression (${(error as Error).message}).`);
    }
    const start = await this.resolve(where);
    const hits: string[] = [];
    const files = (await stat(start)).isDirectory() ? this.walk(start) : single(start);
    for await (const file of files) {
      const info = await stat(file);
      if (info.size > LIMITS.grepFileBytes) continue;
      const buf = await readHead(file, info.size);
      if (looksBinary(buf)) continue;
      const lines = buf.toString('utf8').split('\n');
      for (let i = 0; i < lines.length; i++) {
        const text = lines[i] ?? '';
        if (!regex.test(text)) continue;
        hits.push(`${this.relative(file)}:${i + 1}: ${text.trim().slice(0, 300)}`);
        if (hits.length >= LIMITS.grepMatches) return `${hits.join('\n')}\n[stopped at ${LIMITS.grepMatches} matches; narrow the pattern or path]`;
      }
    }
    return hits.length ? hits.join('\n') : 'No matches.';
  }

  async *walk(dir: string): AsyncGenerator<string> {
    const entries = await readdir(dir, { withFileTypes: true });
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      // Symlinks are never followed: a planted link could point outside the repository.
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name)) yield* this.walk(full);
      } else if (entry.isFile()) {
        yield full;
      }
    }
  }
}

async function* single(file: string): AsyncGenerator<string> {
  yield file;
}

async function readHead(file: string, bytes: number): Promise<Buffer> {
  const handle = await open(file, 'r');
  try {
    const buf = Buffer.alloc(bytes);
    const { bytesRead } = await handle.read(buf, 0, bytes, 0);
    return buf.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
}

function looksBinary(buf: Buffer): boolean {
  const sample = buf.subarray(0, 8000);
  return sample.includes(0);
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new ToolError(`"${field}" is required.`);
  return value;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined;
}

function optionalInt(value: unknown): number | undefined {
  const n = typeof value === 'string' ? Number(value) : value;
  return typeof n === 'number' && Number.isInteger(n) && n > 0 ? n : undefined;
}
