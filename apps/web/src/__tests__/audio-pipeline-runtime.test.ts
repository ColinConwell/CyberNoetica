import { afterEach, describe, it, expect, vi } from 'vitest';
import { MessageBus } from '@cybernoetica/core';
import type { AudioFeatures } from '@cybernoetica/core';
import { AudioPipeline } from '../managers/audio-pipeline.js';

const state = vi.hoisted(() => ({
  time: 0,
  deliver: null as ((f: AudioFeatures) => void) | null,
  fail: null as (() => void) | null,
}));
vi.mock('@cybernoetica/audio', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@cybernoetica/audio')>();
  return {
    ...actual,
    AudioSource: class {
      async init() {}
      getSampleRate() {
        return 48000;
      }
      getSourceRevision() {
        return 0;
      }
      getCurrentTime() {
        return state.time;
      }
      getStereoSamples() {
        return null;
      }
      getSamples() {
        return new Float32Array(4096).fill(0);
      }
      async startAnalysis(
        deliver: (f: AudioFeatures) => void,
        fail: () => void,
      ) {
        state.deliver = deliver;
        state.fail = fail;
        return true;
      }
      destroy() {}
    },
  };
});
afterEach(() => vi.useRealTimers());

describe('analysis delivery', () => {
  it('retains an onset across faster analysis frames and consumes it once at render time', async () => {
    vi.useFakeTimers();
    const bus = new MessageBus();
    const listener = vi.fn();
    bus.subscribe('audio:features', listener);
    const pipeline = new AudioPipeline(bus);
    await pipeline.init();
    const f: AudioFeatures = {
      fftBins: new Float32Array(0),
      bass: 0,
      mid: 0,
      high: 0,
      rms: 0.1,
      spectralCentroid: 0,
      spectralFlux: 0.3,
      beatOnset: true,
      beatConfidence: 0.8,
      degraded: false,
      onsetId: 3,
    };
    state.deliver!(f);
    state.deliver!({ ...f, beatOnset: false, beatConfidence: 0 });
    pipeline.pushFrame();
    pipeline.pushFrame();
    expect(listener.mock.calls[0][0].payload).toMatchObject({
      beatOnset: true,
      beatConfidence: 0.8,
      onsetId: 3,
    });
    expect(listener.mock.calls[1][0].payload.beatOnset).toBe(false);
    pipeline.destroy();
  });

  it('switches to complete main-thread DSP when the worklet fails and cleans its timer', async () => {
    vi.useFakeTimers();
    const bus = new MessageBus();
    const listener = vi.fn();
    bus.subscribe('audio:features', listener);
    const pipeline = new AudioPipeline(bus);
    await pipeline.init();
    state.fail!();
    state.time = 1;
    await vi.advanceTimersByTimeAsync(20);
    pipeline.pushFrame();
    expect(pipeline.getBackend()).toBe('main-thread');
    expect(listener.mock.calls.at(-1)![0].payload).toMatchObject({
      sampleRate: 48000,
      degraded: false,
      rms: 0,
    });
    pipeline.destroy();
    expect(vi.getTimerCount()).toBe(0);
  });
});
