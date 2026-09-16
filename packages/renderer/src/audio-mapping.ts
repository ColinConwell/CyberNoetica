import type { AudioFeatures } from '@cybernoetica/core';

/** Visual envelope gain: zero stays silent, unity is linear, full scale stays bounded.
 * Keep this downstream of analysis; never apply to calibrated spectra or pitch. */
export function visualLevel(level: number, gain = 2.5): number {
  const x = Number.isFinite(level) ? Math.max(0, Math.min(1, level)) : 0;
  const g = Number.isFinite(gain) ? Math.max(0, Math.min(8, gain)) : 2.5;
  return g === 0 ? 0 : (g * x) / (1 + (g - 1) * x);
}
export function motionLevel(key: string, level: number, gain: number): number {
  return ['bass', 'mid', 'high', 'rms'].includes(key)
    ? visualLevel(level, gain)
    : level;
}

/** Interpolate linear amplitudes at a physical frequency; no dB arithmetic. */
export function spectrumAt(
  features: AudioFeatures,
  frequencyHz: number,
): number {
  const data = features.spectrum;
  if (
    !data?.length ||
    !features.sampleRate ||
    !features.fftSize ||
    frequencyHz < 0
  )
    return 0;
  const bin = (frequencyHz * features.fftSize) / features.sampleRate;
  if (bin >= data.length - 1) return 0;
  const lower = Math.floor(bin);
  const mix = bin - lower;
  return data[lower] * (1 - mix) + data[lower + 1] * mix;
}

/** RMS response of a damped resonator with unit peak gain and quality factor Q. */
export function resonantLevel(
  features: AudioFeatures,
  frequencyHz: number,
  q: number,
): number {
  const spectrum = features.spectrum;
  if (
    !spectrum?.length ||
    !features.sampleRate ||
    !features.fftSize ||
    frequencyHz <= 0 ||
    q <= 0
  )
    return 0;
  const binHz = features.sampleRate / features.fftSize;
  let power = 0;
  for (let i = 1; i < spectrum.length; i++) {
    const ratio = (i * binHz) / frequencyHz;
    const gainSquared = 1 / (q * q * (1 - ratio * ratio) ** 2 + ratio * ratio);
    power += (spectrum[i] ** 2 * gainSquared) / 3;
  }
  return Math.sqrt(power);
}

/** Schmitt quantization prevents topology chatter near half-integers. */
export function topologyValue(
  previous: number,
  target: number,
  minimum: number,
  maximum: number,
  margin = 0.15,
): number {
  const bounded = Math.max(minimum, Math.min(maximum, target));
  return Math.abs(bounded - previous) > 0.5 + margin
    ? Math.round(bounded)
    : previous;
}
