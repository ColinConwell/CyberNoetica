import type { MessageBus } from '@cybernoetica/core';
import type { Visualizer, VisualizerMetadata, ViewportCapabilities } from './types.js';
import { VISUALIZER_MANIFEST, getManifestEntry, listManifestTypes } from './manifest.js';

export interface VisualizerEntry {
  metadata: VisualizerMetadata;
  create(bus: MessageBus): Visualizer;
}

const entries = new Map<string, VisualizerEntry>();
const pendingLoads = new Map<string, Promise<VisualizerEntry>>();

export function registerVisualizer(entry: VisualizerEntry): void {
  entries.set(entry.metadata.type, entry);
}

export function getVisualizerEntry(type: string): VisualizerEntry | undefined {
  return entries.get(type);
}

/**
 * Catalog of all visualizers. Returns real metadata for already-loaded entries,
 * and a stub metadata (from the manifest) for those that haven't been loaded yet.
 * The UI can render the picker from this without triggering any dynamic imports.
 */
export function listVisualizers(): VisualizerMetadata[] {
  const defaultViewport: ViewportCapabilities = { pan: true, zoom: true, orbit: false };
  const orbitViewport: ViewportCapabilities = { pan: false, zoom: true, orbit: true };
  return VISUALIZER_MANIFEST.map(m => {
    const loaded = entries.get(m.type);
    if (loaded) return loaded.metadata;
    return {
      type: m.type,
      label: m.label,
      description: m.description,
      usesPerspective: m.usesPerspective,
      params: [],
      viewport: m.usesPerspective ? orbitViewport : defaultViewport,
      viewStateFields: [],
    };
  });
}

export function getVisualizerTypes(): string[] {
  // Stable order from the manifest; loaded state doesn't affect identity.
  return listManifestTypes();
}

/**
 * Lazy loader. Returns the entry immediately if already registered; otherwise
 * runs the manifest's dynamic import (which triggers the target module's
 * self-registration) and returns once registered.
 */
export async function loadVisualizer(type: string): Promise<VisualizerEntry | undefined> {
  const existing = entries.get(type);
  if (existing) return existing;

  const manifestEntry = getManifestEntry(type);
  if (!manifestEntry) return undefined;

  const pending = pendingLoads.get(type);
  if (pending) return pending;

  const p = manifestEntry.loader().then(() => {
    pendingLoads.delete(type);
    return entries.get(type);
  }).catch((err) => {
    pendingLoads.delete(type);
    throw err;
  }) as Promise<VisualizerEntry>;

  pendingLoads.set(type, p);
  return p;
}

export function isVisualizerLoaded(type: string): boolean {
  return entries.has(type);
}
