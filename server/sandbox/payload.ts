// Says which decoy wallets and keys are inside bytes the sandbox caught on their way out. Stealers
// rarely send a key as it sits on disk: they wrap it in JSON, base64 it, gzip it, hex it, URL-encode
// it, or send a Solana keypair as its byte array. This peels those layers, a few levels deep, and
// looks for each decoy's token in every layer. Encryption it can't see through; the report then
// still shows what was sent, where, and right after which decoys were opened.

import { gunzipSync, inflateSync } from 'node:zlib';

const MAX_LAYERS = 4;
const MAX_CANDIDATES = 400;
const MAX_BYTES = 2 * 1024 * 1024;

const BASE64_RUN = /[A-Za-z0-9+/_-]{24,}={0,2}/g;
const HEX_RUN = /(?:[0-9a-fA-F]{2}){20,}/g;
const BYTE_ARRAY = /\[\s*(?:\d{1,3}\s*,\s*){15,}\d{1,3}\s*\]/g;

function decodeBase64(s: string): Buffer | null {
  const norm = s.replace(/-/g, '+').replace(/_/g, '/');
  if (norm.length % 4 === 1) return null;
  const out = Buffer.from(norm, 'base64');
  // Base64 of text decodes to mostly printable bytes; random runs of letters don't.
  return out.length >= 12 ? out : null;
}

function unzip(b: Buffer): Buffer | null {
  try {
    if (b[0] === 0x1f && b[1] === 0x8b) return gunzipSync(b);
    if (b[0] === 0x78 && [0x01, 0x5e, 0x9c, 0xda].includes(b[1]!)) return inflateSync(b);
  } catch {
    // Not compressed after all.
  }
  return null;
}

/** Every layer worth searching: the bytes themselves, then whatever decodes out of them. */
export function layers(body: Buffer): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  const queue: { bytes: Buffer; depth: number }[] = [{ bytes: body.subarray(0, MAX_BYTES), depth: 0 }];
  while (queue.length && out.length < MAX_CANDIDATES) {
    const { bytes, depth } = queue.shift()!;
    const text = bytes.toString('latin1');
    if (seen.has(text)) continue;
    seen.add(text);
    out.push(text);
    if (depth >= MAX_LAYERS) continue;
    const push = (b: Buffer | null) => {
      if (b && b.length) queue.push({ bytes: b, depth: depth + 1 });
    };
    push(unzip(bytes));
    if (/%[0-9a-fA-F]{2}/.test(text)) {
      try {
        push(Buffer.from(decodeURIComponent(text.replace(/\+/g, ' ')), 'utf8'));
      } catch {
        // Not URL-encoded text.
      }
    }
    for (const m of text.match(BASE64_RUN) ?? []) push(decodeBase64(m));
    for (const m of text.match(HEX_RUN) ?? []) push(Buffer.from(m, 'hex'));
    for (const m of text.match(BYTE_ARRAY) ?? []) {
      const nums = m.slice(1, -1).split(',').map((n) => Number(n.trim()));
      if (nums.every((n) => n >= 0 && n <= 255)) push(Buffer.from(nums));
    }
  }
  return out;
}

/** The labels of the decoys whose tokens are inside these bytes, in decoy order, each once. */
export function decoysIn(body: Buffer, tokens: { label: string; token: string }[]): string[] {
  const texts = layers(body);
  const found: string[] = [];
  for (const { label, token } of tokens) {
    if (found.includes(label)) continue;
    if (texts.some((t) => t.includes(token))) found.push(label);
  }
  return found;
}
