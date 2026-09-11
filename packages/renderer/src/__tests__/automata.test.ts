import { describe, it, expect } from 'vitest';
import { AutomataVisualizer } from '../visualizers/automata/v01-alpha.js';
import { MessageBus } from '@cybernoetica/core';
import type { AudioFeatures } from '@cybernoetica/core';

describe('AutomataVisualizer', () => {
  it('can be constructed', () => {
    const bus = new MessageBus();
    const viz = new AutomataVisualizer(bus);
    expect(viz).toBeDefined();
  });

  it('responds to audio features', () => {
    const bus = new MessageBus();
    const viz = new AutomataVisualizer(bus);
    const features: AudioFeatures = {
      fftBins: new Float32Array(1024).fill(0.5),
      bass: 0.8, mid: 0.5, high: 0.3,
      spectralCentroid: 0.6, spectralFlux: 0.2, rms: 0.7,
      beatOnset: true, beatConfidence: 0.9, degraded: false,
    };
    bus.publish('audio:features', features);
    viz.tick();
    expect(viz.metadata.type).toBe('automata');
  });

  it('has correct metadata', () => {
    const bus = new MessageBus();
    const viz = new AutomataVisualizer(bus);
    expect(viz.metadata.label).toBe('Automata');
    expect(viz.metadata.usesPerspective).toBe(false);
    expect(viz.metadata.viewport.pan).toBe(true);
    expect(viz.metadata.viewport.zoom).toBe(true);
    expect(viz.metadata.viewport.orbit).toBe(false);
  });

  it('getViewState returns zoom, panX, panY', () => {
    const bus = new MessageBus();
    const viz = new AutomataVisualizer(bus);
    const vs = viz.getViewState();
    expect(vs.zoom).toBe(1.0);
    expect(vs.panX).toBe(0.0);
    expect(vs.panY).toBe(0.0);
  });

  it('setViewState updates and clamps values', () => {
    const bus = new MessageBus();
    const viz = new AutomataVisualizer(bus);
    viz.setViewState({ zoom: 2.5 });
    expect(viz.getViewState().zoom).toBe(2.5);

    viz.setViewState({ zoom: 10.0 });
    expect(viz.getViewState().zoom).toBe(5.0);

    viz.setViewState({ zoom: 0.1 });
    expect(viz.getViewState().zoom).toBe(0.3);

    viz.setViewState({ panX: 5.0 });
    expect(viz.getViewState().panX).toBe(3.0);

    viz.setViewState({ panY: -5.0 });
    expect(viz.getViewState().panY).toBe(-3.0);
  });

  it('has audio-mapping params', () => {
    const bus = new MessageBus();
    const viz = new AutomataVisualizer(bus);
    const audioParams = viz.metadata.params.filter(p => p.category === 'audio-mapping');
    expect(audioParams.length).toBeGreaterThanOrEqual(3);
  });

  it('metadata includes viewStateFields', () => {
    const bus = new MessageBus();
    const viz = new AutomataVisualizer(bus);
    expect(viz.metadata.viewStateFields.length).toBe(3);
    const keys = viz.metadata.viewStateFields.map(f => f.key);
    expect(keys).toContain('zoom');
    expect(keys).toContain('panX');
    expect(keys).toContain('panY');
  });

  it('disposes cleanly', () => {
    const bus = new MessageBus();
    const viz = new AutomataVisualizer(bus);
    expect(() => viz.dispose()).not.toThrow();
  });
});
