import { describe, it, expect } from 'vitest';
import {
  clampSoundscapeParams,
  DEFAULT_SOUNDSCAPE_PARAMS,
  soundscapeBeatIndex,
  soundscapeGainsAt,
  soundscapePhase,
} from '../soundscape-loop.js';

describe('soundscape-loop', () => {
  const params = { ...DEFAULT_SOUNDSCAPE_PARAMS, energy: 1, brightness: 0.5, beatRate: 60 };

  it('wraps phase into [0, 1)', () => {
    expect(soundscapePhase(0, 24)).toBe(0);
    expect(soundscapePhase(12, 24)).toBeCloseTo(0.5, 5);
    expect(soundscapePhase(24, 24)).toBeCloseTo(0, 5);
  });

  it('shifts dominant band across the cycle', () => {
    const bass = soundscapeGainsAt(0.08, params);
    const mid = soundscapeGainsAt(0.42, params);
    const high = soundscapeGainsAt(0.78, params);
    expect(bass.bass).toBeGreaterThan(mid.bass);
    expect(bass.bass).toBeGreaterThan(high.bass);
    expect(mid.mid).toBeGreaterThan(bass.mid);
    expect(mid.mid).toBeGreaterThan(high.mid);
    expect(high.high).toBeGreaterThan(bass.high);
    expect(high.high).toBeGreaterThan(mid.high);
  });

  it('tilts highs with brightness', () => {
    const dark = soundscapeGainsAt(0.78, { ...params, brightness: 0 });
    const bright = soundscapeGainsAt(0.78, { ...params, brightness: 1 });
    expect(bright.high).toBeGreaterThan(dark.high);
  });

  it('counts beats from BPM', () => {
    expect(soundscapeBeatIndex(0, 60)).toBe(0);
    expect(soundscapeBeatIndex(1, 60)).toBe(1);
    expect(soundscapeBeatIndex(2.9, 60)).toBe(2);
  });

  it('emits a rising-edge beat flag', () => {
    const quiet = soundscapeGainsAt(0, params, 1, 1);
    const onset = soundscapeGainsAt(0, params, 1, 0);
    expect(quiet.beat).toBe(false);
    expect(onset.beat).toBe(true);
  });

  it('clamps params to the supported range', () => {
    const clamped = clampSoundscapeParams({
      cycleLength: 2,
      energy: 4,
      brightness: -1,
      beatRate: 400,
    });
    expect(clamped.cycleLength).toBe(8);
    expect(clamped.energy).toBe(1);
    expect(clamped.brightness).toBe(0);
    expect(clamped.beatRate).toBe(180);
  });
});
