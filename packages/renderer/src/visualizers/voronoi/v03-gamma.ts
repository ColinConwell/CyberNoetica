import { MessageBus } from '@cybernoetica/core';
import type { VisualizerMetadata } from '../types.js';
import { registerVisualizer } from '../registry.js';
import {
  FOAM_VIEW_FIELDS,
  FOAM_VIEWPORT,
  VoronoiFoamVisualizer,
} from './foam-engine.js';
import type { FoamConfig } from './foam-engine.js';

/**
 * Voronoi Gamma — periodic crystal foam.
 *
 * Math:
 *   The container is periodic in x, y, and z. Neighbor searches wrap through
 *   the opposite face, so cells at the boundary meet their periodic images
 *   instead of flattening against a wall.
 * Reference: https://math.lbl.gov/voro++/
 */

const metadata: VisualizerMetadata = {
  type: 'voronoi-gamma',
  label: 'Voronoi (γ)',
  description: 'Periodic crystal foam',
  usesPerspective: true,
  params: [
    {
      key: 'neighborImages',
      label: 'Show six face neighbors',
      min: 0,
      max: 1,
      step: 1,
      initial: 0,
      category: 'appearance',
      description: 'Shared geometry translated by one period along each axis',
    },
    {
      key: 'seedCount',
      label: 'Seeds',
      min: 27,
      max: 125,
      step: 1,
      initial: 64,
      category: 'appearance',
      description: 'Lattice site count (rounded to a cube)',
    },
    {
      key: 'driftSpeed',
      label: 'Drift Speed',
      min: 0.0,
      max: 1.0,
      step: 0.05,
      initial: 0.15,
      category: 'appearance',
    },
    {
      key: 'edgeGlow',
      label: 'Edge Glow',
      min: 0.2,
      max: 2.0,
      step: 0.1,
      initial: 1.1,
      category: 'appearance',
    },
    {
      key: 'faceOpacity',
      label: 'Face Opacity',
      min: 0.05,
      max: 0.8,
      step: 0.05,
      initial: 0.22,
      category: 'appearance',
    },
    {
      key: 'explodeAmount',
      label: 'Explode',
      min: 0.0,
      max: 1.5,
      step: 0.05,
      initial: 0.15,
      category: 'appearance',
      description: 'How far cells separate from their centroids',
    },
    {
      key: 'bassToJitter',
      label: 'Bass → Jitter',
      min: 0.0,
      max: 2.0,
      step: 0.1,
      initial: 1.0,
      category: 'audio-mapping',
      description: 'How strongly bass rattles the lattice',
    },
    {
      key: 'midToHue',
      label: 'Mid → Hue Shift',
      min: 0.0,
      max: 2.0,
      step: 0.1,
      initial: 1.0,
      category: 'audio-mapping',
      description: 'How strongly mids rotate the cell palette',
    },
    {
      key: 'rmsToGlow',
      label: 'RMS → Edge Glow',
      min: 0.0,
      max: 2.0,
      step: 0.1,
      initial: 1.0,
      category: 'audio-mapping',
      description: 'How strongly volume brightens cell edges',
    },
    {
      key: 'beatToExplode',
      label: 'Beat → Explode',
      min: 0.0,
      max: 2.0,
      step: 0.1,
      initial: 1.0,
      category: 'audio-mapping',
      description: 'How strongly beats push cells apart',
    },
    {
      key: 'centroidToPalette',
      label: 'Centroid → Palette',
      min: 0.0,
      max: 2.0,
      step: 0.1,
      initial: 1.0,
      category: 'audio-mapping',
      description: 'How strongly spectral centroid shifts hue',
    },
  ],
  viewport: { ...FOAM_VIEWPORT },
  viewStateFields: FOAM_VIEW_FIELDS,
};

const config: FoamConfig = {
  metadata,
  mode: 'periodic',
  seedLayout: 'lattice',
  look: {
    hueOffset: 0.55,
    faceSat: 0.4,
    faceVal: 0.9,
    edgeTint: [0.4, 0.78, 1.0],
  },
  defaultParams: {
    neighborImages: 0,
    seedCount: 64,
    driftSpeed: 0.15,
    edgeGlow: 1.1,
    faceOpacity: 0.22,
    explodeAmount: 0.15,
    bassToJitter: 1.0,
    midToHue: 1.0,
    rmsToGlow: 1.0,
    beatToExplode: 1.0,
    centroidToPalette: 1.0,
  },
};

export class VoronoiGammaVisualizer extends VoronoiFoamVisualizer {
  constructor(bus: MessageBus) {
    super(config, bus);
  }
}

registerVisualizer({
  metadata,
  create: (bus) => new VoronoiGammaVisualizer(bus),
});
