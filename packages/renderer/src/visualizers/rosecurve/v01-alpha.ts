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

const roseMetadata: VisualizerMetadata = {
  type: 'rosecurve',
  label: 'Rose Curve',
  description: 'Rhodonea polar rose family with harmonics',
  usesPerspective: false,
  params: [
    // Appearance
    {
      key: 'numerator',
      label: 'Petals N',
      min: 1,
      max: 12,
      step: 1,
      initial: 5,
      category: 'appearance',
      description: 'Petal count numerator',
    },
    {
      key: 'denominator',
      label: 'Petals D',
      min: 1,
      max: 8,
      step: 1,
      initial: 2,
      category: 'appearance',
      description: 'Denominator of k = N/D',
    },
    {
      key: 'layers',
      label: 'Layers',
      min: 1,
      max: 6,
      step: 1,
      initial: 4,
      category: 'appearance',
      description: 'Stacked rose layers',
    },
    {
      key: 'amplitude',
      label: 'Amplitude',
      min: 0.2,
      max: 1.2,
      step: 0.02,
      initial: 0.85,
      category: 'appearance',
      description: 'Radial extent of petals',
    },
    {
      key: 'thickness',
      label: 'Thickness',
      min: 0.005,
      max: 0.1,
      step: 0.002,
      initial: 0.02,
      category: 'appearance',
      description: 'Line width',
    },
    {
      key: 'spin',
      label: 'Spin',
      min: 0.0,
      max: 1.0,
      step: 0.01,
      initial: 0.15,
      category: 'appearance',
      description: 'Rotation speed',
    },
    {
      key: 'hue',
      label: 'Hue',
      min: 0.0,
      max: 1.0,
      step: 0.01,
      initial: 0.85,
      category: 'appearance',
      description: 'Base palette hue',
    },
    {
      key: 'hueSpread',
      label: 'Hue Spread',
      min: 0.0,
      max: 1.0,
      step: 0.01,
      initial: 0.3,
      category: 'appearance',
      description: 'Hue offset per layer',
    },
    // Audio mapping
    {
      key: 'bassToAmp',
      label: 'Bass \u2192 Amplitude',
      min: 0.0,
      max: 2.0,
      step: 0.1,
      initial: 1.0,
      category: 'audio-mapping',
      description: 'Bass grows petals',
    },
    {
      key: 'midToK',
      label: 'Mid \u2192 Topology',
      min: 0.0,
      max: 2.0,
      step: 0.1,
      initial: 1.0,
      category: 'audio-mapping',
      description: 'Mids drift rose k',
    },
    {
      key: 'highToSharpness',
      label: 'High \u2192 Sharpness',
      min: 0.0,
      max: 2.0,
      step: 0.1,
      initial: 1.0,
      category: 'audio-mapping',
      description: 'Highs tighten lines',
    },
    {
      key: 'rmsToGlow',
      label: 'RMS \u2192 Glow',
      min: 0.0,
      max: 2.0,
      step: 0.1,
      initial: 1.0,
      category: 'audio-mapping',
      description: 'Volume drives overall glow',
    },
    {
      key: 'beatToSpin',
      label: 'Beat \u2192 Spin',
      min: 0.0,
      max: 2.0,
      step: 0.1,
      initial: 1.0,
      category: 'audio-mapping',
      description: 'Beats kick rotation',
    },
  ],
  viewport: { pan: true, zoom: true, orbit: false },
  viewStateFields: [
    { key: 'centerX', label: 'Center X', min: -3, max: 3, step: 0.05 },
    { key: 'centerY', label: 'Center Y', min: -3, max: 3, step: 0.05 },
    { key: 'zoom', label: 'Zoom', min: 0.3, max: 4.0, step: 0.05 },
  ],
};

export class RoseCurveVisualizer extends CurveVisualizer {
  constructor(bus: MessageBus) {
    super(roseMetadata, bus, {
      speed: (c) => c.params.spin + c.beat * 0.5 * c.params.beatToSpin,
      width: (c) =>
        (c.params.thickness * 100) /
        (1 + c.audio.high * c.params.highToSharpness),
      layers: (c) => {
        const p = c.params,
          a = c.audio;
        const n = c.topology('n', p.numerator + a.mid * 2 * p.midToK, 1, 12),
          d = Math.round(p.denominator);
        return Array.from({ length: Math.round(p.layers) }, (_, i) => {
          const numerator = n + i * d,
            angle = c.phase + i * 0.15,
            amp =
              p.amplitude *
              0.4 *
              (1 + a.bass * 0.2 * p.bassToAmp) *
              (1 - i * 0.04);
          return {
            period: rosePeriod(numerator, d),
            seeds: 64 * (numerator + d),
            hue: p.hue + (i * p.hueSpread) / p.layers,
            brightness: (0.5 + a.rms * p.rmsToGlow) / Math.sqrt(p.layers),
            point: (t: number) => {
              const [x, y] = rosePoint(t, numerator, d, amp);
              return [
                x * Math.cos(angle) - y * Math.sin(angle),
                x * Math.sin(angle) + y * Math.cos(angle),
              ] as const;
            },
          };
        });
      },
    });
  }
}
registerVisualizer({
  metadata: roseMetadata,
  create: (bus) => new RoseCurveVisualizer(bus),
});
