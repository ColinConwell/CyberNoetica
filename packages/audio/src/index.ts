export { AudioProcessor } from './audio-processor.js';
export { AudioSource } from './audio-source.js';
export type { AudioSourceType } from './audio-source.js';

export async function loadWasmAnalyzer(): Promise<any | null> {
  try {
    const wasm = await import('../wasm/audio_analysis.js');
    await wasm.default();
    return new wasm.AudioAnalyzer(2048, 44100);
  } catch {
    console.warn('WASM audio analyzer unavailable, using Web Audio fallback');
    return null;
  }
}
