import { setAgentAnnotationsProvider } from '../assistant/panel.js';
import { describeTarget } from './target.js';
import './workbench.css';
import { el, glassButton, paramSlider } from '../ui/components.js';
import {
  field,
  selectControl,
  numberControl,
  renderJourneyControls,
} from '../ui/journey-controls.js';
import { renderSoundscapeControls } from '../ui/soundscape-controls.js';
import { getLogEntries, onLog } from '../ui/log-display.js';
import type { LogLevel } from '../ui/log-display.js';
import { getGlobals } from '../globals.js';
import {
  getMenuPreferences,
  menuLayoutPicker,
  setMenuPreferences,
  applyMenuPreferences,
} from '../ui/menu-layout.js';
import {
  recordSession,
  restoreVisualizer,
  visualizerConfiguration,
  handoffMarkdown,
  matchesControl,
} from './session.js';
import type { Annotation, Recording } from './session.js';
import type { Visualizer } from '@cybernoetica/renderer';
import { Z_INDEX } from '../ui/constants.js';

function saveFile(name: string, text: string, type = 'application/json') {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = el('a', {}, { href: url, download: name });
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function paragraph(text: string, className = 'dev-muted') {
  const p = el('p', {});
  p.className = className;
  p.textContent = text;
  return p;
}
function button(label: string, action: () => void): HTMLButtonElement {
  const b = glassButton(label);
  b.type = 'button';
  b.onclick = action;
  return b;
}

export function mountDeveloperWorkbench(): () => void {
  applyMenuPreferences();
  const globals = getGlobals();
  if (!globals) return () => {};
  const g = globals;
  const root = el(
    'aside',
    {},
    { 'aria-label': 'Developer workbench', 'data-debug-scope': 'workbench' },
  );
  root.className = 'dev-workbench';
  root.style.zIndex = String(Z_INDEX.developerPanel);
  root.id = 'developer-workbench';
  root.hidden = true;
  const launch = button('◈ Developer', () => open());
  launch.className += ' dev-launch';
  launch.setAttribute('aria-controls', root.id);
  launch.setAttribute('aria-expanded', 'false');
  launch.style.zIndex = String(Z_INDEX.developerLauncher);
  const header = el('header', {});
  header.className = 'dev-header';
  const eyebrow = paragraph('Cybernoetica / Studio', 'dev-eyebrow');
  const title = el('div', {});
  title.className = 'dev-title';
  const heading = el('h2', {});
  heading.textContent = 'Developer workbench';
  const close = button('Close', () => hide());
  title.append(heading, close);
  const subtitle = paragraph(
    'Inspect, tune, annotate, hand off.',
    'dev-subtitle',
  );
  const search = el(
    'input',
    {},
    {
      type: 'search',
      'aria-label': 'Search developer controls',
      placeholder: 'Find a control… “brighter”, “camera”, “bass”',
    },
  );
  const toolbar = el('div', {});
  toolbar.className = 'dev-toolbar';
  const body = el('div', {});
  body.className = 'dev-sections';
  const status = paragraph(
    'Ready. Changes affect the running session.',
    'dev-status',
  );
  status.setAttribute('role', 'status');
  header.append(eyebrow, title, subtitle, search, toolbar);
  root.append(header, body, status);
  document.body.append(launch, root);
  const sections = new Map<string, HTMLDetailsElement>();
  const cleanups: Array<() => void> = [];
  const annotations: Annotation[] = [];
  setAgentAnnotationsProvider(() => structuredClone(annotations));
  let lastRecording: Recording | null = null;
  let active: Visualizer | null | undefined;
  let soundActive = false,
    journeyActive = false;
  let journeyCleanup: (() => void) | undefined;
  let selecting = false;
  let canvasOnly = false;
  const pickerHint = paragraph(
    'Click a canvas point to annotate. Escape cancels.',
    'dev-picker-hint',
  );
  pickerHint.style.zIndex = String(Z_INDEX.developerHighlight);
  pickerHint.hidden = true;
  document.body.append(pickerHint);
  let target = {
    selector: 'canvas',
    target: 'visualizer',
    point: undefined as Annotation['point'],
    selectorStrategy: 'canvas' as Annotation['selectorStrategy'],
  };
  let returnFocus: HTMLElement | null = null;
  const highlight = el('div', {});
  highlight.className = 'dev-highlight';
  highlight.style.zIndex = String(Z_INDEX.developerHighlight);
  highlight.hidden = true;
  document.body.append(highlight);
  let preferences: {
    order?: string[];
    closed?: string[];
    layout?: string;
    theme?: string;
  } = {};
  try {
    preferences = JSON.parse(
      localStorage.getItem('cybernoetica:workbench:v1') ?? '{}',
    );
  } catch {
    /* defaults */
  }
  function persist() {
    if (search.value) return;
    try {
      localStorage.setItem(
        'cybernoetica:workbench:v1',
        JSON.stringify({
          order: [...body.children].map(
            (e) => (e as HTMLElement).dataset.section,
          ),
          closed: [...sections].filter(([, e]) => !e.open).map(([k]) => k),
          layout: root.dataset.layout,
          theme: root.dataset.theme,
        }),
      );
    } catch {
      /* optional */
    }
  }
  root.dataset.layout = preferences.layout === 'wide' ? 'wide' : 'dock';
  root.dataset.theme = ['amber', 'paper'].includes(preferences.theme ?? '')
    ? preferences.theme
    : 'night';
  const layout = selectControl(
    [
      ['dock', 'Dock'],
      ['wide', 'Workbench'],
    ],
    root.dataset.layout,
    (v) => {
      root.dataset.layout = v;
      persist();
    },
  );
  layout.setAttribute('aria-label', 'Workbench layout');
  const theme = selectControl(
    [
      ['night', 'Midnight'],
      ['amber', 'Ember'],
      ['paper', 'Paper'],
    ],
    root.dataset.theme ?? 'night',
    (v) => {
      root.dataset.theme = v;
      persist();
    },
  );
  theme.setAttribute('aria-label', 'Workbench theme');
  toolbar.append(
    layout,
    theme,
    button('Unfold all', () => {
      sections.forEach((d) => (d.open = true));
      persist();
    }),
    button('Fold all', () => {
      sections.forEach((d) => (d.open = false));
      persist();
    }),
  );
  function section(id: string, name: string): HTMLElement {
    const d = el('details', {});
    d.className = 'dev-section';
    d.dataset.section = id;
    d.dataset.controlId = `developer:${id}`;
    d.open = !(preferences.closed ?? []).includes(id);
    const summary = el('summary', {});
    summary.textContent = name;
    const order = el('span', {});
    order.className = 'dev-order';
    const up = button('↑', () => {
      if (d.previousElementSibling)
        body.insertBefore(d, d.previousElementSibling);
      persist();
    });
    up.setAttribute('aria-label', `Move ${name} up`);
    const down = button('↓', () => {
      if (d.nextElementSibling) body.insertBefore(d.nextElementSibling, d);
      persist();
    });
    down.setAttribute('aria-label', `Move ${name} down`);
    for (const b of [up, down])
      b.addEventListener('click', (e) => e.stopPropagation());
    order.append(up, down);
    summary.append(order);
    const content = el('div', {});
    content.dataset.debugScope = id;
    content.className = 'dev-section-body';
    d.append(summary, content);
    body.append(d);
    sections.set(id, d);
    d.addEventListener('toggle', persist);
    return content;
  }
  const capture = section('capture', '01 / Record & annotate');
  capture.append(
    paragraph(
      'Capture a configuration, mark a control or canvas region, and export a concrete change request.',
    ),
  );
  const actions = el('div', {});
  actions.className = 'dev-toolbar';
  const preview = el('pre', {});
  preview.hidden = true;
  const record = () => {
    lastRecording = recordSession(annotations);
    preview.hidden = false;
    preview.textContent = JSON.stringify(lastRecording, null, 2);
    status.textContent = `Recorded ${lastRecording.visualizer.type} at ${new Date(lastRecording.createdAt).toLocaleTimeString()}.`;
  };
  function exportRecording() {
    return lastRecording
      ? { ...lastRecording, annotations: structuredClone(annotations) }
      : recordSession(annotations);
  }
  actions.append(
    button('Record state', record),
    button('Export JSON', () => {
      if (!lastRecording) record();
      saveFile(
        'cybernoetica-session.json',
        JSON.stringify(exportRecording(), null, 2),
      );
    }),
    button('Export handoff', () => {
      const recording = exportRecording();
      saveFile(
        'cybernoetica-handoff.md',
        handoffMarkdown(recording),
        'text/markdown',
      );
    }),
    button('Copy handoff', () => {
      void navigator.clipboard
        .writeText(handoffMarkdown(exportRecording()))
        .then(() => (status.textContent = 'Handoff copied.'))
        .catch(
          () =>
            (status.textContent = 'Clipboard unavailable. Use Export handoff.'),
        );
    }),
    button('Restore recorded visual controls', () => {
      try {
        if (!lastRecording || !active)
          throw new Error('Record a visualizer first.');
        restoreVisualizer(lastRecording, active);
        renderVisualControls();
        status.textContent =
          'Visual controls restored. Soundscape and Journey definitions remain in the export.';
      } catch (e) {
        status.textContent = String(e);
      }
    }),
  );
  const pick = button('Pick annotation target', () => {
    selecting = !selecting;
    pick.textContent = selecting
      ? 'Cancel target picker'
      : 'Pick annotation target';
    status.textContent = selecting
      ? 'Click a control or canvas point. Escape cancels.'
      : 'Picker cancelled.';
  });
  const canvasPick = button('Annotate canvas', () => {
    selecting = true;
    canvasOnly = true;
    root.hidden = true;
    pickerHint.hidden = false;
  });
  const targetLabel = paragraph('Target: active visualizer');
  const intent = selectControl(
    [
      ['issue', 'Issue'],
      ['edit', 'Requested edit'],
      ['default', 'Promote to default'],
    ],
    'issue',
    () => {},
  );
  intent.setAttribute('aria-label', 'Annotation intent');
  const note = el(
    'textarea',
    {},
    {
      'aria-label': 'Annotation text',
      placeholder: 'Describe the desired change and how to verify it.',
      maxlength: '4000',
    },
  );
  const annotationList = el('div', {});
  function renderAnnotations() {
    annotationList.replaceChildren();
    annotations.forEach((a) => {
      const row = el('article', {});
      row.className = 'dev-annotation';
      row.append(
        paragraph(`${a.intent.toUpperCase()} · ${a.target}`),
        paragraph(a.note, ''),
        button('Edit annotation', () => {
          note.value = a.note;
          intent.value = a.intent;
          target = {
            selector: a.selector,
            target: a.target,
            point: a.point,
            selectorStrategy: a.selectorStrategy,
          };
          sourceInfo = a.source ?? null;
          annotations.splice(annotations.indexOf(a), 1);
          renderAnnotations();
          note.focus();
        }),
        button('Remove annotation', () => {
          annotations.splice(annotations.indexOf(a), 1);
          renderAnnotations();
        }),
      );
      annotationList.append(row);
    });
  }
  const add = button('Add annotation', () => {
    if (!note.value.trim()) {
      status.textContent = 'Write an annotation first.';
      return;
    }
    annotations.push({
      id: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
      ...target,
      ...(sourceInfo ? { source: { ...sourceInfo } } : {}),
      note: note.value.trim(),
      intent: intent.value as Annotation['intent'],
      configuration: visualizerConfiguration(g.vizManager?.getActive()),
    });
    note.value = '';
    renderAnnotations();
    status.textContent =
      'Annotation saved for this session. Export to keep it.';
  });
  capture.append(
    actions,
    pick,
    canvasPick,
    targetLabel,
    intent,
    note,
    add,
    annotationList,
    preview,
  );
  const visual = section('visual', '02 / Visualizer controls');
  const sound = section('sound', '03 / Soundscape');
  const journey = section('journey', '04 / Journey');
  const appearance = section('appearance', '05 / Menus & appearance');
  appearance.append(menuLayoutPicker());
  const prefs = getMenuPreferences();
  for (const [key, label, min, max] of [
    ['gap', 'Bubble spacing', 2, 24],
    ['columns', 'Constellation columns', 1, 4],
    ['size', 'Menu text size', 10, 18],
  ] as const)
    appearance.append(
      field(
        label,
        numberControl(prefs[key], min, max, 1, (v) =>
          setMenuPreferences({ [key]: v }),
        ),
      ),
    );
  appearance.append(
    paragraph(
      'Bubbles wrap naturally. Rows stack. Constellation arranges offset-shaped tiles in the selected number of columns.',
    ),
  );
  const logbook = section('logs', '06 / Logbook');
  const logFilters = el('div', {});
  logFilters.className = 'dev-toolbar';
  const levels = new Set<LogLevel>(['info', 'warn', 'error']);
  const logQuery = el(
    'input',
    {},
    {
      type: 'search',
      'aria-label': 'Search logbook',
      placeholder: 'Filter messages',
    },
  );
  const entries = el('div', {});
  entries.className = 'dev-log';
  entries.setAttribute('aria-label', 'Logbook entries');
  let paused = false;
  function renderLogs() {
    if (paused || root.hidden) return;
    entries.replaceChildren();
    for (const entry of getLogEntries()
      .filter(
        (e) =>
          levels.has(e.level) &&
          e.message.toLowerCase().includes(logQuery.value.toLowerCase()),
      )
      .slice(-100)) {
      const row = el('article', {});
      row.dataset.level = entry.level;
      row.textContent = `${new Date(entry.timestamp).toLocaleTimeString()} ${entry.level.toUpperCase()}  ${entry.message}`;
      entries.append(row);
    }
  }
  for (const level of ['debug', 'info', 'warn', 'error'] as const) {
    const check = el('input', {}, { type: 'checkbox' });
    check.checked = levels.has(level);
    check.onchange = () => {
      check.checked ? levels.add(level) : levels.delete(level);
      renderLogs();
    };
    logFilters.append(field(level.toUpperCase(), check));
  }
  const freeze = button('Freeze logbook', () => {
    paused = !paused;
    freeze.textContent = paused ? 'Resume logbook' : 'Freeze logbook';
    renderLogs();
  });
  logFilters.append(freeze);
  logQuery.oninput = renderLogs;
  logbook.append(logFilters, logQuery, entries);
  cleanups.push(onLog(renderLogs));
  const agents = section('agents','08 / AI studio');
  agents.append(paragraph('Inspect and improve with an assistant, or create a new procedural visualizer. Source edits become handoffs.'),button('Open AI studio',()=>window.dispatchEvent(new Event('cybernoetica:assistant'))));
  const source = section('source', '07 / Source & diagnostics');
  const sourceResult = el('pre', {});
  let sourceInfo: { path: string; line: number } | null = null;
  function sourceTarget() {
    if (target.selector.includes('debug-scope=\"sound\"')) return 'soundscape';
    if (target.selector.includes('debug-scope=\"journey\"')) return 'journey';
    if (target.selector.includes('debug-scope=\"appearance\"')) return 'menus';
    return active?.metadata.type ?? '';
  }
  async function locate() {
    const identity = sourceTarget() + ':' + target.target;
    try {
      const result = await fetch(
        `/__dev/source?target=${encodeURIComponent(sourceTarget())}&key=${encodeURIComponent(target.target.startsWith('param:') ? target.target.slice(6) : '')}`,
      );
      if (!result.ok)
        throw new Error('Source lookup requires a local development server.');
      const found = await result.json();
      if (identity !== sourceTarget() + ':' + target.target) return;
      sourceInfo = found;
      sourceResult.textContent = `${sourceInfo!.path}:${sourceInfo!.line}`;
    } catch (e) {
      status.textContent = String(e);
    }
  }
  source.append(
    button('Locate visualizer source', () => void locate()),
    button('Copy path:line', () => {
      void (async () => {
        if (!sourceInfo) await locate();
        if (sourceInfo)
          await navigator.clipboard.writeText(
            `${sourceInfo.path}:${sourceInfo.line}`,
          );
      })().catch(() => (status.textContent = 'Clipboard unavailable.'));
    }),
    button('Reveal in Finder', () => {
      void (async () => {
        const r = await fetch('/__dev/reveal', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ target: sourceTarget() }),
        });
        if (!r.ok) throw new Error('Reveal requires local macOS development.');
        status.textContent = 'Revealed source file.';
      })().catch((e) => (status.textContent = String(e)));
    }),
    sourceResult,
  );
  const diagnostics = el('pre', {});
  source.append(diagnostics);
  function renderVisualControls() {
    visual.replaceChildren();
    if (!active || g.journey?.active) {
      visual.append(
        paragraph(
          'Choose an individual visualizer to tune its metadata controls. Journey contributors are edited below.',
        ),
      );
      return;
    }
    const viz = active;
    visual.append(
      paragraph(
        `${viz.metadata.label} · ${viz.metadata.params.length} appearance/audio controls`,
      ),
    );
    for (const param of viz.metadata.params) {
      const row = paramSlider({
        ...param,
        initial: viz.getUserParams?.()[param.key] ?? param.initial,
        description:
          param.description ?? `${param.label}: ${param.min} to ${param.max}.`,
        onChange: (key, v) => {
          if (g.vizManager?.getActive() === viz) viz.setUserParam(key, v);
        },
      });
      row.dataset.search += ` ${param.category ?? 'appearance'}`;
      visual.append(row);
    }
    for (const f of viz.metadata.viewStateFields) {
      const input = numberControl(
        viz.getViewState()[f.key] ?? 0,
        f.min,
        f.max,
        f.step,
        (v) => {
          if (g.vizManager?.getActive() === viz)
            viz.setViewState({ [f.key]: v });
        },
      );
      input.disabled = Boolean(f.readOnly);
      const row = field(f.label, input);
      row.dataset.controlId = `view:${f.key}`;
      row.dataset.search = `camera view ${f.key} ${f.label}`;
      visual.append(row);
    }
  }
  function renderContexts() {
    const viz = g.vizManager?.getActive();
    if (active !== viz) {
      active = viz;
      sourceInfo = null;
      target = {
        selector: 'canvas',
        target: `visualizer:${viz?.metadata.type ?? ''}`,
        point: undefined,
        selectorStrategy: 'canvas',
      };
      targetLabel.textContent = `Target: ${target.target}`;
      renderVisualControls();
    }
    const isSound = g.journey?.source.sourceType === 'soundscape';
    if (isSound !== soundActive || !sound.childElementCount) {
      soundActive = isSound;
      sound.replaceChildren();
      if (isSound && g.journey) {
        const audio = g.journey.source;
        for (const [key, label, min, max, step] of [
          ['cycleLength', 'Cycle length', 8, 60, 1],
          ['energy', 'Energy', 0, 1, 0.01],
          ['brightness', 'Brightness', 0, 1, 0.01],
          ['beatRate', 'Beat rate', 40, 180, 1],
        ] as const)
          sound.append(
            paramSlider({
              key,
              label,
              min,
              max,
              step,
              initial: audio.getSoundscapeParams()[key],
              onChange: (_k, v) => audio.setSoundscapeParams({ [key]: v }),
            }),
          );
        renderSoundscapeControls(sound, audio);
      } else
        sound.append(
          paragraph(
            'Activate Soundscape Loop in the Sound menu to edit synthesis.',
          ),
        );
    }
    const isJourney = Boolean(g.journey?.active);
    if (isJourney !== journeyActive || !journey.childElementCount) {
      journeyActive = isJourney;
      journeyCleanup?.();
      journey.replaceChildren();
      if (g.journey && isJourney)
        journeyCleanup = renderJourneyControls(
          journey,
          el('div', {}),
          g.journey,
        );
      else
        journey.append(
          paragraph(
            'Activate Journey in the Visual menu to edit route, contributors, transitions, timing and cues.',
          ),
        );
    }
  }
  function syncVisualControls() {
    if (!active) return;
    const params = active.getUserParams?.() ?? {};
    const view = active.getViewState();
    visual.querySelectorAll<HTMLElement>('[data-control-id]').forEach((row) => {
      const [kind, key] = row.dataset.controlId!.split(':');
      const input = row.querySelector<HTMLInputElement>('input');
      if (!input || document.activeElement === input) return;
      const value = (kind === 'view' ? view : params)[key];
      if (!Number.isFinite(value)) return;
      input.value = String(value);
      if (kind === 'param') {
        const display = row.querySelector<HTMLElement>('[data-value-display]');
        if (display)
          display.textContent = String(Math.round(value * 1000) / 1000);
      }
    });
  }
  const applySearch = () => {
    const q = search.value;
    let found = 0;
    for (const [id, d] of sections) {
      const controls = [
        ...d.querySelectorAll<HTMLElement>('[data-search],label'),
      ];
      let hits = 0;
      for (const c of controls) {
        const match = matchesControl(
          q,
          `${id} ${c.dataset.search ?? ''} ${c.textContent} ${[...c.querySelectorAll('input,select')].map((e) => e.getAttribute('aria-label')).join(' ')}`,
        );
        c.hidden = !match;
        if (match) hits++;
      }
      const match = hits > 0 || matchesControl(q, `${id} ${d.textContent}`);
      d.hidden = !match;
      if (match) found++;
      if (q && match) {
        d.open = true;
        d.querySelectorAll<HTMLDetailsElement>(
          'details:not(.control-help)',
        ).forEach((n) => (n.open = true));
      }
    }
    status.textContent = q
      ? `${found} sections match. Search uses text and local concept synonyms.`
      : 'Ready.';
  };
  search.oninput = applySearch;
  function pickedElement(event: MouseEvent) {
    const e =
      event.target instanceof Element
        ? event.target.closest<HTMLElement>(
            '[data-control-id],canvas,input,button,select,label',
          )
        : null;
    return e;
  }
  const pointAt = (event: MouseEvent) => {
    if (!selecting) return;
    const e = pickedElement(event);
    if (!e || e === pick || (canvasOnly && e.tagName !== 'CANVAS')) return;
    const r = e.getBoundingClientRect();
    Object.assign(highlight.style, {
      left: `${r.left}px`,
      top: `${r.top}px`,
      width: `${r.width}px`,
      height: `${r.height}px`,
    });
    highlight.hidden = false;
  };
  const pickTarget = (event: MouseEvent) => {
    if (!selecting) return;
    const e = pickedElement(event);
    if (!e || e === pick || (canvasOnly && e.tagName !== 'CANVAS')) return;
    if (e instanceof HTMLInputElement && e.type === 'password') return;
    event.preventDefault();
    event.stopImmediatePropagation();
    const r = e.getBoundingClientRect();
    const described = describeTarget(e);
    target = {
      selectorStrategy: described.strategy,
      selector: described.selector,
      target:
        described.strategy === 'canvas'
          ? `visualizer:${active?.metadata.type}`
          : described.target,
      point:
        e.tagName === 'CANVAS'
          ? {
              x: (event.clientX - r.left) / r.width,
              y: (event.clientY - r.top) / r.height,
            }
          : undefined,
    };
    sourceInfo = null;
    targetLabel.textContent = `Target: ${target.target}${target.point ? ' · canvas region' : ''}`;
    cancelPick();
    void locate();
    note.focus();
  };
  function cancelPick() {
    if (canvasOnly) root.hidden = false;
    canvasOnly = false;
    pickerHint.hidden = true;
    selecting = false;
    highlight.hidden = true;
    pick.textContent = 'Pick annotation target';
  }
  function open() {
    returnFocus = document.activeElement as HTMLElement;
    root.hidden = false;
    launch.setAttribute('aria-expanded', 'true');
    renderContexts();
    renderLogs();
    search.focus();
  }
  function hide() {
    cancelPick();
    root.hidden = true;
    launch.setAttribute('aria-expanded', 'false');
    returnFocus?.focus();
  }
  const key = (event: KeyboardEvent) => {
    if (event.key === 'Escape') {
      if (
        event.target instanceof Element &&
        event.target.closest('.control-help[open]')
      )
        return;
      if (!root.hidden) event.stopPropagation();
      if (selecting) cancelPick();
      else if (!root.hidden) hide();
    }
    if (event.code === 'Backquote' && event.altKey) {
      event.preventDefault();
      root.hidden ? open() : hide();
    }
  };
  const preventTargetAction = (event: PointerEvent) => {
    if (!selecting || event.target === pick) return;
    event.preventDefault();
    event.stopImmediatePropagation();
  };
  const show = () => open();
  document.addEventListener('pointerdown', preventTargetAction, true);
  document.addEventListener('pointerup', preventTargetAction, true);
  document.addEventListener('mousemove', pointAt, true);
  document.addEventListener('click', pickTarget, true);
  document.addEventListener('keydown', key);
  window.addEventListener('cybernoetica:developer', show);
  const timer = setInterval(() => {
    if (root.hidden) return;
    renderContexts();
    syncVisualControls();
    diagnostics.textContent = JSON.stringify(
      {
        performance: window.__cybernoetica_debug,
        renderer: g.scene.getRendererDebugInfo(),
        playback: g.playback?.state,
      },
      null,
      2,
    );
  }, 500);
  for (const id of preferences.order ?? []) {
    const d = sections.get(id);
    if (d) body.append(d);
  }
  return () => {
    setAgentAnnotationsProvider(() => []);
    clearInterval(timer);
    cleanups.forEach((f) => f());
    journeyCleanup?.();
    document.removeEventListener('pointerdown', preventTargetAction, true);
    document.removeEventListener('pointerup', preventTargetAction, true);
    pickerHint.remove();
    document.removeEventListener('mousemove', pointAt, true);
    document.removeEventListener('click', pickTarget, true);
    document.removeEventListener('keydown', key);
    window.removeEventListener('cybernoetica:developer', show);
    root.remove();
    launch.remove();
    highlight.remove();
  };
}
