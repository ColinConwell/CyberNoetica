import { describe, it, expect } from 'vitest';
import { RoseCurveVisualizer } from '../visualizers/rosecurve/v01-alpha.js';
import { MessageBus } from '@cybernoetica/core';
import type { AudioFeatures } from '@cybernoetica/core';

describe('RoseCurveVisualizer', () => {
  it('can be constructed', () => {
    const bus = new MessageBus();
    const viz = new RoseCurveVisualizer(bus);
    expect(viz).toBeDefined();
  });

  it('responds to audio features', () => {
    const bus = new MessageBus();
    const viz = new RoseCurveVisualizer(bus);
    const features: AudioFeatures = {
      fftBins: new Float32Array(1024).fill(0.4),
      bass: 0.5, mid: 0.4, high: 0.3,
      spectralCentroid: 0.5, spectralFlux: 0.1, rms: 0.5,
      beatOnset: true, beatConfidence: 0.7, degraded: false,
    };
    bus.publish('audio:features', features);
    viz.tick();
    expect(viz.metadata.type).toBe('rosecurve');
  });

  it('has correct metadata', () => {
    const bus = new MessageBus();
    const viz = new RoseCurveVisualizer(bus);
    expect(viz.metadata.label).toBe('Rose Curve');
    expect(viz.metadata.usesPerspective).toBe(false);
  });

  it('has audio-mapping params', () => {
    const bus = new MessageBus();
    const viz = new RoseCurveVisualizer(bus);
    const audioParams = viz.metadata.params.filter(p => p.category === 'audio-mapping');
    expect(audioParams.length).toBeGreaterThanOrEqual(4);
  });

  it('getViewState returns center and zoom', () => {
    const bus = new MessageBus();
    const viz = new RoseCurveVisualizer(bus);
    const vs = viz.getViewState();
    expect(vs.centerX).toBe(0);
    expect(vs.zoom).toBe(1.0);
  });

  it('setViewState clamps', () => {
    const bus = new MessageBus();
    const viz = new RoseCurveVisualizer(bus);
    viz.setViewState({ zoom: 10, centerX: 5 });
    const vs = viz.getViewState();
    expect(vs.zoom).toBe(4.0);
    expect(vs.centerX).toBe(3.0);
  });

  it('beat spin decay does not throw on repeated ticks', () => {
    const bus = new MessageBus();
    const viz = new RoseCurveVisualizer(bus);
    const features: AudioFeatures = {
      fftBins: new Float32Array(1024),
      bass: 0.5, mid: 0.4, high: 0.3,
      spectralCentroid: 0.5, spectralFlux: 0.1, rms: 0.5,
      beatOnset: true, beatConfidence: 1.0, degraded: false,
    };
    bus.publish('audio:features', features);
    for (let i = 0; i < 10; i++) viz.tick();
    expect(viz.metadata.type).toBe('rosecurve');
  });

  it('disposes cleanly', () => {
    const bus = new MessageBus();
    const viz = new RoseCurveVisualizer(bus);
    expect(() => viz.dispose()).not.toThrow();
  });
});
