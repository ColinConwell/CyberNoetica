import type { MessageBus } from '@cybernoetica/core';
import type { VisualizerMetadata } from '../types.js';
import { registerVisualizer } from '../registry.js';
import { CurveVisualizer } from '../curves/engine.js';
import { roulettePeriod, roulettePoint } from '../../geometry/curves.js';

const spirographMetadata: VisualizerMetadata = {
  type: 'spirograph',
  label: 'Spirograph',
  description: 'Layered epitrochoid roulette curves',
  usesPerspective: false,
  params: [
    {
      key: 'bigRadius',
      label: 'Fixed radius R',
      min: 2,
      max: 12,
      step: 1,
      initial: 5,
      category: 'appearance',
    },
    {
      key: 'smallRadius',
      label: 'Rolling radius r',
      min: 1,
      max: 8,
      step: 1,
      initial: 2,
      category: 'appearance',
    },
    {
      key: 'rouletteType',
      label: 'Roulette (0 outside · 1 inside)',
      min: 0,
      max: 1,
      step: 1,
      initial: 0,
      category: 'appearance',
      description: 'Epitrochoid or hypotrochoid with exact rational closure',
    },
    // Appearance
    {
      key: 'layers',
      label: 'Layers',
      min: 1,
      max: 4,
      step: 1,
      initial: 3,
      category: 'appearance',
      description: 'Number of overlaid curve layers',
    },
    {
      key: 'brightness',
      label: 'Brightness',
      min: 0.5,
      max: 3.0,
      step: 0.1,
      initial: 1.5,
      category: 'appearance',
      description: 'Overall glow intensity',
    },
    {
      key: 'lineWidth',
      label: 'Line Width',
      min: 0.5,
      max: 4.0,
      step: 0.25,
      initial: 1.5,
      category: 'appearance',
      description: 'Curve thickness',
    },
    {
      key: 'rotationSpeed',
      label: 'Rotation Speed',
      min: 0.0,
      max: 1.0,
      step: 0.05,
      initial: 0.3,
      category: 'appearance',
      description: 'Overall rotation speed',
    },
    {
      key: 'morphSpeed',
      label: 'Morph Speed',
      min: 0.0,
      max: 1.0,
      step: 0.05,
      initial: 0.15,
      category: 'appearance',
      description: 'Speed of parameter evolution',
    },
    // Audio mapping
    {
      key: 'bassToPen',
      label: 'Bass -> Pen',
      min: 0.0,
      max: 2.0,
      step: 0.1,
      initial: 1.0,
      category: 'audio-mapping',
      description: 'How bass modulates pen offset',
    },
    {
      key: 'midToRatio',
      label: 'Mid -> Ratio',
      min: 0.0,
      max: 2.0,
      step: 0.1,
      initial: 1.0,
      category: 'audio-mapping',
      description: 'How mids shift radius ratio',
    },
    {
      key: 'spectralToPetals',
      label: 'Spectral -> Petals',
      min: 0.0,
      max: 2.0,
      step: 0.1,
      initial: 1.0,
      category: 'audio-mapping',
      description: 'How spectral centroid modulates petal count',
    },
    {
      key: 'rmsToGlow',
      label: 'RMS -> Glow',
      min: 0.0,
      max: 2.0,
      step: 0.1,
      initial: 1.0,
      category: 'audio-mapping',
      description: 'How volume boosts glow',
    },
  ],
  viewport: { pan: false, zoom: true, orbit: false },
  viewStateFields: [
    { key: 'zoom', label: 'Zoom', min: 0.3, max: 4.0, step: 0.05 },
  ],
};

export class SpirographVisualizer extends CurveVisualizer {
  constructor(bus: MessageBus) {
    super(spirographMetadata, bus, {
      speed: (c) => c.params.rotationSpeed,
      phaseRates: (c) => ({ morph: c.params.morphSpeed }),
      width: (c) => c.params.lineWidth,
      layers: (c) => {
        const p = c.params,
          a = c.audio;
        const R = c.topology(
          'R',
          p.bigRadius + a.spectralCentroid * 3 * p.spectralToPetals,
          2,
          12,
        );
        const r = c.topology(
          'r',
          p.smallRadius + a.mid * p.midToRatio,
          1,
          R - 1,
        );
        return Array.from({ length: Math.round(p.layers) }, (_, i) => {
          const d =
            r *
            (0.5 +
              0.2 * Math.sin(c.phases.morph) +
              0.25 * a.bass * p.bassToPen) *
            (1 - i * 0.08);
          const angle = c.phase + i * 0.2,
            scale = 0.38 / (R + r + d);
          return {
            period: roulettePeriod(R, r),
            seeds: 64 * (R + r),
            hue: i * 0.2 + c.time * 0.025,
            brightness:
              (p.brightness * (0.5 + a.rms * p.rmsToGlow)) /
              Math.sqrt(p.layers),
            point: (t: number) => {
              const [x, y] = roulettePoint(t, R, r, d, p.rouletteType > 0.5);
              return [
                scale * (x * Math.cos(angle) - y * Math.sin(angle)),
                scale * (x * Math.sin(angle) + y * Math.cos(angle)),
              ] as const;
            },
          };
        });
      },
    });
  }
}
registerVisualizer({
  metadata: spirographMetadata,
  create: (bus) => new SpirographVisualizer(bus),
});
