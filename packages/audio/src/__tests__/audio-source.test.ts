import { afterEach, describe, expect, it, vi } from 'vitest';
import { AudioSource } from '../audio-source.js';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function setup() {
  const nodes: Array<ReturnType<typeof node>> = [];
  function node() {
    return {
      connect: vi.fn(),
      disconnect: vi.fn(),
      start: vi.fn(),
      stop: vi.fn(),
      buffer: null as unknown,
      onended: null as (() => void) | null,
      gain: { value: 1 },
    };
  }
  const decode = vi.fn(
    async (bytes: ArrayBuffer) => bytes as unknown as AudioBuffer,
  );
  const ctx = {
    state: 'running',
    sampleRate: 48000,
    destination: node(),
    close: vi.fn(),
    createAnalyser: () => ({
      ...node(),
      fftSize: 2048,
      frequencyBinCount: 1024,
    }),
    createGain: node,
    createChannelSplitter: node,
    decodeAudioData: decode,
    createBufferSource: () => {
      const n = node();
      nodes.push(n);
      return n;
    },
    createMediaStreamSource: () => node(),
  };
  vi.stubGlobal(
    'AudioContext',
    class {
      constructor() {
        return ctx;
      }
    },
  );
  const source = new AudioSource();
  const file = (byte: number) =>
    ({ arrayBuffer: async () => new Uint8Array([byte]).buffer }) as File;
  return { source, nodes, decode, file };
}

afterEach(() => vi.unstubAllGlobals());

describe('source transactions', () => {
  it('does not install an old decode after a newer file starts', async () => {
    const { source, nodes, decode, file } = setup();
    await source.init();
    const old = deferred<AudioBuffer>();
    decode.mockImplementationOnce(() => old.promise);
    const first = source.loadFile(file(1));
    await vi.waitFor(() => expect(decode).toHaveBeenCalledOnce());
    expect(await source.loadFile(file(2))).toBe(true);
    old.resolve({} as AudioBuffer);
    expect(await first).toBe(false);
    expect(nodes).toHaveLength(1);
    expect(new Uint8Array(nodes[0].buffer as ArrayBuffer)[0]).toBe(2);
  });

  it('stops stale capture tracks without replacing the selected file', async () => {
    const { source, nodes, file } = setup();
    await source.init();
    const pending = deferred<MediaStream>();
    const stop = vi.fn();
    vi.stubGlobal('navigator', {
      mediaDevices: { getUserMedia: () => pending.promise },
    });
    const capture = source.useMicrophone();
    await source.loadFile(file(2));
    pending.resolve({
      getVideoTracks: () => [],
      getTracks: () => [{ stop }],
    } as unknown as MediaStream);
    expect(await capture).toBe(false);
    expect(stop).toHaveBeenCalledOnce();
    expect(source.sourceType).toBe('file');
    expect(nodes).toHaveLength(1);
  });

  it('does not auto-advance when replacing or destroying a file source', async () => {
    const { source, nodes, file } = setup();
    await source.init();
    const ended = vi.fn();
    source.onEnded(ended);
    await source.loadFile(file(1));
    const oldHandler = nodes[0].onended!;
    await source.loadFile(file(2));
    oldHandler();
    expect(nodes[0].onended).toBeNull();
    expect(ended).not.toHaveBeenCalled();
    const handler = nodes[1].onended!;
    source.destroy();
    handler();
    expect(ended).not.toHaveBeenCalled();
  });

  it('aborts superseded fetches and reports actual HTTP failures', async () => {
    const { source, file } = setup();
    await source.init();
    let signal: AbortSignal | undefined;
    vi.stubGlobal(
      'fetch',
      vi.fn((_url, options) => {
        signal = options.signal;
        return new Promise((_resolve, reject) =>
          signal!.addEventListener('abort', () => reject(new Error('aborted'))),
        );
      }),
    );
    const old = source.loadURL('/one');
    await vi.waitFor(() => expect(signal).toBeDefined());
    await source.loadFile(file(2));
    expect(signal!.aborted).toBe(true);
    expect(await old).toBe(false);
    vi.stubGlobal('fetch', async () => new Response('', { status: 404 }));
    await expect(source.loadURL('/missing')).rejects.toThrow('404');
  });
});
