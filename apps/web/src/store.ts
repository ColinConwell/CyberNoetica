import { createStore } from '@cybernoetica/core';
import type { Store } from '@cybernoetica/core';

export interface AppState {
  visualizer: {
    type: string;
    userParams: Record<string, number>;
  };
  audio: {
    source: 'file' | 'mic' | 'system' | 'none';
    trackName: string;
    playing: boolean;
    wasm: boolean;
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
  };
}

const STORAGE_KEY = 'cybernoetica:state';

const INITIAL_STATE: AppState = {
  visualizer: { type: '', userParams: {} },
  audio: { source: 'none', trackName: '', playing: false, wasm: false },
  viewport: { panX: 0, panY: 0, zoom: 1 },
  ui: { activePanel: null, autoPlay: true, shuffle: true },
};

export function createAppStore(): Store<AppState> {
  const saved = loadFromStorage();
  const initial = saved
    ? { ...INITIAL_STATE, ...saved, audio: { ...INITIAL_STATE.audio }, visualizer: { ...INITIAL_STATE.visualizer } }
    : INITIAL_STATE;

  const store = createStore(initial);

  store.subscribe((state) => {
    saveToStorage(state);
  });

  return store;
}

function saveToStorage(state: Readonly<AppState>): void {
  try {
    const persistable = {
      ui: { autoPlay: state.ui.autoPlay, shuffle: state.ui.shuffle },
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(persistable));
  } catch { /* localStorage unavailable */ }
}

function loadFromStorage(): Partial<AppState> | null {
  try {
    const json = localStorage.getItem(STORAGE_KEY);
    return json ? JSON.parse(json) : null;
  } catch { return null; }
}
