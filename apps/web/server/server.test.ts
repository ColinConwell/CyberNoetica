// @vitest-environment node
import { afterEach, describe, expect, it } from 'vitest';
import {
  mkdtemp,
  mkdir,
  writeFile,
  readdir,
  symlink,
  rm,
  readFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Server } from 'node:http';
import { createWebServer, type ServerOptions } from './create-server.js';

const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close();
});

async function fixture(overrides: Partial<ServerOptions> = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'cyber-server-test-'));
  cleanup.push(() => rm(dir, { recursive: true, force: true }));
  const options: ServerOptions = {
    audioDir: join(dir, 'audio'),
    distDir: join(dir, 'dist'),
    authPage: join(dir, 'auth.html'),
    uploadDir: join(dir, 'uploads'),
    verifyAdmin: async (token) => token === 'test-admin',
    ...overrides,
  };
  await mkdir(options.audioDir);
  await mkdir(options.distDir);
  await writeFile(
    join(options.distDir, 'index.html'),
    '<html>Visualizer</html>',
  );
  await writeFile(options.authPage, '<html>Sign in</html>');
  await writeFile(join(options.audioDir, 'tone.mp3'), '0123456789');
  const app = createWebServer(options);
  const server = await new Promise<Server>((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  cleanup.push(
    () =>
      new Promise<void>((resolve, reject) => {
        server.closeAllConnections();
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  );
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('No test port');
  return { options, dir, url: `http://127.0.0.1:${address.port}` };
}

describe('audio HTTP serving', () => {
  it('supports suffix ranges, explicit ranges, HEAD, and unsatisfiable ranges', async () => {
    const { url } = await fixture();
    const suffix = await fetch(`${url}/sample-music/tone.mp3`, {
      headers: { Range: 'bytes=-3' },
    });
    expect(suffix.status).toBe(206);
    expect(await suffix.text()).toBe('789');
    const range = await fetch(`${url}/sample-music/tone.mp3`, {
      headers: { Range: 'bytes=2-5' },
    });
    expect(range.status).toBe(206);
    expect(await range.text()).toBe('2345');
    const head = await fetch(`${url}/sample-music/tone.mp3`, {
      method: 'HEAD',
    });
    expect(head.headers.get('content-length')).toBe('10');
    expect(await head.text()).toBe('');
    const invalid = await fetch(`${url}/sample-music/tone.mp3`, {
      headers: { Range: 'bytes=99-100' },
    });
    expect(invalid.status).toBe(416);
    expect(invalid.headers.get('content-range')).toBe('bytes */10');
  });

  it('rejects sibling-prefix paths and symlinks and avoids recursive symlink cycles', async () => {
    const { url, dir, options } = await fixture();
    await mkdir(join(dir, 'audio-private'));
    await writeFile(join(dir, 'audio-private/secret.mp3'), 'secret');
    await symlink(
      join(dir, 'audio-private/secret.mp3'),
      join(options.audioDir, 'outside.mp3'),
    );
    await symlink(options.audioDir, join(options.audioDir, 'cycle'));
    expect(
      (await fetch(`${url}/sample-music/..%2faudio-private%2fsecret.mp3`))
        .status,
    ).toBe(404);
    expect((await fetch(`${url}/sample-music/outside.mp3`)).status).toBe(404);
    expect(await (await fetch(`${url}/sample-music/__list`)).json()).toEqual([
      'tone.mp3',
    ]);
    expect((await fetch(`${url}/assets/missing.js`)).status).toBe(404);
  });
});

describe('authentication and upload', () => {
  it('rejects uploads before writing files and cleans successful uploads', async () => {
    const { url, options } = await fixture();
    const upload = () => {
      const form = new FormData();
      form.set('file', new Blob(['track']), 'new.mp3');
      return form;
    };
    expect(
      (
        await fetch(`${url}/api/admin/upload`, {
          method: 'POST',
          body: upload(),
        })
      ).status,
    ).toBe(401);
    expect(await readdir(options.uploadDir)).toEqual([]);
    expect(
      (
        await fetch(`${url}/api/admin/upload`, {
          method: 'POST',
          headers: { Authorization: 'Bearer test-admin' },
          body: upload(),
        })
      ).status,
    ).toBe(200);
    expect(await readFile(join(options.audioDir, 'new.mp3'), 'utf8')).toBe(
      'track',
    );
    expect(await readdir(options.uploadDir)).toEqual([]);
  });

  it('cleans a denied upload into a symlinked directory', async () => {
    const { url, options, dir } = await fixture();
    await mkdir(join(dir, 'outside'));
    await symlink(join(dir, 'outside'), join(options.audioDir, 'escape'));
    const form = new FormData();
    form.set('subdir', 'escape');
    form.set('file', new Blob(['track']), 'new.mp3');
    expect(
      (
        await fetch(`${url}/api/admin/upload`, {
          method: 'POST',
          headers: { Authorization: 'Bearer test-admin' },
          body: form,
        })
      ).status,
    ).toBe(403);
    expect(await readdir(options.uploadDir)).toEqual([]);
    expect(await readdir(join(dir, 'outside'))).toEqual([]);
  });

  it('requires production secrets, supports secure cookies behind the configured proxy, and throttles failures', async () => {
    expect(() =>
      createWebServer({
        production: true,
        gatePassword: 'gate',
      } as ServerOptions),
    ).toThrow('SESSION_SECRET');
    const { url } = await fixture({
      production: true,
      gatePassword: 'gate',
      sessionSecret: 'x'.repeat(40),
      trustProxy: 1,
    });
    const headers = {
      'content-type': 'application/json',
      'x-forwarded-proto': 'https',
    };
    const success = await fetch(`${url}/api/auth`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ email: 'user@example.test', password: 'gate' }),
    });
    expect(success.status).toBe(200);
    expect(success.headers.get('set-cookie')).toContain('secure');
    expect((await fetch(`${url}/sample-music/__list`)).status).toBe(401);
    for (let i = 0; i < 10; i++)
      await fetch(`${url}/api/auth`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ email: 'user@example.test', password: 'bad' }),
      });
    expect(
      (await fetch(`${url}/api/auth`, { method: 'POST', headers, body: '{}' }))
        .status,
    ).toBe(429);
  });
});
