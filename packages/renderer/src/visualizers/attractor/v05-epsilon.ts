import type { MessageBus } from '@cybernoetica/core';
import type { VisualizerMetadata } from '../types.js';
import { registerVisualizer } from '../registry.js';
import {
  FlowVisualizer,
  FLOW_SHARED_PARAMS,
  FLOW_VIEW_FIELDS,
  FLOW_VIEWPORT,
} from '../lorenz/engine.js';
import type { Vec3 } from '../lorenz/engine.js';

const metadata: VisualizerMetadata = {
  type: 'aizawa',
  label: 'Aizawa',
  description: 'Aizawa ODE integrated with RK4 and rendered as 3D trails',
  usesPerspective: true,
  params: [
    {
      key: 'paramA',
      label: 'a',
      min: 0.9,
      max: 1,
      step: 0.005,
      initial: 0.95,
      category: 'appearance',
    },
    {
      key: 'paramB',
      label: 'b',
      min: 0.65,
      max: 0.75,
      step: 0.005,
      initial: 0.7,
      category: 'appearance',
    },
    {
      key: 'paramC',
      label: 'c',
      min: 0.55,
      max: 0.65,
      step: 0.005,
      initial: 0.6,
      category: 'appearance',
    },
    {
      key: 'paramD',
      label: 'd',
      min: 3.2,
      max: 3.8,
      step: 0.01,
      initial: 3.5,
      category: 'appearance',
    },
    {
      key: 'paramE',
      label: 'e',
      min: 0.2,
      max: 0.3,
      step: 0.005,
      initial: 0.25,
      category: 'appearance',
    },
    {
      key: 'paramF',
      label: 'f',
      min: 0.08,
      max: 0.12,
      step: 0.005,
      initial: 0.1,
      category: 'appearance',
    },
    ...FLOW_SHARED_PARAMS,
  ],
  viewport: { ...FLOW_VIEWPORT },
  viewStateFields: FLOW_VIEW_FIELDS,
};
export function aizawaDerivatives(
  p: Vec3,
  parameters: Record<string, number>,
): Vec3 {
  const { x, y, z } = p;
  return {
    x: (z - parameters.paramB) * x - parameters.paramD * y,
    y: parameters.paramD * x + (z - parameters.paramB) * y,
    z:
      parameters.paramC +
      parameters.paramA * z -
      (z * z * z) / 3 -
      (x * x + y * y) * (1 + parameters.paramE * z) +
      parameters.paramF * z * x * x * x,
  };
}
export class AizawaVisualizer extends FlowVisualizer {
  constructor(bus: MessageBus) {
    super(
      {
        metadata,
        derivs: aizawaDerivatives,
        origin: { x: 0, y: 0, z: 0.6 },
        scale: 2.5,
        dt: 0.005,
        driveParam: 'paramA',
        driveScale: 0.01,
        seed: { x: 0.1, y: 0, z: 0 },
        bound: 20,
        warmupSteps: 4000,
        maxPoints: 2048,
        trailCount: 8,
        stepsPerFrame: 4,
        distance: 10,
        elevation: 0.25,
        hueOffset: 0.72,
        defaultParams: Object.fromEntries(
          metadata.params.map((param) => [param.key, param.initial]),
        ),
      },
      bus,
    );
  }
}
registerVisualizer({ metadata, create: (bus) => new AizawaVisualizer(bus) });
