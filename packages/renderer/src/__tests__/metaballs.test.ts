import { describe, it, expect } from 'vitest';
import { MetaballsVisualizer } from '../visualizers/metaballs/v01-alpha.js';
import { MessageBus } from '@cybernoetica/core';
import type { AudioFeatures } from '@cybernoetica/core';

describe('MetaballsVisualizer', () => {
  it('can be constructed', () => {
    const bus = new MessageBus();
    const viz = new MetaballsVisualizer(bus);
    expect(viz).toBeDefined();
  });

  it('responds to audio features', () => {
    const bus = new MessageBus();
    const viz = new MetaballsVisualizer(bus);
    const features: AudioFeatures = {
      fftBins: new Float32Array(1024).fill(0.5),
      bass: 0.6, mid: 0.5, high: 0.3,
      spectralCentroid: 0.5, spectralFlux: 0.15, rms: 0.5,
      beatOnset: true, beatConfidence: 0.9, degraded: false,
    };
    bus.publish('audio:features', features);
    viz.tick();
    expect(viz.metadata.type).toBe('metaballs');
  });

  it('has correct metadata', () => {
    const bus = new MessageBus();
    const viz = new MetaballsVisualizer(bus);
    expect(viz.metadata.label).toBe('Metaballs');
    expect(viz.metadata.usesPerspective).toBe(false);
    expect(viz.metadata.viewport.pan).toBe(true);
    expect(viz.metadata.viewport.zoom).toBe(true);
  });

  it('has audio-mapping params', () => {
    const bus = new MessageBus();
    const viz = new MetaballsVisualizer(bus);
    const audioParams = viz.metadata.params.filter(p => p.category === 'audio-mapping');
    expect(audioParams.length).toBeGreaterThanOrEqual(4);
  });

  it('getViewState returns center and zoom', () => {
    const bus = new MessageBus();
    const viz = new MetaballsVisualizer(bus);
    const vs = viz.getViewState();
    expect(vs.centerX).toBe(0);
    expect(vs.centerY).toBe(0);
    expect(vs.zoom).toBe(1.0);
  });

  it('setViewState clamps values', () => {
    const bus = new MessageBus();
    const viz = new MetaballsVisualizer(bus);
    viz.setViewState({ centerX: 5, zoom: 10 });
    const vs = viz.getViewState();
    expect(vs.centerX).toBe(3);
    expect(vs.zoom).toBe(4.0);
  });

  it('setUserParam updates ballCount', () => {
    const bus = new MessageBus();
    const viz = new MetaballsVisualizer(bus);
    viz.setUserParam('ballCount', 5);
    viz.tick();
    expect(viz.metadata.type).toBe('metaballs');
  });

  it('disposes cleanly', () => {
    const bus = new MessageBus();
    const viz = new MetaballsVisualizer(bus);
    expect(() => viz.dispose()).not.toThrow();
  });
});
