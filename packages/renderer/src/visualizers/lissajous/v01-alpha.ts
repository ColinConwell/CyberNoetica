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

const lissajousMetadata: VisualizerMetadata = {
  type: 'lissajous',
  label: 'Lissajous',
  description: 'Oscilloscope light curves',
  usesPerspective: false,
  params: [
    {
      key: 'pitchToRatio',
      label: 'Pitch → Rational ratio',
      min: 0,
      max: 1,
      step: 1,
      initial: 0,
      category: 'audio-mapping',
      description:
        'Confident pitch selects the nearest small rational interval above A3',
    },
    {
      key: 'stereoToPhase',
      label: 'Stereo → Phase',
      min: 0,
      max: 1,
      step: 0.1,
      initial: 1,
      category: 'audio-mapping',
      description: 'Dominant-bin channel phase difference offsets X',
    },
    // Appearance
    {
      key: 'complexity',
      label: 'Complexity',
      min: 0,
      max: 7,
      step: 1,
      initial: 2,
      category: 'appearance',
    },
    {
      key: 'trailLength',
      label: 'Trail Length',
      min: 128,
      max: 512,
      step: 16,
      initial: 480,
      category: 'appearance',
    },
    {
      key: 'glowWidth',
      label: 'Glow Width',
      min: 0.5,
      max: 4.0,
      step: 0.25,
      initial: 2.0,
      category: 'appearance',
    },
    {
      key: 'damping',
      label: 'Damping',
      min: 0.0,
      max: 0.5,
      step: 0.02,
      initial: 0.03,
      category: 'appearance',
    },
    {
      key: 'rotationSpeed',
      label: 'Rotation',
      min: 0.0,
      max: 0.5,
      step: 0.02,
      initial: 0.06,
      category: 'appearance',
    },
    // Audio mapping
    {
      key: 'bassToAmplitude',
      label: 'Bass → Amplitude',
      min: 0.0,
      max: 2.0,
      step: 0.1,
      initial: 1.0,
      category: 'audio-mapping',
      description: 'How strongly bass affects curve size',
    },
    {
      key: 'spectralToRatio',
      label: 'Spectral → Ratio',
      min: 0.0,
      max: 2.0,
      step: 0.1,
      initial: 1.0,
      category: 'audio-mapping',
      description: 'How strongly spectral centroid shifts frequency ratios',
    },
    {
      key: 'rmsToGlow',
      label: 'RMS → Glow',
      min: 0.0,
      max: 2.0,
      step: 0.1,
      initial: 1.0,
      category: 'audio-mapping',
      description: 'How strongly volume affects trail brightness',
    },
    {
      key: 'beatToBloom',
      label: 'Beat → Bloom',
      min: 0.0,
      max: 2.0,
      step: 0.1,
      initial: 1.0,
      category: 'audio-mapping',
      description: 'How strongly beats trigger fresh curve bloom',
    },
  ],
  viewport: { pan: true, zoom: true, orbit: false },
  viewStateFields: [
    { key: 'centerX', label: 'Center X', min: -2, max: 2, step: 0.01 },
    { key: 'centerY', label: 'Center Y', min: -2, max: 2, step: 0.01 },
    { key: 'zoom', label: 'Zoom', min: 0.3, max: 3.0, step: 0.05 },
    {
      key: 'phase',
      label: 'Phase',
      min: 0,
      max: 6.283,
      step: 0.01,
      readOnly: true,
    },
  ],
};

export class LissajousVisualizer extends CurveVisualizer {
  constructor(bus: MessageBus) {
    super(lissajousMetadata, bus, {
      speed: (c) => c.params.rotationSpeed,
      width: (c) => c.params.glowWidth,
      layers: (c) => {
        const p = c.params,
          a = c.audio;
        const ratios = [
          [1, 1],
          [1, 2],
          [2, 3],
          [3, 4],
          [3, 5],
          [5, 6],
          [5, 7],
          [7, 9],
        ];
        let index = c.topology(
          'ratio',
          p.complexity + a.spectralCentroid * 2 * p.spectralToRatio,
          0,
          7,
        );
        if (p.pitchToRatio > 0 && (c.features?.pitchConfidence ?? 0) > 0.8) {
          const pitch = c.features?.pitchHz ?? 220;
          const target =
            2 ** (((((12 * Math.log2(pitch / 220)) % 12) + 12) % 12) / 12);
          index = ratios.reduce(
            (best, r, i) =>
              Math.abs(r[1] / r[0] - target) <
              Math.abs(ratios[best][1] / ratios[best][0] - target)
                ? i
                : best,
            0,
          );
        }
        const [x, y] = ratios[index];
        const phase =
          Math.PI / 4 +
          (c.features?.stereoPhase ?? 0) * p.stereoToPhase +
          c.phase;
        const amp =
          (0.3 + a.bass * 0.12 * p.bassToAmplitude) *
          (1 - 0.12 * Math.min(1, c.age * p.damping));
        return [
          {
            period: TAU,
            seeds: Math.max(64, p.trailLength),
            hue: c.time * 0.025 + a.spectralCentroid * 0.2,
            brightness:
              0.6 + a.rms * p.rmsToGlow + c.beat * 0.2 * p.beatToBloom,
            point: (t) => [
              amp * Math.sin(x * t + phase),
              amp * Math.sin(y * t),
            ],
          },
        ];
      },
    });
  }
}
registerVisualizer({
  metadata: lissajousMetadata,
  create: (bus) => new LissajousVisualizer(bus),
});
