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
 * Voronoi Epsilon — spherical-wall foam globe.
 *
 * Math:
 *   A Voro++ spherical wall cuts each cell by a site-dependent tangent plane.
 *   This is a polyhedral approximation, not exact clipping to a ball. Seeds
 *   live on a Fibonacci spherical shell plus a small core.
 * Reference: https://math.lbl.gov/voro++/
 */

const metadata: VisualizerMetadata = {
  type: 'voronoi-epsilon',
  label: 'Voronoi (ε)',
  description: 'Spherical-wall foam globe',
  usesPerspective: true,
  params: [
    {
      key: 'boundaryMode',
      label: 'Boundary (0 tangent planes · 1 curved)',
      min: 0,
      max: 1,
      step: 1,
      initial: 1,
      category: 'appearance',
      description:
        'Curved mode clips an unconstrained diagram to a sphere and renders its colored boundary; explosion is disabled',
    },
    {
      key: 'seedCount',
      label: 'Seeds',
      min: 16,
      max: 128,
      step: 1,
      initial: 56,
      category: 'appearance',
      description: 'Shell + core site count',
    },
    {
      key: 'driftSpeed',
      label: 'Drift Speed',
      min: 0.0,
      max: 1.0,
      step: 0.05,
      initial: 0.18,
      category: 'appearance',
    },
    {
      key: 'edgeGlow',
      label: 'Edge Glow',
      min: 0.2,
      max: 2.0,
      step: 0.1,
      initial: 1.15,
      category: 'appearance',
    },
    {
      key: 'faceOpacity',
      label: 'Face Opacity',
      min: 0.05,
      max: 0.8,
      step: 0.05,
      initial: 0.32,
      category: 'appearance',
    },
    {
      key: 'explodeAmount',
      label: 'Explode',
      min: 0.0,
      max: 1.5,
      step: 0.05,
      initial: 0.2,
      category: 'appearance',
      description: 'How far cells separate from their centroids',
    },
    {
      key: 'sphereRadius',
      label: 'Sphere Radius',
      min: 1.0,
      max: 2.4,
      step: 0.05,
      initial: 1.85,
      category: 'appearance',
      description: 'Radius of the clipping sphere',
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
      key: 'rmsToRadius',
      label: 'RMS → Radius',
      min: 0.0,
      max: 2.0,
      step: 0.1,
      initial: 1.0,
      category: 'audio-mapping',
      description: 'How strongly volume breathes the sphere wall',
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
  mode: 'sphere',
  // Accommodate max radius 2.4 * (1 + 0.18 * 2) and shell jitter.
  halfExtent: 4.0,
  seedLayout: 'shell',
  look: {
    hueOffset: 0.72,
    faceSat: 0.55,
    faceVal: 0.92,
    edgeTint: [0.72, 0.52, 1.0],
  },
  defaultParams: {
    boundaryMode: 1,
    seedCount: 56,
    driftSpeed: 0.18,
    edgeGlow: 1.15,
    faceOpacity: 0.32,
    explodeAmount: 0.2,
    sphereRadius: 1.85,
    bassToJitter: 1.0,
    midToHue: 1.0,
    rmsToGlow: 1.0,
    rmsToRadius: 1.0,
    beatToExplode: 1.0,
    centroidToPalette: 1.0,
  },
};

export class VoronoiEpsilonVisualizer extends VoronoiFoamVisualizer {
  constructor(bus: MessageBus) {
    super(config, bus);
  }
}

registerVisualizer({
  metadata,
  create: (bus) => new VoronoiEpsilonVisualizer(bus),
});
