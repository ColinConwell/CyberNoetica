import { describe, it, expect, beforeAll } from 'vitest';
import {
  getVisualizerDocumentation,
  getVisualizerTypes,
  listVisualizers,
  listVisualizerDocumentation,
  getVisualizerEntry,
  loadVisualizer,
  VISUALIZER_MANIFEST,
} from '../visualizers/index.js';
import { MessageBus } from '@cybernoetica/core';

// The registry is lazy — ensure every visualizer in the manifest has been loaded
// before running the integrity checks below.
beforeAll(async () => {
  for (const entry of VISUALIZER_MANIFEST) {
    await loadVisualizer(entry.type);
  }
});

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
    expect(types).toContain('voronoi-beta');
    expect(types).toContain('voronoi-gamma');
    expect(types).toContain('voronoi-delta');
    expect(types).toContain('voronoi-epsilon');
    expect(types).toContain('lorenz');
    expect(types).toContain('lorenz-beta');
    expect(types).toContain('lorenz-gamma');
    expect(types).toContain('lissajous');
    expect(types).toContain('kaleidoscope');
  });

  it('manifest exposes a documented entry for every visualizer type', () => {
    const documentedTypes = new Set(listVisualizerDocumentation().map(entry => entry.type));
    expect(documentedTypes.size).toBe(VISUALIZER_MANIFEST.length);
    for (const entry of VISUALIZER_MANIFEST) {
      expect(entry.documentation.summary).toBeTruthy();
      expect(documentedTypes.has(entry.type)).toBe(true);
      expect(getVisualizerDocumentation(entry.type)).toEqual(entry.documentation);
      for (const reference of entry.documentation.references) {
        expect(reference.label).toBeTruthy();
        expect(reference.url.startsWith('https://')).toBe(true);
      }
    }
  });

  it('manifest types match registered types one-to-one', () => {
    const registeredTypes = VISUALIZER_MANIFEST.map(e => e.type);
    for (const type of registeredTypes) {
      expect(getVisualizerEntry(type), `expected entry for ${type}`).toBeDefined();
    }
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
      expect(entry, `missing entry for ${type}`).toBeDefined();
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

  it('voronoi family has five versions', () => {
    const types = getVisualizerTypes();
    const voronoiTypes = types.filter(t => t.startsWith('voronoi'));
    expect(voronoiTypes).toHaveLength(5);
    expect(voronoiTypes).toContain('voronoi');
    expect(voronoiTypes).toContain('voronoi-beta');
    expect(voronoiTypes).toContain('voronoi-gamma');
    expect(voronoiTypes).toContain('voronoi-delta');
    expect(voronoiTypes).toContain('voronoi-epsilon');
  });

  it('lorenz family has three versions', () => {
    const types = getVisualizerTypes();
    const lorenzTypes = types.filter(t => t.startsWith('lorenz'));
    expect(lorenzTypes).toHaveLength(3);
    expect(lorenzTypes).toContain('lorenz');
    expect(lorenzTypes).toContain('lorenz-beta');
    expect(lorenzTypes).toContain('lorenz-gamma');
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

  it('loadVisualizer returns the same entry for repeated calls', async () => {
    const first = await loadVisualizer('mandelbrot');
    const second = await loadVisualizer('mandelbrot');
    expect(first).toBeDefined();
    expect(first).toBe(second);
  });

  it('loadVisualizer returns undefined for unknown types', async () => {
    const entry = await loadVisualizer('does-not-exist');
    expect(entry).toBeUndefined();
  });

  it('manifest usesPerspective matches loaded metadata', () => {
    for (const m of VISUALIZER_MANIFEST) {
      const entry = getVisualizerEntry(m.type);
      expect(entry, m.type).toBeDefined();
      expect(m.usesPerspective, m.type).toBe(entry!.metadata.usesPerspective);
    }
  });
});
