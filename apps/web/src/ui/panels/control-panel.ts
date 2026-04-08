import { el, sectionLabel, sectionDivider, toggleSwitch } from '../components.js';
import { ACCENT, GLASS_BORDER, FONT, TEXT_DIM, TEXT_PRIMARY, TEXT_SECONDARY, glassBackground } from '../styles.js';
import type { AppSettings } from '../styles.js';
import { isDebugEnabled, renderDebugPanel } from './debug-panel.js';
import '../../globals.js';

export interface ControlPanelOpts {
  settings: AppSettings;
  controlBar: HTMLElement;
  onSettingsChange: ((s: AppSettings) => void) | null;
  onResetFade: () => void;
  onDebugCleanup?: (cleanup: () => void) => void;
  onEnergyCleanup?: (cleanup: () => void) => void;
  keyboardOverlayVisible?: boolean;
  onKeyboardOverlayToggle?: (visible: boolean) => void;
}

export function renderControlPanel(panel: HTMLElement, opts: ControlPanelOpts): void {
  panel.innerHTML = '';

  // ── Keyboard ────────────────────────────────────────────────────
  panel.appendChild(sectionLabel('Keyboard'));
  const shortcuts = el('div', { fontSize: '12px', color: TEXT_DIM, lineHeight: '1.8', marginBottom: '8px' });
  shortcuts.innerHTML = `
    <div><span style="color:${TEXT_SECONDARY}">Space</span> — Toggle controls</div>
    <div><span style="color:${TEXT_SECONDARY}">Escape</span> — Close panel</div>
    <div><span style="color:${TEXT_SECONDARY}">R</span> — Reset visualizer</div>
  `;
  panel.appendChild(shortcuts);

  const overlayToggle = toggleSwitch({
    checked: opts.keyboardOverlayVisible ?? true,
    label: 'Show shortcut bar',
    onChange(checked) {
      if (opts.onKeyboardOverlayToggle) opts.onKeyboardOverlayToggle(checked);
    },
  });
  panel.appendChild(overlayToggle);

  panel.appendChild(sectionDivider());

  // ── Interface ───────────────────────────────────────────────────
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
    opts.controlBar.style.background = glassBackground(opts.settings.menuOpacity * 0.88 / 0.95);
    if (opts.onSettingsChange) opts.onSettingsChange(opts.settings);
  });
  opacValue.append(opacSlider, opacNum);
  opacRow.append(opacLabel, opacValue);
  panel.appendChild(opacRow);

  panel.appendChild(sectionDivider());

  // ── Energy / Performance ────────────────────────────────────────
  panel.appendChild(sectionLabel('Performance'));

  const energyCleanup = renderEnergySection(panel);
  if (opts.onEnergyCleanup) opts.onEnergyCleanup(energyCleanup);

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

function renderEnergySection(container: HTMLElement): () => void {
  const globals = window.__cybernoetica;
  const debugInfo = () => window.__cybernoetica_debug ?? null;

  function makeStatRow(label: string) {
    const row = el('div', {
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      marginBottom: '8px', fontSize: '11px', color: TEXT_SECONDARY,
    });
    const lbl = el('span', { color: TEXT_DIM });
    lbl.textContent = label;
    const val = el('span', { color: TEXT_PRIMARY, fontFamily: 'monospace', fontSize: '11px' });
    row.append(lbl, val);
    return { row, val };
  }

  function makeBar() {
    const outer = el('div', {
      height: '6px', borderRadius: '3px', background: 'rgba(255,255,255,0.06)',
      overflow: 'hidden', marginBottom: '8px',
    });
    const inner = el('div', {
      height: '100%', borderRadius: '3px', transition: 'width 0.3s ease, background 0.3s ease',
      width: '0%', background: ACCENT,
    });
    outer.appendChild(inner);
    return { outer, inner };
  }

  // FPS row with target
  const fpsRow = makeStatRow('FPS');
  container.appendChild(fpsRow.row);

  // Frame budget bar
  const budgetLabel = el('div', {
    display: 'flex', justifyContent: 'space-between', fontSize: '11px',
    color: TEXT_DIM, marginBottom: '4px',
  });
  const budgetLabelText = el('span', {});
  budgetLabelText.textContent = 'Frame budget';
  const budgetVal = el('span', { fontFamily: 'monospace', color: TEXT_PRIMARY });
  budgetLabel.append(budgetLabelText, budgetVal);
  container.appendChild(budgetLabel);
  const frameBudget = makeBar();
  container.appendChild(frameBudget.outer);

  // Power level indicator with scalar percentage
  const powerRow = makeStatRow('Power draw');
  container.appendChild(powerRow.row);

  // GPU stats
  const drawCallsRow = makeStatRow('Draw calls');
  container.appendChild(drawCallsRow.row);
  const trianglesRow = makeStatRow('Triangles');
  container.appendChild(trianglesRow.row);

  // GPU info (renderer name)
  const gpuRow = makeStatRow('GPU');
  container.appendChild(gpuRow.row);
  try {
    const renderer = globals?.scene?.getRenderer?.();
    if (renderer) {
      const gl = renderer.getContext();
      const ext = gl.getExtension('WEBGL_debug_renderer_info');
      if (ext) {
        const gpuName = gl.getParameter(ext.UNMASKED_RENDERER_WEBGL);
        gpuRow.val.textContent = gpuName.length > 30 ? gpuName.substring(0, 28) + '\u2026' : gpuName;
        gpuRow.val.title = gpuName;
      } else {
        gpuRow.val.textContent = 'WebGL';
      }
    } else {
      gpuRow.val.textContent = '\u2014';
    }
  } catch {
    gpuRow.val.textContent = '\u2014';
  }

  // GPU memory (textures + geometries)
  const gpuMemRow = makeStatRow('GPU objects');
  container.appendChild(gpuMemRow.row);

  // CPU info
  const cpuRow = makeStatRow('CPU threads');
  container.appendChild(cpuRow.row);
  const cores = navigator.hardwareConcurrency ?? 0;
  const wasmActive = globals?.store?.getState?.()?.audio?.wasm ?? false;
  cpuRow.val.textContent = cores > 0 ? `${cores} cores${wasmActive ? ' + WASM' : ''}` : '\u2014';

  // Memory (Chrome only)
  const hasMemory = !!(performance as any).memory;
  let memoryBar: ReturnType<typeof makeBar> | null = null;
  let memoryValEl: HTMLElement | null = null;
  if (hasMemory) {
    const memLabel = el('div', {
      display: 'flex', justifyContent: 'space-between', fontSize: '11px',
      color: TEXT_DIM, marginBottom: '4px', marginTop: '4px',
    });
    const memLabelText = el('span', {});
    memLabelText.textContent = 'JS Heap';
    memoryValEl = el('span', { fontFamily: 'monospace', color: TEXT_PRIMARY });
    memLabel.append(memLabelText, memoryValEl);
    container.appendChild(memLabel);
    memoryBar = makeBar();
    container.appendChild(memoryBar.outer);
  }

  // Power saver toggle
  const powerSaverContainer = el('div', {
    marginTop: '6px', marginBottom: '4px',
  });
  const isPowerSaver = globals?.powerSaver ?? false;
  const powerSaverToggle = toggleSwitch({
    checked: isPowerSaver,
    label: 'Power saver (30 fps)',
    onChange(checked) {
      if (globals?.setPowerSaver) globals.setPowerSaver(checked);
    },
  });
  powerSaverContainer.appendChild(powerSaverToggle);
  container.appendChild(powerSaverContainer);

  const interval = setInterval(() => {
    const info = debugInfo();
    const frameTime = info?.frameTime ?? 0;
    const isPowerSaverActive = globals?.powerSaver ?? false;
    const targetMs = isPowerSaverActive ? 33.33 : 16.67;
    const targetFps = isPowerSaverActive ? 30 : 60;
    const usage = Math.min(frameTime / targetMs, 2.0);
    const pct = Math.round(usage * 100);

    // FPS with target
    fpsRow.val.textContent = `${info?.fps ?? 0} / ${targetFps}`;

    budgetVal.textContent = `${frameTime.toFixed(1)}ms / ${targetMs.toFixed(1)}ms (${pct}%)`;
    frameBudget.inner.style.width = `${Math.min(pct, 100)}%`;

    if (usage < 0.5) {
      frameBudget.inner.style.background = 'rgba(100, 220, 120, 0.6)';
      powerRow.val.textContent = `Low (${pct}%)`;
      powerRow.val.style.color = 'rgba(100, 220, 120, 0.8)';
    } else if (usage < 0.8) {
      frameBudget.inner.style.background = 'rgba(220, 200, 80, 0.6)';
      powerRow.val.textContent = `Medium (${pct}%)`;
      powerRow.val.style.color = 'rgba(220, 200, 80, 0.8)';
    } else {
      frameBudget.inner.style.background = 'rgba(220, 80, 80, 0.6)';
      powerRow.val.textContent = `High (${pct}%)`;
      powerRow.val.style.color = 'rgba(220, 80, 80, 0.8)';
    }

    const rendererInfo = globals?.scene?.getRendererInfo?.();
    if (rendererInfo) {
      const r = rendererInfo.render;
      drawCallsRow.val.textContent = String(r.calls);
      trianglesRow.val.textContent = r.triangles > 1000
        ? `${(r.triangles / 1000).toFixed(1)}k` : String(r.triangles);

      const mem = rendererInfo.memory;
      if (mem) {
        gpuMemRow.val.textContent = `${mem.geometries}g / ${mem.textures}t`;
      }
    } else {
      drawCallsRow.val.textContent = '\u2014';
      trianglesRow.val.textContent = '\u2014';
      gpuMemRow.val.textContent = '\u2014';
    }

    if (hasMemory && memoryBar && memoryValEl) {
      const mem = (performance as any).memory;
      const usedMB = Math.round(mem.usedJSHeapSize / 1048576);
      const totalMB = Math.round(mem.jsHeapSizeLimit / 1048576);
      const memPct = Math.round((mem.usedJSHeapSize / mem.jsHeapSizeLimit) * 100);
      memoryValEl.textContent = `${usedMB}MB / ${totalMB}MB`;
      memoryBar.inner.style.width = `${memPct}%`;
      memoryBar.inner.style.background = memPct > 80
        ? 'rgba(220, 80, 80, 0.6)' : ACCENT;
    }
  }, 500);

  return () => clearInterval(interval);
}
