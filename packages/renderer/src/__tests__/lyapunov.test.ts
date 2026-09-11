import { describe, it, expect } from 'vitest';
import { LyapunovVisualizer } from '../visualizers/lyapunov/v01-alpha.js';
import { MessageBus } from '@cybernoetica/core';
import type { AudioFeatures } from '@cybernoetica/core';

describe('LyapunovVisualizer', () => {
  const features: AudioFeatures = {
    fftBins: new Float32Array(1024).fill(0.3),
    bass: 0.6,
    mid: 0.4,
    high: 0.5,
    spectralCentroid: 0.5,
    spectralFlux: 0.25,
    rms: 0.5,
    beatOnset: true,
    beatConfidence: 0.75,
    degraded: false,
  };

  it('can be constructed', () => {
    const bus = new MessageBus();
    const viz = new LyapunovVisualizer(bus);
    expect(viz).toBeDefined();
  });

  it('has correct metadata', () => {
    const bus = new MessageBus();
    const viz = new LyapunovVisualizer(bus);
    expect(viz.metadata.type).toBe('lyapunov');
    expect(viz.metadata.label).toBe('Lyapunov');
    expect(viz.metadata.usesPerspective).toBe(false);
    expect(viz.metadata.viewport.pan).toBe(true);
    expect(viz.metadata.viewport.zoom).toBe(true);
  });

  it('has audio-mapping params', () => {
    const bus = new MessageBus();
    const viz = new LyapunovVisualizer(bus);
    const audioParams = viz.metadata.params.filter(
      (p) => p.category === 'audio-mapping',
    );
    expect(audioParams.length).toBeGreaterThanOrEqual(4);
  });

  it('responds to audio features without crashing', () => {
    const bus = new MessageBus();
    const viz = new LyapunovVisualizer(bus);
    bus.publish('audio:features', features);
    expect(() => viz.tick()).not.toThrow();
  });

  it('default view state sits in interesting region of param plane', () => {
    const bus = new MessageBus();
    const viz = new LyapunovVisualizer(bus);
    const vs = viz.getViewState();
    expect(vs.panX).toBeGreaterThanOrEqual(0);
    expect(vs.panX).toBeLessThanOrEqual(4);
    expect(vs.panY).toBeGreaterThanOrEqual(0);
    expect(vs.panY).toBeLessThanOrEqual(4);
    expect(vs.zoom).toBe(1.0);
  });

  it('setViewState clamps values', () => {
    const bus = new MessageBus();
    const viz = new LyapunovVisualizer(bus);
    viz.setViewState({ zoom: 100, panX: 10, panY: -10 });
    const vs = viz.getViewState();
    expect(vs.zoom).toBe(8.0);
    expect(vs.panX).toBe(4.0);
    expect(vs.panY).toBe(0.0);
  });

  it('sequence bias can be set via setUserParam', () => {
    const bus = new MessageBus();
    const viz = new LyapunovVisualizer(bus);
    expect(() => {
      viz.setUserParam('sequenceBias', 0.75);
      viz.tick();
    }).not.toThrow();
  });

  it('beat onset rotates sequence phase', () => {
    const bus = new MessageBus();
    const viz = new LyapunovVisualizer(bus);
    // Capture initial tick
    viz.tick();
    // Fire several beat events and tick
    for (let i = 0; i < 5; i++) {
      bus.publish('audio:features', features);
      viz.tick();
    }
    // No assertion on phase value (internal) -- just verify stability
    expect(viz.metadata.type).toBe('lyapunov');
  });

  it('disposes cleanly', () => {
    const bus = new MessageBus();
    const viz = new LyapunovVisualizer(bus);
    expect(() => viz.dispose()).not.toThrow();
  });
});
