import { el } from './components.js';
export type MenuLayout = 'bubbles' | 'rows' | 'constellation';
export interface MenuPreferences {
  layout: MenuLayout;
  gap: number;
  columns: number;
  size: number;
}
const defaults: MenuPreferences = {
  layout: 'bubbles',
  gap: 8,
  columns: 2,
  size: 12,
};
export function getMenuPreferences(): MenuPreferences {
  try {
    const p = JSON.parse(localStorage.getItem('cybernoetica:menus:v1') ?? '{}');
    return {
      layout: ['bubbles', 'rows', 'constellation'].includes(p.layout)
        ? p.layout
        : defaults.layout,
      gap: Number.isFinite(p.gap)
        ? Math.max(2, Math.min(24, p.gap))
        : defaults.gap,
      columns: Number.isFinite(p.columns)
        ? Math.max(1, Math.min(4, Math.round(p.columns)))
        : defaults.columns,
      size: Number.isFinite(p.size)
        ? Math.max(10, Math.min(18, p.size))
        : defaults.size,
    };
  } catch {
    return { ...defaults };
  }
}
export function setMenuPreferences(patch: Partial<MenuPreferences>): void {
  const prefs = { ...getMenuPreferences(), ...patch };
  try {
    localStorage.setItem('cybernoetica:menus:v1', JSON.stringify(prefs));
  } catch {
    /* optional persistence */
  }
  applyMenuPreferences(prefs);
}
export function applyMenuPreferences(p = getMenuPreferences()): void {
  document.documentElement.dataset.menuLayout = p.layout;
  document.documentElement.style.setProperty('--menu-gap', `${p.gap}px`);
  document.documentElement.style.setProperty(
    '--menu-columns',
    String(p.columns),
  );
  document.documentElement.style.setProperty('--menu-size', `${p.size}px`);
}
export function menuLayoutPicker(): HTMLElement {
  const label = el('label', {
    display: 'flex',
    gap: '8px',
    alignItems: 'center',
    fontSize: '11px',
    marginBottom: '10px',
    color: '#b6bfd4',
  });
  label.textContent = 'Menu style';
  const select = el(
    'select',
    {
      background: '#171d2d',
      color: '#e2e8ff',
      borderRadius: '6px',
      padding: '5px',
    },
    { 'aria-label': 'Menu style' },
  );
  for (const [value, name] of [
    ['bubbles', 'Bubbles'],
    ['rows', 'Rows'],
    ['constellation', 'Constellation'],
  ]) {
    const option = el('option', {}, { value });
    option.textContent = name;
    select.append(option);
  }
  select.value = getMenuPreferences().layout;
  select.onchange = () =>
    setMenuPreferences({ layout: select.value as MenuLayout });
  label.append(select);
  return label;
}
