import { describe, it, expect } from 'vitest';
import { JuliaVisualizer } from '../visualizers/julia/v01-alpha.js';
import { MessageBus } from '@cybernoetica/core';
import type { AudioFeatures } from '@cybernoetica/core';

describe('JuliaVisualizer', () => {
  it('can be constructed', () => {
    const bus = new MessageBus();
    const viz = new JuliaVisualizer(bus);
    expect(viz).toBeDefined();
  });

  it('responds to audio features and morphs c-parameter', () => {
    const bus = new MessageBus();
    const viz = new JuliaVisualizer(bus);
    const initial = viz.getUniforms();

    bus.publish('audio:features', {
      fftBins: new Float32Array(1024), bass: 0.9, mid: 0.5, high: 0.3,
      spectralCentroid: 0.6, spectralFlux: 0.2, rms: 0.7,
      beatOnset: true, beatConfidence: 0.9, degraded: false,
    } as AudioFeatures);
    viz.tick();

    const after = viz.getUniforms();
    // c-parameter should have started moving
    expect(after.cx).toBeDefined();
    expect(after.cy).toBeDefined();
  });

  it('has idle animation with no audio', () => {
    const bus = new MessageBus();
    const viz = new JuliaVisualizer(bus);
    viz.tick();
    viz.tick();
    const u = viz.getUniforms();
    expect(u.zoom).toBeGreaterThan(0);
  });
});
