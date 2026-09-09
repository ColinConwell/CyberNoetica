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
