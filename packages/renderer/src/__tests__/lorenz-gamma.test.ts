import { describe, it, expect } from 'vitest';
import { LorenzGammaVisualizer } from '../visualizers/lorenz/v03-gamma.js';
import { MessageBus } from '@cybernoetica/core';
import type { AudioFeatures } from '@cybernoetica/core';

describe('LorenzGammaVisualizer', () => {
  it('can be constructed', () => {
    const bus = new MessageBus();
    const viz = new LorenzGammaVisualizer(bus);
    expect(viz).toBeDefined();
  });

  it('has correct metadata type and label', () => {
    const bus = new MessageBus();
    const viz = new LorenzGammaVisualizer(bus);
    expect(viz.metadata.type).toBe('lorenz-gamma');
    expect(viz.metadata.label).toBe('Chen');
    expect(viz.metadata.usesPerspective).toBe(true);
    expect(viz.metadata.viewport.orbit).toBe(true);
    expect(viz.metadata.viewport.zoom).toBe(true);
    expect(viz.metadata.viewport.pan).toBe(false);
  });

  it('responds to audio features without error', () => {
    const bus = new MessageBus();
    const viz = new LorenzGammaVisualizer(bus);
    const features: AudioFeatures = {
      fftBins: new Float32Array(1024), bass: 0.8, mid: 0.5, high: 0.3,
      spectralCentroid: 0.6, spectralFlux: 0.2, rms: 0.7,
      beatOnset: true, beatConfidence: 0.9, degraded: false,
    };
    bus.publish('audio:features', features);
    viz.tick();
    expect(viz.metadata.type).toBe('lorenz-gamma');
  });

  it('ticks without audio (idle mode)', () => {
    const bus = new MessageBus();
    const viz = new LorenzGammaVisualizer(bus);
    for (let i = 0; i < 30; i++) viz.tick();
    expect(viz.getViewState().distance).toBe(14);
  });

  it('getViewState returns valid initial camera coordinates', () => {
    const bus = new MessageBus();
    const viz = new LorenzGammaVisualizer(bus);
    const vs = viz.getViewState();
    expect(vs.orbitAngle).toBe(0.35);
    expect(vs.elevation).toBe(0.3);
    expect(vs.distance).toBe(14);
  });

  it('setViewState updates camera coordinates', () => {
    const bus = new MessageBus();
    const viz = new LorenzGammaVisualizer(bus);
    viz.setViewState({ orbitAngle: 2.0, elevation: 0.8, distance: 16 });
    const vs = viz.getViewState();
    expect(vs.orbitAngle).toBe(2.0);
    expect(vs.elevation).toBe(0.8);
    expect(vs.distance).toBe(16);
  });

  it('setViewState clamps elevation and distance', () => {
    const bus = new MessageBus();
    const viz = new LorenzGammaVisualizer(bus);
    viz.setViewState({ elevation: 5.0, distance: 100 });
    const vs = viz.getViewState();
    expect(vs.elevation).toBe(1.2);
    expect(vs.distance).toBe(24);

    viz.setViewState({ elevation: -5.0, distance: 0.1 });
    expect(viz.getViewState().elevation).toBe(-1.2);
    expect(viz.getViewState().distance).toBe(4);
  });

  it('setUserParam updates params', () => {
    const bus = new MessageBus();
    const viz = new LorenzGammaVisualizer(bus);
    viz.setUserParam('paramC', 30);
    viz.tick();
    expect(viz.metadata.params.find(p => p.key === 'paramC')).toBeDefined();
  });

  it('has audio-mapping params', () => {
    const bus = new MessageBus();
    const viz = new LorenzGammaVisualizer(bus);
    const audioParams = viz.metadata.params.filter(p => p.category === 'audio-mapping');
    expect(audioParams.length).toBeGreaterThanOrEqual(5);
  });

  it('metadata includes viewStateFields', () => {
    const bus = new MessageBus();
    const viz = new LorenzGammaVisualizer(bus);
    expect(viz.metadata.viewStateFields.length).toBe(3);
    const keys = viz.metadata.viewStateFields.map(f => f.key);
    expect(keys).toEqual(['orbitAngle', 'elevation', 'distance']);
  });

  it('disposes cleanly', () => {
    const bus = new MessageBus();
    const viz = new LorenzGammaVisualizer(bus);
    expect(() => viz.dispose()).not.toThrow();
  });
});
