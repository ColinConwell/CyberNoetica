export type AudioSourceType = 'none' | 'file' | 'mic' | 'system';

export class AudioSource {
  private audioContext: AudioContext | null = null;
  private analyserNode: AnalyserNode | null = null;
  private gainNode: GainNode | null = null;
  private sourceNode: AudioNode | null = null;
  private activeStream: MediaStream | null = null;
  private timeDomainData: Float32Array | null = null;
  private onEndedCallback: (() => void) | null = null;
  private _sourceType: AudioSourceType = 'none';
  private _muted = false;

  get sourceType(): AudioSourceType { return this._sourceType; }
  get muted(): boolean { return this._muted; }

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
    this.timeDomainData = new Float32Array(this.analyserNode.fftSize);
  }

  private stopCurrentSource(): void {
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
    // Chrome 105+ supports systemAudio and preferCurrentTab
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

  getSamples(): Float32Array | null {
    if (!this.analyserNode || !this.timeDomainData) return null;
    this.analyserNode.getFloatTimeDomainData(this.timeDomainData);
    return this.timeDomainData;
  }

  getFrequencyData(): Float32Array | null {
    if (!this.analyserNode) return null;
    const data = new Float32Array(this.analyserNode.frequencyBinCount);
    this.analyserNode.getFloatFrequencyData(data);
    return data;
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
