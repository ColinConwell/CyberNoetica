/** Timestamp in milliseconds (performance.now or Date.now) */
export type Timestamp = number;

/** A message on the bus */
export interface BusMessage<T = unknown> {
  channel: string;
  payload: T;
  timestamp: Timestamp;
}

/** Channel identifier — supports namespaced channels like "audio:features" */
export type Channel = string;

/** Unsubscribe function returned by subscribe() */
export type Unsubscribe = () => void;

/** Audio feature payload. See docs/audio-features.md for units and calibration. */
export interface AudioFeatures {
  /** FFT frequency bins, normalized [0, 1] */
  fftBins: Float32Array;
  /** One-sided linear FFT amplitudes with Hann coherent-gain correction. */
  spectrum?: Float32Array;
  /** Left-channel time samples, full scale [-1, 1]. */
  waveform?: Float32Array;
  /** Uncompressed RMS band levels and relative timbral proportions. */
  bandLevels?: { bass: number; mid: number; high: number };
  bandBalance?: { bass: number; mid: number; high: number };
  /** End of the analysis window in AudioContext seconds, not wall time. */
  timestamp?: number;
  sequence?: number;
  /** Monotonically increasing onset event ID; consumers must not replay it. */
  onsetId?: number;
  sampleRate?: number;
  fftSize?: number;
  hopSize?: number;
  pitchHz?: number;
  pitchConfidence?: number;
  stereoCorrelation?: number;
  stereoPhase?: number;
  /** Bass level (20–250 Hz), -60 to -6 dBFS mapped to [0, 1]. */
  bass: number;
  /** Mid level (250–4000 Hz), same absolute level mapping. */
  mid: number;
  /** High level (4000–20000 Hz), same absolute level mapping. */
  high: number;
  /** Spectral centroid as fraction of Nyquist [0, 1] */
  spectralCentroid: number;
  /** Spectral flux (rate of spectral change) [0, 1] */
  spectralFlux: number;
  /** RMS energy [0, 1] */
  rms: number;
  /** Beat onset detected this frame */
  beatOnset: boolean;
  /** Beat onset confidence [0, 1] */
  beatConfidence: number;
  /** Whether features use an incomplete compatibility path */
  degraded: boolean;
}

/** Channel type map for type-safe subscriptions */
export interface ChannelMap {
  'audio:features': AudioFeatures;
  'audio:error': { message: string; fallback: boolean };
  [key: string]: unknown;
}
