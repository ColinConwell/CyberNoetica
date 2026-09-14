import {
  retainJourneyWeights,
  createJourney,
  parseJourney,
  JourneyVisualizer,
  JOURNEY_TYPES,
} from '@cybernoetica/renderer';
import type { JourneyDefinition, JourneyState } from '@cybernoetica/renderer';
import { TrackAnalysisClient } from '@cybernoetica/audio';
import type { AudioSource, TrackAnalysis } from '@cybernoetica/audio';
import type { VisualizerManager } from './visualizer-manager.js';
const STORAGE = 'cybernoetica:journey:v1';
export class JourneyController {
  definition: JourneyDefinition;
  analysis: TrackAnalysis | null = null;
  analysisError = '';
  busy = false;
  error = '';
  private listeners = new Set<() => void>();
  private analyzer = new TrackAnalysisClient();
  private buffer: AudioBuffer | null = null;
  private generation = 0;
  private disposed = false;
  private connected: JourneyVisualizer | null = null;
  constructor(
    private manager: VisualizerManager,
    readonly source: AudioSource,
    private changed: (type: string) => void,
  ) {
    this.definition = createJourney();
    try {
      const saved = localStorage.getItem(STORAGE);
      if (saved) this.definition = parseJourney(JSON.parse(saved));
    } catch {
      /* Invalid saved routes fall back to a bounded default. */
    }
  }
  get active(): JourneyVisualizer | null {
    const viz = this.manager.getActive();
    return viz instanceof JourneyVisualizer ? viz : null;
  }
  get state(): JourneyState | null {
    return this.active?.state ?? null;
  }
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  notify(): void {
    this.listeners.forEach((fn) => fn());
  }
  private save(): void {
    try {
      localStorage.setItem(STORAGE, JSON.stringify(this.definition));
    } catch {
      /* Storage may be unavailable. */
    }
  }
  update(value: JourneyDefinition): void {
    this.definition = parseJourney(
      retainJourneyWeights(value, this.definition),
    );
    this.active?.setDefinition(this.definition);
    this.save();
    this.notify();
  }
  style(style: 'character' | 'unified'): void {
    this.definition.style = style;
    this.active?.setStyle(style);
    this.save();
    this.notify();
  }
  async mode(journey: boolean): Promise<void> {
    if (this.disposed) return;
    if (!journey) this.manager.cancelJourneyPreparation();
    this.busy = true;
    this.error = '';
    const generation = ++this.generation;
    this.notify();
    try {
      if (journey) {
        const type = this.manager.getActiveType();
        if (JOURNEY_TYPES.includes(type as (typeof JOURNEY_TYPES)[number])) {
          const index = this.definition.stops.findIndex(
            (s) => s.layers.length === 1 && s.layers[0].type === type,
          );
          if (index >= 0)
            this.definition.stops = [
              ...this.definition.stops.slice(index),
              ...this.definition.stops.slice(0, index),
            ];
          else this.definition.stops[0].layers[0].type = type;
        }
        const native = this.manager.getActive();
        if (native?.metadata.type === this.definition.stops[0].layers[0].type) {
          this.definition.stops[0].layers[0].params =
            native.getUserParams?.() ?? {};
          this.definition.stops[0].layers[0].view = native.getViewState();
        }
        const active = await this.manager.switchJourney(this.definition);
        if (!active)
          this.error =
            'Journey could not prepare. The current visualizer is still available; choose Journey to retry.';
        if (active && generation === this.generation) {
          active.onChange(() => this.notify());
          active.guidance.register({
            id: 'synth',
            signals: [
              { key: 'lfo1', label: 'LFO 1', min: 0, max: 1 },
              { key: 'lfo2', label: 'LFO 2', min: 0, max: 1 },
              { key: 'envelope', label: 'Envelope', min: 0, max: 1 },
            ],
            sample: () => this.source.getSynthSignals(),
          });
          this.changed('journey');
          this.save();
        }
      } else if (this.active) {
        const dominant = this.active.dominant(),
          viz = await this.manager.switchTo(dominant.type);
        if (viz && generation === this.generation) {
          for (const [key, value] of Object.entries(dominant.params))
            viz.setUserParam(key, value);
          viz.setViewState(dominant.view);
          this.changed(dominant.type);
        }
      }
    } catch (error) {
      this.error = String(error);
    } finally {
      if (generation === this.generation) {
        this.busy = false;
        this.notify();
      }
    }
  }
  tick(playing: boolean, reduceFlashes: boolean, reduceMotion = false): void {
    const buffer = this.source.getDecodedBuffer();
    if (buffer !== this.buffer) {
      this.buffer = buffer;
      this.analysis = null;
      this.analysisError = '';
      this.analyzer.cancel();
      if (buffer)
        void this.analyzer
          .analyze(buffer, (result) => {
            if (this.buffer === buffer && !this.disposed) {
              this.analysis = result;
              this.notify();
            }
          })
          .catch((error) => {
            if (error.name !== 'AbortError' && this.buffer === buffer) {
              this.analysisError = error.message;
              this.notify();
            }
          });
    }
    const active = this.active;
    if (active && this.connected !== active) {
      this.connected = active;
      active.onChange(() => this.notify());
      active.guidance.register({
        id: 'synth',
        signals: [
          { key: 'lfo1', label: 'LFO 1', min: 0, max: 1 },
          { key: 'lfo2', label: 'LFO 2', min: 0, max: 1 },
          { key: 'envelope', label: 'Envelope', min: 0, max: 1 },
        ],
        sample: () => this.source.getSynthSignals(),
      });
    }
    if (active) {
      active.setBeatGrid(
        this.analysis?.bpm &&
          Math.abs(this.analysis.bpm - this.definition.bpm) < 0.1
          ? this.analysis.beats
          : [],
        this.analysis?.onsets ?? [],
      );
      const transport = this.source.getTransport();
      active.setPlaybackClock(
        this.source.sourceType === 'none'
          ? performance.now() / 1000
          : this.source.getCurrentTime(),
        playing,
        this.source.sourceType === 'file' ? transport.position : null,
        transport.revision,
        reduceFlashes,
        reduceMotion,
      );
      if (this.source.sourceType === 'soundscape')
        active.definition.bpm = this.source.getSoundscapeParams().beatRate;
    }
  }
  seek(seconds: number): void {
    if (this.source.seek(seconds)) this.active?.seek(seconds);
    this.notify();
  }
  dispose(): void {
    this.disposed = true;
    this.generation++;
    this.analyzer.cancel();
    this.listeners.clear();
  }
}
