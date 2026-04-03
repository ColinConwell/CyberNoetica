// Side-effect imports trigger self-registration
import './orbital.js';
import './waveform.js';
import './julia.js';
import './mandelbrot.js';

// Registry API
export { registerVisualizer, getVisualizerEntry, listVisualizers, getVisualizerTypes } from './registry.js';
export type { VisualizerEntry } from './registry.js';

// Types
export type { Visualizer, VisualizerMetadata, VisualizerParam, ViewportCapabilities } from './types.js';

// Direct class exports (backward compat — prefer registry for new code)
export { MandelbrotVisualizer } from './mandelbrot.js';
export type { MandelbrotUniforms } from './mandelbrot.js';
export { OrbitalVisualizer } from './orbital.js';
export { WaveformVisualizer } from './waveform.js';
export { JuliaVisualizer } from './julia.js';
