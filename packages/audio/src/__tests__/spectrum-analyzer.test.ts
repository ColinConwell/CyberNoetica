import { describe, expect, it } from 'vitest';
import { SpectrumAnalyzer, visualLevel } from '../spectrum-analyzer.js';
import { tone, silence, pulseTrainFrame } from '../signal-fixtures.js';

describe('calibrated spectral analysis', () => {
  it('recovers sinusoidal RMS and Hann-corrected band power', () => {
    const analyzer = new SpectrumAnalyzer(48000);
    const f = analyzer.analyze(tone(750, 0.5), 0);
    expect(f.rms).toBeCloseTo(0.5 / Math.sqrt(2), 7);
    expect(f.bandLevels!.mid).toBeCloseTo(f.rms, 6);
    expect(f.spectrum![64]).toBeCloseTo(0.5, 6);
    expect(f.spectralCentroid * 24000).toBeCloseTo(750, 1);
  });

  it('retains absolute dynamics while separately reporting spectral balance', () => {
    const a = new SpectrumAnalyzer(48000);
    const quiet = a.analyze(tone(750, 0.01), 0);
    const loud = a.analyze(tone(750, 0.5), 1);
    expect(loud.mid).toBeGreaterThan(quiet.mid + 0.5);
    expect(quiet.bandBalance!.mid).toBeCloseTo(loud.bandBalance!.mid, 5);
    expect(visualLevel(0.0001)).toBe(0);
  });

  it('keeps stereo energy during phase cancellation and measures phase/correlation', () => {
    const a = new SpectrumAnalyzer(48000);
    const left = tone(750, 0.25);
    const opposite = a.analyze(left, 0, tone(750, 0.25, 4096, 48000, Math.PI));
    expect(opposite.rms).toBeCloseTo(0.25 / Math.sqrt(2), 7);
    expect(opposite.stereoCorrelation).toBeCloseTo(-1, 7);
    expect(Math.abs(opposite.stereoPhase!)).toBeCloseTo(Math.PI, 6);
    const quadrature = a.analyze(
      left,
      1,
      tone(750, 0.25, 4096, 48000, Math.PI / 2),
    );
    expect(quadrature.stereoCorrelation).toBeCloseTo(0, 6);
    expect(Math.abs(quadrature.stereoPhase!)).toBeCloseTo(Math.PI / 2, 6);
  });

  it('estimates a tonal pitch and reports confidence rather than inventing a pitch in silence', () => {
    const toneFeatures = new SpectrumAnalyzer(48000).analyze(tone(440), 0);
    expect(toneFeatures.pitchHz).toBeCloseTo(440, 0);
    expect(toneFeatures.pitchConfidence).toBeGreaterThan(0.95);
    const silent = new SpectrumAnalyzer(48000).analyze(silence(), 0);
    expect(silent.pitchHz).toBe(0);
    expect(silent.rms).toBe(0);
  });

  it('detects a quiet pulse train once per transient, with increasing event IDs', () => {
    const a = new SpectrumAnalyzer(48000);
    const events: number[] = [];
    const ids: number[] = [];
    for (let frame = 0; frame < (4 * 48000) / 512; frame++) {
      const time = (frame * 512) / 48000;
      const f = a.analyze(pulseTrainFrame(time), time);
      if (f.beatOnset) {
        events.push(time);
        ids.push(f.onsetId!);
      }
    }
    expect(events.length).toBeGreaterThanOrEqual(7);
    expect(events.length).toBeLessThanOrEqual(8);
    for (let i = 1; i < events.length; i++) {
      expect(events[i] - events[i - 1]).toBeGreaterThan(0.4);
      expect(ids[i]).toBe(ids[i - 1] + 1);
    }
  });

  it('does not mistake abrupt tone releases for additional attacks', () => {
    const analyzer = new SpectrumAnalyzer(48000),
      samples = new Float32Array(4096);
    const events: number[] = [];
    for (let end = 4096; end <= 96000; end += 512) {
      for (let i = 0; i < samples.length; i++) {
        const time = (end - samples.length + i) / 48000;
        samples[i] = [0.2, 0.65, 1.1, 1.55].some(
          (start) => time >= start && time < start + 0.16,
        )
          ? 0.3 * Math.sin(2 * Math.PI * 750 * time)
          : 0;
      }
      if (analyzer.analyze(samples, end / 48000).beatOnset)
        events.push(end / 48000);
    }
    expect(events).toHaveLength(4);
    for (let i = 0; i < events.length; i++)
      expect(events[i] - (0.2 + i * 0.45)).toBeGreaterThanOrEqual(0);
  });

  it('uses physical bands at both 44.1 and 48 kHz and has finite silence output', () => {
    for (const rate of [44100, 48000]) {
      for (const [hz, key] of [
        [100, 'bass'],
        [1000, 'mid'],
        [8000, 'high'],
      ] as const) {
        const f = new SpectrumAnalyzer(rate).analyze(
          tone(hz, 0.25, 4096, rate),
          0,
        );
        expect(f.bandBalance![key]).toBeGreaterThan(0.98);
      }
      const f = new SpectrumAnalyzer(rate).analyze(silence(), 0);
      for (const value of Object.values(f))
        if (typeof value === 'number')
          expect(Number.isFinite(value)).toBe(true);
      expect(f.bass + f.mid + f.high).toBe(0);
      expect(f.beatOnset).toBe(false);
    }
  });
});
