import {
  ANALYSIS_FFT_SIZE,
  ANALYSIS_HOP_SIZE,
  SpectrumAnalyzer,
} from './spectrum-analyzer.js';

declare const sampleRate: number;
declare const currentFrame: number;
declare class AudioWorkletProcessor {
  readonly port: MessagePort;
}
declare function registerProcessor(
  name: string,
  processor: typeof AudioWorkletProcessor,
): void;

class AudioAnalysisProcessor extends AudioWorkletProcessor {
  private analyzer = new SpectrumAnalyzer(sampleRate);
  private left = new Float32Array(ANALYSIS_FFT_SIZE);
  private right = new Float32Array(ANALYSIS_FFT_SIZE);
  private orderedLeft = new Float32Array(ANALYSIS_FFT_SIZE);
  private orderedRight = new Float32Array(ANALYSIS_FFT_SIZE);
  private cursor = 0;
  private samples = 0;
  private revision = 0;

  constructor() {
    super();
    this.port.onmessage = (event) => {
      if (event.data?.type !== 'reset') return;
      this.revision = event.data.revision;
      this.samples = 0;
      this.cursor = 0;
      this.left.fill(0);
      this.right.fill(0);
      this.analyzer.reset();
    };
  }

  process(inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
    for (const channels of outputs)
      for (const output of channels) output.fill(0);
    const left = inputs[0]?.[0];
    if (!left) return true;
    const right = inputs[0][1] ?? left;
    for (let i = 0; i < left.length; i++) {
      this.left[this.cursor] = left[i];
      this.right[this.cursor] = right[i];
      this.cursor = (this.cursor + 1) % ANALYSIS_FFT_SIZE;
      this.samples++;
      if (
        this.samples >= ANALYSIS_FFT_SIZE &&
        this.samples % ANALYSIS_HOP_SIZE === 0
      ) {
        for (let j = 0; j < ANALYSIS_FFT_SIZE; j++) {
          const k = (this.cursor + j) % ANALYSIS_FFT_SIZE;
          this.orderedLeft[j] = this.left[k];
          this.orderedRight[j] = this.right[k];
        }
        const features = this.analyzer.analyze(
          this.orderedLeft,
          (currentFrame + i + 1) / sampleRate,
          this.orderedRight,
        );
        this.port.postMessage({ features, revision: this.revision }, [
          features.fftBins.buffer,
          features.spectrum!.buffer,
          features.waveform!.buffer,
        ]);
      }
    }
    return true;
  }
}

registerProcessor('cybernoetica-analysis', AudioAnalysisProcessor);
