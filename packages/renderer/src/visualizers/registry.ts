import type { MessageBus } from '@cybernoetica/core';
import type {
  Visualizer,
  VisualizerMetadata,
  ViewportCapabilities,
} from './types.js';
import {
  VISUALIZER_MANIFEST,
  getManifestEntry,
  listManifestTypes,
} from './manifest.js';

export interface VisualizerEntry {
  metadata: VisualizerMetadata;
  create(bus: MessageBus): Visualizer;
}

const entries = new Map<string, VisualizerEntry>();
const pendingLoads = new Map<string, Promise<VisualizerEntry>>();

export function registerVisualizer(entry: VisualizerEntry): void {
  const manifest = getManifestEntry(entry.metadata.type);
  if (manifest)
    Object.assign(entry.metadata, {
      label: manifest.label,
      description: manifest.description,
      usesPerspective: manifest.usesPerspective,
    });
  // The analyzer detects attacks; it does not estimate a musical beat grid.
  for (const parameter of entry.metadata.params) {
    parameter.label = parameter.label.replace(/\bBeats?\b/g, 'Onset');
    parameter.description = parameter.description
      ?.replace(/\bbeats\b/g, 'onsets')
      .replace(/\bBeats\b/g, 'Onsets')
      .replace(/\bbeat\b/g, 'onset');
  }
  const create = entry.create;
  entries.set(entry.metadata.type, {
    ...entry,
    create(bus) {
      const visualizer = create(bus);
      const setParam = visualizer.setUserParam.bind(visualizer);
      visualizer.setUserParam = (key, value) => {
        const definition = visualizer.metadata.params.find(
          (param) => param.key === key,
        );
        if (!definition || !Number.isFinite(value)) return;
        setParam(
          key,
          Math.max(definition.min, Math.min(definition.max, value)),
        );
      };
      const setView = visualizer.setViewState.bind(visualizer);
      visualizer.setViewState = (partial) => {
        const safe: Record<string, number> = {};
        for (const field of visualizer.metadata.viewStateFields) {
          const value = partial[field.key];
          if (!field.readOnly && Number.isFinite(value))
            safe[field.key] = Math.max(field.min, Math.min(field.max, value));
        }
        setView(safe);
      };
      return visualizer;
    },
  });
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
  const defaultViewport: ViewportCapabilities = {
    pan: true,
    zoom: true,
    orbit: false,
  };
  const orbitViewport: ViewportCapabilities = {
    pan: false,
    zoom: true,
    orbit: true,
  };
  return VISUALIZER_MANIFEST.map((m) => {
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
export async function loadVisualizer(
  type: string,
): Promise<VisualizerEntry | undefined> {
  const existing = entries.get(type);
  if (existing) return existing;

  const manifestEntry = getManifestEntry(type);
  if (!manifestEntry) return undefined;

  const pending = pendingLoads.get(type);
  if (pending) return pending;

  const p = manifestEntry
    .loader()
    .then(() => {
      pendingLoads.delete(type);
      return entries.get(type);
    })
    .catch((err) => {
      pendingLoads.delete(type);
      throw err;
    }) as Promise<VisualizerEntry>;

  pendingLoads.set(type, p);
  return p;
}

export function isVisualizerLoaded(type: string): boolean {
  return entries.has(type);
}
