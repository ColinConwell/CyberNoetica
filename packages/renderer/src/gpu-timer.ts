import { FrameStatistics } from './frame-statistics.js';
interface TimerExtension {
  TIME_ELAPSED_EXT: number;
  GPU_DISJOINT_EXT: number;
}

/** Asynchronous GPU elapsed queries. Never wait for the GPU or read unavailable results. */
export class GpuTimer {
  private extension: TimerExtension | null;
  private pending: WebGLQuery[] = [];
  private active: WebGLQuery | null = null;
  milliseconds: number | null = null;
  readonly statistics = new FrameStatistics();

  constructor(private gl: WebGL2RenderingContext) {
    this.extension = gl.getExtension('EXT_disjoint_timer_query_webgl2');
  }
  begin(): void {
    const ext = this.extension;
    const gl = this.gl;
    if (!ext || gl.isContextLost()) {
      this.milliseconds = null;
      return;
    }
    const disjoint = gl.getParameter(ext.GPU_DISJOINT_EXT);
    if (disjoint) {
      this.milliseconds = null;
      this.statistics.reset();
      for (const query of this.pending) gl.deleteQuery(query);
      this.pending = [];
      return;
    }
    while (
      this.pending.length &&
      gl.getQueryParameter(this.pending[0], gl.QUERY_RESULT_AVAILABLE)
    ) {
      const query = this.pending.shift()!;
      const ms = Number(gl.getQueryParameter(query, gl.QUERY_RESULT)) / 1e6;
      if (Number.isFinite(ms)) {
        this.milliseconds = ms;
        this.statistics.add(ms);
      }
      gl.deleteQuery(query);
    }
    if (this.pending.length >= 4) return;
    this.active = gl.createQuery();
    if (this.active) gl.beginQuery(ext.TIME_ELAPSED_EXT, this.active);
  }
  end(): void {
    if (!this.active || !this.extension) return;
    this.gl.endQuery(this.extension.TIME_ELAPSED_EXT);
    this.pending.push(this.active);
    this.active = null;
  }
  dispose(): void {
    for (const query of this.pending) this.gl.deleteQuery(query);
    this.pending = [];
    this.active = null;
    this.milliseconds = null;
  }
}
