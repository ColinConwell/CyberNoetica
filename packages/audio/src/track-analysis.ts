import { SpectrumAnalyzer } from './spectrum-analyzer.js';
export interface AudioTransport {
  position: number;
  duration: number;
  playing: boolean;
  revision: number;
  seekRevision: number;
}
export interface TrackAnalysis {
  version: 1;
  duration: number;
  progress: number;
  hopSeconds: number;
  energy: Float32Array;
  novelty: Float32Array;
  bpm: number | null;
  confidence: number;
  beats: number[];
  landmarks: number[];
  onsets: number[];
}
export function estimateBeats(
  novelty: ArrayLike<number>,
  hop: number,
): { bpm: number | null; confidence: number; beats: number[] } {
  const n = novelty.length;
  if (n < 8) return { bpm: null, confidence: 0, beats: [] };
  const minLag = Math.max(1, Math.round(60 / 240 / hop)),
    maxLag = Math.min(n - 1, Math.round(60 / 40 / hop));
  let lagBest = 0,
    scoreBest = 0;
  for (let lag = minLag; lag <= maxLag; lag++) {
    let dot = 0,
      left = 0,
      right = 0;
    for (let i = lag; i < n; i++) {
      dot += novelty[i] * novelty[i - lag];
      left += novelty[i] ** 2;
      right += novelty[i - lag] ** 2;
    }
    const score =
      (dot / Math.sqrt(Math.max(1e-12, left * right))) *
      (0.8 +
        0.2 * Math.exp(-0.5 * (Math.log2(60 / (lag * hop) / 120) / 0.8) ** 2));
    if (score > scoreBest) {
      scoreBest = score;
      lagBest = lag;
    }
  }
  if (!lagBest || scoreBest < 0.12)
    return { bpm: null, confidence: scoreBest, beats: [] };
  let peak = 0;
  for (let i = 0; i < n; i++) peak = Math.max(peak, novelty[i]);
  if (peak < 1e-6) return { bpm: null, confidence: 0, beats: [] };
  const scores = new Float64Array(n),
    previous = new Int32Array(n).fill(-1);
  for (let i = 0; i < n; i++) {
    let best = 0,
      parent = -1;
    for (
      let j = Math.max(0, i - Math.ceil(lagBest * 1.5));
      j <= i - Math.floor(lagBest * 0.65);
      j++
    ) {
      const value = scores[j] - 0.75 * Math.log((i - j) / lagBest) ** 2;
      if (value > best) {
        best = value;
        parent = j;
      }
    }
    scores[i] = novelty[i] / peak + best;
    previous[i] = parent;
  }
  let end = Math.max(0, n - 1 - lagBest);
  for (let i = end; i < n; i++) if (scores[i] > scores[end]) end = i;
  const beats: number[] = [];
  for (let i = end; i >= 0; i = previous[i]) {
    beats.push(i * hop);
    if (previous[i] >= i) break;
  }
  beats.reverse();
  return {
    bpm: 60 / (lagBest * hop),
    confidence: Math.min(1, scoreBest),
    beats,
  };
}
export function energyLandmarks(
  energy: ArrayLike<number>,
  novelty: ArrayLike<number>,
  hop: number,
): number[] {
  const radius = Math.max(1, Math.round(2 / hop)),
    candidates: Array<{ time: number; score: number }> = [];
  let left = 0,
    right = 0;
  for (let i = 0; i < Math.min(radius, energy.length); i++) right += energy[i];
  for (let i = 0; i < energy.length; i++) {
    if (i >= radius) left -= energy[i - radius];
    if (i > 0) left += energy[i - 1];
    right -= energy[i] ?? 0;
    right += energy[i + radius] ?? 0;
    if (i > radius && i < energy.length - radius)
      candidates.push({
        time: i * hop,
        score: Math.abs(right - left) / radius + (novelty[i] ?? 0) * 0.05,
      });
  }
  candidates.sort((a, b) => b.score - a.score);
  const accepted: number[] = [];
  for (const c of candidates)
    if (c.score > 0.005 && accepted.every((t) => Math.abs(t - c.time) >= 8)) {
      accepted.push(c.time);
      if (accepted.length >= 128) break;
    }
  return accepted.sort((a, b) => a - b);
}
/** Streaming stereo analysis with fixed PCM storage, preserving opposite-phase power. */
export class TrackFeatureAccumulator {
  private analyzer: SpectrumAnalyzer;
  private left = new Float32Array(2048);
  private right = new Float32Array(2048);
  private fill = 0;
  private samples = 0;
  private energy: number[] = [];
  private novelty: number[] = [];
  private onsets: number[] = [];
  readonly hop = 512;
  constructor(
    readonly sampleRate: number,
    readonly duration: number,
  ) {
    this.analyzer = new SpectrumAnalyzer(sampleRate, 2048, this.hop);
  }
  push(left: Float32Array, right = left): void {
    for (let i = 0; i < left.length; i++) {
      this.left[this.fill] = left[i];
      this.right[this.fill] = right[i] ?? left[i];
      this.fill++;
      this.samples++;
      if (this.fill === 2048) {
        const f = this.analyzer.analyze(
          this.left,
          this.samples / this.sampleRate,
          this.right,
          false,
        );
        if (f.beatOnset) this.onsets.push(this.samples / this.sampleRate);
        this.energy.push(f.rms);
        this.novelty.push(f.spectralFlux);
        this.left.copyWithin(0, this.hop);
        this.right.copyWithin(0, this.hop);
        this.fill -= this.hop;
      }
    }
  }
  result(final = false): TrackAnalysis {
    const energy = new Float32Array(this.energy),
      novelty = new Float32Array(this.novelty),
      hopSeconds = this.hop / this.sampleRate;
    const rhythm = final
      ? estimateBeats(novelty, hopSeconds)
      : { bpm: null, confidence: 0, beats: [] };
    const offset = 2048 / this.sampleRate;
    return {
      version: 1,
      duration: this.duration,
      progress: Math.min(
        1,
        this.samples / Math.max(1, this.duration * this.sampleRate),
      ),
      hopSeconds,
      energy,
      novelty,
      ...rhythm,
      onsets: this.onsets.slice(),
      beats: rhythm.beats.map((t) => t + offset),
      landmarks: final
        ? energyLandmarks(energy, novelty, hopSeconds).map((t) => t + offset)
        : [],
    };
  }
}
