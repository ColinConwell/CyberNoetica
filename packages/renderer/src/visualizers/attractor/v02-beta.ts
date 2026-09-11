import type { MessageBus } from '@cybernoetica/core';
import type { VisualizerMetadata } from '../types.js';
import { registerVisualizer } from '../registry.js';
import { DensityMapVisualizer } from './density-engine.js';

const hopalongMetadata: VisualizerMetadata = {
  type: 'hopalong',
  label: 'Hopalong',
  description: "Barry Martin's Hopalong attractor",
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
    // Appearance
    {
      key: 'paramA',
      label: 'Param A',
      min: -8.0,
      max: 8.0,
      step: 0.05,
      initial: 2.0,
      category: 'appearance',
      description: 'Hopalong coefficient A',
    },
    {
      key: 'paramB',
      label: 'Param B',
      min: -8.0,
      max: 8.0,
      step: 0.05,
      initial: 1.0,
      category: 'appearance',
      description: 'Hopalong coefficient B',
    },
    {
      key: 'paramC',
      label: 'Param C',
      min: -8.0,
      max: 8.0,
      step: 0.05,
      initial: 0.0,
      category: 'appearance',
      description: 'Hopalong coefficient C',
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
      initial: 0.25,
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
      initial: 0.15,
      category: 'appearance',
      description: 'Base palette hue',
    },
    // Audio mapping
    {
      key: 'bassToParams',
      label: 'Bass \u2192 Shape',
      min: 0.0,
      max: 2.0,
      step: 0.1,
      initial: 1.0,
      category: 'audio-mapping',
      description: 'Bass breathes attractor coefficients',
    },
    {
      key: 'midToColor',
      label: 'Mid \u2192 Color',
      min: 0.0,
      max: 2.0,
      step: 0.1,
      initial: 1.0,
      category: 'audio-mapping',
      description: 'Mids drive color palette shift',
    },
    {
      key: 'rmsToGlow',
      label: 'RMS \u2192 Glow',
      min: 0.0,
      max: 2.0,
      step: 0.1,
      initial: 1.0,
      category: 'audio-mapping',
      description: 'Volume drives overall luminosity',
    },
    {
      key: 'beatToJolt',
      label: 'Onset \u2192 Glow',
      min: 0.0,
      max: 2.0,
      step: 0.1,
      initial: 1.0,
      category: 'audio-mapping',
      description: 'Onsets briefly brighten density',
    },
  ],
  viewport: { pan: true, zoom: true, orbit: false },
  viewStateFields: [
    { key: 'zoom', label: 'Zoom', min: 0.1, max: 5.0, step: 0.05 },
    { key: 'panX', label: 'Pan X', min: -8, max: 8, step: 0.1 },
    { key: 'panY', label: 'Pan Y', min: -8, max: 8, step: 0.1 },
  ],
};

export class HopalongVisualizer extends DensityMapVisualizer {
  constructor(bus: MessageBus) {
    super(hopalongMetadata, bus, 'hopalong');
  }
}
registerVisualizer({
  metadata: hopalongMetadata,
  create: (bus) => new HopalongVisualizer(bus),
});
