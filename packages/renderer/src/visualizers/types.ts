import type { Scene } from 'three';

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
  tick(): void;
  setResolution(w: number, h: number): void;
  dispose(): void;
  setUserParam(key: string, value: number): void;
  getViewState(): Record<string, number>;
  setViewState(partial: Record<string, number>): void;
}
