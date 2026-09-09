import type { AudioFeatures } from '@cybernoetica/core';

export const ANALYSIS_FFT_SIZE = 4096;
export const ANALYSIS_HOP_SIZE = 512;
const clamp = (value: number) => Math.max(0, Math.min(1, value));

/** A level mapping, not normalization by the loudest band in the current frame. */
export function visualLevel(rms: number): number {
  return rms > 0.001 ? clamp((20 * Math.log10(rms) + 60) / 54) : 0;
}

/** Shared by AudioWorklet and the main-thread compatibility path. */
export class SpectrumAnalyzer {
  private real: Float64Array;
  private imaginary: Float64Array;
  private leftPower: Float64Array;
  private leftReal: Float64Array;
  private leftImaginary: Float64Array;
  private previous: Float64Array;
  private window: Float64Array;
  private reversed: Uint32Array;
  private cosine: Float64Array;
  private sine: Float64Array;
  private history = new Float64Array(64);
  private historyCount = 0;
  private sequence = 0;
  private onsetId = 0;
  private previousRms = 0;
  private lastOnset = -Infinity;
  private pitch = 0;
  private pitchConfidence = 0;

  constructor(
    readonly sampleRate: number,
    readonly fftSize = ANALYSIS_FFT_SIZE,
    readonly hopSize = ANALYSIS_HOP_SIZE,
  ) {
    if (
      !Number.isInteger(fftSize) ||
      fftSize < 32 ||
      fftSize > 32768 ||
      fftSize & (fftSize - 1) ||
      !Number.isFinite(sampleRate) ||
      sampleRate <= 0 ||
      !Number.isInteger(hopSize) ||
      hopSize < 1 ||
      hopSize > fftSize
    )
      throw new Error('Invalid FFT configuration');
    this.real = new Float64Array(fftSize);
    this.imaginary = new Float64Array(fftSize);
    this.leftPower = new Float64Array(fftSize / 2);
    this.leftReal = new Float64Array(fftSize / 2);
    this.leftImaginary = new Float64Array(fftSize / 2);
    this.previous = new Float64Array(fftSize / 2);
    this.window = new Float64Array(fftSize);
    this.reversed = new Uint32Array(fftSize);
    this.cosine = new Float64Array(fftSize);
    this.sine = new Float64Array(fftSize);
    const bits = Math.log2(fftSize);
    for (let i = 0; i < fftSize; i++) {
      this.window[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / fftSize);
      this.cosine[i] = Math.cos((2 * Math.PI * i) / fftSize);
      this.sine[i] = Math.sin((2 * Math.PI * i) / fftSize);
      let reversed = 0;
      for (let b = 0; b < bits; b++)
        reversed = (reversed << 1) | ((i >>> b) & 1);
      this.reversed[i] = reversed;
    }
  }

  reset(): void {
    this.previousRms = 0;
    this.previous.fill(0);
    this.history.fill(0);
    this.historyCount = 0;
    this.lastOnset = -Infinity;
    this.pitch = 0;
    this.pitchConfidence = 0;
  }

  private transform(samples: Float32Array): void {
    const n = this.fftSize;
    for (let i = 0; i < n; i++) {
      const sample = samples[i] ?? 0;
      this.real[this.reversed[i]] =
        (Number.isFinite(sample) ? sample : 0) * this.window[i];
      this.imaginary[this.reversed[i]] = 0;
    }
    for (let size = 2; size <= n; size *= 2) {
      const half = size / 2;
      const stride = n / size;
      for (let base = 0; base < n; base += size) {
        for (let j = 0; j < half; j++) {
          const a = base + j;
          const b = a + half;
          const c = this.cosine[j * stride];
          const s = -this.sine[j * stride];
          const re = c * this.real[b] - s * this.imaginary[b];
          const im = s * this.real[b] + c * this.imaginary[b];
          this.real[b] = this.real[a] - re;
          this.imaginary[b] = this.imaginary[a] - im;
          this.real[a] += re;
          this.imaginary[a] += im;
        }
      }
    }
  }

  analyze(left: Float32Array, timestamp: number, right = left): AudioFeatures {
    const n = this.fftSize;
    const bins = n / 2;
    const width = this.sampleRate / n;
    this.transform(left);
    for (let i = 0; i < bins; i++) {
      this.leftReal[i] = this.real[i];
      this.leftImaginary[i] = this.imaginary[i];
      this.leftPower[i] = this.real[i] ** 2 + this.imaginary[i] ** 2;
    }
    if (right !== left) this.transform(right);
    const amplitudes = new Float32Array(bins);
    const fftBins = new Float32Array(bins);
    const powers = [0, 0, 0];
    let weighted = 0;
    let total = 0;
    let flux = 0;
    let spectrumPower = 0;
    let peakBin = 1;
    for (let i = 0; i < bins; i++) {
      const power =
        (this.leftPower[i] + this.real[i] ** 2 + this.imaginary[i] ** 2) / 2;
      const amplitude = (Math.sqrt(power) * (i === 0 ? 2 : 4)) / n;
      amplitudes[i] = amplitude;
      fftBins[i] =
        amplitude > 0 ? clamp((20 * Math.log10(amplitude) + 100) / 100) : 0;
      const frequency = i * width;
      if (frequency >= 20 && frequency < 20000) {
        const band = frequency < 250 ? 0 : frequency < 4000 ? 1 : 2;
        // Periodic Hann has mean-square 3/8. One-sided amplitudes above
        // account for its coherent gain; division by 3 recovers band power.
        powers[band] += (amplitude * amplitude) / 3;
      }
      total += amplitude;
      weighted += frequency * amplitude;
      flux += Math.max(0, amplitude - this.previous[i]) ** 2;
      spectrumPower += amplitude * amplitude;
      if (i > 0 && amplitude > amplitudes[peakBin]) peakBin = i;
      this.previous[i] = amplitude;
    }
    let ll = 0;
    let rr = 0;
    let lr = 0;
    for (let i = 0; i < n; i++) {
      const l = Number.isFinite(left[i]) ? left[i] : 0;
      const r = Number.isFinite(right[i]) ? right[i] : 0;
      ll += l * l;
      rr += r * r;
      lr += l * r;
    }
    const rms = Math.sqrt((ll + rr) / (2 * n));
    const novelty =
      rms > 0.001 ? clamp(Math.sqrt(flux / Math.max(spectrumPower, 1e-12))) : 0;
    const history = Array.from(
      this.history.subarray(
        0,
        Math.min(this.historyCount, this.history.length),
      ),
    ).sort((a, b) => a - b);
    const median = history.length ? history[Math.floor(history.length / 2)] : 0;
    const deviations = history
      .map((value) => Math.abs(value - median))
      .sort((a, b) => a - b);
    const mad = deviations.length
      ? deviations[Math.floor(deviations.length / 2)]
      : 0;
    const threshold = Math.max(0.08, median + 3 * mad);
    const onset =
      this.historyCount >= 4 &&
      novelty > threshold &&
      rms > 0.002 &&
      rms >= this.previousRms * 0.995 &&
      timestamp - this.lastOnset >= 0.14;
    this.previousRms = rms;
    if (onset) {
      this.lastOnset = timestamp;
      this.onsetId++;
    }
    this.history[this.historyCount++ % this.history.length] = novelty;
    if (this.sequence % 8 === 0) this.estimatePitch(left, rms);
    const bandLevels = {
      bass: Math.sqrt(powers[0]),
      mid: Math.sqrt(powers[1]),
      high: Math.sqrt(powers[2]),
    };
    const bandSum = Math.max(
      1e-12,
      bandLevels.bass + bandLevels.mid + bandLevels.high,
    );
    const crossReal =
      this.leftReal[peakBin] * this.real[peakBin] +
      this.leftImaginary[peakBin] * this.imaginary[peakBin];
    const crossImaginary =
      this.leftImaginary[peakBin] * this.real[peakBin] -
      this.leftReal[peakBin] * this.imaginary[peakBin];
    return {
      fftBins,
      spectrum: amplitudes,
      waveform: left.slice(0, n),
      bass: visualLevel(bandLevels.bass),
      mid: visualLevel(bandLevels.mid),
      high: visualLevel(bandLevels.high),
      bandLevels,
      bandBalance: {
        bass: bandLevels.bass / bandSum,
        mid: bandLevels.mid / bandSum,
        high: bandLevels.high / bandSum,
      },
      rms: clamp(rms),
      spectralCentroid:
        total > 1e-10 ? weighted / total / (this.sampleRate / 2) : 0,
      spectralFlux: novelty,
      beatOnset: onset,
      beatConfidence: onset
        ? clamp((novelty - threshold) / (threshold + 0.05))
        : 0,
      timestamp,
      sequence: ++this.sequence,
      onsetId: this.onsetId,
      sampleRate: this.sampleRate,
      fftSize: n,
      hopSize: this.hopSize,
      pitchHz: this.pitch,
      pitchConfidence: this.pitchConfidence,
      stereoCorrelation:
        ll * rr > 1e-12
          ? Math.max(-1, Math.min(1, lr / Math.sqrt(ll * rr)))
          : 0,
      stereoPhase:
        spectrumPower > 1e-10 ? Math.atan2(crossImaginary, crossReal) : 0,
      degraded: false,
    };
  }

  private estimatePitch(samples: Float32Array, rms: number): void {
    this.pitch = 0;
    this.pitchConfidence = 0;
    if (rms < 0.003) return;
    const stride = 4;
    const count = Math.min(1024, samples.length / stride);
    const rate = this.sampleRate / stride;
    const minLag = Math.max(2, Math.floor(rate / 1500));
    const maxLag = Math.min(Math.floor(rate / 50), Math.floor(count / 2));
    const correlations = new Float64Array(maxLag + 1);
    let best = 0;
    for (let lag = minLag; lag <= maxLag; lag++) {
      let cross = 0;
      let a = 0;
      let b = 0;
      for (let i = 0; i < count - lag; i++) {
        const x = samples[i * stride];
        const y = samples[(i + lag) * stride];
        cross += x * y;
        a += x * x;
        b += y * y;
      }
      correlations[lag] = cross / Math.sqrt(Math.max(a * b, 1e-20));
      best = Math.max(best, correlations[lag]);
    }
    for (let lag = minLag + 1; lag < maxLag; lag++) {
      const value = correlations[lag];
      if (
        value > Math.max(0.75, best * 0.9) &&
        value > correlations[lag - 1] &&
        value >= correlations[lag + 1]
      ) {
        const denominator =
          correlations[lag - 1] - 2 * value + correlations[lag + 1];
        const offset = denominator
          ? (0.5 * (correlations[lag - 1] - correlations[lag + 1])) /
            denominator
          : 0;
        this.pitch = rate / (lag + Math.max(-0.5, Math.min(0.5, offset)));
        this.pitchConfidence = clamp(value);
        return;
      }
    }
  }
}
