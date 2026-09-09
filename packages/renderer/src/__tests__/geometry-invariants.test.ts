import { describe, it, expect } from 'vitest';
import { hopfLift, projectHopf } from '../geometry/hopf.js';
import {
  membraneModeDescriptor,
  membraneModeTable,
  RADIAL_SAMPLES,
  besselJ,
} from '../visualizers/chladni/membrane-modes.js';
import { spectrumAt, resonantLevel, topologyValue } from '../audio-mapping.js';
import type { AudioFeatures } from '@cybernoetica/core';

describe('geometry and audio invariants', () => {
  it('keeps Hopf lifts on S³ and closes all unclipped fibers', () => {
    for (const theta of [0.05, 0.7, 2, 3.1])
      for (const phi of [0, 1, 3])
        for (const twist of [0, 0.9, 2]) {
          for (const t of [0, 0.7, 2, 5])
            expect(
              hopfLift(theta, phi, t, twist).reduce((sum, x) => sum + x * x, 0),
            ).toBeCloseTo(1, 12);
          const first = projectHopf(hopfLift(theta, phi, 0, twist));
          const last = projectHopf(hopfLift(theta, phi, 2 * Math.PI, twist));
          if (first && last)
            for (let axis = 0; axis < 3; axis++)
              expect(first[axis]).toBeCloseTo(last[axis], 10);
        }
    expect(projectHopf([0, 0, 0, 1])).toBeNull();
    expect(projectHopf([0.6, 0, 0, 0.8])).toEqual([3.0000000000000004, 0, 0]);
  });
  it('uses the same Bessel mode identity for geometry and resonant frequency', () => {
    for (const order of [0, 3, 6]) {
      const table = membraneModeTable(order);
      for (let index = 0; index < 8; index++) {
        const mode = membraneModeDescriptor(order, index);
        expect(Number.isFinite(mode.root)).toBe(true);
        const radialIndex = 173;
        expect(table[(index * RADIAL_SAMPLES + radialIndex) * 4]).toBeCloseTo(
          besselJ(mode.order, (mode.root * radialIndex) / (RADIAL_SAMPLES - 1)),
          6,
        );
      }
    }
  });
  it('interpolates physical bins and rejects energy far outside a resonance', () => {
    const spectrum = new Float32Array(2048);
    spectrum[100] = 1;
    const features = {
      spectrum,
      sampleRate: 48000,
      fftSize: 4096,
    } as AudioFeatures;
    expect(spectrumAt(features, (100 * 48000) / 4096)).toBe(1);
    expect(spectrumAt(features, (100.5 * 48000) / 4096)).toBeCloseTo(0.5);
    expect(resonantLevel(features, (100 * 48000) / 4096, 30)).toBeCloseTo(
      1 / Math.sqrt(3),
    );
    expect(resonantLevel(features, (50 * 48000) / 4096, 30)).toBeLessThan(0.01);
  });
  it('holds topology across small boundary fluctuations', () => {
    expect(topologyValue(3, 3.55, 2, 8)).toBe(3);
    expect(topologyValue(3, 3.7, 2, 8)).toBe(4);
    expect(topologyValue(4, 3.45, 2, 8)).toBe(4);
  });
});
