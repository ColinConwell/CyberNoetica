import { describe, it, expect } from 'vitest';
import { MandelbrotVisualizer } from '../visualizers/mandelbrot/v01-alpha.js';
import { MessageBus } from '@cybernoetica/core';
import type { AudioFeatures } from '@cybernoetica/core';

describe('MandelbrotVisualizer', () => {
  it('updates from audio features', () => {
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

  it('getViewState returns valid initial coordinates', () => {
    const bus = new MessageBus();
    const viz = new MandelbrotVisualizer(bus);
    const vs = viz.getViewState();
    expect(vs.centerReal).toBeDefined();
    expect(vs.centerImaginary).toBeDefined();
    expect(vs.zoom).toBeGreaterThan(0);
    expect(vs.rotation).toBeDefined();
  });

  it('setViewState updates center and zoom', () => {
    const bus = new MessageBus();
    const viz = new MandelbrotVisualizer(bus);
    viz.setViewState({ centerReal: -0.5, centerImaginary: 0.3, zoom: 100 });
    const vs = viz.getViewState();
    expect(vs.centerReal).toBe(-0.5);
    expect(vs.centerImaginary).toBe(0.3);
    expect(vs.zoom).toBe(100);
  });

  it('setViewState partial update preserves other fields', () => {
    const bus = new MessageBus();
    const viz = new MandelbrotVisualizer(bus);
    const before = viz.getViewState();
    viz.setViewState({ rotation: 1.5 });
    const after = viz.getViewState();
    expect(after.rotation).toBe(1.5);
    expect(after.centerReal).toBe(before.centerReal);
  });

  it('metadata includes viewStateFields', () => {
    const bus = new MessageBus();
    const viz = new MandelbrotVisualizer(bus);
    expect(viz.metadata.viewStateFields.length).toBe(4);
    expect(viz.metadata.viewStateFields.map(f => f.key))
      .toEqual(['centerReal', 'centerImaginary', 'zoom', 'rotation']);
  });
});
