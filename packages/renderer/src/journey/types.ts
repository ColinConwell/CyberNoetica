import type { Camera, Matrix4, Object3D } from 'three';

export const JOURNEY_TYPES = [
  'orbital',
  'lissajous',
  'harmonograph',
  'spirograph',
  'rosecurve',
  'lorenz',
  'lorenz-beta',
  'lorenz-gamma',
  'torusknot',
  'geodesic-beta',
] as const;
export type ComponentKind = 'particles' | 'curves' | 'surface';
/** Borrowed live buffers. Never transfer or mutate these from an adapter. */
export interface ComponentFrame {
  id: string;
  kind: ComponentKind;
  revision: string | number;
  count: number;
  positions: ArrayLike<number>;
  colors?: ArrayLike<number>;
  indices?: ArrayLike<number>;
  object?: Object3D;
  transform?: Matrix4;
  opacity?: number;
  /** Evaluate the actual vertex deformation used by the native shader. */
  vertex?: (index: number, out: Float32Array) => void;
  visible?: (index: number) => boolean;
  sampleAlpha?: (index: number) => number;
}
export interface ComponentSource {
  getTransitionComponents(): ComponentFrame[];
}
export interface SampleFrame {
  positions: Float32Array;
  colors: Float32Array;
  tangents: Float32Array;
  ids: Uint32Array;
  revision: string;
  bounds: { min: [number, number, number]; max: [number, number, number] };
}
export interface TransitionAdapter {
  readonly count: number;
  read(camera: Camera, deltaSeconds?: number): SampleFrame;
  dispose(): void;
}
export interface TransportMap {
  indices: Uint32Array;
  cost: number;
  baselineCost: number;
  residual: number;
  backend: 'projection' | 'sparse-sinkhorn';
  milliseconds: number;
}
export interface TransportSolver {
  solve(
    source: Float32Array,
    target: Float32Array,
    seed: number,
    signal?: AbortSignal,
  ): Promise<TransportMap>;
  dispose(): void;
}
export interface JourneyLayer {
  id: string;
  type: string;
  params: Record<string, number>;
  view: Record<string, number>;
  weight: number;
  opacity: number;
  x: number;
  y: number;
  scale: number;
  rotation: number;
}
export interface JourneyStop {
  id: string;
  hold: number;
  transition: number;
  composition: 'layers' | 'blend';
  layers: JourneyLayer[];
}
export interface GuidanceMapping {
  id: string;
  source: string;
  target: 'swirl' | 'spread' | 'light';
  amount: number;
  smoothing: number;
  min: number;
  max: number;
  invert: boolean;
}
export interface SignalProvider {
  readonly id: string;
  readonly signals: ReadonlyArray<{
    key: string;
    label: string;
    min: number;
    max: number;
  }>;
  sample(time: number): Readonly<Record<string, number>>;
}
export interface JourneyDefinition {
  version: 1;
  seed: number;
  style: 'character' | 'unified';
  loop: boolean;
  timing: 'seconds' | 'onset' | 'beats' | 'cues';
  bpm: number;
  beatOffset: number;
  cues: number[];
  stops: JourneyStop[];
  guidance: GuidanceMapping[];
}
export interface JourneyState {
  mode: 'individual' | 'journey';
  phase: 'preparing' | 'holding' | 'transitioning' | 'paused' | 'error';
  index: number;
  nextIndex: number;
  progress: number;
  elapsed: number;
  error: string | null;
  preparationMs: number;
  solver: TransportMap['backend'];
  fallbacks: number;
  solverJobs: number;
  sampleCount: number;
}
