import type { MessageBus } from '@cybernoetica/core';
import { registerVisualizer } from '../registry.js';
import { GridSimulationVisualizer } from '../simulation/engine.js';
import { gridMetadata } from '../simulation/metadata.js';
const metadata = gridMetadata(
  'automata-beta',
  'Conway Life',
  'Persistent B3/S23 cellular automaton with onset seeding',
  false,
);
export class ConwayLifeVisualizer extends GridSimulationVisualizer {
  constructor(bus: MessageBus) {
    super(metadata, bus, 'life');
  }
}
registerVisualizer({
  metadata,
  create: (bus) => new ConwayLifeVisualizer(bus),
});
