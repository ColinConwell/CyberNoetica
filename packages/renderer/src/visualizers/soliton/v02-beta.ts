import type { MessageBus } from '@cybernoetica/core';
import type { VisualizerMetadata } from '../types.js';
import { registerVisualizer } from '../registry.js';
import { CurveVisualizer } from '../curves/engine.js';
import { twoSoliton } from '../../geometry/soliton.js';
const metadata: VisualizerMetadata = {
  type: 'soliton-beta',
  label: 'KdV Collision',
  description: 'Exact two-soliton collision from the Hirota tau function',
  usesPerspective: false,
  params: [
    {
      key: 'speed',
      label: 'Simulation speed',
      min: 0,
      max: 2,
      step: 0.05,
      initial: 0.6,
      category: 'appearance',
    },
    {
      key: 'amplitude',
      label: 'Large pulse amplitude',
      min: 1.2,
      max: 2.5,
      step: 0.05,
      initial: 1.62,
      category: 'appearance',
    },
    {
      key: 'bassEnergy',
      label: 'Bass → Next collision energy',
      min: 0,
      max: 1,
      step: 0.05,
      initial: 0.5,
      category: 'audio-mapping',
      description:
        'Energy is sampled at the start of a collision; widths and velocities follow KdV',
    },
    {
      key: 'rmsGlow',
      label: 'RMS → Light',
      min: 0,
      max: 2,
      step: 0.1,
      initial: 1,
      category: 'audio-mapping',
    },
  ],
  viewport: { pan: true, zoom: true, orbit: false },
  viewStateFields: [
    { key: 'centerX', label: 'Center X', min: -2, max: 2, step: 0.01 },
    { key: 'centerY', label: 'Center Y', min: -2, max: 2, step: 0.01 },
    { key: 'zoom', label: 'Zoom', min: 0.3, max: 4, step: 0.05 },
  ],
};
export class KdVCollisionVisualizer extends CurveVisualizer {
  constructor(bus: MessageBus) {
    let k1 = 0.9,
      lastPhase = -1;
    super(metadata, bus, {
      speed: (c) => (c.params.speed * Math.PI) / 4,
      width: () => 2,
      layers: (c) => {
        if (lastPhase < 0 || c.phase < lastPhase)
          k1 = Math.sqrt(
            (c.params.amplitude + c.audio.bass * c.params.bassEnergy * 0.35) /
              2,
          );
        lastPhase = c.phase;
        const t = (c.phase * 4) / Math.PI;
        return [
          {
            period: 36,
            seeds: 256,
            hue: 0.55 + c.audio.spectralCentroid * 0.2,
            brightness: 0.7 + c.audio.rms * c.params.rmsGlow,
            point: (s) => [
              (s - 18) / 40,
              twoSoliton(s - 18, t, k1, 0.5) * 0.16 - 0.18,
            ],
          },
        ];
      },
    });
  }
}
registerVisualizer({
  metadata,
  create: (bus) => new KdVCollisionVisualizer(bus),
});
