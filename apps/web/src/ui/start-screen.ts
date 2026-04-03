import { el, glassButton } from './components.js';

export interface StartScreen {
  element: HTMLElement;
  onStart(handler: () => void): void;
  hide(): void;
}

export function createStartScreen(): StartScreen {
  let startHandler: (() => void) | null = null;

  const screen = el('div', {
    position: 'fixed',
    inset: '0',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: '200',
    transition: 'opacity 0.6s ease',
  });

  const btn = glassButton('Start', { large: true, accent: true });
  btn.style.letterSpacing = '0.25em';
  btn.style.textTransform = 'uppercase';
  btn.animate([
    { boxShadow: '0 0 20px rgba(140, 160, 255, 0.15)' },
    { boxShadow: '0 0 40px rgba(140, 160, 255, 0.3)' },
    { boxShadow: '0 0 20px rgba(140, 160, 255, 0.15)' },
  ], { duration: 3000, iterations: Infinity });

  btn.addEventListener('click', () => { if (startHandler) startHandler(); });
  screen.appendChild(btn);
  document.body.appendChild(screen);

  return {
    element: screen,
    onStart(h) { startHandler = h; },
    hide() {
      screen.style.opacity = '0';
      screen.style.pointerEvents = 'none';
      setTimeout(() => { screen.style.display = 'none'; }, 600);
    },
  };
}
