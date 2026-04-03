import { el, glassButton } from './components.js';
import { GLASS_BG, GLASS_BLUR, GLASS_BORDER } from './styles.js';

export interface ControlBarAPI {
  bar: HTMLElement;
  pauseBtn: HTMLButtonElement;
  visualBtn: HTMLButtonElement;
  soundBtn: HTMLButtonElement;
  controlBtn: HTMLButtonElement;
  show(): void;
}

export function createControlBar(): ControlBarAPI {
  const bar = el('div', {
    position: 'fixed',
    bottom: '32px',
    left: '50%',
    transform: 'translateX(-50%)',
    display: 'none',
    gap: '8px',
    alignItems: 'center',
    padding: '10px 16px',
    background: GLASS_BG,
    backdropFilter: GLASS_BLUR,
    WebkitBackdropFilter: GLASS_BLUR,
    border: `1px solid ${GLASS_BORDER}`,
    borderRadius: '40px',
    zIndex: '100',
    transition: 'opacity 0.4s ease',
    opacity: '1',
  });
  document.body.appendChild(bar);

  const pauseBtn = glassButton('Pause');
  const visualBtn = glassButton('Visual');
  const soundBtn = glassButton('Sound');
  const controlBtn = glassButton('Control');

  const divider = () => el('div', {
    width: '1px', height: '20px',
    background: 'rgba(255, 255, 255, 0.1)', margin: '0 2px',
  });

  bar.append(pauseBtn, divider(), visualBtn, soundBtn, divider(), controlBtn);

  return {
    bar, pauseBtn, visualBtn, soundBtn, controlBtn,
    show() {
      bar.style.display = 'flex';
      bar.style.opacity = '1';
    },
  };
}
