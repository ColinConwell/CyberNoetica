import { describe, it, expect } from 'vitest';
import { initialTransport, isPermutation } from '../journey/transport.js';
import { WorkerTransportSolver } from '../journey/solver.js';
import { createJourney, parseJourney } from '../journey/definition.js';
import type { TransportAlgorithm } from '../journey/types.js';
const a = Float32Array.from([1, 0, 0, 0, 1, 0, -1, 0, 0, 0, -1, 0]);
const b = Float32Array.from([0, -1, 0, -1, 0, 0, 0, 1, 0, 1, 0, 0]);
describe.each<TransportAlgorithm>(['auto', 'projection', 'polar', 'identity'])(
  '%s transport',
  (algorithm) => {
    it('is deterministic, bijective, finite and preserves borrowed clouds', () => {
      const beforeA = a.slice(),
        beforeB = b.slice(),
        result = initialTransport(a, b, 32, algorithm);
      expect(isPermutation(result.indices)).toBe(true);
      expect(initialTransport(a, b, 32, algorithm).indices).toEqual(
        result.indices,
      );
      expect(Number.isFinite(result.cost)).toBe(true);
      expect(a).toEqual(beforeA);
      expect(b).toEqual(beforeB);
      if (algorithm === 'identity')
        expect([...result.indices]).toEqual([0, 1, 2, 3]);
      if (algorithm === 'polar') expect(result.cost).toBe(0);
      expect(() =>
        initialTransport(
          new Float32Array([NaN, 0, 0]),
          new Float32Array(3),
          1,
          algorithm,
        ),
      ).toThrow();
    });
    it('honors the selected algorithm without a browser worker and supports cancellation', async () => {
      const solver = new WorkerTransportSolver();
      try {
        const result = await solver.solve(a, b, 32, undefined, algorithm);
        expect(result.backend).toBe(
          algorithm === 'auto' ? 'projection' : algorithm,
        );
        const controller = new AbortController();
        const promise = solver.solve(a, b, 32, controller.signal, algorithm);
        controller.abort();
        await expect(promise).rejects.toMatchObject({ name: 'AbortError' });
      } finally {
        solver.dispose();
      }
    });
  },
);
it('round-trips choices, bounds controls, and migrates old routes without changing their rendering', () => {
  const route = createJourney();
  route.transport = 'polar';
  route.transitionLook = {
    path: 'vortex',
    rendering: 'streaks',
    curvature: 1.2,
    traceLength: 0.3,
  };
  const parsed = parseJourney(JSON.parse(JSON.stringify(route)));
  expect(parsed.transport).toBe('polar');
  expect(parsed.transitionLook).toEqual(route.transitionLook);
  expect(
    parseJourney({
      ...route,
      transport: 'unknown',
      transitionLook: { curvature: Infinity, traceLength: 100 },
    }).transitionLook,
  ).toEqual({
    path: 'direct',
    rendering: 'particles',
    curvature: 0.35,
    traceLength: 0.4,
  });
  const legacy = { ...route, transport: undefined, transitionLook: undefined };
  expect(parseJourney(legacy).transitionLook.path).toBe('direct');
  expect(parseJourney(legacy).transitionLook.rendering).toBe('particles');
  route.guidance[0].amount = 10;
  expect(parseJourney(route).guidance[0].amount).toBe(3);
});
