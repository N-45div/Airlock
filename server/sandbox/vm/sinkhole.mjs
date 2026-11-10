// Airlock's sinkhole. It runs as root inside the sandbox VM, never on your machine, and plays the
// internet for the repository's code:
//   - DNS: package registries resolve for real; every other name resolves to this VM.
//   - HTTP and HTTPS: whatever the code then sends to "its server" arrives here and is logged, bytes
//     and all. HTTPS works because the VM was told to trust a certificate authority made for this run.
// Nothing reaches the real host. Plain JavaScript with no dependencies: it runs on the VM's own Node.
//   node sinkhole.mjs make-ca <dir>        writes <dir>/ca.key and <dir>/ca.crt
//   node sinkhole.mjs serve <config.json>  { dnsPort, httpPort, httpsPort, upstream, allow, log, caDir, ready }

import { spawnSync } from 'node:child_process';
import dgram from 'node:dgram';
import fs from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import path from 'node:path';
import tls from 'node:tls';
import { fileURLToPath } from 'node:url';

const MAX_BODY = 1024 * 1024;

/** Reads the question of a DNS query; null if it isn't one. */
export function parseQuery(msg) {
  if (msg.length < 17 || msg[2] & 0x80 || msg.readUInt16BE(4) !== 1) return null;
  const labels = [];
  let i = 12;
  while (i < msg.length) {
    const len = msg[i];
    if (len === 0) break;
    if (len > 63 || i + 1 + len > msg.length) return null;
    labels.push(msg.subarray(i + 1, i + 1 + len).toString('latin1'));
    i += 1 + len;
  }
  if (i + 5 > msg.length) return null;
  return { id: msg.readUInt16BE(0), flags: msg.readUInt16BE(2), name: labels.join('.').toLowerCase(), type: msg.readUInt16BE(i + 1), end: i + 5 };
}

/** A DNS query for `name`, for tests and probes. */
export function buildQuery(id, name, type = 1) {
  const parts = name.split('.').map((l) => Buffer.concat([Buffer.from([l.length]), Buffer.from(l, 'latin1')]));
  const header = Buffer.alloc(12);
  header.writeUInt16BE(id, 0);
  header.writeUInt16BE(0x0100, 2);
  header.writeUInt16BE(1, 4);
  const tail = Buffer.alloc(5);
  tail.writeUInt16BE(type, 1);
  tail.writeUInt16BE(1, 3);
  return Buffer.concat([header, ...parts, tail]);
}

/** The answer to a query: an A record pointing at `ip` for A queries, no records otherwise. */
export function sinkAnswer(msg, q, ip = '127.0.0.1') {
  const isA = q.type === 1;
  const header = Buffer.alloc(12);
  header.writeUInt16BE(q.id, 0);
  header.writeUInt16BE(0x8000 | (q.flags & 0x7900) | 0x0400 | 0x0080, 2);
  header.writeUInt16BE(1, 4);
  header.writeUInt16BE(isA ? 1 : 0, 6);
  const question = msg.subarray(12, q.end);
  if (!isA) return Buffer.concat([header, question]);
  const answer = Buffer.alloc(16);
  answer.writeUInt16BE(0xc00c, 0);
  answer.writeUInt16BE(1, 2);
  answer.writeUInt16BE(1, 4);
  answer.writeUInt32BE(5, 6);
  answer.writeUInt16BE(4, 10);
  ip.split('.').forEach((o, k) => answer.writeUInt8(Number(o), 12 + k));
  return Buffer.concat([header, question, answer]);
}

export function isAllowed(name, allow) {
  return allow.some((a) => name === a || name.endsWith(`.${a}`));
}

function run(cmd, args) {
  const r = spawnSync(cmd, args, { stdio: ['ignore', 'ignore', 'pipe'] });
  if (r.error || r.status !== 0) throw new Error(`${cmd} ${args[0]} failed: ${r.error?.message ?? r.stderr?.toString().slice(-200)}`);
}

/** A certificate authority for this run only. */
export function makeCa(dir) {
  fs.mkdirSync(dir, { recursive: true });
  run('openssl', [
    'req', '-x509', '-newkey', 'ec', '-pkeyopt', 'ec_paramgen_curve:prime256v1', '-nodes',
    '-keyout', path.join(dir, 'ca.key'), '-out', path.join(dir, 'ca.crt'), '-days', '2', '-subj', '/CN=Corporate Root CA',
    '-addext', 'basicConstraints=critical,CA:TRUE', '-addext', 'keyUsage=critical,keyCertSign,cRLSign',
  ]);
}

/** Signs a certificate for one host name with the run's authority. */
function hostContext(name, caDir, cache) {
  const host = /^[a-z0-9.-]{1,253}$/.test(name) ? name : 'localhost';
  if (cache.has(host)) return cache.get(host);
  const base = path.join(caDir, 'hosts', host);
  fs.mkdirSync(path.dirname(base), { recursive: true });
  run('openssl', ['req', '-new', '-newkey', 'ec', '-pkeyopt', 'ec_paramgen_curve:prime256v1', '-nodes', '-keyout', `${base}.key`, '-out', `${base}.csr`, '-subj', `/CN=${host}`]);
  fs.writeFileSync(`${base}.ext`, `subjectAltName=DNS:${host}\nbasicConstraints=CA:FALSE\nkeyUsage=digitalSignature\nextendedKeyUsage=serverAuth\n`);
  run('openssl', ['x509', '-req', '-in', `${base}.csr`, '-CA', path.join(caDir, 'ca.crt'), '-CAkey', path.join(caDir, 'ca.key'), '-CAcreateserial', '-out', `${base}.crt`, '-days', '2', '-sha256', '-extfile', `${base}.ext`]);
  const ctx = tls.createSecureContext({ key: fs.readFileSync(`${base}.key`), cert: fs.readFileSync(`${base}.crt`) });
  cache.set(host, ctx);
  return ctx;
}

/** Starts the sinkhole. Resolves with the ports it listens on and a close function. */
export async function startSinkhole(cfg) {
  const log = (entry) => fs.appendFileSync(cfg.log, `${JSON.stringify({ at: Date.now(), ...entry })}\n`);
  const allow = (cfg.allow ?? []).map((a) => a.toLowerCase());
  const closers = [];

  const dns = dgram.createSocket('udp4');
  dns.on('message', (msg, rinfo) => {
    const q = parseQuery(msg);
    if (!q) return;
    const allowed = isAllowed(q.name, allow);
    log({ t: 'dns', name: q.name, type: q.type, allowed });
    if (!allowed || !cfg.upstream) {
      dns.send(sinkAnswer(msg, q), rinfo.port, rinfo.address);
      return;
    }
    const up = dgram.createSocket('udp4');
    const timer = setTimeout(() => up.close(), 3000);
    up.on('message', (reply) => {
      clearTimeout(timer);
      dns.send(reply, rinfo.port, rinfo.address);
      up.close();
    });
    up.on('error', () => {});
    up.send(msg, cfg.upstreamPort ?? 53, cfg.upstream);
  });
  await new Promise((resolve) => dns.bind(cfg.dnsPort ?? 53, cfg.host ?? '127.0.0.1', resolve));
  closers.push(() => dns.close());

  const capture = (secure) => (req, res) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size <= MAX_BODY) chunks.push(c);
    });
    req.on('end', () => {
      log({
        t: 'http',
        tls: secure,
        host: String(req.headers.host ?? req.socket.servername ?? '').toLowerCase().replace(/:\d+$/, ''),
        method: req.method,
        path: req.url,
        bytes: size,
        contentType: req.headers['content-type'] ?? null,
        userAgent: req.headers['user-agent'] ?? null,
        body: Buffer.concat(chunks).toString('base64'),
      });
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end('{}');
    });
    req.on('error', () => {});
  };

  const httpServer = http.createServer(capture(false));
  await new Promise((resolve) => httpServer.listen(cfg.httpPort ?? 80, cfg.host ?? '127.0.0.1', resolve));
  closers.push(() => httpServer.close());

  let httpsServer;
  if (cfg.caDir) {
    const cache = new Map();
    const fallback = hostContext('localhost', cfg.caDir, cache);
    httpsServer = https.createServer(
      {
        SNICallback: (name, cb) => {
          try {
            cb(null, hostContext(String(name).toLowerCase(), cfg.caDir, cache));
          } catch (error) {
            cb(error);
          }
        },
        secureContext: fallback,
      },
      capture(true),
    );
    // A client that checks its server's certificate more strictly refuses ours: still worth saying.
    httpsServer.on('tlsClientError', (error, socket) => log({ t: 'tls-refused', host: socket.servername ?? null, error: String(error.code ?? error.message).slice(0, 80) }));
    await new Promise((resolve) => httpsServer.listen(cfg.httpsPort ?? 443, cfg.host ?? '127.0.0.1', resolve));
    closers.push(() => httpsServer.close());
  }

  return {
    ports: { dns: dns.address().port, http: httpServer.address().port, https: httpsServer?.address().port },
    close: () => closers.forEach((c) => c()),
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [cmd, arg] = process.argv.slice(2);
  if (cmd === 'make-ca') makeCa(arg);
  else if (cmd === 'serve') {
    const cfg = JSON.parse(fs.readFileSync(arg, 'utf8'));
    const s = await startSinkhole(cfg);
    if (cfg.ready) fs.writeFileSync(cfg.ready, JSON.stringify(s.ports));
  } else {
    console.error('usage: node sinkhole.mjs make-ca <dir> | serve <config.json>');
    process.exit(2);
  }
}
