import { expect, it } from 'vitest';
import { FrameStatistics } from '../frame-statistics.js';

it('reports bounded measured percentiles and drops stale samples after reset', () => {
  const stats = new FrameStatistics();
  expect(stats.percentiles()).toBeNull();
  for (let i = 0; i < 200; i++) stats.add(i);
  stats.add(NaN);
  stats.add(-1);
  expect(stats.percentiles()).toEqual({ p50: 109, p95: 190, samples: 180 });
  stats.reset();
  expect(stats.percentiles()).toBeNull();
});
