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

/** Audio feature payload */
export interface AudioFeatures {
  /** FFT frequency bins, normalized [0, 1] */
  fftBins: Float32Array;
  /** Bass energy (20-250Hz), normalized [0, 1] */
  bass: number;
  /** Mid energy (250-4000Hz), normalized [0, 1] */
  mid: number;
  /** High energy (4000-20000Hz), normalized [0, 1] */
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
  /** Whether this is a degraded feature set (WASM fallback) */
  degraded: boolean;
}

/** Channel type map for type-safe subscriptions */
export interface ChannelMap {
  'audio:features': AudioFeatures;
  'audio:error': { message: string; fallback: boolean };
  [key: string]: unknown;
}
