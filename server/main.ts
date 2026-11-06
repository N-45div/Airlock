import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { serve } from '@hono/node-server';
import { createApp } from './app.ts';
import { nearReviewer } from './near-engine.ts';
import { review } from './review.ts';
import { Scanner } from './scans.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.resolve(process.env.AIRLOCK_DATA ?? path.join(here, '..', 'data'));
const webDir = path.resolve(process.env.AIRLOCK_WEB ?? path.join(here, '..', 'web', 'dist'));
const port = Number(process.env.PORT ?? 8787);
const host = process.env.HOST ?? '127.0.0.1';

// The NEAR AI Cloud engine when a key is set (AIRLOCK_ENGINE=claude keeps the Claude review).
const engine = process.env.AIRLOCK_ENGINE ?? (process.env.NEARAI_API_KEY ? 'near' : 'claude');
const reviewer =
  engine === 'near'
    ? nearReviewer({
        apiKey: process.env.NEARAI_API_KEY ?? '',
        receiptsDir: path.join(dataDir, 'receipts'),
        ...(process.env.AIRLOCK_NEAR_MODEL ? { model: process.env.AIRLOCK_NEAR_MODEL } : {}),
        ...(process.env.AIRLOCK_NEAR_MAX_USD ? { maxUsd: Number(process.env.AIRLOCK_NEAR_MAX_USD) } : {}),
        tlsPinning: process.env.AIRLOCK_NEAR_TLS_PINNING !== '0',
        record: !!process.env.NEAR_KEY_FILE || !!process.env.NEAR_PRIVATE_KEY,
      })
    : review;
const scanner = new Scanner(dataDir, reviewer);
await scanner.load();
serve({ fetch: createApp(scanner, webDir).fetch, port, hostname: host }, () => {
  console.log(`Airlock on http://${host}:${port}`);
  if (engine === 'near') {
    console.log('Reviews run on NEAR AI Cloud (TEE, every reply signed); receipts at /api/receipts/:hash.');
    if (!process.env.NEARAI_API_KEY) console.log('NEARAI_API_KEY is not set: reviews will fail.');
    if (!process.env.NEAR_KEY_FILE && !process.env.NEAR_PRIVATE_KEY) console.log('No recorder key (NEAR_KEY_FILE): verdicts are not recorded on NEAR.');
  } else {
    if (!process.env.ANTHROPIC_API_KEY) console.log('ANTHROPIC_API_KEY is not set: reviews will fail.');
    if (!process.env.ARMORCLAUDE_DIR) console.log('ARMORCLAUDE_DIR is not set: reviewing WITHOUT ArmorIQ (backstop only).');
  }
});
