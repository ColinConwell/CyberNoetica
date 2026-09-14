import type { AudioFeatures } from '@cybernoetica/core';
import type { GuidanceMapping, SignalProvider } from './types.js';
export class GuidanceEngine {
  private providers = new Map<string, SignalProvider>();
  private audio: AudioFeatures | null = null;
  private smoothed = new Map<string, number>();
  register(provider: SignalProvider): () => void {
    this.providers.set(provider.id, provider);
    return () => {
      if (this.providers.get(provider.id) === provider)
        this.providers.delete(provider.id);
    };
  }
  setAudio(audio: AudioFeatures): void {
    this.audio = audio;
  }
  evaluate(
    routes: GuidanceMapping[],
    time: number,
    dt: number,
    reduceFlashes = false,
  ): { swirl: number; spread: number; light: number } {
    const values: Record<string, number> = {};
    if (this.audio)
      for (const key of [
        'bass',
        'mid',
        'high',
        'rms',
        'spectralCentroid',
      ] as const)
        values[`audio.${key}`] = this.audio[key];
    values['audio.onset'] = !reduceFlashes && this.audio?.beatOnset ? 1 : 0;
    for (const provider of this.providers.values())
      for (const [key, value] of Object.entries(provider.sample(time)))
        if (Number.isFinite(value)) values[`${provider.id}.${key}`] = value;
    const result = { swirl: 0, spread: 0, light: 0 };
    for (const route of routes) {
      let value = values[route.source] ?? 0;
      value = Math.max(
        0,
        Math.min(
          1,
          (value - route.min) / Math.max(1e-6, route.max - route.min),
        ),
      );
      if (route.invert) value = 1 - value;
      const old = this.smoothed.get(route.id) ?? 0,
        alpha =
          route.smoothing <= 0
            ? 1
            : 1 - Math.exp(-Math.max(0, dt) / route.smoothing);
      value = old + (value - old) * alpha;
      this.smoothed.set(route.id, value);
      result[route.target] += value * route.amount;
    }
    return {
      swirl: Math.max(-0.5, Math.min(0.5, result.swirl)),
      spread: Math.max(-0.5, Math.min(0.5, result.spread)),
      light: Math.max(-0.8, Math.min(2, result.light)),
    };
  }
}
