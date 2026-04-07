import { describe, it, expect } from 'vitest';
import { VoronoiVisualizer } from '../visualizers/voronoi/v01-alpha.js';
import { MessageBus } from '@cybernoetica/core';
import type { AudioFeatures } from '@cybernoetica/core';

describe('VoronoiVisualizer', () => {
  it('can be constructed', () => {
    const bus = new MessageBus();
    const viz = new VoronoiVisualizer(bus);
    expect(viz).toBeDefined();
  });

  it('responds to audio features', () => {
    const bus = new MessageBus();
    const viz = new VoronoiVisualizer(bus);
    const features: AudioFeatures = {
      fftBins: new Float32Array(1024).fill(0.5),
      bass: 0.8, mid: 0.5, high: 0.3,
      spectralCentroid: 0.6, spectralFlux: 0.2, rms: 0.7,
      beatOnset: true, beatConfidence: 0.9, degraded: false,
    };
    bus.publish('audio:features', features);
    viz.tick();
    expect(viz.metadata.type).toBe('voronoi');
  });

  it('has correct metadata', () => {
    const bus = new MessageBus();
    const viz = new VoronoiVisualizer(bus);
    expect(viz.metadata.label).toBe('Voronoi');
    expect(viz.metadata.usesPerspective).toBe(false);
    expect(viz.metadata.viewport.pan).toBe(true);
    expect(viz.metadata.viewport.zoom).toBe(true);
    expect(viz.metadata.viewport.orbit).toBe(false);
  });

  it('getViewState returns center and zoom', () => {
    const bus = new MessageBus();
    const viz = new VoronoiVisualizer(bus);
    const vs = viz.getViewState();
    expect(vs.centerX).toBe(0);
    expect(vs.centerY).toBe(0);
    expect(vs.zoom).toBe(1.0);
  });

  it('setViewState updates and clamps values', () => {
    const bus = new MessageBus();
    const viz = new VoronoiVisualizer(bus);
    viz.setViewState({ centerX: 3.0, centerY: -2.0, zoom: 2.0 });
    expect(viz.getViewState().centerX).toBe(3.0);
    expect(viz.getViewState().centerY).toBe(-2.0);
    expect(viz.getViewState().zoom).toBe(2.0);

    viz.setViewState({ zoom: 10.0 });
    expect(viz.getViewState().zoom).toBe(4.0);

    viz.setViewState({ zoom: 0.1 });
    expect(viz.getViewState().zoom).toBe(0.5);
  });

  it('setUserParam updates params', () => {
    const bus = new MessageBus();
    const viz = new VoronoiVisualizer(bus);
    viz.setUserParam('cellScale', 8);
    viz.tick();
    expect(viz.metadata.params.find(p => p.key === 'cellScale')).toBeDefined();
  });

  it('has audio-mapping params', () => {
    const bus = new MessageBus();
    const viz = new VoronoiVisualizer(bus);
    const audioParams = viz.metadata.params.filter(p => p.category === 'audio-mapping');
    expect(audioParams.length).toBeGreaterThanOrEqual(3);
  });

  it('metadata includes viewStateFields', () => {
    const bus = new MessageBus();
    const viz = new VoronoiVisualizer(bus);
    expect(viz.metadata.viewStateFields.length).toBe(3);
    const keys = viz.metadata.viewStateFields.map(f => f.key);
    expect(keys).toContain('centerX');
    expect(keys).toContain('centerY');
    expect(keys).toContain('zoom');
  });
});
