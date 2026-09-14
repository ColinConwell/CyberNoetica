export { AudioProcessor } from './audio-processor.js';
export { AudioSource } from './audio-source.js';
export type { AudioSourceType } from './audio-source.js';
export {
  clampSoundscapeParams,
  DEFAULT_SOUNDSCAPE_PARAMS,
  soundscapeBeatIndex,
  soundscapeGainsAt,
  soundscapePhase,
} from './soundscape-loop.js';
export type { SoundscapeGains, SoundscapeParams } from './soundscape-loop.js';

export {
  SpectrumAnalyzer,
  ANALYSIS_FFT_SIZE,
  ANALYSIS_HOP_SIZE,
  visualLevel,
} from './spectrum-analyzer.js';

export * from './track-analysis.js';
export { TrackAnalysisClient } from './track-analysis-client.js';

export * from './soundscape-patch.js';
export { SoundscapeEngine } from './soundscape-engine.js';
