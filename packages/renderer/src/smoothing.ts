export class EMASmoothing {
  public value = 0;
  private factor: number;

  constructor(
    factor: number,
    private releaseFactor = factor,
  ) {
    this.factor = Math.max(0, Math.min(1, factor));
    this.releaseFactor = Math.max(0, Math.min(1, releaseFactor));
  }

  update(target: number, deltaSeconds = 1 / 60): number {
    if (
      !Number.isFinite(target) ||
      !Number.isFinite(deltaSeconds) ||
      deltaSeconds <= 0
    )
      return this.value;
    const base = target >= this.value ? this.factor : this.releaseFactor;
    const factor =
      base === 1 ? 1 : -Math.expm1(Math.log1p(-base) * deltaSeconds * 60);
    this.value += factor * (target - this.value);
    return this.value;
  }

  reset(value = 0): void {
    this.value = value;
  }
}

/** Instant onset attack with an exponential release measured in seconds. */
export class EventEnvelope {
  value = 0;
  constructor(private releaseSeconds = 0.22) {}
  update(event: number | boolean, deltaSeconds = 1 / 60): number {
    if (event) this.value = 1;
    else if (Number.isFinite(deltaSeconds) && deltaSeconds > 0)
      this.value *= Math.exp(-deltaSeconds / this.releaseSeconds);
    return this.value;
  }
  reset(value = 0): void {
    this.value = value;
  }
}
