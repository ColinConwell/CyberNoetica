import { describe, expect, it } from 'vitest';
import { MessageBus } from '@cybernoetica/core';
import type { AudioFeatures } from '@cybernoetica/core';
import { Scene, Vector3 } from 'three';
import { loadVisualizer } from '../visualizers/registry.js';
import { JOURNEY_TYPES } from '../journey/types.js';
import type { ComponentFrame } from '../journey/types.js';
import { visualLevel } from '../audio-mapping.js';

const silent = (): AudioFeatures => ({
  fftBins: new Float32Array(1024),
  bass: 0,
  mid: 0,
  high: 0,
  rms: 0,
  spectralCentroid: 0,
  spectralFlux: 0,
  beatOnset: false,
  beatConfidence: 0,
  degraded: false,
});

/** Model-space probes include object transforms and actual GPU deformation evaluators.
 * Shape summaries do not assume adaptive curve vertex indices are material identities. */
function snapshot(components: ComponentFrame[]) {
  return components.map((c) => {
    c.object?.updateWorldMatrix(true, false);
    const matrix = c.transform ?? c.object?.matrixWorld,
      point = new Vector3(),
      out = new Float32Array(3);
    const count = c.kind === 'curves' ? c.count * 2 : c.count,
      points: number[][] = [];
    for (let i = 0; i < 96; i++) {
      const j = Math.min(count - 1, Math.floor((i * count) / 96));
      if (
        j < 0 ||
        (c.visible && !c.visible(c.kind === 'curves' ? Math.floor(j / 2) : j))
      )
        continue;
      if (c.vertex) c.vertex(j, out);
      else for (let a = 0; a < 3; a++) out[a] = c.positions[j * 3 + a];
      point.fromArray(out);
      if (matrix) point.applyMatrix4(matrix);
      if (!point.toArray().every(Number.isFinite))
        throw new Error(`Nonfinite ${c.id}`);
      points.push(point.toArray());
    }
    const mean = [0, 0, 0],
      spread = [0, 0, 0];
    for (const p of points)
      for (let a = 0; a < 3; a++) mean[a] += p[a] / points.length;
    for (const p of points)
      for (let a = 0; a < 3; a++)
        spread[a] += (p[a] - mean[a]) ** 2 / points.length;
    return { id: c.id, mean, spread: spread.map(Math.sqrt), points };
  });
}
function difference(
  a: ReturnType<typeof snapshot>,
  b: ReturnType<typeof snapshot>,
) {
  let sum = 0,
    n = 0;
  for (const x of a) {
    const y = b.find((c) => c.id === x.id);
    if (!y) continue;
    for (let k = 0; k < 3; k++) {
      sum += (x.mean[k] - y.mean[k]) ** 2 + (x.spread[k] - y.spread[k]) ** 2;
      n += 2;
    }
  }
  return Math.sqrt(sum / Math.max(1, n));
}
async function probe(
  type: string,
  gain: number,
  signal: 'silence' | 'bands' | 'bass' | 'rms',
  fps = 60,
) {
  const entry = (await loadVisualizer(type))!,
    bus = new MessageBus(),
    viz = entry.create(bus),
    scene = new Scene();
  viz.setUserParam('audioSensitivity', gain);
  viz.attach(scene);
  viz.setResolution(640, 360);
  const frames: ReturnType<typeof snapshot>[] = [];
  try {
    for (let i = 0; i < fps * 2; i++) {
      const f = silent(),
        time = i / fps;
      if (time >= 0.5 && time < 1.25) {
        if (signal === 'bands' || signal === 'bass') f.bass = 0.16;
        if (signal === 'bands') {
          f.mid = 0.12;
          f.high = 0.08;
        }
        if (signal === 'bands' || signal === 'rms') f.rms = 0.12;
      }
      bus.publish('audio:features', f);
      viz.tick(1 / fps);
      if (i % (fps / 30) === 0)
        frames.push(snapshot(viz.getTransitionComponents!()));
    }
  } finally {
    viz.dispose();
    expect(scene.children).toHaveLength(0);
  }
  return frames;
}
const mean = (a: number[]) => a.reduce((s, x) => s + x, 0) / a.length;
describe('visual audio gain', () => {
  it('preserves silence, unity, calibrated headroom, and monotonic quiet-signal range', () => {
    for (const gain of [0, 1, 2.5, 8]) expect(visualLevel(0, gain)).toBe(0);
    expect(visualLevel(0.2, 1)).toBe(0.2);
    expect(visualLevel(0.2, 0)).toBe(0);
    expect(visualLevel(0.2, 2.5)).toBeGreaterThan(0.35);
    expect(visualLevel(0.2, 8)).toBeGreaterThan(visualLevel(0.2, 2.5));
    expect(visualLevel(1, 8)).toBe(1);
    expect(visualLevel(NaN)).toBe(0);
  });
});
describe.each(JOURNEY_TYPES)('%s measured audio motion', (type) => {
  it('separates audio displacement from idle motion and measures sensitivity headroom', async () => {
    const baseline = await probe(type, 0, 'silence'),
      off = await probe(type, 0, 'bands');
    const linear = await probe(type, 1, 'bands'),
      normal = await probe(type, 2.5, 'bands'),
      high = await probe(type, 8, 'bands');
    const residual = (frames: typeof baseline) =>
      frames.map((f, i) => difference(f, baseline[i]));
    const offMotion = mean(residual(off)),
      lowMotion = mean(residual(linear)),
      defaultMotion = mean(residual(normal)),
      highMotion = mean(residual(high));
    // No onset or centroid changes: sensitivity zero must match the silent trajectory exactly.
    expect(offMotion).toBeLessThan(1e-7);
    expect(defaultMotion).toBeGreaterThan(0.0005);
    expect(defaultMotion).toBeGreaterThan(lowMotion * 1.05);
    expect(highMotion).toBeGreaterThan(defaultMotion * 1.02);
    const response = residual(normal);
    // Derivative of the sound-only shape displacement: catches frozen audio-reactive snapshots.
    const responseSpeed = mean(
      response.slice(1).map((v, i) => Math.abs(v - response[i]) * 30),
    );
    expect(responseSpeed).toBeGreaterThan(0.0005);
    const attack = response.slice(15, 24); // first 300 ms after the attack
    expect(Math.max(...attack)).toBeGreaterThan(0.0005);
    if (process.env.MOTION_REPORT)
      console.log(
        JSON.stringify({
          type,
          offMotion,
          lowMotion,
          defaultMotion,
          highMotion,
          responseSpeed,
          attack: Math.max(...attack),
        }),
      );
  });
});
it('tracks attack/release and is consistent at 30, 60 and 120 Hz', async () => {
  const results = [];
  for (const fps of [30, 60, 120]) {
    const base = await probe('geodesic-beta', 0, 'silence', fps),
      driven = await probe('geodesic-beta', 2.5, 'bands', fps);
    const response = driven.map((f, i) => difference(f, base[i]));
    expect(response[23]).toBeGreaterThan(0.01);
    expect(response.at(-1)!).toBeLessThan(response[35] * 0.04);
    results.push(mean(response));
  }
  expect(Math.max(...results) / Math.min(...results)).toBeLessThan(1.08);
});

it('distinguishes geometric bass response from brightness-only RMS response', async () => {
  const baseline = await probe('lissajous', 0, 'silence');
  const bass = await probe('lissajous', 2.5, 'bass'),
    light = await probe('lissajous', 2.5, 'rms');
  expect(mean(bass.map((f, i) => difference(f, baseline[i])))).toBeGreaterThan(
    0.005,
  );
  expect(mean(light.map((f, i) => difference(f, baseline[i])))).toBeLessThan(
    1e-7,
  );
});
