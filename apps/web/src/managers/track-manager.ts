import type { AudioSource } from '@cybernoetica/audio';

export class TrackManager {
  private sampleTracks: string[] = [];
  private autoPlayEnabled = true;
  private shuffleEnabled = true;
  private trackIndex = 0;
  private playedTracks = new Set<number>();
  private loadGeneration = 0;

  constructor(private audioSource: AudioSource) {}

  async fetchSampleTracks(): Promise<string[]> {
    try {
      const res = await fetch('/sample-music/__list');
      this.sampleTracks = await res.json();
    } catch { /* no samples available */ }
    return this.sampleTracks;
  }

  getSampleTracks(): string[] { return this.sampleTracks; }

  /**
   * Load and start a track. Returns false if the request was superseded
   * by a newer loadTrack call (generation counter prevents race conditions).
   */
  async loadTrack(url: string): Promise<boolean> {
    const gen = ++this.loadGeneration;
    await this.audioSource.resume();
    const response = await fetch(url);
    if (gen !== this.loadGeneration) return false;
    const buffer = await response.arrayBuffer();
    if (gen !== this.loadGeneration) return false;
    const blob = new Blob([buffer], { type: 'audio/mpeg' });
    const name = url.split('/').pop() || 'track.mp3';
    const file = new File([blob], name, { type: 'audio/mpeg' });
    await this.audioSource.loadFile(file);
    if (gen !== this.loadGeneration) return false;
    return true;
  }

  cancelPendingLoad(): void {
    this.loadGeneration++;
  }

  getRandomTrack(): { url: string; name: string } | null {
    if (this.sampleTracks.length === 0) return null;
    const track = this.sampleTracks[Math.floor(Math.random() * this.sampleTracks.length)];
    const name = track.split('/').pop()?.replace(/\.[^.]+$/, '') || track;
    this.trackIndex = this.sampleTracks.indexOf(track);
    return { url: `/sample-music/${track}`, name };
  }

  getNextTrack(): { url: string; name: string } | null {
    if (this.sampleTracks.length === 0) return null;
    let idx: number;
    if (this.shuffleEnabled) {
      if (this.playedTracks.size >= this.sampleTracks.length) this.playedTracks.clear();
      do { idx = Math.floor(Math.random() * this.sampleTracks.length); }
      while (this.playedTracks.has(idx) && this.playedTracks.size < this.sampleTracks.length);
      this.playedTracks.add(idx);
    } else {
      idx = (this.trackIndex + 1) % this.sampleTracks.length;
    }
    this.trackIndex = idx;
    const track = this.sampleTracks[idx];
    const name = track.split('/').pop()?.replace(/\.[^.]+$/, '') || track;
    return { url: `/sample-music/${track}`, name };
  }

  setAutoPlay(enabled: boolean, shuffle: boolean): void {
    this.autoPlayEnabled = enabled;
    this.shuffleEnabled = shuffle;
  }

  isAutoPlayEnabled(): boolean { return this.autoPlayEnabled; }
}
