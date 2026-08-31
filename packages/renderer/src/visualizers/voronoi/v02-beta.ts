import { MessageBus } from '@cybernoetica/core';
import type { VisualizerMetadata } from '../types.js';
import { registerVisualizer } from '../registry.js';
import { FOAM_VIEW_FIELDS, FOAM_VIEWPORT, VoronoiFoamVisualizer } from './foam-engine.js';
import type { FoamConfig } from './foam-engine.js';

/**
 * Voronoi Beta — 3D polyhedral foam via Voro++ (non-periodic cube).
 *
 * Math:
 *   Each seed owns the convex polyhedron of points closer to it than to any
 *   other seed. Voro++ builds that cell by successive plane cuts of the
 *   container (perpendicular bisectors to neighbors).
 * Reference: https://math.lbl.gov/voro++/
 */

const metadata: VisualizerMetadata = {
  type: 'voronoi-beta',
  label: 'Voronoi (β)',
  description: '3D polyhedral foam via Voro++',
  usesPerspective: true,
  params: [
    { key: 'seedCount', label: 'Seeds', min: 16, max: 128, step: 1, initial: 64, category: 'appearance', description: 'Number of Voronoi sites' },
    { key: 'driftSpeed', label: 'Drift Speed', min: 0.0, max: 1.0, step: 0.05, initial: 0.25, category: 'appearance' },
    { key: 'edgeGlow', label: 'Edge Glow', min: 0.2, max: 2.0, step: 0.1, initial: 1.0, category: 'appearance' },
    { key: 'faceOpacity', label: 'Face Opacity', min: 0.05, max: 0.8, step: 0.05, initial: 0.28, category: 'appearance' },
    { key: 'explodeAmount', label: 'Explode', min: 0.0, max: 1.5, step: 0.05, initial: 0.35, category: 'appearance', description: 'How far cells separate from their centroids' },
    { key: 'bassToJitter', label: 'Bass → Jitter', min: 0.0, max: 2.0, step: 0.1, initial: 1.0, category: 'audio-mapping', description: 'How strongly bass displaces seed points' },
    { key: 'midToHue', label: 'Mid → Hue Shift', min: 0.0, max: 2.0, step: 0.1, initial: 1.0, category: 'audio-mapping', description: 'How strongly mids rotate the cell palette' },
    { key: 'rmsToGlow', label: 'RMS → Edge Glow', min: 0.0, max: 2.0, step: 0.1, initial: 1.0, category: 'audio-mapping', description: 'How strongly volume brightens cell edges' },
    { key: 'beatToExplode', label: 'Beat → Explode', min: 0.0, max: 2.0, step: 0.1, initial: 1.0, category: 'audio-mapping', description: 'How strongly beats push cells apart' },
    { key: 'centroidToPalette', label: 'Centroid → Palette', min: 0.0, max: 2.0, step: 0.1, initial: 1.0, category: 'audio-mapping', description: 'How strongly spectral centroid shifts hue' },
  ],
  viewport: { ...FOAM_VIEWPORT },
  viewStateFields: FOAM_VIEW_FIELDS,
};

const config: FoamConfig = {
  metadata,
  mode: 'box',
  seedLayout: 'lissajous',
  defaultParams: {
    seedCount: 64,
    driftSpeed: 0.25,
    edgeGlow: 1.0,
    faceOpacity: 0.28,
    explodeAmount: 0.35,
    bassToJitter: 1.0,
    midToHue: 1.0,
    rmsToGlow: 1.0,
    beatToExplode: 1.0,
    centroidToPalette: 1.0,
  },
};

export class VoronoiBetaVisualizer extends VoronoiFoamVisualizer {
  constructor(bus: MessageBus) {
    super(config, bus);
  }
}

registerVisualizer({
  metadata,
  create: (bus) => new VoronoiBetaVisualizer(bus),
});
