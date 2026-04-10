// Side-effect imports trigger self-registration
import './orbital/index.js';
import './waveform/index.js';
import './julia/index.js';
import './mandelbrot/index.js';
import './voronoi/index.js';
import './lissajous/index.js';
import './kaleidoscope/index.js';
import './reaction/index.js';
import './attractor/index.js';
import './hyperbolic/index.js';
import './chladni/index.js';
import './phyllotaxis/index.js';
import './superformula/index.js';
import './quasicrystal/index.js';
import './domainwarp/index.js';
import './truchet/index.js';
import './clifford/index.js';

// Registry API
export { registerVisualizer, getVisualizerEntry, listVisualizers, getVisualizerTypes } from './registry.js';
export type { VisualizerEntry } from './registry.js';

// Types
export type { Visualizer, VisualizerMetadata, VisualizerParam, ViewStateField, ViewportCapabilities, VisualizerInteractivity } from './types.js';

// Direct class exports (backward compat -- prefer registry for new code)
export { MandelbrotVisualizer } from './mandelbrot/index.js';
export type { MandelbrotUniforms } from './mandelbrot/index.js';
export { OrbitalVisualizer, OrbitalBetaVisualizer, OrbitalGammaVisualizer } from './orbital/index.js';
export { WaveformVisualizer } from './waveform/index.js';
export { JuliaVisualizer } from './julia/index.js';
export { VoronoiVisualizer } from './voronoi/index.js';
export { LissajousVisualizer } from './lissajous/index.js';
export { KaleidoscopeVisualizer } from './kaleidoscope/index.js';
export { ReactionDiffusionVisualizer } from './reaction/index.js';
export { AttractorVisualizer } from './attractor/index.js';
export { HyperbolicVisualizer } from './hyperbolic/index.js';
export { ChladniVisualizer } from './chladni/index.js';
export { PhyllotaxisVisualizer } from './phyllotaxis/index.js';
export { SuperformulaVisualizer } from './superformula/index.js';
export { QuasicrystalVisualizer } from './quasicrystal/index.js';
export { DomainWarpVisualizer } from './domainwarp/index.js';
export { TruchetVisualizer } from './truchet/index.js';
export { CliffordVisualizer } from './clifford/index.js';
