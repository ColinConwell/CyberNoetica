/// <reference path="./worklet-url.d.ts" />
import analysisWorkletUrl from './analysis-worklet.ts?worker&url';
import { ANALYSIS_FFT_SIZE } from './spectrum-analyzer.js';
import type { AudioFeatures } from '@cybernoetica/core';
import {
  clampSoundscapeParams,
  DEFAULT_SOUNDSCAPE_PARAMS,
  soundscapeGainsAt,
  soundscapePhase,
  soundscapeBeatIndex,
  type SoundscapeParams,
} from './soundscape-loop.js';

export type AudioSourceType = 'none' | 'file' | 'mic' | 'system' | 'soundscape';

type Stoppable = { stop: (when?: number) => void };

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

  private extraNodes: AudioNode[] = [];
  private stoppables: Stoppable[] = [];
  private soundscapeTimer: ReturnType<typeof setInterval> | null = null;
  private soundscapeParams: SoundscapeParams = { ...DEFAULT_SOUNDSCAPE_PARAMS };
  private soundscapeOrigin = 0;
  private lastBeatIndex = -1;
  private bassGainNode: GainNode | null = null;
  private midGainNode: GainNode | null = null;
  private highGainNode: GainNode | null = null;
  private noiseGainNode: GainNode | null = null;
  private clickGainNode: GainNode | null = null;
  private bassFilter: BiquadFilterNode | null = null;
  private midFilter: BiquadFilterNode | null = null;
  private highFilter: BiquadFilterNode | null = null;

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
    this.sourceRevision++;
    this.analysisNode?.port.postMessage({
      type: 'reset',
      revision: this.sourceRevision,
    });
    if (this.soundscapeTimer !== null) {
      clearInterval(this.soundscapeTimer);
      this.soundscapeTimer = null;
    }
    for (const node of this.stoppables) {
      try {
        node.stop();
      } catch {
        /* already stopped */
      }
    }
    this.stoppables = [];
    for (const node of this.extraNodes) {
      try {
        node.disconnect();
      } catch {
        /* already disconnected */
      }
    }
    this.extraNodes = [];
    this.bassGainNode = null;
    this.midGainNode = null;
    this.highGainNode = null;
    this.noiseGainNode = null;
    this.clickGainNode = null;
    this.bassFilter = null;
    this.midFilter = null;
    this.highFilter = null;

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

    const ctx = this.audioContext;
    const mix = ctx.createGain();
    mix.gain.value = 0.85;
    mix.connect(this.analyserNode);
    this.sourceNode = mix;
    this.extraNodes.push(mix);

    const noise = ctx.createBufferSource();
    noise.buffer = this.createNoiseBuffer(ctx);
    noise.loop = true;
    const noiseFilter = ctx.createBiquadFilter();
    noiseFilter.type = 'bandpass';
    noiseFilter.frequency.value = 1200;
    noiseFilter.Q.value = 0.7;
    const noiseGain = ctx.createGain();
    noiseGain.gain.value = 0.08;
    noise.connect(noiseFilter);
    noiseFilter.connect(noiseGain);
    noiseGain.connect(mix);
    this.noiseGainNode = noiseGain;
    this.extraNodes.push(noise, noiseFilter, noiseGain);
    this.stoppables.push(noise);
    noise.start();

    this.bassFilter = this.makeOscBand(ctx, mix, 70, 'lowpass', 0.18);
    this.midFilter = this.makeOscBand(ctx, mix, 420, 'bandpass', 0.16);
    this.highFilter = this.makeOscBand(ctx, mix, 2400, 'highpass', 0.1);

    const click = ctx.createOscillator();
    click.type = 'square';
    click.frequency.value = 180;
    const clickGain = ctx.createGain();
    clickGain.gain.value = 0.0001;
    click.connect(clickGain);
    clickGain.connect(mix);
    this.clickGainNode = clickGain;
    this.extraNodes.push(click, clickGain);
    this.stoppables.push(click);
    click.start();

    this.soundscapeOrigin = ctx.currentTime;
    this.lastBeatIndex = -1;
    this._sourceType = 'soundscape';
    this.setMuted(this._muted);
    this.tickSoundscape();
    this.soundscapeTimer = setInterval(() => this.tickSoundscape(), 40);
  }

  setSoundscapeParams(partial: Partial<SoundscapeParams>): void {
    this.soundscapeParams = clampSoundscapeParams(
      partial,
      this.soundscapeParams,
    );
  }

  private makeOscBand(
    ctx: AudioContext,
    mix: AudioNode,
    freq: number,
    filterType: BiquadFilterType,
    initialGain: number,
  ): BiquadFilterNode {
    const osc = ctx.createOscillator();
    osc.type = freq < 120 ? 'sine' : freq < 800 ? 'triangle' : 'sawtooth';
    osc.frequency.value = freq;
    const filter = ctx.createBiquadFilter();
    filter.type = filterType;
    filter.frequency.value = freq;
    filter.Q.value = filterType === 'bandpass' ? 1.1 : 0.7;
    const gain = ctx.createGain();
    gain.gain.value = initialGain;
    osc.connect(filter);
    filter.connect(gain);
    gain.connect(mix);
    this.extraNodes.push(osc, filter, gain);
    this.stoppables.push(osc);
    osc.start();
    if (filterType === 'lowpass') this.bassGainNode = gain;
    else if (filterType === 'bandpass') this.midGainNode = gain;
    else this.highGainNode = gain;
    return filter;
  }

  private createNoiseBuffer(ctx: AudioContext): AudioBuffer {
    const length = ctx.sampleRate * 2;
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
    return buffer;
  }

  private tickSoundscape(): void {
    const ctx = this.audioContext;
    if (!ctx || this._sourceType !== 'soundscape') return;
    const elapsed = Math.max(0, ctx.currentTime - this.soundscapeOrigin);
    const phase = soundscapePhase(elapsed, this.soundscapeParams.cycleLength);
    const beatIndex = soundscapeBeatIndex(
      elapsed,
      this.soundscapeParams.beatRate,
    );
    const gains = soundscapeGainsAt(
      phase,
      this.soundscapeParams,
      elapsed,
      this.lastBeatIndex,
    );
    this.lastBeatIndex = beatIndex;

    const now = ctx.currentTime;
    const ramp = 0.05;
    this.bassGainNode?.gain.setTargetAtTime(gains.bass * 0.45, now, ramp);
    this.midGainNode?.gain.setTargetAtTime(gains.mid * 0.28, now, ramp);
    this.highGainNode?.gain.setTargetAtTime(gains.high * 0.16, now, ramp);
    this.noiseGainNode?.gain.setTargetAtTime(gains.noise * 0.22, now, ramp);

    const cutoffHz = 280 + gains.cutoff * 4200;
    this.midFilter?.frequency.setTargetAtTime(cutoffHz * 0.35, now, ramp);
    this.highFilter?.frequency.setTargetAtTime(
      900 + gains.cutoff * 5000,
      now,
      ramp,
    );

    if (gains.beat && this.clickGainNode) {
      const g = this.clickGainNode.gain;
      g.cancelScheduledValues(now);
      g.setValueAtTime(0.0001, now);
      g.exponentialRampToValueAtTime(
        0.35 * this.soundscapeParams.energy + 0.05,
        now + 0.004,
      );
      g.exponentialRampToValueAtTime(0.0001, now + 0.05);
    }
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
