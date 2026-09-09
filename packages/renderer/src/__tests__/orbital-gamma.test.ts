import { describe, it, expect } from 'vitest';
import { OrbitalGammaVisualizer } from '../visualizers/orbital/v03-gamma.js';
import { MessageBus } from '@cybernoetica/core';
import type { AudioFeatures } from '@cybernoetica/core';
import * as THREE from 'three';

describe('OrbitalGammaVisualizer', () => {
  it('places fields in the camera plane and preserves the displayed falloff radius at different viewing angles', () => {
    for (const [angle, elevation] of [
      [0, 0],
      [1, 0.6],
      [-2, -0.8],
    ]) {
      const canvas = document.createElement('canvas');
      canvas.getBoundingClientRect = () =>
        ({ left: 0, top: 0, width: 800, height: 600 }) as DOMRect;
      const camera = new THREE.PerspectiveCamera(50, 4 / 3, 0.1, 100);
      camera.position.set(
        Math.sin(angle) * Math.cos(elevation) * 14,
        Math.sin(elevation) * 14,
        Math.cos(angle) * Math.cos(elevation) * 14,
      );
      camera.lookAt(0, 0, 0);
      const scene = new THREE.Scene(),
        viz = new OrbitalGammaVisualizer(new MessageBus());
      viz.setInteractionContext({ canvas, getPerspectiveCamera: () => camera });
      viz.attach(scene);
      viz.setUserParam('sculptMode', 1);
      viz.setUserParam('influenceRadius', 2);
      canvas.dispatchEvent(
        new MouseEvent('click', { clientX: 480, clientY: 270 }),
      );
      viz.tick();
      const marker = scene.children.find((object) =>
        object.children.some((child) => child.userData.falloff),
      )!;
      expect(marker).toBeDefined();
      const projection = marker.position.clone().project(camera);
      expect(projection.x).toBeCloseTo(0.2, 8);
      expect(projection.y).toBeCloseTo(0.1, 8);
      const normal = new THREE.Vector3();
      camera.getWorldDirection(normal);
      expect(marker.position.dot(normal)).toBeCloseTo(0, 8);
      const falloff = marker.children.find((child) => child.userData.falloff)!;
      expect(falloff.getWorldScale(new THREE.Vector3()).x).toBeCloseTo(2, 8);
      // A completed two-pointer gesture must not generate a synthetic click field.
      for (const id of [1, 2]) {
        const event = new MouseEvent('pointerdown', {
          clientX: 480,
          clientY: 270,
        });
        Object.defineProperty(event, 'pointerId', { value: id });
        canvas.dispatchEvent(event);
      }
      for (const id of [1, 2]) {
        const event = new MouseEvent('pointerup');
        Object.defineProperty(event, 'pointerId', { value: id });
        canvas.dispatchEvent(event);
      }
      const count = scene.children.length;
      canvas.dispatchEvent(
        new MouseEvent('click', { clientX: 480, clientY: 270 }),
      );
      expect(scene.children).toHaveLength(count);
      viz.dispose();
    }
  });
  it('can be constructed', () => {
    const bus = new MessageBus();
    const viz = new OrbitalGammaVisualizer(bus);
    expect(viz).toBeDefined();
  });

  it('has correct metadata type and label', () => {
    const bus = new MessageBus();
    const viz = new OrbitalGammaVisualizer(bus);
    expect(viz.metadata.type).toBe('orbital-gamma');
    expect(viz.metadata.label).toBe('Cosmic Sculpt');
    expect(viz.metadata.usesPerspective).toBe(true);
    expect(viz.metadata.viewport.orbit).toBe(true);
    expect(viz.metadata.viewport.zoom).toBe(true);
  });

  it('has sculptMode param defaulting to off', () => {
    const bus = new MessageBus();
    const viz = new OrbitalGammaVisualizer(bus);
    const sculptParam = viz.metadata.params.find((p) => p.key === 'sculptMode');
    expect(sculptParam).toBeDefined();
    expect(sculptParam!.initial).toBe(0);
    expect(sculptParam!.min).toBe(0);
    expect(sculptParam!.max).toBe(1);
  });

  it('has fieldLifetime and fieldStrength params', () => {
    const bus = new MessageBus();
    const viz = new OrbitalGammaVisualizer(bus);
    const lifetimeParam = viz.metadata.params.find(
      (p) => p.key === 'fieldLifetime',
    );
    const strengthParam = viz.metadata.params.find(
      (p) => p.key === 'fieldStrength',
    );
    expect(lifetimeParam).toBeDefined();
    expect(strengthParam).toBeDefined();
    expect(lifetimeParam!.initial).toBe(10);
    expect(strengthParam!.initial).toBe(2.0);
  });

  it('responds to audio features without error', () => {
    const bus = new MessageBus();
    const viz = new OrbitalGammaVisualizer(bus);
    const features: AudioFeatures = {
      fftBins: new Float32Array(1024),
      bass: 0.8,
      mid: 0.5,
      high: 0.3,
      spectralCentroid: 0.6,
      spectralFlux: 0.2,
      rms: 0.7,
      beatOnset: true,
      beatConfidence: 0.9,
      degraded: false,
    };
    bus.publish('audio:features', features);
    viz.tick();
    expect(viz.metadata.type).toBe('orbital-gamma');
  });

  it('ticks without audio (idle mode)', () => {
    const bus = new MessageBus();
    const viz = new OrbitalGammaVisualizer(bus);
    for (let i = 0; i < 30; i++) viz.tick();
    const vs = viz.getViewState();
    expect(vs.distance).toBe(14);
  });

  it('getViewState returns valid initial coordinates', () => {
    const bus = new MessageBus();
    const viz = new OrbitalGammaVisualizer(bus);
    const vs = viz.getViewState();
    expect(vs.orbitAngle).toBe(0);
    expect(vs.elevation).toBe(0);
    expect(vs.distance).toBe(14);
  });

  it('setViewState updates camera', () => {
    const bus = new MessageBus();
    const viz = new OrbitalGammaVisualizer(bus);
    viz.setViewState({ orbitAngle: 1.0, elevation: -0.5, distance: 20 });
    const vs = viz.getViewState();
    expect(vs.orbitAngle).toBe(1.0);
    expect(vs.elevation).toBe(-0.5);
    expect(vs.distance).toBe(20);
  });

  it('setUserParam toggles sculptMode', () => {
    const bus = new MessageBus();
    const viz = new OrbitalGammaVisualizer(bus);
    viz.setUserParam('sculptMode', 1);
    viz.tick();
    expect(viz.metadata.type).toBe('orbital-gamma');
  });

  it('metadata includes viewStateFields', () => {
    const bus = new MessageBus();
    const viz = new OrbitalGammaVisualizer(bus);
    expect(viz.metadata.viewStateFields.length).toBe(3);
    const keys = viz.metadata.viewStateFields.map((f) => f.key);
    expect(keys).toContain('orbitAngle');
    expect(keys).toContain('elevation');
    expect(keys).toContain('distance');
  });

  it('has audio-mapping params', () => {
    const bus = new MessageBus();
    const viz = new OrbitalGammaVisualizer(bus);
    const audioParams = viz.metadata.params.filter(
      (p) => p.category === 'audio-mapping',
    );
    expect(audioParams.length).toBeGreaterThanOrEqual(3);
  });
});
