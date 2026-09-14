import {
  SoundscapeEngine,
  DEFAULT_SOUNDSCAPE_PATCH,
} from '@cybernoetica/audio';
import type { SoundscapePatch } from '@cybernoetica/audio';
export interface SynthesisQAResult {
  name: string;
  rms: number;
  peak: number;
  difference?: number;
}
export async function validateSynthesis(): Promise<SynthesisQAResult[]> {
  const results: SynthesisQAResult[] = [];
  async function render(
    name: string,
    patch: SoundscapePatch,
    edit = false,
  ): Promise<Float32Array> {
    const ctx = new OfflineAudioContext(2, 48000 * 3, 48000),
      engine = new SoundscapeEngine(ctx, { beatRate: 120 }, patch);
    engine.output.connect(ctx.destination);
    if (edit) {
      engine.setPatch({ ...patch, output: 0.7 });
      engine.setParams({ brightness: 0.6 });
    }
    engine.schedule(3);
    const buffer = await ctx.startRendering(),
      samples = buffer.getChannelData(0).slice();
    engine.dispose();
    engine.dispose();
    let power = 0,
      peak = 0;
    for (const sample of samples) {
      if (!Number.isFinite(sample))
        throw new Error(`${name}: non-finite output`);
      power += sample * sample;
      peak = Math.max(peak, Math.abs(sample));
    }
    results.push({ name, rms: Math.sqrt(power / samples.length), peak });
    return samples;
  }
  const original = await render(
    'original',
    structuredClone(DEFAULT_SOUNDSCAPE_PATCH),
  );
  const silent = await render('output-zero', {
    ...structuredClone(DEFAULT_SOUNDSCAPE_PATCH),
    output: 0,
  });
  if (silent.some((v) => v !== 0))
    throw new Error('Output level zero did not silence synthesis');
  const patch = structuredClone(DEFAULT_SOUNDSCAPE_PATCH);
  patch.trigger = 'tempo';
  patch.filterAmount = 2;
  patch.delay.mix = 0.5;
  patch.routes = [
    { source: 'lfo1', target: 'cutoff', voice: 0, amount: 0.4 },
    { source: 'lfo2', target: 'pitch', voice: 1, amount: 0.1 },
  ];
  const modulated = await render(
    'envelopes-filter-modulation-delay',
    patch,
    true,
  );
  let difference = 0;
  for (let i = 0; i < original.length; i++)
    difference += (original[i] - modulated[i]) ** 2;
  results[2].difference = Math.sqrt(difference / original.length);
  if (
    results[0].rms < 0.005 ||
    results[2].rms < 0.001 ||
    results[2].difference! < 0.005
  )
    throw new Error(
      'Synthesis controls did not produce audible differentiated output',
    );
  // Isolate the original tempo pulse, then compare the engine's wet path to a delayed dry render.
  const pulse = structuredClone(DEFAULT_SOUNDSCAPE_PATCH);
  pulse.voices.forEach((v) => (v.level = 0));
  pulse.noise = 0;
  pulse.delay.feedback = 0;
  const dry = await render('delay-dry', pulse);
  pulse.delay.mix = 1;
  const wet = await render('delay-wet', pulse);
  let delayError = 0;
  for (let i = 0; i < dry.length; i++) {
    const expected = 0.5 * dry[i] + (i >= 12000 ? dry[i - 12000] : 0);
    delayError += (wet[i] - expected) ** 2;
  }
  if (Math.sqrt(delayError / dry.length) > 0.0001)
    throw new Error('Engine delay does not match its half-beat timing');
  const filtered = structuredClone(DEFAULT_SOUNDSCAPE_PATCH);
  filtered.noise = 0;
  filtered.voices.forEach((v) => (v.level = 0));
  filtered.voices[0].level = 1;
  filtered.voices[0].frequency = 440;
  filtered.voices[0].cutoff = 20;
  await render('filter-closed', filtered);
  filtered.voices[0].cutoff = 8000;
  await render('filter-open', filtered);
  if (results[6].rms < results[5].rms * 1.5)
    throw new Error('Resonant filter cutoff is ineffective');
  return results;
}
