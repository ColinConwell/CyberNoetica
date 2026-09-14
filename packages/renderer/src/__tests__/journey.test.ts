import { describe, it, expect } from 'vitest';
import { MessageBus } from '@cybernoetica/core';
import * as THREE from 'three';
import { JOURNEY_TYPES } from '../journey/types.js';
import {
  createJourney,
  parseJourney,
  normalizedWeights,
  quintic,
  guidanceEnvelope,
} from '../journey/definition.js';
import {
  projectionTransport,
  refineTransport,
  isPermutation,
} from '../journey/transport.js';
import { loadVisualizer } from '../visualizers/registry.js';
import { GeometryTransitionAdapter } from '../journey/adapter.js';
import { GuidanceEngine } from '../journey/guidance.js';

describe('Journey contracts', () => {
  it('round-trips bounded deterministic routes and rejects unsupported models', () => {
    const route = createJourney(22, 'orbital');
    expect(createJourney(22, 'orbital')).toEqual(route);
    expect(parseJourney(JSON.parse(JSON.stringify(route))).stops).toHaveLength(
      6,
    );
    expect(
      route.stops
        .slice(1)
        .every((s, i) => s.layers[0].type !== route.stops[i].layers[0].type),
    ).toBe(true);
    route.stops[0].layers[0].type = 'mandelbrot';
    expect(() => parseJourney(route)).toThrow('Unsupported');
    expect(() => parseJourney({ version: 2, stops: [] })).toThrow();
  });
  it('normalizes weights without losing the last valid all-zero edit', () => {
    expect(normalizedWeights([0, 0], [0.25, 0.75])).toEqual([0.25, 0.75]);
    expect(normalizedWeights([1, 0, 0])).toEqual([1, 0, 0]);
  });
  it('matches endpoint positions and first derivatives', () => {
    expect(quintic(0)).toBe(0);
    expect(quintic(1)).toBe(1);
    expect(guidanceEnvelope(0)).toBe(0);
    expect(guidanceEnvelope(1)).toBe(0);
    const h = 1e-5;
    expect(quintic(h) / h).toBeLessThan(1e-6);
    expect((1 - quintic(1 - h)) / h).toBeLessThan(1e-6);
    expect(guidanceEnvelope(h) / h).toBeLessThan(0.001);
  });
  it('uses a complete assignment and never accepts a worse sparse refinement', () => {
    const a = Float32Array.from({ length: 96 }, (_, i) => Math.sin(i * 2.5)),
      b = a.slice().reverse();
    const base = projectionTransport(a, b, 8),
      refined = refineTransport(a, b, base, 1000);
    expect(isPermutation(base.indices)).toBe(true);
    expect(isPermutation(refined.indices)).toBe(true);
    expect(refined.cost).toBeLessThanOrEqual(base.cost);
    expect(projectionTransport(a, b, 8).indices).toEqual(base.indices);
    expect(projectionTransport(a, a, 8).cost).toBe(0);
    expect(() =>
      projectionTransport(new Float32Array([NaN, 0, 0]), new Float32Array(3)),
    ).toThrow();
  });
  it('samples curve segments in proportion to length', () => {
    const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    const adapter = new GeometryTransitionAdapter(
      {
        getTransitionComponents: () => [
          {
            id: 'line',
            kind: 'curves',
            revision: 1,
            count: 2,
            positions: new Float32Array([
              0, 0, -0.5, 0.1, 0, -0.5, 0, 0.5, -0.5, 0.9, 0.5, -0.5,
            ]),
          },
        ],
      },
      100,
    );
    const frame = adapter.read(camera);
    let short = 0;
    for (let i = 0; i < 100; i++) if (frame.positions[i * 3 + 1] === 0) short++;
    expect(short).toBe(10);
    adapter.dispose();
    expect(() => adapter.read(camera)).toThrow();
  });
  it('supports custom guidance providers with bounded output', () => {
    const engine = new GuidanceEngine(),
      unregister = engine.register({
        id: 'sensor',
        signals: [{ key: 'x', label: 'X', min: 0, max: 1 }],
        sample: () => ({ x: 1 }),
      });
    const route = {
      id: 'r',
      source: 'sensor.x',
      target: 'spread' as const,
      amount: 1,
      smoothing: 0,
      min: 0,
      max: 1,
      invert: false,
    };
    expect(engine.evaluate([route], 0, 0.1).spread).toBe(0.5);
    unregister();
    expect(engine.evaluate([route], 0, 0.1).spread).toBe(0);
  });
});
describe.each(JOURNEY_TYPES)('%s transition geometry', (type) => {
  it('reads live finite geometry without modifying the native scene', async () => {
    const entry = await loadVisualizer(type);
    expect(entry?.createTransitionAdapter).toBeTypeOf('function');
    const scene = new THREE.Scene(),
      viz = entry!.create(new MessageBus());
    viz.attach(scene);
    viz.tick(1 / 60);
    const camera = viz.metadata.usesPerspective
      ? new THREE.PerspectiveCamera(60, 16 / 9, 0.1, 100)
      : new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    if (camera instanceof THREE.PerspectiveCamera) {
      const view = viz.getViewState(),
        d = view.distance ?? 12,
        a = view.orbitAngle ?? 0,
        e = view.elevation ?? 0;
      camera.position.set(
        Math.sin(a) * Math.cos(e) * d,
        Math.sin(e) * d,
        Math.cos(a) * Math.cos(e) * d,
      );
      camera.lookAt(0, 0, 0);
    }
    const adapter = entry!.createTransitionAdapter!(viz, 128),
      before = scene.children.length,
      frame = adapter.read(camera);
    expect(frame.positions.every(Number.isFinite)).toBe(true);
    expect(frame.colors.some((v, i) => i % 4 === 3 && v > 0)).toBe(true);
    expect(scene.children.length).toBe(before);
    const positions = frame.positions.slice();
    viz.tick(0.1);
    adapter.read(camera, 0.1);
    expect(frame.positions).not.toEqual(positions);
    adapter.dispose();
    viz.dispose();
    expect(scene.children).toHaveLength(0);
  });
});
