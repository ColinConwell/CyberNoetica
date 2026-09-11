export interface SoundscapeParams {
  /** Full exploration cycle length in seconds. */
  cycleLength: number;
  /** Overall loudness / drive, 0–1. */
  energy: number;
  /** Spectral tilt toward highs, 0–1. */
  brightness: number;
  /** Beat click rate in BPM. */
  beatRate: number;
}

export const DEFAULT_SOUNDSCAPE_PARAMS: SoundscapeParams = {
  cycleLength: 24,
  energy: 0.65,
  brightness: 0.45,
  beatRate: 96,
};

export interface SoundscapeGains {
  bass: number;
  mid: number;
  high: number;
  noise: number;
  beat: boolean;
  cutoff: number;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function clampSoundscapeParams(
  partial: Partial<SoundscapeParams>,
  base: SoundscapeParams = DEFAULT_SOUNDSCAPE_PARAMS,
): SoundscapeParams {
  const merged = { ...base, ...partial };
  return {
    cycleLength: clamp(merged.cycleLength, 8, 60),
    energy: clamp(merged.energy, 0, 1),
    brightness: clamp(merged.brightness, 0, 1),
    beatRate: clamp(merged.beatRate, 40, 180),
  };
}

export function soundscapePhase(elapsedSec: number, cycleLength: number): number {
  const len = Math.max(0.001, cycleLength);
  const wrapped = elapsedSec / len;
  const phase = wrapped - Math.floor(wrapped);
  return phase < 0 ? phase + 1 : phase;
}

export function soundscapeBeatIndex(elapsedSec: number, beatRate: number): number {
  const bps = Math.max(0.001, beatRate) / 60;
  return Math.floor(elapsedSec * bps);
}

/** Raised-cosine lobe on a wrapping [0, 1) phase. */
function lobe(phase: number, center: number, width = 0.42): number {
  let d = Math.abs(phase - center);
  if (d > 0.5) d = 1 - d;
  if (d >= width) return 0;
  return 0.5 * (1 + Math.cos((Math.PI * d) / width));
}

/**
 * Parametric gains for one instant of the looping soundscape.
 * `prevBeatIndex` is used to emit a rising-edge beat flag; pass -1 to ignore.
 */
export function soundscapeGainsAt(
  phase: number,
  params: SoundscapeParams,
  elapsedSec = 0,
  prevBeatIndex = -1,
): SoundscapeGains {
  const p = soundscapePhase(phase, 1);
  const energy = params.energy;
  const bright = params.brightness;

  const bassL = lobe(p, 0.08);
  const midL = lobe(p, 0.42);
  const highL = lobe(p, 0.78);

  const bass = energy * (0.12 + 0.88 * bassL) * (1.2 - bright * 0.5);
  const mid = energy * (0.16 + 0.84 * midL);
  const high = energy * (0.1 + 0.9 * highL) * (0.5 + bright * 0.95);
  const noise = energy * (0.06 + 0.14 * midL);
  const cutoff = clamp(0.22 + 0.5 * p * (0.35 + bright) + 0.12 * Math.sin(p * Math.PI * 2), 0, 1);

  const beatIndex = soundscapeBeatIndex(elapsedSec, params.beatRate);
  const beat = prevBeatIndex >= 0
    ? beatIndex !== prevBeatIndex
    : elapsedSec > 0 && (elapsedSec * (params.beatRate / 60) - beatIndex) < 0.08;

  return {
    bass: clamp(bass, 0, 1),
    mid: clamp(mid, 0, 1),
    high: clamp(high, 0, 1),
    noise: clamp(noise, 0, 1),
    beat,
    cutoff,
  };
}
