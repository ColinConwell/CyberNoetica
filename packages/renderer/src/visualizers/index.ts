// Side-effect imports trigger self-registration
import './orbital/index.js';
import './waveform/index.js';
import './julia/index.js';
import './mandelbrot/index.js';
import './voronoi/index.js';
import './lissajous/index.js';
import './kaleidoscope/index.js';

// Registry API
export { registerVisualizer, getVisualizerEntry, listVisualizers, getVisualizerTypes } from './registry.js';
export type { VisualizerEntry } from './registry.js';

// Types
export type { Visualizer, VisualizerMetadata, VisualizerParam, ViewStateField, ViewportCapabilities } from './types.js';

// Direct class exports (backward compat -- prefer registry for new code)
export { MandelbrotVisualizer } from './mandelbrot/index.js';
export type { MandelbrotUniforms } from './mandelbrot/index.js';
export { OrbitalVisualizer } from './orbital/index.js';
export { WaveformVisualizer } from './waveform/index.js';
export { JuliaVisualizer } from './julia/index.js';
export { VoronoiVisualizer } from './voronoi/index.js';
export { LissajousVisualizer } from './lissajous/index.js';
export { KaleidoscopeVisualizer } from './kaleidoscope/index.js';
