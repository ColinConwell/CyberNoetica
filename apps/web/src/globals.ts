import type { MessageBus, Store } from '@cybernoetica/core';
import type { SceneManager } from '@cybernoetica/renderer';

// ---------------------------------------------------------------------------
// Typed Global State
//
// The app exposes runtime state on `window.__cybernoetica` for the debug/control
// panels to read. This module provides typed accessors so UI code doesn't need
// `(window as any)` casts.
// ---------------------------------------------------------------------------

export interface CyberNoeticaGlobals {
  store: Store<any>;
  bus: MessageBus;
  scene: SceneManager;
  playback?: {
    state: string;
    isPlaying: boolean;
    isPaused: boolean;
  };
  vizManager?: {
    getActive(): any;
    getActiveType(): string;
    switchTo(type: string): any;
  };
  powerSaver: boolean;
  setPowerSaver: (enabled: boolean) => void;
}

export interface CyberNoeticaDebugInfo {
  fps: number;
  frameTime: number;
  vizType: string;
  playbackState?: string;
}

declare global {
  interface Window {
    __cybernoetica?: CyberNoeticaGlobals;
    __cybernoetica_debug?: CyberNoeticaDebugInfo;
    __cybernoetica_debug_enabled?: boolean;
  }
}

export function getGlobals(): CyberNoeticaGlobals | null {
  return window.__cybernoetica ?? null;
}

export function getDebugInfo(): CyberNoeticaDebugInfo | null {
  return window.__cybernoetica_debug ?? null;
}

export function isDebugFlagSet(): boolean {
  return !!window.__cybernoetica_debug_enabled;
}
