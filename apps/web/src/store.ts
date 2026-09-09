import { createStore } from '@cybernoetica/core';
import type { Store } from '@cybernoetica/core';

export type QualityMode =
  | 'auto'
  | 'sub-performance'
  | 'performance'
  | 'balanced'
  | 'high'
  | 'ultra';

export interface AppState {
  visualizer: {
    type: string;
    userParams: Record<string, number>;
  };
  audio: {
    source: 'file' | 'mic' | 'system' | 'soundscape' | 'none';
    trackName: string;
    playing: boolean;
    wasm: boolean;
    backend: 'worklet' | 'main-thread';
  };
  viewport: {
    panX: number;
    panY: number;
    zoom: number;
  };
  ui: {
    activePanel: string | null;
    autoPlay: boolean;
    shuffle: boolean;
    quality: QualityMode;
    reducedMotion: boolean;
    reduceFlashes: boolean;
  };
}

const STORAGE_KEY = 'cybernoetica:state';

const INITIAL_STATE: AppState = {
  visualizer: { type: '', userParams: {} },
  audio: {
    source: 'none',
    trackName: '',
    playing: false,
    wasm: false,
    backend: 'main-thread',
  },
  viewport: { panX: 0, panY: 0, zoom: 1 },
  ui: {
    activePanel: null,
    autoPlay: true,
    shuffle: true,
    quality: 'auto',
    reducedMotion: false,
    reduceFlashes: false,
  },
};

export function createAppStore(): Store<AppState> {
  const saved = loadFromStorage();
  const motionDefault =
    typeof window !== 'undefined' &&
    window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;
  const initial: AppState = {
    ...INITIAL_STATE,
    ui: {
      ...INITIAL_STATE.ui,
      reducedMotion: motionDefault,
      reduceFlashes: motionDefault,
      ...saved?.ui,
    },
  };

  const store = createStore(initial);

  store.subscribe((state) => {
    saveToStorage(state);
  });

  return store;
}

function saveToStorage(state: Readonly<AppState>): void {
  try {
    const persistable = {
      ui: {
        autoPlay: state.ui.autoPlay,
        shuffle: state.ui.shuffle,
        quality: state.ui.quality,
        reducedMotion: state.ui.reducedMotion,
        reduceFlashes: state.ui.reduceFlashes,
      },
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(persistable));
  } catch {
    /* localStorage unavailable */
  }
}

function loadFromStorage(): Partial<AppState> | null {
  try {
    const json = localStorage.getItem(STORAGE_KEY);
    if (!json) return null;
    const value = JSON.parse(json);
    const ui = value?.ui;
    if (!ui || typeof ui !== 'object') return null;
    const safe: Partial<AppState['ui']> = {};
    for (const key of [
      'autoPlay',
      'shuffle',
      'reducedMotion',
      'reduceFlashes',
    ] as const) {
      if (typeof ui[key] === 'boolean') safe[key] = ui[key];
    }
    if (
      [
        'auto',
        'sub-performance',
        'performance',
        'balanced',
        'high',
        'ultra',
      ].includes(ui.quality)
    )
      safe.quality = ui.quality;
    return { ui: safe as AppState['ui'] };
  } catch {
    return null;
  }
}
