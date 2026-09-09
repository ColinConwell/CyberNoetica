import type { MessageBus } from '@cybernoetica/core';
import type { VisualizerMetadata } from '../types.js';
import { registerVisualizer } from '../registry.js';
import { CurveVisualizer } from '../curves/engine.js';
import {
  TAU,
  rosePeriod,
  rosePoint,
  roulettePeriod,
  roulettePoint,
  superRadius,
} from '../../geometry/curves.js';

const superformulaMetadata: VisualizerMetadata = {
  type: 'superformula',
  label: 'Superformula',
  description: 'Organic morphing Gielis shapes',
  usesPerspective: false,
  params: [
    // Appearance
    {
      key: 'symmetry',
      label: 'Symmetry (m)',
      min: 1,
      max: 12,
      step: 1,
      initial: 5,
      category: 'appearance',
    },
    {
      key: 'shapeN1',
      label: 'Shape n1',
      min: 0.1,
      max: 10.0,
      step: 0.1,
      initial: 1.0,
      category: 'appearance',
    },
    {
      key: 'shapeN2',
      label: 'Shape n2',
      min: 0.1,
      max: 10.0,
      step: 0.1,
      initial: 1.0,
      category: 'appearance',
    },
    {
      key: 'shapeN3',
      label: 'Shape n3',
      min: 0.1,
      max: 10.0,
      step: 0.1,
      initial: 1.0,
      category: 'appearance',
    },
    {
      key: 'lineGlow',
      label: 'Line Glow',
      min: 0.5,
      max: 4.0,
      step: 0.25,
      initial: 2.0,
      category: 'appearance',
    },
    {
      key: 'layerCount',
      label: 'Layers',
      min: 1,
      max: 5,
      step: 1,
      initial: 3,
      category: 'appearance',
    },
    // Audio mapping
    {
      key: 'spectralToM',
      label: 'Spectral -> Symmetry',
      min: 0.0,
      max: 2.0,
      step: 0.1,
      initial: 1.0,
      category: 'audio-mapping',
      description: 'How strongly spectral centroid shifts symmetry order',
    },
    {
      key: 'rmsToN1',
      label: 'RMS -> Shape',
      min: 0.0,
      max: 2.0,
      step: 0.1,
      initial: 1.0,
      category: 'audio-mapping',
      description: 'How strongly volume affects overall angularity',
    },
    {
      key: 'bassToN2',
      label: 'Bass -> n2',
      min: 0.0,
      max: 2.0,
      step: 0.1,
      initial: 1.0,
      category: 'audio-mapping',
      description: 'How strongly bass drives n2 parameter',
    },
    {
      key: 'highToN3',
      label: 'High → n3 (even m)',
      min: 0.0,
      max: 2.0,
      step: 0.1,
      initial: 1.0,
      category: 'audio-mapping',
      description: 'How strongly highs drive n3 parameter',
    },
  ],
  viewport: { pan: false, zoom: true, orbit: false },
  viewStateFields: [
    { key: 'zoom', label: 'Zoom', min: 0.3, max: 4.0, step: 0.05 },
    { key: 'rotation', label: 'Rotation', min: 0, max: 6.283, step: 0.01 },
  ],
};

export class SuperformulaVisualizer extends CurveVisualizer {
  constructor(bus: MessageBus) {
    super(superformulaMetadata, bus, {
      speed: (c) => 0.06,
      width: (c) => c.params.lineGlow,
      layers: (c) => {
        const p = c.params,
          a = c.audio;
        // Independent n2/n3 are closed over 2π for even m. Odd orders enforce n2=n3.
        const m = c.topology(
          'm',
          p.symmetry + a.spectralCentroid * 2 * p.spectralToM,
          1,
          12,
        );
        return Array.from({ length: Math.round(p.layerCount) }, (_, i) => {
          const n1 = Math.max(0.3, p.shapeN1 + a.rms * p.rmsToN1 + i * 0.3);
          const n2 = Math.max(0.3, p.shapeN2 + a.bass * p.bassToN2),
            n3 = m % 2 ? n2 : Math.max(0.3, p.shapeN3 + a.high * p.highToN3);
          // Normalize each complete curve by its maximum radius, without locally clipping its shape.
          let maxR = 1;
          for (let j = 0; j < 512; j++)
            maxR = Math.max(maxR, superRadius((TAU * j) / 512, m, n1, n2, n3));
          const scale = (0.38 * (1 - i * 0.1)) / maxR,
            angle = c.phase + i * 0.17;
          return {
            period: TAU,
            seeds: Math.max(128, 32 * m),
            hue: i * 0.18 + c.time * 0.025,
            brightness: 0.6 + a.rms * 0.5,
            point: (t: number) => {
              const radius = scale * superRadius(t, m, n1, n2, n3);
              return [
                radius * Math.cos(t + angle),
                radius * Math.sin(t + angle),
              ] as const;
            },
          };
        });
      },
    });
  }
}
registerVisualizer({
  metadata: superformulaMetadata,
  create: (bus) => new SuperformulaVisualizer(bus),
});
