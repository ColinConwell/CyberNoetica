// Registry API — lazy-loaded. Visualizer modules are NOT imported at module
// eval time; they are dynamically imported on demand via `loadVisualizer`. The
// manifest provides enough metadata (type/label/description) to render a picker
// without loading any visualizer code.
export {
  registerVisualizer,
  getVisualizerEntry,
  listVisualizers,
  getVisualizerTypes,
  loadVisualizer,
  isVisualizerLoaded,
} from './registry.js';
export type { VisualizerEntry } from './registry.js';

// Manifest API — catalog of available visualizers + their loaders.
export {
  VISUALIZER_MANIFEST,
  getManifestEntry,
  listManifestEntries,
  listManifestTypes,
} from './manifest.js';
export type { VisualizerManifestEntry } from './manifest.js';

// Types
export type {
  Visualizer,
  VisualizerMetadata,
  VisualizerParam,
  ViewStateField,
  ViewportCapabilities,
  VisualizerInteractivity,
} from './types.js';
