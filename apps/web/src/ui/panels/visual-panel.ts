import { listVisualizers } from '@cybernoetica/renderer';
import type { ViewStateField } from '@cybernoetica/renderer';
import { glassButton, sectionLabel, sectionDivider, el } from '../components.js';
import { TEXT_DIM, TEXT_SECONDARY, TEXT_PRIMARY, ACCENT, GLASS_BORDER, FONT } from '../styles.js';

export interface VisualPanelOpts {
  currentVizType: string;
  onRandomViz: (() => void) | null;
  onVizChange: ((type: string) => void) | null;
  onClose: () => void;
  appearanceRenderer: ((container: HTMLElement) => void) | null;
  viewStateFields: ViewStateField[];
  getViewState: () => Record<string, number>;
  setViewState: (partial: Record<string, number>) => void;
  onResetView: () => void;
}

export function renderVisualPanel(panel: HTMLElement, opts: VisualPanelOpts): void {
  panel.innerHTML = '';
  panel.appendChild(sectionLabel('Visualizer'));

  const fateBtn = glassButton('Let Fate Decide', { accent: true });
  fateBtn.style.width = '100%';
  fateBtn.style.marginBottom = '12px';
  fateBtn.addEventListener('click', () => {
    if (opts.onRandomViz) opts.onRandomViz();
    opts.onClose();
  });
  panel.appendChild(fateBtn);

  const vizOptions = listVisualizers();
  const grid = el('div', {
    display: 'flex', gap: '8px', justifyContent: 'center', flexWrap: 'wrap',
  });
  for (const viz of vizOptions) {
    const btn = glassButton(viz.label, { active: viz.type === opts.currentVizType });
    btn.title = viz.description;
    btn.addEventListener('click', () => {
      if (opts.onVizChange) opts.onVizChange(viz.type);
      opts.onClose();
    });
    grid.appendChild(btn);
  }
  panel.appendChild(grid);

  // ── View State section ──────────────────────────────────────────
  if (opts.viewStateFields.length > 0) {
    panel.appendChild(el('div', { height: '16px' }));
    panel.appendChild(sectionLabel('View'));

    const valueEls: Record<string, HTMLElement> = {};

    for (const field of opts.viewStateFields) {
      const row = el('div', {
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        marginBottom: '8px', fontSize: '12px',
        color: field.readOnly ? TEXT_DIM : TEXT_SECONDARY,
      });

      const label = el('span', {});
      label.textContent = field.label;

      const right = el('div', { display: 'flex', alignItems: 'center', gap: '6px' });

      const vs = opts.getViewState();
      const currentVal = vs[field.key] ?? 0;

      if (!field.readOnly) {
        const input = el('input', {
          width: '70px', padding: '2px 6px', fontSize: '10px',
          fontFamily: 'monospace',
          background: 'rgba(255,255,255,0.06)', color: TEXT_PRIMARY,
          border: `1px solid ${GLASS_BORDER}`, borderRadius: '4px',
          outline: 'none', textAlign: 'right',
        }, { type: 'number', step: String(field.step), min: String(field.min), max: String(field.max) }) as HTMLInputElement;
        input.value = formatNum(currentVal, field.step);
        input.addEventListener('change', () => {
          const val = parseFloat(input.value);
          if (!isNaN(val)) {
            opts.setViewState({ [field.key]: Math.max(field.min, Math.min(field.max, val)) });
          }
        });
        right.appendChild(input);
        valueEls[field.key] = input;
      } else {
        const val = el('span', {
          fontSize: '10px', fontFamily: 'monospace', color: TEXT_DIM,
          minWidth: '50px', textAlign: 'right',
        });
        val.textContent = formatNum(currentVal, field.step);
        right.appendChild(val);
        valueEls[field.key] = val;
      }

      row.append(label, right);
      panel.appendChild(row);
    }

    // Live update of view state values
    const updateInterval = setInterval(() => {
      const vs = opts.getViewState();
      for (const field of opts.viewStateFields) {
        const el = valueEls[field.key];
        if (!el) continue;
        const val = vs[field.key] ?? 0;
        if (field.readOnly || document.activeElement !== el) {
          if (el instanceof HTMLInputElement) {
            el.value = formatNum(val, field.step);
          } else {
            el.textContent = formatNum(val, field.step);
          }
        }
      }
    }, 250);

    // Store cleanup ref on the panel element
    (panel as any).__viewStateCleanup = () => clearInterval(updateInterval);

    const resetBtn = glassButton('Reset View');
    resetBtn.style.marginTop = '6px';
    resetBtn.style.fontSize = '10px';
    resetBtn.addEventListener('click', () => opts.onResetView());
    panel.appendChild(resetBtn);
  }

  // ── Appearance section ──────────────────────────────────────────
  panel.appendChild(el('div', { height: '16px' }));
  panel.appendChild(sectionLabel('Appearance'));
  if (opts.appearanceRenderer) {
    opts.appearanceRenderer(panel);
  } else {
    const placeholder = el('div', { color: TEXT_DIM, fontSize: '12px', padding: '4px 0' });
    placeholder.textContent = 'No controls available for this visualizer';
    panel.appendChild(placeholder);
  }
}

function formatNum(n: number, step: number): string {
  if (step >= 1) return String(Math.round(n));
  const decimals = Math.max(0, -Math.floor(Math.log10(step)));
  return n.toFixed(Math.min(decimals, 4));
}
