/// <reference path="./worklet-url.d.ts" />
import type { AudioTransport } from './track-analysis.js';
import { SoundscapeEngine } from './soundscape-engine.js';
import {
  DEFAULT_SOUNDSCAPE_PATCH,
  validateSoundscapePatch,
} from './soundscape-patch.js';
import type { SoundscapePatch } from './soundscape-patch.js';
import analysisWorkletUrl from './analysis-worklet.ts?worker&url';
import { ANALYSIS_FFT_SIZE } from './spectrum-analyzer.js';
import type { AudioFeatures } from '@cybernoetica/core';
import {
  clampSoundscapeParams,
  DEFAULT_SOUNDSCAPE_PARAMS,
  type SoundscapeParams,
} from './soundscape-loop.js';

export type AudioSourceType = 'none' | 'file' | 'mic' | 'system' | 'soundscape';

export class AudioSource {
  private audioContext: AudioContext | null = null;
  private analyserNode: AnalyserNode | null = null;
  private gainNode: GainNode | null = null;
  private analysisGainNode: GainNode | null = null;
  private splitter: ChannelSplitterNode | null = null;
  private channelAnalysers: AnalyserNode[] = [];
  private stereoSamples:
    | [Float32Array<ArrayBuffer>, Float32Array<ArrayBuffer>]
    | null = null;
  private analysisGain = 1;
  setAnalysisGain(gain: number): void {
    if (!Number.isFinite(gain)) return;
    this.analysisGain = Math.max(0.25, Math.min(4, gain));
    if (this.analysisGainNode)
      this.analysisGainNode.gain.value = this.analysisGain;
  }
  private sourceNode: AudioNode | null = null;
  private mediaBuffer: AudioBuffer | null = null;
  private mediaOffset = 0;
  private mediaStart = 0;
  private seekRevision = 0;
  private activeStream: MediaStream | null = null;
  private timeDomainData: Float32Array<ArrayBuffer> | null = null;
  private onEndedCallback: (() => void) | null = null;
  private _sourceType: AudioSourceType = 'none';
  private _muted = false;
  private sourceGeneration = 0;
  private sourceRevision = 0;
  getSourceRevision(): number {
    return this.sourceRevision;
  }
  private pendingSource: AbortController | null = null;
  private analysisNode: AudioWorkletNode | null = null;
  private frequencyData: Float32Array<ArrayBuffer> | null = null;

  private soundscapeEngine: SoundscapeEngine | null = null;
  private soundscapePatch: SoundscapePatch = structuredClone(
    DEFAULT_SOUNDSCAPE_PATCH,
  );
  private soundscapeParams: SoundscapeParams = { ...DEFAULT_SOUNDSCAPE_PARAMS };

  get sourceType(): AudioSourceType {
    return this._sourceType;
  }
  get muted(): boolean {
    return this._muted;
  }
  getSoundscapeParams(): SoundscapeParams {
    return { ...this.soundscapeParams };
  }

  setMuted(muted: boolean): void {
    this._muted = muted;
    if (this.gainNode)
      this.gainNode.gain.value =
        muted || this._sourceType === 'mic' || this._sourceType === 'system'
          ? 0
          : 1;
  }

  async init(): Promise<void> {
    this.audioContext = new AudioContext();
    this.analyserNode = this.audioContext.createAnalyser();
    this.analyserNode.fftSize = ANALYSIS_FFT_SIZE;
    this.analyserNode.smoothingTimeConstant = 0;
    this.frequencyData = new Float32Array(this.analyserNode.frequencyBinCount);
    this.gainNode = this.audioContext.createGain();
    if (this._muted) this.gainNode.gain.value = 0;
    this.analyserNode.connect(this.gainNode);
    this.analysisGainNode = this.audioContext.createGain();
    this.analysisGainNode.channelCount = 2;
    this.analysisGainNode.channelCountMode = 'explicit';
    this.analysisGainNode.channelInterpretation = 'speakers';
    this.analysisGainNode.gain.value = this.analysisGain;
    this.analyserNode.connect(this.analysisGainNode);
    this.splitter = this.audioContext.createChannelSplitter(2);
    this.analysisGainNode.connect(this.splitter);
    this.stereoSamples = [
      new Float32Array(ANALYSIS_FFT_SIZE),
      new Float32Array(ANALYSIS_FFT_SIZE),
    ];
    this.channelAnalysers = [0, 1].map((channel) => {
      const analyser = this.audioContext!.createAnalyser();
      analyser.fftSize = ANALYSIS_FFT_SIZE;
      analyser.smoothingTimeConstant = 0;
      this.splitter!.connect(analyser, channel);
      return analyser;
    });
    this.gainNode.connect(this.audioContext.destination);
    this.timeDomainData = new Float32Array(
      this.analyserNode.fftSize,
    ) as Float32Array<ArrayBuffer>;
  }

  async startAnalysis(
    onFeatures: (features: AudioFeatures) => void,
    onFailure: () => void,
  ): Promise<boolean> {
    const ctx = this.audioContext;
    if (
      !ctx?.audioWorklet ||
      !this.analyserNode ||
      typeof AudioWorkletNode === 'undefined'
    )
      return false;
    try {
      await ctx.audioWorklet.addModule(analysisWorkletUrl);
      if (ctx !== this.audioContext) return false;
      const node = new AudioWorkletNode(ctx, 'cybernoetica-analysis', {
        numberOfInputs: 1,
        numberOfOutputs: 1,
        outputChannelCount: [1],
        channelCount: 2,
        channelCountMode: 'explicit',
      });
      node.port.onmessage = (event) => {
        if (event.data.revision === this.sourceRevision)
          onFeatures(event.data.features as AudioFeatures);
      };
      node.port.postMessage({ type: 'reset', revision: this.sourceRevision });
      node.onprocessorerror = () => {
        if (this.analysisNode !== node || ctx !== this.audioContext) return;
        try {
          this.analysisGainNode?.disconnect(node);
        } catch {
          /* Already disconnected during source teardown. */
        }
        node.disconnect();
        node.port.close();
        if (this.analysisNode === node) this.analysisNode = null;
        onFailure();
      };
      this.analysisGainNode!.connect(node);
      node.connect(ctx.destination); // The analysis output is explicitly silent.
      this.analysisNode = node;
      return true;
    } catch (error) {
      console.warn(
        'AudioWorklet unavailable; using the same DSP on the main thread',
        error,
      );
      return false;
    }
  }

  getCurrentTime(): number {
    return this.audioContext?.currentTime ?? 0;
  }

  private stopCurrentSource(): void {
    this.mediaBuffer = null;
    this.mediaOffset = 0;
    this.sourceRevision++;
    this.analysisNode?.port.postMessage({
      type: 'reset',
      revision: this.sourceRevision,
    });
    this.soundscapeEngine?.dispose();
    this.soundscapeEngine = null;

    if (this.sourceNode) {
      if ('onended' in this.sourceNode)
        (this.sourceNode as AudioBufferSourceNode).onended = null;
      if ('stop' in this.sourceNode) {
        try {
          (this.sourceNode as AudioBufferSourceNode).stop();
        } catch {
          /* already stopped */
        }
      }
      try {
        this.sourceNode.disconnect();
      } catch {
        /* already disconnected */
      }
      this.sourceNode = null;
    }
    if (this.activeStream) {
      for (const track of this.activeStream.getTracks()) track.stop();
      this.activeStream = null;
    }
    this._sourceType = 'none';
  }

  /** Invalidate pending fetch/decode/capture without interrupting the current sound. */
  cancelPendingLoad(): void {
    this.sourceGeneration++;
    this.pendingSource?.abort();
    this.pendingSource = null;
  }

  private beginRequest(): { generation: number; signal: AbortSignal } {
    this.cancelPendingLoad();
    this.pendingSource = new AbortController();
    return {
      generation: this.sourceGeneration,
      signal: this.pendingSource.signal,
    };
  }

  async loadFile(file: File): Promise<boolean> {
    return this.loadBuffer(() => file.arrayBuffer());
  }

  async loadURL(url: string): Promise<boolean> {
    return this.loadBuffer(async (signal) => {
      const response = await fetch(url, { signal });
      if (!response.ok)
        throw new Error(`Audio request failed (${response.status})`);
      return response.arrayBuffer();
    });
  }

  private async loadBuffer(
    read: (signal: AbortSignal) => Promise<ArrayBuffer>,
  ): Promise<boolean> {
    const ctx = this.audioContext;
    const analyser = this.analyserNode;
    if (!ctx || !analyser) throw new Error('AudioSource not initialized');
    const request = this.beginRequest();
    try {
      await this.resume();
      const bytes = await read(request.signal);
      if (request.generation !== this.sourceGeneration) return false;
      const buffer = await ctx.decodeAudioData(bytes);
      if (
        request.generation !== this.sourceGeneration ||
        ctx !== this.audioContext
      )
        return false;
      const source = ctx.createBufferSource();
      source.buffer = buffer;
      this.stopCurrentSource();
      source.connect(analyser);
      this.sourceNode = source;
      this._sourceType = 'file';
      this.mediaBuffer = buffer;
      this.mediaStart = this.getCurrentTime();
      this.mediaOffset = 0;
      this.setMuted(this._muted);
      source.onended = () => {
        if (
          this.sourceNode === source &&
          request.generation === this.sourceGeneration
        )
          this.onEndedCallback?.();
      };
      source.start();
      return true;
    } catch (error) {
      if (request.generation !== this.sourceGeneration) return false;
      throw error;
    }
  }

  async useMicrophone(): Promise<boolean> {
    return this.capture('mic', () =>
      navigator.mediaDevices.getUserMedia({ audio: true }),
    );
  }

  async useSystemAudio(): Promise<boolean> {
    const constraints: DisplayMediaStreamOptions & {
      systemAudio: string;
      preferCurrentTab: boolean;
    } = {
      audio: true,
      video: true,
      systemAudio: 'include',
      preferCurrentTab: true,
    };
    return this.capture('system', () =>
      navigator.mediaDevices.getDisplayMedia(constraints),
    );
  }

  private async capture(
    type: 'mic' | 'system',
    acquire: () => Promise<MediaStream>,
  ): Promise<boolean> {
    const ctx = this.audioContext;
    const analyser = this.analyserNode;
    if (!ctx || !analyser) throw new Error('AudioSource not initialized');
    const request = this.beginRequest();
    let stream: MediaStream | null = null;
    try {
      stream = await acquire();
      for (const track of stream.getVideoTracks()) track.stop();
      if (
        request.generation !== this.sourceGeneration ||
        ctx !== this.audioContext
      ) {
        for (const track of stream.getTracks()) track.stop();
        return false;
      }
      if (!stream.getAudioTracks().length)
        throw new Error(
          'No audio captured. Enable audio sharing and try again.',
        );
      await this.resume();
      if (request.generation !== this.sourceGeneration) {
        for (const track of stream.getTracks()) track.stop();
        return false;
      }
      const source = ctx.createMediaStreamSource(stream);
      this.stopCurrentSource();
      source.connect(analyser);
      this.sourceNode = source;
      this.activeStream = stream;
      this._sourceType = type;
      this.setMuted(this._muted); // Capture is analysis-only, preventing feedback and doubled system audio.
      return true;
    } catch (error) {
      for (const track of stream?.getTracks() ?? []) track.stop();
      if (request.generation !== this.sourceGeneration) return false;
      throw error;
    }
  }

  useSilence(): boolean {
    this.cancelPendingLoad();
    this.stopCurrentSource();
    return true;
  }

  startSoundscape(params?: Partial<SoundscapeParams>): void {
    this.cancelPendingLoad();
    if (!this.audioContext || !this.analyserNode)
      throw new Error('AudioSource not initialized');
    this.stopCurrentSource();
    this.soundscapeParams = clampSoundscapeParams(
      params ?? {},
      DEFAULT_SOUNDSCAPE_PARAMS,
    );
    this.soundscapeEngine = new SoundscapeEngine(
      this.audioContext,
      this.soundscapeParams,
      this.soundscapePatch,
    );
    this.soundscapeEngine.output.connect(this.analyserNode);
    this.sourceNode = this.soundscapeEngine.output;
    this._sourceType = 'soundscape';
    this.setMuted(this._muted);
  }
  setSoundscapeParams(partial: Partial<SoundscapeParams>): void {
    this.soundscapeParams = clampSoundscapeParams(
      partial,
      this.soundscapeParams,
    );
    this.soundscapeEngine?.setParams(this.soundscapeParams);
  }
  getSoundscapePatch(): SoundscapePatch {
    return structuredClone(this.soundscapePatch);
  }
  setSoundscapePatch(patch: SoundscapePatch): void {
    this.soundscapePatch = validateSoundscapePatch(patch);
    this.soundscapeEngine?.setPatch(this.soundscapePatch);
  }
  getSynthSignals(): Record<string, number> {
    return (
      this.soundscapeEngine?.signals() ?? { lfo1: 0, lfo2: 0, envelope: 0 }
    );
  }

  getStereoSamples():
    | [Float32Array<ArrayBuffer>, Float32Array<ArrayBuffer>]
    | null {
    if (!this.stereoSamples || this.channelAnalysers.length !== 2) return null;
    for (let i = 0; i < 2; i++)
      this.channelAnalysers[i].getFloatTimeDomainData(this.stereoSamples[i]);
    return this.stereoSamples;
  }

  getSamples(): Float32Array<ArrayBuffer> | null {
    if (!this.analyserNode || !this.timeDomainData) return null;
    this.analyserNode.getFloatTimeDomainData(this.timeDomainData);
    return this.timeDomainData;
  }

  getFrequencyData(): Float32Array<ArrayBuffer> | null {
    if (!this.analyserNode || !this.frequencyData) return null;
    this.analyserNode.getFloatFrequencyData(this.frequencyData);
    return this.frequencyData;
  }

  getDecodedBuffer(): AudioBuffer | null {
    return this.mediaBuffer;
  }
  getTransport(): AudioTransport {
    const duration = this.mediaBuffer?.duration ?? 0;
    return {
      position: Math.min(
        duration,
        this.mediaOffset + Math.max(0, this.getCurrentTime() - this.mediaStart),
      ),
      duration,
      playing:
        this._sourceType !== 'none' &&
        this.audioContext?.state === 'running' &&
        (!duration ||
          this.mediaOffset +
            Math.max(0, this.getCurrentTime() - this.mediaStart) <
            duration),
      revision: this.sourceRevision,
      seekRevision: this.seekRevision,
    };
  }
  seek(position: number): boolean {
    const buffer = this.mediaBuffer,
      ctx = this.audioContext;
    if (!buffer || !ctx || !this.analyserNode || !Number.isFinite(position))
      return false;
    // Seek the committed file without cancelling a separately requested source transaction.
    const offset = Math.max(0, Math.min(buffer.duration, position));
    const previous = this.sourceNode as AudioBufferSourceNode | null;
    if (previous) {
      previous.onended = null;
      try {
        previous.stop();
      } catch {
        /* ended */
      }
      previous.disconnect();
    }
    const node = ctx.createBufferSource();
    node.buffer = buffer;
    node.connect(this.analyserNode);
    this.sourceNode = node;
    this.mediaStart = this.getCurrentTime();
    this.mediaOffset = offset;
    this.seekRevision++;
    const generation = this.sourceGeneration;
    node.onended = () => {
      if (this.sourceNode === node && generation === this.sourceGeneration)
        this.onEndedCallback?.();
    };
    this.sourceRevision++;
    this.analysisNode?.port.postMessage({
      type: 'reset',
      revision: this.sourceRevision,
    });
    node.start(0, offset);
    return true;
  }

  getSampleRate(): number | null {
    return this.audioContext?.sampleRate ?? null;
  }

  getFrequencyBinWidth(): number | null {
    if (!this.audioContext || !this.analyserNode) return null;
    return this.audioContext.sampleRate / this.analyserNode.fftSize;
  }

  async resume(): Promise<void> {
    if (this.audioContext?.state !== 'suspended') return;
    const context = this.audioContext;
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(
        () =>
          reject(
            new Error(
              'Audio needs a browser gesture. Select a source in Sound to start it',
            ),
          ),
        2000,
      );
      context.resume().then(
        () => {
          clearTimeout(timeout);
          resolve();
        },
        (error) => {
          clearTimeout(timeout);
          reject(error);
        },
      );
    });
  }

  async suspend(): Promise<void> {
    if (this.audioContext?.state === 'running')
      await this.audioContext.suspend();
  }

  onEnded(callback: () => void): void {
    this.onEndedCallback = callback;
  }

  destroy(): void {
    this.cancelPendingLoad();
    this.stopCurrentSource();
    this.analysisNode?.port.close();
    this.analysisNode?.disconnect();
    this.analysisNode = null;
    this.analysisGainNode?.disconnect();
    this.analysisGainNode = null;
    this.splitter?.disconnect();
    this.splitter = null;
    for (const analyser of this.channelAnalysers) analyser.disconnect();
    this.channelAnalysers = [];
    this.stereoSamples = null;
    this.audioContext?.close();
    this.audioContext = null;
    this.analyserNode = null;
    this.gainNode = null;
    this._sourceType = 'none';
  }
}
