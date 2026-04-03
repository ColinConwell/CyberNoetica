import { FONT, GLASS_BORDER, TEXT_PRIMARY, TEXT_DIM, TRANSITION } from './styles.js';

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  styles: Partial<CSSStyleDeclaration>,
  attrs?: Record<string, string>,
): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  Object.assign(e.style, styles);
  if (attrs) for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  return e;
}

export function glassButton(
  label: string,
  opts: { active?: boolean; accent?: boolean; large?: boolean } = {},
): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.textContent = label;
  const isActive = opts.active ?? false;
  const isLarge = opts.large ?? false;
  Object.assign(btn.style, {
    padding: isLarge ? '12px 28px' : '7px 16px',
    background: isActive ? 'rgba(255, 255, 255, 0.18)' : 'rgba(255, 255, 255, 0.06)',
    color: TEXT_PRIMARY,
    border: `1px solid ${isActive ? 'rgba(255, 255, 255, 0.3)' : GLASS_BORDER}`,
    borderRadius: '24px',
    fontFamily: FONT,
    fontSize: isLarge ? '14px' : '11.5px',
    fontWeight: isLarge ? '400' : '350',
    letterSpacing: isLarge ? '0.15em' : '0.06em',
    cursor: 'pointer',
    transition: TRANSITION,
    outline: 'none',
    whiteSpace: 'nowrap',
  });
  if (opts.accent) {
    btn.style.background = 'rgba(140, 160, 255, 0.15)';
    btn.style.borderColor = 'rgba(140, 160, 255, 0.6)';
  }
  btn.addEventListener('mouseenter', () => {
    btn.style.background = opts.accent
      ? 'rgba(140, 160, 255, 0.25)'
      : 'rgba(255, 255, 255, 0.22)';
    btn.style.borderColor = 'rgba(255, 255, 255, 0.35)';
  });
  btn.addEventListener('mouseleave', () => {
    const a = btn.dataset.active === 'true';
    btn.style.background = opts.accent
      ? 'rgba(140, 160, 255, 0.15)'
      : a ? 'rgba(255, 255, 255, 0.18)' : 'rgba(255, 255, 255, 0.06)';
    btn.style.borderColor = a ? 'rgba(255, 255, 255, 0.3)' : GLASS_BORDER;
  });
  btn.dataset.active = String(isActive);
  return btn;
}

export function setButtonActive(btn: HTMLButtonElement, active: boolean): void {
  btn.dataset.active = String(active);
  btn.style.background = active ? 'rgba(255, 255, 255, 0.18)' : 'rgba(255, 255, 255, 0.06)';
  btn.style.borderColor = active ? 'rgba(255, 255, 255, 0.3)' : GLASS_BORDER;
}

export function sectionLabel(text: string): HTMLDivElement {
  const lbl = el('div', {
    fontSize: '10px',
    fontWeight: '500',
    letterSpacing: '0.2em',
    textTransform: 'uppercase',
    color: TEXT_DIM,
    fontFamily: FONT,
    marginBottom: '10px',
  });
  lbl.textContent = text;
  return lbl;
}
