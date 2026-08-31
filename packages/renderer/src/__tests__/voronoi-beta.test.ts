import { describe, it, expect } from 'vitest';
import { VoronoiBetaVisualizer } from '../visualizers/voronoi/v02-beta.js';
import { MessageBus } from '@cybernoetica/core';
import type { AudioFeatures } from '@cybernoetica/core';

describe('VoronoiBetaVisualizer', () => {
  it('can be constructed', () => {
    const bus = new MessageBus();
    const viz = new VoronoiBetaVisualizer(bus);
    expect(viz).toBeDefined();
  });

  it('has correct metadata type and label', () => {
    const bus = new MessageBus();
    const viz = new VoronoiBetaVisualizer(bus);
    expect(viz.metadata.type).toBe('voronoi-beta');
    expect(viz.metadata.label).toBe('Voronoi (β)');
    expect(viz.metadata.usesPerspective).toBe(true);
    expect(viz.metadata.viewport.orbit).toBe(true);
    expect(viz.metadata.viewport.zoom).toBe(true);
    expect(viz.metadata.viewport.pan).toBe(false);
  });

  it('responds to audio features without error', () => {
    const bus = new MessageBus();
    const viz = new VoronoiBetaVisualizer(bus);
    const features: AudioFeatures = {
      fftBins: new Float32Array(1024), bass: 0.8, mid: 0.5, high: 0.3,
      spectralCentroid: 0.6, spectralFlux: 0.2, rms: 0.7,
      beatOnset: true, beatConfidence: 0.9, degraded: false,
    };
    bus.publish('audio:features', features);
    viz.tick();
    expect(viz.metadata.type).toBe('voronoi-beta');
  });

  it('ticks without audio (idle mode)', () => {
    const bus = new MessageBus();
    const viz = new VoronoiBetaVisualizer(bus);
    for (let i = 0; i < 30; i++) viz.tick();
    expect(viz.getViewState().distance).toBe(8);
  });

  it('getViewState returns valid initial camera coordinates', () => {
    const bus = new MessageBus();
    const viz = new VoronoiBetaVisualizer(bus);
    const vs = viz.getViewState();
    expect(vs.orbitAngle).toBe(0.4);
    expect(vs.elevation).toBe(0.35);
    expect(vs.distance).toBe(8);
  });

  it('setViewState updates camera coordinates', () => {
    const bus = new MessageBus();
    const viz = new VoronoiBetaVisualizer(bus);
    viz.setViewState({ orbitAngle: 2.0, elevation: 0.8, distance: 12 });
    const vs = viz.getViewState();
    expect(vs.orbitAngle).toBe(2.0);
    expect(vs.elevation).toBe(0.8);
    expect(vs.distance).toBe(12);
  });

  it('setViewState clamps elevation and distance', () => {
    const bus = new MessageBus();
    const viz = new VoronoiBetaVisualizer(bus);
    viz.setViewState({ elevation: 5.0, distance: 100 });
    const vs = viz.getViewState();
    expect(vs.elevation).toBe(1.2);
    expect(vs.distance).toBe(20);

    viz.setViewState({ elevation: -5.0, distance: 0.1 });
    expect(viz.getViewState().elevation).toBe(-1.2);
    expect(viz.getViewState().distance).toBe(4);
  });

  it('setUserParam updates params', () => {
    const bus = new MessageBus();
    const viz = new VoronoiBetaVisualizer(bus);
    viz.setUserParam('seedCount', 32);
    viz.tick();
    expect(viz.metadata.params.find(p => p.key === 'seedCount')).toBeDefined();
  });

  it('has audio-mapping params', () => {
    const bus = new MessageBus();
    const viz = new VoronoiBetaVisualizer(bus);
    const audioParams = viz.metadata.params.filter(p => p.category === 'audio-mapping');
    expect(audioParams.length).toBeGreaterThanOrEqual(3);
  });

  it('metadata includes viewStateFields', () => {
    const bus = new MessageBus();
    const viz = new VoronoiBetaVisualizer(bus);
    expect(viz.metadata.viewStateFields.length).toBe(3);
    const keys = viz.metadata.viewStateFields.map(f => f.key);
    expect(keys).toEqual(['orbitAngle', 'elevation', 'distance']);
  });
});
