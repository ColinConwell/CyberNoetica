import { createTransitionAdapter } from '../journey/adapter.js';
import type { TransitionAdapter } from '../journey/types.js';
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
  createTransitionAdapter?: (
    visualizer: Visualizer,
    count: number,
  ) => TransitionAdapter;
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
  if (manifest?.transition) {
    entry.metadata.params = entry.metadata.params.map((p) => ({
      ...p,
      max:
        p.category === 'audio-mapping' &&
        p.step < 1 &&
        /Amplitude|Drive|Speed|Rotation|Radius|Kick|Freq|Pen|Amp|Damping|bassResponse/.test(
          p.key,
        )
          ? p.max * 2
          : p.max,
    }));
    entry.metadata.params.push({
      key: 'audioSensitivity',
      label: 'Audio sensitivity',
      min: 0,
      max: 8,
      step: 0.1,
      initial: 2.5,
      category: 'audio-mapping',
      description:
        'Boost quiet band motion with a bounded response; 1 restores linear levels. Pitch, spectrum and onset detection stay calibrated.',
    });
  }
  const create = entry.create;
  entries.set(entry.metadata.type, {
    ...entry,
    createTransitionAdapter: manifest?.transition
      ? (visualizer, count) => {
          if (!visualizer.getTransitionComponents)
            throw new Error('Missing transition geometry');
          return createTransitionAdapter(
            {
              getTransitionComponents: () =>
                visualizer.getTransitionComponents!(),
            },
            count,
          );
        }
      : entry.createTransitionAdapter,
    create(bus) {
      const visualizer = create(bus);
      const values = Object.fromEntries(
        visualizer.metadata.params.map((p) => [p.key, p.initial]),
      );
      visualizer.getUserParams = () => ({ ...values });
      const setParam = visualizer.setUserParam.bind(visualizer);
      visualizer.setUserParam = (key, value) => {
        const definition = visualizer.metadata.params.find(
          (param) => param.key === key,
        );
        if (!definition || !Number.isFinite(value)) return;
        values[key] = Math.max(definition.min, Math.min(definition.max, value));
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
  const builtins = VISUALIZER_MANIFEST.map((m) => {
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
  return [
    ...builtins,
    ...Array.from(entries.values())
      .filter((e) => e.metadata.type.startsWith('studio-'))
      .map((e) => e.metadata),
  ];
}

export function getVisualizerTypes(): string[] {
  // Stable order from the manifest; loaded state doesn't affect identity.
  return [
    ...listManifestTypes(),
    ...Array.from(entries.keys()).filter((type) => type.startsWith('studio-')),
  ];
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
