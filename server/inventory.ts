// A plain inventory of what in a repository would run on its own: on install,
// when the folder is opened in an editor, or as a shipped program. These are
// facts read from files, not guesses; the reviewing agent decides what they mean.

import { open, readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import type { Finding } from './types.ts';

export interface Inventory {
  /** Relative paths with sizes, largest last, for the agent's map. */
  files: { path: string; bytes: number }[];
  /** Commands that run without anyone typing them. */
  autoRuns: { file: string; trigger: string; command: string }[];
  findings: Finding[];
}

const SKIP_DIRS = new Set(['.git', 'node_modules']);
/** npm runs these for a project installed from git or a folder. */
const NPM_INSTALL_HOOKS = ['preinstall', 'install', 'postinstall', 'prepare'];
const CODE_EXT = new Set(['.js', '.cjs', '.mjs', '.ts', '.jsx', '.tsx', '.py', '.sh', '.ps1', '.bat', '.cmd']);
const LONG_LINE = 3000;

const MAGIC: [string, Buffer][] = [
  ['a Linux program', Buffer.from([0x7f, 0x45, 0x4c, 0x46])],
  ['a Windows program', Buffer.from('MZ')],
  ['a macOS program', Buffer.from([0xcf, 0xfa, 0xed, 0xfe])],
  ['a macOS program', Buffer.from([0xca, 0xfe, 0xba, 0xbe])],
];

export async function takeInventory(root: string): Promise<Inventory> {
  const files: Inventory['files'] = [];
  const walk = async (dir: string): Promise<void> => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name)) await walk(path.join(dir, entry.name));
      } else if (entry.isFile()) {
        const full = path.join(dir, entry.name);
        files.push({ path: path.relative(root, full).split(path.sep).join('/'), bytes: (await stat(full)).size });
      }
    }
  };
  await walk(root);
  files.sort((a, b) => a.path.localeCompare(b.path));

  const inv: Inventory = { files, autoRuns: [], findings: [] };
  let n = 0;
  const add = (f: Omit<Finding, 'id' | 'source'>) => inv.findings.push({ ...f, id: `s${++n}`, source: 'static' });

  for (const file of files) {
    const base = path.posix.basename(file.path);
    const full = path.join(root, file.path);

    if (base === 'package.json') {
      const pkg = await readJson(full);
      const scripts = (pkg?.scripts ?? {}) as Record<string, unknown>;
      for (const hook of NPM_INSTALL_HOOKS) {
        const command = scripts[hook];
        if (typeof command !== 'string') continue;
        inv.autoRuns.push({ file: file.path, trigger: `npm install (${hook})`, command });
        add({
          severity: 'medium',
          category: 'runs-on-install',
          title: `Runs a command when you install it (${hook})`,
          detail: `npm runs "${command}" as soon as you install this project. Read what it does before installing.`,
          file: file.path,
          snippet: `"${hook}": ${JSON.stringify(command)}`,
        });
      }
    }

    if (base === 'setup.py') {
      inv.autoRuns.push({ file: file.path, trigger: 'pip install', command: `python ${file.path}` });
      add({
        severity: 'low',
        category: 'runs-on-install',
        title: 'Runs Python code when you install it (setup.py)',
        detail: 'Installing this with pip runs setup.py on your computer. That is normal for older Python projects, but the file can do anything.',
        file: file.path,
      });
    }

    if (file.path.endsWith('.vscode/tasks.json')) {
      const text = await readText(full);
      // tasks.json allows comments, so look for the setting rather than parse it.
      if (/"runOn"\s*:\s*"folderOpen"/.test(text)) {
        inv.autoRuns.push({ file: file.path, trigger: 'opening the folder in VS Code', command: 'see tasks.json' });
        add({
          severity: 'high',
          category: 'runs-on-open',
          title: 'Starts a task the moment you open the folder in VS Code',
          detail: 'This editor task is set to run on folder open. Opening the project in VS Code (after trusting it) runs it, before you read any code.',
          file: file.path,
          snippet: lineWith(text, /"runOn"/),
        });
      }
    }

    if (file.path.endsWith('.devcontainer/devcontainer.json') || file.path === '.devcontainer.json') {
      const text = await readText(full);
      const match = text.match(/"(postCreateCommand|postStartCommand|postAttachCommand|initializeCommand|onCreateCommand)"/);
      if (match) {
        inv.autoRuns.push({ file: file.path, trigger: `opening in a dev container (${match[1]})`, command: 'see devcontainer.json' });
        add({
          severity: match[1] === 'initializeCommand' ? 'high' : 'low',
          category: 'runs-on-open',
          title: `Runs a command when opened in a dev container (${match[1]})`,
          detail:
            match[1] === 'initializeCommand'
              ? 'initializeCommand runs on your own computer, not inside the container, when the dev container starts.'
              : 'This runs inside the dev container when it starts.',
          file: file.path,
          snippet: lineWith(text, new RegExp(`"${match[1]}"`)),
        });
      }
    }

    if (file.bytes >= 4) {
      const head = await readHead(full, 4);
      const kind = MAGIC.find(([, magic]) => head.subarray(0, magic.length).equals(magic))?.[0];
      if (kind) {
        add({
          severity: 'medium',
          category: 'binary',
          title: `Ships ${kind}`,
          detail: `${file.path} is a compiled program, so nobody can read what it does from the source.`,
          file: file.path,
        });
      }
    }

    const ext = path.posix.extname(base);
    if (CODE_EXT.has(ext) && !/\.min\.|(^|\/)(dist|build|vendor)\//.test(file.path) && file.bytes > LONG_LINE) {
      const text = await readText(full);
      const lines = text.split('\n');
      const longest = lines.reduce((i, line, j) => (line.length > (lines[i]?.length ?? 0) ? j : i), 0);
      const length = lines[longest]?.length ?? 0;
      if (length > LONG_LINE) {
        add({
          severity: 'medium',
          category: 'obfuscation',
          title: 'Hides code on one very long line',
          detail: `Line ${longest + 1} of ${file.path} is ${length.toLocaleString('en')} characters long. Source written by people rarely looks like that; packed code often does.`,
          file: file.path,
          line: longest + 1,
          snippet: `${lines[longest]!.slice(0, 160)}…`,
        });
      }
    }
  }
  inv.findings = groupCrowds(inv.findings);
  return inv;
}

/** Folders holding this many packed files or programs are reported once. */
const CROWD = 4;

/** A built web app can hold hundreds of packed files; one finding per folder
 * says the same thing without burying everything else. A lone packed file in
 * source code still stands out on its own. */
function groupCrowds(findings: Finding[]): Finding[] {
  const groups = new Map<string, Finding[]>();
  for (const f of findings) {
    if ((f.category !== 'obfuscation' && f.category !== 'binary') || !f.file) continue;
    const key = `${f.category}:${path.posix.dirname(f.file)}`;
    groups.set(key, [...(groups.get(key) ?? []), f]);
  }
  const crowded = new Set([...groups.values()].filter((g) => g.length >= CROWD).flat());
  const out = findings.filter((f) => !crowded.has(f));
  for (const group of groups.values()) {
    if (group.length < CROWD) continue;
    const first = group[0]!;
    const dir = path.posix.dirname(first.file!);
    const examples = group.slice(0, 3).map((f) => path.posix.basename(f.file!)).join(', ');
    out.push(
      first.category === 'obfuscation'
        ? {
            id: first.id,
            source: 'static',
            severity: 'low',
            category: 'obfuscation',
            title: `${group.length} packed files in ${dir}`,
            detail: `Files such as ${examples} are packed onto very long lines. A folder like this is usually a built web app, which can't be read line by line; check that nothing outside it loads these files.`,
            file: first.file!,
          }
        : {
            id: first.id,
            source: 'static',
            severity: 'medium',
            category: 'binary',
            title: `${group.length} compiled programs in ${dir}`,
            detail: `Files such as ${examples} are compiled, so nobody can read what they do from the source.`,
            file: first.file!,
          },
    );
  }
  return out;
}

async function readText(file: string): Promise<string> {
  try {
    return await readFile(file, 'utf8');
  } catch {
    return '';
  }
}

async function readJson(file: string): Promise<Record<string, unknown> | null> {
  try {
    return JSON.parse(await readText(file)) as Record<string, unknown>;
  } catch {
    return null;
  }
}

async function readHead(file: string, bytes: number): Promise<Buffer> {
  const handle = await open(file, 'r');
  try {
    const buf = Buffer.alloc(bytes);
    await handle.read(buf, 0, bytes, 0);
    return buf;
  } finally {
    await handle.close();
  }
}

function lineWith(text: string, pattern: RegExp): string | undefined {
  return text.split('\n').find((line) => pattern.test(line))?.trim().slice(0, 200);
}
