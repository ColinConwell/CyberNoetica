// @vitest-environment node
import { afterEach, expect, it, vi } from 'vitest';
import express from 'express';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createAgentRouter } from './agent-router.js';
import {
  localKeys,
  normalizeReply,
  providerRequest,
  requestProvider,
} from './agent-providers.js';
import { parseTool } from '../src/assistant/protocol.js';
const cleanup: Array<() => Promise<void> | void> = [];
afterEach(async () => {
  for (const f of cleanup.splice(0).reverse()) await f();
  vi.unstubAllEnvs();
});
const call = {
  id: 'call_1',
  name: 'studio_tool',
  arguments: JSON.stringify({ operation: 'inspect_state', payload: '{}' }),
};
const messages = [
  { role: 'user' as const, content: 'Inspect' },
  {
    role: 'assistant' as const,
    content: '',
    calls: [call],
    reasoning: [
      {
        type: 'reasoning' as const,
        id: 'r1',
        encrypted_content: 'opaque',
        summary: [],
      },
    ],
  },
  { role: 'tool' as const, callId: 'call_1', content: '{"type":"orbital"}' },
];
it('preserves tool-result identity across provider formats and encrypted Responses continuation', () => {
  const openai = providerRequest(
    'openai',
    'model',
    messages,
    {},
    'debug',
  ) as any;
  expect(openai.store).toBe(false);
  expect(openai.input[1].encrypted_content).toBe('opaque');
  expect(openai.input[3].call_id).toBe('call_1');
  expect(
    providerRequest('kimi', 'kimi-k2.5', messages, {}, 'debug'),
  ).toHaveProperty('thinking.type', 'disabled');
  const claude = providerRequest(
    'anthropic',
    'model',
    messages,
    {},
    'debug',
  ) as any;
  expect(claude.messages[1].content[0].input.operation).toBe('inspect_state');
  expect(claude.messages[2].content[0].tool_use_id).toBe('call_1');
  for (const provider of ['openrouter', 'xai', 'kimi'] as const) {
    const body = providerRequest(
      provider,
      'model',
      messages,
      {},
      'debug',
    ) as any;
    expect(body.messages[2].tool_calls[0].id).toBe('call_1');
    expect(body.messages[3].tool_call_id).toBe('call_1');
  }
});
it('normalizes real tool shapes and rejects unknown or executable tools', () => {
  for (const [provider, data] of [
    [
      'openai',
      {
        output: [
          {
            type: 'function_call',
            call_id: call.id,
            name: call.name,
            arguments: call.arguments,
          },
        ],
      },
    ],
    [
      'anthropic',
      {
        content: [
          {
            type: 'tool_use',
            id: call.id,
            name: call.name,
            input: JSON.parse(call.arguments),
          },
        ],
      },
    ],
    [
      'kimi',
      {
        choices: [
          {
            message: {
              tool_calls: [
                {
                  id: call.id,
                  function: { name: call.name, arguments: call.arguments },
                },
              ],
            },
          },
        ],
      },
    ],
  ] as const)
    expect(parseTool(normalizeReply(provider, data).calls[0]).operation).toBe(
      'inspect_state',
    );
  expect(() =>
    normalizeReply('openai', {
      output: [
        { type: 'function_call', call_id: 'a', name: 'exec', arguments: '{}' },
      ],
    }),
  ).toThrow();
  expect(() =>
    parseTool({ ...call, arguments: '{"operation":"exec","payload":"{}"}' }),
  ).toThrow();
  expect(() =>
    parseTool({
      ...call,
      arguments: '{"operation":"inspect_state","payload":"[]"}',
    }),
  ).toThrow();
});
it('does not forward raw provider errors or redirect credentials', async () => {
  const fetcher = vi.fn(async (_url: unknown, init?: RequestInit) => {
    expect(init?.redirect).toBe('error');
    return new Response('secret upstream diagnostic', { status: 401 });
  }) as unknown as typeof fetch;
  await expect(
    requestProvider(
      'openai',
      'test',
      'test-key',
      [],
      {},
      'debug',
      new AbortController().signal,
      fetcher,
    ),
  ).rejects.toThrow('HTTP 401');
});
async function fixture(local = false) {
  const root = mkdtempSync(join(tmpdir(), 'studio-api-'));
  cleanup.push(() => rmSync(root, { recursive: true, force: true }));
  writeFileSync(
    join(root, '.env.local'),
    'OPENAI_API_KEY=fixture-local-key\nUNRELATED_SECRET=never-return\n',
  );
  const fetcher = vi.fn(
    async (_url: unknown, _init?: RequestInit) =>
      new Response(
        JSON.stringify({
          output: [
            {
              type: 'message',
              content: [{ type: 'output_text', text: 'Ready' }],
            },
          ],
        }),
      ),
  ) as unknown as typeof fetch;
  const app = express();
  app.use(
    '/api/assistant',
    createAgentRouter({ ...(local ? { developmentRoot: root } : {}), fetcher }),
  );
  const server = await new Promise<ReturnType<typeof app.listen>>((r) => {
    const s = app.listen(0, '127.0.0.1', () => r(s));
  });
  cleanup.push(
    () =>
      new Promise<void>((r) => {
        server.closeAllConnections();
        server.close(() => r());
      }),
  );
  const address = server.address();
  if (!address || typeof address === 'string') throw Error('port');
  const url = `http://127.0.0.1:${address.port}`;
  const post = (
    path: string,
    body: unknown,
    extra: Record<string, string> = {},
  ) =>
    fetch(url + '/api/assistant/' + path, {
      method: 'POST',
      headers: {
        Origin: url,
        'Content-Type': 'application/json',
        'X-Studio-Enabled': 'true',
        ...extra,
      },
      body: JSON.stringify(body),
    });
  return { root, url, post, fetcher };
}
const turn = {
  provider: 'openai',
  model: 'gpt-6-astra',
  mode: 'debug',
  context: {},
  messages: [{ role: 'user', content: 'Hello' }],
};
it('loads only approved local keys and never exposes values via config', async () => {
  const { root, url, post, fetcher } = await fixture(true);
  expect(localKeys(root)).not.toHaveProperty('UNRELATED_SECRET');
  const config = await (await fetch(url + '/api/assistant/config')).text();
  expect(config).toContain('"localKeyAvailable":true');
  expect(config).not.toContain('fixture-local-key');
  expect((await post('turn', turn)).status).toBe(200);
  expect(vi.mocked(fetcher).mock.calls[0][1]?.headers).toHaveProperty(
    'Authorization',
    'Bearer fixture-local-key',
  );
});
it('deployed mode is BYOK only and disables filesystem/test capabilities', async () => {
  vi.stubEnv('OPENAI_API_KEY', 'must-never-be-used');
  const { url, post, fetcher } = await fixture();
  const config = await (await fetch(url + '/api/assistant/config')).json();
  expect(config.local).toBe(false);
  expect(config.providers.every((p: any) => !p.localKeyAvailable)).toBe(true);
  expect((await post('turn', turn)).status).toBe(401);
  expect(fetcher).not.toHaveBeenCalled();
  expect(
    (await post('turn', turn, { Authorization: 'Bearer session-key' })).status,
  ).toBe(200);
  for (const path of ['source', 'test'])
    expect(
      (await post(path, { target: '../../.env.local', suite: 'shell' })).status,
    ).toBe(404);
});
it('rejects cross-origin, malformed tools and unsupported models before provider traffic', async () => {
  const { post, fetcher } = await fixture(true);
  expect(
    (await post('turn', turn, { Origin: 'https://foreign.test' })).status,
  ).toBe(403);
  expect(
    (await post('turn', turn, { 'X-Studio-Enabled': 'false' })).status,
  ).toBe(403);
  for (const body of [
    { ...turn, model: 'https://evil.test/?key=secret' },
    { ...turn, messages: [{ role: 'tool', callId: 'missing', content: 'ok' }] },
    { ...turn, messages: [{ role: 'assistant', content: '', calls: [call] }] },
    { ...turn, provider: '__proto__' },
  ])
    expect((await post('turn', body)).status).toBe(400);
  expect(fetcher).not.toHaveBeenCalled();
});
it('Cursor launch uses explicit repository and safe branch/PR options', async () => {
  const { post, fetcher } = await fixture();
  const r = await post(
    'cursor',
    {
      action: 'launch',
      repository: 'https://github.com/owner/repo',
      ref: 'main',
      prompt: 'Review recorded defaults',
    },
    { Authorization: 'Bearer cursor-key' },
  );
  expect(r.status).toBe(200);
  const [url, init] = vi.mocked(fetcher).mock.calls[0];
  expect(url).toBe('https://api.cursor.com/v1/agents');
  const body = JSON.parse(init!.body as string);
  expect(body.autoCreatePR).toBe(false);
  expect(body.workOnCurrentBranch).toBe(false);
  expect(body.repos[0].startingRef).toBe('main');
  expect(
    (
      await post(
        'cursor',
        {
          action: 'launch',
          repository: 'file:///tmp',
          ref: 'main',
          prompt: 'x',
        },
        { Authorization: 'Bearer cursor-key' },
      )
    ).status,
  ).toBe(400);
});
