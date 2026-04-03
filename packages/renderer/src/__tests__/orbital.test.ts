import { describe, it, expect } from 'vitest';
import { OrbitalVisualizer } from '../visualizers/orbital.js';
import { MessageBus } from '@cybernoetica/core';
import type { AudioFeatures } from '@cybernoetica/core';

describe('OrbitalVisualizer', () => {
  it('can be constructed', () => {
    const bus = new MessageBus();
    const viz = new OrbitalVisualizer(bus);
    expect(viz).toBeDefined();
  });

  it('responds to audio features', () => {
    const bus = new MessageBus();
    const viz = new OrbitalVisualizer(bus);
    const features: AudioFeatures = {
      fftBins: new Float32Array(1024), bass: 0.8, mid: 0.5, high: 0.3,
      spectralCentroid: 0.6, spectralFlux: 0.2, rms: 0.7,
      beatOnset: true, beatConfidence: 0.9, degraded: false,
    };
    bus.publish('audio:features', features);
    viz.tick();
    // Should not throw and should process features
    expect(viz.getParticleCount()).toBeGreaterThan(0);
  });

  it('provides default state with no audio', () => {
    const bus = new MessageBus();
    const viz = new OrbitalVisualizer(bus);
    viz.tick();
    expect(viz.getParticleCount()).toBeGreaterThan(0);
  });
});
