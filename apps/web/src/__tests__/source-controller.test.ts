import { describe, it, expect, vi } from 'vitest';
import type { AudioSource } from '@cybernoetica/audio';
import { SourceController } from '../managers/source-controller.js';
import { PlaybackStateMachine } from '../managers/playback-state.js';

describe('source selection', () => {
  it('cancels pending permission or decoding work without publishing a stale result', async () => {
    const source = {
      resume: async () => {},
      cancelPendingLoad: vi.fn(),
    } as unknown as AudioSource;
    const ready = vi.fn(),
      error = vi.fn();
    const controller = new SourceController(
      source,
      new PlaybackStateMachine(),
      ready,
      error,
    );
    let resolve!: (ok: boolean) => void;
    const loading = controller.select(
      'Microphone',
      'mic',
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    await vi.waitFor(() => expect(resolve).toBeDefined());
    controller.cancel();
    resolve(true);
    expect(await loading).toBe(false);
    expect(ready).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
    expect(source.cancelPendingLoad).toHaveBeenCalledTimes(2);
  });
  it('publishes only the newest successful source and permits switching during loading', async () => {
    const source = {
      resume: async () => {},
      cancelPendingLoad: vi.fn(),
    } as unknown as AudioSource;
    const state = new PlaybackStateMachine();
    const ready = vi.fn();
    const error = vi.fn();
    const controller = new SourceController(source, state, ready, error);
    let resolve!: (ok: boolean) => void;
    const old = controller.select(
      'Old',
      'file',
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    await vi.waitFor(() => expect(resolve).toBeDefined());
    expect(await controller.select('Microphone', 'mic', () => true)).toBe(true);
    resolve(true);
    expect(await old).toBe(false);
    expect(ready).toHaveBeenCalledExactlyOnceWith('Microphone', 'mic');
    expect(error).not.toHaveBeenCalled();
    expect(state.isPlaying).toBe(true);
  });

  it('can start visuals without a file and retry after a source failure', async () => {
    const source = {
      resume: async () => {},
      cancelPendingLoad: vi.fn(),
    } as unknown as AudioSource;
    const state = new PlaybackStateMachine();
    const error = vi.fn();
    const controller = new SourceController(source, state, vi.fn(), error);
    expect(await controller.select('No audio', 'none', () => true)).toBe(true);
    expect(
      await controller.select('Bad file', 'file', async () => {
        throw new Error('decode');
      }),
    ).toBe(false);
    expect(state.isIdle).toBe(true);
    expect(error).toHaveBeenCalledWith('decode');
    expect(await controller.select('No audio', 'none', () => true)).toBe(true);
    expect(state.isPlaying).toBe(true);
  });
});
