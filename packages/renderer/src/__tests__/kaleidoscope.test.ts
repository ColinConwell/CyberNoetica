import { describe, it, expect } from 'vitest';
import { KaleidoscopeVisualizer } from '../visualizers/kaleidoscope/v01-alpha.js';
import { MessageBus } from '@cybernoetica/core';
import type { AudioFeatures } from '@cybernoetica/core';

describe('KaleidoscopeVisualizer', () => {
  it('can be constructed', () => {
    const bus = new MessageBus();
    const viz = new KaleidoscopeVisualizer(bus);
    expect(viz).toBeDefined();
  });

  it('responds to audio features', () => {
    const bus = new MessageBus();
    const viz = new KaleidoscopeVisualizer(bus);
    const features: AudioFeatures = {
      fftBins: new Float32Array(1024).fill(0.5),
      bass: 0.8, mid: 0.5, high: 0.3,
      spectralCentroid: 0.6, spectralFlux: 0.2, rms: 0.7,
      beatOnset: true, beatConfidence: 0.9, degraded: false,
    };
    bus.publish('audio:features', features);
    viz.tick();
    expect(viz.metadata.type).toBe('kaleidoscope');
  });

  it('has correct metadata', () => {
    const bus = new MessageBus();
    const viz = new KaleidoscopeVisualizer(bus);
    expect(viz.metadata.label).toBe('Kaleidoscope');
    expect(viz.metadata.usesPerspective).toBe(false);
    expect(viz.metadata.viewport.pan).toBe(false);
    expect(viz.metadata.viewport.zoom).toBe(true);
    expect(viz.metadata.viewport.orbit).toBe(false);
  });

  it('getViewState returns zoom and rotation', () => {
    const bus = new MessageBus();
    const viz = new KaleidoscopeVisualizer(bus);
    const vs = viz.getViewState();
    expect(vs.zoom).toBe(1.0);
    expect(typeof vs.rotation).toBe('number');
  });

  it('setViewState updates and clamps zoom', () => {
    const bus = new MessageBus();
    const viz = new KaleidoscopeVisualizer(bus);
    viz.setViewState({ zoom: 2.5 });
    expect(viz.getViewState().zoom).toBe(2.5);

    viz.setViewState({ zoom: 10.0 });
    expect(viz.getViewState().zoom).toBe(4.0);

    viz.setViewState({ zoom: 0.1 });
    expect(viz.getViewState().zoom).toBe(0.3);
  });

  it('setViewState overrides rotation', () => {
    const bus = new MessageBus();
    const viz = new KaleidoscopeVisualizer(bus);
    viz.setViewState({ rotation: 1.5 });
    viz.tick();
    expect(viz.getViewState().rotation).toBe(1.5);
  });

  it('setUserParam updates fold count', () => {
    const bus = new MessageBus();
    const viz = new KaleidoscopeVisualizer(bus);
    viz.setUserParam('foldCount', 8);
    viz.tick();
    expect(viz.metadata.params.find(p => p.key === 'foldCount')).toBeDefined();
  });

  it('has audio-mapping params', () => {
    const bus = new MessageBus();
    const viz = new KaleidoscopeVisualizer(bus);
    const audioParams = viz.metadata.params.filter(p => p.category === 'audio-mapping');
    expect(audioParams.length).toBeGreaterThanOrEqual(3);
  });

  it('metadata includes viewStateFields', () => {
    const bus = new MessageBus();
    const viz = new KaleidoscopeVisualizer(bus);
    expect(viz.metadata.viewStateFields.length).toBe(2);
    const keys = viz.metadata.viewStateFields.map(f => f.key);
    expect(keys).toContain('zoom');
    expect(keys).toContain('rotation');
  });
});
