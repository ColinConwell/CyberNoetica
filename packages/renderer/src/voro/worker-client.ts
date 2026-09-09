import type { VoroBackendOptions, VoroMesh } from './backend.js';

/** One in-flight tessellation, bounded at the caller; disposal cancels all work. */
export class VoroWorkerClient {
  private worker: Worker;
  private ready = false;
  private pending = false;
  private id = 0;
  private disposed = false;
  constructor(
    options: VoroBackendOptions,
    private onMesh: (mesh: VoroMesh) => void,
  ) {
    this.worker = new Worker(new URL('./worker.ts', import.meta.url), {
      type: 'module',
    });
    this.worker.onmessage = (event) => {
      if (this.disposed) return;
      const message = event.data;
      if (message.type === 'ready') this.ready = true;
      if (message.type === 'mesh') {
        this.pending = false;
        if (message.id === this.id && message.mesh) this.onMesh(message.mesh);
      }
      if (message.type === 'error') this.fail(message.message);
    };
    this.worker.onerror = (event) => this.fail(event.message);
    this.worker.postMessage({ type: 'init', options });
  }
  compute(
    xyz: Float32Array,
    radii?: Float32Array,
    sphereRadius?: number,
  ): boolean {
    if (!this.ready || this.pending || this.disposed) return false;
    this.pending = true;
    // Owned copies leave the animation's seed buffers usable while the worker runs.
    const positions = xyz.slice();
    const weights = radii?.slice();
    const transfer: Transferable[] = [positions.buffer];
    if (weights) transfer.push(weights.buffer);
    this.worker.postMessage(
      {
        type: 'compute',
        id: ++this.id,
        xyz: positions,
        radii: weights,
        sphereRadius,
      },
      transfer,
    );
    return true;
  }
  invalidate(): void {
    this.id++;
  }
  private fail(message: string): void {
    console.warn('Foam worker unavailable:', message);
    this.dispose();
  }
  dispose(): void {
    this.disposed = true;
    this.pending = false;
    this.worker.terminate();
  }
}
