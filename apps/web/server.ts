import express from 'express';
import compression from 'compression';
import cookieSession from 'cookie-session';
import multer from 'multer';
import { resolve, dirname, basename } from 'path';
import { fileURLToPath } from 'url';
import { readdirSync, statSync, existsSync, createReadStream, mkdirSync, renameSync } from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));

const PORT = parseInt(process.env.PORT || '3000', 10);
const AUDIO_DIR = process.env.AUDIO_DIR || resolve(__dirname, '../../data/sample-music');
const DIST_DIR = resolve(__dirname, 'dist');
const AUTH_PAGE = resolve(__dirname, 'auth-page.html');

const APPROVED_EMAILS = (process.env.APPROVED_EMAILS || '')
  .split(',').map(e => e.trim().toLowerCase()).filter(Boolean);
const GATE_PASSWORD = process.env.GATE_PASSWORD || '';
const SESSION_SECRET = process.env.SESSION_SECRET || 'dev-secret-change-me';

const GITHUB_REPO = 'ColinConwell/CyberNoetica';
const AUDIO_EXTENSIONS = /\.(mp3|wav|ogg|flac|aac|m4a)$/i;

function scanAudioFiles(dir: string, base = ''): string[] {
  const results: string[] = [];
  if (!existsSync(dir)) return results;
  for (const entry of readdirSync(dir)) {
    const full = resolve(dir, entry);
    const rel = base ? `${base}/${entry}` : entry;
    if (statSync(full).isDirectory()) {
      results.push(...scanAudioFiles(full, rel));
    } else if (/\.(mp3|wav|ogg|flac|aac|m4a)$/i.test(entry)) {
      results.push(rel);
    }
  }
  return results;
}

const MIME_TYPES: Record<string, string> = {
  mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg',
  flac: 'audio/flac', aac: 'audio/aac', m4a: 'audio/mp4',
};

const app = express();

// -- Security headers (COOP/COEP for WASM SharedArrayBuffer) --
app.use((_req, res, next) => {
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
  next();
});

app.use(compression());

app.use(cookieSession({
  name: 'cybernoetica',
  keys: [SESSION_SECRET],
  maxAge: 7 * 24 * 60 * 60 * 1000,
  secure: process.env.NODE_ENV === 'production',
  httpOnly: true,
  sameSite: 'lax',
}));

app.use(express.json());

// -- Public routes --

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok' });
});

app.post('/api/auth', (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    res.status(400).json({ error: 'Email and password required' });
    return;
  }
  if (password !== GATE_PASSWORD) {
    res.status(401).json({ error: 'Invalid password' });
    return;
  }
  if (APPROVED_EMAILS.length > 0 && !APPROVED_EMAILS.includes(email.toLowerCase())) {
    res.status(403).json({ error: 'Email not approved for access' });
    return;
  }
  if (req.session) {
    req.session.authenticated = true;
    req.session.email = email.toLowerCase();
  }
  res.json({ success: true });
});

app.post('/api/logout', (req, res) => {
  req.session = null;
  res.json({ success: true });
});

// -- Admin (GitHub collaborator auth: push access to GITHUB_REPO) --

async function verifyRepoPushAccess(token: string): Promise<boolean> {
  try {
    const res = await fetch(`https://api.github.com/repos/${GITHUB_REPO}`, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' },
    });
    if (!res.ok) return false;
    const data = await res.json() as { permissions?: { push?: boolean } };
    return data.permissions?.push === true;
  } catch { return false; }
}

async function requireAdmin(req: express.Request, res: express.Response): Promise<boolean> {
  const auth = req.headers.authorization;
  if (!auth?.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Bearer token required' });
    return false;
  }
  if (!await verifyRepoPushAccess(auth.slice(7))) {
    res.status(403).json({ error: 'Requires push access to ' + GITHUB_REPO });
    return false;
  }
  return true;
}

const upload = multer({
  dest: '/tmp/uploads',
  limits: { fileSize: 100 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    cb(null, AUDIO_EXTENSIONS.test(file.originalname));
  },
});

app.post('/api/admin/upload', upload.single('file'), async (req, res) => {
  if (!await requireAdmin(req, res)) return;

  if (!req.file) {
    res.status(400).json({ error: 'No valid audio file provided' });
    return;
  }

  const subdir = typeof req.body?.subdir === 'string' ? req.body.subdir.replace(/[^a-zA-Z0-9_-]/g, '') : '';
  const targetDir = subdir ? resolve(AUDIO_DIR, subdir) : AUDIO_DIR;
  const safeName = basename(req.file.originalname).replace(/[^a-zA-Z0-9._-]/g, '_');
  const targetPath = resolve(targetDir, safeName);

  if (!targetPath.startsWith(AUDIO_DIR)) {
    res.status(403).json({ error: 'Invalid path' });
    return;
  }

  mkdirSync(targetDir, { recursive: true });
  renameSync(req.file.path, targetPath);

  res.json({ success: true, path: subdir ? `${subdir}/${safeName}` : safeName });
});

app.get('/api/admin/tracks', async (req, res) => {
  if (!await requireAdmin(req, res)) return;
  res.json({ tracks: scanAudioFiles(AUDIO_DIR), dir: AUDIO_DIR });
});

// -- Auth guard --
app.use((req, res, next) => {
  if (!GATE_PASSWORD) return next();
  if (req.session?.authenticated) return next();
  if (req.accepts('html')) {
    res.sendFile(AUTH_PAGE);
    return;
  }
  res.status(401).json({ error: 'Not authenticated' });
});

// -- Audio file serving (replicates the Vite dev plugin) --
app.use('/sample-music', (req, res, next) => {
  if (req.method !== 'GET') return next();

  if (req.url === '/__list') {
    res.json(scanAudioFiles(AUDIO_DIR));
    return;
  }

  const relativePath = decodeURIComponent(req.url.slice(1));
  const filePath = resolve(AUDIO_DIR, relativePath);

  if (!filePath.startsWith(AUDIO_DIR)) { res.status(403).end(); return; }
  if (!existsSync(filePath) || statSync(filePath).isDirectory()) { res.status(404).end(); return; }

  const ext = filePath.split('.').pop()?.toLowerCase() || '';
  res.setHeader('Content-Type', MIME_TYPES[ext] || 'application/octet-stream');

  const stat = statSync(filePath);
  const range = req.headers.range;

  if (range) {
    const parts = range.replace(/bytes=/, '').split('-');
    const start = parseInt(parts[0], 10);
    const end = parts[1] ? parseInt(parts[1], 10) : stat.size - 1;
    res.status(206);
    res.setHeader('Content-Range', `bytes ${start}-${end}/${stat.size}`);
    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Content-Length', String(end - start + 1));
    createReadStream(filePath, { start, end }).pipe(res);
  } else {
    res.setHeader('Content-Length', String(stat.size));
    res.setHeader('Accept-Ranges', 'bytes');
    createReadStream(filePath).pipe(res);
  }
});

// -- Static SPA files --
app.use(express.static(DIST_DIR, {
  maxAge: '1d',
  setHeaders: (res, path) => {
    if (path.endsWith('index.html')) {
      res.setHeader('Cache-Control', 'no-cache');
    }
  },
}));

// -- SPA fallback --
app.get('/{*splat}', (_req, res) => {
  res.sendFile(resolve(DIST_DIR, 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Cybernoetica server on port ${PORT}`);
  console.log(`  Audio: ${AUDIO_DIR}`);
  console.log(`  Auth: ${GATE_PASSWORD ? 'enabled' : 'disabled (no GATE_PASSWORD)'}`);
  console.log(`  Admin: push access to ${GITHUB_REPO}`);
});
