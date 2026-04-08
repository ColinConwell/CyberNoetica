import { describe, it, expect } from 'vitest';
import '../visualizers/index.js';
import { getVisualizerTypes, listVisualizers, getVisualizerEntry } from '../visualizers/registry.js';
import { MessageBus } from '@cybernoetica/core';

describe('Visualizer Registry', () => {
  it('contains all expected visualizer types', () => {
    const types = getVisualizerTypes();
    expect(types).toContain('orbital');
    expect(types).toContain('orbital-beta');
    expect(types).toContain('orbital-gamma');
    expect(types).toContain('mandelbrot');
    expect(types).toContain('julia');
    expect(types).toContain('waveform');
    expect(types).toContain('voronoi');
    expect(types).toContain('lissajous');
    expect(types).toContain('kaleidoscope');
  });

  it('has at least 9 registered visualizers', () => {
    expect(getVisualizerTypes().length).toBeGreaterThanOrEqual(9);
  });

  it('listVisualizers returns metadata for all entries', () => {
    const list = listVisualizers();
    expect(list.length).toBe(getVisualizerTypes().length);
    for (const meta of list) {
      expect(meta.type).toBeTruthy();
      expect(meta.label).toBeTruthy();
      expect(meta.params).toBeDefined();
      expect(meta.viewport).toBeDefined();
      expect(meta.viewStateFields).toBeDefined();
    }
  });

  it('getVisualizerEntry returns a factory for each type', () => {
    const bus = new MessageBus();
    for (const type of getVisualizerTypes()) {
      const entry = getVisualizerEntry(type);
      expect(entry).toBeDefined();
      const viz = entry!.create(bus);
      expect(viz).toBeDefined();
      expect(viz.metadata.type).toBe(type);
      viz.dispose();
    }
  });

  it('orbital family has three versions', () => {
    const types = getVisualizerTypes();
    const orbitalTypes = types.filter(t => t.startsWith('orbital'));
    expect(orbitalTypes).toHaveLength(3);
    expect(orbitalTypes).toContain('orbital');
    expect(orbitalTypes).toContain('orbital-beta');
    expect(orbitalTypes).toContain('orbital-gamma');
  });

  it('all perspective visualizers use orbit viewport', () => {
    const list = listVisualizers();
    for (const meta of list) {
      if (meta.usesPerspective) {
        expect(meta.viewport.orbit).toBe(true);
      }
    }
  });

  it('all visualizers have categorized params', () => {
    const list = listVisualizers();
    for (const meta of list) {
      for (const param of meta.params) {
        expect(['appearance', 'audio-mapping']).toContain(param.category);
      }
    }
  });
});
