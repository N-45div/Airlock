import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { serveStatic } from '@hono/node-server/serve-static';
import { getConnInfo } from '@hono/node-server/conninfo';
import { Hono, type Context } from 'hono';
import { cors } from 'hono/cors';
import { secureHeaders } from 'hono/secure-headers';
import { streamSSE } from 'hono/streaming';
import { FetchError } from './fetch-repo.ts';
import { publicSamples } from './samples.ts';
import { ScanError, type Scanner } from './scans.ts';
import type { ScanEvent } from './types.ts';

export function createApp(scanner: Scanner, webDir: string): Hono {
  const app = new Hono();

  app.use(
    '*',
    secureHeaders({
      contentSecurityPolicy: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
        fontSrc: ["'self'", 'https://fonts.gstatic.com'],
        imgSrc: ["'self'", 'data:'],
        connectSrc: ["'self'"],
        frameAncestors: ["'none'"],
      },
    }),
  );
  // The extension and other tools call the API from elsewhere; no cookies are used.
  app.use('/api/*', cors({ origin: '*', allowHeaders: ['content-type', 'x-airlock-key'] }));

  const clientIp = (c: Context): string => {
    const forwarded = process.env.AIRLOCK_TRUST_PROXY ? c.req.header('x-forwarded-for')?.split(',')[0]?.trim() : undefined;
    return forwarded || getConnInfo(c).remote.address || 'unknown';
  };

  app.onError((error, c) => {
    if (error instanceof ScanError) return c.json({ error: error.message }, error.status as 400);
    if (error instanceof FetchError) return c.json({ error: error.message }, 400);
    console.error(error);
    return c.json({ error: 'Something went wrong on our side.' }, 500);
  });

  app.get('/api/health', (c) => c.json({ ok: true }));
  app.get('/api/samples', (c) => c.json(publicSamples()));

  app.post('/api/scans', async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { url?: unknown };
    if (typeof body.url !== 'string' || body.url.length > 500) throw new ScanError('Send {"url": "https://github.com/owner/name"}.');
    return c.json(scanner.start(body.url, clientIp(c)), 201);
  });

  app.get('/api/scans/:id', (c) => {
    const scan = scanner.get(c.req.param('id'));
    return scan ? c.json(scan) : c.json({ error: 'No scan with that id.' }, 404);
  });

  app.get('/api/scans/:id/stream', (c) => {
    const id = c.req.param('id');
    const scan = scanner.get(id);
    if (!scan) return c.json({ error: 'No scan with that id.' }, 404);
    return streamSSE(c, async (stream) => {
      const send = (event: ScanEvent) => stream.writeSSE({ data: JSON.stringify(event) });
      await send({ type: 'scan', scan });
      if (scan.status === 'done' || scan.status === 'failed') {
        await send({ type: 'done', scan });
        return;
      }
      await new Promise<void>((resolve) => {
        const stop = scanner.subscribe(id, (event) => {
          void send(event);
          if (event.type === 'done') finish();
        });
        const ping = setInterval(() => void stream.writeSSE({ event: 'ping', data: '' }), 20_000);
        const finish = () => {
          clearInterval(ping);
          stop();
          resolve();
        };
        stream.onAbort(finish);
      });
    });
  });

  app.post('/api/scans/:id/approvals/:aid', async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { decision?: unknown };
    if (body.decision !== 'approve' && body.decision !== 'deny') throw new ScanError('Send {"decision": "approve" | "deny"}.');
    const approval = scanner.answer(c.req.param('id'), c.req.param('aid'), c.req.header('x-airlock-key') ?? '', body.decision === 'approve');
    return c.json(approval);
  });

  app.get('/api/lookup', (c) => c.json({ scan: scanner.latest(c.req.query('url') ?? '') }));

  // The web app: built files, with the report and scan pages served by the app's router.
  app.use('/assets/*', serveStatic({ root: path.relative(process.cwd(), webDir) }));
  app.use('/favicon.svg', serveStatic({ root: path.relative(process.cwd(), webDir) }));
  app.get('*', async (c) => {
    try {
      return c.html(await readFile(path.join(webDir, 'index.html'), 'utf8'));
    } catch {
      return c.text('The web app is not built yet. Run npm run build.', 503);
    }
  });

  return app;
}
