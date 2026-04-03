import { listVisualizers } from '@cybernoetica/renderer';
import { glassButton, sectionLabel, el } from '../components.js';
import { TEXT_DIM } from '../styles.js';

export interface VisualPanelOpts {
  currentVizType: string;
  onRandomViz: (() => void) | null;
  onVizChange: ((type: string) => void) | null;
  onClose: () => void;
  appearanceRenderer: ((container: HTMLElement) => void) | null;
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
