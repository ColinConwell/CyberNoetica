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
 * Lorenz γ — Chen dual-wing attractor (1999).
 *
 *   dx/dt = a (y − x)
 *   dy/dt = (c − a) x − x z + c y
 *   dz/dt = x y − b z
 *
 * Canonical params: a = 35, b = 3, c = 28.
 */

const metadata: VisualizerMetadata = {
  type: 'lorenz-gamma',
  label: 'Chen',
  description: 'Chen dual-wing attractor',
  usesPerspective: true,
  params: [
    { key: 'paramA', label: 'Param a', min: 20.0, max: 45.0, step: 0.5, initial: 35.0, category: 'appearance', description: 'Linear contraction' },
    { key: 'paramB', label: 'Param b', min: 1.0, max: 6.0, step: 0.1, initial: 3.0, category: 'appearance', description: 'z-damping' },
    { key: 'paramC', label: 'Param c', min: 18.0, max: 36.0, step: 0.1, initial: 28.0, category: 'appearance', description: 'Quadratic coupling' },
    ...FLOW_SHARED_PARAMS,
  ],
  viewport: { ...FLOW_VIEWPORT },
  viewStateFields: FLOW_VIEW_FIELDS,
};

function chenDerivs(p: Vec3, params: Record<string, number>): Vec3 {
  const a = params.paramA;
  const b = params.paramB;
  const c = params.paramC;
  return {
    x: a * (p.y - p.x),
    y: (c - a) * p.x - p.x * p.z + c * p.y,
    z: p.x * p.y - b * p.z,
  };
}

const config: FlowConfig = {
  metadata,
  derivs: chenDerivs,
  origin: { x: 0, y: 0, z: 50 },
  scale: 0.1,
  dt: 0.0025,
  driveParam: 'paramC',
  driveScale: 6,
  seed: { x: -0.1, y: 0.5, z: 20 },
  hueOffset: 0.78,
  bound: 400,
  warmupSteps: 4000,
  orbitAngle: 0.35,
  elevation: 0.3,
  distance: 14,
  defaultParams: {
    paramA: 35,
    paramB: 3,
    paramC: 28,
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

export class LorenzGammaVisualizer extends FlowVisualizer {
  constructor(bus: MessageBus) {
    super(config, bus);
  }
}

registerVisualizer({
  metadata,
  create: (bus) => new LorenzGammaVisualizer(bus),
});
