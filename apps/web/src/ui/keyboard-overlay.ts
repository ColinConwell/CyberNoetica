import { el } from './components.js';
import { FONT, GLASS_BORDER, TEXT_DIM, TEXT_PRIMARY, TEXT_SECONDARY } from './styles.js';
import { Z_INDEX, SPACING, TIMING } from './constants.js';

export interface KeyboardShortcut {
  key: string;
  label: string;
  tooltip?: string;
  icon?: string;
}

export interface KeyboardOverlayAPI {
  element: HTMLElement;
  setShortcuts: (shortcuts: KeyboardShortcut[]) => void;
  show: () => void;
  hide: () => void;
  isVisible: () => boolean;
  destroy: () => void;
}

const isMac = typeof navigator !== 'undefined' && navigator.platform.toUpperCase().includes('MAC');

const KEY_ICONS: Record<string, string> = {
  Space: '\u2423',
  Escape: 'Esc',
  Enter: '\u21B5',
  Backspace: '\u232B',
  Tab: '\u21E5',
  ArrowUp: '\u2191',
  ArrowDown: '\u2193',
  ArrowLeft: '\u2190',
  ArrowRight: '\u2192',
  Shift: '\u21E7',
  Ctrl: isMac ? '\u2303' : 'Ctrl',
  Alt: isMac ? '\u2325' : 'Alt',
  Meta: isMac ? '\u2318' : 'Win',
  Cmd: '\u2318',
  R: 'R',
};

function getKeyDisplay(key: string): string {
  return KEY_ICONS[key] ?? key;
}

export function createKeyboardOverlay(): KeyboardOverlayAPI {
  let visible = true;
  let shortcuts: KeyboardShortcut[] = [];

  const container = el('div', {
    position: 'fixed',
    bottom: '8px',
    left: '50%',
    transform: 'translateX(-50%)',
    display: 'flex',
    gap: `${SPACING.layoutGap}px`,
    alignItems: 'center',
    justifyContent: 'center',
    flexWrap: 'wrap',
    padding: '4px 10px',
    zIndex: String(Z_INDEX.keyboardOverlay),
    pointerEvents: 'auto',
    transition: `opacity ${TIMING.opacityMedium}, bottom ${TIMING.bottomSlide}`,
    opacity: '0.6',
    maxWidth: '90vw',
  });

  container.addEventListener('mouseenter', () => { container.style.opacity = '1'; });
  container.addEventListener('mouseleave', () => { container.style.opacity = '0.6'; });

  document.body.appendChild(container);

  function render() {
    container.innerHTML = '';
    for (const shortcut of shortcuts) {
      const item = el('div', {
        display: 'flex', alignItems: 'center', gap: '4px',
        cursor: 'default',
      });
      if (shortcut.tooltip) item.title = shortcut.tooltip;

      const keyBadge = el('span', {
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        minWidth: '20px', height: '20px',
        padding: '0 5px',
        fontSize: '10px', fontWeight: '500', fontFamily: 'monospace',
        color: TEXT_PRIMARY,
        background: 'rgba(255,255,255,0.08)',
        border: `1px solid ${GLASS_BORDER}`,
        borderRadius: '4px',
        lineHeight: '1',
      });
      keyBadge.textContent = shortcut.icon ?? getKeyDisplay(shortcut.key);

      const label = el('span', {
        fontSize: '10px', color: TEXT_DIM, fontFamily: FONT,
        whiteSpace: 'nowrap',
      });
      label.textContent = shortcut.label;

      item.append(keyBadge, label);
      container.appendChild(item);
    }
  }

  return {
    element: container,

    setShortcuts(newShortcuts: KeyboardShortcut[]) {
      shortcuts = newShortcuts;
      render();
    },

    show() {
      visible = true;
      container.style.display = 'flex';
    },

    hide() {
      visible = false;
      container.style.display = 'none';
    },

    isVisible: () => visible,

    destroy() {
      container.remove();
    },
  };
}

export function getBaseShortcuts(isDevMode: boolean): KeyboardShortcut[] {
  const shortcuts: KeyboardShortcut[] = [
    { key: 'Space', label: 'Toggle', tooltip: 'Show/hide controls' },
    { key: 'Escape', label: 'Close', tooltip: 'Close panel' },
  ];

  if (isDevMode) {
    shortcuts.push({
      key: 'R',
      label: 'Refresh',
      icon: isMac ? '\u2318R' : 'Ctrl+R',
      tooltip: 'Full page reload',
    });
  }

  return shortcuts;
}

export function getVisualizerShortcuts(vizType: string): KeyboardShortcut[] {
  if (vizType.startsWith('orbital-gamma') || vizType === 'orbital-gamma') {
    return [
      { key: 'Click', label: 'Attractor', tooltip: 'Place an attractor force field', icon: '+' },
      { key: 'Right-click', label: 'Repulsor', tooltip: 'Place a repulsor force field', icon: '\u2212' },
    ];
  }
  return [];
}
