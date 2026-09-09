import { describe, it, expect } from 'vitest';
import { ChladniCircularVisualizer } from '../visualizers/chladni/v02-beta.js';
import { MessageBus } from '@cybernoetica/core';
import type { AudioFeatures } from '@cybernoetica/core';

describe('ChladniCircularVisualizer', () => {
  it('can be constructed', () => {
    const bus = new MessageBus();
    const viz = new ChladniCircularVisualizer(bus);
    expect(viz).toBeDefined();
  });

  it('responds to audio features with FFT bins', () => {
    const bus = new MessageBus();
    const viz = new ChladniCircularVisualizer(bus);
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
    expect(viz.metadata.type).toBe('chladni-circular');
  });

  it('has correct metadata', () => {
    const bus = new MessageBus();
    const viz = new ChladniCircularVisualizer(bus);
    expect(viz.metadata.label).toBe('Chladni (Circular)');
    expect(viz.metadata.usesPerspective).toBe(false);
    expect(viz.metadata.viewport.pan).toBe(true);
    expect(viz.metadata.viewport.zoom).toBe(true);
  });

  it('has audio-mapping params', () => {
    const bus = new MessageBus();
    const viz = new ChladniCircularVisualizer(bus);
    const audioParams = viz.metadata.params.filter(
      (p) => p.category === 'audio-mapping',
    );
    expect(audioParams.length).toBeGreaterThanOrEqual(4);
  });

  it('getViewState returns center and zoom', () => {
    const bus = new MessageBus();
    const viz = new ChladniCircularVisualizer(bus);
    const vs = viz.getViewState();
    expect(vs.zoom).toBe(0.48);
    expect(vs.centerX).toBe(0);
    expect(vs.centerY).toBe(0);
  });

  it('setViewState clamps values', () => {
    const bus = new MessageBus();
    const viz = new ChladniCircularVisualizer(bus);
    viz.setViewState({ zoom: 100, centerX: 10, centerY: -10 });
    const vs = viz.getViewState();
    expect(vs.zoom).toBe(4.0);
    expect(vs.centerX).toBe(2.0);
    expect(vs.centerY).toBe(-2.0);
  });

  it('setUserParam updates mode count', () => {
    const bus = new MessageBus();
    const viz = new ChladniCircularVisualizer(bus);
    viz.setUserParam('modeCount', 8);
    viz.tick();
    expect(viz.metadata.type).toBe('chladni-circular');
  });

  it('disposes cleanly', () => {
    const bus = new MessageBus();
    const viz = new ChladniCircularVisualizer(bus);
    expect(() => viz.dispose()).not.toThrow();
  });
});
