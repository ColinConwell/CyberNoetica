/**
 * Visualizer manifest — the catalog of available visualizers with a lazy loader
 * per entry. Importing this file does NOT evaluate any visualizer module; each
 * viz is only loaded (parsed, registered) when its loader runs.
 *
 * Keep the minimum metadata here that the picker UI needs synchronously
 * (type, label, short description). Full metadata — param definitions, viewport
 * caps, viewStateFields — lives inside each visualizer file and is available
 * on the registry entry once the module has been loaded.
 */

import type { VisualizerDocumentation } from './types.js';
import { VISUALIZER_DOCUMENTATION } from './documentation.js';

export interface VisualizerManifestEntry {
  type: string;
  label: string;
  description: string;
  group: 'fractal' | '3d' | 'pattern' | 'particle' | 'wave';
  documentation: VisualizerDocumentation;
  loader: () => Promise<unknown>;
}

const MANIFEST_ENTRIES: Omit<VisualizerManifestEntry, 'documentation'>[] = [
  // --- Particle / 3D ---
  { type: 'orbital', label: 'Orbital', description: 'Audio-reactive particle orbitals', group: 'particle',
    loader: () => import('./orbital/v01-alpha.js') },
  { type: 'orbital-beta', label: 'Orbital (β)', description: 'Orbital with extended shading', group: 'particle',
    loader: () => import('./orbital/v02-beta.js') },
  { type: 'orbital-gamma', label: 'Cosmic Sculpt', description: 'Interactive force-field sculpting', group: 'particle',
    loader: () => import('./orbital/v03-gamma.js') },

  // --- Waveform / spectral ---
  { type: 'waveform', label: 'Waveform', description: 'Direct spectrum + time-domain display', group: 'wave',
    loader: () => import('./waveform/v01-alpha.js') },

  // --- Fractals ---
  { type: 'mandelbrot', label: 'Mandelbrot', description: 'Deep zoom into infinite fractal edges', group: 'fractal',
    loader: () => import('./mandelbrot/v01-alpha.js') },
  { type: 'burningship', label: 'Burning Ship', description: 'Mandelbrot variant with asymmetric fractal', group: 'fractal',
    loader: () => import('./mandelbrot/v02-beta.js') },
  { type: 'julia', label: 'Julia', description: 'Julia-set fractal with animated seed', group: 'fractal',
    loader: () => import('./julia/v01-alpha.js') },
  { type: 'newton', label: 'Newton', description: 'Newton-Raphson basins', group: 'fractal',
    loader: () => import('./newton/v01-alpha.js') },
  { type: 'lyapunov', label: 'Lyapunov', description: 'Bifurcation landscape', group: 'fractal',
    loader: () => import('./lyapunov/v01-alpha.js') },
  { type: 'apollonian', label: 'Apollonian', description: 'Recursive circle packing', group: 'fractal',
    loader: () => import('./apollonian/v01-alpha.js') },
  { type: 'quatjulia', label: 'Quaternion Julia', description: '3D raymarched Julia set', group: 'fractal',
    loader: () => import('./quatjulia/v01-alpha.js') },

  // --- Pattern ---
  { type: 'voronoi', label: 'Voronoi', description: 'Dynamic cellular tessellation', group: 'pattern',
    loader: () => import('./voronoi/v01-alpha.js') },
  { type: 'lissajous', label: 'Lissajous', description: 'Harmonic curve traces', group: 'pattern',
    loader: () => import('./lissajous/v01-alpha.js') },
  { type: 'kaleidoscope', label: 'Kaleidoscope', description: 'Symmetric radial patterning', group: 'pattern',
    loader: () => import('./kaleidoscope/v01-alpha.js') },
  { type: 'hyperbolic', label: 'Hyperbolic', description: 'Poincaré disk tiling', group: 'pattern',
    loader: () => import('./hyperbolic/v01-alpha.js') },
  { type: 'chladni', label: 'Chladni', description: 'Cymatic plate patterns', group: 'pattern',
    loader: () => import('./chladni/v01-alpha.js') },
  { type: 'chladni-circular', label: 'Chladni (Circular)', description: 'Chladni on circular membrane', group: 'pattern',
    loader: () => import('./chladni/v02-beta.js') },
  { type: 'phyllotaxis', label: 'Phyllotaxis', description: 'Sunflower-spiral growth', group: 'pattern',
    loader: () => import('./phyllotaxis/v01-alpha.js') },
  { type: 'superformula', label: 'Superformula', description: 'Parametric radial shapes', group: 'pattern',
    loader: () => import('./superformula/v01-alpha.js') },
  { type: 'quasicrystal', label: 'Quasicrystal', description: 'Aperiodic interference patterns', group: 'pattern',
    loader: () => import('./quasicrystal/v01-alpha.js') },
  { type: 'domainwarp', label: 'Domain Warp', description: 'FBM domain distortion', group: 'pattern',
    loader: () => import('./domainwarp/v01-alpha.js') },
  { type: 'domainwarp-recursive', label: 'Domain Warp (Recursive)', description: 'Recursive domain warp', group: 'pattern',
    loader: () => import('./domainwarp/v02-beta.js') },
  { type: 'truchet', label: 'Truchet', description: 'Random tile patterning', group: 'pattern',
    loader: () => import('./truchet/v01-alpha.js') },
  { type: 'clifford', label: 'Clifford', description: 'Clifford strange attractor', group: 'pattern',
    loader: () => import('./clifford/v01-alpha.js') },
  { type: 'harmonograph', label: 'Harmonograph', description: 'Damped pendulum traces', group: 'pattern',
    loader: () => import('./harmonograph/v01-alpha.js') },
  { type: 'moire', label: 'Moiré', description: 'Overlapping interference grids', group: 'pattern',
    loader: () => import('./moire/v01-alpha.js') },
  { type: 'plasma', label: 'Plasma', description: 'Classic demo-scene plasma', group: 'pattern',
    loader: () => import('./plasma/v01-alpha.js') },
  { type: 'flowfield', label: 'Flow Field', description: 'Vector field streamlines', group: 'pattern',
    loader: () => import('./flowfield/v01-alpha.js') },
  { type: 'spirograph', label: 'Spirograph', description: 'Epicycloid / hypocycloid traces', group: 'pattern',
    loader: () => import('./spirograph/v01-alpha.js') },
  { type: 'automata', label: 'Automata', description: 'Cellular-automata rendering', group: 'pattern',
    loader: () => import('./automata/v01-alpha.js') },
  { type: 'reaction', label: 'Reaction-Diffusion', description: 'Gray-Scott reaction diffusion', group: 'pattern',
    loader: () => import('./reaction/v01-alpha.js') },
  { type: 'rosecurve', label: 'Rose Curve', description: 'Rhodonea polar curves', group: 'pattern',
    loader: () => import('./rosecurve/v01-alpha.js') },

  // --- Pattern (cont.) ---
  { type: 'penrose', label: 'Penrose', description: 'Aperiodic tiling with 5-fold symmetry', group: 'pattern',
    loader: () => import('./penrose/v01-alpha.js') },

  // --- Wave ---
  { type: 'soliton', label: 'Soliton', description: 'KdV soliton wave interactions', group: 'wave',
    loader: () => import('./soliton/v01-alpha.js') },

  // --- 3D / raymarched ---
  { type: 'terrain', label: 'Terrain', description: 'Raymarched procedural terrain', group: '3d',
    loader: () => import('./terrain/v01-alpha.js') },
  { type: 'geodesic', label: 'Geodesic', description: 'Geodesic dome raymarching', group: '3d',
    loader: () => import('./geodesic/v01-alpha.js') },
  { type: 'tunnel', label: 'Tunnel', description: 'Infinite raymarched tunnel', group: '3d',
    loader: () => import('./tunnel/v01-alpha.js') },
  { type: 'interference', label: 'Interference', description: 'Wave-interference field', group: '3d',
    loader: () => import('./interference/v01-alpha.js') },
  { type: 'metaballs', label: 'Metaballs', description: 'Implicit-surface blobs', group: '3d',
    loader: () => import('./metaballs/v01-alpha.js') },
  { type: 'mandelbulb', label: 'Mandelbulb', description: '3D fractal raymarched in real-time', group: '3d',
    loader: () => import('./mandelbulb/v01-alpha.js') },

  // --- Attractors ---
  { type: 'attractor', label: 'Strange Attractor', description: 'Classic strange attractor', group: 'particle',
    loader: () => import('./attractor/v01-alpha.js') },
  { type: 'hopalong', label: 'Hopalong', description: 'Martin Hopalong attractor', group: 'particle',
    loader: () => import('./attractor/v02-beta.js') },
  { type: 'dejong', label: 'De Jong', description: 'De Jong attractor', group: 'particle',
    loader: () => import('./attractor/v03-gamma.js') },
  { type: 'ikeda', label: 'Ikeda Map', description: 'Nonlinear optical resonator attractor', group: 'particle',
    loader: () => import('./attractor/v04-delta.js') },
  { type: 'aizawa', label: 'Aizawa', description: '3D chaotic torus with vertical spike', group: 'particle',
    loader: () => import('./attractor/v05-epsilon.js') },

  // --- Electromagnetic ---
  { type: 'magnetic', label: 'Magnetic Field', description: 'Dipole/multipole field lines', group: 'pattern',
    loader: () => import('./magnetic/v01-alpha.js') },

  // --- Topological / Minimal surfaces ---
  { type: 'gyroid', label: 'Gyroid', description: 'Triply periodic minimal surface with iridescent lighting', group: '3d',
    loader: () => import('./gyroid/v01-alpha.js') },
  { type: 'hopf', label: 'Hopf Fibration', description: 'Topological fiber bundles from S³ to S²', group: '3d',
    loader: () => import('./hopf/v01-alpha.js') },

  // --- Kleinian / Möbius fractals ---
  { type: 'kleinian', label: 'Kleinian', description: "Indra's Pearls — Möbius-group limit sets", group: 'fractal',
    loader: () => import('./kleinian/v01-alpha.js') },

  // --- Caustics / Refraction ---
  { type: 'caustics', label: 'Caustics', description: 'Underwater light refraction patterns', group: 'pattern',
    loader: () => import('./caustics/v01-alpha.js') },

  // --- Ferrofluid ---
  { type: 'ferrofluid', label: 'Ferrofluid', description: 'Magnetic fluid with Rosensweig spike instability', group: '3d',
    loader: () => import('./ferrofluid/v01-alpha.js') },

  // --- Orbit Trap Fractal ---
  { type: 'orbittrap', label: 'Orbit Trap', description: 'Julia fractal with geometric orbit trap coloring', group: 'fractal',
    loader: () => import('./orbittrap/v01-alpha.js') },

  // --- Aurora ---
  { type: 'aurora', label: 'Aurora', description: 'Northern lights curtain simulation', group: 'wave',
    loader: () => import('./aurora/v01-alpha.js') },

  // --- Dendrite / Frost ---
  { type: 'dendrite', label: 'Dendrite', description: 'Crystal frost growth patterns', group: 'pattern',
    loader: () => import('./dendrite/v01-alpha.js') },

  // --- Torus Knot ---
  { type: 'torusknot', label: 'Torus Knot', description: 'Raymarched mathematical knots with iridescent shading', group: '3d',
    loader: () => import('./torusknot/v01-alpha.js') },
];

export const VISUALIZER_MANIFEST: VisualizerManifestEntry[] = MANIFEST_ENTRIES.map((entry) => {
  const documentation = VISUALIZER_DOCUMENTATION[entry.type];
  if (!documentation) {
    throw new Error(`Missing visualizer documentation for manifest type "${entry.type}"`);
  }
  return { ...entry, documentation };
});

const manifestByType = new Map(VISUALIZER_MANIFEST.map(e => [e.type, e]));

export function getManifestEntry(type: string): VisualizerManifestEntry | undefined {
  return manifestByType.get(type);
}

export function listManifestEntries(): VisualizerManifestEntry[] {
  return VISUALIZER_MANIFEST.slice();
}

export function listManifestTypes(): string[] {
  return VISUALIZER_MANIFEST.map(e => e.type);
}
