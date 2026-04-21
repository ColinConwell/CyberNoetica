export { SceneManager, pixelRatioForTier } from './scene-manager.js';
export type { CursorMode, QualityTier, FrameGate } from './scene-manager.js';
export { EMASmoothing } from './smoothing.js';

// Registry + manifest API (lazy-loaded visualizers)
export {
  registerVisualizer,
  getVisualizerEntry,
  listVisualizers,
  getVisualizerTypes,
  loadVisualizer,
  isVisualizerLoaded,
  VISUALIZER_MANIFEST,
  getManifestEntry,
  listManifestEntries,
  listManifestTypes,
} from './visualizers/index.js';
export type { VisualizerEntry, VisualizerManifestEntry } from './visualizers/index.js';
export type {
  Visualizer,
  VisualizerMetadata,
  VisualizerParam,
  ViewStateField,
  ViewportCapabilities,
} from './visualizers/index.js';
