import {
  createJourney,
  loadVisualizer,
  createStop,
  createLayer,
  parseJourney,
  JOURNEY_TYPES,
  VISUALIZER_MANIFEST,
  normalizedWeights,
} from '@cybernoetica/renderer';
import type { JourneyLayer } from '@cybernoetica/renderer';
import type { JourneyController } from '../managers/journey-controller.js';
import { el, glassButton, setButtonActive } from './components.js';
import { TEXT_PRIMARY, TEXT_SECONDARY, GLASS_BORDER } from './styles.js';

export function field(label: string, input: HTMLElement): HTMLElement {
  const row = el('label', {
    display: 'flex',
    gap: '8px',
    alignItems: 'center',
    justifyContent: 'space-between',
    fontSize: '11px',
    color: TEXT_SECONDARY,
    margin: '7px 0',
  });
  const text = el('span', {});
  text.textContent = label;
  input.setAttribute('aria-label', label);
  row.append(text, input);
  return row;
}
export function selectControl(
  options: Array<[string, string]>,
  value: string,
  onChange: (value: string) => void,
): HTMLSelectElement {
  const select = el('select', {
    maxWidth: '65%',
    minWidth: '0',
    background: 'rgba(20,25,40,.92)',
    border: `1px solid ${GLASS_BORDER}`,
    borderRadius: '8px',
    color: TEXT_PRIMARY,
    padding: '6px',
  });
  for (const [v, label] of options) {
    const option = el('option', {}, { value: v });
    option.textContent = label;
    option.disabled = label.includes('Individual only');
    select.append(option);
  }
  select.value = value;
  select.addEventListener('change', () => onChange(select.value));
  return select;
}
export function numberControl(
  value: number,
  min: number,
  max: number,
  step: number,
  onChange: (v: number) => void,
): HTMLInputElement {
  const input = el(
    'input',
    {
      width: '78px',
      background: 'rgba(255,255,255,.06)',
      border: `1px solid ${GLASS_BORDER}`,
      borderRadius: '8px',
      color: TEXT_PRIMARY,
      padding: '6px',
    },
    { type: 'number', min: String(min), max: String(max), step: String(step) },
  );
  input.value = String(value);
  input.addEventListener('change', () => {
    if (Number.isFinite(input.valueAsNumber)) {
      const v = Math.max(min, Math.min(max, input.valueAsNumber));
      input.value = String(v);
      onChange(v);
    }
  });
  return input;
}
export function disclosure(label: string): HTMLDetailsElement {
  const details = el('details', {
    borderTop: `1px solid ${GLASS_BORDER}`,
    paddingTop: '8px',
    marginTop: '10px',
  });
  const summary = el('summary', {
    fontSize: '12px',
    color: TEXT_PRIMARY,
    cursor: 'pointer',
    padding: '5px 0',
  });
  summary.textContent = label;
  details.append(summary);
  return details;
}
const models = JOURNEY_TYPES.map(
  (type) =>
    [type, VISUALIZER_MANIFEST.find((m) => m.type === type)!.label] as [
      string,
      string,
    ],
);
models.push(
  ...VISUALIZER_MANIFEST.filter((m) => !m.transition).map(
    (m) =>
      [m.type, `${m.label} · Individual only (adapter pending)`] as [
        string,
        string,
      ],
  ),
);
const name = (type: string) => models.find(([v]) => v === type)?.[1] ?? type;
export function renderJourneyControls(
  host: HTMLElement,
  legacy: HTMLElement,
  controller: JourneyController,
): () => void {
  const modes = el('div', {
      display: 'flex',
      gap: '6px',
      marginBottom: '14px',
    }),
    individual = glassButton('Individual'),
    journey = glassButton('Journey');
  modes.setAttribute('role', 'group');
  modes.setAttribute('aria-label', 'Visualizer mode');
  modes.append(individual, journey);
  host.append(modes);
  const modeError = el(
    'p',
    { fontSize: '11px', color: TEXT_SECONDARY },
    { role: 'status' },
  );
  host.append(modeError);
  const content = el('div', {});
  host.append(content);
  const bindings: Array<() => void> = [];
  function bound<T extends HTMLInputElement | HTMLSelectElement>(
    input: T,
    value: () => string,
  ): T {
    bindings.push(() => {
      if (document.activeElement !== input && input.value !== value())
        input.value = value();
    });
    return input;
  }
  individual.addEventListener('click', () => void controller.mode(false));
  journey.addEventListener('click', () => void controller.mode(true));
  const status = el(
      'p',
      { fontSize: '12px', color: TEXT_SECONDARY },
      { 'aria-live': 'polite', 'data-testid': 'journey-status' },
    ),
    progress = el(
      'progress',
      { width: '100%', height: '5px' },
      { max: '1', 'aria-label': 'Transition progress' },
    );
  content.append(status, progress);
  const buttons = el('div', {
      display: 'flex',
      gap: '6px',
      margin: '10px 0',
      flexWrap: 'wrap',
    }),
    next = glassButton('Next'),
    pause = glassButton('Pause Journey'),
    retry = glassButton('Retry'),
    skip = glassButton('Skip');
  buttons.append(next, pause, retry, skip);
  content.append(buttons);
  next.onclick = () => controller.active?.nextStop();
  pause.onclick = () => {
    const a = controller.active;
    a?.setPaused(!a.isPaused());
  };
  retry.onclick = () => controller.active?.retry();
  skip.onclick = () => controller.active?.skip();
  content.append(
    field(
      'Presentation',
      bound(
        selectControl(
          [
            ['character', 'Character'],
            ['unified', 'Unified'],
          ],
          controller.definition.style,
          (v) => controller.style(v as 'character' | 'unified'),
        ),
        () => controller.definition.style,
      ),
    ),
  );
  const transition = disclosure('Transition motion');
  transition.append(
    field(
      'Point matching',
      bound(
        selectControl(
          [
            ['auto', 'Refined proximity'],
            ['projection', 'Projected proximity'],
            ['polar', 'Angular order'],
            ['identity', 'Sample order'],
          ],
          controller.definition.transport,
          (v) =>
            controller.update({
              ...controller.definition,
              transport: v as typeof controller.definition.transport,
            }),
        ),
        () => controller.definition.transport,
      ),
    ),
  );
  for (const [key, label, options] of [
    [
      'path',
      'Flight path',
      [
        ['direct', 'Direct'],
        ['arc', 'Arcs'],
        ['vortex', 'Vortex'],
      ],
    ],
    [
      'rendering',
      'Transition marks',
      [
        ['particles', 'Particles'],
        ['streaks', 'Streaks'],
        ['traces', 'Particles + traces'],
      ],
    ],
  ] as const)
    transition.append(
      field(
        label,
        bound(
          selectControl(
            options.map(([value, title]) => [value, title]),
            controller.definition.transitionLook[key],
            (v) =>
              controller.update({
                ...controller.definition,
                transitionLook: {
                  ...controller.definition.transitionLook,
                  [key]: v,
                },
              }),
          ),
          () => controller.definition.transitionLook[key],
        ),
      ),
    );
  for (const [key, label, min, max, step] of [
    ['curvature', 'Path bend', 0, 1.5, 0.05],
    ['traceLength', 'Trace length', 0.01, 0.4, 0.01],
  ] as const)
    transition.append(
      field(
        label,
        bound(
          numberControl(
            controller.definition.transitionLook[key],
            min,
            max,
            step,
            (v) =>
              controller.update({
                ...controller.definition,
                transitionLook: {
                  ...controller.definition.transitionLook,
                  [key]: v,
                },
              }),
          ),
          () => String(controller.definition.transitionLook[key]),
        ),
      ),
    );
  content.append(transition);
  const availability = el('p', { fontSize: '11px', color: TEXT_SECONDARY });
  availability.textContent =
    'Ten models support live geometry transitions. Other catalog entries are marked Individual only until their adapters are available.';
  content.append(availability);
  const route = el('div', { marginTop: '12px' });
  content.append(route);
  let dragIndex = -1;
  function move(from: number, to: number): void {
    const definition = structuredClone(controller.definition),
      [stop] = definition.stops.splice(from, 1);
    definition.stops.splice(to, 0, stop);
    controller.update(definition);
    renderRoute();
    route.querySelector<HTMLButtonElement>(`[data-move="${to}"]`)?.focus();
  }
  function editLayer(
    index: number,
    layerIndex: number,
    partial: Partial<JourneyLayer>,
  ): void {
    const definition = structuredClone(controller.definition),
      stop = definition.stops[index];
    Object.assign(stop.layers[layerIndex], partial);
    if (partial.weight !== undefined && !stop.layers.some((l) => l.weight > 0))
      stop.layers.forEach(
        (l, i) =>
          (l.weight = controller.definition.stops[index].layers[i].weight),
      );
    controller.update(definition);
    if (partial.type !== undefined) renderRoute();
  }
  function renderRoute(): void {
    const open = [...route.querySelectorAll('details')].map((d) => d.open),
      scroll = host.parentElement?.scrollTop ?? 0;
    route.replaceChildren();
    controller.definition.stops.forEach((stop, index) => {
      const card = el(
        'div',
        {
          border: `1px solid ${GLASS_BORDER}`,
          borderRadius: '12px',
          padding: '10px',
          marginBottom: '8px',
        },
        { 'data-testid': 'journey-stop' },
      );
      const header = el('div', {
          display: 'flex',
          gap: '4px',
          alignItems: 'center',
        }),
        label = el('span', { fontSize: '11px', color: TEXT_SECONDARY });
      label.textContent = String(index + 1).padStart(2, '0');
      const selector = selectControl(models, stop.layers[0].type, (v) =>
        editLayer(index, 0, { type: v, params: {}, view: {} }),
      );
      selector.style.flex = '1';
      selector.style.maxWidth = 'none';
      selector.setAttribute('aria-label', `Stop ${index + 1} visualizer`);
      const up = glassButton('↑'),
        down = glassButton('↓'),
        remove = glassButton('×');
      for (const b of [up, down, remove]) b.style.padding = '5px 8px';
      up.setAttribute('aria-label', `Move stop ${index + 1} up`);
      up.dataset.move = String(index);
      down.setAttribute('aria-label', `Move stop ${index + 1} down`);
      remove.setAttribute('aria-label', `Remove stop ${index + 1}`);
      up.disabled = index === 0;
      down.disabled = index === controller.definition.stops.length - 1;
      remove.disabled = controller.definition.stops.length === 1;
      up.onclick = () => move(index, index - 1);
      down.onclick = () => move(index, index + 1);
      remove.onclick = () => {
        const d = structuredClone(controller.definition);
        d.stops.splice(index, 1);
        controller.update(d);
        renderRoute();
      };
      header.append(label, selector, up, down, remove);
      label.draggable = true;
      label.style.cursor = 'grab';
      label.title = 'Drag to reorder; arrow buttons also available';
      label.addEventListener('dragstart', () => (dragIndex = index));
      card.addEventListener('dragover', (e) => e.preventDefault());
      card.addEventListener('drop', (e) => {
        e.preventDefault();
        if (dragIndex >= 0) move(dragIndex, index);
        dragIndex = -1;
      });
      card.append(header);
      const times = el('div', {
        display: 'flex',
        gap: '12px',
        justifyContent: 'space-between',
      });
      times.append(
        field(
          'Hold (s)',
          numberControl(stop.hold, 0.5, 600, 0.5, (v) => {
            const d = structuredClone(controller.definition);
            d.stops[index].hold = v;
            controller.update(d);
          }),
        ),
        field(
          'Morph (s)',
          numberControl(stop.transition, 0.5, 60, 0.5, (v) => {
            const d = structuredClone(controller.definition);
            d.stops[index].transition = v;
            controller.update(d);
          }),
        ),
      );
      card.append(times);
      const composition = disclosure(
        `Compose · ${stop.layers.length} contributor${stop.layers.length > 1 ? 's' : ''}`,
      );
      composition.append(
        field(
          'Composition',
          selectControl(
            [
              ['layers', 'Layers'],
              ['blend', 'Morph weights'],
            ],
            stop.composition,
            (v) => {
              const d = structuredClone(controller.definition);
              d.stops[index].composition = v as 'layers' | 'blend';
              controller.update(d);
            },
          ),
        ),
      );
      stop.layers.forEach((layer, li) => {
        const details = disclosure(`${li + 1} · ${name(layer.type)}`);
        details.append(
          field(
            'Model',
            selectControl(models, layer.type, (v) =>
              editLayer(index, li, { type: v, params: {}, view: {} }),
            ),
          ),
        );
        for (const [key, title, min, max, step] of [
          ['weight', 'Weight', 0, 1, 0.05],
          ['opacity', 'Opacity', 0, 1, 0.05],
          ['x', 'Horizontal', -2, 2, 0.05],
          ['y', 'Vertical', -2, 2, 0.05],
          ['scale', 'Scale', 0.1, 3, 0.05],
          ['rotation', 'Rotation', -Math.PI, Math.PI, 0.05],
        ] as const)
          details.append(
            field(
              title,
              numberControl(layer[key], min, max, step, (v) =>
                editLayer(index, li, { [key]: v }),
              ),
            ),
          );
        const audioControls = disclosure('Audio response');
        details.append(audioControls);
        void loadVisualizer(layer.type)
          .then((entry) => {
            if (!audioControls.isConnected || !entry) return;
            for (const param of entry.metadata.params.filter(
              (p) => p.category === 'audio-mapping',
            )) {
              audioControls.append(
                field(
                  param.label,
                  numberControl(
                    layer.params[param.key] ?? param.initial,
                    param.min,
                    param.max,
                    param.step,
                    (v) =>
                      editLayer(index, li, {
                        params: {
                          ...controller.definition.stops[index].layers[li]
                            .params,
                          [param.key]: v,
                        },
                      }),
                  ),
                ),
              );
            }
          })
          .catch(() => {
            audioControls.append(
              document.createTextNode('Audio controls unavailable.'),
            );
          });
        const order = glassButton('Move contributor up');
        order.disabled = li === 0;
        order.onclick = () => {
          const d = structuredClone(controller.definition),
            layers = d.stops[index].layers;
          [layers[li - 1], layers[li]] = [layers[li], layers[li - 1]];
          controller.update(d);
          renderRoute();
        };
        details.append(order);
        if (li > 0) {
          const removeLayer = glassButton('Remove contributor');
          removeLayer.onclick = () => {
            const d = structuredClone(controller.definition);
            d.stops[index].layers.splice(li, 1);
            controller.update(d);
            renderRoute();
          };
          details.append(removeLayer);
        }
        composition.append(details);
      });
      const addLayer = glassButton('Add contributor');
      addLayer.disabled = stop.layers.length >= 3;
      addLayer.onclick = () => {
        const d = structuredClone(controller.definition);
        d.stops[index].layers.push(
          createLayer('lorenz', `${stop.id}-${stop.layers.length}`),
        );
        controller.update(d);
        renderRoute();
      };
      composition.append(addLayer);
      card.append(composition);
      route.append(card);
    });
    [...route.querySelectorAll('details')].forEach(
      (d, i) => (d.open = open[i] ?? false),
    );
    if (host.parentElement) host.parentElement.scrollTop = scroll;
  }
  renderRoute();
  const actions = el('div', { display: 'flex', gap: '6px', flexWrap: 'wrap' }),
    add = glassButton('Add stop'),
    random = glassButton('Generate route');
  add.onclick = () => {
    if (controller.definition.stops.length >= 32) return;
    const d = structuredClone(controller.definition);
    d.stops.push(createStop('lissajous', `stop-${d.stops.length}`));
    controller.update(d);
    renderRoute();
  };
  random.onclick = () => {
    controller.update({
      ...createJourney(controller.definition.seed),
      style: controller.definition.style,
      transport: controller.definition.transport,
      transitionLook: controller.definition.transitionLook,
    });
    renderRoute();
  };
  actions.append(add, random);
  content.append(actions);
  const seedControl = numberControl(
    controller.definition.seed,
    0,
    4294967295,
    1,
    (v) => controller.update({ ...controller.definition, seed: v }),
  );
  content.append(
    field(
      'Random seed',
      bound(seedControl, () => String(controller.definition.seed)),
    ),
  );
  const timing = disclosure('Timing');
  timing.append(
    field(
      'Start transitions',
      bound(
        selectControl(
          [
            ['seconds', 'After hold'],
            ['onset', 'On an onset'],
            ['beats', 'On a beat'],
            ['cues', 'At track cues'],
          ],
          controller.definition.timing,
          (v) =>
            controller.update({
              ...controller.definition,
              timing: v as typeof controller.definition.timing,
            }),
        ),
        () => controller.definition.timing,
      ),
    ),
  );
  timing.append(
    field(
      'Tempo (BPM)',
      bound(
        numberControl(controller.definition.bpm, 40, 240, 1, (v) =>
          controller.update({ ...controller.definition, bpm: v }),
        ),
        () => String(controller.definition.bpm),
      ),
    ),
  );
  const tap = glassButton('Tap tempo');
  let taps: number[] = [];
  tap.onclick = () => {
    const now = performance.now();
    taps = taps.filter((t) => now - t < 4000);
    taps.push(now);
    if (taps.length > 1)
      controller.update({
        ...controller.definition,
        bpm: (60000 * (taps.length - 1)) / (now - taps[0]),
      });
  };
  timing.append(tap);
  const loop = el('input', {}, { type: 'checkbox' });
  loop.checked = controller.definition.loop;
  loop.onchange = () =>
    controller.update({ ...controller.definition, loop: loop.checked });
  timing.append(field('Loop route', loop));
  content.append(timing);
  const guidance = disclosure('Transition guidance');
  const guidanceList = el('div', {});
  guidance.append(guidanceList);
  function renderGuidance() {
    guidanceList.replaceChildren();
    controller.definition.guidance.forEach((g, i) => {
      const section = disclosure(g.source + ' → ' + g.target);
      section.append(
        field(
          'Signal',
          selectControl(
            [
              ['audio.bass', 'Bass'],
              ['audio.mid', 'Mid'],
              ['audio.high', 'High'],
              ['audio.rms', 'Level'],
              ['audio.spectralCentroid', 'Brightness'],
              ['audio.onset', 'Onset'],
              ['synth.lfo1', 'LFO 1'],
              ['synth.lfo2', 'LFO 2'],
              ['synth.envelope', 'Envelope'],
            ],
            g.source,
            (v) => {
              const d = structuredClone(controller.definition);
              d.guidance[i].source = v;
              controller.update(d);
            },
          ),
        ),
      );
      for (const [key, label, min, max, step] of [
        ['amount', 'Amount', -3, 3, 0.01],
        ['smoothing', 'Smoothing (s)', 0, 2, 0.01],
        ['min', 'Input minimum', -10, 10, 0.1],
        ['max', 'Input maximum', -10, 10, 0.1],
      ] as const)
        section.append(
          field(
            label,
            numberControl(g[key], min, max, step, (v) => {
              const d = structuredClone(controller.definition);
              d.guidance[i][key] = v;
              controller.update(d);
            }),
          ),
        );
      const invert = el('input', {}, { type: 'checkbox' });
      invert.checked = g.invert;
      invert.onchange = () => {
        const d = structuredClone(controller.definition);
        d.guidance[i].invert = invert.checked;
        controller.update(d);
      };
      section.append(
        field('Invert', invert),
        field(
          'Effect',
          selectControl(
            [
              ['swirl', 'Swirl'],
              ['spread', 'Spread'],
              ['light', 'Light'],
            ],
            g.target,
            (v) => {
              const d = structuredClone(controller.definition);
              d.guidance[i].target = v as typeof g.target;
              controller.update(d);
            },
          ),
        ),
      );
      const remove = glassButton('Remove guidance');
      remove.onclick = () => {
        const d = structuredClone(controller.definition);
        d.guidance.splice(i, 1);
        controller.update(d);
        renderGuidance();
      };
      section.append(remove);
      guidanceList.append(section);
    });
  }
  renderGuidance();
  const addGuidance = glassButton('Add guidance');
  addGuidance.onclick = () => {
    if (controller.definition.guidance.length >= 8) return;
    const d = structuredClone(controller.definition);
    d.guidance.push({
      id: 'new',
      source: 'audio.rms',
      target: 'spread',
      amount: 0.1,
      smoothing: 0.1,
      min: 0,
      max: 1,
      invert: false,
    });
    controller.update(d);
    renderGuidance();
  };
  guidance.append(addGuidance);
  content.append(guidance);
  const presets = disclosure('Save and load');
  const exportButton = glassButton('Export Journey'),
    importButton = glassButton('Import Journey'),
    file = el(
      'input',
      {},
      {
        type: 'file',
        accept: '.json,application/json',
        'aria-label': 'Import Journey file',
      },
    );
  file.hidden = true;
  exportButton.onclick = () => {
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(controller.definition, null, 2)], {
        type: 'application/json',
      }),
    );
    const a = el('a', {}, { href: url, download: 'cybernoetica-journey.json' });
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  importButton.onclick = () => file.click();
  const importStatus = el(
    'p',
    { fontSize: '11px', color: TEXT_SECONDARY },
    { role: 'status' },
  );
  file.onchange = async () => {
    try {
      const selected = file.files?.[0];
      if (!selected) return;
      if (selected.size > 262144)
        throw new Error('Journey files must be under 256 KB.');
      controller.update(parseJourney(JSON.parse(await selected.text())));
      renderRoute();
      renderGuidance();
      loop.checked = controller.definition.loop;
      importStatus.textContent = 'Journey loaded.';
    } catch (error) {
      importStatus.textContent = String(error);
    } finally {
      file.value = '';
    }
  };
  presets.append(exportButton, importButton, file, importStatus);
  content.append(presets);
  const timeline = disclosure('Track timeline');
  content.append(timeline);
  const cleanupTimeline = renderTrackTimeline(timeline, controller);
  let wasActive = false;
  function update(): void {
    bindings.forEach((fn) => fn());
    modeError.textContent = controller.error;
    const active = Boolean(controller.active);
    if (active && !wasActive) renderRoute();
    wasActive = active;
    legacy.hidden = active;
    content.hidden = !active;
    individual.disabled = false;
    journey.disabled = controller.busy;
    journey.textContent = controller.busy ? 'Preparing…' : 'Journey';
    setButtonActive(individual, !active);
    setButtonActive(journey, active);
    individual.setAttribute('aria-pressed', String(!active));
    journey.setAttribute('aria-pressed', String(active));
    const s = controller.state;
    if (s) {
      const d = controller.active!.definition;
      status.textContent =
        s.error ??
        `${name(d.stops[s.index]?.layers[0].type ?? '')} → ${name(d.stops[s.nextIndex]?.layers[0].type ?? '')} · ${s.phase}`;
      progress.value = s.progress;
      retry.hidden = skip.hidden = !s.error;
      pause.textContent = controller.active!.isPaused()
        ? 'Resume Journey'
        : 'Pause Journey';
    }
  }
  const unsub = controller.subscribe(update),
    timer = setInterval(update, 150);
  update();
  return () => {
    unsub();
    clearInterval(timer);
    cleanupTimeline();
  };
}

export function renderTrackTimeline(
  host: HTMLElement,
  controller: JourneyController,
): () => void {
  const message = el('p', { fontSize: '11px', color: TEXT_SECONDARY });
  host.append(message);
  const canvas = el(
    'canvas',
    {
      width: '100%',
      height: '66px',
      borderRadius: '8px',
      background: 'rgba(255,255,255,.025)',
    },
    {
      width: '360',
      height: '66',
      'aria-label': 'Track energy, beats and cues',
      role: 'img',
    },
  );
  host.append(canvas);
  const seek = el(
    'input',
    { width: '100%' },
    {
      type: 'range',
      min: '0',
      max: '1',
      step: '.01',
      'aria-label': 'Track position',
    },
  );
  seek.onchange = () => controller.seek(Number(seek.value));
  host.append(seek);
  const buttons = el('div', { display: 'flex', gap: '5px', flexWrap: 'wrap' }),
    add = glassButton('Add cue here'),
    suggest = glassButton('Suggest cues'),
    use = glassButton('Use estimated tempo');
  add.onclick = () => {
    controller.update({
      ...controller.definition,
      cues: [
        ...controller.definition.cues,
        controller.source.getTransport().position,
      ],
    });
    renderCues();
  };
  suggest.onclick = () => {
    if (controller.analysis) {
      controller.update({
        ...controller.definition,
        cues: controller.analysis.landmarks,
      });
      renderCues();
    }
  };
  use.onclick = () => {
    if (controller.analysis?.bpm)
      controller.update({
        ...controller.definition,
        bpm: controller.analysis.bpm,
      });
  };
  buttons.append(add, suggest, use);
  host.append(buttons);
  const tempo = el('div', { display: 'flex', gap: '5px' }),
    half = glassButton('½ tempo'),
    double = glassButton('2× tempo');
  half.onclick = () =>
    controller.update({
      ...controller.definition,
      bpm: controller.definition.bpm / 2,
    });
  double.onclick = () =>
    controller.update({
      ...controller.definition,
      bpm: controller.definition.bpm * 2,
    });
  tempo.append(half, double);
  host.append(
    tempo,
    field(
      'Beat offset (s)',
      numberControl(controller.definition.beatOffset, -10, 10, 0.01, (v) =>
        controller.update({ ...controller.definition, beatOffset: v }),
      ),
    ),
  );
  const cues = el('div', {});
  host.append(cues);
  function renderCues() {
    cues.replaceChildren();
    controller.definition.cues.forEach((time, index) => {
      const row = el('div', { display: 'flex', gap: '6px' }),
        remove = glassButton('Remove');
      remove.setAttribute('aria-label', `Remove cue ${index + 1}`);
      row.append(
        field(
          `Cue ${index + 1} (s)`,
          numberControl(time, 0, 86400, 0.1, (v) => {
            const d = structuredClone(controller.definition);
            d.cues[index] = v;
            controller.update(d);
            renderCues();
          }),
        ),
        remove,
      );
      remove.onclick = () => {
        const d = structuredClone(controller.definition);
        d.cues.splice(index, 1);
        controller.update(d);
        renderCues();
      };
      cues.append(row);
    });
  }
  renderCues();
  let cueKey = JSON.stringify(controller.definition.cues);
  function update() {
    const key = JSON.stringify(controller.definition.cues);
    if (key !== cueKey && !cues.contains(document.activeElement)) {
      cueKey = key;
      renderCues();
    }
    const track = controller.source.getTransport(),
      analysis = controller.analysis;
    message.textContent = !track.duration
      ? 'Load an audio file to reveal energy, beats and cues.'
      : controller.analysisError ||
        `${track.position.toFixed(1)} / ${track.duration.toFixed(1)} s · ${analysis?.progress === 1 ? (analysis.bpm ? `Estimated ${analysis.bpm.toFixed(1)} BPM · ${Math.round(analysis.confidence * 100)}% confidence` : 'No confident tempo estimate') : `Analyzing ${Math.round((analysis?.progress ?? 0) * 100)}%`}`;
    seek.disabled = !track.duration;
    seek.max = String(track.duration || 1);
    if (document.activeElement !== seek) seek.value = String(track.position);
    add.disabled = !track.duration;
    suggest.disabled = !analysis?.landmarks.length;
    use.disabled = !analysis?.bpm;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, 360, 66);
    if (!analysis) return;
    ctx.fillStyle = 'rgba(140,170,255,.65)';
    const energy = analysis.energy;
    for (let x = 0; x < 360; x++) {
      const v =
        energy[
          Math.min(energy.length - 1, Math.floor((x / 360) * energy.length))
        ] ?? 0;
      ctx.fillRect(x, 60 - Math.min(55, v * 120), 1, Math.min(55, v * 120));
    }
    ctx.strokeStyle = 'rgba(180,195,240,.2)';
    for (const time of analysis.beats) {
      const x = (time / track.duration) * 360;
      ctx.beginPath();
      ctx.moveTo(x, 10);
      ctx.lineTo(x, 62);
      ctx.stroke();
    }
    ctx.strokeStyle = '#b6b0ff';
    for (const time of controller.definition.cues) {
      const x = (time / track.duration) * 360;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, 66);
      ctx.stroke();
    }
    ctx.fillStyle = 'white';
    ctx.fillRect((track.position / track.duration) * 360, 0, 1, 66);
  }
  const timer = setInterval(update, 250);
  update();
  return () => clearInterval(timer);
}
