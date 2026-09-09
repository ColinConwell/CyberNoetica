import { describe, it, expect } from 'vitest';
import { BurningShipVisualizer } from '../visualizers/mandelbrot/v02-beta.js';
import { MessageBus } from '@cybernoetica/core';
import type { AudioFeatures } from '@cybernoetica/core';

describe('BurningShipVisualizer', () => {
  const features: AudioFeatures = {
    fftBins: new Float32Array(1024).fill(0.3),
    bass: 0.7,
    mid: 0.5,
    high: 0.3,
    spectralCentroid: 0.4,
    spectralFlux: 0.2,
    rms: 0.55,
    beatOnset: true,
    beatConfidence: 0.7,
    degraded: false,
  };

  it('can be constructed', () => {
    const bus = new MessageBus();
    const viz = new BurningShipVisualizer(bus);
    expect(viz).toBeDefined();
  });

  it('has correct metadata', () => {
    const bus = new MessageBus();
    const viz = new BurningShipVisualizer(bus);
    expect(viz.metadata.type).toBe('burningship');
    expect(viz.metadata.label).toBe('Burning Ship');
    expect(viz.metadata.usesPerspective).toBe(false);
    expect(viz.metadata.viewport.pan).toBe(true);
    expect(viz.metadata.viewport.zoom).toBe(true);
  });

  it('has audio-mapping params', () => {
    const bus = new MessageBus();
    const viz = new BurningShipVisualizer(bus);
    const audioParams = viz.metadata.params.filter(
      (p) => p.category === 'audio-mapping',
    );
    expect(audioParams.length).toBeGreaterThanOrEqual(4);
  });

  it('exposes complex-plane view state', () => {
    const bus = new MessageBus();
    const viz = new BurningShipVisualizer(bus);
    const vs = viz.getViewState();
    expect('centerReal' in vs).toBe(true);
    expect('centerImaginary' in vs).toBe(true);
    expect('zoom' in vs).toBe(true);
    expect('rotation' in vs).toBe(true);
  });

  it('responds to audio features without crashing', () => {
    const bus = new MessageBus();
    const viz = new BurningShipVisualizer(bus);
    bus.publish('audio:features', features);
    expect(() => viz.tick()).not.toThrow();
  });

  it('auto-zoom cycles without audio', () => {
    const bus = new MessageBus();
    const viz = new BurningShipVisualizer(bus);
    const before = viz.getViewState().zoom;
    for (let i = 0; i < 10; i++) viz.tick();
    const after = viz.getViewState().zoom;
    expect(after).not.toBe(before);
  });

  it('setViewState clamps values', () => {
    const bus = new MessageBus();
    const viz = new BurningShipVisualizer(bus);
    viz.setViewState({
      centerReal: 10,
      centerImaginary: -10,
      zoom: 99999,
      rotation: 1.5,
    });
    const vs = viz.getViewState();
    expect(vs.centerReal).toBe(1.0);
    expect(vs.centerImaginary).toBe(-2.0);
    expect(vs.zoom).toBe(1000);
    expect(vs.rotation).toBe(1.5);
  });

  it('setUserParam updates iterations', () => {
    const bus = new MessageBus();
    const viz = new BurningShipVisualizer(bus);
    expect(() => {
      viz.setUserParam('maxIterations', 200);
      viz.tick();
    }).not.toThrow();
  });

  it('disposes cleanly', () => {
    const bus = new MessageBus();
    const viz = new BurningShipVisualizer(bus);
    expect(() => viz.dispose()).not.toThrow();
  });
});
