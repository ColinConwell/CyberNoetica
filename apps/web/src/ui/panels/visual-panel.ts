import {
  listVisualizers,
  getVisualizerDocumentation,
} from '@cybernoetica/renderer';
import type { ViewStateField } from '@cybernoetica/renderer';
import {
  glassButton,
  sectionLabel,
  sectionLabelWithToggle,
  sectionDivider,
  el,
} from '../components.js';
import {
  TEXT_DIM,
  TEXT_SECONDARY,
  TEXT_PRIMARY,
  ACCENT,
  GLASS_BORDER,
  FONT,
} from '../styles.js';

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

type VisualPanelElement = HTMLElement & {
  __viewStateCleanup?: () => void;
};

export function renderVisualPanel(
  panel: HTMLElement,
  opts: VisualPanelOpts,
): void {
  (panel as VisualPanelElement).__viewStateCleanup?.();
  panel.innerHTML = '';

  let vizViewMode: 'grid' | 'list' = 'grid';

  const vizHeader = sectionLabelWithToggle(
    'Visualizer',
    ['\u25A6', '\u2261'],
    0,
    (idx) => {
      vizViewMode = idx === 0 ? 'grid' : 'list';
      renderVizSelector();
    },
  );
  panel.appendChild(vizHeader);

  const fateBtn = glassButton('Let Fate Decide', { accent: true });
  fateBtn.style.width = '100%';
  fateBtn.style.marginBottom = '12px';
  fateBtn.addEventListener('click', () => {
    if (opts.onRandomViz) opts.onRandomViz();
    opts.onClose();
  });
  panel.appendChild(fateBtn);

  const vizOptions = listVisualizers();
  let query = '';
  const search = el(
    'input',
    {
      width: '100%',
      padding: '10px',
      marginBottom: '12px',
      color: TEXT_PRIMARY,
      background: 'rgba(255,255,255,.06)',
      border: `1px solid ${GLASS_BORDER}`,
      borderRadius: '8px',
    },
    {
      type: 'search',
      placeholder: 'Search visualizers',
      'aria-label': 'Search visualizers',
    },
  ) as HTMLInputElement;
  search.addEventListener('input', () => {
    query = search.value.trim().toLocaleLowerCase();
    renderVizSelector();
  });
  panel.appendChild(search);
  const vizContainer = el('div', {});
  panel.appendChild(vizContainer);

  function renderVizSelector() {
    vizContainer.innerHTML = '';
    if (
      !vizOptions.some((viz) =>
        `${viz.label} ${viz.description} ${viz.type}`
          .toLocaleLowerCase()
          .includes(query),
      )
    ) {
      const empty = el('p', { color: TEXT_SECONDARY }, { role: 'status' });
      empty.textContent = 'No visualizers match this search.';
      vizContainer.appendChild(empty);
      return;
    }

    if (vizViewMode === 'grid') {
      const grid = el('div', {
        display: 'flex',
        gap: '8px',
        justifyContent: 'center',
        flexWrap: 'wrap',
      });
      for (const viz of vizOptions.filter((viz) =>
        `${viz.label} ${viz.description} ${viz.type}`
          .toLocaleLowerCase()
          .includes(query),
      )) {
        const btn = glassButton(viz.label, {
          active: viz.type === opts.currentVizType,
        });
        btn.title = viz.description;
        btn.setAttribute(
          'aria-pressed',
          String(viz.type === opts.currentVizType),
        );
        btn.addEventListener('click', () => {
          if (opts.onVizChange) opts.onVizChange(viz.type);
          opts.onClose();
        });
        grid.appendChild(btn);
      }
      vizContainer.appendChild(grid);
    } else {
      const list = el('div', {
        display: 'flex',
        flexDirection: 'column',
        gap: '2px',
      });
      for (const viz of vizOptions.filter((viz) =>
        `${viz.label} ${viz.description} ${viz.type}`
          .toLocaleLowerCase()
          .includes(query),
      )) {
        const isActive = viz.type === opts.currentVizType;
        const row = el('button', {
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '6px 10px',
          borderRadius: '8px',
          cursor: 'pointer',
          background: isActive
            ? 'rgba(140, 160, 255, 0.12)'
            : 'rgba(255,255,255,0.03)',
          border: `1px solid ${isActive ? 'rgba(140, 160, 255, 0.3)' : 'transparent'}`,
          transition: 'all 0.15s ease',
        });
        row.setAttribute('type', 'button');
        row.setAttribute('aria-pressed', String(isActive));
        row.addEventListener('mouseenter', () => {
          if (!isActive) row.style.background = 'rgba(255,255,255,0.08)';
        });
        row.addEventListener('mouseleave', () => {
          if (!isActive) row.style.background = 'rgba(255,255,255,0.03)';
        });
        row.addEventListener('click', () => {
          if (opts.onVizChange) opts.onVizChange(viz.type);
          opts.onClose();
        });

        const nameEl = el('span', {
          fontSize: '12px',
          fontWeight: '400',
          color: isActive ? TEXT_PRIMARY : TEXT_SECONDARY,
        });
        nameEl.textContent = viz.label;

        const descEl = el('span', {
          fontSize: '10px',
          color: TEXT_DIM,
          maxWidth: '55%',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          textAlign: 'right',
        });
        descEl.textContent = viz.description;

        row.append(nameEl, descEl);
        list.appendChild(row);
      }
      vizContainer.appendChild(list);
    }
  }

  renderVizSelector();

  const documentation = getVisualizerDocumentation(opts.currentVizType);
  if (documentation) {
    const details = el('details', {
      marginTop: '16px',
      color: TEXT_SECONDARY,
      fontSize: '12px',
      lineHeight: '1.6',
    });
    const summary = el('summary', { cursor: 'pointer', color: TEXT_PRIMARY });
    summary.textContent = `About this model · ${documentation.modelClass ?? 'artistic'}`;
    const description = el('p', {});
    description.textContent = documentation.summary;
    details.append(summary, description);
    if (documentation.math) {
      const math = el('p', {});
      math.textContent = documentation.math;
      details.appendChild(math);
    }
    const inputs = el('p', {});
    inputs.textContent = `Sound inputs: ${documentation.audioInputsUsed.map((input) => (input === 'beat' ? 'onsets' : input.replaceAll('-', ' '))).join(', ')}.`;
    details.appendChild(inputs);
    for (const reference of documentation.references) {
      const link = el(
        'a',
        { color: ACCENT, display: 'block' },
        { href: reference.url, target: '_blank', rel: 'noopener noreferrer' },
      );
      link.textContent = reference.label;
      details.appendChild(link);
    }
    panel.appendChild(details);
  }

  // ── View State section ──────────────────────────────────────────
  if (opts.viewStateFields.length > 0) {
    panel.appendChild(el('div', { height: '16px' }));
    panel.appendChild(sectionLabel('View'));

    const valueEls: Record<string, HTMLElement> = {};

    for (const field of opts.viewStateFields) {
      const row = el('div', {
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginBottom: '8px',
        fontSize: '12px',
        color: field.readOnly ? TEXT_DIM : TEXT_SECONDARY,
      });

      const label = el('span', {});
      label.textContent = field.label;

      const right = el('div', {
        display: 'flex',
        alignItems: 'center',
        gap: '6px',
      });

      const vs = opts.getViewState();
      const currentVal = vs[field.key] ?? 0;

      if (!field.readOnly) {
        const input = el(
          'input',
          {
            width: '70px',
            padding: '2px 6px',
            fontSize: '10px',
            fontFamily: 'monospace',
            background: 'rgba(255,255,255,0.06)',
            color: TEXT_PRIMARY,
            border: `1px solid ${GLASS_BORDER}`,
            borderRadius: '4px',
            outline: 'none',
            textAlign: 'right',
          },
          {
            type: 'number',
            step: String(field.step),
            min: String(field.min),
            max: String(field.max),
          },
        ) as HTMLInputElement;
        input.setAttribute('aria-label', field.label);
        input.value = formatNum(currentVal, field.step);
        input.addEventListener('change', () => {
          const val = parseFloat(input.value);
          if (!isNaN(val)) {
            opts.setViewState({
              [field.key]: Math.max(field.min, Math.min(field.max, val)),
            });
          }
        });
        right.appendChild(input);
        valueEls[field.key] = input;
      } else {
        const val = el('span', {
          fontSize: '10px',
          fontFamily: 'monospace',
          color: TEXT_DIM,
          minWidth: '50px',
          textAlign: 'right',
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
    (panel as VisualPanelElement).__viewStateCleanup = () =>
      clearInterval(updateInterval);

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
    const placeholder = el('div', {
      color: TEXT_DIM,
      fontSize: '12px',
      padding: '4px 0',
    });
    placeholder.textContent = 'No controls available for this visualizer';
    panel.appendChild(placeholder);
  }
}

function formatNum(n: number, step: number): string {
  if (step >= 1) return String(Math.round(n));
  const decimals = Math.max(0, -Math.floor(Math.log10(step)));
  return n.toFixed(Math.min(decimals, 4));
}
