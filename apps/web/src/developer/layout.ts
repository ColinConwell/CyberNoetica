import { getAppSurface, getStudioControls } from '../ui/surface.js';
import { field, selectControl } from '../ui/journey-controls.js';
import { el } from '../ui/components.js';

const placements = [
  'above',
  'in-bar',
  'top-left',
  'top-right',
  'bottom-left',
  'bottom-right',
] as const;
export interface LayoutPreferences {
  layout?: string;
  launcher?: string;
  dockWidth?: number;
  dockHeight?: number;
  sizes?: Record<string, { span: number; height: number }>;
}
export function mountWorkbenchLayout(
  root: HTMLElement,
  launch: HTMLButtonElement,
  toolbar: HTMLElement,
  prefs: LayoutPreferences,
  save: () => void,
) {
  const surface = getAppSurface();
  const group = getStudioControls();
  group.prepend(launch);
  const layouts = [
    ['dock', 'Overlay'],
    ['wide', 'Wide Overlay'],
    ['left', 'Left Sidebar'],
    ['right', 'Right Sidebar'],
    ['top', 'Top Panel'],
    ['bottom', 'Bottom Panel'],
  ] as Array<[string, string]>;
  root.dataset.layout = layouts.some(([id]) => id === prefs.layout)
    ? prefs.layout
    : 'dock';
  root.dataset.launcher = placements.includes(
    prefs.launcher as (typeof placements)[number],
  )
    ? prefs.launcher
    : 'above';
  let dockWidth = Number.isFinite(prefs.dockWidth) ? prefs.dockWidth! : 440;
  let dockHeight = Number.isFinite(prefs.dockHeight)
    ? prefs.dockHeight!
    : Math.round(innerHeight * 0.52);
  const layout = selectControl(layouts, root.dataset.layout!, (value) => {
    root.dataset.layout = value;
    apply();
    save();
  });
  layout.setAttribute('aria-label', 'Workbench layout');
  const position = selectControl(
    [
      ['above', 'Above Controls'],
      ['in-bar', 'In Control Bar'],
      ['top-left', 'Top Left'],
      ['top-right', 'Top Right'],
      ['bottom-left', 'Bottom Left'],
      ['bottom-right', 'Bottom Right'],
    ],
    root.dataset.launcher!,
    (value) => {
      root.dataset.launcher = value;
      placeLauncher();
      save();
    },
  );
  position.setAttribute('aria-label', 'Studio Controls Position');
  const size = el(
    'input',
    {},
    { type: 'range', 'aria-label': 'Dock size', step: '10' },
  );
  const sizeField = field('Dock size', size);
  sizeField.classList.add('dev-dock-size');
  size.oninput = () => {
    if (['left', 'right'].includes(root.dataset.layout!))
      dockWidth = Number(size.value);
    else dockHeight = Number(size.value);
    apply();
    save();
  };
  toolbar.append(layout, position, sizeField);
  function placeLauncher() {
    const place = root.dataset.launcher!;
    surface.dataset.devLauncher = place;
    group.dataset.position = place;
    const bar = document.getElementById('control-bar');
    (place === 'in-bar' && bar ? bar : surface).append(group);
    window.dispatchEvent(new Event('cybernoetica:layout'));
  }
  function apply() {
    const mode = root.dataset.layout!;
    const side = mode === 'left' || mode === 'right',
      horizontal = mode === 'top' || mode === 'bottom';
    const max = side
      ? Math.max(220, innerWidth - 150)
      : Math.max(240, innerHeight - 200);
    const minimum = side
      ? 220
      : Math.min(
          max,
          (root.querySelector('header')?.getBoundingClientRect().height ??
            150) + 190,
        );
    const pixels = Math.max(
      minimum,
      Math.min(max, side ? dockWidth : dockHeight),
    );
    size.min = String(Math.ceil(minimum));
    size.max = String(max);
    size.value = String(pixels);
    sizeField.hidden = !side && !horizontal;
    root.style.setProperty('--dock-size', pixels + 'px');
    root.style.setProperty(
      '--dock-header-height',
      `${root.querySelector('header')?.getBoundingClientRect().height ?? 120}px`,
    );
    for (const edge of ['left', 'right', 'top', 'bottom'] as const)
      surface.style[edge] =
        !root.hidden && mode === edge ? pixels + 'px' : '0px';
    surface.dataset.displaced = String(!root.hidden && (side || horizontal));
    window.dispatchEvent(new Event('cybernoetica:layout'));
  }
  const observer = new MutationObserver(apply);
  observer.observe(root, { attributes: true, attributeFilter: ['hidden'] });
  window.addEventListener('resize', apply);
  placeLauncher();
  apply();
  return {
    values: () => ({ launcher: root.dataset.launcher, dockWidth, dockHeight }),
    apply,
    destroy() {
      observer.disconnect();
      window.removeEventListener('resize', apply);
      for (const edge of ['left', 'right', 'top', 'bottom'] as const)
        surface.style[edge] = '0px';
      group.dataset.position = 'above';
      surface.dataset.devLauncher = 'above';
      surface.append(group);
      delete surface.dataset.displaced;
      window.dispatchEvent(new Event('cybernoetica:layout'));
    },
  };
}

/** Pointer handles support mouse and touch; arrow keys provide the same reorder/resize actions. */
export function sectionGestures(
  section: HTMLDetailsElement,
  handle: HTMLButtonElement,
  resize: HTMLButtonElement,
  body: HTMLElement,
  root: HTMLElement,
  save: () => void,
  announce: (message: string) => void,
) {
  let stop: (() => void) | undefined;
  function begin(event: PointerEvent, kind: 'move' | 'resize') {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    const start = section.getBoundingClientRect(),
      x = event.clientX,
      y = event.clientY;
    const original = [...body.children];
    const previousSpan = section.style.getPropertyValue('--section-span'),
      previousHeight = section.style.getPropertyValue('--section-height');
    const grip = kind === 'move' ? handle : resize;
    grip.setPointerCapture(event.pointerId);
    section.classList.add('dev-dragging');
    let pointerY = y;
    let scrollFrame = 0;
    const scroll = () => {
      const bounds = body.getBoundingClientRect();
      if (kind === 'move')
        body.scrollTop +=
          pointerY < bounds.top + 35
            ? -8
            : pointerY > bounds.bottom - 35
              ? 8
              : 0;
      scrollFrame = requestAnimationFrame(scroll);
    };
    scrollFrame = requestAnimationFrame(scroll);
    const motion = (e: PointerEvent) => {
      pointerY = e.clientY;
      if (kind === 'resize') {
        const column = body.clientWidth / 12;
        const span = Math.max(
          3,
          Math.min(12, Math.round((start.width + e.clientX - x) / column)),
        );
        section.style.setProperty('--section-span', String(span));
        section.style.setProperty(
          '--section-height',
          Math.max(160, Math.min(900, start.height + e.clientY - y)) + 'px',
        );
      } else {
        const over = document
          .elementFromPoint(e.clientX, e.clientY)
          ?.closest<HTMLDetailsElement>('.dev-section');
        if (!over || over === section || over.parentElement !== body) return;
        const r = over.getBoundingClientRect(),
          grid = ['top', 'bottom', 'wide'].includes(root.dataset.layout ?? '');
        const after = grid
          ? e.clientY > r.top + r.height * 0.65 ||
            e.clientX > r.left + r.width / 2
          : e.clientY > r.top + r.height / 2;
        body.insertBefore(section, after ? over.nextSibling : over);
        grip.setPointerCapture(e.pointerId);
      }
    };
    const finish = (cancel = false) => {
      cancelAnimationFrame(scrollFrame);
      if (cancel) {
        original.forEach((child) => body.append(child));
        section.style.setProperty('--section-span', previousSpan);
        section.style.setProperty('--section-height', previousHeight);
      }
      section.classList.remove('dev-dragging');
      grip.removeEventListener('pointermove', motion);
      grip.removeEventListener('pointerup', up);
      grip.removeEventListener('pointercancel', cancelled);
      document.removeEventListener('keydown', key);
      window.removeEventListener('blur', cancelled);
      if (grip.hasPointerCapture(event.pointerId))
        grip.releasePointerCapture(event.pointerId);
      stop = undefined;
      if (!cancel) {
        save();
        announce(
          kind === 'move' ? 'Section order updated.' : 'Section size updated.',
        );
      }
    };
    const up = () => finish(),
      cancelled = () => finish(true),
      key = (e: KeyboardEvent) => {
        if (e.key === 'Escape') {
          e.stopImmediatePropagation();
          finish(true);
        }
      };
    grip.addEventListener('pointermove', motion);
    grip.addEventListener('pointerup', up);
    grip.addEventListener('pointercancel', cancelled);
    document.addEventListener('keydown', key);
    window.addEventListener('blur', cancelled);
    stop = () => finish(true);
  }
  handle.onpointerdown = (e) => begin(e, 'move');
  resize.onpointerdown = (e) => begin(e, 'resize');
  handle.onkeydown = (e) => {
    if (!['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key))
      return;
    e.preventDefault();
    e.stopPropagation();
    if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') {
      if (section.previousElementSibling)
        body.insertBefore(section, section.previousElementSibling);
    } else if (section.nextElementSibling)
      body.insertBefore(section.nextElementSibling, section);
    save();
    announce('Section order updated.');
  };
  resize.onkeydown = (e) => {
    if (!e.key.startsWith('Arrow')) return;
    e.preventDefault();
    e.stopPropagation();
    const r = section.getBoundingClientRect();
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      const span = Math.round(r.width / (body.clientWidth / 12));
      section.style.setProperty(
        '--section-span',
        String(
          Math.max(3, Math.min(12, span + (e.key === 'ArrowRight' ? 1 : -1))),
        ),
      );
    } else
      section.style.setProperty(
        '--section-height',
        Math.max(
          160,
          Math.min(900, r.height + (e.key === 'ArrowDown' ? 40 : -40)),
        ) + 'px',
      );
    save();
    announce('Section size updated.');
  };
  return () => stop?.();
}
