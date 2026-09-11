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

const harmonographMetadata: VisualizerMetadata = {
  type: 'harmonograph',
  label: 'Harmonograph',
  description: 'Damped pendulum spirograph patterns',
  usesPerspective: false,
  params: [
    // Appearance
    {
      key: 'freqRatio',
      label: 'Freq Ratio',
      min: 0.5,
      max: 4.0,
      step: 0.25,
      initial: 1.5,
      category: 'appearance',
      description: 'Frequency ratio between X and Y pendulums',
    },
    {
      key: 'damping',
      label: 'Damping',
      min: 0.0,
      max: 0.02,
      step: 0.001,
      initial: 0.004,
      category: 'appearance',
      description: 'Pendulum energy decay rate',
    },
    {
      key: 'trailLength',
      label: 'Trail Length',
      min: 200,
      max: 2000,
      step: 50,
      initial: 800,
      category: 'appearance',
      description: 'Number of curve samples rendered',
    },
    {
      key: 'lineGlow',
      label: 'Line Glow',
      min: 0.3,
      max: 2.0,
      step: 0.05,
      initial: 1.0,
      category: 'appearance',
      description: 'Brightness of the curve',
    },
    {
      key: 'rotaryFreq',
      label: 'Rotary Freq',
      min: 0.0,
      max: 2.0,
      step: 0.05,
      initial: 0.3,
      category: 'appearance',
      description: 'Third pendulum rotation frequency',
    },
    {
      key: 'colorCycle',
      label: 'Color Cycle',
      min: 0.0,
      max: 1.0,
      step: 0.05,
      initial: 0.3,
      category: 'appearance',
      description: 'Hue cycling speed along the curve',
    },
    // Audio mapping
    {
      key: 'bassToFreq',
      label: 'Bass -> Freq',
      min: 0.0,
      max: 2.0,
      step: 0.1,
      initial: 1.0,
      category: 'audio-mapping',
      description: 'Bass modulates frequency ratio',
    },
    {
      key: 'midToDamping',
      label: 'Mid -> Sustain',
      min: 0.0,
      max: 2.0,
      step: 0.1,
      initial: 1.0,
      category: 'audio-mapping',
      description: 'Mids reduce damping (more sustain)',
    },
    {
      key: 'spectralToPhase',
      label: 'Spectral -> Phase',
      min: 0.0,
      max: 2.0,
      step: 0.1,
      initial: 1.0,
      category: 'audio-mapping',
      description: 'Spectral centroid shifts phase offset',
    },
    {
      key: 'rmsToGlow',
      label: 'RMS -> Glow',
      min: 0.0,
      max: 2.0,
      step: 0.1,
      initial: 1.0,
      category: 'audio-mapping',
      description: 'Volume drives curve brightness',
    },
  ],
  viewport: { pan: false, zoom: true, orbit: false },
  viewStateFields: [
    { key: 'zoom', label: 'Zoom', min: 0.3, max: 4.0, step: 0.05 },
  ],
};

export class HarmonographVisualizer extends CurveVisualizer {
  constructor(bus: MessageBus) {
    super(harmonographMetadata, bus, {
      speed: (c) => 0.02,
      width: (c) => 1.25 + c.params.lineGlow,
      layers: (c) => {
        const p = c.params,
          a = c.audio;
        const ratio =
          c.topology(
            'ratio',
            p.freqRatio * 4 + a.bass * 2 * p.bassToFreq,
            2,
            20,
          ) / 4;
        const damping = p.damping / (1 + a.mid * p.midToDamping);
        // Finite-age trace; onset re-excitation changes the envelope, never absolute-time underflow.
        const age = Math.min(c.age, 15),
          phase = a.spectralCentroid * p.spectralToPhase + Math.PI / 4;
        return [
          {
            period: 30,
            seeds: Math.min(1800, p.trailLength),
            hue: c.time * 0.025,
            brightness: (0.6 + a.rms * p.rmsToGlow) * p.lineGlow,
            point: (t) => {
              const decay = Math.exp(-damping * (t + age) * 5),
                angle = p.rotaryFreq * t * 0.1;
              const x = 0.31 * Math.sin(2 * t + phase) * decay,
                y = 0.31 * Math.sin(2 * ratio * t) * decay;
              return [
                x * Math.cos(angle) - y * Math.sin(angle),
                x * Math.sin(angle) + y * Math.cos(angle),
              ];
            },
          },
        ];
      },
    });
  }
}
registerVisualizer({
  metadata: harmonographMetadata,
  create: (bus) => new HarmonographVisualizer(bus),
});
