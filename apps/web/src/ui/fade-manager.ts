export interface FadeManagerOpts {
  controlBar: HTMLElement;
  panel: HTMLElement;
  getActivePanel: () => string | null;
  getIsPlaying: () => boolean;
  getFadeDelay: () => number;
}

export interface FadeManager {
  show(): void;
  hide(): void;
  reset(): void;
  isVisible(): boolean;
  destroy(): void;
}

export function createFadeManager(opts: FadeManagerOpts): FadeManager {
  let fadeTimer: ReturnType<typeof setTimeout> | null = null;
  let barVisible = true;

  function show() {
    if (!barVisible) {
      opts.controlBar.style.opacity = '1';
      opts.controlBar.style.pointerEvents = 'auto';
      barVisible = true;
    }
    if (opts.getIsPlaying()) reset();
  }

  function hide() {
    if (opts.getActivePanel()) return;
    opts.controlBar.style.opacity = '0';
    opts.controlBar.style.pointerEvents = 'none';
    barVisible = false;
  }

  function reset() {
    if (fadeTimer) clearTimeout(fadeTimer);
    fadeTimer = setTimeout(hide, opts.getFadeDelay() * 1000);
  }

  const onMouseMove = (e: MouseEvent) => {
    if (e.clientY > window.innerHeight * 0.82) show();
  };
  const onClick = () => {
    if (!barVisible && opts.controlBar.style.display === 'flex') show();
  };
  const onKeyDown = (e: KeyboardEvent) => {
    if (opts.controlBar.style.display === 'flex') show();
    if (e.key === 'Escape' && opts.getActivePanel()) {
      // closePanel is handled by index.ts via the Escape key path
    }
    if (e.code === 'Space' && e.target === document.body) {
      e.preventDefault();
      if (barVisible && !opts.getActivePanel()) hide();
      else show();
    }
  };

  document.addEventListener('mousemove', onMouseMove);
  document.addEventListener('click', onClick);
  document.addEventListener('keydown', onKeyDown);

  opts.controlBar.addEventListener('mouseenter', () => { if (fadeTimer) clearTimeout(fadeTimer); });
  opts.controlBar.addEventListener('mouseleave', reset);
  opts.panel.addEventListener('mouseenter', () => { if (fadeTimer) clearTimeout(fadeTimer); });
  opts.panel.addEventListener('mouseleave', reset);

  return {
    show,
    hide,
    reset,
    isVisible: () => barVisible,
    destroy() {
      if (fadeTimer) clearTimeout(fadeTimer);
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('click', onClick);
      document.removeEventListener('keydown', onKeyDown);
    },
  };
}
