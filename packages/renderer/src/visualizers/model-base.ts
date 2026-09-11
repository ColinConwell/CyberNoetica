import { Group } from 'three';
import type { Scene, Mesh, Material } from 'three';
import type {
  AudioFeatures,
  MessageBus,
  Unsubscribe,
} from '@cybernoetica/core';
import { EMASmoothing, EventEnvelope } from '../smoothing.js';
import { frameDelta, takeAudioFrame } from '../timing.js';
import type {
  Visualizer,
  VisualizerMetadata,
  VisualizerParam,
} from './types.js';
export const MODEL_PARAMS: VisualizerParam[] = [
  {
    key: 'brightness',
    label: 'Brightness',
    min: 0.2,
    max: 2,
    step: 0.05,
    initial: 1,
    category: 'appearance',
  },
  {
    key: 'motion',
    label: 'Motion speed',
    min: 0,
    max: 0.5,
    step: 0.01,
    initial: 0.08,
    category: 'appearance',
  },
  {
    key: 'bassResponse',
    label: 'Bass → Deformation',
    min: 0,
    max: 1,
    step: 0.05,
    initial: 0.5,
    category: 'audio-mapping',
  },
  {
    key: 'rmsResponse',
    label: 'RMS → Light',
    min: 0,
    max: 2,
    step: 0.1,
    initial: 1,
    category: 'audio-mapping',
  },
  {
    key: 'centroidResponse',
    label: 'Centroid → Color',
    min: 0,
    max: 1,
    step: 0.05,
    initial: 0.5,
    category: 'audio-mapping',
  },
];
export const MODEL_VIEW_2D = [
  { key: 'centerX', label: 'Center X', min: -3, max: 3, step: 0.01 },
  { key: 'centerY', label: 'Center Y', min: -3, max: 3, step: 0.01 },
  { key: 'zoom', label: 'Zoom', min: 0.2, max: 4, step: 0.05 },
];
export const MODEL_VIEW_3D = [
  {
    key: 'orbitAngle',
    label: 'Orbit angle',
    min: -Math.PI,
    max: Math.PI,
    step: 0.01,
  },
  { key: 'elevation', label: 'Elevation', min: -1.5, max: 1.5, step: 0.01 },
  { key: 'distance', label: 'Distance', min: 4, max: 30, step: 0.1 },
];
export abstract class ModelVisualizer implements Visualizer {
  protected root = new Group();
  protected params: Record<string, number>;
  protected view: Record<string, number> = {
    centerX: 0,
    centerY: 0,
    zoom: 1,
    orbitAngle: 0,
    elevation: 0.3,
    distance: 6,
  };
  protected audio: Record<string, number> = {
    bass: 0,
    mid: 0,
    high: 0,
    rms: 0,
    spectralCentroid: 0,
    stereoPhase: 0,
  };
  protected features: AudioFeatures | null = null;
  protected time = 0;
  protected phase = 0;
  protected beat = 0;
  protected width = 1920;
  protected height = 1080;
  private smooth = Object.fromEntries(
    Object.keys(this.audio).map((key) => [key, new EMASmoothing(0.04)]),
  );
  private pulse = new EventEnvelope();
  private unsub: Unsubscribe;
  private attached = false;
  constructor(
    readonly metadata: VisualizerMetadata,
    bus: MessageBus,
  ) {
    this.params = Object.fromEntries(
      metadata.params.map((p) => [p.key, p.initial]),
    );
    this.unsub = bus.subscribe<AudioFeatures>('audio:features', (msg) => {
      this.features = { ...msg.payload };
    });
  }
  attach(scene: Scene): void {
    scene.add(this.root);
    this.build();
    this.attached = true;
    this.update(0);
  }
  protected abstract build(): void;
  protected abstract update(dt: number): void;
  tick(deltaSeconds = 1 / 60): void {
    const dt = frameDelta(deltaSeconds);
    this.time += dt;
    this.phase += dt * (this.params.motion ?? 0.08);
    const f = this.features ? takeAudioFrame(this.features) : null;
    for (const key of Object.keys(this.audio))
      this.audio[key] = this.smooth[key].update(
        (f?.[key as keyof AudioFeatures] as number) ?? 0,
        dt,
      );
    this.beat = this.pulse.update(f?.beatOnset ? 1 : 0, dt);
    if (this.attached) this.update(dt);
  }
  setResolution(w: number, h: number): void {
    this.width = w;
    this.height = h;
    if (this.attached) this.update(0);
  }
  setUserParam(key: string, value: number): void {
    const field = this.metadata.params.find((p) => p.key === key);
    if (field && Number.isFinite(value))
      this.params[key] = Math.max(field.min, Math.min(field.max, value));
  }
  getViewState(): Record<string, number> {
    return Object.fromEntries(
      this.metadata.viewStateFields.map((f) => [f.key, this.view[f.key] ?? 0]),
    );
  }
  setViewState(partial: Record<string, number>): void {
    for (const field of this.metadata.viewStateFields) {
      const v = partial[field.key];
      if (!field.readOnly && Number.isFinite(v))
        this.view[field.key] = Math.max(field.min, Math.min(field.max, v));
    }
  }
  dispose(): void {
    this.unsub();
    this.root.removeFromParent();
    const materials = new Set<Material>();
    this.root.traverse((object) => {
      const mesh = object as Mesh;
      if (mesh.geometry) mesh.geometry.dispose();
      if (mesh.material)
        for (const material of Array.isArray(mesh.material)
          ? mesh.material
          : [mesh.material])
          materials.add(material);
    });
    for (const material of materials) material.dispose();
    this.root.clear();
    this.attached = false;
  }
}
