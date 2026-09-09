import express from 'express';
import compression from 'compression';
import cookieSession from 'cookie-session';
import multer from 'multer';
import { basename, resolve } from 'node:path';
import {
  randomBytes,
  randomUUID,
  createHash,
  timingSafeEqual,
} from 'node:crypto';
import { mkdir, copyFile, rename, unlink, realpath } from 'node:fs/promises';
import {
  AUDIO_EXTENSIONS,
  createAudioRouter,
  isWithin,
  scanAudioFiles,
} from './audio-files.js';

export interface ServerOptions {
  audioDir: string;
  distDir: string;
  authPage: string;
  uploadDir: string;
  production?: boolean;
  sessionSecret?: string;
  gatePassword?: string;
  approvedEmails?: string[];
  /** Number of trusted proxy hops, matched to the deployment topology. */
  trustProxy?: number;
  verifyAdmin?: (token: string) => Promise<boolean>;
}

const REPOSITORY = 'ColinConwell/CyberNoetica';
async function verifyAdminToken(token: string): Promise<boolean> {
  try {
    const res = await fetch(`https://api.github.com/repos/${REPOSITORY}`, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
      },
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return false;
    const data = (await res.json()) as { permissions?: { push?: boolean } };
    return data.permissions?.push === true;
  } catch {
    return false;
  }
}

function sameSecret(actual: string, expected: string): boolean {
  const hash = (value: string) => createHash('sha256').update(value).digest();
  return timingSafeEqual(hash(actual), hash(expected));
}

export function createWebServer(options: ServerOptions): express.Express {
  const password = options.gatePassword ?? '';
  if (
    options.production &&
    password &&
    (!options.sessionSecret || options.sessionSecret.length < 32)
  ) {
    throw new Error(
      'Authenticated production requires SESSION_SECRET with at least 32 characters',
    );
  }
  const emails = new Set(
    (options.approvedEmails ?? []).map((email) => email.trim().toLowerCase()),
  );
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', options.trustProxy ?? 0);
  app.use((_req, res, next) => {
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    next();
  });
  app.use(compression());
  app.use(
    cookieSession({
      name: 'cybernoetica',
      keys: [options.sessionSecret || randomBytes(32).toString('hex')],
      maxAge: 7 * 86400000,
      secure: options.production ?? false,
      httpOnly: true,
      sameSite: 'lax',
    }),
  );
  app.use(express.json({ limit: '16kb' }));
  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok' });
  });

  const attempts = new Map<string, { count: number; expires: number }>();
  app.post('/api/auth', (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    const now = Date.now();
    for (const [key, entry] of attempts)
      if (entry.expires <= now) attempts.delete(key);
    const key = req.ip ?? 'unknown';
    const entry = attempts.get(key) ?? { count: 0, expires: now + 15 * 60000 };
    if (entry.count >= 10 || (!attempts.has(key) && attempts.size >= 10000)) {
      res.setHeader(
        'Retry-After',
        String(Math.ceil((entry.expires - now) / 1000)),
      );
      res.status(429).json({ error: 'Too many attempts. Try again later.' });
      return;
    }
    entry.count++;
    attempts.set(key, entry);
    const { email, password: candidate } = req.body ?? {};
    if (
      typeof email !== 'string' ||
      typeof candidate !== 'string' ||
      !email ||
      !candidate
    ) {
      res.status(400).json({ error: 'Email and password required' });
      return;
    }
    if (
      !password ||
      !sameSecret(candidate, password) ||
      (emails.size && !emails.has(email.toLowerCase()))
    ) {
      res.status(401).json({ error: 'Invalid email or password' });
      return;
    }
    attempts.delete(key);
    req.session = { authenticated: true, email: email.toLowerCase() };
    res.json({ success: true });
  });
  app.post('/api/logout', (req, res) => {
    req.session = null;
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Clear-Site-Data', '"cache"');
    res.json({ success: true });
  });

  const requireAdmin: express.RequestHandler = async (req, res, next) => {
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) {
      res.status(401).json({ error: 'Bearer token required' });
      return;
    }
    if (!(await (options.verifyAdmin ?? verifyAdminToken)(header.slice(7)))) {
      res.status(403).json({ error: `Requires push access to ${REPOSITORY}` });
      return;
    }
    next();
  };
  const upload = multer({
    dest: options.uploadDir,
    limits: { fileSize: 100 * 1024 * 1024, files: 1, fields: 1 },
    fileFilter: (_req, file, done) =>
      done(null, AUDIO_EXTENSIONS.test(file.originalname)),
  });
  app.post(
    '/api/admin/upload',
    requireAdmin,
    upload.single('file'),
    async (req, res) => {
      if (!req.file) {
        res.status(400).json({ error: 'No valid audio file provided' });
        return;
      }
      let staging: string | undefined;
      try {
        const subdir =
          typeof req.body?.subdir === 'string'
            ? req.body.subdir.replace(/[^a-zA-Z0-9_-]/g, '')
            : '';
        await mkdir(options.audioDir, { recursive: true });
        const root = await realpath(options.audioDir);
        const directory = resolve(root, subdir);
        await mkdir(directory, { recursive: true });
        const actualDirectory = await realpath(directory);
        if (!isWithin(root, actualDirectory)) {
          res.sendStatus(403);
          return;
        }
        const name = basename(req.file.originalname).replace(
          /[^a-zA-Z0-9._-]/g,
          '_',
        );
        // Stage on the destination volume and rename atomically. This does not
        // follow an existing destination symlink or expose a partial audio file.
        staging = resolve(actualDirectory, `.upload-${randomUUID()}`);
        await copyFile(req.file.path, staging);
        await rename(staging, resolve(actualDirectory, name));
        staging = undefined;
        res.json({ success: true, path: subdir ? `${subdir}/${name}` : name });
      } finally {
        await unlink(req.file.path).catch(() => {});
        if (staging) await unlink(staging).catch(() => {});
      }
    },
  );
  app.get('/api/admin/tracks', requireAdmin, (_req, res) => {
    res.json({
      tracks: scanAudioFiles(options.audioDir),
      dir: options.audioDir,
    });
  });

  app.use((req, res, next) => {
    if (!password || req.session?.authenticated) return next();
    res.setHeader('Cache-Control', 'no-store');
    if (req.method === 'GET' && req.headers.accept?.includes('text/html'))
      res.sendFile(options.authPage);
    else res.status(401).json({ error: 'Not authenticated' });
  });
  app.use('/sample-music', createAudioRouter(options.audioDir));
  app.use(
    express.static(options.distDir, {
      maxAge: '1d',
      setHeaders: (res, path) => {
        if (
          path.endsWith('index.html') ||
          path.endsWith('/sw.js') ||
          path.endsWith('/registerSW.js')
        ) {
          res.setHeader('Cache-Control', 'no-cache');
        }
      },
    }),
  );
  app.use('/assets', (_req, res) => {
    res.sendStatus(404);
  });
  app.get('/{*splat}', (_req, res) => {
    res.setHeader('Cache-Control', 'no-cache');
    res.sendFile(resolve(options.distDir, 'index.html'));
  });
  const errors: express.ErrorRequestHandler = (error, _req, res, next) => {
    if (res.headersSent) {
      next(error);
      return;
    }
    const status =
      error instanceof multer.MulterError ? 400 : Number(error.status) || 500;
    if (error.headers)
      for (const [name, value] of Object.entries(error.headers))
        res.setHeader(name, String(value));
    res
      .status(status)
      .json({ error: status >= 500 ? 'Request failed' : error.message });
  };
  app.use(errors);
  return app;
}
