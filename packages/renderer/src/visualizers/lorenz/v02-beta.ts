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
 * Lorenz β — Rössler single-scroll attractor (1976).
 *
 *   dx/dt = −y − z
 *   dy/dt = x + a y
 *   dz/dt = b + z (x − c)
 *
 * Canonical params: a = 0.2, b = 0.2, c = 5.7.
 */

const metadata: VisualizerMetadata = {
  type: 'lorenz-beta',
  label: 'Rössler',
  description: 'Rössler single-scroll attractor',
  usesPerspective: true,
  params: [
    { key: 'paramA', label: 'Param a', min: 0.05, max: 0.4, step: 0.01, initial: 0.2, category: 'appearance', description: 'Linear y-coupling' },
    { key: 'paramB', label: 'Param b', min: 0.05, max: 0.6, step: 0.01, initial: 0.2, category: 'appearance', description: 'Constant z-drive' },
    { key: 'paramC', label: 'Param c', min: 4.0, max: 10.0, step: 0.05, initial: 5.7, category: 'appearance', description: 'Folding threshold' },
    ...FLOW_SHARED_PARAMS,
  ],
  viewport: { ...FLOW_VIEWPORT },
  viewStateFields: FLOW_VIEW_FIELDS,
};

function rosslerDerivs(p: Vec3, params: Record<string, number>): Vec3 {
  const a = params.paramA;
  const b = params.paramB;
  const c = params.paramC;
  return {
    x: -p.y - p.z,
    y: p.x + a * p.y,
    z: b + p.z * (p.x - c),
  };
}

const config: FlowConfig = {
  metadata,
  derivs: rosslerDerivs,
  origin: { x: 0.2, y: 0, z: 5 },
  scale: 0.22,
  dt: 0.02,
  driveParam: 'paramC',
  driveScale: 2.2,
  seed: { x: 0.1, y: 0.1, z: 0.1 },
  hueOffset: 0.08,
  orbitAngle: 0.5,
  elevation: 0.4,
  distance: 10,
  defaultParams: {
    paramA: 0.2,
    paramB: 0.2,
    paramC: 5.7,
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

export class LorenzBetaVisualizer extends FlowVisualizer {
  constructor(bus: MessageBus) {
    super(config, bus);
  }
}

registerVisualizer({
  metadata,
  create: (bus) => new LorenzBetaVisualizer(bus),
});
