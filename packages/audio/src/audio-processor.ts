import { MessageBus } from '@cybernoetica/core';
import type { AudioFeatures } from '@cybernoetica/core';

export class AudioProcessor {
  private bus: MessageBus;

  constructor(bus: MessageBus) {
    this.bus = bus;
  }

  pushFeatures(features: AudioFeatures): void {
    this.bus.publish('audio:features', features);
  }

  pushError(message: string, fallback: boolean): void {
    this.bus.publish('audio:error', { message, fallback });
  }
}
