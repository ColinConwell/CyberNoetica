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
 * Voronoi Delta — radical / Laguerre foam.
 *
 * Math:
 *   The radical (power) diagram weights each site by a radius r. The cell
 *   boundary between i and j is the plane d(x,i)² - r_i² = d(x,j)² - r_j²,
 *   so larger seeds consume volume from their neighbors.
 * Reference: https://math.lbl.gov/voro++/
 */

const metadata: VisualizerMetadata = {
  type: 'voronoi-delta',
  label: 'Voronoi (δ)',
  description: 'Radical / Laguerre weighted cells',
  usesPerspective: true,
  params: [
    {
      key: 'seedCount',
      label: 'Seeds',
      min: 16,
      max: 128,
      step: 1,
      initial: 48,
      category: 'appearance',
      description: 'Number of Voronoi sites',
    },
    {
      key: 'driftSpeed',
      label: 'Drift Speed',
      min: 0.0,
      max: 1.0,
      step: 0.05,
      initial: 0.2,
      category: 'appearance',
    },
    {
      key: 'edgeGlow',
      label: 'Edge Glow',
      min: 0.2,
      max: 2.0,
      step: 0.1,
      initial: 0.9,
      category: 'appearance',
    },
    {
      key: 'faceOpacity',
      label: 'Face Opacity',
      min: 0.05,
      max: 0.8,
      step: 0.05,
      initial: 0.45,
      category: 'appearance',
    },
    {
      key: 'explodeAmount',
      label: 'Explode',
      min: 0.0,
      max: 1.5,
      step: 0.05,
      initial: 0.25,
      category: 'appearance',
      description: 'How far cells separate from their centroids',
    },
    {
      key: 'radiusContrast',
      label: 'Radius Contrast (weight = r²)',
      min: 0.0,
      max: 2.0,
      step: 0.1,
      initial: 1.0,
      category: 'appearance',
      description: 'How strongly seed radii differ',
    },
    {
      key: 'bassToJitter',
      label: 'Bass → Jitter',
      min: 0.0,
      max: 2.0,
      step: 0.1,
      initial: 1.0,
      category: 'audio-mapping',
      description: 'How strongly bass displaces seed points',
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
  mode: 'radical',
  seedLayout: 'scatter',
  look: {
    hueOffset: 0.08,
    faceSat: 0.62,
    faceVal: 0.9,
    edgeTint: [1.0, 0.55, 0.32],
  },
  defaultParams: {
    seedCount: 48,
    driftSpeed: 0.2,
    edgeGlow: 0.9,
    faceOpacity: 0.45,
    explodeAmount: 0.25,
    radiusContrast: 1.0,
    bassToJitter: 1.0,
    midToHue: 1.0,
    rmsToGlow: 1.0,
    beatToExplode: 1.0,
    centroidToPalette: 1.0,
  },
};

export class VoronoiDeltaVisualizer extends VoronoiFoamVisualizer {
  constructor(bus: MessageBus) {
    super(config, bus);
  }
}

registerVisualizer({
  metadata,
  create: (bus) => new VoronoiDeltaVisualizer(bus),
});
