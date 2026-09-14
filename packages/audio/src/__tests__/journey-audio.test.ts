import { describe, it, expect } from 'vitest';
import {
  estimateBeats,
  TrackFeatureAccumulator,
  energyLandmarks,
} from '../track-analysis.js';
import {
  DEFAULT_SOUNDSCAPE_PATCH,
  validateSoundscapePatch,
  envelopeAt,
  lfoAt,
} from '../soundscape-patch.js';
describe('track analysis', () => {
  it('recovers a pulse grid and leaves silence unlabelled', () => {
    const pulses = new Float32Array(3000);
    for (let i = 25; i < pulses.length; i += 50) pulses[i] = 1;
    const result = estimateBeats(pulses, 0.01);
    expect(result.bpm).toBeCloseTo(120);
    expect(result.confidence).toBeGreaterThan(0.9);
    expect(result.beats.length).toBeGreaterThan(50);
    expect(
      result.beats
        .slice(1)
        .every((b, i) => Math.abs(b - result.beats[i] - 0.5) < 0.011),
    ).toBe(true);
    expect(estimateBeats(new Float32Array(1000), 0.01).bpm).toBeNull();
  });
  it('has chunk-independent stereo power and compact summaries', () => {
    const rate = 8000,
      left = Float32Array.from(
        { length: rate * 2 },
        (_, i) => Math.sin((2 * Math.PI * 440 * i) / rate) * 0.4,
      ),
      right = left.map((v) => -v);
    const one = new TrackFeatureAccumulator(rate, 2),
      chunks = new TrackFeatureAccumulator(rate, 2);
    one.push(left, right);
    for (let i = 0; i < left.length; i += 713)
      chunks.push(left.slice(i, i + 713), right.slice(i, i + 713));
    expect(chunks.result(true)).toEqual(one.result(true));
    expect(one.result().energy[4]).toBeGreaterThan(0.25);
    expect(one.result().energy.length).toBeLessThan(left.length / 100);
    expect(one.result().progress).toBe(1);
  });
  it('bounds energy landmarks and does not name musical sections', () => {
    const e = Float32Array.from({ length: 1000 }, (_, i) =>
        i > 400 && i < 700 ? 0.8 : 0.1,
      ),
      cues = energyLandmarks(e, new Float32Array(1000), 0.1);
    expect(cues.length).toBeGreaterThan(0);
    expect(cues.length).toBeLessThanOrEqual(128);
    expect(cues.slice(1).every((t, i) => t - cues[i] >= 8)).toBe(true);
  });
});
describe('Soundscape patch', () => {
  it('preserves original defaults and bounds all routed controls', () => {
    expect(validateSoundscapePatch(DEFAULT_SOUNDSCAPE_PATCH)).toEqual(
      DEFAULT_SOUNDSCAPE_PATCH,
    );
    const patch = structuredClone(DEFAULT_SOUNDSCAPE_PATCH);
    patch.voices[0].frequency = Infinity;
    patch.delay.feedback = 9;
    patch.routes = Array.from({ length: 50 }, () => ({
      source: 'lfo1',
      target: 'pitch',
      voice: 9,
      amount: 8,
    }));
    const bounded = validateSoundscapePatch(patch);
    expect(bounded.voices[0].frequency).toBe(70);
    expect(bounded.delay.feedback).toBe(0.85);
    expect(bounded.routes).toHaveLength(8);
    expect(bounded.routes[0].amount).toBe(1);
    expect(bounded.routes[0].voice).toBe(2);
  });
  it('keeps ADSR and all LFO shapes finite, bounded and periodic', () => {
    for (let i = 0; i < 1000; i++) {
      const t = i / 200,
        e = envelopeAt(t, 0.6, DEFAULT_SOUNDSCAPE_PATCH.envelope);
      expect(e).toBeGreaterThanOrEqual(0);
      expect(e).toBeLessThanOrEqual(1);
      for (const wave of ['sine', 'square', 'triangle'] as const) {
        expect(Math.abs(lfoAt(t, wave))).toBeLessThanOrEqual(1);
        expect(lfoAt(t + 1, wave)).toBeCloseTo(lfoAt(t, wave), 8);
      }
    }
    expect(envelopeAt(2, 0.6, DEFAULT_SOUNDSCAPE_PATCH.envelope)).toBe(0);
  });
});
