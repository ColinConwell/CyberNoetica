import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { MessageBus } from '@cybernoetica/core';
import type { AudioFeatures } from '@cybernoetica/core';
import {
  besselJ,
  membraneRoots,
  membraneModeTable,
  RADIAL_SAMPLES,
} from '../visualizers/chladni/membrane-modes.js';
import { ChladniCircularVisualizer } from '../visualizers/chladni/v02-beta.js';
import { HopfVisualizer } from '../visualizers/hopf/v01-alpha.js';
import {
  FlowVisualizer,
  FLOW_SHARED_PARAMS,
  FLOW_VIEW_FIELDS,
  FLOW_VIEWPORT,
} from '../visualizers/lorenz/engine.js';

const sound: AudioFeatures = {
  fftBins: new Float32Array(3).fill(1),
  bass: 1,
  mid: 1,
  high: 1,
  rms: 1,
  spectralCentroid: 1,
  spectralFlux: 0,
  beatOnset: false,
  beatConfidence: 0,
  degraded: false,
};

describe('circular membrane eigenfunctions', () => {
  it('matches independent tabulated Bessel values and first roots', () => {
    expect(besselJ(0, 1)).toBeCloseTo(0.7651976865579666, 12);
    expect(besselJ(1, 1)).toBeCloseTo(0.4400505857449335, 12);
    expect(besselJ(6, 1)).toBeCloseTo(0.00002093833800238927, 12);
    expect(membraneRoots(0)[0]).toBeCloseTo(2.404825557695773, 11);
    expect(membraneRoots(1)[0]).toBeCloseTo(3.831705970207512, 11);
    expect(membraneRoots(9)[3]).toBeCloseTo(24.23388525775055, 10);
  });
  it('has finite modes with zero displacement at the fixed rim for every order', () => {
    for (let n = 0; n <= 9; n++) {
      const roots = membraneRoots(n);
      expect(roots[0]).toBeGreaterThan(n);
      for (const root of roots)
        expect(Math.abs(besselJ(n, root))).toBeLessThan(1e-11);
      expect(besselJ(n, 0)).toBe(n === 0 ? 1 : 0);
    }
    for (const order of [0, 6]) {
      const data = membraneModeTable(order);
      expect(data.every(Number.isFinite)).toBe(true);
      for (let m = 0; m < 8; m++)
        expect(data[((m + 1) * RADIAL_SAMPLES - 1) * 4]).toBe(0);
    }
  });
  it('handles short spectra and removes stale mode amplitudes on silence', () => {
    const bus = new MessageBus();
    const scene = new THREE.Scene();
    const viz = new ChladniCircularVisualizer(bus);
    viz.attach(scene);
    bus.publish('audio:features', sound);
    viz.tick();
    const material = (scene.children[0] as THREE.Mesh)
      .material as THREE.ShaderMaterial;
    expect(
      (material.uniforms.u_modeAmps.value as number[]).every(Number.isFinite),
    ).toBe(true);
    bus.publish('audio:features', {
      ...sound,
      fftBins: new Float32Array(0),
      rms: 0,
    });
    viz.tick();
    expect(material.uniforms.u_modeAmps.value).toEqual(Array(8).fill(0));
    viz.dispose();
  });
});

describe('Hopf geometry', () => {
  it('remains finite at both latitude extremes and maximum audio spread, with closed fibers', () => {
    const bus = new MessageBus();
    const scene = new THREE.Scene();
    const viz = new HopfVisualizer(bus);
    viz.attach(scene);
    for (const p of viz.metadata.params) viz.setUserParam(p.key, p.max);
    bus.publish('audio:features', sound);
    for (let i = 0; i < 60; i++) viz.tick();
    for (const latitude of [-0.9, 0.9]) {
      viz.setUserParam('latitude', latitude);
      viz.tick();
      expect(scene.children).toHaveLength(1);
      const geometry = (scene.children[0] as THREE.Mesh)
        .geometry as THREE.InstancedBufferGeometry;
      expect(geometry.instanceCount).toBe(48 * 128);
      expect(
        Array.from(geometry.getAttribute('instanceStart').array).every(
          Number.isFinite,
        ),
      ).toBe(true);
    }
    viz.dispose();
  });
});

function constantFlow(speed: number) {
  const defaults = Object.fromEntries(
    FLOW_SHARED_PARAMS.map((p) => [p.key, p.initial]),
  );
  const viz = new FlowVisualizer(
    {
      metadata: {
        type: 'test-flow',
        label: 'test',
        description: '',
        usesPerspective: true,
        params: FLOW_SHARED_PARAMS,
        viewStateFields: FLOW_VIEW_FIELDS,
        viewport: FLOW_VIEWPORT,
      },
      defaultParams: { ...defaults, integrationSpeed: speed, trailLength: 8 },
      derivs: () => ({ x: 1, y: 0, z: 0 }),
      dt: 0.01,
      driveParam: 'unused',
      driveScale: 0,
      origin: { x: 0, y: 0, z: 0 },
      scale: 1,
      seed: { x: 0, y: 0, z: 0 },
      trailCount: 1,
      maxPoints: 32,
      warmupSteps: 0,
      bound: 100,
    },
    new MessageBus(),
  );
  const scene = new THREE.Scene();
  viz.attach(scene);
  const line = scene.children[0] as THREE.Line;
  const head = () =>
    line.geometry
      .getAttribute('instanceEnd')
      .getX((line.geometry as THREE.InstancedBufferGeometry).instanceCount - 1);
  return { viz, head };
}

describe('ODE trail integration', () => {
  it('advances at a linear rate, retains fractional substeps, and shows the newest history', () => {
    const slow = constantFlow(0.5),
      fast = constantFlow(1);
    const a = slow.head(),
      b = fast.head();
    for (let i = 0; i < 100; i++) {
      slow.viz.tick();
      fast.viz.tick();
    }
    expect(slow.head() - a).toBeCloseTo(0.9, 5);
    expect(fast.head() - b).toBeCloseTo(1.8, 5);
    // For x'=1, the full initial history advances exactly 32*0.01 from its seed.
    const full = constantFlow(1);
    full.viz.setUserParam('trailLength', 32);
    full.viz.tick();
    const short = constantFlow(1);
    short.viz.tick();
    expect(short.head()).toBeCloseTo(full.head(), 6);
    for (const f of [slow, fast, full, short]) f.viz.dispose();
  });
});
