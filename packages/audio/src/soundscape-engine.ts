import {
  clampSoundscapeParams,
  DEFAULT_SOUNDSCAPE_PARAMS,
  soundscapePhase,
  soundscapeGainsAt,
} from './soundscape-loop.js';
import type { SoundscapeParams } from './soundscape-loop.js';
import {
  DEFAULT_SOUNDSCAPE_PATCH,
  validateSoundscapePatch,
  envelopeAt,
  lfoAt,
} from './soundscape-patch.js';
import type { SoundscapePatch, SynthEnvelope } from './soundscape-patch.js';
interface Voice {
  osc: OscillatorNode;
  filter: BiquadFilterNode;
  gain: GainNode;
  envelope: GainNode;
}
/** Owns synthesis nodes and audio-clock automation independently of source selection. */
export class SoundscapeEngine {
  readonly output: GainNode;
  private voices: Voice[] = [];
  private nodes: AudioNode[] = [];
  private stoppables: Array<OscillatorNode | AudioBufferSourceNode> = [];
  private mix: GainNode;
  private noiseGain: GainNode;
  private clickGain: GainNode;
  private delay: DelayNode;
  private feedback: GainNode;
  private wet: GainNode;
  private dry: GainNode;
  private timer: ReturnType<typeof setInterval> | null = null;
  private origin: number;
  private beatOrigin: number;
  private nextBeat: number;
  private nextAutomation: number;
  private phaseOrigin: number;
  private lfoPhases = [0, 0];
  private disposed = false;
  private editValues: number[] | null = null;
  private editStart = 0;
  params: SoundscapeParams;
  patch: SoundscapePatch;
  constructor(
    private ctx: BaseAudioContext,
    params: Partial<SoundscapeParams> = {},
    patch: SoundscapePatch = DEFAULT_SOUNDSCAPE_PATCH,
  ) {
    this.params = clampSoundscapeParams(params, DEFAULT_SOUNDSCAPE_PARAMS);
    this.patch = validateSoundscapePatch(patch);
    this.origin = this.beatOrigin = this.phaseOrigin = ctx.currentTime;
    this.nextBeat = this.nextAutomation = ctx.currentTime;
    this.mix = ctx.createGain();
    this.mix.gain.value = 0.85;
    this.output = ctx.createGain();
    this.output.gain.value = this.patch.output;
    this.dry = ctx.createGain();
    this.wet = ctx.createGain();
    this.delay = ctx.createDelay(6);
    this.feedback = ctx.createGain();
    this.mix.connect(this.dry);
    this.dry.connect(this.output);
    this.mix.connect(this.delay);
    this.delay.connect(this.wet);
    this.wet.connect(this.output);
    this.delay.connect(this.feedback);
    this.feedback.connect(this.delay);
    this.nodes.push(
      this.mix,
      this.output,
      this.dry,
      this.wet,
      this.delay,
      this.feedback,
    );
    for (const spec of this.patch.voices) {
      const osc = ctx.createOscillator(),
        filter = ctx.createBiquadFilter(),
        gain = ctx.createGain(),
        env = ctx.createGain();
      osc.type = spec.waveform;
      osc.frequency.value = spec.frequency;
      osc.detune.value = spec.detune;
      filter.type = spec.filter;
      filter.frequency.value = spec.cutoff;
      filter.Q.value = spec.resonance;
      gain.gain.value = 0;
      env.gain.value = this.patch.trigger === 'continuous' ? 1 : 0;
      osc.connect(filter);
      filter.connect(gain);
      gain.connect(env);
      env.connect(this.mix);
      osc.start();
      this.stoppables.push(osc);
      this.nodes.push(osc, filter, gain, env);
      this.voices.push({ osc, filter, gain, envelope: env });
    }
    const noise = ctx.createBufferSource(),
      buffer = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate),
      data = buffer.getChannelData(0);
    let seed = 1789;
    for (let i = 0; i < data.length; i++) {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      data[i] = seed / 2147483648 - 1;
    }
    noise.buffer = buffer;
    noise.loop = true;
    const noiseFilter = ctx.createBiquadFilter();
    noiseFilter.type = 'bandpass';
    noiseFilter.frequency.value = 1200;
    noiseFilter.Q.value = 0.7;
    this.noiseGain = ctx.createGain();
    this.noiseGain.gain.value = 0;
    noise.connect(noiseFilter);
    noiseFilter.connect(this.noiseGain);
    this.noiseGain.connect(this.mix);
    noise.start();
    this.stoppables.push(noise);
    this.nodes.push(noise, noiseFilter, this.noiseGain);
    const click = ctx.createOscillator();
    click.type = 'square';
    click.frequency.value = 180;
    this.clickGain = ctx.createGain();
    this.clickGain.gain.value = 0.0001;
    click.connect(this.clickGain);
    this.clickGain.connect(this.mix);
    click.start();
    this.stoppables.push(click);
    this.nodes.push(click, this.clickGain);
    this.schedule();
    if (!('startRendering' in ctx))
      this.timer = setInterval(() => this.schedule(), 25);
  }
  private automate(
    parameter: AudioParam,
    value: number,
    time: number,
    ramp = 0.04,
  ): void {
    parameter.setTargetAtTime(Number.isFinite(value) ? value : 0, time, ramp);
  }
  private phases(time: number): number[] {
    const elapsed = Math.max(0, time - this.phaseOrigin);
    return this.patch.lfos.map(
      (l, i) =>
        this.lfoPhases[i] +
        elapsed * (l.sync ? this.params.beatRate / 60 / l.division : l.rate),
    );
  }
  private resetAutomation(): void {
    const now = this.ctx.currentTime;
    this.editValues = this.values(now);
    this.editStart = now + 0.025;
    for (const parameter of this.parameters()) {
      parameter.cancelAndHoldAtTime(now);
    }
    this.clickGain.gain.cancelScheduledValues(now);
    this.automate(this.clickGain.gain, 0.0001, now, 0.005);
    this.nextAutomation = now + 0.025;
  }
  setParams(partial: Partial<SoundscapeParams>): void {
    const now = this.ctx.currentTime,
      phases = this.phases(now),
      beatPhase = ((now - this.beatOrigin) * this.params.beatRate) / 60;
    this.resetAutomation();
    this.params = clampSoundscapeParams(partial, this.params);
    this.lfoPhases = phases;
    this.phaseOrigin = now;
    this.beatOrigin = now - (beatPhase * 60) / this.params.beatRate;
    this.nextBeat = now + ((1 - (beatPhase % 1)) * 60) / this.params.beatRate;
    this.schedule();
  }
  setPatch(patch: SoundscapePatch): void {
    const now = this.ctx.currentTime;
    this.lfoPhases = this.phases(now);
    this.phaseOrigin = now;
    this.resetAutomation();
    this.patch = validateSoundscapePatch(patch);
    const period = 60 / this.params.beatRate;
    this.nextBeat =
      now + (1 - (((now - this.beatOrigin) / period) % 1)) * period;
    this.schedule();
  }
  signals(time = this.ctx.currentTime): Record<string, number> {
    const phase = this.phases(time),
      period = 60 / this.params.beatRate,
      age = (((time - this.beatOrigin) % period) + period) % period;
    return {
      lfo1: (lfoAt(phase[0], this.patch.lfos[0].waveform) + 1) / 2,
      lfo2: (lfoAt(phase[1], this.patch.lfos[1].waveform) + 1) / 2,
      envelope:
        this.patch.trigger === 'continuous'
          ? 1
          : this.gatedEnvelope(age, period, this.patch.envelope),
    };
  }
  private gatedEnvelope(age: number, period: number, e: SynthEnvelope): number {
    const gate = period * 0.55,
      attack = Math.min(e.attack, gate * 0.6);
    return envelopeAt(age, gate, {
      attack,
      decay: Math.min(e.decay, gate - attack),
      sustain: e.sustain,
      release: Math.min(e.release, period - gate),
    });
  }
  private parameters(): AudioParam[] {
    return [
      ...this.voices.flatMap((v) => [
        v.osc.frequency,
        v.osc.detune,
        v.filter.frequency,
        v.filter.Q,
        v.gain.gain,
        v.envelope.gain,
      ]),
      this.noiseGain.gain,
      this.delay.delayTime,
      this.feedback.gain,
      this.wet.gain,
      this.dry.gain,
      this.output.gain,
    ];
  }
  private values(time: number): number[] {
    const elapsed = Math.max(0, time - this.origin),
      phase = soundscapePhase(elapsed, this.params.cycleLength),
      g = soundscapeGainsAt(phase, this.params, elapsed),
      signals = this.signals(time);
    const levels = [g.bass * 0.45, g.mid * 0.28, g.high * 0.16],
      cutoffs = [70, (280 + g.cutoff * 4200) * 0.35, 900 + g.cutoff * 5000],
      base = [70, 420, 2400],
      values: number[] = [];
    const period = 60 / this.params.beatRate,
      age = (((time - this.beatOrigin) % period) + period) % period;
    const env =
      this.patch.trigger === 'continuous'
        ? 0
        : this.gatedEnvelope(age, period, this.patch.filterEnvelope) *
          this.patch.filterAmount;
    let delayMod = 0;
    for (let i = 0; i < this.voices.length; i++) {
      const spec = this.patch.voices[i];
      let pitch = 0,
        cutoff = 0,
        level = 0;
      for (const route of this.patch.routes) {
        const value = (signals[route.source] ?? 0) * 2 - 1;
        if (route.target === 'delay') {
          if (i === 0) delayMod += value * route.amount;
          continue;
        }
        if (route.voice !== i) continue;
        if (route.target === 'pitch') pitch += value * route.amount * 1200;
        else if (route.target === 'cutoff') cutoff += value * route.amount * 4;
        else level += value * route.amount;
      }
      values.push(
        spec.frequency,
        Math.max(-9600, Math.min(9600, spec.detune + pitch)),
        Math.max(
          20,
          Math.min(
            this.ctx.sampleRate * 0.45,
            cutoffs[i] * (spec.cutoff / base[i]) * 2 ** (cutoff + env),
          ),
        ),
        spec.resonance,
        levels[i] * spec.level * Math.max(0, Math.min(2, 1 + level)),
        signals.envelope,
      );
    }
    values.push(
      g.noise * 0.22 * this.patch.noise,
      Math.max(
        0.01,
        Math.min(6, period * this.patch.delay.division * (1 + delayMod * 0.2)),
      ),
      this.patch.delay.feedback,
      this.patch.delay.mix,
      1 - this.patch.delay.mix * 0.5,
      this.patch.output,
    );
    return values;
  }
  /** Bounded lookahead with audio-clock curves (320 Hz knots, audio-rate interpolation).
   * The timer only fills the queue; it never sets the modulation phase. Offline rendering
   * uses exactly the same scheduler. Long hidden-tab gaps skip missed automation. */
  schedule(until = this.ctx.currentTime + 0.12): void {
    if (this.disposed) return;
    const now = this.ctx.currentTime,
      parameters = this.parameters(),
      step = 0.025;
    this.voices.forEach((v, i) => {
      v.osc.type = this.patch.voices[i].waveform;
      v.filter.type = this.patch.voices[i].filter;
    });
    if (this.nextAutomation < now) this.nextAutomation = now;
    for (
      let batch = 0;
      this.nextAutomation < until && batch < 2400;
      batch++, this.nextAutomation += step
    ) {
      const start = this.nextAutomation,
        curves = parameters.map(() => new Float32Array(9));
      for (let k = 0; k < 9; k++) {
        const time = start + (k * step) / 8,
          values = this.values(time);
        if (this.editValues) {
          const t = Math.max(0, Math.min(1, (time - this.editStart) / 0.05)),
            mix = t * t * (3 - 2 * t);
          for (let i = 0; i < values.length; i++)
            values[i] =
              this.editValues[i] + (values[i] - this.editValues[i]) * mix;
        }
        for (let p = 0; p < curves.length; p++) curves[p][k] = values[p];
      }
      for (let p = 0; p < parameters.length; p++)
        parameters[p].setValueCurveAtTime(curves[p], start, step);
    }
    const period = 60 / this.params.beatRate;
    if (this.nextBeat < now - 0.1) this.nextBeat = now;
    for (
      let steps = 0;
      this.nextBeat < until && steps < 512;
      steps++, this.nextBeat += period
    ) {
      const time = Math.max(now, this.nextBeat),
        gain = this.clickGain.gain;
      gain.setValueAtTime(0.0001, time);
      gain.exponentialRampToValueAtTime(
        0.35 * this.params.energy + 0.05,
        time + 0.004,
      );
      gain.exponentialRampToValueAtTime(0.0001, time + 0.05);
    }
  }
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    if (this.timer) clearInterval(this.timer);
    for (const node of this.stoppables)
      try {
        node.stop();
      } catch {
        /* already stopped */
      }
    for (const node of this.nodes) node.disconnect();
    this.nodes = [];
    this.voices = [];
    this.stoppables = [];
  }
}
