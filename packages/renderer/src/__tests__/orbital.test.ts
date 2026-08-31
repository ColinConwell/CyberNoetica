import { describe, it, expect } from 'vitest';
import { OrbitalVisualizer } from '../visualizers/orbital/v01-alpha.js';
import { MessageBus } from '@cybernoetica/core';
import type { AudioFeatures } from '@cybernoetica/core';
import * as THREE from 'three';

describe('OrbitalVisualizer', () => {
  it('can be constructed', () => {
    const bus = new MessageBus();
    const viz = new OrbitalVisualizer(bus);
    expect(viz).toBeDefined();
  });

  it('responds to audio features', () => {
    const bus = new MessageBus();
    const viz = new OrbitalVisualizer(bus);
    const features: AudioFeatures = {
      fftBins: new Float32Array(1024), bass: 0.8, mid: 0.5, high: 0.3,
      spectralCentroid: 0.6, spectralFlux: 0.2, rms: 0.7,
      beatOnset: true, beatConfidence: 0.9, degraded: false,
    };
    bus.publish('audio:features', features);
    viz.tick();
    expect(viz.getParticleCount()).toBeGreaterThan(0);
  });

  it('provides default state with no audio', () => {
    const bus = new MessageBus();
    const viz = new OrbitalVisualizer(bus);
    viz.tick();
    expect(viz.getParticleCount()).toBeGreaterThan(0);
  });

  it('getViewState returns valid initial camera coordinates', () => {
    const bus = new MessageBus();
    const viz = new OrbitalVisualizer(bus);
    const vs = viz.getViewState();
    expect(vs.orbitAngle).toBeDefined();
    expect(vs.elevation).toBeDefined();
    expect(vs.distance).toBe(12);
  });

  it('setViewState updates camera coordinates', () => {
    const bus = new MessageBus();
    const viz = new OrbitalVisualizer(bus);
    viz.setViewState({ orbitAngle: 1.5, elevation: 0.5, distance: 20 });
    const vs = viz.getViewState();
    expect(vs.orbitAngle).toBe(1.5);
    expect(vs.elevation).toBe(0.5);
    expect(vs.distance).toBe(20);
  });

  it('setViewState clamps elevation and distance', () => {
    const bus = new MessageBus();
    const viz = new OrbitalVisualizer(bus);
    viz.setViewState({ elevation: 5.0, distance: 100 });
    const vs = viz.getViewState();
    expect(vs.elevation).toBe(1.5);
    expect(vs.distance).toBe(30);
  });

  it('getCameraPosition computes from view state', () => {
    const bus = new MessageBus();
    const viz = new OrbitalVisualizer(bus);
    viz.setViewState({ orbitAngle: 0, elevation: 0, distance: 12 });
    const cam = viz.getCameraPosition();
    expect(cam.x).toBeCloseTo(0, 1);
    expect(cam.z).toBeCloseTo(12, 1);
  });

  it('setViewState partial update preserves other fields', () => {
    const bus = new MessageBus();
    const viz = new OrbitalVisualizer(bus);
    viz.setViewState({ orbitAngle: 2.0 });
    const vs = viz.getViewState();
    expect(vs.orbitAngle).toBe(2.0);
    expect(vs.distance).toBe(12);
    expect(vs.elevation).toBe(0);
  });

  it('metadata includes viewStateFields', () => {
    const bus = new MessageBus();
    const viz = new OrbitalVisualizer(bus);
    expect(viz.metadata.viewStateFields.length).toBe(3);
    expect(viz.metadata.viewStateFields.map(f => f.key))
      .toEqual(['orbitAngle', 'elevation', 'distance']);
  });

  it('attaches with ShaderMaterial and disabled frustum culling', () => {
    const bus = new MessageBus();
    const viz = new OrbitalVisualizer(bus);
    const scene = new THREE.Scene();
    viz.attach(scene);
    expect(scene.children.length).toBe(1);
    const points = scene.children[0] as THREE.Points;
    expect(points.frustumCulled).toBe(false);
    expect((points.material as THREE.ShaderMaterial).type).toBe('ShaderMaterial');
    viz.dispose();
    expect(scene.children.length).toBe(0);
  });
});
