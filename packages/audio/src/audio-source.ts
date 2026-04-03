export class AudioSource {
  private audioContext: AudioContext | null = null;
  private analyserNode: AnalyserNode | null = null;
  private sourceNode: AudioNode | null = null;
  private timeDomainData: Float32Array | null = null;

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
    source.start();
  }

  async useMicrophone(): Promise<void> {
    if (!this.audioContext || !this.analyserNode) throw new Error('AudioSource not initialized');
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const source = this.audioContext.createMediaStreamSource(stream);
    source.connect(this.analyserNode);
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

  destroy(): void {
    this.audioContext?.close();
    this.audioContext = null;
    this.analyserNode = null;
    this.sourceNode = null;
  }
}
