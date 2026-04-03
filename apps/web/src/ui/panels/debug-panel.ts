import { el, sectionLabel } from '../components.js';
import { ACCENT, FONT, GLASS_BORDER, TEXT_DIM, TEXT_PRIMARY, TEXT_SECONDARY } from '../styles.js';
import type { MessageBus, AudioFeatures, BusMessage, Store } from '@cybernoetica/core';

interface CyberNoeticaGlobals {
  store: Store<any>;
  bus: MessageBus;
}

function getGlobals(): CyberNoeticaGlobals | null {
  return (window as any).__cybernoetica ?? null;
}

function getDebugInfo(): { fps: number; frameTime: number; vizType: string } | null {
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

  // Performance section
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

  // Audio section
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

  const wasmBadge = el('div', {
    fontSize: '10px', color: TEXT_DIM, marginBottom: '14px',
  });
  const state = store.getState();
  wasmBadge.textContent = `Analyzer: ${state.audio?.wasm ? 'WASM' : 'JS fallback'}`;
  container.appendChild(wasmBadge);

  // Visualizer section
  container.appendChild(sectionLabel('Visualizer'));
  const vizInfo = el('div', {
    fontSize: '11px', color: TEXT_SECONDARY, marginBottom: '14px',
    fontFamily: 'monospace', lineHeight: '1.6',
  });
  container.appendChild(vizInfo);

  // State section
  container.appendChild(sectionLabel('State'));
  const stateBox = el('pre', {
    fontSize: '10px', color: TEXT_DIM, fontFamily: 'monospace',
    background: 'rgba(0,0,0,0.3)', borderRadius: '8px', padding: '8px',
    maxHeight: '120px', overflowY: 'auto', whiteSpace: 'pre-wrap',
    wordBreak: 'break-all', marginBottom: '10px',
    border: `1px solid ${GLASS_BORDER}`,
  });
  container.appendChild(stateBox);

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

  // Bus monitor
  container.appendChild(el('div', { height: '10px' }));
  container.appendChild(sectionLabel('Bus'));
  const busInfo = el('div', {
    fontSize: '11px', color: TEXT_DIM, fontFamily: 'monospace',
  });
  container.appendChild(busInfo);

  // Audio subscription for live features
  let latestFeatures: AudioFeatures | null = null;
  const unsub = bus.subscribe('audio:features', (msg: BusMessage<AudioFeatures>) => {
    latestFeatures = msg.payload;
  });

  // Bus message counter
  let busMessageCount = 0;
  let busRate = 0;
  let lastBusCheck = performance.now();
  const busSub = bus.subscribe('audio:*', () => { busMessageCount++; });

  // Periodic update
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
    vizInfo.textContent = `Type: ${s.visualizer?.type || '—'}\nParams: ${JSON.stringify(s.visualizer?.userParams || {}, null, 1)}`;
    stateBox.textContent = JSON.stringify(s, null, 2);
    busInfo.textContent = `audio:features ${busRate} msg/s`;
  }, 200);

  return () => {
    clearInterval(interval);
    unsub();
    busSub();
  };
}

export function isDebugEnabled(): boolean {
  if (typeof import.meta !== 'undefined' && (import.meta as any).env?.DEV) return true;
  try {
    return new URLSearchParams(window.location.search).has('debug');
  } catch { return false; }
}
