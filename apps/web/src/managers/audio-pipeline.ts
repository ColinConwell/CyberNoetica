import { AudioSource, AudioProcessor, loadWasmAnalyzer } from '@cybernoetica/audio';
import type { MessageBus, AudioFeatures } from '@cybernoetica/core';

function bandAvg(data: Float32Array, from: number, to: number): number {
  if (from >= to) return 0;
  let sum = 0;
  const end = Math.min(to, data.length);
  for (let i = from; i < end; i++) sum += data[i];
  return sum / (end - from);
}

function normalizeFrequencyData(freqData: Float32Array): Float32Array {
  const linear = new Float32Array(freqData.length);
  for (let i = 0; i < freqData.length; i++) {
    // Web Audio returns dB values in roughly [-100, 0]. Map into [0, 1]
    // so spectrum-driven visualizers behave consistently across analyzer paths.
    linear[i] = Math.max(0, Math.min(1, (freqData[i] + 100) / 100));
  }
  return linear;
}

function bandEndForHz(hz: number, binWidthHz: number, length: number): number {
  if (binWidthHz <= 0 || length <= 0) return 0;
  return Math.max(0, Math.min(length, Math.floor(hz / binWidthHz)));
}

function fallbackFeatures(freqData: Float32Array, binWidthHz = 21): AudioFeatures {
  const linear = normalizeFrequencyData(freqData);
  const len = linear.length;
  let totalEnergy = 0;
  let weightedFrequency = 0;
  const safeBinWidth = binWidthHz > 0 ? binWidthHz : 21;
  const nyquistHz = safeBinWidth * len;
  for (let i = 0; i < len; i++) {
    totalEnergy += linear[i];
    weightedFrequency += linear[i] * i * safeBinWidth;
  }
  const bassStart = len > 1 ? 1 : 0;
  const bassEnd = Math.max(bassStart + 1, bandEndForHz(250, safeBinWidth, len));
  const midEnd = Math.max(bassEnd + 1, bandEndForHz(4000, safeBinWidth, len));
  return {
    fftBins: linear,
    bass: bandAvg(linear, bassStart, bassEnd),
    mid: bandAvg(linear, bassEnd, midEnd),
    high: bandAvg(linear, midEnd, len),
    spectralCentroid: totalEnergy > 0
      ? weightedFrequency / totalEnergy / Math.max(nyquistHz, 1)
      : 0,
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
    const freqData = this.source.getFrequencyData();
    const fftBins = freqData ? normalizeFrequencyData(freqData) : new Float32Array(0);
    const binWidthHz = this.source.getFrequencyBinWidth() ?? 21;

    if (this.wasmAnalyzer) {
      const samples = this.source.getSamples();
      if (samples) {
        try {
          const f = this.wasmAnalyzer.analyze(samples);
          this.processor.pushFeatures({
            fftBins,
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
      if (freqData) this.processor.pushFeatures(fallbackFeatures(freqData, binWidthHz));
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
