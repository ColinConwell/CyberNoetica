import { expect, it } from 'vitest';
import { lorenzDerivs } from '../visualizers/lorenz/v01-alpha.js';
import { rosslerDerivs } from '../visualizers/lorenz/v02-beta.js';
import { chenDerivs } from '../visualizers/lorenz/v03-gamma.js';

it('keeps the curated flow envelopes bounded and visiting both sides of the seeded basin', () => {
  const models = [
    {
      derive: lorenzDerivs,
      keys: ['sigma', 'rho', 'beta'],
      ranges: [
        [9.5, 10.5],
        [26, 30],
        [2.6, 2.75],
      ],
    },
    {
      derive: rosslerDerivs,
      keys: ['paramA', 'paramB', 'paramC'],
      ranges: [
        [0.18, 0.22],
        [0.18, 0.22],
        [5.3, 6.1],
      ],
    },
    {
      derive: chenDerivs,
      keys: ['paramA', 'paramB', 'paramC'],
      ranges: [
        [34.8, 35.2],
        [2.9, 3.1],
        [27.7, 28.3],
      ],
    },
  ];
  for (const model of models)
    for (let corner = 0; corner < 8; corner++) {
      const params = Object.fromEntries(
        model.keys.map((key, i) => [key, model.ranges[i][(corner >> i) & 1]]),
      );
      let point = { x: 0.1, y: 0, z: 0 },
        minimum = Infinity,
        maximum = -Infinity;
      const dt = 0.005;
      const offset = (v: typeof point, scale: number) => ({
        x: point.x + v.x * scale,
        y: point.y + v.y * scale,
        z: point.z + v.z * scale,
      });
      for (let step = 0; step < 30000; step++) {
        const a = model.derive(point, params),
          b = model.derive(offset(a, dt / 2), params),
          c = model.derive(offset(b, dt / 2), params),
          d = model.derive(offset(c, dt), params);
        point = {
          x: point.x + (dt * (a.x + 2 * b.x + 2 * c.x + d.x)) / 6,
          y: point.y + (dt * (a.y + 2 * b.y + 2 * c.y + d.y)) / 6,
          z: point.z + (dt * (a.z + 2 * b.z + 2 * c.z + d.z)) / 6,
        };
        if (step > 5000) {
          minimum = Math.min(minimum, point.x);
          maximum = Math.max(maximum, point.x);
        }
      }
      expect(Math.hypot(point.x, point.y, point.z)).toBeLessThan(100);
      expect(minimum).toBeLessThan(-1);
      expect(maximum).toBeGreaterThan(1);
    }
});
