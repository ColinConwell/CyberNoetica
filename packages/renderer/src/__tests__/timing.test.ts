import { describe, it, expect } from 'vitest';
import {
  PhaseClock,
  FixedStepClock,
  frameDelta,
  takeAudioFrame,
} from '../timing.js';
import { EMASmoothing, EventEnvelope } from '../smoothing.js';
import type { AudioFeatures } from '@cybernoetica/core';

describe('presentation-independent dynamics', () => {
  it('matches attack and release at 30, 60 and 120 Hz', () => {
    const result = (fps: number) => {
      const smooth = new EMASmoothing(0.2, 0.05);
      for (let i = 0; i < fps; i++) smooth.update(1, 1 / fps);
      for (let i = 0; i < fps; i++) smooth.update(0, 1 / fps);
      return smooth.value;
    };
    expect(result(30)).toBeCloseTo(result(120), 12);
    expect(result(60)).toBeCloseTo(result(120), 12);
  });
  it('integrates speed changes without a phase jump', () => {
    const clock = new PhaseClock();
    for (let i = 0; i < 600; i++) clock.advance('orbit', 1, 1 / 60);
    expect(clock.advance('orbit', 10, 0)).toBeCloseTo(10, 10);
    expect(clock.advance('orbit', 10, 0.1)).toBeCloseTo(11, 10);
  });
  it('retains fractional substeps and bounds suspended-tab catchup', () => {
    for (const fps of [30, 60, 120, 144]) {
      let count = 0;
      const clock = new FixedStepClock();
      for (let i = 0; i < fps * 2; i++) clock.advance(1 / fps, () => count++);
      expect(count).toBe(240);
      expect(clock.advance(20, () => count++)).toBe(12);
    }
    expect(frameDelta(NaN)).toBe(1 / 60);
  });
  it('consumes one event and gives pulses the same amplitude at all frame rates', () => {
    const features = { beatOnset: true } as AudioFeatures;
    expect(takeAudioFrame(features).beatOnset).toBe(true);
    expect(takeAudioFrame(features).beatOnset).toBe(false);
    const result = (fps: number) => {
      const pulse = new EventEnvelope(0.2);
      expect(pulse.update(1, 1 / fps)).toBe(1);
      for (let i = 0; i < fps; i++) pulse.update(0, 1 / fps);
      return pulse.value;
    };
    expect(result(30)).toBeCloseTo(result(120), 12);
  });
});
