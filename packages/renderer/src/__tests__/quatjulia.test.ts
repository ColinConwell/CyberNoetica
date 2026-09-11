import { describe, it, expect } from 'vitest';
import { QuatJuliaVisualizer } from '../visualizers/quatjulia/v01-alpha.js';
import { MessageBus } from '@cybernoetica/core';
import type { AudioFeatures } from '@cybernoetica/core';

describe('QuatJuliaVisualizer', () => {
  it('can be constructed', () => {
    const bus = new MessageBus();
    const viz = new QuatJuliaVisualizer(bus);
    expect(viz).toBeDefined();
  });

  it('responds to audio features', () => {
    const bus = new MessageBus();
    const viz = new QuatJuliaVisualizer(bus);
    const features: AudioFeatures = {
      fftBins: new Float32Array(1024).fill(0.3),
      bass: 0.5, mid: 0.6, high: 0.4,
      spectralCentroid: 0.5, spectralFlux: 0.2, rms: 0.6,
      beatOnset: true, beatConfidence: 0.8, degraded: false,
    };
    bus.publish('audio:features', features);
    viz.tick();
    expect(viz.metadata.type).toBe('quatjulia');
  });

  it('has correct metadata', () => {
    const bus = new MessageBus();
    const viz = new QuatJuliaVisualizer(bus);
    expect(viz.metadata.label).toBe('Quaternion Julia');
    expect(viz.metadata.usesPerspective).toBe(false);
    expect(viz.metadata.viewport.zoom).toBe(true);
  });

  it('has audio-mapping params', () => {
    const bus = new MessageBus();
    const viz = new QuatJuliaVisualizer(bus);
    const audioParams = viz.metadata.params.filter(p => p.category === 'audio-mapping');
    expect(audioParams.length).toBeGreaterThanOrEqual(4);
  });

  it('getViewState returns zoom', () => {
    const bus = new MessageBus();
    const viz = new QuatJuliaVisualizer(bus);
    const vs = viz.getViewState();
    expect(vs.zoom).toBe(1.0);
  });

  it('setViewState clamps zoom', () => {
    const bus = new MessageBus();
    const viz = new QuatJuliaVisualizer(bus);
    viz.setViewState({ zoom: 100 });
    const vs = viz.getViewState();
    expect(vs.zoom).toBe(5.0);
  });

  it('setUserParam updates seed values', () => {
    const bus = new MessageBus();
    const viz = new QuatJuliaVisualizer(bus);
    viz.setUserParam('seedX', -0.8);
    viz.setUserParam('maxIter', 12);
    viz.tick();
    expect(viz.metadata.type).toBe('quatjulia');
  });

  it('disposes cleanly', () => {
    const bus = new MessageBus();
    const viz = new QuatJuliaVisualizer(bus);
    expect(() => viz.dispose()).not.toThrow();
  });
});
