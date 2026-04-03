export class AudioSource {
  private audioContext: AudioContext | null = null;
  private analyserNode: AnalyserNode | null = null;
  private sourceNode: AudioNode | null = null;
  private timeDomainData: Float32Array | null = null;
  private onEndedCallback: (() => void) | null = null;

  async init(): Promise<void> {
    this.audioContext = new AudioContext();
    this.analyserNode = this.audioContext.createAnalyser();
    this.analyserNode.fftSize = 2048;
    this.timeDomainData = new Float32Array(this.analyserNode.fftSize);
  }

  async loadFile(file: File): Promise<void> {
    if (!this.audioContext || !this.analyserNode) throw new Error('AudioSource not initialized');
    const arrayBuffer = await file.arrayBuffer();
    const audioBuffer = await this.audioContext.decodeAudioData(arrayBuffer);
    const source = this.audioContext.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(this.analyserNode);
    this.analyserNode.connect(this.audioContext.destination);
    if (this.sourceNode && 'stop' in this.sourceNode) (this.sourceNode as AudioBufferSourceNode).stop();
    this.sourceNode = source;
    source.onended = () => { if (this.onEndedCallback) this.onEndedCallback(); };
    source.start();
  }

  async useMicrophone(): Promise<void> {
    if (!this.audioContext || !this.analyserNode) throw new Error('AudioSource not initialized');
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const source = this.audioContext.createMediaStreamSource(stream);
    source.connect(this.analyserNode);
    this.sourceNode = source;
  }

  /**
   * Capture system audio using getDisplayMedia (macOS ScreenCaptureKit).
   * This prompts the user to share a screen/window with audio enabled.
   * The video track is discarded — only the audio is used for analysis.
   */
  async useSystemAudio(): Promise<void> {
    if (!this.audioContext || !this.analyserNode) throw new Error('AudioSource not initialized');
    const stream = await navigator.mediaDevices.getDisplayMedia({
      audio: true,
      video: true, // required by API, but we discard it
    });
    // Stop video tracks immediately — we only want audio
    for (const track of stream.getVideoTracks()) {
      track.stop();
    }
    if (stream.getAudioTracks().length === 0) {
      throw new Error('No audio track captured. Make sure to enable audio sharing.');
    }
    const source = this.audioContext.createMediaStreamSource(stream);
    source.connect(this.analyserNode);
    // Don't connect to destination — we don't want to play system audio back through speakers
    this.sourceNode = source;
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
    this.audioContext?.close();
    this.audioContext = null;
    this.analyserNode = null;
    this.sourceNode = null;
  }
}
