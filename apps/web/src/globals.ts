import type { MessageBus, Store } from '@cybernoetica/core';
import type { SceneManager, QualityTier } from '@cybernoetica/renderer';
import type { QualityMode } from './store.js';

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
    switchTo(type: string): Promise<any>;
  };
  powerSaver: boolean;
  setPowerSaver: (enabled: boolean) => void;
  quality?: {
    getMode(): QualityMode;
    getTier(): QualityTier;
    setMode(mode: QualityMode): void;
    cycle(): void;
  };
}

export interface CyberNoeticaDebugInfo {
  fps: number;
  frameTime: number;
  vizType: string;
  playbackState?: string;
  qualityTier?: string;
  qualityMode?: string;
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
