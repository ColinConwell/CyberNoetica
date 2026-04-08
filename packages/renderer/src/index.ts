export { SceneManager } from './scene-manager.js';
export type { CursorMode } from './scene-manager.js';
export { EMASmoothing } from './smoothing.js';

// Registry API
export { registerVisualizer, getVisualizerEntry, listVisualizers, getVisualizerTypes } from './visualizers/index.js';
export type { VisualizerEntry } from './visualizers/index.js';
export type { Visualizer, VisualizerMetadata, VisualizerParam, ViewStateField, ViewportCapabilities } from './visualizers/index.js';

// Direct class exports (backward compat)
export { MandelbrotVisualizer } from './visualizers/index.js';
export type { MandelbrotUniforms } from './visualizers/index.js';
export { OrbitalVisualizer } from './visualizers/index.js';
export { WaveformVisualizer } from './visualizers/index.js';
export { JuliaVisualizer } from './visualizers/index.js';
