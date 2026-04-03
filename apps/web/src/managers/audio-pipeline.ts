import { AudioSource, AudioProcessor, loadWasmAnalyzer } from '@cybernoetica/audio';
import type { MessageBus, AudioFeatures } from '@cybernoetica/core';

function bandAvg(data: Float32Array, from: number, to: number): number {
  if (from >= to) return 0;
  let sum = 0;
  const end = Math.min(to, data.length);
  for (let i = from; i < end; i++) sum += data[i];
  return sum / (end - from);
}

function fallbackFeatures(freqData: Float32Array): AudioFeatures {
  const len = freqData.length;
  const linear = new Float32Array(len);
  let totalEnergy = 0;
  for (let i = 0; i < len; i++) {
    linear[i] = Math.max(0, (freqData[i] + 100) / 100);
    totalEnergy += linear[i];
  }
  const bassEnd = Math.floor(250 / 21);
  const midEnd = Math.floor(4000 / 21);
  return {
    fftBins: linear,
    bass: bandAvg(linear, 1, bassEnd),
    mid: bandAvg(linear, bassEnd, midEnd),
    high: bandAvg(linear, midEnd, len),
    spectralCentroid: totalEnergy > 0
      ? Array.from(linear).reduce((sum, v, i) => sum + v * i, 0) / totalEnergy / len : 0,
    spectralFlux: 0,
    rms: totalEnergy / len,
    beatOnset: false,
    beatConfidence: 0,
    degraded: true,
  };
}

export class AudioPipeline {
  readonly source: AudioSource;
  private processor: AudioProcessor;
  private wasmAnalyzer: any = null;

  constructor(bus: MessageBus) {
    this.source = new AudioSource();
    this.processor = new AudioProcessor(bus);
  }

  async init(): Promise<void> {
    await this.source.init();
    this.wasmAnalyzer = await loadWasmAnalyzer();
    if (this.wasmAnalyzer) console.log('CyberNoetica: WASM audio analyzer loaded');
  }

  pushFrame(): void {
    if (this.wasmAnalyzer) {
      const samples = this.source.getSamples();
      if (samples) {
        try {
          const f = this.wasmAnalyzer.analyze(samples);
          this.processor.pushFeatures({
            fftBins: new Float32Array(0),
            bass: f.bass, mid: f.mid, high: f.high,
            spectralCentroid: f.spectral_centroid,
            spectralFlux: f.spectral_flux,
            rms: f.rms,
            beatOnset: f.beat_onset,
            beatConfidence: f.beat_confidence,
            degraded: false,
          });
        } catch { /* skip frame */ }
      }
    } else {
      const freqData = this.source.getFrequencyData();
      if (freqData) this.processor.pushFeatures(fallbackFeatures(freqData));
    }
  }

  pushSilent(rms = 0): void {
    this.processor.pushFeatures({
      fftBins: new Float32Array(0),
      bass: 0, mid: 0, high: 0,
      spectralCentroid: 0.5, spectralFlux: 0,
      rms,
      beatOnset: false, beatConfidence: 0, degraded: true,
    });
  }

  isWasm(): boolean { return this.wasmAnalyzer !== null; }
}
