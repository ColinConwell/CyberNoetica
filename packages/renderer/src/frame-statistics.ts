/** Bounded measured samples; percentile sorting happens only when the UI polls. */
export class FrameStatistics {
  private values = new Float32Array(180);
  private cursor = 0;
  private count = 0;
  add(milliseconds: number): void {
    if (!Number.isFinite(milliseconds) || milliseconds < 0) return;
    this.values[this.cursor] = milliseconds;
    this.cursor = (this.cursor + 1) % this.values.length;
    this.count = Math.min(this.count + 1, this.values.length);
  }
  reset(): void {
    this.cursor = 0;
    this.count = 0;
  }
  percentiles(): { p50: number; p95: number; samples: number } | null {
    if (!this.count) return null;
    const sorted = this.values.slice(0, this.count).sort();
    return {
      p50: sorted[Math.floor((this.count - 1) * 0.5)],
      p95: sorted[Math.floor((this.count - 1) * 0.95)],
      samples: this.count,
    };
  }
}
