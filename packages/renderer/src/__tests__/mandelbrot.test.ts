import { describe, it, expect } from 'vitest';
import { MandelbrotVisualizer } from '../visualizers/mandelbrot.js';
import { MessageBus } from '@cybernoetica/core';
import type { AudioFeatures } from '@cybernoetica/core';

describe('MandelbrotVisualizer', () => {
  it('updates uniforms from audio features', () => {
    const bus = new MessageBus();
    const viz = new MandelbrotVisualizer(bus);
    const features: AudioFeatures = {
      fftBins: new Float32Array(1024), bass: 0.8, mid: 0.5, high: 0.3,
      spectralCentroid: 0.4, spectralFlux: 0.2, rms: 0.6,
      beatOnset: false, beatConfidence: 0.0, degraded: false,
    };
    bus.publish('audio:features', features);
    viz.tick();
    const uniforms = viz.getUniforms();
    expect(uniforms.zoom).toBeGreaterThan(0);
    expect(uniforms.colorSpeed).toBeGreaterThan(0);
    expect(uniforms.iterations).toBeGreaterThan(0);
    expect(uniforms.brightness).toBeGreaterThan(0);
  });

  it('provides default uniforms with no audio', () => {
    const bus = new MessageBus();
    const viz = new MandelbrotVisualizer(bus);
    const uniforms = viz.getUniforms();
    expect(uniforms.zoom).toBeDefined();
    expect(uniforms.colorSpeed).toBeDefined();
    expect(uniforms.iterations).toBeDefined();
  });
});
