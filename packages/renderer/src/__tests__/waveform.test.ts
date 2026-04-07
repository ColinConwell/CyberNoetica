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
    // Should not throw
    expect(viz.getLayerCount()).toBe(5);
  });

  it('has idle animation with no audio', () => {
    const bus = new MessageBus();
    const viz = new WaveformVisualizer(bus);
    viz.tick();
    expect(viz.getLayerCount()).toBe(5);
  });
});
