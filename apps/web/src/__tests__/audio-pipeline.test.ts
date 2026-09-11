import { describe, it, expect } from 'vitest';
import { SpectrumAnalyzer } from '@cybernoetica/audio';

describe('audio measurement contract', () => {
  it('weights centroid by amplitude and distinguishes it from a display spectrum', () => {
    const samples = Float32Array.from(
      { length: 4096 },
      (_, i) =>
        0.1 * Math.sin((2 * Math.PI * 32 * i) / 4096) +
        0.01 * Math.sin((2 * Math.PI * 320 * i) / 4096),
    );
    const f = new SpectrumAnalyzer(48000).analyze(samples, 2);
    expect(f.spectralCentroid).toBeCloseTo(
      (32 * 0.1 + 320 * 0.01) / 0.11 / 2048,
      5,
    );
    expect(f.fftBins[32]).toBeCloseTo(0.8, 5);
    expect(f.fftBins[320]).toBeCloseTo(0.6, 5);
    expect(f).toMatchObject({
      sampleRate: 48000,
      fftSize: 4096,
      hopSize: 512,
      timestamp: 2,
      degraded: false,
    });
  });
});
