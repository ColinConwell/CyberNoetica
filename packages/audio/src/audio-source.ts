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
  private sourceNode: AudioNode | null = null;
  private activeStream: MediaStream | null = null;
  private timeDomainData: Float32Array<ArrayBuffer> | null = null;
  private onEndedCallback: (() => void) | null = null;
  private _sourceType: AudioSourceType = 'none';
  private _muted = false;

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

  get sourceType(): AudioSourceType { return this._sourceType; }
  get muted(): boolean { return this._muted; }
  getSoundscapeParams(): SoundscapeParams { return { ...this.soundscapeParams }; }

  setMuted(muted: boolean): void {
    this._muted = muted;
    if (this.gainNode) this.gainNode.gain.value = muted ? 0 : 1;
  }

  async init(): Promise<void> {
    this.audioContext = new AudioContext();
    this.analyserNode = this.audioContext.createAnalyser();
    this.analyserNode.fftSize = 2048;
    this.gainNode = this.audioContext.createGain();
    if (this._muted) this.gainNode.gain.value = 0;
    this.analyserNode.connect(this.gainNode);
    this.gainNode.connect(this.audioContext.destination);
    this.timeDomainData = new Float32Array(this.analyserNode.fftSize) as Float32Array<ArrayBuffer>;
  }

  private stopCurrentSource(): void {
    if (this.soundscapeTimer !== null) {
      clearInterval(this.soundscapeTimer);
      this.soundscapeTimer = null;
    }
    for (const node of this.stoppables) {
      try { node.stop(); } catch { /* already stopped */ }
    }
    this.stoppables = [];
    for (const node of this.extraNodes) {
      try { node.disconnect(); } catch { /* already disconnected */ }
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
      if ('stop' in this.sourceNode) {
        try { (this.sourceNode as AudioBufferSourceNode).stop(); } catch { /* already stopped */ }
      }
      try { this.sourceNode.disconnect(); } catch { /* already disconnected */ }
      this.sourceNode = null;
    }
    if (this.activeStream) {
      for (const track of this.activeStream.getTracks()) track.stop();
      this.activeStream = null;
    }
  }

  async loadFile(file: File): Promise<void> {
    if (!this.audioContext || !this.analyserNode) throw new Error('AudioSource not initialized');
    const arrayBuffer = await file.arrayBuffer();
    const audioBuffer = await this.audioContext.decodeAudioData(arrayBuffer);
    const source = this.audioContext.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(this.analyserNode);
    this.stopCurrentSource();
    this.sourceNode = source;
    this._sourceType = 'file';
    source.onended = () => { if (this.onEndedCallback) this.onEndedCallback(); };
    source.start();
  }

  async useMicrophone(): Promise<void> {
    if (!this.audioContext || !this.analyserNode) throw new Error('AudioSource not initialized');
    this.stopCurrentSource();
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const source = this.audioContext.createMediaStreamSource(stream);
    source.connect(this.analyserNode);
    this.sourceNode = source;
    this.activeStream = stream;
    this._sourceType = 'mic';
  }

  /**
   * Capture system audio via getDisplayMedia. Uses systemAudio: "include"
   * on supporting browsers to offer tab/window audio without requiring
   * a visible video preview. Video tracks are discarded immediately.
   */
  async useSystemAudio(): Promise<void> {
    if (!this.audioContext || !this.analyserNode) throw new Error('AudioSource not initialized');
    this.stopCurrentSource();

    const constraints: DisplayMediaStreamOptions = {
      audio: true,
      video: true,
    };
    if ('getDisplayMedia' in navigator.mediaDevices) {
      (constraints as any).systemAudio = 'include';
      (constraints as any).preferCurrentTab = true;
    }

    const stream = await navigator.mediaDevices.getDisplayMedia(constraints);
    for (const track of stream.getVideoTracks()) track.stop();
    if (stream.getAudioTracks().length === 0) {
      throw new Error('No audio track captured. Make sure to enable audio sharing.');
    }
    const source = this.audioContext.createMediaStreamSource(stream);
    source.connect(this.analyserNode);
    this.sourceNode = source;
    this.activeStream = stream;
    this._sourceType = 'system';
  }

  startSoundscape(params?: Partial<SoundscapeParams>): void {
    if (!this.audioContext || !this.analyserNode) throw new Error('AudioSource not initialized');
    this.stopCurrentSource();
    this.soundscapeParams = clampSoundscapeParams(params ?? {}, DEFAULT_SOUNDSCAPE_PARAMS);

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
    this.tickSoundscape();
    this.soundscapeTimer = setInterval(() => this.tickSoundscape(), 40);
  }

  setSoundscapeParams(partial: Partial<SoundscapeParams>): void {
    this.soundscapeParams = clampSoundscapeParams(partial, this.soundscapeParams);
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
    const beatIndex = soundscapeBeatIndex(elapsed, this.soundscapeParams.beatRate);
    const gains = soundscapeGainsAt(phase, this.soundscapeParams, elapsed, this.lastBeatIndex);
    this.lastBeatIndex = beatIndex;

    const now = ctx.currentTime;
    const ramp = 0.05;
    this.bassGainNode?.gain.setTargetAtTime(gains.bass * 0.45, now, ramp);
    this.midGainNode?.gain.setTargetAtTime(gains.mid * 0.28, now, ramp);
    this.highGainNode?.gain.setTargetAtTime(gains.high * 0.16, now, ramp);
    this.noiseGainNode?.gain.setTargetAtTime(gains.noise * 0.22, now, ramp);

    const cutoffHz = 280 + gains.cutoff * 4200;
    this.midFilter?.frequency.setTargetAtTime(cutoffHz * 0.35, now, ramp);
    this.highFilter?.frequency.setTargetAtTime(900 + gains.cutoff * 5000, now, ramp);

    if (gains.beat && this.clickGainNode) {
      const g = this.clickGainNode.gain;
      g.cancelScheduledValues(now);
      g.setValueAtTime(0.0001, now);
      g.exponentialRampToValueAtTime(0.35 * this.soundscapeParams.energy + 0.05, now + 0.004);
      g.exponentialRampToValueAtTime(0.0001, now + 0.05);
    }
  }

  getSamples(): Float32Array<ArrayBuffer> | null {
    if (!this.analyserNode || !this.timeDomainData) return null;
    this.analyserNode.getFloatTimeDomainData(this.timeDomainData);
    return this.timeDomainData;
  }

  getFrequencyData(): Float32Array<ArrayBuffer> | null {
    if (!this.analyserNode) return null;
    const data = new Float32Array(this.analyserNode.frequencyBinCount) as Float32Array<ArrayBuffer>;
    this.analyserNode.getFloatFrequencyData(data);
    return data;
  }

  getSampleRate(): number | null {
    return this.audioContext?.sampleRate ?? null;
  }

  getFrequencyBinWidth(): number | null {
    if (!this.audioContext || !this.analyserNode) return null;
    return this.audioContext.sampleRate / this.analyserNode.fftSize;
  }

  async resume(): Promise<void> {
    if (this.audioContext?.state === 'suspended') await this.audioContext.resume();
  }

  async suspend(): Promise<void> {
    if (this.audioContext?.state === 'running') await this.audioContext.suspend();
  }

  onEnded(callback: () => void): void {
    this.onEndedCallback = callback;
  }

  destroy(): void {
    this.stopCurrentSource();
    this.audioContext?.close();
    this.audioContext = null;
    this.analyserNode = null;
    this.gainNode = null;
    this._sourceType = 'none';
  }
}
