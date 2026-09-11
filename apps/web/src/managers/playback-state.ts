import type { MessageBus } from '@cybernoetica/core';

// ---------------------------------------------------------------------------
// Playback States and Transitions
// ---------------------------------------------------------------------------

export type PlaybackState =
  | 'idle'
  | 'loading'
  | 'playing'
  | 'paused'
  | 'switching-source';

export type PlaybackAction =
  | { type: 'START' }
  | { type: 'LOADED' }
  | { type: 'ERROR'; error?: string }
  | { type: 'PAUSE' }
  | { type: 'RESUME' }
  | { type: 'NEXT_TRACK' }
  | { type: 'SELECT_TRACK' }
  | {
      type: 'SWITCH_SOURCE';
      source: 'none' | 'file' | 'mic' | 'system' | 'soundscape';
    }
  | { type: 'SOURCE_READY' };

const VALID_TRANSITIONS: Record<PlaybackState, Set<PlaybackAction['type']>> = {
  idle: new Set(['START']),
  loading: new Set(['LOADED', 'ERROR', 'SELECT_TRACK', 'SWITCH_SOURCE']),
  playing: new Set(['PAUSE', 'NEXT_TRACK', 'SELECT_TRACK', 'SWITCH_SOURCE']),
  paused: new Set(['RESUME', 'SELECT_TRACK', 'SWITCH_SOURCE']),
  'switching-source': new Set([
    'SOURCE_READY',
    'ERROR',
    'SWITCH_SOURCE',
    'SELECT_TRACK',
  ]),
};

function nextState(
  current: PlaybackState,
  action: PlaybackAction,
): PlaybackState | null {
  if (!VALID_TRANSITIONS[current].has(action.type)) return null;

  switch (action.type) {
    case 'START':
      return 'loading';
    case 'LOADED':
      return 'playing';
    case 'ERROR':
      return current === 'switching-source' ? 'idle' : 'idle';
    case 'PAUSE':
      return 'paused';
    case 'RESUME':
      return 'playing';
    case 'NEXT_TRACK':
      return 'loading';
    case 'SELECT_TRACK':
      return 'loading';
    case 'SWITCH_SOURCE':
      return 'switching-source';
    case 'SOURCE_READY':
      return 'playing';
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// Playback State Machine
// ---------------------------------------------------------------------------

export type PlaybackStateChangeHandler = (
  newState: PlaybackState,
  oldState: PlaybackState,
  action: PlaybackAction,
) => void;

export class PlaybackStateMachine {
  private _state: PlaybackState = 'idle';
  private _listeners: PlaybackStateChangeHandler[] = [];
  private _bus: MessageBus | null = null;

  constructor(bus?: MessageBus) {
    this._bus = bus ?? null;
  }

  get state(): PlaybackState {
    return this._state;
  }

  get isPlaying(): boolean {
    return this._state === 'playing';
  }

  get isLoading(): boolean {
    return this._state === 'loading';
  }

  get isPaused(): boolean {
    return this._state === 'paused';
  }

  get isIdle(): boolean {
    return this._state === 'idle';
  }

  dispatch(action: PlaybackAction): boolean {
    const next = nextState(this._state, action);
    if (next === null) {
      console.warn(
        `PlaybackState: invalid transition ${this._state} -> ${action.type}`,
      );
      return false;
    }

    const prev = this._state;
    this._state = next;

    for (const listener of this._listeners) {
      try {
        listener(next, prev, action);
      } catch {
        /* swallow */
      }
    }

    if (this._bus) {
      this._bus.publish('playback:state', {
        state: next,
        previousState: prev,
        action: action.type,
      });
    }

    return true;
  }

  canDispatch(actionType: PlaybackAction['type']): boolean {
    return VALID_TRANSITIONS[this._state].has(actionType);
  }

  onChange(handler: PlaybackStateChangeHandler): () => void {
    this._listeners.push(handler);
    return () => {
      this._listeners = this._listeners.filter((h) => h !== handler);
    };
  }

  reset(): void {
    this._state = 'idle';
  }
}
