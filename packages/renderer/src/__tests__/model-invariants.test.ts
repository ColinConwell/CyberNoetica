import { describe, it, expect } from 'vitest';
import {
  apollonianPacking,
  reflectCircle,
  diskAutomorphismCircle,
} from '../geometry/packing.js';
import { penroseTriangles } from '../geometry/penrose.js';
import {
  rosePeriod,
  rosePoint,
  roulettePeriod,
  roulettePoint,
  superRadius,
  sampleCurve,
} from '../geometry/curves.js';
import { TorusLinkCurve } from '../geometry/torus-link.js';
import {
  schottkyMap,
  schottkyPoints,
  SCHOTTKY_CENTERS,
} from '../geometry/schottky.js';
import { twoSoliton } from '../geometry/soliton.js';
import { mapTrajectory } from '../geometry/maps.js';
import { streamField, dipoleField } from '../geometry/vector-fields.js';
import { aizawaDerivatives } from '../visualizers/attractor/v05-epsilon.js';

describe('faithful model invariants', () => {
  it('preserves the Descartes equation, disjoint circle interiors and tangency under Möbius deformation', () => {
    const circles = apollonianPacking(5),
      quad = circles.slice(0, 4);
    for (let i = 0; i < 4; i++) {
      const next = [...quad];
      next[i] = reflectCircle(quad, i);
      const sum = next.reduce((s, c) => s + c.k, 0);
      expect(sum * sum).toBeCloseTo(
        2 * next.reduce((s, c) => s + c.k * c.k, 0),
        9,
      );
    }
    for (let i = 1; i < circles.length; i++) {
      const c = circles[i],
        r = 1 / c.k;
      expect(Math.hypot(c.x, c.y) + r).toBeLessThanOrEqual(1 + 1e-10);
      for (let j = 1; j < i; j++) {
        const d = circles[j];
        expect(Math.hypot(c.x - d.x, c.y - d.y) + 1e-10).toBeGreaterThanOrEqual(
          r + 1 / d.k,
        );
      }
    }
    for (const a of [-0.45, 0, 0.45])
      for (let i = 1; i < 4; i++)
        for (let j = 1; j < i; j++) {
          const c = diskAutomorphismCircle(quad[i], a),
            d = diskAutomorphismCircle(quad[j], a);
          expect(Math.hypot(c.x - d.x, c.y - d.y)).toBeCloseTo(c.r + d.r, 11);
        }
  });
  it('preserves Penrose patch area and the two Robinson triangle angle sets', () => {
    const area = (
      a: readonly number[],
      b: readonly number[],
      c: readonly number[],
    ) =>
      Math.abs((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])) /
      2;
    const initial = penroseTriangles(0).reduce(
      (sum, t) => sum + area(t.a, t.b, t.c),
      0,
    );
    for (let depth = 1; depth <= 6; depth++) {
      const triangles = penroseTriangles(depth);
      expect(
        triangles.reduce((sum, t) => sum + area(t.a, t.b, t.c), 0),
      ).toBeCloseTo(initial, 10);
      for (const t of triangles) {
        const sides = [
          Math.hypot(t.a[0] - t.b[0], t.a[1] - t.b[1]),
          Math.hypot(t.b[0] - t.c[0], t.b[1] - t.c[1]),
          Math.hypot(t.c[0] - t.a[0], t.c[1] - t.a[1]),
        ].sort((a, b) => a - b);
        expect(sides[2] / sides[0]).toBeCloseTo((1 + Math.sqrt(5)) / 2, 10);
      }
    }
  });
  it('closes rational curves, completes adaptive sampling and renders distinct torus-link components', () => {
    for (let n = 1; n <= 12; n++)
      for (let d = 1; d <= 8; d++) {
        const end = rosePoint(rosePeriod(n, d), n, d);
        expect(end[0]).toBeCloseTo(1, 10);
        expect(end[1]).toBeCloseTo(0, 10);
      }
    for (const inside of [false, true])
      for (const [R, r] of [
        [5, 2],
        [6, 4],
        [7, 3],
      ]) {
        const a = roulettePoint(0, R, r, 0.7, inside),
          b = roulettePoint(roulettePeriod(R, r), R, r, 0.7, inside);
        expect(b[0]).toBeCloseTo(a[0], 10);
        expect(b[1]).toBeCloseTo(a[1], 10);
      }
    for (const m of [2, 4, 6, 8])
      expect(superRadius(0, m, 1, 2, 3)).toBeCloseTo(
        superRadius(2 * Math.PI, m, 1, 2, 3),
        10,
      );
    let end = 0;
    sampleCurve(
      (t) => [Math.cos(t), Math.sin(t)],
      0,
      2 * Math.PI,
      32,
      1e-9,
      64,
      (_a, _b, t) => (end = t),
    );
    expect(end).toBeGreaterThan(6.1);
    const a = new TorusLinkCurve(4, 2, 0),
      b = new TorusLinkCurve(4, 2, 1);
    expect(a.components).toBe(2);
    expect(a.getPoint(0).distanceTo(a.getPoint(1))).toBeLessThan(1e-12);
    let separation = Infinity;
    for (let i = 0; i < 256; i++)
      for (let j = 0; j < 256; j++)
        separation = Math.min(
          separation,
          a.getPoint(i / 256).distanceTo(b.getPoint(j / 256)),
        );
    expect(separation).toBeGreaterThan(0.1);
  });
  it('pairs disjoint Schottky circles with inverse holomorphic generators', () => {
    for (const r of [0.35, 0.78, 0.87])
      for (let g = 0; g < 4; g++) {
        const center = SCHOTTKY_CENTERS[g],
          target = SCHOTTKY_CENTERS[g ^ 1];
        const point = schottkyMap(
          center[0] + r * 0.6,
          center[1] + r * 0.8,
          g,
          r,
        );
        expect(
          Math.hypot(point[0] - target[0], point[1] - target[1]),
        ).toBeCloseTo(r, 12);
        const reverse = schottkyMap(point[0], point[1], g ^ 1, r);
        expect(reverse[0]).toBeCloseTo(center[0] + r * 0.6, 12);
        expect(reverse[1]).toBeCloseTo(center[1] + r * 0.8, 12);
      }
    const points = new Float32Array(12000);
    schottkyPoints(points, 0.87);
    expect(points.every(Number.isFinite)).toBe(true);
    expect(Math.max(...points)).toBeLessThan(2.2);
  });
  it('satisfies KdV through the collision and conserves integrated pulse mass', () => {
    const h = 0.003,
      dt = 0.0001;
    for (const t of [0, 2, 3, 5])
      for (const x of [-4, -1, 0, 2, 5]) {
        const u = twoSoliton(x, t),
          ux = (twoSoliton(x + h, t) - twoSoliton(x - h, t)) / (2 * h),
          ut = (twoSoliton(x, t + dt) - twoSoliton(x, t - dt)) / (2 * dt);
        const uxxx =
          (twoSoliton(x + 2 * h, t) -
            2 * twoSoliton(x + h, t) +
            2 * twoSoliton(x - h, t) -
            twoSoliton(x - 2 * h, t)) /
          (2 * h * h * h);
        expect(Math.abs(ut + 6 * u * ux + uxxx)).toBeLessThan(0.0001);
      }
    for (const t of [0, 3, 5]) {
      let mass = 0;
      for (let x = -40; x <= 40; x += 0.02) mass += twoSoliton(x, t) * 0.02;
      expect(mass).toBeCloseTo(4 * (0.9 + 0.5), 7);
    }
  });
  it('retains a nondegenerate Ikeda default after burn-in and confines all dissipative test paths', () => {
    const points = new Float32Array(40000);
    const count = mapTrajectory('ikeda', [0.89, 0.4, 6, 0], points);
    expect(count).toBe(20000);
    let min = Infinity,
      max = -Infinity;
    for (let i = 0; i < count; i++) {
      min = Math.min(min, points[2 * i]);
      max = Math.max(max, points[2 * i]);
    }
    expect(max - min).toBeGreaterThan(1);
    for (const u of [0.5, 0.7, 0.89, 0.905, 0.91]) {
      mapTrajectory('ikeda', [u, 0.4, 6, 0], points);
      expect(
        points.every(
          (value) => Number.isFinite(value) && Math.abs(value) <= 1 / (1 - u),
        ),
      ).toBe(true);
    }
  });
  it('has divergence-free prescribed flow and analytical vorticity, with the correct axial dipole field', () => {
    const h = 1e-5,
      x = 0.71,
      y = 1.13;
    const fxp = streamField(x + h, y, 0.4, 4),
      fxm = streamField(x - h, y, 0.4, 4),
      fyp = streamField(x, y + h, 0.4, 4),
      fym = streamField(x, y - h, 0.4, 4);
    expect((fxp[0] - fxm[0] + fyp[1] - fym[1]) / (2 * h)).toBeCloseTo(0, 8);
    expect((fxp[1] - fxm[1] - fyp[0] + fym[0]) / (2 * h)).toBeCloseTo(
      streamField(x, y, 0.4, 4)[2],
      8,
    );
    expect(dipoleField(1, 0, 1, 0)).toEqual([2, 0]);
    expect(dipoleField(0, 1, 1, 0)).toEqual([-1, 0]);
    expect(dipoleField(2, 0, 1, 0)).toEqual([0.25, 0]);
  });
  it('keeps Aizawa in the seeded basin across the curated parameter corners', () => {
    const keys = ['paramA', 'paramB', 'paramC', 'paramD', 'paramE', 'paramF'],
      ranges = [
        [0.9, 1],
        [0.65, 0.75],
        [0.55, 0.65],
        [3.2, 3.8],
        [0.2, 0.3],
        [0.08, 0.12],
      ];
    for (let mask = 0; mask < 64; mask++) {
      const params = Object.fromEntries(
        keys.map((key, i) => [key, ranges[i][(mask >> i) & 1]]),
      );
      let p = { x: 0.1, y: 0, z: 0 };
      const dt = 0.005;
      for (let i = 0; i < 16000; i++) {
        const a = aizawaDerivatives(p, params),
          b = aizawaDerivatives(
            {
              x: p.x + (a.x * dt) / 2,
              y: p.y + (a.y * dt) / 2,
              z: p.z + (a.z * dt) / 2,
            },
            params,
          ),
          c = aizawaDerivatives(
            {
              x: p.x + (b.x * dt) / 2,
              y: p.y + (b.y * dt) / 2,
              z: p.z + (b.z * dt) / 2,
            },
            params,
          ),
          d = aizawaDerivatives(
            { x: p.x + c.x * dt, y: p.y + c.y * dt, z: p.z + c.z * dt },
            params,
          );
        p = {
          x: p.x + (dt * (a.x + 2 * b.x + 2 * c.x + d.x)) / 6,
          y: p.y + (dt * (a.y + 2 * b.y + 2 * c.y + d.y)) / 6,
          z: p.z + (dt * (a.z + 2 * b.z + 2 * c.z + d.z)) / 6,
        };
      }
      expect(Math.hypot(p.x, p.y, p.z)).toBeLessThan(5);
    }
  });
});
