import * as THREE from 'three';
import { MessageBus } from '@cybernoetica/core';
import type { AudioFeatures } from '@cybernoetica/core';
import { loadVisualizer } from '../visualizers/registry.js';
import type { Visualizer } from '../visualizers/types.js';
import type {
  JourneyLayer,
  JourneyStop,
  SampleFrame,
  TransitionAdapter,
  TransportSolver,
} from './types.js';
import { normalizedWeights } from './definition.js';

interface Slot {
  viz: Visualizer;
  bus: MessageBus;
  scene: THREE.Scene;
  camera: THREE.Camera;
  adapter: TransitionAdapter;
  layer: JourneyLayer;
  map: Uint32Array;
}
export class JourneyEndpoint {
  readonly slots: Slot[] = [];
  readonly positions: Float32Array;
  readonly colors: Float32Array;
  readonly tangents: Float32Array;
  private disposed = false;
  private weights: number[] = [];
  private frames: SampleFrame[] = [];
  private size = { width: 1280, height: 720 };
  private constructor(
    public stop: JourneyStop,
    readonly count: number,
  ) {
    this.positions = new Float32Array(count * 3);
    this.colors = new Float32Array(count * 4);
    this.tangents = new Float32Array(count * 3);
  }
  static async create(
    stop: JourneyStop,
    count: number,
    renderer: THREE.WebGLRenderer | undefined,
    solver: TransportSolver,
    seed: number,
    signal: AbortSignal,
    initialView?: Record<string, number>,
  ): Promise<JourneyEndpoint> {
    const endpoint = new JourneyEndpoint(structuredClone(stop), count);
    const perLayer = Math.max(16, Math.floor(count / stop.layers.length));
    try {
      for (const layer of stop.layers) {
        const entry = await loadVisualizer(layer.type);
        if (signal.aborted) throw new DOMException('Cancelled', 'AbortError');
        if (!entry?.createTransitionAdapter)
          throw new Error(`Journey adapter unavailable for ${layer.type}`);
        // Yield before expensive model initialization; it never runs in a render callback.
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
        if (signal.aborted) throw new DOMException('Cancelled', 'AbortError');
        const bus = new MessageBus(),
          scene = new THREE.Scene(),
          viz = entry.create(bus);
        const camera = viz.metadata.usesPerspective
          ? new THREE.PerspectiveCamera(60, 1280 / 720, 0.1, 100)
          : new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
        const slot: Slot = {
          viz,
          bus,
          scene,
          camera,
          layer: structuredClone(layer),
          adapter: entry.createTransitionAdapter(viz, perLayer),
          map: Uint32Array.from({ length: perLayer }, (_, i) => i),
        };
        endpoint.slots.push(slot);
        if (renderer) viz.setRenderer?.(renderer);
        for (const [key, value] of Object.entries(layer.params))
          viz.setUserParam(key, value);
        viz.setViewState({
          ...layer.view,
          ...(endpoint.slots.length === 1 ? initialView : {}),
        });
        viz.attach(scene);
        endpoint.updateCamera(slot);
        viz.setResolution(1280, 720);
        viz.tick(0);
        if (renderer) renderer.compile(scene, camera);
      }
      endpoint.weights = normalizedWeights(stop.layers.map((l) => l.weight));
      endpoint.update(0, null);
      if (stop.composition === 'blend' && endpoint.slots.length > 1) {
        const reference = endpoint.frames[0].positions.slice();
        for (let i = 1; i < endpoint.slots.length; i++) {
          const map = await solver.solve(
            reference,
            endpoint.frames[i].positions,
            seed + i,
            signal,
          );
          endpoint.slots[i].map = map.indices;
        }
      }
      if (signal.aborted) throw new DOMException('Cancelled', 'AbortError');
      endpoint.update(0, null);
      return endpoint;
    } catch (error) {
      endpoint.dispose();
      throw error;
    }
  }
  private updateCamera(slot: Slot): void {
    if (!(slot.camera instanceof THREE.PerspectiveCamera)) return;
    const view = slot.viz.getViewState(),
      distance = view.distance ?? 12,
      angle = view.orbitAngle ?? 0,
      elevation = view.elevation ?? 0;
    slot.camera.position.set(
      Math.sin(angle) * Math.cos(elevation) * distance,
      Math.sin(elevation) * distance,
      Math.cos(angle) * Math.cos(elevation) * distance,
    );
    slot.camera.lookAt(0, 0, 0);
    slot.camera.updateMatrixWorld(true);
  }
  setStop(stop: JourneyStop): boolean {
    if (
      stop.composition !== this.stop.composition ||
      stop.layers.length !== this.slots.length ||
      stop.layers.some((l, i) => l.type !== this.slots[i].layer.type)
    )
      return false;
    this.stop = structuredClone(stop);
    stop.layers.forEach((layer, i) => {
      const slot = this.slots[i];
      slot.layer = structuredClone(layer);
      for (const [key, value] of Object.entries(layer.params))
        slot.viz.setUserParam(key, value);
      slot.viz.setViewState(layer.view);
    });
    return true;
  }
  update(dt: number, audio: AudioFeatures | null): void {
    if (this.disposed) return;
    this.frames.length = 0;
    for (const slot of this.slots) {
      if (audio) slot.bus.publish('audio:features', audio);
      slot.viz.tick(dt);
      this.updateCamera(slot);
      this.frames.push(slot.adapter.read(slot.camera, dt));
    }
    const target = normalizedWeights(
        this.stop.layers.map((l) => l.weight),
        this.weights,
      ),
      alpha = dt <= 0 ? 1 : 1 - Math.exp(-dt / 0.12);
    this.weights = this.weights.map((w, i) => w + (target[i] - w) * alpha);
    const aspect = this.size.width / Math.max(1, this.size.height);
    for (let i = 0; i < this.count; i++) {
      let x = 0,
        y = 0,
        z = 0,
        r = 0,
        g = 0,
        b = 0,
        a = 0,
        tx = 0,
        ty = 0;
      const blend = this.stop.composition === 'blend';
      const start = blend
        ? 0
        : Math.min(
            this.slots.length - 1,
            Math.floor((i * this.slots.length) / this.count),
          );
      const end = blend ? this.slots.length : start + 1;
      for (let s = start; s < end; s++) {
        const slot = this.slots[s],
          frame = this.frames[s],
          layer = slot.layer;
        const local = blend
          ? Math.floor((i * slot.adapter.count) / this.count)
          : Math.floor(
              ((i * this.slots.length) / this.count - s) * slot.adapter.count,
            );
        const index =
            slot.map[Math.max(0, Math.min(slot.map.length - 1, local))],
          w = blend ? this.weights[s] : 1;
        const co = Math.cos(layer.rotation),
          si = Math.sin(layer.rotation),
          px = frame.positions[index * 3] * layer.scale * aspect,
          py = frame.positions[index * 3 + 1] * layer.scale;
        x += w * ((px * co - py * si) / aspect + layer.x);
        y += w * (px * si + py * co + layer.y);
        z += w * frame.positions[index * 3 + 2];
        r += w * frame.colors[index * 4];
        g += w * frame.colors[index * 4 + 1];
        b += w * frame.colors[index * 4 + 2];
        a += w * frame.colors[index * 4 + 3] * layer.opacity;
        const tangentX = frame.tangents[index * 3] * aspect,
          tangentY = frame.tangents[index * 3 + 1];
        tx += (w * (tangentX * co - tangentY * si)) / aspect;
        ty += w * (tangentX * si + tangentY * co);
      }
      this.positions[i * 3] = x;
      this.positions[i * 3 + 1] = y;
      this.positions[i * 3 + 2] = z;
      this.colors[i * 4] = r;
      this.colors[i * 4 + 1] = g;
      this.colors[i * 4 + 2] = b;
      this.colors[i * 4 + 3] = a;
      this.tangents[i * 3] = tx;
      this.tangents[i * 3 + 1] = ty;
      this.tangents[i * 3 + 2] = 0;
    }
  }
  resize(width: number, height: number): void {
    this.size = { width, height };
    for (const slot of this.slots) {
      slot.viz.setResolution(width, height);
      if (slot.camera instanceof THREE.PerspectiveCamera) {
        slot.camera.aspect = width / Math.max(1, height);
        slot.camera.updateProjectionMatrix();
      }
    }
    this.update(0, null);
  }
  dominant(): {
    type: string;
    view: Record<string, number>;
    params: Record<string, number>;
  } {
    const weights = this.stop.layers.map((l, i) =>
      this.stop.composition === 'blend' ? this.weights[i] : l.opacity,
    );
    let index = 0;
    weights.forEach((w, i) => {
      if (w > weights[index]) index = i;
    });
    const slot = this.slots[index];
    return {
      type: slot.layer.type,
      view: slot.viz.getViewState(),
      params: slot.layer.params,
    };
  }
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const slot of this.slots) {
      slot.adapter.dispose();
      slot.viz.setInteractionContext?.(null);
      slot.viz.dispose();
      slot.scene.clear();
    }
    this.slots.length = 0;
  }
}
