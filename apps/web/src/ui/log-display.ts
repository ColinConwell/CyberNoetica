import { el } from './components.js';
import { FONT, GLASS_BG, GLASS_BORDER, TEXT_DIM, TEXT_PRIMARY, TEXT_SECONDARY, ACCENT } from './styles.js';

// ---------------------------------------------------------------------------
// Log Types
// ---------------------------------------------------------------------------

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';
export type LogDisplayMode = 'stream' | 'floating' | 'fixed';
export type LogStyle = 'raw' | 'clean';

interface LogEntry {
  level: LogLevel;
  message: string;
  timestamp: number;
}

const LOG_COLORS: Record<LogLevel, string> = {
  debug: 'rgba(140, 160, 255, 0.6)',
  info: 'rgba(180, 220, 255, 0.7)',
  warn: 'rgba(255, 200, 80, 0.8)',
  error: 'rgba(255, 90, 90, 0.9)',
};

const LOG_BG_COLORS: Record<LogLevel, string> = {
  debug: 'rgba(140, 160, 255, 0.06)',
  info: 'rgba(180, 220, 255, 0.04)',
  warn: 'rgba(255, 200, 80, 0.06)',
  error: 'rgba(255, 90, 90, 0.08)',
};

const LEVEL_LABELS: Record<LogLevel, string> = {
  debug: 'DBG',
  info: 'INF',
  warn: 'WRN',
  error: 'ERR',
};

// ---------------------------------------------------------------------------
// Log Buffer (circular)
// ---------------------------------------------------------------------------

const MAX_ENTRIES = 200;
const logBuffer: LogEntry[] = [];
const logListeners: Array<(entry: LogEntry) => void> = [];

function pushLog(level: LogLevel, message: string) {
  const entry: LogEntry = { level, message, timestamp: Date.now() };
  logBuffer.push(entry);
  if (logBuffer.length > MAX_ENTRIES) logBuffer.shift();
  for (const fn of logListeners) {
    try { fn(entry); } catch { /* swallow */ }
  }
}

function onLog(fn: (entry: LogEntry) => void): () => void {
  logListeners.push(fn);
  return () => {
    const idx = logListeners.indexOf(fn);
    if (idx >= 0) logListeners.splice(idx, 1);
  };
}

// ---------------------------------------------------------------------------
// Console Interceptor
// ---------------------------------------------------------------------------

let interceptInstalled = false;
const originals = {
  log: console.log,
  info: console.info,
  warn: console.warn,
  error: console.error,
  debug: console.debug,
};

export function installLogInterceptor(): void {
  if (interceptInstalled) return;
  interceptInstalled = true;

  console.log = (...args: any[]) => {
    originals.log.apply(console, args);
    pushLog('info', args.map(String).join(' '));
  };
  console.info = (...args: any[]) => {
    originals.info.apply(console, args);
    pushLog('info', args.map(String).join(' '));
  };
  console.warn = (...args: any[]) => {
    originals.warn.apply(console, args);
    pushLog('warn', args.map(String).join(' '));
  };
  console.error = (...args: any[]) => {
    originals.error.apply(console, args);
    pushLog('error', args.map(String).join(' '));
  };
  console.debug = (...args: any[]) => {
    originals.debug.apply(console, args);
    pushLog('debug', args.map(String).join(' '));
  };
}

export function uninstallLogInterceptor(): void {
  if (!interceptInstalled) return;
  interceptInstalled = false;
  console.log = originals.log;
  console.info = originals.info;
  console.warn = originals.warn;
  console.error = originals.error;
  console.debug = originals.debug;
}

// ---------------------------------------------------------------------------
// Shared Helpers
// ---------------------------------------------------------------------------

function formatTimestamp(ts: number): string {
  const time = new Date(ts);
  return `${String(time.getHours()).padStart(2, '0')}:${String(time.getMinutes()).padStart(2, '0')}:${String(time.getSeconds()).padStart(2, '0')}`;
}

function appendLogLine(parent: HTMLElement, entry: LogEntry, style: LogStyle) {
  if (style === 'clean') {
    const line = el('div', {
      padding: '3px 6px', marginBottom: '2px',
      borderRadius: '4px',
      background: LOG_BG_COLORS[entry.level],
      display: 'flex', alignItems: 'baseline', gap: '8px',
    });

    const badge = el('span', {
      fontSize: '9px', fontWeight: '600', letterSpacing: '0.05em',
      padding: '1px 5px', borderRadius: '3px',
      color: LOG_COLORS[entry.level],
      background: LOG_BG_COLORS[entry.level],
      border: `1px solid ${LOG_COLORS[entry.level]}`,
      fontFamily: 'monospace', flexShrink: '0',
    });
    badge.textContent = LEVEL_LABELS[entry.level];

    const ts = el('span', {
      fontSize: '9px', color: TEXT_DIM, fontFamily: 'monospace', flexShrink: '0',
    });
    ts.textContent = formatTimestamp(entry.timestamp);

    const msg = el('span', {
      color: LOG_COLORS[entry.level],
      whiteSpace: 'pre-wrap', wordBreak: 'break-word',
      fontSize: '11px', fontFamily: 'monospace', lineHeight: '1.4',
    });
    msg.textContent = entry.message;

    line.append(badge, ts, msg);
    parent.appendChild(line);
  } else {
    const line = el('div', {
      padding: '2px 0', color: LOG_COLORS[entry.level] || TEXT_DIM,
      borderBottom: '1px solid rgba(255,255,255,0.03)',
      whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
      fontFamily: 'monospace', fontSize: '11px',
    });
    line.textContent = `${formatTimestamp(entry.timestamp)} [${entry.level}] ${entry.message}`;
    parent.appendChild(line);
  }
}

function matches(entry: LogEntry, filter: LogLevel | 'all'): boolean {
  return filter === 'all' || entry.level === filter;
}

// ---------------------------------------------------------------------------
// Floating Modal Display
// ---------------------------------------------------------------------------

function createFloatingDisplay(filter: LogLevel | 'all', style: LogStyle): { element: HTMLElement; cleanup: () => void } {
  const container = el('div', {
    position: 'fixed', top: '60px', right: '20px',
    width: '460px', maxHeight: '50vh',
    background: GLASS_BG, backdropFilter: 'blur(20px)', WebkitBackdropFilter: 'blur(20px)',
    border: `1px solid ${GLASS_BORDER}`, borderRadius: '12px',
    zIndex: '200', overflow: 'hidden',
    fontFamily: 'monospace', fontSize: '11px',
  });

  const header = el('div', {
    padding: '8px 12px', display: 'flex', justifyContent: 'space-between',
    alignItems: 'center', borderBottom: `1px solid ${GLASS_BORDER}`,
    cursor: 'move', userSelect: 'none',
  });
  const headerText = el('span', { color: TEXT_DIM, fontSize: '10px', letterSpacing: '0.15em', textTransform: 'uppercase' });
  headerText.textContent = 'Log';
  const closeBtn = el('span', { color: TEXT_DIM, cursor: 'pointer', fontSize: '14px', padding: '2px 4px' });
  closeBtn.textContent = '\u00d7';
  closeBtn.addEventListener('mouseenter', () => { closeBtn.style.color = TEXT_PRIMARY; });
  closeBtn.addEventListener('mouseleave', () => { closeBtn.style.color = TEXT_DIM; });
  header.append(headerText, closeBtn);
  container.appendChild(header);

  const logList = el('div', {
    maxHeight: 'calc(50vh - 40px)', overflowY: 'auto', padding: '6px 10px',
  });
  container.appendChild(logList);

  for (const e of logBuffer.filter(en => matches(en, filter))) {
    appendLogLine(logList, e, style);
  }
  logList.scrollTop = logList.scrollHeight;

  const unsub = onLog((entry) => {
    if (!matches(entry, filter)) return;
    appendLogLine(logList, entry, style);
    logList.scrollTop = logList.scrollHeight;
    while (logList.children.length > MAX_ENTRIES) logList.removeChild(logList.firstChild!);
  });

  let dragging = false, dx = 0, dy = 0;
  header.addEventListener('pointerdown', (e) => {
    dragging = true;
    const rect = container.getBoundingClientRect();
    dx = e.clientX - rect.left;
    dy = e.clientY - rect.top;
    header.setPointerCapture(e.pointerId);
  });
  header.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    container.style.left = `${e.clientX - dx}px`;
    container.style.top = `${e.clientY - dy}px`;
    container.style.right = 'auto';
  });
  header.addEventListener('pointerup', () => { dragging = false; });

  document.body.appendChild(container);

  const cleanup = () => {
    unsub();
    container.remove();
  };

  closeBtn.addEventListener('click', cleanup);

  return { element: container, cleanup };
}

// ---------------------------------------------------------------------------
// Fixed Panel Display (below control panel)
// ---------------------------------------------------------------------------

function createFixedDisplay(filter: LogLevel | 'all', style: LogStyle): { element: HTMLElement; cleanup: () => void } {
  const FIXED_LOG_HEIGHT = 160;

  const container = el('div', {
    position: 'fixed', bottom: '0', left: '50%',
    transform: 'translateX(-50%)',
    width: '440px', maxWidth: '90vw', height: `${FIXED_LOG_HEIGHT}px`,
    background: GLASS_BG, backdropFilter: 'blur(20px)', WebkitBackdropFilter: 'blur(20px)',
    border: `1px solid ${GLASS_BORDER}`, borderRadius: '12px 12px 0 0',
    zIndex: '88', overflow: 'hidden',
    fontFamily: 'monospace', fontSize: '11px',
    transition: 'opacity 0.3s ease',
    display: 'flex', flexDirection: 'column',
  });
  container.setAttribute('data-log-fixed', 'true');
  container.setAttribute('data-log-fixed-height', String(FIXED_LOG_HEIGHT));

  const headerRow = el('div', {
    padding: '5px 12px', display: 'flex', justifyContent: 'space-between',
    alignItems: 'center', borderBottom: `1px solid ${GLASS_BORDER}`,
    flexShrink: '0',
  });
  const headerText = el('span', { color: TEXT_DIM, fontSize: '9px', letterSpacing: '0.15em', textTransform: 'uppercase' });
  headerText.textContent = 'Log Output';
  headerRow.appendChild(headerText);
  container.appendChild(headerRow);

  const logList = el('div', {
    flex: '1', overflowY: 'auto', padding: '4px 10px',
  });
  container.appendChild(logList);

  for (const e of logBuffer.filter(en => matches(en, filter))) {
    appendLogLine(logList, e, style);
  }
  logList.scrollTop = logList.scrollHeight;

  const unsub = onLog((entry) => {
    if (!matches(entry, filter)) return;
    appendLogLine(logList, entry, style);
    logList.scrollTop = logList.scrollHeight;
    while (logList.children.length > MAX_ENTRIES) logList.removeChild(logList.firstChild!);
  });

  document.body.appendChild(container);

  return {
    element: container,
    cleanup() { unsub(); container.remove(); },
  };
}

// ---------------------------------------------------------------------------
// Stream Overlay Display (Star Wars style)
// ---------------------------------------------------------------------------

function createStreamDisplay(filter: LogLevel | 'all', style: LogStyle): { element: HTMLElement; cleanup: () => void } {
  const container = el('div', {
    position: 'fixed', bottom: '100px', left: '50%', transform: 'translateX(-50%)',
    width: '500px', maxWidth: '80vw',
    pointerEvents: 'none', zIndex: '85',
    display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px',
    transition: 'bottom 0.3s ease',
  });
  container.setAttribute('data-log-stream', 'true');
  document.body.appendChild(container);

  if (!document.getElementById('log-stream-keyframes')) {
    const styleEl = document.createElement('style');
    styleEl.id = 'log-stream-keyframes';
    styleEl.textContent = `
      @keyframes logStreamFade {
        0% { opacity: 0; transform: translateY(8px); }
        10% { opacity: 1; transform: translateY(0); }
        70% { opacity: 0.8; transform: translateY(-4px); }
        100% { opacity: 0; transform: translateY(-16px); }
      }
    `;
    document.head.appendChild(styleEl);
  }

  function addStreamLine(entry: LogEntry) {
    const isClean = style === 'clean';
    const line = el('div', {
      fontFamily: 'monospace', fontSize: '11px',
      color: LOG_COLORS[entry.level] || TEXT_DIM,
      opacity: '0', textAlign: 'center',
      whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
      maxWidth: '100%',
      animation: 'logStreamFade 4s ease-out forwards',
      ...(isClean ? {
        padding: '2px 10px',
        borderRadius: '4px',
        background: LOG_BG_COLORS[entry.level],
      } : {}),
    });
    if (isClean) {
      const badge = document.createElement('span');
      Object.assign(badge.style, {
        fontSize: '9px', fontWeight: '600',
        color: LOG_COLORS[entry.level],
        marginRight: '6px',
      });
      badge.textContent = LEVEL_LABELS[entry.level];
      line.appendChild(badge);
      line.appendChild(document.createTextNode(entry.message));
    } else {
      line.textContent = entry.message;
    }
    container.appendChild(line);
    setTimeout(() => { line.remove(); }, 4200);
    while (container.children.length > 6) container.removeChild(container.firstChild!);
  }

  // Replay recent buffer entries with staggered animation
  const recent = logBuffer.filter(en => matches(en, filter)).slice(-3);
  recent.forEach((entry, i) => {
    setTimeout(() => addStreamLine(entry), i * 200);
  });

  const unsub = onLog((entry) => {
    if (!matches(entry, filter)) return;
    addStreamLine(entry);
  });

  return {
    element: container,
    cleanup() { unsub(); container.remove(); },
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface LogDisplay {
  element: HTMLElement;
  cleanup: () => void;
}

export function createLogDisplay(
  mode: LogDisplayMode,
  filter: LogLevel | 'all',
  style: LogStyle = 'clean',
): LogDisplay {
  switch (mode) {
    case 'floating':
      return createFloatingDisplay(filter, style);
    case 'fixed':
      return createFixedDisplay(filter, style);
    case 'stream':
      return createStreamDisplay(filter, style);
  }
}

export function getLogBuffer(): ReadonlyArray<LogEntry> {
  return logBuffer;
}
