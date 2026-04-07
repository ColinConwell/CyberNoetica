import { el } from './components.js';
import { FONT, GLASS_BG, GLASS_BORDER, TEXT_DIM, TEXT_PRIMARY, TEXT_SECONDARY } from './styles.js';

// ---------------------------------------------------------------------------
// Log Types
// ---------------------------------------------------------------------------

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';
export type LogDisplayMode = 'floating' | 'docked-bottom' | 'docked-left' | 'docked-right' | 'stream';

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
// Floating Modal Display
// ---------------------------------------------------------------------------

function createFloatingDisplay(filter: LogLevel | 'all'): { element: HTMLElement; cleanup: () => void } {
  const container = el('div', {
    position: 'fixed', top: '60px', right: '20px',
    width: '420px', maxHeight: '50vh',
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
  const closeBtn = el('span', { color: TEXT_DIM, cursor: 'pointer', fontSize: '14px' });
  closeBtn.textContent = '\u00d7';
  header.append(headerText, closeBtn);
  container.appendChild(header);

  const logList = el('div', {
    maxHeight: 'calc(50vh - 40px)', overflowY: 'auto', padding: '6px 10px',
  });
  container.appendChild(logList);

  // Populate from buffer
  function matches(e: LogEntry) {
    return filter === 'all' || e.level === filter;
  }
  for (const e of logBuffer.filter(matches)) {
    appendLogLine(logList, e);
  }
  logList.scrollTop = logList.scrollHeight;

  const unsub = onLog((entry) => {
    if (!matches(entry)) return;
    appendLogLine(logList, entry);
    logList.scrollTop = logList.scrollHeight;
    while (logList.children.length > MAX_ENTRIES) logList.removeChild(logList.firstChild!);
  });

  // Drag support
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

  return {
    element: container,
    cleanup() {
      unsub();
      closeBtn.onclick = null;
      container.remove();
    },
  };
}

// ---------------------------------------------------------------------------
// Docked Panel Display
// ---------------------------------------------------------------------------

function createDockedDisplay(
  filter: LogLevel | 'all',
  position: 'bottom' | 'left' | 'right',
): { element: HTMLElement; cleanup: () => void } {
  const isHorizontal = position === 'bottom';
  const container = el('div', {
    position: 'fixed',
    ...(position === 'bottom' ? { bottom: '0', left: '0', right: '0', height: '180px' } : {}),
    ...(position === 'left' ? { top: '0', left: '0', bottom: '0', width: '320px' } : {}),
    ...(position === 'right' ? { top: '0', right: '0', bottom: '0', width: '320px' } : {}),
    background: 'rgba(4, 4, 12, 0.92)', backdropFilter: 'blur(16px)', WebkitBackdropFilter: 'blur(16px)',
    borderTop: isHorizontal ? `1px solid ${GLASS_BORDER}` : 'none',
    borderRight: position === 'left' ? `1px solid ${GLASS_BORDER}` : 'none',
    borderLeft: position === 'right' ? `1px solid ${GLASS_BORDER}` : 'none',
    zIndex: '190', overflow: 'hidden',
    fontFamily: 'monospace', fontSize: '11px',
  });

  const logList = el('div', {
    height: '100%', overflowY: 'auto', padding: '8px 12px',
  });
  container.appendChild(logList);

  function matches(e: LogEntry) {
    return filter === 'all' || e.level === filter;
  }
  for (const e of logBuffer.filter(matches)) {
    appendLogLine(logList, e);
  }
  logList.scrollTop = logList.scrollHeight;

  const unsub = onLog((entry) => {
    if (!matches(entry)) return;
    appendLogLine(logList, entry);
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

function createStreamDisplay(filter: LogLevel | 'all'): { element: HTMLElement; cleanup: () => void } {
  const container = el('div', {
    position: 'fixed', bottom: '100px', left: '50%', transform: 'translateX(-50%)',
    width: '500px', maxWidth: '80vw',
    pointerEvents: 'none', zIndex: '85',
    display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px',
  });
  document.body.appendChild(container);

  function matches(e: LogEntry) {
    return filter === 'all' || e.level === filter;
  }

  const unsub = onLog((entry) => {
    if (!matches(entry)) return;
    const line = el('div', {
      fontFamily: 'monospace', fontSize: '11px',
      color: LOG_COLORS[entry.level] || TEXT_DIM,
      opacity: '0', textAlign: 'center',
      whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
      maxWidth: '100%',
      animation: 'logStreamFade 4s ease-out forwards',
    });
    line.textContent = entry.message;
    container.appendChild(line);

    setTimeout(() => { line.remove(); }, 4200);
    while (container.children.length > 5) container.removeChild(container.firstChild!);
  });

  // Inject animation keyframes
  if (!document.getElementById('log-stream-keyframes')) {
    const style = document.createElement('style');
    style.id = 'log-stream-keyframes';
    style.textContent = `
      @keyframes logStreamFade {
        0% { opacity: 0; transform: translateY(8px); }
        10% { opacity: 1; transform: translateY(0); }
        70% { opacity: 0.8; transform: translateY(-4px); }
        100% { opacity: 0; transform: translateY(-16px); }
      }
    `;
    document.head.appendChild(style);
  }

  return {
    element: container,
    cleanup() { unsub(); container.remove(); },
  };
}

// ---------------------------------------------------------------------------
// Shared Helpers
// ---------------------------------------------------------------------------

function appendLogLine(parent: HTMLElement, entry: LogEntry) {
  const line = el('div', {
    padding: '2px 0', color: LOG_COLORS[entry.level] || TEXT_DIM,
    borderBottom: '1px solid rgba(255,255,255,0.03)',
    whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
  });
  const time = new Date(entry.timestamp);
  const ts = `${String(time.getHours()).padStart(2, '0')}:${String(time.getMinutes()).padStart(2, '0')}:${String(time.getSeconds()).padStart(2, '0')}`;
  line.textContent = `${ts} [${entry.level}] ${entry.message}`;
  parent.appendChild(line);
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
): LogDisplay {
  switch (mode) {
    case 'floating':
      return createFloatingDisplay(filter);
    case 'docked-bottom':
      return createDockedDisplay(filter, 'bottom');
    case 'docked-left':
      return createDockedDisplay(filter, 'left');
    case 'docked-right':
      return createDockedDisplay(filter, 'right');
    case 'stream':
      return createStreamDisplay(filter);
  }
}

export function getLogBuffer(): ReadonlyArray<LogEntry> {
  return logBuffer;
}
