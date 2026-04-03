import { describe, it, expect } from 'vitest';
import { EMASmoothing } from '../smoothing.js';

describe('EMASmoothing', () => {
  it('tracks a constant value', () => {
    const ema = new EMASmoothing(0.5);
    for (let i = 0; i < 10; i++) ema.update(1.0);
    expect(ema.value).toBeCloseTo(1.0, 1);
  });

  it('smooths a step change', () => {
    const ema = new EMASmoothing(0.1);
    for (let i = 0; i < 10; i++) ema.update(0.0);
    ema.update(1.0);
    expect(ema.value).toBeLessThan(0.5);
    expect(ema.value).toBeGreaterThan(0.0);
  });

  it('high smoothing factor tracks quickly', () => {
    const ema = new EMASmoothing(0.9);
    ema.update(0.0);
    ema.update(1.0);
    expect(ema.value).toBeGreaterThan(0.8);
  });
});
