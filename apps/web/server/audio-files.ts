import { Router } from 'express';
import { realpathSync, readdirSync, statSync, existsSync } from 'node:fs';
import { relative, resolve, isAbsolute, sep } from 'node:path';

export const AUDIO_EXTENSIONS = /\.(mp3|wav|ogg|flac|aac|m4a)$/i;

export function isWithin(root: string, target: string): boolean {
  const path = relative(root, target);
  return path !== '..' && !path.startsWith(`..${sep}`) && !isAbsolute(path);
}

/** Check real paths as well as lexical paths, including symlink destinations. */
export function resolveAudioPath(root: string, path: string): string | null {
  const base = resolve(root);
  const candidate = resolve(base, path);
  if (!isWithin(base, candidate) || !existsSync(candidate)) return null;
  const actual = realpathSync(candidate);
  return isWithin(realpathSync(base), actual) ? actual : null;
}

export function scanAudioFiles(root: string): string[] {
  if (!existsSync(root)) return [];
  const base = realpathSync(root);
  const visited = new Set<string>();
  const files: string[] = [];
  function visit(dir: string, prefix: string) {
    const actual = realpathSync(dir);
    if (!isWithin(base, actual) || visited.has(actual)) return;
    visited.add(actual);
    for (const name of readdirSync(dir).sort()) {
      const path = resolveAudioPath(base, relative(base, resolve(dir, name)));
      if (!path) continue;
      const label = prefix ? `${prefix}/${name}` : name;
      if (statSync(path).isDirectory()) visit(path, label);
      else if (AUDIO_EXTENSIONS.test(name)) files.push(label);
    }
  }
  visit(base, '');
  return files;
}

/** Production, development, and preview share Express's HTTP range handling. */
export function createAudioRouter(directory: string): Router {
  const router = Router();
  router.get('/__list', (_req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.json(scanAudioFiles(directory));
  });
  router.use((req, res, next) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') return next();
    let name: string;
    try {
      name = decodeURIComponent(req.path.slice(1));
    } catch {
      res.sendStatus(400);
      return;
    }
    if (!AUDIO_EXTENSIONS.test(name)) {
      res.sendStatus(404);
      return;
    }
    const file = resolveAudioPath(directory, name);
    if (!file || !statSync(file).isFile()) {
      res.sendStatus(404);
      return;
    }
    res.sendFile(
      file,
      { acceptRanges: true, dotfiles: 'deny', maxAge: 0 },
      (error) => {
        if (error) next(error);
      },
    );
  });
  return router;
}
