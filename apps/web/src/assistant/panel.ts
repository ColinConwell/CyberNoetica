import './studio.css';
import { el, glassButton } from '../ui/components.js';
import { field, selectControl } from '../ui/journey-controls.js';
import { Z_INDEX } from '../ui/constants.js';
import { getGlobals } from '../globals.js';
import { PROVIDERS, parseTool } from './protocol.js';
import type {
  Provider,
  AgentMessage,
  AgentReply,
  Operation,
} from './protocol.js';
import { createStudioRuntime, MUTATIONS } from './runtime.js';
import { creationEntries, saveCreation, registerRecipe } from './recipe.js';
import { handoffMarkdown, recordSession } from '../developer/session.js';
import type { Annotation } from '../developer/session.js';
let annotations: () => Annotation[] = () => [];
export function setAgentAnnotationsProvider(provider: () => Annotation[]) {
  annotations = provider;
}
const download = (name: string, text: string) => {
  const url = URL.createObjectURL(
    new Blob([text], {
      type: name.endsWith('.json') ? 'application/json' : 'text/markdown',
    }),
  );
  el('a', {}, { href: url, download: name }).click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};
function text(value: string, className = '') {
  const p = el('p', {});
  p.textContent = value;
  p.className = className;
  return p;
}
function button(label: string, action: () => void) {
  const b = glassButton(label);
  b.onclick = action;
  return b;
}
interface Config {
  local: boolean;
  providers: Array<{
    id: Provider;
    label: string;
    model: string;
    localKeyAvailable: boolean;
  }>;
  maxRounds: number;
}
export function mountAssistant(): () => void {
  const root = el(
    'aside',
    {},
    { 'aria-label': 'AI studio', 'data-debug-scope': 'ai-studio' },
  );
  root.className = 'dev-workbench ai-studio';
  root.style.zIndex = String(Z_INDEX.agentPanel);
  root.hidden = true;
  const launch = button('✦ AI studio', () => {
    root.hidden = false;
    enable.focus();
  });
  launch.className += ' ai-launch';
  launch.style.zIndex = String(Z_INDEX.developerLauncher);
  const header = el('header', {});
  header.className = 'dev-header';
  const title = el('div', {});
  title.className = 'dev-title';
  const h = el('h2', {});
  h.textContent = 'AI studio';
  title.append(
    h,
    button('Close', () => {
      root.hidden = true;
      launch.focus();
    }),
  );
  const enable = el(
    'input',
    {},
    { type: 'checkbox', 'aria-label': 'Enable AI assistants' },
  );
  header.append(
    text('CYBERNOETICA / COLLABORATE', 'dev-eyebrow'),
    title,
    field('Enable AI assistants', enable),
  );
  const body = el('div', {});
  body.className = 'ai-body';
  const off = text(
    'Assistants are off. Enable to connect a provider, tune the running visualizer, or create a new one.',
    'ai-off',
  );
  const content = el('div', {});
  content.hidden = true;
  const status = text('Off', 'dev-status');
  status.setAttribute('role', 'status');
  body.append(off, content);
  root.append(header, body, status);
  document.body.append(launch, root);
  let config: Config | undefined,
    history: AgentMessage[] = [],
    controller: AbortController | null = null,
    generation = 0,
    pendingDecision: ((approved: boolean) => void) | null = null;
  let provider: Provider = 'openai';
  let mode: 'debug' | 'create' = 'debug';
  let busy = false;
  const providerSelect = selectControl(
    Object.entries(PROVIDERS).map(([id, p]) => [id, p.label]),
    provider,
    (value) => {
      resetSession();
      provider = value as Provider;
      model.value = PROVIDERS[provider].model;
      apiKey.value = '';
      renderProvider();
    },
  );
  providerSelect.setAttribute('aria-label', 'AI provider');
  const model = el(
    'input',
    {},
    {
      'aria-label': 'Model identifier',
      value: PROVIDERS.openai.model,
      spellcheck: 'false',
    },
  );
  const apiKey = el(
    'input',
    {},
    {
      type: 'password',
      'aria-label': 'Provider API key',
      autocomplete: 'off',
      placeholder: 'Session-only API key',
    },
  );
  model.addEventListener('change', resetSession);
  apiKey.addEventListener('input', () => {
    if (busy) stop();
    history = [];
  });
  const keyNote = text('', 'dev-muted');
  const modeSelect = selectControl(
    [
      ['debug', 'Debug & improve'],
      ['create', 'Create a visualizer'],
    ],
    'debug',
    (value) => {
      resetSession();
      mode = value as typeof mode;
      prompt.placeholder =
        mode === 'create'
          ? 'Describe a new visualizer: shape, movement, palette and audio response…'
          : 'What should change? e.g. reduce the glow and explain the change.';
    },
  );
  modeSelect.setAttribute('aria-label', 'Assistant mode');
  const live = el(
    'input',
    {},
    { type: 'checkbox', 'aria-label': 'Allow live edits' },
  );
  const limits = text(
    'Up to 6 model rounds per request. Configuration and your messages go through this server to the selected provider. Keys are never saved in browser storage.',
    'dev-muted',
  );
  const settings = el('details', {});
  settings.open = true;
  const settingsSummary = el('summary', {});
  settingsSummary.textContent = 'Connection & permissions';
  settings.append(
    settingsSummary,
    field('Provider', providerSelect),
    field('Model', model),
    field('API key', apiKey),
    keyNote,
    field('Mode', modeSelect),
    field('Allow live edits', live),
    text(
      'With live edits off, review and apply proposed changes. Read-only inspection and fixed checks run immediately. Source edits are recorded for handoff.',
      'dev-muted',
    ),
    limits,
  );
  const chat = el(
    'div',
    {},
    { 'aria-label': 'Assistant conversation', role: 'log' },
  );
  chat.className = 'ai-chat';
  const proposal = el('div', {});
  proposal.className = 'ai-proposal';
  proposal.hidden = true;
  const prompt = el(
    'textarea',
    {},
    {
      'aria-label': 'Message to assistant',
      placeholder:
        'What should change? e.g. reduce the glow and explain the change.',
      maxlength: '10000',
    },
  );
  const send = button('Send', () => void run());
  const stopButton = button('Stop', () => stop());
  stopButton.disabled = true;
  const undo = button('Undo last live edit', () => {
    void runtime
      .undo()
      .then(() => {
        append('tool', 'Last live edit undone.');
        renderGallery();
        setBusy(false);
      })
      .catch((e) => (status.textContent = String(e)));
  });
  const actions = el('div', {});
  actions.className = 'dev-toolbar';
  actions.append(
    send,
    stopButton,
    undo,
    button('New conversation', resetSession),
    button('Export conversation', () =>
      download(
        'cybernoetica-conversation.md',
        history
          .filter((m) => m.role !== 'tool')
          .map((m) => `## ${m.role}\n\n${m.content}`)
          .join('\n\n'),
      ),
    ),
  );
  const handoffs = el('div', {});
  const gallery = el('details', {});
  const galleryHeading = el('summary', {});
  galleryHeading.textContent = 'Your creations';
  const galleryBody = el('div', {});
  gallery.append(galleryHeading, galleryBody);
  const cursor = el('div', {});
  cursor.hidden = true;
  const repository = el(
    'input',
    {},
    {
      'aria-label': 'Cursor GitHub repository',
      placeholder: 'https://github.com/owner/repository',
    },
  );
  const ref = el(
    'input',
    {},
    { 'aria-label': 'Cursor starting branch', placeholder: 'Branch or ref' },
  );
  const cursorPrompt = el(
    'textarea',
    {},
    {
      'aria-label': 'Cursor handoff request',
      placeholder: 'Describe the repository change.',
    },
  );
  const cursorStatus = text('');
  let cursorId = '';
  cursor.append(
    text(
      'Cursor runs a repository agent outside this page. Launch starts a remote task. It will not auto-create a pull request or work directly on the starting branch.',
      'dev-muted',
    ),
    field('Repository', repository),
    field('Starting branch', ref),
    cursorPrompt,
    button('Use current state handoff', () => {
      cursorPrompt.value = handoffMarkdown(recordSession(annotations()));
    }),
    button('Check Cursor models', () => {
      void cursorAction({ action: 'models' });
    }),
    button('Launch Cursor handoff', () => {
      void cursorAction({
        action: 'launch',
        repository: repository.value,
        ref: ref.value,
        prompt: cursorPrompt.value,
      });
    }),
    button('Refresh Cursor status', () => {
      if (cursorId) void cursorAction({ action: 'status', id: cursorId });
      else cursorStatus.textContent = 'Launch a handoff first.';
    }),
    cursorStatus,
  );
  content.append(
    settings,
    cursor,
    chat,
    proposal,
    prompt,
    actions,
    handoffs,
    gallery,
  );
  async function request(
    path: string,
    payload: unknown,
    signal: AbortSignal,
  ): Promise<any> {
    const key = apiKey.value.trim();
    const response = await fetch(`/api/assistant/${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Studio-Enabled': 'true',
        ...(key ? { Authorization: `Bearer ${key}` } : {}),
      },
      body: JSON.stringify(payload),
      signal,
    });
    const data = await response
      .json()
      .catch(() => ({ error: 'Assistant endpoint unavailable.' }));
    if (!response.ok)
      throw new Error(data.error ?? `Request failed (${response.status}).`);
    return data;
  }
  const runtime = createStudioRuntime({
    annotations: () => annotations(),
    serverTool: (operation, payload, signal) =>
      request(operation, payload, signal),
    handoff: (markdown) => {
      const row = el('div', {});
      row.className = 'ai-handoff';
      row.append(
        text('Source-edit handoff ready.'),
        button('Download handoff', () =>
          download('cybernoetica-agent-handoff.md', markdown),
        ),
      );
      handoffs.append(row);
    },
  });
  function append(role: string, message: string) {
    if (!message) return;
    const row = el('article', {});
    row.dataset.role = role;
    row.append(text(role.toUpperCase(), 'ai-role'));
    if (role === 'tool' && message.includes(': {')) {
      const split = message.indexOf(': {');
      const details = el('details', {});
      const summary = el('summary', {});
      summary.textContent =
        message.slice(0, split).replaceAll('_', ' ') + ' · result';
      const pre = el('pre', {});
      pre.textContent = message.slice(split + 2);
      details.append(summary, pre);
      row.append(details);
    } else row.append(text(message));
    chat.append(row);
    while (chat.childElementCount > 60) chat.firstElementChild?.remove();
    row.scrollIntoView({ block: 'nearest' });
  }
  function setBusy(value: boolean) {
    busy = value;
    send.disabled = value;
    stopButton.disabled = !value;
    providerSelect.disabled = value;
    modeSelect.disabled = value || provider === 'cursor';
    model.disabled = value || provider === 'cursor';
    undo.disabled = value || !runtime.hasUndo();
  }
  setBusy(false);
  function stop() {
    generation++;
    controller?.abort();
    controller = null;
    pendingDecision?.(false);
    pendingDecision = null;
    proposal.hidden = true;
    history = [];
    setBusy(false);
    status.textContent =
      'Stopped. Live edits already applied remain available to undo.';
  }
  function resetSession() {
    stop();
    history = [];
    chat.replaceChildren();
    status.textContent = enable.checked ? 'New conversation.' : 'Off';
  }
  function renderProvider() {
    const p = config?.providers.find((p) => p.id === provider);
    keyNote.textContent =
      config?.local && p?.localKeyAvailable
        ? 'Local .env.local key available on the server. Leave the key field empty to use it.'
        : 'Enter your provider key. It stays in memory for this session and is sent only to this server and the selected provider.';
    const isCursor = provider === 'cursor';
    cursor.hidden = !isCursor;
    for (const element of [chat, proposal, prompt, actions])
      element.hidden = isCursor;
    if (!isCursor) proposal.hidden = true;
    modeSelect.disabled = isCursor;
    model.disabled = isCursor;
    status.textContent = `Ready · ${PROVIDERS[provider].label}`;
  }
  function renderGallery() {
    galleryBody.replaceChildren();
    for (const creation of creationEntries()) {
      const row = el('div', {});
      row.className = 'ai-handoff';
      row.append(
        text(creation.recipe.name),
        button('Preview', () => {
          if (!busy)
            void getGlobals()
              ?.selectVisualizer?.(creation.type)
              .then(
                () =>
                  (status.textContent = `Previewing ${creation.recipe.name}`),
              );
        }),
        button('Save locally', () => {
          try {
            saveCreation(creation.type);
            status.textContent = 'Creation saved on this device.';
          } catch (e) {
            status.textContent = String(e);
          }
        }),
        button('Export recipe', () =>
          download(
            `${creation.type}.json`,
            JSON.stringify(creation.recipe, null, 2),
          ),
        ),
      );
      galleryBody.append(row);
    }
  }
  const importFile = el(
    'input',
    {},
    {
      type: 'file',
      accept: '.json,application/json',
      'aria-label': 'Import visualizer recipe',
    },
  );
  importFile.hidden = true;
  importFile.onchange = async () => {
    try {
      const f = importFile.files?.[0];
      if (!f) return;
      if (f.size > 40000) throw new Error('Recipe must be under 40 KB.');
      const creation = registerRecipe(JSON.parse(await f.text()));
      await getGlobals()?.selectVisualizer?.(creation.type);
      renderGallery();
    } catch (e) {
      status.textContent = String(e);
    } finally {
      importFile.value = '';
    }
  };
  gallery.append(
    button('Import recipe', () => importFile.click()),
    importFile,
  );
  async function approve(
    operation: Operation,
    payload: Record<string, unknown>,
    signal: AbortSignal,
  ): Promise<boolean> {
    if (live.checked) return true;
    proposal.replaceChildren(text(`Proposed live edit · ${operation}`));
    const pre = el('pre', {});
    pre.textContent = JSON.stringify(payload, null, 2);
    proposal.append(pre);
    proposal.hidden = false;
    return new Promise((resolve) => {
      const finish = (value: boolean) => {
        signal.removeEventListener('abort', cancel);
        pendingDecision = null;
        proposal.hidden = true;
        resolve(value);
      };
      const cancel = () => finish(false);
      pendingDecision = finish;
      signal.addEventListener('abort', cancel, { once: true });
      proposal.append(
        button('Apply proposed edit', () => finish(true)),
        button('Decline', () => finish(false)),
      );
      proposal.scrollIntoView({ block: 'nearest' });
    });
  }
  async function run() {
    if (
      !enable.checked ||
      busy ||
      provider === 'cursor' ||
      !prompt.value.trim()
    )
      return;
    const input = prompt.value.trim();
    prompt.value = '';
    history.push({ role: 'user', content: input });
    append('you', input);
    const runId = ++generation;
    controller = new AbortController();
    const signal = controller.signal;
    setBusy(true);
    let expected = runtime.fingerprint();
    try {
      for (let round = 0; round < 6; round++) {
        if (history.length > 38)
          throw new Error(
            'Conversation limit reached. Export it and start a new conversation.',
          );
        status.textContent = `${PROVIDERS[provider].label} · working (${round + 1}/6)…`;
        const reply: AgentReply = await request(
          'turn',
          {
            provider,
            model: model.value.trim(),
            mode,
            messages: history,
            context: runtime.snapshot(),
          },
          signal,
        );
        if (signal.aborted || runId !== generation) return;
        history.push({
          role: 'assistant',
          content: reply.text,
          calls: reply.calls,
          reasoning: reply.reasoning,
        });
        append('assistant', reply.text);
        if (!reply.calls.length) {
          status.textContent = `Complete${reply.usage ? ` · ${reply.usage.input} input / ${reply.usage.output} output tokens in last round` : ''}`;
          return;
        }
        for (const call of reply.calls) {
          let output: unknown;
          try {
            const { operation, payload } = parseTool(call);
            if (
              MUTATIONS.has(operation) &&
              !(await approve(operation, payload, signal))
            )
              output = {
                declined: true,
                message:
                  'The user declined or stopped this edit. Do not retry it.',
              };
            else {
              if (signal.aborted || runId !== generation) return;
              output = await runtime.execute(
                operation,
                payload,
                signal,
                expected,
              );
              if (MUTATIONS.has(operation)) expected = runtime.fingerprint();
            }
            append(
              'tool',
              `${operation}: ${typeof output === 'object' && output !== null && 'declined' in output ? 'declined' : JSON.stringify(output).slice(0, 1400)}`,
            );
            renderGallery();
          } catch (e) {
            output = { error: e instanceof Error ? e.message : String(e) };
            append('tool', JSON.stringify(output));
          }
          if (signal.aborted || runId !== generation) return;
          history.push({
            role: 'tool',
            content: JSON.stringify(output).slice(0, 28000),
            callId: call.id,
          });
        }
      }
      status.textContent =
        'Stopped after 6 rounds. Send a follow-up to continue.';
    } catch (e) {
      if (!signal.aborted) {
        status.textContent = e instanceof Error ? e.message : String(e);
        append('error', status.textContent);
        history = [];
      }
    } finally {
      if (runId === generation) {
        controller = null;
        setBusy(false);
      }
    }
  }
  async function cursorAction(payload: unknown) {
    if (!enable.checked || busy) return;
    const runId = ++generation;
    controller = new AbortController();
    setBusy(true);
    try {
      const result = await request('cursor', payload, controller.signal);
      if (runId !== generation) return;
      cursorStatus.replaceChildren(text(JSON.stringify(result, null, 2)));
      if (result.id) cursorId = result.id;
      if (
        typeof result.url === 'string' &&
        /^https:\/\/cursor.com\//.test(result.url)
      ) {
        const link = el(
          'a',
          {},
          { href: result.url, target: '_blank', rel: 'noopener noreferrer' },
        );
        link.textContent = 'Open Cursor task';
        cursorStatus.append(link);
      }
    } catch (e) {
      cursorStatus.textContent = e instanceof Error ? e.message : String(e);
    } finally {
      if (runId === generation) setBusy(false);
    }
  }
  enable.onchange = () => {
    if (!enable.checked) {
      stop();
      apiKey.value = '';
      live.checked = false;
      history = [];
      chat.replaceChildren();
      content.hidden = true;
      off.hidden = false;
      status.textContent = 'Off · session key cleared';
      return;
    }
    content.hidden = false;
    off.hidden = true;
    const epoch = ++generation;
    status.textContent = 'Checking provider configuration…';
    void fetch('/api/assistant/config')
      .then(async (response) => {
        if (!response.ok) throw new Error('Assistant endpoint unavailable.');
        return response.json();
      })
      .then((value: Config) => {
        if (epoch !== generation || !enable.checked) return;
        config = value;
        renderProvider();
        renderGallery();
      })
      .catch((e) => (status.textContent = String(e)));
  };
  const open = () => {
    root.hidden = false;
    enable.focus();
  };
  window.addEventListener('cybernoetica:assistant', open);
  const keys = (event: KeyboardEvent) => {
    if (event.key === 'Escape' && !root.hidden) {
      event.stopPropagation();
      root.hidden = true;
      launch.focus();
    }
  };
  root.addEventListener('keydown', keys);
  prompt.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      void run();
    }
  });
  return () => {
    stop();
    apiKey.value = '';
    history = [];
    window.removeEventListener('cybernoetica:assistant', open);
    root.remove();
    launch.remove();
  };
}
