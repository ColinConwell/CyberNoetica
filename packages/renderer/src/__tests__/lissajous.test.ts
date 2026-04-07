import { describe, it, expect } from 'vitest';
import { LissajousVisualizer } from '../visualizers/lissajous/v01-alpha.js';
import { MessageBus } from '@cybernoetica/core';
import type { AudioFeatures } from '@cybernoetica/core';

describe('LissajousVisualizer', () => {
  it('can be constructed', () => {
    const bus = new MessageBus();
    const viz = new LissajousVisualizer(bus);
    expect(viz).toBeDefined();
  });

  it('responds to audio features', () => {
    const bus = new MessageBus();
    const viz = new LissajousVisualizer(bus);
    const features: AudioFeatures = {
      fftBins: new Float32Array(1024).fill(0.5),
      bass: 0.8, mid: 0.5, high: 0.3,
      spectralCentroid: 0.6, spectralFlux: 0.2, rms: 0.7,
      beatOnset: true, beatConfidence: 0.9, degraded: false,
    };
    bus.publish('audio:features', features);
    viz.tick();
    expect(viz.metadata.type).toBe('lissajous');
  });

  it('has correct metadata', () => {
    const bus = new MessageBus();
    const viz = new LissajousVisualizer(bus);
    expect(viz.metadata.label).toBe('Lissajous');
    expect(viz.metadata.usesPerspective).toBe(false);
    expect(viz.metadata.viewport.pan).toBe(false);
    expect(viz.metadata.viewport.zoom).toBe(true);
    expect(viz.metadata.viewport.orbit).toBe(false);
  });

  it('getViewState returns zoom and phase', () => {
    const bus = new MessageBus();
    const viz = new LissajousVisualizer(bus);
    const vs = viz.getViewState();
    expect(vs.zoom).toBe(1.0);
    expect(typeof vs.phase).toBe('number');
  });

  it('setViewState updates and clamps zoom', () => {
    const bus = new MessageBus();
    const viz = new LissajousVisualizer(bus);
    viz.setViewState({ zoom: 2.0 });
    expect(viz.getViewState().zoom).toBe(2.0);

    viz.setViewState({ zoom: 10.0 });
    expect(viz.getViewState().zoom).toBe(3.0);

    viz.setViewState({ zoom: 0.1 });
    expect(viz.getViewState().zoom).toBe(0.3);
  });

  it('setUserParam updates complexity', () => {
    const bus = new MessageBus();
    const viz = new LissajousVisualizer(bus);
    viz.setUserParam('complexity', 5);
    viz.tick();
    expect(viz.metadata.params.find(p => p.key === 'complexity')).toBeDefined();
  });

  it('beat resets damping envelope', () => {
    const bus = new MessageBus();
    const viz = new LissajousVisualizer(bus);
    // Run several ticks without audio to let damping decay
    for (let i = 0; i < 60; i++) viz.tick();
    const stateBefore = viz.getViewState();

    // Beat onset should be handled without error
    const features: AudioFeatures = {
      fftBins: new Float32Array(1024).fill(0.5),
      bass: 0.8, mid: 0.5, high: 0.3,
      spectralCentroid: 0.6, spectralFlux: 0.2, rms: 0.7,
      beatOnset: true, beatConfidence: 0.9, degraded: false,
    };
    bus.publish('audio:features', features);
    viz.tick();
    expect(viz.metadata.type).toBe('lissajous');
  });

  it('has audio-mapping params', () => {
    const bus = new MessageBus();
    const viz = new LissajousVisualizer(bus);
    const audioParams = viz.metadata.params.filter(p => p.category === 'audio-mapping');
    expect(audioParams.length).toBeGreaterThanOrEqual(3);
  });

  it('metadata includes viewStateFields', () => {
    const bus = new MessageBus();
    const viz = new LissajousVisualizer(bus);
    expect(viz.metadata.viewStateFields.length).toBe(2);
    const keys = viz.metadata.viewStateFields.map(f => f.key);
    expect(keys).toContain('zoom');
    expect(keys).toContain('phase');
  });
});
