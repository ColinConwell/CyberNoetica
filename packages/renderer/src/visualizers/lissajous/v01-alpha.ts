import type { MessageBus } from '@cybernoetica/core';
import type { VisualizerMetadata } from '../types.js';
import { registerVisualizer } from '../registry.js';
import { CurveVisualizer } from '../curves/engine.js';
import { TAU } from '../../geometry/curves.js';
import type { CurveLayer } from '../curves/engine.js';

const lissajousMetadata: VisualizerMetadata = {
  type: 'lissajous',
  label: 'Lissajous',
  description: 'Oscilloscope light curves',
  usesPerspective: false,
  params: [
    {
      key: 'expression',
      label: 'Shape expression',
      min: 0,
      max: 2,
      step: 0.05,
      initial: 1,
      category: 'appearance',
      description:
        'Layer separation, local phase ripples and onset twists. Zero restores an unwarped harmonic curve.',
    },
    {
      key: 'echoes',
      label: 'Echo curves',
      min: 1,
      max: 6,
      step: 1,
      initial: 4,
      category: 'appearance',
    },
    {
      key: 'traceTravel',
      label: 'Trace travel',
      min: 0,
      max: 4,
      step: 0.1,
      initial: 1.2,
      category: 'appearance',
      description:
        'Moving luminous heads along the curves; zero hides heads and makes light uniform.',
    },
    {
      key: 'midToFlow',
      label: 'Mid → Shape flow',
      min: 0,
      max: 4,
      step: 0.1,
      initial: 1.4,
      category: 'audio-mapping',
      description:
        'Mids accelerate continuous phase evolution and separate the echoes.',
    },
    {
      key: 'highToRipple',
      label: 'Treble → Ripples',
      min: 0,
      max: 3,
      step: 0.1,
      initial: 1,
      category: 'audio-mapping',
      description:
        'Treble bends local sections of the curve with traveling phase ripples.',
    },
    {
      key: 'onsetToTwist',
      label: 'Onset → Twist',
      min: 0,
      max: 3,
      step: 0.1,
      initial: 0.8,
      category: 'audio-mapping',
      description:
        'Short twists displace the echoes after each detected attack.',
    },
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
      speed: (c) =>
        c.params.rotationSpeed +
        c.params.expression * (0.18 + c.audio.mid * c.params.midToFlow * 2.4),
      phaseRates: (c) => ({
        ripple: 0.7 + c.audio.high * c.params.highToRipple * 3,
        travel: c.params.traceTravel * (1 + c.audio.mid * c.params.midToFlow),
      }),
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
        const expression = p.expression;
        const count = Math.round(p.echoes);
        const phase =
          Math.PI / 4 +
          (c.features?.stereoPhase ?? 0) * p.stereoToPhase +
          c.phase;
        const amp =
          (0.24 + a.bass * 0.14 * p.bassToAmplitude) *
          (1 - 0.12 * Math.min(1, c.age * p.damping));
        const ripple =
          expression * Math.min(1.2, a.high * p.highToRipple * 0.9);
        const twist = expression * c.beat * p.onsetToTwist * 0.45;
        const layers: CurveLayer[] = [];
        for (let i = 0; i < count; i++) {
          const lag =
            i * (0.22 + expression * 0.2 + a.mid * p.midToFlow * 0.25);
          const angle = expression * (i - (count - 1) / 2) * (0.12 + twist);
          const size = amp * Math.pow(0.88, i);
          const co = Math.cos(angle),
            si = Math.sin(angle);
          const point = (t: number): readonly [number, number] => {
            const bend = ripple * Math.sin(3 * t - c.phases.ripple + i * 0.7);
            const px = size * Math.sin(x * t + phase - lag + bend);
            const py =
              size *
              (1 + expression * a.bass * 0.25 * p.bassToAmplitude) *
              Math.sin(
                y * t -
                  phase * expression * 0.35 +
                  lag * 0.65 -
                  bend * 0.7 +
                  twist * Math.sin(2 * t + i),
              );
            return [px * co - py * si, px * si + py * co];
          };
          const head = (c.phases.travel + i * 0.65) % TAU;
          const hue = c.time * 0.025 + a.spectralCentroid * 0.2 + i * 0.055;
          layers.push({
            id: `lissajous-echo-${i}`,
            sampling: 'uniform',
            period: TAU,
            seeds: Math.max(128, p.trailLength),
            hue,
            brightness:
              (0.8 + a.rms * p.rmsToGlow + c.beat * 0.2 * p.beatToBloom) *
              Math.pow(0.78, i),
            intensity:
              p.traceTravel > 0
                ? (t) => 0.3 + 1.4 * Math.exp((Math.cos(t - head) - 1) * 7)
                : undefined,
            point,
          });
          if (p.traceTravel > 0) {
            const center = point(head),
              radius = 0.0045 * (1 + a.high * 0.5);
            layers.push({
              id: `lissajous-head-${i}`,
              sampling: 'uniform',
              period: TAU,
              seeds: 16,
              hue,
              brightness: 1.8 * Math.pow(0.8, i),
              point: (t) => [
                center[0] + Math.cos(t) * radius,
                center[1] + Math.sin(t) * radius,
              ],
            });
          }
        }
        return layers;
      },
    });
  }
}
registerVisualizer({
  metadata: lissajousMetadata,
  create: (bus) => new LissajousVisualizer(bus),
});
