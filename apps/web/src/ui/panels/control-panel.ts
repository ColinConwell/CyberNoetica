import { el, sectionLabel, sectionDivider } from '../components.js';
import { ACCENT, GLASS_BG, GLASS_BORDER, TEXT_DIM, TEXT_SECONDARY } from '../styles.js';
import type { AppSettings } from '../styles.js';
import { isDebugEnabled, renderDebugPanel } from './debug-panel.js';

export interface ControlPanelOpts {
  settings: AppSettings;
  controlBar: HTMLElement;
  onSettingsChange: ((s: AppSettings) => void) | null;
  onResetFade: () => void;
  onDebugCleanup?: (cleanup: () => void) => void;
}

export function renderControlPanel(panel: HTMLElement, opts: ControlPanelOpts): void {
  panel.innerHTML = '';
  panel.appendChild(sectionLabel('Interface'));

  // Menu fade delay
  const fadeRow = el('div', {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    marginBottom: '14px', fontSize: '12px', color: TEXT_SECONDARY,
  });
  const fadeLabel = el('span', {});
  fadeLabel.textContent = 'Menu fade delay';
  const fadeValue = el('div', { display: 'flex', alignItems: 'center', gap: '8px' });
  const fadeSlider = el('input', { width: '100px', accentColor: ACCENT },
    { type: 'range', min: '2', max: '30', step: '1', value: String(opts.settings.menuFadeDelay) });
  const fadeNum = el('span', { fontSize: '11px', color: TEXT_DIM, minWidth: '28px' });
  fadeNum.textContent = `${opts.settings.menuFadeDelay}s`;
  fadeSlider.addEventListener('input', () => {
    opts.settings.menuFadeDelay = Number((fadeSlider as HTMLInputElement).value);
    fadeNum.textContent = `${opts.settings.menuFadeDelay}s`;
    if (opts.onSettingsChange) opts.onSettingsChange(opts.settings);
    opts.onResetFade();
  });
  fadeValue.append(fadeSlider, fadeNum);
  fadeRow.append(fadeLabel, fadeValue);
  panel.appendChild(fadeRow);

  // Menu opacity
  const opacRow = el('div', {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    marginBottom: '14px', fontSize: '12px', color: TEXT_SECONDARY,
  });
  const opacLabel = el('span', {});
  opacLabel.textContent = 'Menu opacity';
  const opacValue = el('div', { display: 'flex', alignItems: 'center', gap: '8px' });
  const opacSlider = el('input', { width: '100px', accentColor: ACCENT },
    { type: 'range', min: '50', max: '100', step: '5', value: String(Math.round(opts.settings.menuOpacity * 100)) });
  const opacNum = el('span', { fontSize: '11px', color: TEXT_DIM, minWidth: '28px' });
  opacNum.textContent = `${Math.round(opts.settings.menuOpacity * 100)}%`;
  opacSlider.addEventListener('input', () => {
    opts.settings.menuOpacity = Number((opacSlider as HTMLInputElement).value) / 100;
    opacNum.textContent = `${Math.round(opts.settings.menuOpacity * 100)}%`;
    opts.controlBar.style.background = GLASS_BG.replace('0.88', String(opts.settings.menuOpacity * 0.88 / 0.95));
    if (opts.onSettingsChange) opts.onSettingsChange(opts.settings);
  });
  opacValue.append(opacSlider, opacNum);
  opacRow.append(opacLabel, opacValue);
  panel.appendChild(opacRow);

  panel.appendChild(sectionDivider());
  panel.appendChild(sectionLabel('Keyboard'));
  const shortcuts = el('div', { fontSize: '12px', color: TEXT_DIM, lineHeight: '1.8' });
  shortcuts.innerHTML = `
    <div><span style="color:${TEXT_SECONDARY}">Space</span> — Toggle controls</div>
    <div><span style="color:${TEXT_SECONDARY}">Escape</span> — Close panel</div>
  `;
  panel.appendChild(shortcuts);

  if (isDebugEnabled()) {
    panel.appendChild(sectionDivider());
    const debugSection = el('div', {
      paddingTop: '4px',
    });
    const cleanup = renderDebugPanel(debugSection);
    if (opts.onDebugCleanup) opts.onDebugCleanup(cleanup);
    panel.appendChild(debugSection);
  }
}
