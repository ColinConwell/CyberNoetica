import { describe, expect, it } from 'vitest';
import { MessageBus } from '@cybernoetica/core';
import type { AudioFeatures } from '@cybernoetica/core';
import { OrthographicCamera, Scene } from 'three';
import { loadVisualizer } from '../visualizers/registry.js';
import type { ComponentFrame } from '../journey/types.js';

const features = (band: string, frame: number): AudioFeatures => ({
  fftBins: new Float32Array(1024),
  bass: band === 'bass' ? 0.2 : 0,
  mid: band === 'mid' ? 0.2 : 0,
  high: band === 'high' ? 0.2 : 0,
  rms: band === 'rms' ? 0.2 : 0,
  spectralCentroid: 0,
  spectralFlux: 0,
  beatOnset: band === 'onset' && frame === 45,
  beatConfidence: 1,
  degraded: false,
});
// Distance signatures remove translation, rotation and uniform scale. A pulsing circle cannot pass.
function signature(points: number[][]): number[] {
  const center = [0, 0];
  for (const p of points)
    for (let a = 0; a < 2; a++) center[a] += p[a] / points.length;
  const radius = Math.sqrt(
    points.reduce(
      (s, p) => s + (p[0] - center[0]) ** 2 + (p[1] - center[1]) ** 2,
      0,
    ) / points.length,
  );
  return points.flatMap((p, i) =>
    [1, 5, 13, 23].map((lag) => {
      const q = points[(i + lag) % points.length];
      return Math.hypot(p[0] - q[0], p[1] - q[1]) / Math.max(1e-8, radius);
    }),
  );
}
function read(c: ComponentFrame) {
  return signature(
    Array.from({ length: 64 }, (_, i) => {
      const index = Math.floor((i * c.count) / 64) * 6;
      return [c.positions[index], c.positions[index + 1]];
    }),
  );
}
function rms(a: number[], b: number[]) {
  return Math.sqrt(a.reduce((s, x, i) => s + (x - b[i]) ** 2, 0) / a.length);
}
async function trajectory(
  band: string,
  params: Record<string, number> = {},
  fps = 60,
) {
  const entry = (await loadVisualizer('lissajous'))!,
    bus = new MessageBus(),
    viz = entry.create(bus),
    scene = new Scene();
  viz.setUserParam('traceTravel', 0);
  for (const [k, v] of Object.entries(params)) viz.setUserParam(k, v);
  viz.attach(scene);
  viz.setResolution(640, 360);
  const frames: number[][] = [];
  try {
    for (let i = 0; i < fps; i++) {
      bus.publish(
        'audio:features',
        features(i < fps * 0.5 ? 'silence' : band, Math.round((i * 60) / fps)),
      );
      viz.tick(1 / fps);
      if ((i + 1) % (fps / 30) === 0)
        frames.push(read(viz.getTransitionComponents!()[0]));
    }
    return frames;
  } finally {
    viz.dispose();
  }
}
it('the shape metric ignores camera-like transforms and detects local bending', () => {
  const p = Array.from({ length: 64 }, (_, i) => [
    Math.cos(i * 0.1),
    Math.sin(i * 0.1),
  ]);
  const transformed = p.map(([x, y]) => [
    7 + 3 * (x * Math.cos(0.8) - y * Math.sin(0.8)),
    -2 + 3 * (x * Math.sin(0.8) + y * Math.cos(0.8)),
  ]);
  expect(rms(signature(p), signature(transformed))).toBeLessThan(1e-12);
  expect(
    rms(
      signature(p),
      signature(p.map(([x, y], i) => [x, y + 0.2 * Math.sin(i * 0.6)])),
    ),
  ).toBeGreaterThan(0.05);
});
describe.each([
  ['mid', 'midToFlow'],
  ['high', 'highToRipple'],
  ['onset', 'onsetToTwist'],
])('%s changes internal shape', (band, key) => {
  it('changes pairwise geometry within 250 ms and can be disabled independently', async () => {
    const idle = await trajectory('silence'),
      driven = await trajectory(band),
      off = await trajectory(band, { [key]: 0 });
    const residual = driven.map((s, i) => rms(s, idle[i]));
    const onsetFrame = band === 'onset' ? 23 : 15;
    expect(
      Math.max(...residual.slice(onsetFrame, onsetFrame + 7)),
    ).toBeGreaterThan(0.025);
    expect(Math.max(...off.map((s, i) => rms(s, idle[i])))).toBeLessThan(1e-6);
  });
});
it('brightness alone does not pass the internal-shape test', async () => {
  const idle = await trajectory('silence'),
    light = await trajectory('rms');
  expect(Math.max(...light.map((s, i) => rms(s, idle[i])))).toBeLessThan(1e-6);
});
it('preserves phase at different rendering cadences', async () => {
  const reference = await trajectory('mid', {}, 60);
  for (const fps of [30, 120]) {
    const samples = await trajectory('mid', {}, fps);
    expect(rms(samples.at(-1)!, reference.at(-1)!)).toBeLessThan(0.035);
  }
});
it('keeps live Journey sample identities and alpha during rapid local deformation', async () => {
  const entry = (await loadVisualizer('lissajous'))!,
    bus = new MessageBus(),
    viz = entry.create(bus),
    scene = new Scene();
  viz.attach(scene);
  viz.setResolution(640, 360);
  const adapter = entry.createTransitionAdapter!(viz, 512),
    camera = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
  let revision: string | undefined;
  try {
    for (let i = 0; i < 90; i++) {
      bus.publish('audio:features', features(i % 12 < 6 ? 'mid' : 'high', i));
      viz.tick(1 / 60);
      const frame = adapter.read(camera, 1 / 60);
      revision ??= frame.revision;
      expect(frame.revision).toBe(revision);
      expect(frame.positions.every(Number.isFinite)).toBe(true);
      expect(
        frame.colors.filter((_, i) => i % 4 === 3).every((a) => a > 0.7),
      ).toBe(true);
    }
    expect(viz.getTransitionComponents!()).toHaveLength(8);
    const before = adapter.read(camera, 0).positions.slice();
    viz.tick(0.05);
    expect(adapter.read(camera, 0.05).positions).not.toEqual(before);
  } finally {
    adapter.dispose();
    viz.dispose();
    expect(scene.children).toHaveLength(0);
  }
});
it('keeps extreme expressiveness finite and every harmonic echo closed', async () => {
  const entry = (await loadVisualizer('lissajous'))!,
    bus = new MessageBus(),
    viz = entry.create(bus),
    scene = new Scene();
  for (const p of entry.metadata.params) viz.setUserParam(p.key, p.max);
  viz.attach(scene);
  try {
    for (let i = 0; i < 30; i++) {
      bus.publish('audio:features', {
        ...features('high', i),
        bass: 1,
        mid: 1,
        beatOnset: i === 0,
      });
      viz.tick(1 / 30);
    }
    const components = viz.getTransitionComponents!();
    expect(components).toHaveLength(12);
    for (const c of components) {
      expect(Array.from(c.positions).every(Number.isFinite)).toBe(true);
      expect(
        Math.hypot(
          c.positions[0] - c.positions[c.count * 6 - 3],
          c.positions[1] - c.positions[c.count * 6 - 2],
        ),
      ).toBeLessThan(1e-6);
    }
  } finally {
    viz.dispose();
  }
});
