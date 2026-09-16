import express from 'express';
import { resolve } from 'node:path';
import { readFileSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { PROVIDERS } from '../src/assistant/protocol.js';
import type { AgentMessage, Provider } from '../src/assistant/protocol.js';
import {
  localKeys,
  ProviderError,
  requestProvider,
  cursorRequest,
} from './agent-providers.js';
import { localRequest, sourceLocation } from './developer.js';

export interface AgentRouterOptions {
  developmentRoot?: string;
  fetcher?: typeof fetch;
}
function validateHistory(value: unknown): AgentMessage[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 48)
    throw new ProviderError(
      400,
      'Conversation must contain 1–48 messages. Start a new conversation if full.',
    );
  const history: AgentMessage[] = [];
  const pending = new Set<string>();
  for (const item of value) {
    if (
      !item ||
      !['user', 'assistant', 'tool'].includes(item.role) ||
      typeof item.content !== 'string' ||
      item.content.length > 30000
    )
      throw new ProviderError(400, 'Invalid conversation message.');
    if (item.role === 'tool') {
      if (typeof item.callId !== 'string' || !pending.delete(item.callId))
        throw new ProviderError(400, 'Unexpected tool result.');
      history.push({
        role: 'tool',
        content: item.content,
        callId: item.callId,
      });
      continue;
    }
    if (pending.size) throw new ProviderError(400, 'Missing tool result.');
    const message: AgentMessage = { role: item.role, content: item.content };
    if (item.calls !== undefined) {
      if (
        item.role !== 'assistant' ||
        !Array.isArray(item.calls) ||
        item.calls.length > 8
      )
        throw new ProviderError(400, 'Invalid tool calls.');
      message.calls = item.calls.map((c: any) => {
        if (
          typeof c.id !== 'string' ||
          c.id.length > 200 ||
          c.name !== 'studio_tool' ||
          typeof c.arguments !== 'string' ||
          c.arguments.length > 40000 ||
          pending.has(c.id)
        )
          throw new ProviderError(400, 'Invalid tool call.');
        pending.add(c.id);
        return { id: c.id, name: c.name, arguments: c.arguments };
      });
    }
    if (item.reasoning !== undefined) {
      if (
        item.role !== 'assistant' ||
        !Array.isArray(item.reasoning) ||
        item.reasoning.length > 8
      )
        throw new ProviderError(400, 'Invalid continuation.');
      message.reasoning = item.reasoning.map((r: any) => {
        if (
          r.type !== 'reasoning' ||
          typeof r.id !== 'string' ||
          (r.encrypted_content !== undefined &&
            typeof r.encrypted_content !== 'string')
        )
          throw new ProviderError(400, 'Invalid reasoning continuation.');
        return {
          type: 'reasoning',
          id: r.id,
          encrypted_content: r.encrypted_content,
          summary: [],
        };
      });
    }
    history.push(message);
  }
  if (pending.size) throw new ProviderError(400, 'Missing tool result.');
  return history;
}
export function createAgentRouter(
  options: AgentRouterOptions = {},
): express.Router {
  const router = express.Router(),
    fetcher = options.fetcher ?? fetch;
  // Deliberately never load server/provider environment keys in deployed mode.
  const keys = options.developmentRoot
    ? localKeys(options.developmentRoot)
    : {};
  const rates = new Map<string, { count: number; until: number }>();
  let inFlight = 0,
    testRunning = false;
  router.use((req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    if (options.developmentRoot && !localRequest(req)) {
      res.status(403).json({ error: 'Local development only.' });
      return;
    }
    if (req.method !== 'GET') {
      let sameOrigin = false;
      try {
        const u = new URL(req.headers.origin ?? '');
        sameOrigin =
          u.host === req.headers.host &&
          ['http:', 'https:'].includes(u.protocol);
      } catch {
        /* invalid origin */
      }
      if (!sameOrigin || req.headers['x-studio-enabled'] !== 'true') {
        res.status(403).json({
          error: 'Enable the assistant in this browser session first.',
        });
        return;
      }
    }
    next();
  });
  router.use(express.json({ limit: '256kb' }));
  router.get('/config', (_req, res) =>
    res.json({
      local: Boolean(options.developmentRoot),
      providers: Object.entries(PROVIDERS).map(([id, p]) => ({
        id,
        ...p,
        localKeyAvailable: Boolean(keys[id as Provider]),
      })),
      maxRounds: 6,
    }),
  );
  const handle =
    (
      fn: (
        req: express.Request,
        res: express.Response,
        signal: AbortSignal,
      ) => Promise<void>,
    ): express.RequestHandler =>
    async (req, res) => {
      const controller = new AbortController(),
        timer = setTimeout(() => controller.abort(), 90000);
      const close = () => {
        if (!res.writableEnded) controller.abort();
      };
      res.on('close', close);
      try {
        await fn(req, res, controller.signal);
      } catch (error) {
        if (!res.destroyed && !res.headersSent)
          res
            .status(
              error instanceof ProviderError
                ? Math.min(599, Math.max(400, error.status))
                : controller.signal.aborted
                  ? 504
                  : 500,
            )
            .json({
              error:
                error instanceof ProviderError
                  ? error.message
                  : controller.signal.aborted
                    ? 'Request stopped or timed out.'
                    : 'Assistant request failed. No changes were applied by this request.',
            });
      } finally {
        clearTimeout(timer);
        res.off('close', close);
      }
    };
  const credential = (req: express.Request, provider: Provider) => {
    const header = req.headers.authorization;
    if (header && (!header.startsWith('Bearer ') || header.length > 520))
      throw new ProviderError(400, 'Invalid API key header.');
    const key = header?.slice(7) || keys[provider];
    if (!key)
      throw new ProviderError(401, 'Enter an API key for this provider.');
    if (/[\r\n]/.test(key)) throw new ProviderError(400, 'Invalid API key.');
    return key;
  };
  const rate = (key: string) => {
    const now = Date.now();
    for (const [k, v] of rates) if (v.until < now) rates.delete(k);
    const id = createHash('sha256').update(key).digest('hex');
    const entry = rates.get(id) ?? { count: 0, until: now + 60000 };
    if (entry.count >= 24 || inFlight >= 4 || rates.size >= 2000)
      throw new ProviderError(429, 'Assistant is busy. Retry in a minute.');
    entry.count++;
    rates.set(id, entry);
  };
  router.post(
    '/turn',
    handle(async (req, res, signal) => {
      const { provider, model, messages, context, mode } = req.body ?? {};
      if (
        typeof provider !== 'string' ||
        !Object.hasOwn(PROVIDERS, provider) ||
        provider === 'cursor'
      )
        throw new ProviderError(400, 'Choose a supported chat provider.');
      if (typeof model !== 'string' || !/^[\w./:@-]{1,160}$/.test(model))
        throw new ProviderError(400, 'Invalid model identifier.');
      if (
        !['debug', 'create'].includes(mode) ||
        !context ||
        typeof context !== 'object'
      )
        throw new ProviderError(400, 'Invalid assistant context.');
      const history = validateHistory(messages),
        key = credential(req, provider as Provider);
      rate(key);
      inFlight++;
      try {
        res.json(
          await requestProvider(
            provider as Provider,
            model,
            key,
            history,
            context,
            mode,
            signal,
            fetcher,
          ),
        );
      } finally {
        inFlight--;
      }
    }),
  );
  router.post(
    '/source',
    handle(async (req, res) => {
      if (!options.developmentRoot)
        throw new ProviderError(
          404,
          'Source tools are available only in local development.',
        );
      const location = sourceLocation(
        options.developmentRoot,
        String(req.body?.target ?? ''),
        String(req.body?.key ?? ''),
      );
      const lines = readFileSync(location.path, 'utf8').split('\n'),
        start = Math.max(0, location.line - 8);
      res.json({
        ...location,
        excerpt: lines
          .slice(start, start + 70)
          .map((line, i) => `${start + i + 1}: ${line}`)
          .join('\n'),
      });
    }),
  );
  router.post(
    '/test',
    handle(async (req, res, signal) => {
      const root = options.developmentRoot;
      if (!root)
        throw new ProviderError(
          404,
          'Test scripts are available only in local development.',
        );
      const suites: Record<string, string[]> = {
        studio: [
          'src/__tests__/assistant-runtime.test.ts',
          'server/agent-providers.test.ts',
        ],
        handoff: [
          'src/__tests__/developer-session.test.ts',
          'server/developer.test.ts',
        ],
      };
      const suite = req.body?.suite;
      if (typeof suite !== 'string' || !Object.hasOwn(suites, suite))
        throw new ProviderError(400, 'Unknown test suite.');
      if (testRunning)
        throw new ProviderError(429, 'A test suite is already running.');
      testRunning = true;
      try {
        const result = await new Promise<{ passed: boolean; output: string }>(
          (resolveResult) => {
            execFile(
              process.execPath,
              [
                resolve(root, 'apps/web/node_modules/vitest/vitest.mjs'),
                'run',
                ...suites[suite],
              ],
              {
                cwd: resolve(root, 'apps/web'),
                timeout: 30000,
                maxBuffer: 128000,
                signal,
                env: {
                  PATH: process.env.PATH,
                  TMPDIR: process.env.TMPDIR,
                  HOME: process.env.HOME,
                  CI: '1',
                  NO_COLOR: '1',
                },
              },
              (error, stdout, stderr) =>
                resolveResult({
                  passed: !error,
                  output: (stdout + '\n' + stderr).slice(-16000),
                }),
            );
          },
        );
        res.json(result);
      } finally {
        testRunning = false;
      }
    }),
  );
  router.post(
    '/cursor',
    handle(async (req, res, signal) => {
      const key = credential(req, 'cursor');
      rate(key);
      const { action, id, prompt, repository, ref } = req.body ?? {};
      if (action === 'models') {
        const data = await cursorRequest(
          key,
          'GET',
          '/models',
          undefined,
          signal,
          fetcher,
        );
        res.json({ models: data.models ?? data.items ?? [] });
        return;
      }
      if (
        action === 'status' &&
        typeof id === 'string' &&
        /^[\w-]{1,160}$/.test(id)
      ) {
        const data = await cursorRequest(
          key,
          'GET',
          `/agents/${id}`,
          undefined,
          signal,
          fetcher,
        );
        res.json({
          id: data.id ?? data.agent?.id,
          status: data.status ?? data.agent?.status,
          url: data.url ?? data.agent?.url,
        });
        return;
      }
      if (
        action !== 'launch' ||
        typeof prompt !== 'string' ||
        !prompt.trim() ||
        prompt.length > 60000 ||
        typeof repository !== 'string' ||
        !/^https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/?$/.test(repository) ||
        typeof ref !== 'string' ||
        !/^[\w./-]{1,160}$/.test(ref)
      )
        throw new ProviderError(
          400,
          'Specify a GitHub repository, branch and handoff prompt.',
        );
      const data = await cursorRequest(
        key,
        'POST',
        '/agents',
        {
          prompt: { text: prompt },
          repos: [{ url: repository, startingRef: ref }],
          autoCreatePR: false,
          workOnCurrentBranch: false,
        },
        signal,
        fetcher,
      );
      res.json({
        id: data.id ?? data.agent?.id,
        status: data.status ?? data.agent?.status,
        url: data.url ?? data.agent?.url,
      });
    }),
  );
  return router;
}
