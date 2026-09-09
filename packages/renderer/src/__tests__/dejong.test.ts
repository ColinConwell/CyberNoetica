import { describe, it, expect } from 'vitest';
import { DeJongVisualizer } from '../visualizers/attractor/v03-gamma.js';
import { MessageBus } from '@cybernoetica/core';
import type { AudioFeatures } from '@cybernoetica/core';

describe('DeJongVisualizer', () => {
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

  it('can be constructed', () => {
    const bus = new MessageBus();
    const viz = new DeJongVisualizer(bus);
    expect(viz).toBeDefined();
  });

  it('has correct metadata', () => {
    const bus = new MessageBus();
    const viz = new DeJongVisualizer(bus);
    expect(viz.metadata.type).toBe('dejong');
    expect(viz.metadata.label).toBe('De Jong');
    expect(viz.metadata.usesPerspective).toBe(false);
    expect(viz.metadata.viewport.pan).toBe(true);
    expect(viz.metadata.viewport.zoom).toBe(true);
  });

  it('has all four De Jong coefficients as params', () => {
    const bus = new MessageBus();
    const viz = new DeJongVisualizer(bus);
    const keys = viz.metadata.params.map((p) => p.key);
    expect(keys).toContain('paramA');
    expect(keys).toContain('paramB');
    expect(keys).toContain('paramC');
    expect(keys).toContain('paramD');
  });

  it('has audio-mapping params', () => {
    const bus = new MessageBus();
    const viz = new DeJongVisualizer(bus);
    const audioParams = viz.metadata.params.filter(
      (p) => p.category === 'audio-mapping',
    );
    expect(audioParams.length).toBeGreaterThanOrEqual(4);
  });

  it('responds to audio features without crashing', () => {
    const bus = new MessageBus();
    const viz = new DeJongVisualizer(bus);
    bus.publish('audio:features', features);
    expect(() => viz.tick()).not.toThrow();
  });

  it('tick is stable without audio features', () => {
    const bus = new MessageBus();
    const viz = new DeJongVisualizer(bus);
    // Run many ticks without any features published
    for (let i = 0; i < 30; i++) viz.tick();
    const vs = viz.getViewState();
    expect(Number.isFinite(vs.zoom)).toBe(true);
  });

  it('getViewState returns zoom and pan', () => {
    const bus = new MessageBus();
    const viz = new DeJongVisualizer(bus);
    const vs = viz.getViewState();
    expect(vs.zoom).toBe(1.0);
    expect(vs.panX).toBe(0);
    expect(vs.panY).toBe(0);
  });

  it('setViewState clamps values', () => {
    const bus = new MessageBus();
    const viz = new DeJongVisualizer(bus);
    viz.setViewState({ zoom: 100, panX: 10, panY: -10 });
    const vs = viz.getViewState();
    expect(vs.zoom).toBe(5.0);
    expect(vs.panX).toBe(3.0);
    expect(vs.panY).toBe(-3.0);
  });

  it('setUserParam updates coefficients', () => {
    const bus = new MessageBus();
    const viz = new DeJongVisualizer(bus);
    expect(() => {
      viz.setUserParam('paramA', 1.8);
      viz.setUserParam('paramB', -1.2);
      viz.tick();
    }).not.toThrow();
  });

  it('disposes cleanly', () => {
    const bus = new MessageBus();
    const viz = new DeJongVisualizer(bus);
    expect(() => viz.dispose()).not.toThrow();
  });
});
