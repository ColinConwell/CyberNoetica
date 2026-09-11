import { describe, it, expect } from 'vitest';
import { TerrainVisualizer } from '../visualizers/terrain/v01-alpha.js';
import { MessageBus } from '@cybernoetica/core';
import type { AudioFeatures } from '@cybernoetica/core';

describe('TerrainVisualizer', () => {
  it('can be constructed', () => {
    const bus = new MessageBus();
    const viz = new TerrainVisualizer(bus);
    expect(viz).toBeDefined();
  });

  it('responds to audio features', () => {
    const bus = new MessageBus();
    const viz = new TerrainVisualizer(bus);
    const features: AudioFeatures = {
      fftBins: new Float32Array(1024).fill(0.5),
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
    expect(viz.metadata.type).toBe('terrain');
  });

  it('has correct metadata', () => {
    const bus = new MessageBus();
    const viz = new TerrainVisualizer(bus);
    expect(viz.metadata.label).toBe('Terrain');
    expect(viz.metadata.usesPerspective).toBe(true);
    expect(viz.metadata.viewport.pan).toBe(false);
    expect(viz.metadata.viewport.zoom).toBe(true);
    expect(viz.metadata.viewport.orbit).toBe(true);
  });

  it('getViewState returns spherical camera coordinates', () => {
    const bus = new MessageBus();
    const viz = new TerrainVisualizer(bus);
    const vs = viz.getViewState();
    expect(vs.orbitAngle).toBe(0);
    expect(vs.elevation).toBe(0.5);
    expect(vs.distance).toBe(13);
  });

  it('setViewState updates and clamps values', () => {
    const bus = new MessageBus();
    const viz = new TerrainVisualizer(bus);
    viz.setViewState({ orbitAngle: 1.5, elevation: -1.0, distance: 12.5 });
    const vs = viz.getViewState();
    expect(vs.orbitAngle).toBe(1.5);
    expect(vs.elevation).toBe(-1.0);
    expect(vs.distance).toBe(12.5);

    viz.setViewState({ distance: 100.0 });
    expect(viz.getViewState().distance).toBe(30);

    viz.setViewState({ elevation: 5.0 });
    expect(viz.getViewState().elevation).toBe(1.5);
  });

  it('has audio-mapping params', () => {
    const bus = new MessageBus();
    const viz = new TerrainVisualizer(bus);
    const audioParams = viz.metadata.params.filter(
      (p) => p.category === 'audio-mapping',
    );
    expect(audioParams.length).toBeGreaterThanOrEqual(4);
  });

  it('metadata includes viewStateFields', () => {
    const bus = new MessageBus();
    const viz = new TerrainVisualizer(bus);
    expect(viz.metadata.viewStateFields.length).toBe(3);
    const keys = viz.metadata.viewStateFields.map((f) => f.key);
    expect(keys).toContain('orbitAngle');
    expect(keys).toContain('elevation');
    expect(keys).toContain('distance');
  });

  it('disposes cleanly', () => {
    const bus = new MessageBus();
    const viz = new TerrainVisualizer(bus);
    expect(() => viz.dispose()).not.toThrow();
  });
});
