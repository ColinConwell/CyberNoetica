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
import './harmonograph/index.js';
import './moire/index.js';
import './plasma/index.js';
import './flowfield/index.js';
import './spirograph/index.js';
import './automata/index.js';
import './terrain/index.js';
import './geodesic/index.js';
import './tunnel/index.js';
import './interference/index.js';
import './metaballs/index.js';
import './rosecurve/index.js';
import './newton/index.js';
import './lyapunov/index.js';
import './apollonian/index.js';
import './quatjulia/index.js';

// Registry API
export { registerVisualizer, getVisualizerEntry, listVisualizers, getVisualizerTypes } from './registry.js';
export type { VisualizerEntry } from './registry.js';

// Types
export type { Visualizer, VisualizerMetadata, VisualizerParam, ViewStateField, ViewportCapabilities, VisualizerInteractivity } from './types.js';

// Direct class exports (backward compat -- prefer registry for new code)
export { MandelbrotVisualizer, BurningShipVisualizer } from './mandelbrot/index.js';
export type { MandelbrotUniforms } from './mandelbrot/index.js';
export { OrbitalVisualizer, OrbitalBetaVisualizer, OrbitalGammaVisualizer } from './orbital/index.js';
export { WaveformVisualizer } from './waveform/index.js';
export { JuliaVisualizer } from './julia/index.js';
export { VoronoiVisualizer } from './voronoi/index.js';
export { LissajousVisualizer } from './lissajous/index.js';
export { KaleidoscopeVisualizer } from './kaleidoscope/index.js';
export { ReactionDiffusionVisualizer } from './reaction/index.js';
export { AttractorVisualizer, HopalongVisualizer, DeJongVisualizer } from './attractor/index.js';
export { HyperbolicVisualizer } from './hyperbolic/index.js';
export { ChladniVisualizer, ChladniCircularVisualizer } from './chladni/index.js';
export { PhyllotaxisVisualizer } from './phyllotaxis/index.js';
export { SuperformulaVisualizer } from './superformula/index.js';
export { QuasicrystalVisualizer } from './quasicrystal/index.js';
export { DomainWarpVisualizer, DomainWarpRecursiveVisualizer } from './domainwarp/index.js';
export { TruchetVisualizer } from './truchet/index.js';
export { CliffordVisualizer } from './clifford/index.js';
export { HarmonographVisualizer } from './harmonograph/index.js';
export { MoireVisualizer } from './moire/index.js';
export { PlasmaVisualizer } from './plasma/index.js';
export { FlowFieldVisualizer } from './flowfield/index.js';
export { SpirographVisualizer } from './spirograph/index.js';
export { AutomataVisualizer } from './automata/index.js';
export { TerrainVisualizer } from './terrain/index.js';
export { GeodesicVisualizer } from './geodesic/index.js';
export { TunnelVisualizer } from './tunnel/index.js';
export { InterferenceVisualizer } from './interference/index.js';
export { MetaballsVisualizer } from './metaballs/index.js';
export { RoseCurveVisualizer } from './rosecurve/index.js';
export { NewtonVisualizer } from './newton/index.js';
export { LyapunovVisualizer } from './lyapunov/index.js';
export { ApollonianVisualizer } from './apollonian/index.js';
export { QuatJuliaVisualizer } from './quatjulia/index.js';
