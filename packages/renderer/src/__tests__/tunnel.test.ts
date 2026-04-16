import { describe, it, expect } from 'vitest';
import { TunnelVisualizer } from '../visualizers/tunnel/v01-alpha.js';
import { MessageBus } from '@cybernoetica/core';
import type { AudioFeatures } from '@cybernoetica/core';

describe('TunnelVisualizer', () => {
  it('can be constructed', () => {
    const bus = new MessageBus();
    const viz = new TunnelVisualizer(bus);
    expect(viz).toBeDefined();
  });

  it('responds to audio features', () => {
    const bus = new MessageBus();
    const viz = new TunnelVisualizer(bus);
    const features: AudioFeatures = {
      fftBins: new Float32Array(1024).fill(0.5),
      bass: 0.8, mid: 0.5, high: 0.3,
      spectralCentroid: 0.6, spectralFlux: 0.2, rms: 0.7,
      beatOnset: true, beatConfidence: 0.9, degraded: false,
    };
    bus.publish('audio:features', features);
    viz.tick();
    expect(viz.metadata.type).toBe('tunnel');
  });

  it('has correct metadata', () => {
    const bus = new MessageBus();
    const viz = new TunnelVisualizer(bus);
    expect(viz.metadata.label).toBe('Tunnel');
    expect(viz.metadata.usesPerspective).toBe(false);
    expect(viz.metadata.viewport.pan).toBe(true);
    expect(viz.metadata.viewport.zoom).toBe(true);
    expect(viz.metadata.viewport.orbit).toBe(false);
  });

  it('getViewState returns center and zoom', () => {
    const bus = new MessageBus();
    const viz = new TunnelVisualizer(bus);
    const vs = viz.getViewState();
    expect(vs.centerX).toBe(0);
    expect(vs.centerY).toBe(0);
    expect(vs.zoom).toBe(1.0);
  });

  it('setViewState updates and clamps values', () => {
    const bus = new MessageBus();
    const viz = new TunnelVisualizer(bus);
    viz.setViewState({ centerX: 1.5, centerY: -1.0, zoom: 2.5 });
    const vs = viz.getViewState();
    expect(vs.centerX).toBe(1.5);
    expect(vs.centerY).toBe(-1.0);
    expect(vs.zoom).toBe(2.5);

    viz.setViewState({ zoom: 10.0 });
    expect(viz.getViewState().zoom).toBe(4.0);

    viz.setViewState({ centerX: 5.0 });
    expect(viz.getViewState().centerX).toBe(3.0);
  });

  it('has audio-mapping params', () => {
    const bus = new MessageBus();
    const viz = new TunnelVisualizer(bus);
    const audioParams = viz.metadata.params.filter(p => p.category === 'audio-mapping');
    expect(audioParams.length).toBeGreaterThanOrEqual(4);
  });

  it('metadata includes viewStateFields', () => {
    const bus = new MessageBus();
    const viz = new TunnelVisualizer(bus);
    expect(viz.metadata.viewStateFields.length).toBe(3);
    const keys = viz.metadata.viewStateFields.map(f => f.key);
    expect(keys).toContain('centerX');
    expect(keys).toContain('centerY');
    expect(keys).toContain('zoom');
  });

  it('disposes cleanly', () => {
    const bus = new MessageBus();
    const viz = new TunnelVisualizer(bus);
    expect(() => viz.dispose()).not.toThrow();
  });
});
