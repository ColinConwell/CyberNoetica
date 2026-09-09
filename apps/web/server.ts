import { resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { createWebServer } from './server/create-server.js';
import { scanAudioFiles } from './server/audio-files.js';

const directory = process.env.APP_DIR || process.cwd();
const audioDir =
  process.env.AUDIO_DIR || resolve(directory, '../../data/sample-music');
const production = process.env.NODE_ENV === 'production';
const app = createWebServer({
  audioDir,
  distDir: resolve(directory, 'dist'),
  authPage: resolve(directory, 'auth-page.html'),
  uploadDir: process.env.UPLOAD_DIR || '/tmp/cybernoetica-uploads',
  production,
  gatePassword: process.env.GATE_PASSWORD,
  sessionSecret: process.env.SESSION_SECRET,
  approvedEmails: (process.env.APPROVED_EMAILS || '')
    .split(',')
    .filter(Boolean),
  trustProxy: Number(process.env.TRUST_PROXY_HOPS ?? (production ? 1 : 0)),
});
const port = Number(process.env.PORT || 3000);
app.listen(port, () => {
  console.log(`Cybernoetica server on port ${port}`);
  console.log(
    `Audio directory: ${audioDir}; exists: ${existsSync(audioDir)}; tracks: ${scanAudioFiles(audioDir).length}`,
  );
  console.log(
    `Authentication: ${process.env.GATE_PASSWORD ? 'enabled' : 'disabled'}`,
  );
});
