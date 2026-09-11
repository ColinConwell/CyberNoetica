import type { VisualizerMetadata } from '../types.js';
export function gridMetadata(
  type: string,
  label: string,
  description: string,
  reaction: boolean,
): VisualizerMetadata {
  return {
    type,
    label,
    description,
    usesPerspective: false,
    params: [
      {
        key: 'simulationSpeed',
        label: 'Simulation speed',
        min: 0.25,
        max: 2,
        step: 0.05,
        initial: 1,
        category: 'appearance',
      },
      ...(reaction
        ? [
            {
              key: 'pattern',
              label: 'Pattern (spots / coral / worms)',
              min: 0,
              max: 2,
              step: 1,
              initial: 0,
              category: 'appearance' as const,
            },
            {
              key: 'timbreToFeed',
              label: 'Timbre → feed rate',
              min: 0,
              max: 1,
              step: 0.05,
              initial: 0.5,
              category: 'audio-mapping' as const,
              description:
                'A small, slowly filtered change to feed rate; kill rate follows the selected preset.',
            },
          ]
        : []),
      {
        key: 'onsetInjection',
        label: reaction ? 'Onsets inject reagent' : 'Onsets seed cells',
        min: 0,
        max: 1,
        step: 1,
        initial: 1,
        category: 'audio-mapping',
      },
      {
        key: 'rmsToGlow',
        label: 'RMS → brightness',
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
      { key: 'zoom', label: 'Zoom', min: 0.25, max: 4, step: 0.05 },
      {
        key: 'generation',
        label: 'Simulation steps',
        min: 0,
        max: 1e9,
        step: 1,
        readOnly: true,
      },
    ],
  };
}
