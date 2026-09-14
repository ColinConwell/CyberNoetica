import { describe, it, expect, vi, afterEach } from 'vitest';
import { MessageBus } from '@cybernoetica/core';
import { JourneyVisualizer } from '../journey/journey.js';
import { createJourney, createStop } from '../journey/definition.js';
import { locateJourney, crossedMarker } from '../journey/schedule.js';
import { WorkerTransportSolver } from '../journey/solver.js';
import { GeometryTransitionAdapter } from '../journey/adapter.js';
import { OrthographicCamera } from 'three';
afterEach(() => vi.unstubAllGlobals());
const ready = async (j: JourneyVisualizer) =>
  vi.waitFor(() => expect(j.state.preparationMs).toBeGreaterThan(0), {
    timeout: 10000,
  });
describe('Journey lifecycle', () => {
  it('pauses independently, changes style in place, and rebuilds seek progress', async () => {
    const d = createJourney();
    d.stops = [createStop('lissajous'), createStop('rosecurve')];
    d.stops[0].hold = 1;
    d.stops[0].transition = 1;
    const j = new JourneyVisualizer(new MessageBus(), d, 32);
    try {
      await j.initialize();
      await ready(j);
      j.nextStop();
      j.tick(0.1);
      const p = j.state.progress;
      expect(p).toBeGreaterThan(0);
      j.setPaused(true);
      j.setStyle('unified');
      j.tick(0.1);
      expect(j.state.progress).toBe(p);
      expect(j.state.phase).toBe('paused');
      j.seek(1.5);
      j.tick(0);
      await vi.waitFor(() => expect(j.state.progress).toBeCloseTo(0.5), {
        timeout: 10000,
      });
      j.setPaused(false);
      j.tick(0.1);
      expect(j.state.progress).toBeGreaterThan(0.5);
    } finally {
      j.dispose();
      j.dispose();
    }
  });
  it('invalidates preparation after rapid route replacement and disposal', async () => {
    const d = createJourney();
    d.stops = [createStop('rosecurve'), createStop('lissajous')];
    const j = new JourneyVisualizer(new MessageBus(), d, 32);
    const initializing = j.initialize();
    const edit = structuredClone(d);
    edit.stops[0].layers[0].type = 'spirograph';
    j.setDefinition(edit);
    await initializing;
    await vi.waitFor(() => expect(j.dominant().type).toBe('spirograph'), {
      timeout: 10000,
    });
    j.dispose();
    j.tick();
    expect(() => j.dispose()).not.toThrow();
  });
  it('uses direct segment lookup, including a terminal hold and marker offsets', () => {
    const d = createJourney();
    d.stops = [createStop('lissajous'), createStop('rosecurve')];
    expect(locateJourney(d, 18)).toEqual({
      index: 0,
      offset: 18,
      progress: 0.5,
    });
    expect(locateJourney(d, 40).index).toBe(0);
    d.loop = false;
    expect(locateJourney(d, 100).index).toBe(1);
    expect(locateJourney(d, 100).progress).toBe(0);
    expect(crossedMarker([1, 2, 3], 2.12, 0.03, 0.1)).toBe(true);
    expect(crossedMarker([1, 2, 3], 2.5, 0.03)).toBe(false);
  });
  it('keeps particle slots fixed as other particles die', () => {
    const positions = new Float32Array([
      -0.5, 0, -0.5, 0, 0, -0.5, 0.5, 0, -0.5,
    ]);
    let hidden = false;
    const a = new GeometryTransitionAdapter(
        {
          getTransitionComponents: () => [
            {
              id: 'p',
              kind: 'particles',
              revision: 0,
              count: 3,
              positions,
              visible: (i) => !(hidden && i === 0),
            },
          ],
        },
        3,
      ),
      camera = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
    const before = a.read(camera).positions.slice();
    hidden = true;
    const after = a.read(camera);
    expect(after.positions.slice(3)).toEqual(before.slice(3));
    expect(after.colors[3]).toBe(0);
    a.dispose();
  });
  it('keeps one active worker and replaces only the pending solver request', async () => {
    class FakeWorker {
      static all: FakeWorker[] = [];
      onmessage: ((e: { data: unknown }) => void) | null = null;
      onerror: null = null;
      messages: unknown[] = [];
      terminate = vi.fn();
      constructor() {
        FakeWorker.all.push(this);
      }
      postMessage(m: unknown) {
        this.messages.push(m);
      }
    }
    vi.stubGlobal('Worker', FakeWorker);
    const solver = new WorkerTransportSolver(),
      p = new Float32Array([0, 0, 0]),
      abort = new AbortController();
    const first = solver.solve(p, p, 1, abort.signal).catch((e) => e.name),
      second = solver.solve(p, p, 2).catch((e) => e.name),
      third = solver.solve(p, p, 3).catch((e) => e.name);
    expect(await second).toBe('AbortError');
    expect(FakeWorker.all).toHaveLength(1);
    expect(FakeWorker.all[0].messages).toHaveLength(1);
    abort.abort();
    expect(await first).toBe('AbortError');
    expect(FakeWorker.all[0].terminate).toHaveBeenCalledOnce();
    expect(FakeWorker.all).toHaveLength(2);
    solver.dispose();
    expect(await third).toBe('AbortError');
  });
});

describe('Journey fallback and composition', () => {
  it('uses a delivered baseline on worker timeout and releases the worker', async () => {
    vi.useFakeTimers();
    class FakeWorker {
      static current: FakeWorker;
      onmessage: ((e: { data: unknown }) => void) | null = null;
      onerror: null = null;
      terminate = vi.fn();
      constructor() {
        FakeWorker.current = this;
      }
      postMessage(m: { id: number }) {
        queueMicrotask(() =>
          this.onmessage?.({
            data: {
              id: m.id,
              baseline: {
                indices: new Uint32Array([0]),
                cost: 0,
                baselineCost: 0,
                residual: 0,
                backend: 'projection',
                milliseconds: 1,
              },
            },
          }),
        );
      }
    }
    vi.stubGlobal('Worker', FakeWorker);
    const solver = new WorkerTransportSolver();
    try {
      const pending = solver.solve(new Float32Array(3), new Float32Array(3), 1);
      await vi.advanceTimersByTimeAsync(1600);
      expect((await pending).backend).toBe('projection');
      expect(FakeWorker.current.terminate).toHaveBeenCalledOnce();
    } finally {
      solver.dispose();
      vi.useRealTimers();
    }
  });
  it('preserves the sampled model at a one-hot blend endpoint and fixed reference maps', async () => {
    const { JourneyEndpoint } = await import('../journey/endpoint.js');
    const { createLayer } = await import('../journey/definition.js');
    const { projectionTransport } = await import('../journey/transport.js');
    const stop = createStop('lissajous');
    stop.composition = 'blend';
    stop.layers.push(createLayer('rosecurve'));
    stop.layers[0].weight = 0;
    stop.layers[1].weight = 1;
    const endpoint = await JourneyEndpoint.create(
      stop,
      96,
      undefined,
      {
        solve: async (a, b, seed) => projectionTransport(a, b, seed),
        dispose() {},
      },
      12,
      new AbortController().signal,
    );
    try {
      const slot = endpoint.slots[1],
        frame = slot.adapter.read(slot.camera),
        map = slot.map.slice();
      for (let i = 0; i < 96; i++) {
        const j = map[Math.floor((i * 48) / 96)];
        expect(endpoint.positions[i * 3]).toBeCloseTo(
          frame.positions[j * 3],
          6,
        );
        expect(endpoint.positions[i * 3 + 1]).toBeCloseTo(
          frame.positions[j * 3 + 1],
          6,
        );
      }
      const edit = structuredClone(stop);
      edit.layers[0].weight = 0.6;
      edit.layers[1].weight = 0.4;
      expect(endpoint.setStop(edit)).toBe(true);
      endpoint.update(0.01, null);
      expect(endpoint.slots[1].map).toEqual(map);
    } finally {
      endpoint.dispose();
    }
  });
});

describe('musical seek reconstruction', () => {
  it('locates cue and estimated-beat morphs without replaying missed events', () => {
    const d = createJourney();
    d.stops = [createStop('lissajous'), createStop('rosecurve')];
    d.stops[0].hold = 1;
    d.stops[0].transition = 1;
    d.timing = 'cues';
    d.cues = [3, 8];
    expect(locateJourney(d, 3.5)).toEqual({
      index: 0,
      offset: 1.5,
      progress: 0.5,
    });
    expect(locateJourney(d, 4).index).toBe(1);
    d.timing = 'beats';
    expect(locateJourney(d, 1.75, [1.25, 2])).toEqual({
      index: 0,
      offset: 1.5,
      progress: 0.5,
    });
    d.timing = 'onset';
    expect(locateJourney(d, 1.75, [], [1.25, 2]).progress).toBe(0.5);
  });
});
