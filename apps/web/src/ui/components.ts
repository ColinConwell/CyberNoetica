import { FONT, GLASS_BORDER, TEXT_PRIMARY, TEXT_DIM, ACCENT } from './styles.js';

export type StyleDeclarationPatch = Partial<CSSStyleDeclaration> & {
  WebkitBackdropFilter?: string;
};

// ---------------------------------------------------------------------------
// Core Element Helper
// ---------------------------------------------------------------------------

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  styles: StyleDeclarationPatch,
  attrs?: Record<string, string>,
): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  Object.assign(e.style, styles);
  if (attrs) for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  return e;
}

// ---------------------------------------------------------------------------
// Glass Button
// ---------------------------------------------------------------------------

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
    transition: 'all 0.2s ease',
    outline: 'none',
    whiteSpace: 'nowrap',
    transform: 'scale(1)',
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
    btn.style.transform = 'scale(1.02)';
  });
  btn.addEventListener('mouseleave', () => {
    const a = btn.dataset.active === 'true';
    btn.style.background = opts.accent
      ? 'rgba(140, 160, 255, 0.15)'
      : a ? 'rgba(255, 255, 255, 0.18)' : 'rgba(255, 255, 255, 0.06)';
    btn.style.borderColor = a ? 'rgba(255, 255, 255, 0.3)' : GLASS_BORDER;
    btn.style.transform = 'scale(1)';
  });
  btn.addEventListener('mousedown', () => { btn.style.transform = 'scale(0.97)'; });
  btn.addEventListener('mouseup', () => { btn.style.transform = 'scale(1.02)'; });
  btn.dataset.active = String(isActive);
  return btn;
}

export function setButtonActive(btn: HTMLButtonElement, active: boolean): void {
  btn.dataset.active = String(active);
  btn.style.background = active ? 'rgba(255, 255, 255, 0.18)' : 'rgba(255, 255, 255, 0.06)';
  btn.style.borderColor = active ? 'rgba(255, 255, 255, 0.3)' : GLASS_BORDER;
}

// ---------------------------------------------------------------------------
// Section Label
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Toggle Switch (replaces checkboxes)
// ---------------------------------------------------------------------------

export interface ToggleSwitchOpts {
  checked?: boolean;
  label?: string;
  onChange?: (checked: boolean) => void;
}

export interface ToggleSwitchHandle extends HTMLElement {
  getChecked(): boolean;
  setChecked(value: boolean): void;
}

export function toggleSwitch(opts: ToggleSwitchOpts = {}): ToggleSwitchHandle {
  let checked = opts.checked ?? false;

  const container = el('label', {
    display: 'inline-flex', alignItems: 'center', gap: '8px',
    cursor: 'pointer', userSelect: 'none',
  });

  const track = el('div', {
    width: '32px', height: '16px', borderRadius: '8px',
    background: checked ? ACCENT : 'rgba(255, 255, 255, 0.1)',
    border: `1px solid ${checked ? 'rgba(140, 160, 255, 0.4)' : 'rgba(255, 255, 255, 0.15)'}`,
    position: 'relative', transition: 'all 0.25s ease',
    flexShrink: '0',
  });

  const thumb = el('div', {
    width: '12px', height: '12px', borderRadius: '50%',
    background: checked ? 'rgba(255, 255, 255, 0.95)' : 'rgba(255, 255, 255, 0.5)',
    position: 'absolute', top: '1px',
    left: checked ? '17px' : '1px',
    transition: 'all 0.25s ease',
    boxShadow: checked ? '0 0 6px rgba(140, 160, 255, 0.5)' : 'none',
  });
  track.appendChild(thumb);

  if (opts.label) {
    const labelEl = el('span', {
      fontSize: '12px', color: 'rgba(255, 255, 255, 0.5)',
      fontFamily: FONT,
    });
    labelEl.textContent = opts.label;
    container.append(track, labelEl);
  } else {
    container.appendChild(track);
  }

  function update() {
    track.style.background = checked ? ACCENT : 'rgba(255, 255, 255, 0.1)';
    track.style.borderColor = checked ? 'rgba(140, 160, 255, 0.4)' : 'rgba(255, 255, 255, 0.15)';
    thumb.style.left = checked ? '17px' : '1px';
    thumb.style.background = checked ? 'rgba(255, 255, 255, 0.95)' : 'rgba(255, 255, 255, 0.5)';
    thumb.style.boxShadow = checked ? '0 0 6px rgba(140, 160, 255, 0.5)' : 'none';
  }

  container.addEventListener('click', (e) => {
    e.preventDefault();
    checked = !checked;
    update();
    if (opts.onChange) opts.onChange(checked);
  });

  const handle = container as unknown as ToggleSwitchHandle;
  handle.getChecked = () => checked;
  handle.setChecked = (v: boolean) => { checked = v; update(); };

  return handle;
}

// ---------------------------------------------------------------------------
// Info Block (glass-morphism mini-card for key-value data)
// ---------------------------------------------------------------------------

export interface InfoBlockField {
  label: string;
  value: string;
  color?: string;
}

export function infoBlock(fields: InfoBlockField[]): HTMLElement {
  const container = el('div', {
    background: 'rgba(0, 0, 0, 0.25)',
    border: `1px solid ${GLASS_BORDER}`,
    borderRadius: '8px',
    padding: '8px 10px',
    marginBottom: '10px',
  });

  for (let i = 0; i < fields.length; i++) {
    const field = fields[i];
    const row = el('div', {
      display: 'flex', justifyContent: 'space-between', alignItems: 'baseline',
      padding: '2px 0',
      ...(i < fields.length - 1 ? { borderBottom: '1px solid rgba(255,255,255,0.04)' } : {}),
    });
    const label = el('span', {
      fontSize: '10px', color: TEXT_DIM, fontFamily: FONT,
    });
    label.textContent = field.label;
    const value = el('span', {
      fontSize: '10px', color: field.color || TEXT_PRIMARY,
      fontFamily: 'monospace', textAlign: 'right', maxWidth: '60%',
      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
    });
    value.textContent = field.value;
    row.append(label, value);
    container.appendChild(row);
  }

  return container;
}

export function updateInfoBlock(container: HTMLElement, fields: InfoBlockField[]): void {
  const rows = container.children;
  for (let i = 0; i < fields.length && i < rows.length; i++) {
    const row = rows[i] as HTMLElement;
    const valueEl = row.lastElementChild as HTMLElement;
    if (valueEl) {
      valueEl.textContent = fields[i].value;
      if (fields[i].color) valueEl.style.color = fields[i].color!;
    }
  }
}

// ---------------------------------------------------------------------------
// Section Label with Right-side Toggle
// ---------------------------------------------------------------------------

export function sectionLabelWithToggle(
  text: string,
  toggleLabels: string[],
  activeIndex: number,
  onToggle: (index: number) => void,
): HTMLElement {
  const row = el('div', {
    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
    marginBottom: '10px',
  });

  const lbl = el('span', {
    fontSize: '10px', fontWeight: '500', letterSpacing: '0.2em',
    textTransform: 'uppercase', color: TEXT_DIM, fontFamily: FONT,
  });
  lbl.textContent = text;

  const toggleGroup = el('div', {
    display: 'flex', borderRadius: '5px', overflow: 'hidden',
    border: `1px solid ${GLASS_BORDER}`,
  });

  const btns: HTMLElement[] = [];
  for (let i = 0; i < toggleLabels.length; i++) {
    const isActive = i === activeIndex;
    const btn = el('button', {
      padding: '2px 7px', fontSize: '9px', fontFamily: FONT,
      background: isActive ? 'rgba(255,255,255,0.15)' : 'rgba(255,255,255,0.03)',
      color: isActive ? TEXT_PRIMARY : TEXT_DIM,
      border: 'none', cursor: 'pointer', outline: 'none',
      transition: 'all 0.15s ease',
    });
    btn.textContent = toggleLabels[i];
    btn.addEventListener('click', () => {
      onToggle(i);
      btns.forEach((b, j) => {
        const active = j === i;
        b.style.background = active ? 'rgba(255,255,255,0.15)' : 'rgba(255,255,255,0.03)';
        b.style.color = active ? TEXT_PRIMARY : TEXT_DIM;
      });
    });
    btns.push(btn);
    toggleGroup.appendChild(btn);
  }

  row.append(lbl, toggleGroup);
  return row;
}

// ---------------------------------------------------------------------------
// Param Slider Row
// ---------------------------------------------------------------------------

export interface ParamSliderOpts {
  key: string;
  label: string;
  description?: string;
  min: number;
  max: number;
  step: number;
  initial: number;
  onChange: (key: string, value: number) => void;
}

export function paramSlider(opts: ParamSliderOpts): HTMLElement {
  const row = el('div', {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    marginBottom: '10px', fontSize: '12px', color: 'rgba(255,255,255,0.5)',
  });
  const label = el('span', {});
  label.textContent = opts.label;
  if (opts.description) label.title = opts.description;
  const right = el('div', { display: 'flex', alignItems: 'center', gap: '8px' });
  const slider = el('input', { width: '90px', accentColor: ACCENT },
    { type: 'range', min: String(opts.min), max: String(opts.max),
      step: String(opts.step), value: String(opts.initial) });
  const num = el('span', { fontSize: '10px', color: TEXT_DIM, minWidth: '36px', textAlign: 'right' });
  num.textContent = String(opts.initial);
  slider.addEventListener('input', () => {
    const val = Number((slider as HTMLInputElement).value);
    num.textContent = val < 0.01 ? val.toExponential(1) : String(Math.round(val * 1000) / 1000);
    opts.onChange(opts.key, val);
  });
  right.append(slider, num);
  row.append(label, right);
  return row;
}

// ---------------------------------------------------------------------------
// Section Divider (gradient line)
// ---------------------------------------------------------------------------

export function sectionDivider(): HTMLElement {
  return el('div', {
    height: '1px',
    background: 'linear-gradient(90deg, transparent, rgba(140, 160, 255, 0.2), transparent)',
    margin: '14px 0',
  });
}
