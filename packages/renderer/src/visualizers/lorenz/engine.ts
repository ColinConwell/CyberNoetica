import { SegmentBatch } from '../../geometry/segment-batch.js';
import { frameDelta, takeAudioFrame, PhaseClock } from '../../timing.js';
import * as THREE from 'three';
import { MessageBus } from '@cybernoetica/core';
import type {
  AudioFeatures,
  BusMessage,
  Unsubscribe,
} from '@cybernoetica/core';
import { EMASmoothing, EventEnvelope } from '../../smoothing.js';
import type {
  ViewStateField,
  Visualizer,
  VisualizerMetadata,
  VisualizerParam,
} from '../types.js';

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export const FLOW_VIEW_FIELDS: ViewStateField[] = [
  {
    key: 'orbitAngle',
    label: 'Orbit',
    min: -Math.PI,
    max: Math.PI,
    step: 0.02,
  },
  { key: 'elevation', label: 'Elevation', min: -1.2, max: 1.2, step: 0.02 },
  { key: 'distance', label: 'Distance', min: 4, max: 24, step: 0.1 },
];

export const FLOW_VIEWPORT = { pan: false, zoom: true, orbit: true } as const;

export const FLOW_SHARED_PARAMS: VisualizerParam[] = [
  {
    key: 'trailLength',
    label: 'Trail Length',
    min: 64,
    max: 512,
    step: 16,
    initial: 384,
    category: 'appearance',
    description: 'Points kept along each orbit',
  },
  {
    key: 'brightness',
    label: 'Brightness',
    min: 0.3,
    max: 3.0,
    step: 0.1,
    initial: 1.2,
    category: 'appearance',
  },
  {
    key: 'hueShift',
    label: 'Hue Shift',
    min: 0.0,
    max: 1.0,
    step: 0.01,
    initial: 0.0,
    category: 'appearance',
  },
  {
    key: 'integrationSpeed',
    label: 'Flow Speed',
    min: 0.2,
    max: 2.5,
    step: 0.05,
    initial: 1.0,
    category: 'appearance',
    description: 'RK4 integration rate',
  },
  {
    key: 'bassToDrive',
    label: 'Bass → Drive',
    min: 0.0,
    max: 2.0,
    step: 0.1,
    initial: 1.0,
    category: 'audio-mapping',
    description: 'Bass modulates the primary ODE coefficient',
  },
  {
    key: 'midToSpeed',
    label: 'Mid → Speed',
    min: 0.0,
    max: 2.0,
    step: 0.1,
    initial: 1.0,
    category: 'audio-mapping',
    description: 'Mids accelerate the flow',
  },
  {
    key: 'highToSpread',
    label: 'High → Spread',
    min: 0.0,
    max: 2.0,
    step: 0.1,
    initial: 1.0,
    category: 'audio-mapping',
    description: 'Highs widen per-trail hue spread',
  },
  {
    key: 'rmsToGlow',
    label: 'RMS → Glow',
    min: 0.0,
    max: 2.0,
    step: 0.1,
    initial: 1.0,
    category: 'audio-mapping',
    description: 'Volume drives trail brightness',
  },
  {
    key: 'beatToKick',
    label: 'Beat → Kick',
    min: 0.0,
    max: 2.0,
    step: 0.1,
    initial: 1.0,
    category: 'audio-mapping',
    description: 'Beats kick integration speed and jitter seeds',
  },
  {
    key: 'centroidToHue',
    label: 'Centroid → Hue',
    min: 0.0,
    max: 2.0,
    step: 0.1,
    initial: 1.0,
    category: 'audio-mapping',
    description: 'Spectral centroid shifts the palette',
  },
];

export interface FlowConfig {
  metadata: VisualizerMetadata;
  defaultParams: Record<string, number>;
  derivs: (p: Vec3, params: Record<string, number>) => Vec3;
  origin: Vec3;
  scale: number;
  dt: number;
  driveParam: string;
  driveScale: number;
  seed: Vec3;
  trailCount?: number;
  maxPoints?: number;
  stepsPerFrame?: number;
  warmupSteps?: number;
  orbitAngle?: number;
  elevation?: number;
  distance?: number;
  hueOffset?: number;
  bound?: number;
}

const DEFAULT_TRAIL_COUNT = 32;
const DEFAULT_MAX_POINTS = 512;
const DEFAULT_STEPS = 4;
const DEFAULT_WARMUP = 2500;

function hsv2rgb(h: number, s: number, v: number): [number, number, number] {
  const i = Math.floor(h * 6);
  const f = h * 6 - i;
  const p = v * (1 - s);
  const q = v * (1 - f * s);
  const t = v * (1 - (1 - f) * s);
  switch (i % 6) {
    case 0:
      return [v, t, p];
    case 1:
      return [q, v, p];
    case 2:
      return [p, v, t];
    case 3:
      return [p, q, v];
    case 4:
      return [t, p, v];
    default:
      return [v, p, q];
  }
}

function hash01(n: number): number {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
}

function isFiniteVec(p: Vec3): boolean {
  return Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.z);
}

function vecLen(p: Vec3): number {
  return Math.sqrt(p.x * p.x + p.y * p.y + p.z * p.z);
}

export class FlowVisualizer implements Visualizer {
  private deltaSeconds = 1 / 60;
  private phases = new PhaseClock();
  readonly metadata: VisualizerMetadata;

  private unsub: Unsubscribe;
  private latestFeatures: AudioFeatures | null = null;
  private time = 0;
  private pendingSteps = 0;

  private userParams: Record<string, number>;
  private readonly config: FlowConfig;
  private readonly trailCount: number;
  private readonly maxPoints: number;
  private readonly stepsPerFrame: number;
  private readonly warmupSteps: number;
  private readonly bound: number;
  private readonly hueOffset: number;

  private _orbitAngle: number;
  private _elevation: number;
  private _distance: number;

  private smoothers = {
    bass: new EMASmoothing(0.12),
    mid: new EMASmoothing(0.18),
    high: new EMASmoothing(0.25),
    rms: new EMASmoothing(0.15),
    spectralCentroid: new EMASmoothing(0.1),
    beatPulse: new EventEnvelope(),
  };

  private orbits: Vec3[] = [];
  private history: Float32Array[] = [];
  private writeHeads: number[] = [];
  private filled: number[] = [];

  private batch: SegmentBatch | null = null;
  private positions: Float32Array[] = [];
  private colors: Float32Array[] = [];

  private k1: Vec3 = { x: 0, y: 0, z: 0 };
  private k2: Vec3 = { x: 0, y: 0, z: 0 };
  private k3: Vec3 = { x: 0, y: 0, z: 0 };
  private k4: Vec3 = { x: 0, y: 0, z: 0 };
  private tmp: Vec3 = { x: 0, y: 0, z: 0 };

  constructor(
    config: FlowConfig,
    private bus: MessageBus,
  ) {
    this.config = config;
    this.metadata = config.metadata;
    this.userParams = { ...config.defaultParams };
    this.trailCount = config.trailCount ?? DEFAULT_TRAIL_COUNT;
    this.maxPoints = config.maxPoints ?? DEFAULT_MAX_POINTS;
    this.stepsPerFrame = config.stepsPerFrame ?? DEFAULT_STEPS;
    this.warmupSteps = config.warmupSteps ?? DEFAULT_WARMUP;
    this.bound = config.bound ?? 200;
    this.hueOffset = config.hueOffset ?? 0;

    this._orbitAngle = config.orbitAngle ?? 0.4;
    this._elevation = config.elevation ?? 0.35;
    this._distance = config.distance ?? 12;

    this.unsub = bus.subscribe(
      'audio:features',
      (msg: BusMessage<AudioFeatures>) => {
        this.latestFeatures = { ...msg.payload };
      },
    );

    this.smoothers.bass.reset(0);
    this.smoothers.mid.reset(0);
    this.smoothers.high.reset(0);
    this.smoothers.rms.reset(0.1);
    this.smoothers.spectralCentroid.reset(0.5);
    this.smoothers.beatPulse.reset(0);

    for (let t = 0; t < this.trailCount; t++) {
      this.orbits.push({ x: 0, y: 0, z: 0 });
      this.history.push(new Float32Array(this.maxPoints * 3));
      this.writeHeads.push(0);
      this.filled.push(0);
      this.seedOrbit(t);
      this.warmupOrbit(t, this.userParams);
      this.fillHistory(t, this.userParams);
    }
  }

  attach(scene: THREE.Scene): void {
    this.batch = new SegmentBatch(this.trailCount * (this.maxPoints - 1));
    this.batch.material.linewidth = 1.5;
    scene.add(this.batch.object);
    for (let trail = 0; trail < this.trailCount; trail++) {
      this.positions.push(new Float32Array(this.maxPoints * 3));
      this.colors.push(new Float32Array(this.maxPoints * 3));
    }
    this.uploadTrails();
  }

  tick(deltaSeconds = 1 / 60): void {
    this.deltaSeconds = frameDelta(deltaSeconds);
    this.time += this.deltaSeconds;

    if (this.latestFeatures) {
      const f = takeAudioFrame(this.latestFeatures);
      this.smoothers.bass.update(f.bass, this.deltaSeconds);
      this.smoothers.mid.update(f.mid, this.deltaSeconds);
      this.smoothers.high.update(f.high, this.deltaSeconds);
      this.smoothers.rms.update(f.rms, this.deltaSeconds);
      this.smoothers.spectralCentroid.update(
        f.spectralCentroid,
        this.deltaSeconds,
      );
      this.smoothers.beatPulse.update(
        f.beatOnset ? 1.0 : 0.0,
        this.deltaSeconds,
      );
    } else {
      this.smoothers.beatPulse.update(0.0, this.deltaSeconds);
    }

    const bass = this.smoothers.bass.value;
    const mid = this.smoothers.mid.value;
    const high = this.smoothers.high.value;
    const rms = this.smoothers.rms.value;
    const centroid = this.smoothers.spectralCentroid.value;
    const beat = this.smoothers.beatPulse.value;

    const effective: Record<string, number> = { ...this.userParams };
    const driveKey = this.config.driveParam;
    if (driveKey in effective) {
      effective[driveKey] =
        this.userParams[driveKey] +
        bass * this.config.driveScale * this.userParams.bassToDrive;
    }

    const driveDefinition = this.metadata.params.find(
      (param) => param.key === driveKey,
    );
    if (driveDefinition)
      effective[driveKey] = Math.max(
        driveDefinition.min,
        Math.min(driveDefinition.max, effective[driveKey]),
      );

    const beatKick = beat * 0.8 * this.userParams.beatToKick;
    const speed =
      this.userParams.integrationSpeed *
      (0.45 + mid * 0.9 * this.userParams.midToSpeed) *
      (1.0 + beatKick);
    // Speed changes simulated time, never the stability of an RK4 substep.
    this.pendingSteps += Math.min(
      72,
      this.stepsPerFrame * speed * this.deltaSeconds * 60,
    );
    const steps = Math.floor(this.pendingSteps + 1e-9);
    this.pendingSteps = Math.max(0, this.pendingSteps - steps);
    const dt = this.config.dt;

    for (let t = 0; t < this.trailCount; t++) {
      for (let s = 0; s < steps; s++) {
        this.rk4(this.orbits[t], dt, effective);
        if (
          !isFiniteVec(this.orbits[t]) ||
          vecLen(this.orbits[t]) > this.bound
        ) {
          this.seedOrbit(t);
          this.warmupOrbit(t, effective);
        }
        this.recordPoint(t);
      }
    }

    if (this.batch) {
      const glow =
        (0.55 + rms * 0.9 * this.userParams.rmsToGlow) *
        this.userParams.brightness;
      this.batch.material.color.setScalar(glow);
      this.batch.material.linewidth = 1.25 + high * 0.75 + beat * 0.25;
      this.uploadTrails(high, centroid);
    }
  }

  setResolution(w: number, h: number): void {
    this.batch?.setResolution(w, h);
  }

  setUserParam(key: string, value: number): void {
    if (key in this.userParams) this.userParams[key] = value;
  }

  getViewState(): Record<string, number> {
    return {
      orbitAngle: this._orbitAngle,
      elevation: this._elevation,
      distance: this._distance,
    };
  }

  setViewState(partial: Record<string, number>): void {
    if ('orbitAngle' in partial) this._orbitAngle = partial.orbitAngle;
    if ('elevation' in partial)
      this._elevation = Math.max(-1.2, Math.min(1.2, partial.elevation));
    if ('distance' in partial)
      this._distance = Math.max(4, Math.min(24, partial.distance));
  }

  dispose(): void {
    this.unsub();
    this.batch?.dispose();
    this.batch = null;
    this.positions = [];
    this.colors = [];
  }

  private seedOrbit(t: number): void {
    const seed = this.config.seed;
    const sign = hash01(t + 91) > 0.5 ? 1 : -1;
    this.orbits[t].x = seed.x * sign + (hash01(t + 1) - 0.5) * 0.5;
    this.orbits[t].y = seed.y + (hash01(t + 19) - 0.5) * 0.5;
    this.orbits[t].z = seed.z + (hash01(t + 37) - 0.5) * 0.8;
    this.writeHeads[t] = 0;
    this.filled[t] = 0;
  }

  private warmupOrbit(t: number, params: Record<string, number>): void {
    const p = this.orbits[t];
    for (let i = 0; i < this.warmupSteps; i++) {
      this.rk4(p, this.config.dt, params);
      if (!isFiniteVec(p) || vecLen(p) > this.bound) {
        const seed = this.config.seed;
        p.x = seed.x + (hash01(t + i + 3) - 0.5) * 0.3;
        p.y = seed.y + (hash01(t + i + 11) - 0.5) * 0.3;
        p.z = seed.z + (hash01(t + i + 23) - 0.5) * 0.3;
      }
    }
  }

  private fillHistory(t: number, params: Record<string, number>): void {
    for (let i = 0; i < this.maxPoints; i++) {
      this.rk4(this.orbits[t], this.config.dt, params);
      this.recordPoint(t);
    }
  }

  private recordPoint(t: number): void {
    const p = this.orbits[t];
    const origin = this.config.origin;
    const scale = this.config.scale;
    // Map ODE (x, y, z) → world (x, z, y) so the Lorenz butterfly faces the camera.
    const wx = (p.x - origin.x) * scale;
    const wy = (p.z - origin.z) * scale;
    const wz = (p.y - origin.y) * scale;
    const head = this.writeHeads[t];
    const hist = this.history[t];
    hist[head * 3] = wx;
    hist[head * 3 + 1] = wy;
    hist[head * 3 + 2] = wz;
    this.writeHeads[t] = (head + 1) % this.maxPoints;
    if (this.filled[t] < this.maxPoints) this.filled[t]++;
  }

  private rk4(p: Vec3, dt: number, params: Record<string, number>): void {
    const derivs = this.config.derivs;
    const d1 = derivs(p, params);
    this.k1.x = d1.x;
    this.k1.y = d1.y;
    this.k1.z = d1.z;

    this.tmp.x = p.x + this.k1.x * dt * 0.5;
    this.tmp.y = p.y + this.k1.y * dt * 0.5;
    this.tmp.z = p.z + this.k1.z * dt * 0.5;
    const d2 = derivs(this.tmp, params);
    this.k2.x = d2.x;
    this.k2.y = d2.y;
    this.k2.z = d2.z;

    this.tmp.x = p.x + this.k2.x * dt * 0.5;
    this.tmp.y = p.y + this.k2.y * dt * 0.5;
    this.tmp.z = p.z + this.k2.z * dt * 0.5;
    const d3 = derivs(this.tmp, params);
    this.k3.x = d3.x;
    this.k3.y = d3.y;
    this.k3.z = d3.z;

    this.tmp.x = p.x + this.k3.x * dt;
    this.tmp.y = p.y + this.k3.y * dt;
    this.tmp.z = p.z + this.k3.z * dt;
    const d4 = derivs(this.tmp, params);
    this.k4.x = d4.x;
    this.k4.y = d4.y;
    this.k4.z = d4.z;

    const sixth = dt / 6;
    p.x += (this.k1.x + 2 * this.k2.x + 2 * this.k3.x + this.k4.x) * sixth;
    p.y += (this.k1.y + 2 * this.k2.y + 2 * this.k3.y + this.k4.y) * sixth;
    p.z += (this.k1.z + 2 * this.k2.z + 2 * this.k3.z + this.k4.z) * sixth;
  }

  private uploadTrails(high = 0, centroid = 0.5): void {
    if (this.positions.length === 0 || !this.batch) return;
    let segmentCount = 0;

    const trailLength = Math.max(
      8,
      Math.min(this.maxPoints, Math.round(this.userParams.trailLength)),
    );
    const hueBase =
      this.hueOffset +
      this.userParams.hueShift +
      centroid * 0.18 * this.userParams.centroidToHue +
      this.time * 0.015;
    const spread = 0.08 + high * 0.22 * this.userParams.highToSpread;
    const brightness = this.userParams.brightness;

    for (let t = 0; t < this.trailCount; t++) {
      const n = Math.min(trailLength, this.filled[t]);
      const hist = this.history[t];
      const pos = this.positions[t];
      const col = this.colors[t];
      const oldest = (this.writeHeads[t] - n + this.maxPoints) % this.maxPoints;
      const trailHue = hueBase + (t / this.trailCount) * spread;

      for (let i = 0; i < n; i++) {
        const src = (oldest + i) % this.maxPoints;
        const x = hist[src * 3];
        const y = hist[src * 3 + 1];
        const z = hist[src * 3 + 2];
        pos[i * 3] = x;
        pos[i * 3 + 1] = y;
        pos[i * 3 + 2] = z;

        const fade = 0.18 + 0.82 * (i / Math.max(1, n - 1));
        const heightHue = (y * 0.12 + 0.5) * 0.35;
        const hue = (((trailHue + heightHue) % 1) + 1) % 1;
        const [r, g, b] = hsv2rgb(hue, 0.62, fade * brightness);
        col[i * 3] = r;
        col[i * 3 + 1] = g;
        col[i * 3 + 2] = b;
      }

      for (let i = 1; i < n; i++) {
        const offset = segmentCount++ * 6;
        this.batch.positions.set(
          pos.subarray((i - 1) * 3, (i + 1) * 3),
          offset,
        );
        this.batch.colors.set(col.subarray((i - 1) * 3, (i + 1) * 3), offset);
      }
    }
    this.batch.upload(segmentCount);
  }
}
