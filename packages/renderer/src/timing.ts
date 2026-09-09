/** Ignore invalid clocks and bound catch-up after a suspended tab. Units: seconds. */
export function frameDelta(seconds = 1 / 60): number {
  return Number.isFinite(seconds)
    ? Math.max(0, Math.min(0.1, seconds))
    : 1 / 60;
}

/** Retains fractional simulation steps; caps work after long frame stalls. */
export class FixedStepClock {
  private remainder = 0;
  constructor(
    readonly step = 1 / 120,
    readonly maxSteps = 12,
  ) {}
  advance(seconds: number, update: (dt: number) => void): number {
    this.remainder += frameDelta(seconds);
    const count = Math.min(
      this.maxSteps,
      Math.floor((this.remainder + 1e-10) / this.step),
    );
    for (let i = 0; i < count; i++) update(this.step);
    this.remainder = Math.max(0, this.remainder - count * this.step);
    return count;
  }
  reset(): void {
    this.remainder = 0;
  }
}
import type { AudioFeatures } from '@cybernoetica/core';

/** Consume an event from a visualizer-owned snapshot without mutating the bus payload. */
export function takeAudioFrame(features: AudioFeatures): AudioFeatures {
  if (!features.beatOnset) return features;
  const event = { ...features };
  features.beatOnset = false;
  return event;
}

/** Integrate angular/travel rates; changing a rate preserves the current phase. */
export class PhaseClock {
  private phases = new Map<string, number>();
  advance(name: string, rate: number, seconds: number): number {
    const next =
      (this.phases.get(name) ?? 0) +
      (Number.isFinite(rate) ? rate : 0) * frameDelta(seconds);
    this.phases.set(name, next);
    return next;
  }
}

/** Reproducible visual seeds without replacing the platform RNG. */
export function seededRandom(seed = 0x43594245): () => number {
  return () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
}
