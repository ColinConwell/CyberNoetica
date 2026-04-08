import { el, sectionLabel, glassButton, infoBlock, updateInfoBlock, sectionLabelWithToggle } from '../components.js';
import type { InfoBlockField } from '../components.js';
import { ACCENT, FONT, GLASS_BORDER, TEXT_DIM, TEXT_PRIMARY, TEXT_SECONDARY } from '../styles.js';
import type { MessageBus, AudioFeatures, BusMessage, Store } from '@cybernoetica/core';
import {
  createLogDisplay,
  type LogLevel,
  type LogDisplayMode,
  type LogDisplay,
  type LogStyle,
} from '../log-display.js';

interface CyberNoeticaGlobals {
  store: Store<any>;
  bus: MessageBus;
}

function getGlobals(): CyberNoeticaGlobals | null {
  return (window as any).__cybernoetica ?? null;
}

function getDebugInfo(): { fps: number; frameTime: number; vizType: string; playbackState?: string } | null {
  return (window as any).__cybernoetica_debug ?? null;
}

export function renderDebugPanel(container: HTMLElement): () => void {
  const globals = getGlobals();
  if (!globals) {
    const msg = el('div', { color: TEXT_DIM, fontSize: '11px' });
    msg.textContent = 'Debug info unavailable';
    container.appendChild(msg);
    return () => {};
  }

  const { store, bus } = globals;

  // ── Performance ─────────────────────────────────────────────────
  container.appendChild(sectionLabel('Performance'));
  const perfGrid = el('div', {
    display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px 12px',
    fontSize: '11px', color: TEXT_SECONDARY, marginBottom: '14px',
  });
  const fpsVal = el('span', { color: TEXT_PRIMARY, fontFamily: 'monospace' });
  const ftVal = el('span', { color: TEXT_PRIMARY, fontFamily: 'monospace' });
  const fpsRow = el('div', {}); fpsRow.textContent = 'FPS'; fpsRow.appendChild(fpsVal);
  const ftRow = el('div', {}); ftRow.textContent = 'Frame '; ftRow.appendChild(ftVal);
  perfGrid.append(fpsRow, ftRow);
  container.appendChild(perfGrid);

  // ── Audio ───────────────────────────────────────────────────────
  container.appendChild(sectionLabel('Audio'));
  const audioGrid = el('div', {
    display: 'grid', gridTemplateColumns: '60px 1fr', gap: '4px 8px',
    fontSize: '11px', color: TEXT_SECONDARY, marginBottom: '14px',
  });

  const audioFields: Record<string, HTMLElement> = {};
  for (const label of ['Bass', 'Mid', 'High', 'RMS', 'Centroid', 'Beat']) {
    const lbl = el('span', { color: TEXT_DIM });
    lbl.textContent = label;
    const bar = el('div', {
      height: '8px', borderRadius: '4px', background: 'rgba(255,255,255,0.06)',
      overflow: 'hidden', position: 'relative',
    });
    const fill = el('div', {
      height: '100%', borderRadius: '4px', transition: 'width 0.1s ease',
      background: ACCENT, width: '0%',
    });
    bar.appendChild(fill);
    audioFields[label.toLowerCase()] = fill;
    audioGrid.append(lbl, bar);
  }
  container.appendChild(audioGrid);

  const wasmBadge = el('div', { fontSize: '10px', color: TEXT_DIM, marginBottom: '14px' });
  const state = store.getState();
  wasmBadge.textContent = `Analyzer: ${state.audio?.wasm ? 'WASM' : 'JS fallback'}`;
  container.appendChild(wasmBadge);

  // ── Visualizer ──────────────────────────────────────────────────
  container.appendChild(sectionLabel('Visualizer'));
  const vizInfoBlock = infoBlock([
    { label: 'Type', value: '\u2014' },
    { label: 'Playback', value: '\u2014' },
    { label: 'View', value: '\u2014' },
    { label: 'Params', value: '{}' },
  ]);
  container.appendChild(vizInfoBlock);

  // ── State ───────────────────────────────────────────────────────
  let stateViewMode: 'json' | 'tree' = 'json';

  const stateHeader = sectionLabelWithToggle('State', ['JSON', 'Tree'], 0, (idx) => {
    stateViewMode = idx === 0 ? 'json' : 'tree';
    const s = store.getState();
    updateStateDisplay(s);
  });
  container.appendChild(stateHeader);

  const stateContainer = el('div', { marginBottom: '10px' });
  container.appendChild(stateContainer);

  const stateBox = el('pre', {
    fontSize: '10px', color: TEXT_DIM, fontFamily: 'monospace',
    background: 'rgba(0,0,0,0.3)', borderRadius: '8px', padding: '8px',
    maxHeight: '140px', overflowY: 'auto', whiteSpace: 'pre-wrap',
    wordBreak: 'break-all',
    border: `1px solid ${GLASS_BORDER}`,
    margin: '0',
  });
  stateContainer.appendChild(stateBox);

  function updateStateDisplay(state: any) {
    stateContainer.innerHTML = '';
    if (stateViewMode === 'json') {
      stateBox.innerHTML = syntaxHighlightJSON(JSON.stringify(state, null, 2));
      stateContainer.appendChild(stateBox);
    } else {
      const tree = buildPropertyTree(state, 0, true);
      Object.assign(tree.style, {
        background: 'rgba(0,0,0,0.25)',
        border: `1px solid ${GLASS_BORDER}`,
        borderRadius: '8px',
        padding: '6px 8px',
        maxHeight: '140px',
        overflowY: 'auto',
        fontSize: '10px',
        fontFamily: 'monospace',
      });
      stateContainer.appendChild(tree);
    }
  }

  function syntaxHighlightJSON(json: string): string {
    return json.replace(
      /("(\\u[\da-fA-F]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d*)?(?:[eE][+\-]?\d+)?)/g,
      (match) => {
        let color = 'rgba(180, 220, 255, 0.6)';
        if (/^"/.test(match)) {
          color = match.endsWith(':') ? 'rgba(140, 160, 255, 0.7)' : 'rgba(120, 220, 140, 0.7)';
        } else if (/true|false/.test(match)) {
          color = 'rgba(255, 180, 80, 0.7)';
        } else if (/null/.test(match)) {
          color = 'rgba(255, 255, 255, 0.3)';
        }
        return `<span style="color:${color}">${match}</span>`;
      }
    );
  }

  function buildPropertyTree(obj: any, depth: number, expanded: boolean): HTMLElement {
    const container = el('div', { paddingLeft: depth > 0 ? '12px' : '0' });

    if (obj === null || obj === undefined) {
      const val = el('span', { color: 'rgba(255,255,255,0.3)' });
      val.textContent = String(obj);
      container.appendChild(val);
      return container;
    }

    if (typeof obj !== 'object') {
      const val = el('span', {
        color: typeof obj === 'string' ? 'rgba(120, 220, 140, 0.7)'
          : typeof obj === 'number' ? 'rgba(180, 220, 255, 0.6)'
          : typeof obj === 'boolean' ? 'rgba(255, 180, 80, 0.7)'
          : TEXT_DIM,
      });
      val.textContent = typeof obj === 'string' ? `"${obj}"` : String(obj);
      container.appendChild(val);
      return container;
    }

    const entries = Object.entries(obj);
    for (const [key, value] of entries) {
      const isComplex = value !== null && typeof value === 'object';
      const row = el('div', { padding: '1px 0' });

      if (isComplex) {
        let isOpen = depth < 1;
        const toggle = el('span', {
          cursor: 'pointer', userSelect: 'none',
          color: TEXT_DIM, fontSize: '9px', marginRight: '4px',
          display: 'inline-block', width: '10px',
        });
        toggle.textContent = isOpen ? '\u25BE' : '\u25B8';

        const keyEl = el('span', { color: 'rgba(140, 160, 255, 0.7)' });
        keyEl.textContent = key;

        const preview = el('span', { color: TEXT_DIM, marginLeft: '4px', fontSize: '9px' });
        const childEntries = Object.keys(value as object);
        preview.textContent = Array.isArray(value) ? ` [${childEntries.length}]` : ` {${childEntries.length}}`;

        const childContainer = el('div', {
          display: isOpen ? 'block' : 'none',
          borderLeft: '1px solid rgba(140, 160, 255, 0.15)',
        });
        const child = buildPropertyTree(value, depth + 1, isOpen);
        childContainer.appendChild(child);

        toggle.addEventListener('click', () => {
          isOpen = !isOpen;
          toggle.textContent = isOpen ? '\u25BE' : '\u25B8';
          childContainer.style.display = isOpen ? 'block' : 'none';
        });

        row.append(toggle, keyEl, preview);
        row.appendChild(childContainer);
      } else {
        const spacer = el('span', { display: 'inline-block', width: '10px', marginRight: '4px' });
        const keyEl = el('span', { color: 'rgba(140, 160, 255, 0.7)' });
        keyEl.textContent = key;
        const sep = el('span', { color: TEXT_DIM });
        sep.textContent = ': ';
        const valEl = el('span', {
          color: typeof value === 'string' ? 'rgba(120, 220, 140, 0.7)'
            : typeof value === 'number' ? 'rgba(180, 220, 255, 0.6)'
            : typeof value === 'boolean' ? 'rgba(255, 180, 80, 0.7)'
            : 'rgba(255,255,255,0.3)',
        });
        valEl.textContent = typeof value === 'string' ? `"${value}"` : String(value);
        row.append(spacer, keyEl, sep, valEl);
      }

      container.appendChild(row);
    }

    return container;
  }

  const exportBtn = el('button', {
    padding: '6px 14px', fontSize: '10px', fontFamily: FONT,
    background: 'rgba(255,255,255,0.06)', color: TEXT_SECONDARY,
    border: `1px solid ${GLASS_BORDER}`, borderRadius: '6px',
    cursor: 'pointer', transition: 'all 0.15s',
  });
  exportBtn.textContent = 'Copy State JSON';
  exportBtn.addEventListener('click', () => {
    navigator.clipboard.writeText(store.serialize()).then(() => {
      exportBtn.textContent = 'Copied';
      setTimeout(() => { exportBtn.textContent = 'Copy State JSON'; }, 1500);
    });
  });
  container.appendChild(exportBtn);

  // ── Bus ─────────────────────────────────────────────────────────
  container.appendChild(el('div', { height: '10px' }));
  container.appendChild(sectionLabel('Bus'));
  const busInfoBlock = infoBlock([
    { label: 'audio:features', value: '0 msg/s' },
  ]);
  container.appendChild(busInfoBlock);

  // ── Log Display Controls ────────────────────────────────────────
  container.appendChild(sectionLabel('Logs'));

  let activeLogDisplay: LogDisplay | null = null;
  let currentLogFilter: LogLevel | 'all' = 'all';
  let currentLogMode: LogDisplayMode = 'stream';
  let currentLogStyle: 'raw' | 'clean' = 'clean';

  const logControlRow = el('div', {
    display: 'flex', gap: '6px', flexWrap: 'wrap', marginBottom: '6px', alignItems: 'center',
  });

  // Level filter
  const levelSelect = el('select', {
    padding: '4px 8px', fontSize: '10px', fontFamily: FONT,
    background: 'rgba(255,255,255,0.06)', color: TEXT_SECONDARY,
    border: `1px solid ${GLASS_BORDER}`, borderRadius: '6px',
    cursor: 'pointer', outline: 'none',
  }) as HTMLSelectElement;
  const levelLabels: [string, string][] = [['all', 'All'], ['debug', 'Debug'], ['info', 'Info'], ['warn', 'Warn'], ['error', 'Error']];
  for (const [value, label] of levelLabels) {
    const opt = document.createElement('option');
    opt.value = value;
    opt.textContent = label;
    opt.style.background = '#111';
    levelSelect.appendChild(opt);
  }
  levelSelect.value = currentLogFilter;
  levelSelect.addEventListener('change', () => {
    currentLogFilter = levelSelect.value as LogLevel | 'all';
    reopenLogDisplay();
  });
  logControlRow.appendChild(levelSelect);

  // Style toggle (Raw / Clean)
  const styleToggle = el('div', {
    display: 'flex', borderRadius: '6px', overflow: 'hidden',
    border: `1px solid ${GLASS_BORDER}`,
  });
  const styleRawBtn = el('button', {
    padding: '3px 8px', fontSize: '9px', fontFamily: FONT,
    background: currentLogStyle === 'raw' ? 'rgba(255,255,255,0.15)' : 'rgba(255,255,255,0.03)',
    color: currentLogStyle === 'raw' ? TEXT_PRIMARY : TEXT_DIM,
    border: 'none', cursor: 'pointer', outline: 'none',
  });
  styleRawBtn.textContent = 'Raw';
  const styleCleanBtn = el('button', {
    padding: '3px 8px', fontSize: '9px', fontFamily: FONT,
    background: currentLogStyle === 'clean' ? 'rgba(255,255,255,0.15)' : 'rgba(255,255,255,0.03)',
    color: currentLogStyle === 'clean' ? TEXT_PRIMARY : TEXT_DIM,
    border: 'none', cursor: 'pointer', outline: 'none',
  });
  styleCleanBtn.textContent = 'Clean';

  function updateStyleButtons() {
    styleRawBtn.style.background = currentLogStyle === 'raw' ? 'rgba(255,255,255,0.15)' : 'rgba(255,255,255,0.03)';
    styleRawBtn.style.color = currentLogStyle === 'raw' ? TEXT_PRIMARY : TEXT_DIM;
    styleCleanBtn.style.background = currentLogStyle === 'clean' ? 'rgba(255,255,255,0.15)' : 'rgba(255,255,255,0.03)';
    styleCleanBtn.style.color = currentLogStyle === 'clean' ? TEXT_PRIMARY : TEXT_DIM;
  }
  styleRawBtn.addEventListener('click', () => { currentLogStyle = 'raw'; updateStyleButtons(); reopenLogDisplay(); });
  styleCleanBtn.addEventListener('click', () => { currentLogStyle = 'clean'; updateStyleButtons(); reopenLogDisplay(); });
  styleToggle.append(styleRawBtn, styleCleanBtn);
  logControlRow.appendChild(styleToggle);

  container.appendChild(logControlRow);

  // Mode buttons row
  const logModeRow = el('div', {
    display: 'flex', gap: '6px', flexWrap: 'wrap', marginBottom: '10px',
  });

  const modes: { label: string; mode: LogDisplayMode }[] = [
    { label: 'Stream', mode: 'stream' },
    { label: 'Float', mode: 'floating' },
    { label: 'Fixed', mode: 'fixed' },
  ];

  const modeButtons: HTMLButtonElement[] = [];
  for (const m of modes) {
    const btn = glassButton(m.label, { active: currentLogMode === m.mode });
    btn.style.fontSize = '10px';
    btn.style.padding = '4px 10px';
    btn.addEventListener('click', () => {
      if (currentLogMode === m.mode && activeLogDisplay) {
        closeLogDisplay();
        updateModeButtons(null);
        return;
      }
      currentLogMode = m.mode;
      reopenLogDisplay();
      updateModeButtons(btn);
    });
    modeButtons.push(btn);
    logModeRow.appendChild(btn);
  }
  container.appendChild(logModeRow);

  function updateModeButtons(activeBtn: HTMLButtonElement | null) {
    for (const b of modeButtons) {
      const isActive = b === activeBtn;
      b.dataset.active = String(isActive);
      b.style.background = isActive ? 'rgba(255,255,255,0.18)' : 'rgba(255,255,255,0.06)';
      b.style.borderColor = isActive ? 'rgba(255,255,255,0.3)' : GLASS_BORDER;
    }
  }

  function closeLogDisplay() {
    if (activeLogDisplay) {
      activeLogDisplay.cleanup();
      activeLogDisplay = null;
    }
  }

  function reopenLogDisplay() {
    closeLogDisplay();
    activeLogDisplay = createLogDisplay(currentLogMode, currentLogFilter, currentLogStyle);
    const activeBtn = modeButtons.find(b => {
      const m = modes.find(md => md.label === b.textContent);
      return m?.mode === currentLogMode;
    }) ?? null;
    updateModeButtons(activeBtn);
  }

  reopenLogDisplay();

  // ── Live Data Subscriptions ─────────────────────────────────────
  let latestFeatures: AudioFeatures | null = null;
  const unsub = bus.subscribe('audio:features', (msg: BusMessage<AudioFeatures>) => {
    latestFeatures = msg.payload;
  });

  let busMessageCount = 0;
  let busRate = 0;
  let lastBusCheck = performance.now();
  const busSub = bus.subscribe('audio:*', () => { busMessageCount++; });

  const interval = setInterval(() => {
    const debug = getDebugInfo();
    if (debug) {
      fpsVal.textContent = ` ${debug.fps}`;
      ftVal.textContent = ` ${debug.frameTime}ms`;
    }

    if (latestFeatures) {
      const f = latestFeatures;
      audioFields.bass.style.width = `${Math.round(f.bass * 100)}%`;
      audioFields.mid.style.width = `${Math.round(f.mid * 100)}%`;
      audioFields.high.style.width = `${Math.round(f.high * 100)}%`;
      audioFields.rms.style.width = `${Math.round(f.rms * 100)}%`;
      audioFields.centroid.style.width = `${Math.round(f.spectralCentroid * 100)}%`;
      audioFields.beat.style.width = f.beatOnset ? '100%' : '0%';
    }

    const now = performance.now();
    if (now - lastBusCheck >= 1000) {
      busRate = busMessageCount;
      busMessageCount = 0;
      lastBusCheck = now;
    }

    const s = store.getState();
    const playbackState = debug?.playbackState || '?';
    const vizMgr = (window as any).__cybernoetica?.vizManager;
    const activeViz = vizMgr?.getActive?.();
    const viewState = activeViz?.getViewState?.() ?? {};
    const viewStr = Object.entries(viewState).map(([k, v]) =>
      `${k}:${typeof v === 'number' ? (Math.abs(v) < 0.01 ? v.toExponential(1) : v.toFixed(3)) : v}`
    ).join('  ');
    updateInfoBlock(vizInfoBlock, [
      { label: 'Type', value: s.visualizer?.type || '\u2014' },
      { label: 'Playback', value: playbackState },
      { label: 'View', value: viewStr || '\u2014' },
      { label: 'Params', value: JSON.stringify(s.visualizer?.userParams || {}) },
    ]);
    updateStateDisplay(s);
    updateInfoBlock(busInfoBlock, [
      { label: 'audio:features', value: `${busRate} msg/s` },
    ]);
  }, 200);

  return () => {
    clearInterval(interval);
    unsub();
    busSub();
    closeLogDisplay();
  };
}

export function isDebugEnabled(): boolean {
  if (typeof import.meta !== 'undefined' && (import.meta as any).env?.DEV) return true;
  if ((window as any).__cybernoetica_debug_enabled) return true;
  try {
    return new URLSearchParams(window.location.search).has('debug');
  } catch { return false; }
}
