// @vitest-environment node
import { expect, it } from 'vitest';
import { resolve } from 'node:path';
import type { Request } from 'express';
import { sourceLocation, localRequest } from './developer.js';
it('resolves manifest sources and rejects arbitrary paths', () => {
  const root = resolve(process.cwd(), '../..');
  expect(sourceLocation(root, 'orbital').path).toContain(
    '/orbital/v01-alpha.ts',
  );
  expect(
    sourceLocation(root, 'orbital', 'glowMultiplier').line,
  ).toBeGreaterThan(1);
  expect(sourceLocation(root, 'studio-test').path).toContain(
    '/assistant/recipe.ts',
  );
  for (const name of ['../../.env', '__proto__', 'constructor'])
    expect(() => sourceLocation(root, name)).toThrow();
});
it('rejects remote, foreign-origin and forged-host development requests', () => {
  const req = (
    headers: Request['headers'],
    method = 'GET',
    remoteAddress = '127.0.0.1',
  ) => ({ headers, method, socket: { remoteAddress } }) as Request;
  expect(localRequest(req({ host: '127.0.0.1:5173' }))).toBe(true);
  expect(
    localRequest(
      req({ host: '127.0.0.1:5173', origin: 'http://127.0.0.1:5173' }, 'POST'),
    ),
  ).toBe(true);
  expect(localRequest(req({ host: 'evil.test' }))).toBe(false);
  expect(
    localRequest(
      req({ host: 'localhost:5173', origin: 'https://evil.test' }, 'POST'),
    ),
  ).toBe(false);
  expect(localRequest(req({ host: 'localhost:5173' }, 'POST'))).toBe(false);
  expect(localRequest(req({ host: 'localhost:5173' }, 'GET', '10.0.0.1'))).toBe(
    false,
  );
});
