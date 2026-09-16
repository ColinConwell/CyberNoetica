import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Color,
  Group,
  Line,
  LineBasicMaterial,
  Points,
  PointsMaterial,
} from 'three';
import type { Scene } from 'three';
import { registerVisualizer } from '@cybernoetica/renderer';
import type { Visualizer, VisualizerMetadata } from '@cybernoetica/renderer';
import type { AudioFeatures, MessageBus } from '@cybernoetica/core';
export interface RecipeLayer {
  shape: 'orbit' | 'rose' | 'helix' | 'lissajous' | 'wave';
  marks: 'line' | 'points';
  count: number;
  radius: number;
  frequencyX: number;
  frequencyY: number;
  frequencyZ: number;
  phase: number;
  twist: number;
  speed: number;
  hue: number;
  opacity: number;
  bass: number;
  treble: number;
}
export interface VisualizerRecipe {
  version: 1;
  name: string;
  description: string;
  layers: RecipeLayer[];
}
const ranges = {
  count: [64, 4096],
  radius: [0.1, 5],
  frequencyX: [0.1, 20],
  frequencyY: [0.1, 20],
  frequencyZ: [0, 10],
  phase: [-6.283, 6.283],
  twist: [-8, 8],
  speed: [-2, 2],
  hue: [0, 1],
  opacity: [0.05, 1],
  bass: [0, 2],
  treble: [0, 2],
} as const;
export function parseRecipe(value: unknown): VisualizerRecipe {
  if (!value || typeof value !== 'object')
    throw new Error('Recipe must be an object.');
  const p = value as Record<string, unknown>;
  if (
    p.version !== 1 ||
    typeof p.name !== 'string' ||
    !p.name.trim() ||
    p.name.length > 80 ||
    typeof p.description !== 'string' ||
    p.description.length > 500 ||
    !Array.isArray(p.layers) ||
    p.layers.length < 1 ||
    p.layers.length > 6
  )
    throw new Error(
      'Recipe needs version 1, a name, description, and 1–6 layers.',
    );
  for (const key of Object.keys(p))
    if (!['version', 'name', 'description', 'layers'].includes(key))
      throw new Error(`Unsupported recipe field: ${key}`);
  let total = 0;
  const layers = p.layers.map((v) => {
    if (!v || typeof v !== 'object' || Array.isArray(v))
      throw new Error('Invalid layer.');
    for (const key of Object.keys(v))
      if (!['shape', 'marks', ...Object.keys(ranges)].includes(key))
        throw new Error(`Unsupported layer field: ${key}`);
    if (
      !['orbit', 'rose', 'helix', 'lissajous', 'wave'].includes(v.shape) ||
      !['line', 'points'].includes(v.marks)
    )
      throw new Error('Unsupported geometry or marks.');
    for (const [key, [min, max]] of Object.entries(ranges)) {
      const n = v[key];
      if (typeof n !== 'number' || !Number.isFinite(n) || n < min || n > max)
        throw new Error(`Invalid ${key}: expected ${min}–${max}.`);
    }
    if (!Number.isInteger(v.count))
      throw new Error('Sample count must be an integer.');
    total += v.count;
    return { ...v } as RecipeLayer;
  });
  if (total > 12000) throw new Error('Recipe exceeds 12000 total samples.');
  return {
    version: 1,
    name: p.name.trim(),
    description: p.description,
    layers,
  };
}
export function recipeMetadata(
  type: string,
  recipe: VisualizerRecipe,
): VisualizerMetadata {
  return {
    type,
    label: recipe.name,
    description: recipe.description,
    usesPerspective: true,
    autoOrbit: false,
    viewport: { pan: false, zoom: true, orbit: true },
    viewStateFields: [
      {
        key: 'orbitAngle',
        label: 'Orbit angle',
        min: -Math.PI,
        max: Math.PI,
        step: 0.01,
      },
      { key: 'elevation', label: 'Elevation', min: -1.5, max: 1.5, step: 0.01 },
      { key: 'distance', label: 'Distance', min: 4, max: 30, step: 0.1 },
    ],
    params: [
      {
        key: 'speed',
        label: 'Motion speed',
        min: 0,
        max: 3,
        step: 0.05,
        initial: 1,
        description: 'Multiplier on all layer motion.',
      },
      {
        key: 'scale',
        label: 'Form scale',
        min: 0.1,
        max: 2,
        step: 0.05,
        initial: 1,
      },
      {
        key: 'hue',
        label: 'Palette rotation',
        min: 0,
        max: 1,
        step: 0.01,
        initial: 0,
      },
      {
        key: 'audio',
        label: 'Audio response',
        min: 0,
        max: 3,
        step: 0.05,
        initial: 1,
        category: 'audio-mapping',
      },
      ...recipe.layers.flatMap((l, i) => [
        {
          key: `radius${i}`,
          label: `Layer ${i + 1} radius`,
          min: 0.1,
          max: 5,
          step: 0.05,
          initial: l.radius,
        },
        {
          key: `opacity${i}`,
          label: `Layer ${i + 1} opacity`,
          min: 0,
          max: 1,
          step: 0.01,
          initial: l.opacity,
        },
      ]),
    ],
  };
}
export function sampleRecipeLayer(
  layer: RecipeLayer,
  t: number,
  time: number,
  bass: number,
  high: number,
): [number, number, number] {
  const phase = layer.phase + time * layer.speed;
  const a = t * Math.PI * 2,
    r = layer.radius * (1 + Math.min(1, bass) * layer.bass * 0.35);
  let x = 0,
    y = 0,
    z = 0;
  if (layer.shape === 'orbit') {
    x = r * Math.cos(a * layer.frequencyX + phase);
    y = r * Math.sin(a * layer.frequencyY + phase);
    z = 0.4 * r * Math.sin(a * layer.frequencyZ + phase);
  }
  if (layer.shape === 'rose') {
    const petal = r * Math.cos(a * layer.frequencyX + phase);
    x = petal * Math.cos(a);
    y = petal * Math.sin(a);
    z = 0.25 * r * Math.sin(a * layer.frequencyZ + phase);
  }
  if (layer.shape === 'helix') {
    x = r * Math.cos(a * layer.frequencyX + phase);
    y = r * Math.sin(a * layer.frequencyY + phase);
    z = (t - 0.5) * r * 2 + Math.sin(a * layer.frequencyZ + phase) * 0.2;
  }
  if (layer.shape === 'lissajous') {
    x = r * Math.sin(a * layer.frequencyX + phase);
    y = r * Math.sin(a * layer.frequencyY);
    z = 0.6 * r * Math.sin(a * layer.frequencyZ + phase * 0.5);
  }
  if (layer.shape === 'wave') {
    x = (t - 0.5) * r * 2;
    y = r * 0.5 * Math.sin(a * layer.frequencyY + phase);
    z = r * 0.3 * Math.cos(a * layer.frequencyZ + phase);
  }
  const twist =
      layer.twist * z * 0.2 +
      high * layer.treble * 0.3 * Math.sin(a * 3 + phase),
    c = Math.cos(twist),
    s = Math.sin(twist);
  return [x * c - y * s, x * s + y * c, z];
}
export class RecipeVisualizer implements Visualizer {
  readonly metadata: VisualizerMetadata;
  private root = new Group();
  private time = 0;
  private disposed = false;
  private unsubs: Array<() => void> = [];
  private params: Record<string, number>;
  private view = { orbitAngle: 0, elevation: 0.25, distance: 12 };
  private bass = 0;
  private high = 0;
  private targetBass = 0;
  private targetHigh = 0;
  private objects: Array<{
    geometry: BufferGeometry;
    material: LineBasicMaterial | PointsMaterial;
    positions: Float32Array;
  }> = [];
  constructor(
    type: string,
    readonly recipe: VisualizerRecipe,
    bus: MessageBus,
  ) {
    this.metadata = recipeMetadata(type, recipe);
    this.params = Object.fromEntries(
      this.metadata.params.map((p) => [p.key, p.initial]),
    );
    this.unsubs.push(
      bus.subscribe<AudioFeatures>('audio:features', (m) => {
        this.targetBass = m.payload.bass;
        this.targetHigh = m.payload.high;
      }),
    );
  }
  attach(scene: Scene) {
    this.recipe.layers.forEach((layer) => {
      const positions = new Float32Array(layer.count * 3),
        geometry = new BufferGeometry();
      geometry.setAttribute('position', new BufferAttribute(positions, 3));
      const common = {
        transparent: true,
        opacity: layer.opacity,
        depthWrite: false,
        blending: AdditiveBlending,
        color: new Color().setHSL(layer.hue, 0.75, 0.6),
      };
      const material =
        layer.marks === 'points'
          ? new PointsMaterial({ ...common, size: 3, sizeAttenuation: false })
          : new LineBasicMaterial(common);
      const object =
        layer.marks === 'points'
          ? new Points(geometry, material)
          : new Line(geometry, material);
      object.frustumCulled = false;
      this.objects.push({ positions, geometry, material });
      this.root.add(object);
    });
    scene.add(this.root);
    this.tick(0);
  }
  tick(dt = 1 / 60) {
    if (this.disposed) return;
    dt = Math.max(0, Math.min(0.1, dt));
    this.time += dt * this.params.speed;
    const alpha = 1 - Math.exp(-dt * 12);
    this.bass += (this.targetBass - this.bass) * alpha;
    this.high += (this.targetHigh - this.high) * alpha;
    this.recipe.layers.forEach((layer, i) => {
      const item = this.objects[i];
      if (!item) return;
      const radiusScale = this.params[`radius${i}`] / layer.radius;
      for (let n = 0; n < layer.count; n++) {
        const p = sampleRecipeLayer(
          layer,
          n / (layer.count - 1),
          this.time,
          this.bass * this.params.audio,
          this.high * this.params.audio,
        );
        for (let d = 0; d < 3; d++)
          item.positions[n * 3 + d] = p[d] * radiusScale * this.params.scale;
      }
      item.geometry.attributes.position.needsUpdate = true;
      item.material.opacity = this.params[`opacity${i}`];
      item.material.color.setHSL((layer.hue + this.params.hue) % 1, 0.75, 0.6);
    });
  }
  setResolution(_w: number, _h: number) {}
  getViewState() {
    return { ...this.view };
  }
  setViewState(v: Record<string, number>) {
    for (const f of this.metadata.viewStateFields)
      if (Number.isFinite(v[f.key]))
        this.view[f.key as keyof typeof this.view] = Math.min(
          f.max,
          Math.max(f.min, v[f.key]),
        );
  }
  setUserParam(key: string, value: number) {
    const p = this.metadata.params.find((p) => p.key === key);
    if (p && Number.isFinite(value))
      this.params[key] = Math.max(p.min, Math.min(p.max, value));
  }
  getUserParams() {
    return { ...this.params };
  }
  dispose() {
    this.disposed = true;
    this.unsubs.forEach((fn) => fn());
    this.root.removeFromParent();
    this.objects.forEach((o) => {
      o.geometry.dispose();
      o.material.dispose();
    });
    this.objects = [];
    this.root.clear();
  }
}
const creations = new Map<string, VisualizerRecipe>();
export function registerRecipe(
  input: unknown,
  id = `studio-${crypto.randomUUID().slice(0, 16)}`,
): { type: string; recipe: VisualizerRecipe } {
  const recipe = parseRecipe(input);
  if (!/^studio-[a-z0-9-]{1,40}$/.test(id))
    throw new Error('Invalid creation ID.');
  if (creations.size >= 16 && !creations.has(id))
    throw new Error(
      'This session already has 16 creations. Save/export and reload to continue.',
    );
  creations.set(id, recipe);
  registerVisualizer({
    metadata: recipeMetadata(id, recipe),
    create: (bus) => new RecipeVisualizer(id, recipe, bus),
  });
  return { type: id, recipe };
}
export function creationEntries() {
  return [...creations].map(([type, recipe]) => ({
    type,
    recipe: structuredClone(recipe),
  }));
}
export function saveCreation(type: string) {
  const recipe = creations.get(type);
  if (!recipe) throw new Error('Creation not found.');
  const saved = readSaved();
  saved[type] = recipe;
  localStorage.setItem('cybernoetica:studio:recipes:v1', JSON.stringify(saved));
}
function readSaved(): Record<string, VisualizerRecipe> {
  try {
    const raw = localStorage.getItem('cybernoetica:studio:recipes:v1') ?? '{}';
    if (raw.length > 150000) return {};
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    const saved: Record<string, VisualizerRecipe> = {};
    for (const [id, recipe] of Object.entries(value).slice(0, 16)) {
      if (!/^studio-[a-z0-9-]{1,40}$/.test(id)) continue;
      try {
        saved[id] = parseRecipe(recipe);
      } catch {
        /* Skip invalid entries. */
      }
    }
    return saved;
  } catch {
    return {};
  }
}
export function restoreCreations() {
  const saved = readSaved();
  if (!saved || typeof saved !== 'object') return;
  for (const [id, recipe] of Object.entries(saved).slice(0, 16))
    try {
      registerRecipe(recipe, id);
    } catch {
      /* ignore invalid saved creations */
    }
}
