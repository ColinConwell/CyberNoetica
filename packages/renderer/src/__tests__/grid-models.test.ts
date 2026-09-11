import { describe, it, expect } from 'vitest';
import {
  gridStep,
  grayScottStep,
} from '../visualizers/simulation/grid-models.js';
import { FixedStepClock } from '../timing.js';
describe('persistent grid models', () => {
  it('preserves a Life block and evolves a blinker with period two', () => {
    const n = 12;
    const block = new Float32Array(n * n * 2);
    for (const [x, y] of [
      [5, 5],
      [5, 6],
      [6, 5],
      [6, 6],
    ])
      block[(y * n + x) * 2] = 1;
    expect(gridStep(block, n, 'life')).toEqual(block);
    const blink = new Float32Array(n * n * 2);
    for (const x of [4, 5, 6]) blink[(5 * n + x) * 2] = 1;
    const first = gridStep(blink, n, 'life');
    expect(first[(4 * n + 5) * 2]).toBe(1);
    expect(first[(5 * n + 4) * 2]).toBe(0);
    expect(gridStep(first, n, 'life')).toEqual(blink);
  });
  it('preserves the unperturbed Gray–Scott equilibrium and has the specified reaction signs', () => {
    expect(grayScottStep(1, 0, 0, 0, 0.04, 0.06)).toEqual([1, 0]);
    const [u, v] = grayScottStep(0.5, 0.4, 0, 0, 0.04, 0.06);
    expect(u).toBeCloseTo(0.485, 12);
    expect(v).toBeCloseTo(0.41, 12);
  });
  it('remains finite and nonnegative over 1000 diffusion steps', () => {
    const n = 24;
    let state = new Float32Array(n * n * 2);
    for (let i = 0; i < n * n; i++) state[i * 2] = 1;
    for (let y = 10; y < 14; y++)
      for (let x = 10; x < 14; x++) {
        state[(y * n + x) * 2] = 0.5;
        state[(y * n + x) * 2 + 1] = 0.4;
      }
    for (let step = 0; step < 1000; step++)
      state = gridStep(state, n, 'reaction');
    expect(
      state.every(
        (value) => Number.isFinite(value) && value >= 0 && value <= 1.0001,
      ),
    ).toBe(true);
    expect(state.some((value, index) => index % 2 === 1 && value > 0.05)).toBe(
      true,
    );
  });
  it('advances equal generations at 30, 60 and 120 FPS', () => {
    for (const fps of [30, 60, 120]) {
      let generations = 0;
      const clock = new FixedStepClock(0.1);
      for (let i = 0; i < fps * 3; i++)
        clock.advance(1 / fps, () => generations++);
      expect(generations).toBe(30);
    }
  });
});
