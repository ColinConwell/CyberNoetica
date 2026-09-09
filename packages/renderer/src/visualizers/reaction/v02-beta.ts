import type { MessageBus } from '@cybernoetica/core';
import { registerVisualizer } from '../registry.js';
import { GridSimulationVisualizer } from '../simulation/engine.js';
import { gridMetadata } from '../simulation/metadata.js';
const metadata = gridMetadata(
  'reaction-beta',
  'Gray–Scott',
  'Persistent two-reagent reaction-diffusion on a periodic grid',
  true,
);
export class GrayScottVisualizer extends GridSimulationVisualizer {
  constructor(bus: MessageBus) {
    super(metadata, bus, 'reaction');
  }
}
registerVisualizer({ metadata, create: (bus) => new GrayScottVisualizer(bus) });
