import { initialTransport } from './transport.js';
import type {
  TransportAlgorithm,
  TransportMap,
  TransportSolver,
} from './types.js';
interface Job {
  id: number;
  source: Float32Array;
  target: Float32Array;
  seed: number;
  algorithm: TransportAlgorithm;
  resolve: (map: TransportMap) => void;
  reject: (error: Error) => void;
  cleanup: () => void;
  baseline?: TransportMap;
  timer?: ReturnType<typeof setTimeout>;
}
const cancelled = () =>
  new DOMException('Transition preparation cancelled', 'AbortError');
export class WorkerTransportSolver implements TransportSolver {
  private worker: Worker | null = null;
  private active: Job | null = null;
  private pending: Job | null = null;
  private serial = 0;
  private disposed = false;
  private makeWorker(): void {
    if (this.worker || typeof Worker === 'undefined') return;
    try {
      this.worker = new Worker(
        new URL('./transport.worker.ts', import.meta.url),
        { type: 'module' },
      );
      this.worker.onmessage = (event) => {
        const job = this.active,
          data = event.data;
        if (!job || data.id !== job.id) return;
        if (data.baseline) job.baseline = data.baseline;
        if (data.result) this.finish(data.result);
        else if (data.error) this.fail(new Error(data.error));
      };
      this.worker.onerror = () =>
        this.fail(new Error('Transport worker failed'));
    } catch {
      this.worker = null;
    }
  }
  solve(
    source: Float32Array,
    target: Float32Array,
    seed: number,
    signal?: AbortSignal,
    algorithm: TransportAlgorithm = 'auto',
  ): Promise<TransportMap> {
    if (this.disposed || signal?.aborted) return Promise.reject(cancelled());
    return new Promise((resolve, reject) => {
      const job: Job = {
        id: ++this.serial,
        source: source.slice(),
        target: target.slice(),
        seed,
        algorithm,
        resolve,
        reject,
        cleanup: () => signal?.removeEventListener('abort', abort),
      };
      const abort = () => {
        if (this.pending === job) {
          this.pending = null;
          job.cleanup();
          reject(cancelled());
        } else if (this.active === job) {
          this.worker?.terminate();
          this.worker = null;
          this.finish(undefined, cancelled());
        }
      };
      signal?.addEventListener('abort', abort, { once: true });
      if (this.active) {
        if (this.pending) {
          this.pending.cleanup();
          this.pending.reject(cancelled());
        }
        this.pending = job;
      } else this.start(job);
    });
  }
  private start(job: Job): void {
    this.active = job;
    this.makeWorker();
    job.timer = setTimeout(
      () => this.fail(new Error('Transport preparation timed out')),
      1500,
    );
    if (this.worker)
      this.worker.postMessage({
        id: job.id,
        source: job.source,
        target: job.target,
        seed: job.seed,
        algorithm: job.algorithm,
      });
    else
      setTimeout(() => {
        if (this.active !== job) return;
        try {
          this.finish(
            initialTransport(job.source, job.target, job.seed, job.algorithm),
          );
        } catch (error) {
          this.finish(undefined, error as Error);
        }
      }, 0);
  }
  private fail(error: Error): void {
    this.worker?.terminate();
    this.worker = null;
    this.finish(this.active?.baseline, error);
  }
  private finish(result?: TransportMap, error?: Error): void {
    const job = this.active;
    if (!job) return;
    this.active = null;
    clearTimeout(job.timer);
    job.cleanup();
    if (result) job.resolve(result);
    else job.reject(error ?? new Error('Transport unavailable'));
    const pending = this.pending;
    this.pending = null;
    if (pending && !this.disposed) this.start(pending);
  }
  dispose(): void {
    this.disposed = true;
    this.worker?.terminate();
    this.worker = null;
    if (this.pending) {
      this.pending.cleanup();
      this.pending.reject(cancelled());
      this.pending = null;
    }
    this.finish(undefined, cancelled());
  }
}
