import { describe, it, expect } from 'vitest';
import { SpirographVisualizer } from '../visualizers/spirograph/v01-alpha.js';
import { MessageBus } from '@cybernoetica/core';
import type { AudioFeatures } from '@cybernoetica/core';

describe('SpirographVisualizer', () => {
  it('can be constructed', () => {
    const bus = new MessageBus();
    const viz = new SpirographVisualizer(bus);
    expect(viz).toBeDefined();
  });

  it('responds to audio features', () => {
    const bus = new MessageBus();
    const viz = new SpirographVisualizer(bus);
    const features: AudioFeatures = {
      fftBins: new Float32Array(1024).fill(0.5),
      bass: 0.8, mid: 0.5, high: 0.3,
      spectralCentroid: 0.6, spectralFlux: 0.2, rms: 0.7,
      beatOnset: true, beatConfidence: 0.9, degraded: false,
    };
    bus.publish('audio:features', features);
    viz.tick();
    expect(viz.metadata.type).toBe('spirograph');
  });

  it('has correct metadata', () => {
    const bus = new MessageBus();
    const viz = new SpirographVisualizer(bus);
    expect(viz.metadata.label).toBe('Spirograph');
    expect(viz.metadata.usesPerspective).toBe(false);
    expect(viz.metadata.viewport.pan).toBe(false);
    expect(viz.metadata.viewport.zoom).toBe(true);
    expect(viz.metadata.viewport.orbit).toBe(false);
  });

  it('getViewState returns zoom', () => {
    const bus = new MessageBus();
    const viz = new SpirographVisualizer(bus);
    const vs = viz.getViewState();
    expect(vs.zoom).toBe(1.0);
  });

  it('setViewState updates and clamps zoom', () => {
    const bus = new MessageBus();
    const viz = new SpirographVisualizer(bus);
    viz.setViewState({ zoom: 2.5 });
    expect(viz.getViewState().zoom).toBe(2.5);

    viz.setViewState({ zoom: 10.0 });
    expect(viz.getViewState().zoom).toBe(4.0);

    viz.setViewState({ zoom: 0.1 });
    expect(viz.getViewState().zoom).toBe(0.3);
  });

  it('has audio-mapping params', () => {
    const bus = new MessageBus();
    const viz = new SpirographVisualizer(bus);
    const audioParams = viz.metadata.params.filter(p => p.category === 'audio-mapping');
    expect(audioParams.length).toBeGreaterThanOrEqual(3);
  });

  it('metadata includes viewStateFields', () => {
    const bus = new MessageBus();
    const viz = new SpirographVisualizer(bus);
    expect(viz.metadata.viewStateFields.length).toBe(1);
    const keys = viz.metadata.viewStateFields.map(f => f.key);
    expect(keys).toContain('zoom');
  });

  it('disposes cleanly', () => {
    const bus = new MessageBus();
    const viz = new SpirographVisualizer(bus);
    expect(() => viz.dispose()).not.toThrow();
  });
});
