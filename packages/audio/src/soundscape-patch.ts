export interface SynthEnvelope {
  attack: number;
  decay: number;
  sustain: number;
  release: number;
}
export interface SynthVoice {
  waveform: OscillatorType;
  frequency: number;
  detune: number;
  level: number;
  filter: BiquadFilterType;
  cutoff: number;
  resonance: number;
}
export interface SynthLFO {
  waveform: 'sine' | 'triangle' | 'square';
  rate: number;
  sync: boolean;
  division: number;
}
export interface SynthRoute {
  source: 'lfo1' | 'lfo2' | 'envelope';
  target: 'pitch' | 'cutoff' | 'level' | 'delay';
  voice: number;
  amount: number;
}
export interface SoundscapePatch {
  version: 1;
  voices: SynthVoice[];
  noise: number;
  trigger: 'continuous' | 'tempo';
  envelope: SynthEnvelope;
  filterEnvelope: SynthEnvelope;
  filterAmount: number;
  lfos: SynthLFO[];
  routes: SynthRoute[];
  delay: { division: number; feedback: number; mix: number };
  output: number;
}
export const DEFAULT_SOUNDSCAPE_PATCH: SoundscapePatch = {
  version: 1,
  voices: [
    {
      waveform: 'sine',
      frequency: 70,
      detune: 0,
      level: 1,
      filter: 'lowpass',
      cutoff: 70,
      resonance: 0.7,
    },
    {
      waveform: 'triangle',
      frequency: 420,
      detune: 0,
      level: 1,
      filter: 'bandpass',
      cutoff: 420,
      resonance: 1.1,
    },
    {
      waveform: 'sawtooth',
      frequency: 2400,
      detune: 0,
      level: 1,
      filter: 'highpass',
      cutoff: 2400,
      resonance: 0.7,
    },
  ],
  noise: 1,
  trigger: 'continuous',
  envelope: { attack: 0.01, decay: 0.15, sustain: 0.65, release: 0.2 },
  filterEnvelope: { attack: 0.02, decay: 0.25, sustain: 0.2, release: 0.25 },
  filterAmount: 0,
  lfos: [
    { waveform: 'sine', rate: 0.2, sync: false, division: 4 },
    { waveform: 'triangle', rate: 0.1, sync: false, division: 8 },
  ],
  routes: [],
  delay: { division: 0.5, feedback: 0.25, mix: 0 },
  output: 1,
};
const number = (v: unknown, d: number, lo: number, hi: number) =>
  typeof v === 'number' && Number.isFinite(v)
    ? Math.max(lo, Math.min(hi, v))
    : d;
export function validateSoundscapePatch(value: unknown): SoundscapePatch {
  if (!value || typeof value !== 'object')
    return structuredClone(DEFAULT_SOUNDSCAPE_PATCH);
  const p = value as SoundscapePatch,
    d = DEFAULT_SOUNDSCAPE_PATCH;
  const envelope = (v: SynthEnvelope | undefined): SynthEnvelope => ({
    attack: number(v?.attack, 0.01, 0.002, 4),
    decay: number(v?.decay, 0.15, 0.005, 4),
    sustain: number(v?.sustain, 0.65, 0, 1),
    release: number(v?.release, 0.2, 0.005, 8),
  });
  return {
    version: 1,
    voices: d.voices.map((v, i) => {
      const x = p.voices?.[i];
      return {
        waveform: ['sine', 'triangle', 'square', 'sawtooth'].includes(
          x?.waveform,
        )
          ? x.waveform
          : v.waveform,
        frequency: number(x?.frequency, v.frequency, 20, 12000),
        detune: number(x?.detune, 0, -1200, 1200),
        level: number(x?.level, 1, 0, 1),
        filter: ['lowpass', 'highpass', 'bandpass', 'notch'].includes(x?.filter)
          ? x.filter
          : v.filter,
        cutoff: number(x?.cutoff, v.cutoff, 20, 18000),
        resonance: number(x?.resonance, v.resonance, 0.1, 12),
      };
    }),
    noise: number(p.noise, 1, 0, 1),
    trigger: p.trigger === 'tempo' ? 'tempo' : 'continuous',
    envelope: envelope(p.envelope),
    filterEnvelope: envelope(p.filterEnvelope),
    filterAmount: number(p.filterAmount, 0, -4, 4),
    lfos: d.lfos.map((v, i) => {
      const x = p.lfos?.[i];
      return {
        waveform: ['sine', 'triangle', 'square'].includes(x?.waveform)
          ? x.waveform
          : v.waveform,
        rate: number(x?.rate, v.rate, 0.01, 20),
        sync: x?.sync === true,
        division: number(x?.division, v.division, 0.125, 16),
      };
    }),
    routes: Array.isArray(p.routes)
      ? p.routes
          .slice(0, 8)
          .filter(
            (r) =>
              r &&
              ['lfo1', 'lfo2', 'envelope'].includes(r.source) &&
              ['pitch', 'cutoff', 'level', 'delay'].includes(r.target),
          )
          .map((r) => ({
            ...r,
            voice: Math.floor(number(r.voice, 0, 0, 2)),
            amount: number(r.amount, 0, -1, 1),
          }))
      : [],
    delay: {
      division: number(p.delay?.division, 0.5, 0.125, 4),
      feedback: number(p.delay?.feedback, 0.25, 0, 0.85),
      mix: number(p.delay?.mix, 0, 0, 1),
    },
    output: number(p.output, 1, 0, 1),
  };
}
/** Finite one-shot ADSR, with gate shortening bounded to the chosen beat interval. */
export function envelopeAt(
  age: number,
  gate: number,
  e: SynthEnvelope,
): number {
  if (age < 0) return 0;
  const at = (t: number) =>
    t < e.attack
      ? t / e.attack
      : t < e.attack + e.decay
        ? 1 - ((1 - e.sustain) * (t - e.attack)) / e.decay
        : e.sustain;
  return age <= gate
    ? at(age)
    : Math.max(0, at(gate) * (1 - (age - gate) / e.release));
}
export function lfoAt(phase: number, waveform: SynthLFO['waveform']): number {
  const p = ((phase % 1) + 1) % 1;
  return waveform === 'square'
    ? p < 0.5
      ? 1
      : -1
    : waveform === 'triangle'
      ? 1 - 4 * Math.abs(p - 0.5)
      : Math.sin(p * Math.PI * 2);
}
