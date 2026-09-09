import { describe, it, expect } from 'vitest';
import { DomainWarpRecursiveVisualizer } from '../visualizers/domainwarp/v02-beta.js';
import { MessageBus } from '@cybernoetica/core';
import type { AudioFeatures } from '@cybernoetica/core';

describe('DomainWarpRecursiveVisualizer', () => {
  it('can be constructed', () => {
    const bus = new MessageBus();
    const viz = new DomainWarpRecursiveVisualizer(bus);
    expect(viz).toBeDefined();
  });

  it('responds to audio features', () => {
    const bus = new MessageBus();
    const viz = new DomainWarpRecursiveVisualizer(bus);
    const features: AudioFeatures = {
      fftBins: new Float32Array(1024).fill(0.3),
      bass: 0.5,
      mid: 0.6,
      high: 0.4,
      spectralCentroid: 0.5,
      spectralFlux: 0.2,
      rms: 0.6,
      beatOnset: true,
      beatConfidence: 0.8,
      degraded: false,
    };
    bus.publish('audio:features', features);
    viz.tick();
    expect(viz.metadata.type).toBe('domainwarp-recursive');
  });

  it('has correct metadata', () => {
    const bus = new MessageBus();
    const viz = new DomainWarpRecursiveVisualizer(bus);
    expect(viz.metadata.label).toBe('Domain Warp (Recursive)');
    expect(viz.metadata.usesPerspective).toBe(false);
    expect(viz.metadata.viewport.pan).toBe(true);
    expect(viz.metadata.viewport.zoom).toBe(true);
  });

  it('has audio-mapping params', () => {
    const bus = new MessageBus();
    const viz = new DomainWarpRecursiveVisualizer(bus);
    const audioParams = viz.metadata.params.filter(
      (p) => p.category === 'audio-mapping',
    );
    expect(audioParams.length).toBeGreaterThanOrEqual(4);
  });

  it('getViewState returns pan and zoom', () => {
    const bus = new MessageBus();
    const viz = new DomainWarpRecursiveVisualizer(bus);
    const vs = viz.getViewState();
    expect(vs.zoom).toBe(1.0);
    expect(vs.panX).toBe(0);
    expect(vs.panY).toBe(0);
  });

  it('setViewState clamps values', () => {
    const bus = new MessageBus();
    const viz = new DomainWarpRecursiveVisualizer(bus);
    viz.setViewState({ zoom: 100, panX: 10, panY: -10 });
    const vs = viz.getViewState();
    expect(vs.zoom).toBe(5.0);
    expect(vs.panX).toBe(5.0);
    expect(vs.panY).toBe(-5.0);
  });

  it('setUserParam updates warp depth', () => {
    const bus = new MessageBus();
    const viz = new DomainWarpRecursiveVisualizer(bus);
    viz.setUserParam('warpDepth', 2);
    viz.tick();
    expect(viz.metadata.type).toBe('domainwarp-recursive');
  });

  it('disposes cleanly', () => {
    const bus = new MessageBus();
    const viz = new DomainWarpRecursiveVisualizer(bus);
    expect(() => viz.dispose()).not.toThrow();
  });
});
