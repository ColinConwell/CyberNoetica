import type { Camera, Scene, WebGLRenderer } from 'three';
import type {
  AudioFeatures,
  MessageBus,
  Unsubscribe,
} from '@cybernoetica/core';
import type { Visualizer, VisualizerMetadata } from '../visualizers/types.js';
import { JourneyEndpoint } from './endpoint.js';
import { JourneyPresentation } from './presentation.js';
import { WorkerTransportSolver } from './solver.js';
import { GuidanceEngine } from './guidance.js';
import { locateJourney, crossedMarker } from './schedule.js';
import { parseJourney, retainJourneyWeights } from './definition.js';
import type { JourneyDefinition, JourneyState, TransportMap } from './types.js';

export class JourneyVisualizer implements Visualizer {
  readonly metadata: VisualizerMetadata = {
    type: 'journey',
    label: 'Journey',
    description: 'Live geometric journeys',
    usesPerspective: false,
    autoOrbit: false,
    params: [],
    viewport: { pan: true, zoom: true, orbit: false },
    viewStateFields: [
      { key: 'panX', label: 'Pan X', min: -2, max: 2, step: 0.01 },
      { key: 'panY', label: 'Pan Y', min: -2, max: 2, step: 0.01 },
      { key: 'zoom', label: 'Zoom', min: 0.25, max: 3, step: 0.01 },
    ],
  };
  readonly guidance = new GuidanceEngine();
  readonly state: JourneyState = {
    mode: 'journey',
    phase: 'preparing',
    index: 0,
    nextIndex: 1,
    progress: 0,
    elapsed: 0,
    error: null,
    preparationMs: 0,
    solver: 'projection',
    fallbacks: 0,
    solverJobs: 0,
    sampleCount: 4096,
  };
  private renderer: WebGLRenderer | undefined;
  private current: JourneyEndpoint | null = null;
  private next: JourneyEndpoint | null = null;
  private map: TransportMap | null = null;
  private solver = new WorkerTransportSolver();
  private presentation: JourneyPresentation;
  private abort = new AbortController();
  private unsub: Unsubscribe[] = [];
  private features: AudioFeatures | null = null;
  private onset = false;
  private disposed = false;
  private preparing = false;
  private rebuilding = false;
  private pendingCount: number | null = null;
  private beatGrid: readonly number[] = [];
  private onsetGrid: readonly number[] = [];
  private visibility = () => {
    if (document.hidden) {
      this.abort.abort();
      this.abort = new AbortController();
      this.generation++;
      this.preparing = false;
      this.rebuilding = false;
    } else if (this.media !== null) this.pendingSeek = this.media;
  };
  private elapsed = 0;
  private transitionElapsed = 0;
  private time = 0;
  private paused = false;
  private playback = true;
  private clockDelta: number | null = null;
  private lastClock: number | null = null;
  private media: number | null = null;
  private lastMedia: number | null = null;
  private sourceRevision = -1;
  private reduceFlashes = false;
  private reduceMotion = false;
  private width = 1280;
  private height = 720;
  private view = { panX: 0, panY: 0, zoom: 1 };
  private initialView: Record<string, number> | undefined;
  private generation = 0;
  private pendingSeek: number | null = null;
  private nextRequested = false;
  private notify: () => void = () => {};
  definition: JourneyDefinition;
  constructor(
    bus: MessageBus,
    definition: JourneyDefinition,
    count = 2048,
    initialView?: Record<string, number>,
  ) {
    document.addEventListener('visibilitychange', this.visibility);
    this.definition = parseJourney(definition);
    this.initialView = initialView;
    this.state.sampleCount = count * 2;
    this.presentation = new JourneyPresentation(count, this.definition.style);
    this.unsub.push(
      bus.subscribe<AudioFeatures>('audio:features', (m) => {
        this.features = m.payload;
        this.guidance.setAudio(m.payload);
      }),
    );
    this.unsub.push(
      bus.subscribe<{ onset: boolean }>('audio:timing', (m) => {
        this.onset ||= m.payload.onset;
      }),
    );
  }
  onChange(callback: () => void): void {
    this.notify = callback;
  }
  captureEntry(scene: Scene, camera: Camera): void {
    if (this.renderer)
      this.presentation.captureScene(this.renderer, scene, camera);
  }
  setRenderer(renderer: WebGLRenderer): void {
    this.renderer = renderer;
  }
  attach(_scene: Scene): void {
    void this.prepareCurrent(0);
  }
  async initialize(index = 0, offset = 0): Promise<void> {
    await this.prepareCurrent(index, offset);
  }
  suspendPreparation(): void {
    this.abort.abort();
    this.abort = new AbortController();
    this.generation++;
    this.preparing = false;
    this.rebuilding = false;
  }
  get ready(): boolean {
    return this.current !== null;
  }
  setSampleBudget(count: number): void {
    if ([1024, 2048, 4096].includes(count))
      this.pendingCount = count === this.presentation.count ? null : count;
  }
  setBeatGrid(beats: readonly number[], onsets: readonly number[] = []): void {
    this.beatGrid = beats;
    this.onsetGrid = onsets;
  }
  setPlaybackClock(
    time: number,
    playing: boolean,
    media: number | null,
    revision: number,
    reduceFlashes = false,
    reduceMotion = false,
  ): void {
    let difference =
      this.lastClock === null ? 0 : Math.max(0, time - this.lastClock);
    if (revision !== this.sourceRevision) {
      difference = 0;
      if (this.sourceRevision >= 0 && media !== null) this.pendingSeek = media;
      this.lastMedia = null;
      this.sourceRevision = revision;
    }
    if (
      media !== null &&
      this.lastMedia !== null &&
      Math.abs(media - this.lastMedia - difference) > 0.4
    )
      this.pendingSeek = media;
    else if (difference > 0.5 && media !== null) this.pendingSeek = media;
    this.clockDelta = difference;
    this.lastClock = time;
    this.lastMedia = media;
    this.media = media;
    this.playback = playing;
    this.reduceFlashes = reduceFlashes;
    this.reduceMotion = reduceMotion;
  }
  setDefinition(definition: JourneyDefinition): void {
    const previous = this.definition;
    this.definition = parseJourney(retainJourneyWeights(definition, previous));
    // Presentation and guidance edits can update the live uniforms without solving another map.
    if (
      previous.seed === this.definition.seed &&
      previous.transport === this.definition.transport &&
      JSON.stringify(previous.stops) === JSON.stringify(this.definition.stops)
    ) {
      this.notify();
      return;
    }
    const stop = this.definition.stops[this.state.index];
    if (!stop || !this.current?.setStop(stop)) {
      void this.prepareCurrent(
        Math.min(this.state.index, this.definition.stops.length - 1),
      );
      return;
    }
    // Editing future stops invalidates only preparation; a live transition finishes first.
    if (this.state.progress === 0) {
      this.abort.abort();
      this.abort = new AbortController();
      this.generation++;
      this.preparing = false;
      this.next?.dispose();
      this.next = null;
      this.map = null;
      void this.prepareNext();
    }
    this.notify();
  }
  setStyle(style: 'character' | 'unified'): void {
    this.definition.style = style;
    this.notify();
  }
  setPaused(paused: boolean): void {
    this.paused = paused;
    this.notify();
  }
  isPaused(): boolean {
    return this.paused;
  }
  nextStop(): void {
    this.nextRequested = true;
    if (this.state.error) this.retry();
  }
  retry(): void {
    this.state.error = null;
    if (!this.current) void this.prepareCurrent(this.state.index);
    else void this.prepareNext();
  }
  skip(): void {
    this.state.error = null;
    const index = (this.state.nextIndex + 1) % this.definition.stops.length;
    void this.prepareCurrent(index);
  }
  seek(seconds: number): void {
    this.pendingSeek = Math.max(0, seconds);
  }
  private async prepareCurrent(
    index: number,
    offset = 0,
    count = this.presentation.count,
  ): Promise<void> {
    this.abort.abort();
    this.abort = new AbortController();
    const signal = this.abort.signal,
      gen = ++this.generation;
    this.preparing = true;
    this.rebuilding = true;
    this.state.error = null;
    this.state.phase = 'preparing';
    this.notify();
    let prepared: JourneyEndpoint | null = null,
      destination: JourneyEndpoint | null = null;
    try {
      prepared = await JourneyEndpoint.create(
        this.definition.stops[index],
        count,
        this.renderer,
        this.solver,
        this.definition.seed + index,
        signal,
        this.initialView,
      );
      if (this.disposed || signal.aborted || gen !== this.generation) {
        prepared.dispose();
        return;
      }
      this.initialView = undefined;
      prepared.resize(this.width, this.height);
      const stop = this.definition.stops[index],
        nextIndex = (index + 1) % this.definition.stops.length;
      const progress = Math.max(
        0,
        Math.min(0.999999, (offset - stop.hold) / stop.transition),
      );
      let map: TransportMap | null = null;
      if (
        progress > 0 &&
        (this.definition.loop || index < this.definition.stops.length - 1)
      ) {
        destination = await JourneyEndpoint.create(
          this.definition.stops[nextIndex],
          count,
          this.renderer,
          this.solver,
          this.definition.seed + nextIndex,
          signal,
        );
        destination.resize(this.width, this.height);
        map = await this.solver.solve(
          prepared.positions,
          destination.positions,
          this.definition.seed + index,
          signal,
          this.definition.transport,
        );
      }
      if (this.disposed || signal.aborted || gen !== this.generation) {
        prepared.dispose();
        destination?.dispose();
        return;
      }
      if (this.renderer && this.current)
        this.presentation.beginHandoff(
          this.renderer,
          this.current,
          this.next,
          this.state.progress,
          this.view,
        );
      if (count !== this.presentation.count) {
        const old = this.presentation;
        this.presentation = new JourneyPresentation(
          count,
          this.definition.style,
        );
        this.presentation.resize(this.width, this.height);
        this.presentation.adoptHandoff(old.takeHandoff());
        old.dispose();
        this.state.sampleCount = count * 2;
        if (this.pendingCount === count) this.pendingCount = null;
      }
      this.current?.dispose();
      this.next?.dispose();
      this.current = prepared;
      this.next = destination;
      this.map = map;
      this.state.index = index;
      this.state.nextIndex = nextIndex;
      this.state.progress = destination ? progress : 0;
      this.elapsed = offset;
      this.transitionElapsed = destination ? progress * stop.transition : 0;
      this.nextRequested = false;
      this.state.phase = 'holding';
    } catch (error) {
      prepared?.dispose();
      destination?.dispose();
      if (!signal.aborted && !this.disposed) {
        this.state.error = String(error);
        this.state.phase = 'error';
      }
    } finally {
      if (gen === this.generation) {
        this.preparing = false;
        this.rebuilding = false;
        this.notify();
        if (!this.state.error) void this.prepareNext();
      }
    }
  }
  private async prepareNext(): Promise<void> {
    if (
      !this.current ||
      this.preparing ||
      this.next ||
      this.disposed ||
      document.hidden
    )
      return;
    const index = this.state.index + 1;
    if (index >= this.definition.stops.length && !this.definition.loop) {
      this.state.nextIndex = this.state.index;
      return;
    }
    this.state.nextIndex = index % this.definition.stops.length;
    this.preparing = true;
    const gen = this.generation,
      signal = this.abort.signal,
      started = performance.now();
    let prepared: JourneyEndpoint | null = null;
    try {
      prepared = await JourneyEndpoint.create(
        this.definition.stops[this.state.nextIndex],
        this.presentation.count,
        this.renderer,
        this.solver,
        this.definition.seed + this.state.nextIndex,
        signal,
      );
      prepared.resize(this.width, this.height);
      prepared.update(0, this.features);
      const map = await this.solver.solve(
        this.current.positions,
        prepared.positions,
        this.definition.seed + this.state.index,
        signal,
        this.definition.transport,
      );
      if (this.disposed || gen !== this.generation || signal.aborted) {
        prepared.dispose();
        return;
      }
      this.next = prepared;
      this.map = map;
      this.state.preparationMs = performance.now() - started;
      this.state.solver = map.backend;
      this.state.solverJobs++;
      if (this.definition.transport === 'auto' && map.backend === 'projection')
        this.state.fallbacks++;
    } catch (error) {
      prepared?.dispose();
      if (!signal.aborted && !this.disposed && gen === this.generation) {
        this.state.error = String(error);
        this.state.phase = 'error';
      }
    } finally {
      if (gen === this.generation) {
        this.preparing = false;
        this.notify();
      }
    }
  }
  tick(dt = 1 / 60): void {
    if (this.disposed) return;
    if (this.pendingSeek !== null && !document.hidden) {
      const target = locateJourney(
        this.definition,
        this.pendingSeek,
        this.beatGrid,
        this.onsetGrid,
      );
      this.pendingSeek = null;
      void this.prepareCurrent(target.index, target.offset);
    }
    if (
      this.pendingCount !== null &&
      this.state.progress === 0 &&
      !this.rebuilding &&
      !document.hidden
    )
      void this.prepareCurrent(
        this.state.index,
        this.elapsed,
        this.pendingCount,
      );
    const timingDelta = this.clockDelta ?? dt;
    this.clockDelta = null;
    const moving = this.playback && !this.paused && !document.hidden;
    const advancing = moving && !this.rebuilding;
    if (moving) this.time += dt;
    if (advancing) this.elapsed += Math.min(0.25, timingDelta);
    this.current?.update(moving ? dt : 0, this.features);
    this.next?.update(moving ? dt : 0, this.features);
    const stop = this.definition.stops[this.state.index];
    if (this.current && stop && advancing) {
      const holdDone = this.elapsed >= stop.hold;
      const onsetReady =
        this.definition.timing !== 'onset' ||
        (this.media !== null && this.onsetGrid.length
          ? crossedMarker(this.onsetGrid, this.media, timingDelta)
          : this.onset) ||
        this.elapsed >= stop.hold + 2;
      const beat = (this.media ?? this.time) - this.definition.beatOffset,
        period = 60 / this.definition.bpm;
      const beatReady =
        this.definition.timing !== 'beats' ||
        (this.beatGrid.length && this.media !== null
          ? crossedMarker(
              this.beatGrid,
              this.media,
              timingDelta,
              this.definition.beatOffset,
            )
          : ((beat % period) + period) % period <
            Math.max(0.035, timingDelta)) ||
        this.elapsed >= stop.hold + 2;
      const cueReady =
        this.definition.timing !== 'cues' ||
        this.media === null ||
        this.definition.cues.length === 0 ||
        crossedMarker(this.definition.cues, this.media!, timingDelta) ||
        this.media! > this.definition.cues[this.definition.cues.length - 1] + 2;
      if (
        this.next &&
        this.map &&
        (this.nextRequested ||
          (holdDone && onsetReady && beatReady && cueReady) ||
          this.transitionElapsed > 0)
      ) {
        this.transitionElapsed += timingDelta;
        this.state.progress = Math.min(
          1,
          this.transitionElapsed / stop.transition,
        );
        this.state.phase = 'transitioning';
        if (this.state.progress >= 1) {
          this.current.dispose();
          this.current = this.next;
          this.next = null;
          this.map = null;
          this.state.index = this.state.nextIndex;
          this.state.progress = 0;
          this.elapsed = 0;
          this.transitionElapsed = 0;
          this.nextRequested = false;
          this.state.phase = 'holding';
          this.notify();
        }
      } else if (!this.state.error)
        this.state.phase = this.current ? 'holding' : 'preparing';
      if (!this.next && !this.preparing && !this.state.error)
        void this.prepareNext();
    }
    if (!moving && this.current) this.state.phase = 'paused';
    this.state.elapsed = this.elapsed;
    this.onset = false;
    if (this.current) {
      const guidance = this.guidance.evaluate(
        this.definition.guidance,
        this.time,
        moving ? dt : 0,
        this.reduceFlashes,
      );
      if (this.reduceMotion) {
        guidance.swirl *= 0.25;
        guidance.spread *= 0.25;
      }
      this.presentation.update(
        this.current,
        this.state.progress > 0 ? this.next : null,
        this.map?.indices ?? null,
        this.state.progress,
        this.time,
        guidance,
        this.definition.style,
        dt,
        this.view,
        this.definition.transitionLook,
        this.reduceMotion,
      );
    }
  }
  renderFrame(renderer: WebGLRenderer): void {
    this.presentation.render(
      renderer,
      this.current,
      this.state.progress > 0 ? this.next : null,
      this.state.progress,
      this.view,
    );
  }
  setResolution(width: number, height: number): void {
    this.width = width;
    this.height = height;
    this.current?.resize(width, height);
    this.next?.resize(width, height);
    this.presentation.resize(width, height);
  }
  setUserParam(): void {}
  getViewState(): Record<string, number> {
    return { ...this.view };
  }
  setViewState(partial: Record<string, number>): void {
    for (const key of ['panX', 'panY', 'zoom'] as const)
      if (Number.isFinite(partial[key]))
        this.view[key] =
          key === 'zoom'
            ? Math.max(0.25, Math.min(3, partial[key]))
            : Math.max(-2, Math.min(2, partial[key]));
  }
  dominant() {
    return (
      (this.state.progress >= 0.5 && this.next
        ? this.next
        : this.current
      )?.dominant() ?? {
        type: this.definition.stops[0].layers[0].type,
        params: {},
        view: {},
      }
    );
  }
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    document.removeEventListener('visibilitychange', this.visibility);
    this.abort.abort();
    this.generation++;
    this.solver.dispose();
    this.current?.dispose();
    this.next?.dispose();
    this.presentation.dispose();
    this.unsub.forEach((fn) => fn());
    this.notify = () => {};
  }
}
