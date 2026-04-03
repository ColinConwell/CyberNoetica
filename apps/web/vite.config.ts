import { defineConfig } from 'vite';
import { resolve } from 'path';
import { readdirSync, statSync, existsSync, createReadStream } from 'fs';

/** Recursively scan a directory for audio files */
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

export default defineConfig({
  server: {
    port: 5173,
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    },
  },
  build: {
    target: 'es2022',
  },
  optimizeDeps: {
    exclude: ['@cybernoetica/audio'],
  },
  plugins: [
    {
      name: 'sample-music',
      configureServer(server) {
        const musicDir = resolve(__dirname, '../../data/sample-music');
        server.middlewares.use('/sample-music', (req, res, next) => {
          if (!req.url) return next();
          if (req.url === '/__list') {
            const files = scanAudioFiles(musicDir);
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify(files));
            return;
          }
          // Serve audio files directly via fs
          const filePath = resolve(musicDir, decodeURIComponent(req.url.slice(1)));
          if (!filePath.startsWith(musicDir)) { res.statusCode = 403; res.end(); return; }
          if (!existsSync(filePath) || statSync(filePath).isDirectory()) { return next(); }
          const ext = filePath.split('.').pop()?.toLowerCase() || '';
          const mimeTypes: Record<string, string> = {
            mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg',
            flac: 'audio/flac', aac: 'audio/aac', m4a: 'audio/mp4',
          };
          res.setHeader('Content-Type', mimeTypes[ext] || 'application/octet-stream');
          createReadStream(filePath).pipe(res);
        });
      },
    },
  ],
});
