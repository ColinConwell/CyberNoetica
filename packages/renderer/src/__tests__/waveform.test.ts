import { describe, it, expect } from 'vitest';
import { WaveformVisualizer } from '../visualizers/waveform/v01-alpha.js';
import { MessageBus } from '@cybernoetica/core';
import type { AudioFeatures } from '@cybernoetica/core';

describe('WaveformVisualizer', () => {
  it('can be constructed', () => {
    const bus = new MessageBus();
    const viz = new WaveformVisualizer(bus);
    expect(viz).toBeDefined();
  });

  it('responds to audio features', () => {
    const bus = new MessageBus();
    const viz = new WaveformVisualizer(bus);
    const features: AudioFeatures = {
      fftBins: new Float32Array(1024).fill(0.5),
      bass: 0.8, mid: 0.5, high: 0.3,
      spectralCentroid: 0.6, spectralFlux: 0.2, rms: 0.7,
      beatOnset: true, beatConfidence: 0.9, degraded: false,
    };
    bus.publish('audio:features', features);
    viz.tick();
    expect(viz.getLayerCount()).toBe(5);
  });

  it('has idle animation with no audio', () => {
    const bus = new MessageBus();
    const viz = new WaveformVisualizer(bus);
    viz.tick();
    expect(viz.getLayerCount()).toBe(5);
  });

  it('getViewState returns vertical shift', () => {
    const bus = new MessageBus();
    const viz = new WaveformVisualizer(bus);
    const vs = viz.getViewState();
    expect(vs.verticalShift).toBe(0);
  });

  it('setViewState updates vertical shift', () => {
    const bus = new MessageBus();
    const viz = new WaveformVisualizer(bus);
    viz.setViewState({ verticalShift: 0.25 });
    expect(viz.getViewState().verticalShift).toBe(0.25);
  });

  it('setViewState clamps vertical shift', () => {
    const bus = new MessageBus();
    const viz = new WaveformVisualizer(bus);
    viz.setViewState({ verticalShift: 1.0 });
    expect(viz.getViewState().verticalShift).toBe(0.5);
    viz.setViewState({ verticalShift: -1.0 });
    expect(viz.getViewState().verticalShift).toBe(-0.5);
  });

  it('metadata includes viewStateFields', () => {
    const bus = new MessageBus();
    const viz = new WaveformVisualizer(bus);
    expect(viz.metadata.viewStateFields.length).toBe(1);
    expect(viz.metadata.viewStateFields[0].key).toBe('verticalShift');
  });
});
