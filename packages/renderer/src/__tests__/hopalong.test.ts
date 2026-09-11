import { describe, it, expect } from 'vitest';
import { HopalongVisualizer } from '../visualizers/attractor/v02-beta.js';
import { MessageBus } from '@cybernoetica/core';
import type { AudioFeatures } from '@cybernoetica/core';

describe('HopalongVisualizer', () => {
  it('can be constructed', () => {
    const bus = new MessageBus();
    const viz = new HopalongVisualizer(bus);
    expect(viz).toBeDefined();
  });

  it('responds to audio features', () => {
    const bus = new MessageBus();
    const viz = new HopalongVisualizer(bus);
    const features: AudioFeatures = {
      fftBins: new Float32Array(1024).fill(0.5),
      bass: 0.7, mid: 0.4, high: 0.2,
      spectralCentroid: 0.5, spectralFlux: 0.15, rms: 0.6,
      beatOnset: true, beatConfidence: 0.8, degraded: false,
    };
    bus.publish('audio:features', features);
    viz.tick();
    expect(viz.metadata.type).toBe('hopalong');
  });

  it('has correct metadata', () => {
    const bus = new MessageBus();
    const viz = new HopalongVisualizer(bus);
    expect(viz.metadata.label).toBe('Hopalong');
    expect(viz.metadata.usesPerspective).toBe(false);
    expect(viz.metadata.viewport.pan).toBe(true);
    expect(viz.metadata.viewport.zoom).toBe(true);
  });

  it('getViewState returns pan and zoom', () => {
    const bus = new MessageBus();
    const viz = new HopalongVisualizer(bus);
    const vs = viz.getViewState();
    expect(vs.zoom).toBe(1.0);
    expect(vs.panX).toBe(0.0);
    expect(vs.panY).toBe(0.0);
  });

  it('setViewState clamps values', () => {
    const bus = new MessageBus();
    const viz = new HopalongVisualizer(bus);
    viz.setViewState({ zoom: 100, panX: 50, panY: -50 });
    const vs = viz.getViewState();
    expect(vs.zoom).toBe(5.0);
    expect(vs.panX).toBe(8.0);
    expect(vs.panY).toBe(-8.0);
  });

  it('has audio-mapping params', () => {
    const bus = new MessageBus();
    const viz = new HopalongVisualizer(bus);
    const audioParams = viz.metadata.params.filter(p => p.category === 'audio-mapping');
    expect(audioParams.length).toBeGreaterThanOrEqual(4);
  });

  it('setUserParam updates parameters', () => {
    const bus = new MessageBus();
    const viz = new HopalongVisualizer(bus);
    viz.setUserParam('paramA', 3.5);
    viz.tick();
    // Tick shouldn't throw; the internal param is consumed in tick()
    expect(viz.metadata.type).toBe('hopalong');
  });

  it('disposes cleanly', () => {
    const bus = new MessageBus();
    const viz = new HopalongVisualizer(bus);
    expect(() => viz.dispose()).not.toThrow();
  });
});
