import express from 'express';
import type { Request } from 'express';
import { readFileSync, realpathSync } from 'node:fs';
import { resolve, sep } from 'node:path';
import { execFile } from 'node:child_process';

export function localRequest(req: Request): boolean {
  const address = req.socket.remoteAddress;
  if (!['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(address ?? ''))
    return false;
  const host = req.headers.host ?? '';
  if (!/^(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/.test(host)) return false;
  if (req.headers['sec-fetch-site'] === 'cross-site') return false;
  if (
    req.headers.origin &&
    req.headers.origin !== `http://${host}` &&
    req.headers.origin !== `https://${host}`
  )
    return false;
  return req.method === 'GET' || Boolean(req.headers.origin);
}
export function sourceLocation(
  root: string,
  target: string,
  key = '',
): { path: string; line: number } {
  if (/^studio-[a-z0-9-]{1,40}$/.test(target)) target = 'studio';
  const base = resolve(root, 'packages/renderer/src/visualizers');
  const manifest = readFileSync(resolve(base, 'manifest.ts'), 'utf8');
  const entries = [
    ...manifest.matchAll(
      /type:\s*'([^']+)'[\s\S]*?loader:\s*\(\)\s*=>\s*import\('\.\/([^']+)'\)/g,
    ),
  ];
  const entry = entries.find((m) => m[1] === target);
  const known: Record<string, string> = {
    journey: 'apps/web/src/ui/journey-controls.ts',
    soundscape: 'apps/web/src/ui/soundscape-controls.ts',
    menus: 'apps/web/src/ui/menu-layout.ts',
    developer: 'apps/web/src/developer/workbench.ts',
    studio: 'apps/web/src/assistant/recipe.ts',
  };
  if (!entry && !Object.hasOwn(known, target))
    throw new Error('Unknown source target');
  const path = realpathSync(
    entry
      ? resolve(base, entry[2].replace(/\.js$/, '.ts'))
      : resolve(root, known[target]),
  );
  if (!path.startsWith(realpathSync(root) + sep))
    throw new Error('Source outside workspace');
  const lines = readFileSync(path, 'utf8').split('\n');
  const exactKey =
    key && /^[\w-]{1,80}$/.test(key)
      ? lines.findIndex(
          (line) =>
            line.includes(`key: '${key}'`) || line.includes(`key: "${key}"`),
        )
      : -1;
  const definition = lines.findIndex((line) =>
    /(?:const .*metadata|const .*META|export class|export function)/i.test(
      line,
    ),
  );
  return {
    path,
    line: exactKey >= 0 ? exactKey + 1 : Math.max(1, definition + 1),
  };
}
/** Mounted only by Vite's development server, never the production server. */
export function createDeveloperRouter(root: string): express.Router {
  const router = express.Router();
  router.use((req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    if (!localRequest(req)) {
      res
        .status(403)
        .json({ error: 'Local same-origin development requests only.' });
      return;
    }
    next();
  });
  router.use(express.json({ limit: '8kb' }));
  router.get('/source', (req, res) => {
    try {
      res.json(
        sourceLocation(
          root,
          String(req.query.target ?? ''),
          String(req.query.key ?? ''),
        ),
      );
    } catch {
      res.status(404).json({ error: 'Source target not found.' });
    }
  });
  router.post('/reveal', (req, res) => {
    try {
      if (process.platform !== 'darwin') {
        res.status(400).json({ error: 'Finder is available on macOS only.' });
        return;
      }
      const location = sourceLocation(root, String(req.body?.target ?? ''));
      execFile(
        '/usr/bin/open',
        ['-R', location.path],
        { timeout: 5000 },
        (error) => {
          res.status(error ? 500 : 200).json({ ok: !error });
        },
      );
    } catch {
      res.status(404).json({ error: 'Source target not found.' });
    }
  });
  return router;
}
