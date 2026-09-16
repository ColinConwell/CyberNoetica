import { getAppSurface, getStudioControls } from './surface.js';
export interface FadeManagerOpts {
  controlBar: HTMLElement;
  panel: HTMLElement;
  getActivePanel: () => string | null;
  getIsPlaying: () => boolean;
  getFadeDelay: () => number;
  getPinned?: () => boolean;
}
export interface FadeManager {
  show(): void;
  hide(): void;
  reset(): void;
  isVisible(): boolean;
  destroy(): void;
}
export function createFadeManager(opts: FadeManagerOpts): FadeManager {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let visible = true;
  const group = getStudioControls();
  const surfaces = [opts.controlBar, group];
  const interactive = [...surfaces, opts.panel];
  const hovering = new Set<HTMLElement>();
  const clear = () => {
    clearTimeout(timer);
    timer = undefined;
  };
  const protectedFocus = () =>
    interactive.some((e) => e.contains(document.activeElement));
  function paint(value: boolean) {
    visible = value;
    for (const element of surfaces) {
      element.style.opacity = value ? '1' : '0';
      element.style.pointerEvents = value ? 'auto' : 'none';
    }
  }
  function hide() {
    if (
      opts.getPinned?.() ||
      opts.getActivePanel() ||
      protectedFocus() ||
      hovering.size ||
      document.querySelector('.dev-workbench:not([hidden])')
    )
      return;
    paint(false);
  }
  function reset() {
    clear();
    if (opts.getPinned?.()) {
      paint(true);
      return;
    }
    if (opts.getIsPlaying())
      timer = setTimeout(hide, opts.getFadeDelay() * 1000);
  }
  function show() {
    paint(true);
    reset();
  }
  const onMouseMove = (e: MouseEvent) => {
    const bounds = getAppSurface().getBoundingClientRect();
    const box = group.getBoundingClientRect();
    const nearGroup =
      e.clientX >= box.left - 24 &&
      e.clientX <= box.right + 24 &&
      e.clientY >= box.top - 24 &&
      e.clientY <= box.bottom + 24;
    if (
      nearGroup ||
      (e.clientX >= bounds.left &&
        e.clientX <= bounds.right &&
        e.clientY > bounds.top + bounds.height * 0.82 &&
        e.clientY < bounds.bottom)
    )
      show();
  };
  const onClick = () => show();
  const onKeyDown = (e: KeyboardEvent) => {
    if (
      e.code === 'Space' &&
      (e.target === document.body ||
        (e.target instanceof HTMLCanvasElement && e.target.closest('#app'))) &&
      !opts.getPinned?.()
    ) {
      e.preventDefault();
      if (visible && !opts.getActivePanel()) hide();
      else show();
    } else show();
  };
  const cleanups: Array<() => void> = [];
  for (const element of interactive) {
    const enter = () => {
      hovering.add(element);
      show();
      clear();
    };
    const leave = () => {
      hovering.delete(element);
      reset();
    };
    const focus = () => {
      show();
      clear();
    };
    element.addEventListener('mouseenter', enter);
    element.addEventListener('mouseleave', leave);
    element.addEventListener('focusin', focus);
    element.addEventListener('focusout', reset);
    cleanups.push(() => {
      element.removeEventListener('mouseenter', enter);
      element.removeEventListener('mouseleave', leave);
      element.removeEventListener('focusin', focus);
      element.removeEventListener('focusout', reset);
    });
  }
  document.addEventListener('mousemove', onMouseMove);
  document.addEventListener('click', onClick);
  document.addEventListener('keydown', onKeyDown);
  return {
    show,
    hide,
    reset,
    isVisible: () => visible,
    destroy() {
      clear();
      cleanups.forEach((fn) => fn());
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('click', onClick);
      document.removeEventListener('keydown', onKeyDown);
    },
  };
}
