export class EMASmoothing {
  public value = 0;
  private factor: number;

  constructor(factor: number) {
    this.factor = Math.max(0, Math.min(1, factor));
  }

  update(target: number): number {
    this.value = this.value + this.factor * (target - this.value);
    return this.value;
  }

  reset(value = 0): void {
    this.value = value;
  }
}
