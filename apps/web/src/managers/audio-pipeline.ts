import {
  AudioSource,
  AudioProcessor,
  SpectrumAnalyzer,
  ANALYSIS_HOP_SIZE,
} from '@cybernoetica/audio';
import type { MessageBus, AudioFeatures } from '@cybernoetica/core';

/** Analysis follows the audio clock. Publishing follows presentation cadence. */
export class AudioPipeline {
  readonly source = new AudioSource();
  private processor: AudioProcessor;
  private analyzer: SpectrumAnalyzer | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private worklet = false;
  private latest: AudioFeatures | null = null;
  private pendingOnset = false;
  private pendingConfidence = 0;
  private lastAnalysisTime = -Infinity;
  private generation = 0;
  private sourceRevision = -1;

  constructor(private bus: MessageBus) {
    this.processor = new AudioProcessor(bus);
  }

  async init(): Promise<void> {
    const generation = ++this.generation;
    await this.source.init();
    if (generation !== this.generation) return;
    this.analyzer = new SpectrumAnalyzer(this.source.getSampleRate() ?? 48000);
    this.worklet = await this.source.startAnalysis(
      (features) => {
        if (generation === this.generation) this.accept(features);
      },
      () => {
        if (generation === this.generation) {
          this.worklet = false;
          this.publishBackend();
        }
      },
    );
    if (generation !== this.generation) return;
    this.publishBackend();
    this.timer = setInterval(() => {
      if (!this.worklet) this.analyzeFallback();
    }, 8);
  }

  private publishBackend(): void {
    this.bus.publish('audio:backend', { backend: this.getBackend() });
  }

  private accept(features: AudioFeatures): void {
    this.refreshSource();
    this.latest = features;
    if (features.beatOnset) {
      this.pendingOnset = true;
      this.pendingConfidence = Math.max(
        this.pendingConfidence,
        features.beatConfidence,
      );
    }
  }

  private analyzeFallback(): void {
    this.refreshSource();
    if (!this.analyzer) return;
    const time = this.source.getCurrentTime();
    if (
      time - this.lastAnalysisTime <
      ANALYSIS_HOP_SIZE / this.analyzer.sampleRate
    )
      return;
    const stereo = this.source.getStereoSamples();
    const samples = stereo?.[0] ?? this.source.getSamples();
    if (!samples) return;
    this.lastAnalysisTime = time;
    this.accept(this.analyzer.analyze(samples, time, stereo?.[1]));
  }

  pushFrame(suppressOnsets = false): void {
    this.refreshSource();
    if (!this.worklet) this.analyzeFallback();
    if (!this.latest) {
      this.pushSilent();
      return;
    }
    this.processor.pushFeatures({
      ...this.latest,
      beatOnset: this.pendingOnset && !suppressOnsets,
      beatConfidence: suppressOnsets ? 0 : this.pendingConfidence,
    });
    this.pendingOnset = false;
    this.pendingConfidence = 0;
  }

  pushSilent(rms = 0): void {
    this.pendingOnset = false;
    this.pendingConfidence = 0;
    this.processor.pushFeatures({
      fftBins: new Float32Array(0),
      spectrum: new Float32Array(0),
      waveform: new Float32Array(0),
      bass: 0,
      mid: 0,
      high: 0,
      spectralCentroid: 0,
      spectralFlux: 0,
      rms,
      beatOnset: false,
      beatConfidence: 0,
      degraded: false,
      timestamp: this.source.getCurrentTime(),
      onsetId: this.latest?.onsetId ?? 0,
      sampleRate: this.analyzer?.sampleRate,
      fftSize: this.analyzer?.fftSize,
      hopSize: ANALYSIS_HOP_SIZE,
    });
  }

  getBackend(): 'worklet' | 'main-thread' {
    return this.worklet ? 'worklet' : 'main-thread';
  }
  private refreshSource(): void {
    const revision = this.source.getSourceRevision();
    if (revision === this.sourceRevision) return;
    this.sourceRevision = revision;
    this.latest = null;
    this.pendingOnset = false;
    this.pendingConfidence = 0;
    this.lastAnalysisTime = -Infinity;
    this.analyzer?.reset();
  }
  isWasm(): boolean {
    return false;
  } // Retained for stored preferences from older versions.

  destroy(): void {
    this.generation++;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.source.destroy();
  }
}
