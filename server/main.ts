import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { serve } from '@hono/node-server';
import { createApp } from './app.ts';
import { Scanner } from './scans.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.resolve(process.env.AIRLOCK_DATA ?? path.join(here, '..', 'data'));
const webDir = path.resolve(process.env.AIRLOCK_WEB ?? path.join(here, '..', 'web', 'dist'));
const port = Number(process.env.PORT ?? 8787);
const host = process.env.HOST ?? '127.0.0.1';

const scanner = new Scanner(dataDir);
await scanner.load();
serve({ fetch: createApp(scanner, webDir).fetch, port, hostname: host }, () => {
  console.log(`Airlock on http://${host}:${port}`);
  if (!process.env.ANTHROPIC_API_KEY) console.log('ANTHROPIC_API_KEY is not set: reviews will fail.');
  if (!process.env.ARMORCLAUDE_DIR) console.log('ARMORCLAUDE_DIR is not set: reviewing WITHOUT ArmorIQ (backstop only).');
});
