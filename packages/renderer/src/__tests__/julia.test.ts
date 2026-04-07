import { describe, it, expect } from 'vitest';
import { JuliaVisualizer } from '../visualizers/julia/v01-alpha.js';
import { MessageBus } from '@cybernoetica/core';
import type { AudioFeatures } from '@cybernoetica/core';

describe('JuliaVisualizer', () => {
  it('can be constructed', () => {
    const bus = new MessageBus();
    const viz = new JuliaVisualizer(bus);
    expect(viz).toBeDefined();
  });

  it('responds to audio features and morphs c-parameter', () => {
    const bus = new MessageBus();
    const viz = new JuliaVisualizer(bus);
    const initial = viz.getViewState();

    bus.publish('audio:features', {
      fftBins: new Float32Array(1024), bass: 0.9, mid: 0.5, high: 0.3,
      spectralCentroid: 0.6, spectralFlux: 0.2, rms: 0.7,
      beatOnset: true, beatConfidence: 0.9, degraded: false,
    } as AudioFeatures);
    viz.tick();

    const after = viz.getViewState();
    expect(after.seedReal).toBeDefined();
    expect(after.seedImaginary).toBeDefined();
  });

  it('has idle animation with no audio', () => {
    const bus = new MessageBus();
    const viz = new JuliaVisualizer(bus);
    viz.tick();
    viz.tick();
    const vs = viz.getViewState();
    expect(vs.zoom).toBeGreaterThan(0);
  });

  it('getViewState returns valid initial values', () => {
    const bus = new MessageBus();
    const viz = new JuliaVisualizer(bus);
    const vs = viz.getViewState();
    expect(vs.seedReal).toBeDefined();
    expect(vs.seedImaginary).toBeDefined();
    expect(vs.zoom).toBeGreaterThan(0);
  });

  it('setViewState updates seed and zoom', () => {
    const bus = new MessageBus();
    const viz = new JuliaVisualizer(bus);
    viz.setViewState({ seedReal: -0.8, seedImaginary: 0.156, zoom: 2.5 });
    const vs = viz.getViewState();
    expect(vs.seedReal).toBeCloseTo(-0.8, 1);
    expect(vs.seedImaginary).toBeCloseTo(0.156, 2);
    expect(vs.zoom).toBeCloseTo(2.5, 1);
  });

  it('setViewState partial update preserves other fields', () => {
    const bus = new MessageBus();
    const viz = new JuliaVisualizer(bus);
    const before = viz.getViewState();
    viz.setViewState({ zoom: 3.0 });
    const after = viz.getViewState();
    expect(after.zoom).toBeCloseTo(3.0, 1);
    expect(after.seedReal).toBeCloseTo(before.seedReal, 2);
  });

  it('metadata includes viewStateFields', () => {
    const bus = new MessageBus();
    const viz = new JuliaVisualizer(bus);
    expect(viz.metadata.viewStateFields.length).toBe(3);
    expect(viz.metadata.viewStateFields.map(f => f.key))
      .toEqual(['seedReal', 'seedImaginary', 'zoom']);
  });
});
