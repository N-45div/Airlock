// What the sandbox runs: the steps a person runs, or that run by themselves, when they take a
// stranger's repository home. Installing it, opening it in an editor that runs tasks, and the setup
// script its README points at. Each step is a shell command run from the repository's folder.

export interface Step {
  /** "npm install" */
  label: string;
  command: string;
  /** Why this step, in plain words, for the report. */
  why: string;
}

/** Reads a file in the repository by relative path; null when it doesn't exist. */
export type ReadText = (rel: string) => Promise<string | null>;

const SETUP_SCRIPTS = ['setup.sh', 'install.sh', 'bootstrap.sh', 'scripts/setup.sh', 'scripts/install.sh', 'scripts/bootstrap.sh'];

/** JSON with // and /* comments and trailing commas, as VS Code writes it. */
export function parseJsonc(text: string): unknown {
  let out = '';
  for (let i = 0, inString = false; i < text.length; i++) {
    const c = text[i]!;
    if (inString) {
      out += c;
      if (c === '\\') out += text[++i] ?? '';
      else if (c === '"') inString = false;
    } else if (c === '"') {
      inString = true;
      out += c;
    } else if (c === '/' && text[i + 1] === '/') {
      while (i < text.length && text[i] !== '\n') i++;
      out += '\n';
    } else if (c === '/' && text[i + 1] === '*') {
      i = text.indexOf('*/', i + 2);
      if (i < 0) break;
      i++;
    } else out += c;
  }
  return JSON.parse(out.replace(/,(\s*[}\]])/g, '$1'));
}

const quote = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;

/** A devcontainer lifecycle command (string, array, or object of either) as shell commands. */
function lifecycle(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.every((v) => typeof v === 'string') ? [value.map(quote).join(' ')] : [];
  if (value && typeof value === 'object') return Object.values(value).flatMap(lifecycle);
  return [];
}

/** The steps to run for a repository, most telling first, at most `max`. */
export async function planSteps(read: ReadText, max = 6): Promise<Step[]> {
  const steps: Step[] = [];

  const pkg = await read('package.json');
  if (pkg !== null) {
    steps.push({
      label: 'npm install',
      command: 'npm install --foreground-scripts --no-audit --no-fund --loglevel=error',
      why: 'Installing runs the install scripts of the project and of every package it depends on.',
    });
  }

  if ((await read('setup.py')) !== null) {
    steps.push({ label: 'python setup.py', command: 'python3 setup.py --name', why: 'Installing a Python package runs its setup.py.' });
  }

  const tasks = await read('.vscode/tasks.json');
  if (tasks !== null) {
    try {
      const parsed = parseJsonc(tasks) as { tasks?: { label?: string; command?: string; args?: unknown[]; runOptions?: { runOn?: string } }[] };
      for (const t of parsed.tasks ?? []) {
        if (t.runOptions?.runOn !== 'folderOpen' || typeof t.command !== 'string') continue;
        const args = (t.args ?? []).filter((a): a is string => typeof a === 'string').map(quote);
        steps.push({
          label: `VS Code task${t.label ? ` "${t.label}"` : ''}`,
          command: [t.command, ...args].join(' '),
          why: 'VS Code runs this task by itself when the folder is opened.',
        });
      }
    } catch {
      // An unreadable tasks file runs nothing in VS Code either.
    }
  }

  for (const file of ['.devcontainer/devcontainer.json', '.devcontainer.json']) {
    const text = await read(file);
    if (text === null) continue;
    try {
      const dc = parseJsonc(text) as Record<string, unknown>;
      for (const key of ['onCreateCommand', 'postCreateCommand', 'postStartCommand']) {
        for (const command of lifecycle(dc[key])) {
          steps.push({ label: `dev container ${key}`, command, why: 'A dev container runs this by itself when it is created or started.' });
        }
      }
    } catch {
      // Same as above.
    }
    break;
  }

  for (const file of SETUP_SCRIPTS) {
    if ((await read(file)) === null) continue;
    steps.push({ label: `bash ${file}`, command: `bash ${file}`, why: 'A setup script people are told to run after cloning.' });
  }

  return steps.slice(0, max);
}
