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

export interface ViewportCapabilities {
  pan: boolean;
  zoom: boolean;
  orbit: boolean;
}

export interface VisualizerMetadata {
  type: string;
  label: string;
  description: string;
  usesPerspective: boolean;
  params: VisualizerParam[];
  viewport: ViewportCapabilities;
}

export interface Visualizer {
  readonly metadata: VisualizerMetadata;
  attach(scene: Scene): void;
  tick(): void;
  setResolution(w: number, h: number): void;
  dispose(): void;
  setPan?(x: number, y: number): void;
  setZoom?(z: number): void;
  setUserParam(key: string, value: number): void;
}
