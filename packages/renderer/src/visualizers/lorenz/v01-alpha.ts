import { MessageBus } from '@cybernoetica/core';
import type { VisualizerMetadata } from '../types.js';
import { registerVisualizer } from '../registry.js';
import {
  FLOW_SHARED_PARAMS,
  FLOW_VIEW_FIELDS,
  FLOW_VIEWPORT,
  FlowVisualizer,
} from './engine.js';
import type { FlowConfig, Vec3 } from './engine.js';

/**
 * Lorenz α — classic 1963 butterfly attractor.
 *
 *   dx/dt = σ (y − x)
 *   dy/dt = x (ρ − z) − y
 *   dz/dt = x y − β z
 *
 * Canonical params: σ = 10, ρ = 28, β = 8/3.
 */

const metadata: VisualizerMetadata = {
  type: 'lorenz',
  label: 'Lorenz',
  description: 'Classic 1963 butterfly attractor',
  usesPerspective: true,
  params: [
    {
      key: 'sigma',
      label: 'Sigma (σ)',
      min: 9.5,
      max: 10.5,
      step: 0.1,
      initial: 10.0,
      category: 'appearance',
      description: 'Prandtl number — contraction rate',
    },
    {
      key: 'rho',
      label: 'Rho (ρ)',
      min: 26.0,
      max: 30.0,
      step: 0.1,
      initial: 28.0,
      category: 'appearance',
      description: 'Rayleigh number within the curated butterfly range',
    },
    {
      key: 'beta',
      label: 'Beta (β)',
      min: 2.6,
      max: 2.75,
      step: 0.05,
      initial: 8 / 3,
      category: 'appearance',
      description: 'Geometric aspect ratio',
    },
    ...FLOW_SHARED_PARAMS,
  ],
  viewport: { ...FLOW_VIEWPORT },
  viewStateFields: FLOW_VIEW_FIELDS,
};

export function lorenzDerivs(p: Vec3, params: Record<string, number>): Vec3 {
  const sigma = params.sigma;
  const rho = params.rho;
  const beta = params.beta;
  return {
    x: sigma * (p.y - p.x),
    y: p.x * (rho - p.z) - p.y,
    z: p.x * p.y - beta * p.z,
  };
}

const config: FlowConfig = {
  metadata,
  derivs: lorenzDerivs,
  origin: { x: 0, y: 0, z: 27 },
  scale: 0.12,
  dt: 0.008,
  driveParam: 'rho',
  driveScale: 2,
  seed: { x: 0.1, y: 0, z: 20 },
  hueOffset: 0.55,
  orbitAngle: 0.4,
  elevation: 0.35,
  distance: 12,
  defaultParams: {
    sigma: 10,
    rho: 28,
    beta: 8 / 3,
    trailLength: 384,
    brightness: 1.2,
    hueShift: 0,
    integrationSpeed: 1.0,
    bassToDrive: 1.0,
    midToSpeed: 1.0,
    highToSpread: 1.0,
    rmsToGlow: 1.0,
    beatToKick: 1.0,
    centroidToHue: 1.0,
  },
};

export class LorenzVisualizer extends FlowVisualizer {
  constructor(bus: MessageBus) {
    super(config, bus);
  }
}

registerVisualizer({
  metadata,
  create: (bus) => new LorenzVisualizer(bus),
});
