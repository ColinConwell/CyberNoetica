import type { MessageBus } from '@cybernoetica/core';
import type { Visualizer, VisualizerMetadata } from './types.js';

export interface VisualizerEntry {
  metadata: VisualizerMetadata;
  create(bus: MessageBus): Visualizer;
}

const entries = new Map<string, VisualizerEntry>();

export function registerVisualizer(entry: VisualizerEntry): void {
  entries.set(entry.metadata.type, entry);
}

export function getVisualizerEntry(type: string): VisualizerEntry | undefined {
  return entries.get(type);
}

export function listVisualizers(): VisualizerMetadata[] {
  return Array.from(entries.values()).map(e => e.metadata);
}

export function getVisualizerTypes(): string[] {
  return Array.from(entries.keys());
}
