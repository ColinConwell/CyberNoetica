import type { PerspectiveCamera, Scene, WebGLRenderer } from 'three';

export interface VisualizerParam {
  key: string;
  label: string;
  min: number;
  max: number;
  step: number;
  initial: number;
  category?: 'appearance' | 'audio-mapping';
  description?: string;
}

export interface ViewStateField {
  key: string;
  label: string;
  min: number;
  max: number;
  step: number;
  readOnly?: boolean;
}

export interface ViewportCapabilities {
  pan: boolean;
  zoom: boolean;
  orbit: boolean;
}

export interface VisualizerInteractivity {
  description: string;
  toggleParam?: string;
}

export type VisualizerCursorMode = 'pan' | 'orbit' | 'sculpt' | 'default';
export type VisualizerAudioInput =
  | 'waveform'
  | 'pitch'
  | 'stereo'
  | 'fft'
  | 'bands'
  | 'rms'
  | 'spectral-centroid'
  | 'spectral-flux'
  | 'beat';
export type VisualizerPerfTier = 'low' | 'medium' | 'high' | 'extreme';

export interface VisualizerReference {
  label: string;
  url: string;
}

export interface VisualizerDocumentation {
  modelClass?: 'mathematical' | 'simulation' | 'artistic';
  summary: string;
  math?: string;
  references: VisualizerReference[];
  audioInputsUsed: VisualizerAudioInput[];
  requiresFFT: boolean;
  perfTier: VisualizerPerfTier;
  mobileSafe: boolean;
}

export interface VisualizerInteractionContext {
  canvas: HTMLCanvasElement;
  getPerspectiveCamera: () => PerspectiveCamera;
}

export interface VisualizerMetadata {
  type: string;
  label: string;
  description: string;
  usesPerspective: boolean;
  params: VisualizerParam[];
  viewport: ViewportCapabilities;
  viewStateFields: ViewStateField[];
  interactivity?: VisualizerInteractivity;
}

export interface Visualizer {
  readonly metadata: VisualizerMetadata;
  attach(scene: Scene): void;
  /** Elapsed presentation time in seconds; default supports deterministic probes. */
  tick(deltaSeconds?: number): void;
  setResolution(w: number, h: number): void;
  dispose(): void;
  setUserParam(key: string, value: number): void;
  getViewState(): Record<string, number>;
  setViewState(partial: Record<string, number>): void;
  setRenderer?(renderer: WebGLRenderer): void;
  setInteractionContext?(context: VisualizerInteractionContext | null): void;
  getCursorMode?(): VisualizerCursorMode;
}
