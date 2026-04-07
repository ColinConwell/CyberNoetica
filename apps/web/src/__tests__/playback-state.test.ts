import { describe, it, expect, vi } from 'vitest';
import { PlaybackStateMachine } from '../managers/playback-state.js';
import type { PlaybackState, PlaybackAction } from '../managers/playback-state.js';

describe('PlaybackStateMachine', () => {
  // ─── Basic transitions ──────────────────────────────────────────

  it('starts in idle state', () => {
    const sm = new PlaybackStateMachine();
    expect(sm.state).toBe('idle');
    expect(sm.isIdle).toBe(true);
    expect(sm.isPlaying).toBe(false);
  });

  it('transitions idle -> loading -> playing', () => {
    const sm = new PlaybackStateMachine();
    expect(sm.dispatch({ type: 'START' })).toBe(true);
    expect(sm.state).toBe('loading');
    expect(sm.isLoading).toBe(true);

    expect(sm.dispatch({ type: 'LOADED' })).toBe(true);
    expect(sm.state).toBe('playing');
    expect(sm.isPlaying).toBe(true);
  });

  it('transitions playing -> paused -> playing', () => {
    const sm = new PlaybackStateMachine();
    sm.dispatch({ type: 'START' });
    sm.dispatch({ type: 'LOADED' });

    expect(sm.dispatch({ type: 'PAUSE' })).toBe(true);
    expect(sm.state).toBe('paused');
    expect(sm.isPaused).toBe(true);

    expect(sm.dispatch({ type: 'RESUME' })).toBe(true);
    expect(sm.state).toBe('playing');
  });

  it('transitions playing -> loading on SELECT_TRACK', () => {
    const sm = new PlaybackStateMachine();
    sm.dispatch({ type: 'START' });
    sm.dispatch({ type: 'LOADED' });

    expect(sm.dispatch({ type: 'SELECT_TRACK' })).toBe(true);
    expect(sm.state).toBe('loading');
  });

  it('transitions playing -> loading on NEXT_TRACK', () => {
    const sm = new PlaybackStateMachine();
    sm.dispatch({ type: 'START' });
    sm.dispatch({ type: 'LOADED' });

    expect(sm.dispatch({ type: 'NEXT_TRACK' })).toBe(true);
    expect(sm.state).toBe('loading');
  });

  it('transitions paused -> loading on SELECT_TRACK', () => {
    const sm = new PlaybackStateMachine();
    sm.dispatch({ type: 'START' });
    sm.dispatch({ type: 'LOADED' });
    sm.dispatch({ type: 'PAUSE' });

    expect(sm.dispatch({ type: 'SELECT_TRACK' })).toBe(true);
    expect(sm.state).toBe('loading');
  });

  // ─── Source switching ───────────────────────────────────────────

  it('transitions playing -> switching-source -> playing', () => {
    const sm = new PlaybackStateMachine();
    sm.dispatch({ type: 'START' });
    sm.dispatch({ type: 'LOADED' });

    expect(sm.dispatch({ type: 'SWITCH_SOURCE', source: 'mic' })).toBe(true);
    expect(sm.state).toBe('switching-source');

    expect(sm.dispatch({ type: 'SOURCE_READY' })).toBe(true);
    expect(sm.state).toBe('playing');
  });

  it('transitions paused -> switching-source -> playing', () => {
    const sm = new PlaybackStateMachine();
    sm.dispatch({ type: 'START' });
    sm.dispatch({ type: 'LOADED' });
    sm.dispatch({ type: 'PAUSE' });

    expect(sm.dispatch({ type: 'SWITCH_SOURCE', source: 'system' })).toBe(true);
    expect(sm.state).toBe('switching-source');

    expect(sm.dispatch({ type: 'SOURCE_READY' })).toBe(true);
    expect(sm.state).toBe('playing');
  });

  it('transitions switching-source -> idle on ERROR', () => {
    const sm = new PlaybackStateMachine();
    sm.dispatch({ type: 'START' });
    sm.dispatch({ type: 'LOADED' });
    sm.dispatch({ type: 'SWITCH_SOURCE', source: 'mic' });

    expect(sm.dispatch({ type: 'ERROR', error: 'Permission denied' })).toBe(true);
    expect(sm.state).toBe('idle');
  });

  // ─── Error handling ─────────────────────────────────────────────

  it('transitions loading -> idle on ERROR', () => {
    const sm = new PlaybackStateMachine();
    sm.dispatch({ type: 'START' });

    expect(sm.dispatch({ type: 'ERROR', error: 'Network error' })).toBe(true);
    expect(sm.state).toBe('idle');
  });

  // ─── Invalid transitions ───────────────────────────────────────

  it('rejects invalid transitions', () => {
    const sm = new PlaybackStateMachine();

    expect(sm.dispatch({ type: 'PAUSE' })).toBe(false);
    expect(sm.state).toBe('idle');

    expect(sm.dispatch({ type: 'RESUME' })).toBe(false);
    expect(sm.state).toBe('idle');

    expect(sm.dispatch({ type: 'LOADED' })).toBe(false);
    expect(sm.state).toBe('idle');

    expect(sm.dispatch({ type: 'NEXT_TRACK' })).toBe(false);
    expect(sm.state).toBe('idle');
  });

  it('rejects PAUSE when already paused', () => {
    const sm = new PlaybackStateMachine();
    sm.dispatch({ type: 'START' });
    sm.dispatch({ type: 'LOADED' });
    sm.dispatch({ type: 'PAUSE' });

    expect(sm.dispatch({ type: 'PAUSE' })).toBe(false);
    expect(sm.state).toBe('paused');
  });

  it('rejects RESUME when playing', () => {
    const sm = new PlaybackStateMachine();
    sm.dispatch({ type: 'START' });
    sm.dispatch({ type: 'LOADED' });

    expect(sm.dispatch({ type: 'RESUME' })).toBe(false);
    expect(sm.state).toBe('playing');
  });

  it('rejects NEXT_TRACK when paused (auto-advance guard)', () => {
    const sm = new PlaybackStateMachine();
    sm.dispatch({ type: 'START' });
    sm.dispatch({ type: 'LOADED' });
    sm.dispatch({ type: 'PAUSE' });

    expect(sm.dispatch({ type: 'NEXT_TRACK' })).toBe(false);
    expect(sm.state).toBe('paused');
  });

  // ─── canDispatch ────────────────────────────────────────────────

  it('canDispatch reports valid transitions correctly', () => {
    const sm = new PlaybackStateMachine();
    expect(sm.canDispatch('START')).toBe(true);
    expect(sm.canDispatch('PAUSE')).toBe(false);
    expect(sm.canDispatch('LOADED')).toBe(false);

    sm.dispatch({ type: 'START' });
    expect(sm.canDispatch('LOADED')).toBe(true);
    expect(sm.canDispatch('ERROR')).toBe(true);
    expect(sm.canDispatch('PAUSE')).toBe(false);
  });

  // ─── Listener notifications ─────────────────────────────────────

  it('notifies listeners on state changes', () => {
    const sm = new PlaybackStateMachine();
    const listener = vi.fn();
    sm.onChange(listener);

    sm.dispatch({ type: 'START' });
    expect(listener).toHaveBeenCalledWith('loading', 'idle', { type: 'START' });

    sm.dispatch({ type: 'LOADED' });
    expect(listener).toHaveBeenCalledWith('playing', 'loading', { type: 'LOADED' });
  });

  it('does not notify listeners on rejected transitions', () => {
    const sm = new PlaybackStateMachine();
    const listener = vi.fn();
    sm.onChange(listener);

    sm.dispatch({ type: 'PAUSE' });
    expect(listener).not.toHaveBeenCalled();
  });

  it('unsubscribes listeners', () => {
    const sm = new PlaybackStateMachine();
    const listener = vi.fn();
    const unsub = sm.onChange(listener);

    sm.dispatch({ type: 'START' });
    expect(listener).toHaveBeenCalledOnce();

    unsub();
    sm.dispatch({ type: 'LOADED' });
    expect(listener).toHaveBeenCalledOnce();
  });

  it('swallows listener errors', () => {
    const sm = new PlaybackStateMachine();
    sm.onChange(() => { throw new Error('boom'); });
    const second = vi.fn();
    sm.onChange(second);

    expect(() => sm.dispatch({ type: 'START' })).not.toThrow();
    expect(second).toHaveBeenCalled();
  });

  // ─── Reset ──────────────────────────────────────────────────────

  it('resets to idle', () => {
    const sm = new PlaybackStateMachine();
    sm.dispatch({ type: 'START' });
    sm.dispatch({ type: 'LOADED' });
    expect(sm.state).toBe('playing');

    sm.reset();
    expect(sm.state).toBe('idle');
  });

  // ─── Rapid track switching stress test ──────────────────────────

  it('handles rapid SELECT_TRACK dispatches', () => {
    const sm = new PlaybackStateMachine();
    sm.dispatch({ type: 'START' });
    sm.dispatch({ type: 'LOADED' });

    for (let i = 0; i < 10; i++) {
      expect(sm.dispatch({ type: 'SELECT_TRACK' })).toBe(true);
      expect(sm.state).toBe('loading');
      // superseded loads still resolve to LOADED
      expect(sm.dispatch({ type: 'LOADED' })).toBe(true);
      expect(sm.state).toBe('playing');
    }
  });

  it('handles SELECT_TRACK during loading (supersedes previous)', () => {
    const sm = new PlaybackStateMachine();
    sm.dispatch({ type: 'START' });
    expect(sm.state).toBe('loading');

    expect(sm.dispatch({ type: 'SELECT_TRACK' })).toBe(true);
    expect(sm.state).toBe('loading');

    expect(sm.dispatch({ type: 'LOADED' })).toBe(true);
    expect(sm.state).toBe('playing');
  });

  // ─── Pause/resume idempotency ───────────────────────────────────

  it('handles multiple pause/resume cycles', () => {
    const sm = new PlaybackStateMachine();
    sm.dispatch({ type: 'START' });
    sm.dispatch({ type: 'LOADED' });

    for (let i = 0; i < 5; i++) {
      expect(sm.dispatch({ type: 'PAUSE' })).toBe(true);
      expect(sm.state).toBe('paused');
      expect(sm.dispatch({ type: 'RESUME' })).toBe(true);
      expect(sm.state).toBe('playing');
    }
  });

  // ─── Message bus integration ────────────────────────────────────

  it('publishes state changes to message bus', () => {
    const bus = { publish: vi.fn(), subscribe: vi.fn() } as any;
    const sm = new PlaybackStateMachine(bus);

    sm.dispatch({ type: 'START' });
    expect(bus.publish).toHaveBeenCalledWith('playback:state', {
      state: 'loading',
      previousState: 'idle',
      action: 'START',
    });
  });
});
