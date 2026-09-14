import type { TrackAnalysis } from './track-analysis.js';
/** One acknowledged PCM chunk in flight; source replacement terminates its worker. */
export class TrackAnalysisClient {
  private worker: Worker | null = null;
  private reject: ((error: Error) => void) | null = null;
  private generation = 0;
  private timer: ReturnType<typeof setTimeout> | undefined;
  cancel(): void {
    clearTimeout(this.timer);
    this.generation++;
    this.worker?.terminate();
    this.worker = null;
    this.reject?.(new DOMException('Track analysis cancelled', 'AbortError'));
    this.reject = null;
  }
  async analyze(
    buffer: AudioBuffer,
    onProgress: (result: TrackAnalysis) => void,
  ): Promise<TrackAnalysis> {
    this.cancel();
    const generation = this.generation;
    const worker = new Worker(
      new URL('./track-analysis.worker.ts', import.meta.url),
      { type: 'module' },
    );
    this.worker = worker;
    worker.postMessage({
      type: 'start',
      sampleRate: buffer.sampleRate,
      duration: buffer.duration,
    });
    let result: TrackAnalysis | undefined;
    try {
      for (let offset = 0; offset < buffer.length; offset += 65536) {
        if (generation !== this.generation)
          throw new DOMException('Cancelled', 'AbortError');
        const end = Math.min(buffer.length, offset + 65536),
          left = buffer.getChannelData(0).slice(offset, end),
          right =
            buffer.numberOfChannels > 1
              ? buffer.getChannelData(1).slice(offset, end)
              : left;
        result = await new Promise<TrackAnalysis>((resolve, reject) => {
          this.reject = reject;
          const timer = (this.timer = setTimeout(
            () => reject(new Error('Track analysis timed out')),
            15000,
          ));
          worker.onmessage = (e) => {
            if (e.data.id !== offset) return;
            clearTimeout(timer);
            this.reject = null;
            e.data.error
              ? reject(new Error(e.data.error))
              : resolve(e.data.result);
          };
          worker.onerror = () => {
            clearTimeout(timer);
            reject(new Error('Track analysis worker unavailable'));
          };
          worker.postMessage(
            {
              type: 'chunk',
              id: offset,
              left,
              right,
              final: end === buffer.length,
            },
            right === left ? [left.buffer] : [left.buffer, right.buffer],
          );
        });
        onProgress(result);
      }
      if (!result) throw new Error('Empty audio file');
      return result;
    } finally {
      worker.terminate();
      if (this.worker === worker) {
        clearTimeout(this.timer);
        this.worker = null;
        this.reject = null;
      }
    }
  }
}
