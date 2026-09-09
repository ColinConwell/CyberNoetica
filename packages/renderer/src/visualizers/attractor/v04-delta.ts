import type { MessageBus } from '@cybernoetica/core';
import type { VisualizerMetadata } from '../types.js';
import { registerVisualizer } from '../registry.js';
import { DensityMapVisualizer } from './density-engine.js';

const ikedaMetadata: VisualizerMetadata = {
  type: 'ikeda',
  label: 'Ikeda Map',
  description: 'Nonlinear optical resonator strange attractor',
  usesPerspective: false,
  params: [
    {
      key: 'densityDecay',
      label: 'Density memory (s)',
      min: 0.2,
      max: 5,
      step: 0.1,
      initial: 1.2,
      category: 'appearance',
      description:
        'Exponential occupancy decay time; trajectories have 512 burn-in iterations',
    },
    {
      key: 'coupling',
      label: 'Coupling (u)',
      min: 0.5,
      max: 0.905,
      step: 0.005,
      initial: 0.89,
      category: 'appearance',
      description:
        'Dissipative coupling; including audio, u ≤ 0.91; default stays in the chaotic basin',
    },
    {
      key: 'phaseOffset',
      label: 'Phase Offset',
      min: -1.0,
      max: 1.0,
      step: 0.05,
      initial: 0.4,
      category: 'appearance',
      description: 'Nonlinear phase constant',
    },
    {
      key: 'detuning',
      label: 'Detuning',
      min: 1.0,
      max: 10.0,
      step: 0.5,
      initial: 6.0,
      category: 'appearance',
      description: 'Cavity detuning factor',
    },
    {
      key: 'iterations',
      label: 'Detail',
      min: 80,
      max: 400,
      step: 10,
      initial: 220,
      category: 'appearance',
      description: 'Trajectory samples (×64)',
    },
    {
      key: 'colorSpeed',
      label: 'Color Cycle',
      min: 0.0,
      max: 1.0,
      step: 0.05,
      initial: 0.15,
      category: 'appearance',
    },
    {
      key: 'brightness',
      label: 'Brightness',
      min: 0.3,
      max: 3.0,
      step: 0.1,
      initial: 1.4,
      category: 'appearance',
    },
    {
      key: 'hueShift',
      label: 'Hue Shift',
      min: 0.0,
      max: 1.0,
      step: 0.01,
      initial: 0.6,
      category: 'appearance',
      description: 'Base palette hue',
    },
    {
      key: 'bassToCoupling',
      label: 'Bass → Coupling',
      min: 0.0,
      max: 2.0,
      step: 0.1,
      initial: 1.0,
      category: 'audio-mapping',
      description: 'Bass modulates laser coupling',
    },
    {
      key: 'fluxToPhase',
      label: 'Flux → Phase',
      min: 0.0,
      max: 2.0,
      step: 0.1,
      initial: 1.0,
      category: 'audio-mapping',
      description: 'Spectral flux rotates phase',
    },
    {
      key: 'rmsToGlow',
      label: 'RMS → Glow',
      min: 0.0,
      max: 2.0,
      step: 0.1,
      initial: 1.0,
      category: 'audio-mapping',
      description: 'Volume drives luminosity',
    },
    {
      key: 'beatToJolt',
      label: 'Onset → Glow',
      min: 0.0,
      max: 2.0,
      step: 0.1,
      initial: 1.0,
      category: 'audio-mapping',
      description: 'Onsets briefly brighten density',
    },
    {
      key: 'centroidToHue',
      label: 'Centroid → Hue',
      min: 0.0,
      max: 2.0,
      step: 0.1,
      initial: 0.8,
      category: 'audio-mapping',
      description: 'Spectral centroid shifts palette',
    },
  ],
  viewport: { pan: true, zoom: true, orbit: false },
  viewStateFields: [
    { key: 'zoom', label: 'Zoom', min: 0.1, max: 5.0, step: 0.05 },
    { key: 'panX', label: 'Pan X', min: -5, max: 5, step: 0.05 },
    { key: 'panY', label: 'Pan Y', min: -5, max: 5, step: 0.05 },
  ],
};

export class IkedaVisualizer extends DensityMapVisualizer {
  constructor(bus: MessageBus) {
    super(ikedaMetadata, bus, 'ikeda');
  }
}
registerVisualizer({
  metadata: ikedaMetadata,
  create: (bus) => new IkedaVisualizer(bus),
});
