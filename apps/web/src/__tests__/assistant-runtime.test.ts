import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { MessageBus } from '@cybernoetica/core';
import { Scene } from 'three';
import { createStudioRuntime } from '../assistant/runtime.js';
import {
  parseRecipe,
  RecipeVisualizer,
  sampleRecipeLayer,
  registerRecipe,
  saveCreation,
  restoreCreations,
  creationEntries,
} from '../assistant/recipe.js';
import type { VisualizerRecipe } from '../assistant/recipe.js';
import type { CyberNoeticaGlobals } from '../globals.js';
const recipe: VisualizerRecipe = {
  version: 1,
  name: 'Tidal rose',
  description: 'Interlaced curves',
  layers: [
    {
      shape: 'rose',
      marks: 'line',
      count: 128,
      radius: 2,
      frequencyX: 3,
      frequencyY: 2,
      frequencyZ: 1,
      phase: 0,
      twist: 1,
      speed: 0.2,
      hue: 0.7,
      opacity: 0.6,
      bass: 1,
      treble: 0.2,
    },
  ],
};
let viz: RecipeVisualizer;
beforeEach(() => {
  localStorage.clear();
  viz = new RecipeVisualizer('studio-test', recipe, new MessageBus());
  window.__cybernoetica = {
    vizManager: {
      getActive: () => viz,
      getActiveType: () => viz.metadata.type,
    },
    store: { getState: () => ({ ui: {} }) },
    scene: { getWorkTiming: () => ({ cpuMs: 1, gpuMs: null }) },
  } as unknown as CyberNoeticaGlobals;
});
afterEach(() => {
  viz.dispose();
  delete window.__cybernoetica;
});
function runtime() {
  return createStudioRuntime({ handoff: vi.fn(), serverTool: vi.fn() });
}
it('validates the entire edit before mutation and prevents stale proposals', async () => {
  const r = runtime(),
    signal = new AbortController().signal,
    before = viz.getUserParams();
  await expect(
    r.execute(
      'set_visual_params',
      { type: 'studio-test', params: { speed: 2, scale: 99 } },
      signal,
      r.fingerprint(),
    ),
  ).rejects.toThrow('Out of range');
  expect(viz.getUserParams()).toEqual(before);
  const stale = r.fingerprint();
  viz.setUserParam('speed', 0.5);
  await expect(
    r.execute(
      'set_visual_params',
      { type: 'studio-test', params: { speed: 2 } },
      signal,
      stale,
    ),
  ).rejects.toThrow('Configuration changed');
  expect(viz.getUserParams().speed).toBe(0.5);
});
it('applies and undoes a live edit, rejects undo after manual changes', async () => {
  const r = runtime(),
    signal = new AbortController().signal;
  await r.execute(
    'set_visual_params',
    { type: 'studio-test', params: { speed: 2 } },
    signal,
    r.fingerprint(),
  );
  expect(viz.getUserParams().speed).toBe(2);
  await r.undo();
  expect(viz.getUserParams().speed).toBe(1);
  await r.execute(
    'set_visual_params',
    { type: 'studio-test', params: { speed: 2 } },
    signal,
    r.fingerprint(),
  );
  viz.setUserParam('hue', 0.5);
  await expect(r.undo()).rejects.toThrow('Configuration changed');
});
it('cancellation prevents mutations and inactive sources reject tools', async () => {
  const r = runtime(),
    controller = new AbortController();
  controller.abort();
  await expect(
    r.execute(
      'set_visual_params',
      { type: 'studio-test', params: { speed: 2 } },
      controller.signal,
      r.fingerprint(),
    ),
  ).rejects.toThrow('Stopped');
  expect(viz.getUserParams().speed).toBe(1);
  await expect(
    r.execute(
      'set_soundscape',
      { params: { energy: 0.2 } },
      new AbortController().signal,
      r.fingerprint(),
    ),
  ).rejects.toThrow('Activate Soundscape');
});
it('recipe schema rejects executable fields, excessive workloads and nonfinite coordinates', () => {
  for (const bad of [
    { ...recipe, code: 'fetch()' },
    { ...recipe, layers: [{ ...recipe.layers[0], shader: 'void main() {}' }] },
    { ...recipe, layers: [{ ...recipe.layers[0], count: 4097 }] },
    { ...recipe, layers: Array(4).fill({ ...recipe.layers[0], count: 4096 }) },
    { ...recipe, layers: [{ ...recipe.layers[0], radius: NaN }] },
  ])
    expect(() => parseRecipe(bad)).toThrow();
  for (const shape of ['orbit', 'rose', 'helix', 'lissajous', 'wave'] as const)
    for (let i = 0; i < 100; i++)
      expect(
        sampleRecipeLayer(
          { ...recipe.layers[0], shape },
          i / 99,
          100,
          0.5,
          0.8,
        ).every(Number.isFinite),
      ).toBe(true);
});
it('procedural creation attaches geometry, responds to controls, and frees resources', () => {
  const scene = new Scene();
  viz.attach(scene);
  expect(scene.children).toHaveLength(1);
  const line = scene.children[0].children[0] as any;
  expect(line.geometry.attributes.position.count).toBe(128);
  const initial = Array.from(line.geometry.attributes.position.array);
  viz.setUserParam('scale', 0.5);
  viz.tick(0);
  expect(line.geometry.attributes.position.array[0]).toBeCloseTo(
    Number(initial[0]) * 0.5,
  );
  const geometryDispose = vi.spyOn(line.geometry, 'dispose'),
    materialDispose = vi.spyOn(line.material, 'dispose');
  viz.dispose();
  expect(scene.children).toHaveLength(0);
  expect(geometryDispose).toHaveBeenCalledOnce();
  expect(materialDispose).toHaveBeenCalledOnce();
  viz.tick();
});

it('saves valid recipes despite corrupted prior browser storage', () => {
  localStorage.setItem('cybernoetica:studio:recipes:v1', 'null');
  registerRecipe(recipe, 'studio-persistence-test');
  saveCreation('studio-persistence-test');
  restoreCreations();
  expect(
    creationEntries().some((c) => c.type === 'studio-persistence-test'),
  ).toBe(true);
  expect(
    JSON.parse(localStorage.getItem('cybernoetica:studio:recipes:v1')!)[
      'studio-persistence-test'
    ].name,
  ).toBe('Tidal rose');
});
it('restores tuned controls when undoing creation', async () => {
  const r = runtime(),
    signal = new AbortController().signal;
  viz.setUserParam('speed', 0.35);
  const original = viz;
  window.__cybernoetica!.selectVisualizer = async (type) => {
    viz = new RecipeVisualizer(type, recipe, new MessageBus());
    return true;
  };
  await r.execute('create_visualizer', { recipe }, signal, r.fingerprint());
  expect(viz.metadata.type).toMatch(/^studio-/);
  await r.undo();
  expect(viz.metadata.type).toBe('studio-test');
  expect(viz.getUserParams().speed).toBe(0.35);
  original.dispose();
});
it('edits and restores active Soundscape macros without touching transport', async () => {
  let params = { cycleLength: 24, energy: 0.5, brightness: 0.5, beatRate: 90 };
  const source = {
    sourceType: 'soundscape',
    getSoundscapeParams: () => ({ ...params }),
    getSoundscapePatch: () => ({}),
    setSoundscapeParams: vi.fn((p) => {
      params = { ...params, ...p };
    }),
    setSoundscapePatch: vi.fn(),
  };
  window.__cybernoetica!.journey = {
    source,
    active: null,
  } as unknown as NonNullable<CyberNoeticaGlobals['journey']>;
  const r = runtime(),
    signal = new AbortController().signal;
  await r.execute(
    'set_soundscape',
    { params: { energy: 0.2 } },
    signal,
    r.fingerprint(),
  );
  expect(params.energy).toBe(0.2);
  await r.undo();
  expect(params.energy).toBe(0.5);
  await expect(
    r.execute('set_menu', { columns: 1.5 }, signal, r.fingerprint()),
  ).rejects.toThrow('integer');
});
