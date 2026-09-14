import { DEFAULT_SOUNDSCAPE_PATCH } from '@cybernoetica/audio';
import type {
  AudioSource,
  SoundscapePatch,
  SynthRoute,
} from '@cybernoetica/audio';
import {
  disclosure,
  field,
  selectControl,
  numberControl,
} from './journey-controls.js';
import { el, glassButton } from './components.js';
import { TEXT_SECONDARY } from './styles.js';
export function renderSoundscapeControls(
  host: HTMLElement,
  source: AudioSource,
): void {
  const advanced = disclosure('Sound design');
  host.append(advanced);
  const patch = () => source.getSoundscapePatch();
  const update = (change: (value: SoundscapePatch) => void) => {
    const value = patch();
    change(value);
    source.setSoundscapePatch(value);
    try {
      localStorage.setItem(
        'cybernoetica:soundscape:v1',
        JSON.stringify(source.getSoundscapePatch()),
      );
    } catch {
      /* unavailable storage */
    }
  };
  const voices = disclosure('Voices');
  advanced.append(voices);
  patch().voices.forEach((voice, i) => {
    const section = disclosure(`Voice ${i + 1}`);
    section.append(
      field(
        `Voice ${i + 1} waveform`,
        selectControl(
          ['sine', 'triangle', 'sawtooth', 'square'].map((v) => [v, v]),
          voice.waveform,
          (v) => update((p) => (p.voices[i].waveform = v as OscillatorType)),
        ),
      ),
    );
    for (const [key, label, min, max, step] of [
      ['frequency', 'Frequency (Hz)', 20, 12000, 1],
      ['detune', 'Detune (cents)', -1200, 1200, 1],
      ['level', 'Level', 0, 1, 0.01],
    ] as const)
      section.append(
        field(
          `Voice ${i + 1} ${label}`,
          numberControl(voice[key], min, max, step, (v) =>
            update((p) => (p.voices[i][key] = v)),
          ),
        ),
      );
    voices.append(section);
  });
  voices.append(
    field(
      'Noise level',
      numberControl(patch().noise, 0, 1, 0.01, (v) =>
        update((p) => (p.noise = v)),
      ),
    ),
  );
  const envelopes = disclosure('Envelopes');
  advanced.append(envelopes);
  envelopes.append(
    field(
      'Envelope trigger',
      selectControl(
        [
          ['continuous', 'Continuous'],
          ['tempo', 'Tempo'],
        ],
        patch().trigger,
        (v) => update((p) => (p.trigger = v as SoundscapePatch['trigger'])),
      ),
    ),
  );
  for (const [key, name] of [
    ['envelope', 'Amplitude'],
    ['filterEnvelope', 'Filter'],
  ] as const) {
    const details = disclosure(name);
    const e = patch()[key];
    for (const [k, label, max] of [
      ['attack', 'Attack (s)', 4],
      ['decay', 'Decay (s)', 4],
      ['sustain', 'Sustain', 1],
      ['release', 'Release (s)', 8],
    ] as const)
      details.append(
        field(
          `${name} ${label}`,
          numberControl(e[k], k === 'sustain' ? 0 : 0.005, max, 0.01, (v) =>
            update((p) => (p[key][k] = v)),
          ),
        ),
      );
    envelopes.append(details);
  }
  envelopes.append(
    field(
      'Filter envelope amount',
      numberControl(patch().filterAmount, -4, 4, 0.1, (v) =>
        update((p) => (p.filterAmount = v)),
      ),
    ),
  );
  const filters = disclosure('Filters');
  advanced.append(filters);
  patch().voices.forEach((voice, i) => {
    const details = disclosure(`Voice ${i + 1} filter`);
    details.append(
      field(
        'Filter type',
        selectControl(
          ['lowpass', 'highpass', 'bandpass', 'notch'].map((v) => [v, v]),
          voice.filter,
          (v) => update((p) => (p.voices[i].filter = v as BiquadFilterType)),
        ),
      ),
      field(
        'Cutoff (Hz)',
        numberControl(voice.cutoff, 20, 18000, 10, (v) =>
          update((p) => (p.voices[i].cutoff = v)),
        ),
      ),
      field(
        'Resonance (Q)',
        numberControl(voice.resonance, 0.1, 12, 0.1, (v) =>
          update((p) => (p.voices[i].resonance = v)),
        ),
      ),
    );
    filters.append(details);
  });
  const lfos = disclosure('LFOs');
  advanced.append(lfos);
  patch().lfos.forEach((lfo, i) => {
    const details = disclosure(`LFO ${i + 1}`);
    details.append(
      field(
        'Shape',
        selectControl(
          ['sine', 'triangle', 'square'].map((v) => [v, v]),
          lfo.waveform,
          (v) => update((p) => (p.lfos[i].waveform = v as typeof lfo.waveform)),
        ),
      ),
      field(
        'Rate (Hz)',
        numberControl(lfo.rate, 0.01, 20, 0.01, (v) =>
          update((p) => (p.lfos[i].rate = v)),
        ),
      ),
      field(
        'Beats per cycle',
        numberControl(lfo.division, 0.125, 16, 0.125, (v) =>
          update((p) => (p.lfos[i].division = v)),
        ),
      ),
    );
    const sync = el('input', {}, { type: 'checkbox' });
    sync.checked = lfo.sync;
    sync.onchange = () => update((p) => (p.lfos[i].sync = sync.checked));
    details.append(field('Sync to tempo', sync));
    lfos.append(details);
  });
  const modulation = disclosure('Modulation');
  advanced.append(modulation);
  const routeList = el('div', {});
  modulation.append(routeList);
  function renderRoutes() {
    routeList.replaceChildren();
    patch().routes.forEach((route, i) => {
      const details = disclosure(
        `Route ${i + 1}: ${route.source} → ${route.target}`,
      );
      details.open = true;
      details.append(
        field(
          'Source',
          selectControl(
            [
              ['lfo1', 'LFO 1'],
              ['lfo2', 'LFO 2'],
              ['envelope', 'Envelope'],
            ],
            route.source,
            (v) =>
              update((p) => (p.routes[i].source = v as SynthRoute['source'])),
          ),
        ),
        field(
          'Destination',
          selectControl(
            [
              ['pitch', 'Pitch'],
              ['cutoff', 'Cutoff'],
              ['level', 'Level'],
              ['delay', 'Delay time'],
            ],
            route.target,
            (v) =>
              update((p) => (p.routes[i].target = v as SynthRoute['target'])),
          ),
        ),
        field(
          'Voice',
          selectControl(
            [
              ['0', 'Voice 1'],
              ['1', 'Voice 2'],
              ['2', 'Voice 3'],
            ],
            String(route.voice),
            (v) => update((p) => (p.routes[i].voice = Number(v))),
          ),
        ),
        field(
          'Depth',
          numberControl(route.amount, -1, 1, 0.01, (v) =>
            update((p) => (p.routes[i].amount = v)),
          ),
        ),
      );
      const remove = glassButton('Remove route');
      remove.onclick = () => {
        update((p) => p.routes.splice(i, 1));
        renderRoutes();
        add.disabled = false;
      };
      details.append(remove);
      routeList.append(details);
    });
  }
  renderRoutes();
  const add = glassButton('Add modulation route');
  add.onclick = () => {
    if (patch().routes.length >= 8) return;
    update((p) =>
      p.routes.push({
        source: 'lfo1',
        target: 'cutoff',
        voice: 0,
        amount: 0.1,
      }),
    );
    renderRoutes();
    add.disabled = patch().routes.length >= 8;
  };
  modulation.append(add);
  const effects = disclosure('Delay and output');
  advanced.append(effects);
  for (const [key, label, min, max, step] of [
    ['division', 'Delay (beats)', 0.125, 4, 0.125],
    ['feedback', 'Feedback', 0, 0.85, 0.01],
    ['mix', 'Wet / dry', 0, 1, 0.01],
  ] as const)
    effects.append(
      field(
        label,
        numberControl(patch().delay[key], min, max, step, (v) =>
          update((p) => (p.delay[key] = v)),
        ),
      ),
    );
  effects.append(
    field(
      'Output level',
      numberControl(patch().output, 0, 1, 0.01, (v) =>
        update((p) => (p.output = v)),
      ),
    ),
  );
  const note = el('p', {
    fontSize: '11px',
    lineHeight: '1.5',
    color: TEXT_SECONDARY,
  });
  note.textContent =
    'Cycle, Energy and Brightness continue shaping these voices. Analysis gain changes visual sensitivity independently of the output level.';
  advanced.append(note);
  const reset = glassButton('Restore original sound');
  reset.onclick = () => {
    source.setSoundscapePatch(structuredClone(DEFAULT_SOUNDSCAPE_PATCH));
    try {
      localStorage.removeItem('cybernoetica:soundscape:v1');
    } catch {}
    host.replaceChildren();
    renderSoundscapeControls(host, source);
  };
  advanced.append(reset);
}
