import { Color } from 'three';
import type { Scene } from 'three';
import type {
  AudioFeatures,
  MessageBus,
  Unsubscribe,
} from '@cybernoetica/core';
import { EMASmoothing, EventEnvelope } from '../../smoothing.js';
import { frameDelta, PhaseClock, takeAudioFrame } from '../../timing.js';
import { topologyValue, motionLevel } from '../../audio-mapping.js';
import { SegmentBatch } from '../../geometry/segment-batch.js';
import { sampleCurve, TAU } from '../../geometry/curves.js';
import type { Point2 } from '../../geometry/curves.js';
import type { Visualizer, VisualizerMetadata } from '../types.js';
export interface CurveLayer {
  point: (t: number) => Point2;
  period: number;
  seeds: number;
  hue: number;
  brightness?: number;
  /** A stable identity and uniform partition keep Journey samples attached during deformation. */
  id?: string;
  sampling?: 'uniform';
  intensity?: (t: number) => number;
}
export interface CurveContext {
  params: Record<string, number>;
  audio: Record<'bass' | 'mid' | 'high' | 'rms' | 'spectralCentroid', number>;
  features: AudioFeatures | null;
  time: number;
  age: number;
  beat: number;
  phase: number;
  phases: Record<string, number>;
  topology: (key: string, target: number, min: number, max: number) => number;
}
export interface CurveDesign {
  layers: (context: CurveContext) => CurveLayer[];
  width: (context: CurveContext) => number;
  speed?: (context: CurveContext) => number;
  phaseRates?: (context: CurveContext) => Record<string, number>;
}
/** Curves are sampled once per update and rasterized as portable, antialiased ribbons. */
export class CurveVisualizer implements Visualizer {
  readonly params: Record<string, number>;
  private state: Record<string, number> = {
    zoom: 1,
    centerX: 0,
    centerY: 0,
    phase: 0,
    rotation: 0,
  };
  private overrides = new Set<string>();
  private latest: AudioFeatures | null = null;
  private unsub: Unsubscribe;
  private batch: SegmentBatch | null = null;
  private components: Array<{ id: string; start: number; count: number }> = [];
  private width = 1920;
  private height = 1080;
  private time = 0;
  private age = 0;
  private accumulator = 1;
  private phases = new PhaseClock();
  private integers = new Map<string, number>();
  private smooth = Object.fromEntries(
    ['bass', 'mid', 'high', 'rms', 'spectralCentroid'].map((key) => [
      key,
      new EMASmoothing(0.3, 0.12),
    ]),
  );
  private pulse = new EventEnvelope();
  constructor(
    readonly metadata: VisualizerMetadata,
    bus: MessageBus,
    private design: CurveDesign,
  ) {
    this.params = Object.fromEntries(
      metadata.params.map((p) => [p.key, p.initial]),
    );
    this.unsub = bus.subscribe<AudioFeatures>('audio:features', (msg) => {
      this.latest = { ...msg.payload };
    });
  }
  attach(scene: Scene): void {
    this.batch = new SegmentBatch(12288);
    scene.add(this.batch.object);
    this.setResolution(this.width, this.height);
    this.tick(0);
  }
  tick(deltaSeconds = 1 / 60): void {
    const dt = frameDelta(deltaSeconds);
    this.time += dt;
    this.age += dt;
    const features = this.latest ? takeAudioFrame(this.latest) : null;
    const event = features?.beatOnset ?? false;
    if (event) this.age = 0;
    const audio = {} as CurveContext['audio'];
    for (const key of Object.keys(this.smooth) as (keyof typeof audio)[])
      audio[key] = this.smooth[key].update(
        motionLevel(
          key,
          features?.[key] ?? 0,
          this.params.audioSensitivity ?? 1,
        ),
        dt,
      );
    const context: CurveContext = {
      params: this.params,
      audio,
      features,
      time: this.time,
      age: this.age,
      beat: this.pulse.update(event ? 1 : 0, dt),
      phase: this.state.phase,
      phases: {},
      topology: (key, target, min, max) => {
        const next = topologyValue(
          this.integers.get(key) ?? Math.round(target),
          target,
          min,
          max,
        );
        this.integers.set(key, next);
        return next;
      },
    };
    for (const [key, rate] of Object.entries(
      this.design.phaseRates?.(context) ?? {},
    ))
      context.phases[key] = this.phases.advance(key, rate, dt);
    this.state.phase =
      this.phases.advance(
        'rotation',
        this.design.speed?.(context) ?? 0.05,
        dt,
      ) % TAU;
    context.phase = this.overrides.has('rotation')
      ? this.state.rotation
      : this.state.phase;
    this.accumulator += dt;
    if (!this.batch || this.accumulator < 1 / 30) return;
    this.accumulator %= 1 / 30;
    const layers = this.design.layers(context),
      batch = this.batch;
    const capacity = Math.floor(batch.capacity / Math.max(1, layers.length));
    const scaleX =
      ((2 * Math.min(this.width, this.height)) / this.width) * this.state.zoom;
    const scaleY =
      ((2 * Math.min(this.width, this.height)) / this.height) * this.state.zoom;
    const color = new Color();
    let count = 0;
    this.components = [];
    for (const [layerIndex, layer] of layers.entries()) {
      const start = count;
      const emit = (a: Point2, b: Point2, t: number) => {
        const offset = count * 6;
        batch.positions.set(
          [
            (a[0] - this.state.centerX) * scaleX,
            (a[1] - this.state.centerY) * scaleY,
            -0.5,
            (b[0] - this.state.centerX) * scaleX,
            (b[1] - this.state.centerY) * scaleY,
            -0.5,
          ],
          offset,
        );
        color
          .setHSL((layer.hue + (t / layer.period) * 0.15) % 1, 0.7, 0.55)
          .multiplyScalar(
            (layer.brightness ?? 1) * (layer.intensity?.(t) ?? 1),
          );
        batch.colors.set(
          [color.r, color.g, color.b, color.r, color.g, color.b],
          offset,
        );
        count++;
      };
      if (layer.sampling === 'uniform') {
        const segments = Math.max(
          8,
          Math.min(capacity, Math.ceil(layer.seeds)),
        );
        let previous = layer.point(0);
        for (let i = 1; i <= segments; i++) {
          const t = (layer.period * i) / segments,
            next = layer.point(t);
          emit(previous, next, t - layer.period / segments / 2);
          previous = next;
        }
      } else
        sampleCurve(
          layer.point,
          0,
          layer.period,
          layer.seeds,
          0.4 / Math.min(this.width, this.height) / this.state.zoom,
          capacity,
          emit,
        );
      this.components.push({
        id: layer.id ?? `${this.metadata.type}-${layerIndex}`,
        start,
        count: count - start,
      });
    }
    batch.material.linewidth = Math.max(
      0.5,
      Math.min(8, this.design.width(context)),
    );
    batch.material.opacity = 0.8;
    batch.upload(count);
  }
  setResolution(w: number, h: number): void {
    this.width = w;
    this.height = h;
    this.batch?.setResolution(w, h);
    this.accumulator = 1;
  }
  setUserParam(key: string, value: number): void {
    const field = this.metadata.params.find((p) => p.key === key);
    if (field && Number.isFinite(value)) {
      this.params[key] = Math.max(field.min, Math.min(field.max, value));
      this.accumulator = 1;
    }
  }
  getViewState(): Record<string, number> {
    return Object.fromEntries(
      this.metadata.viewStateFields.map((f) => [f.key, this.state[f.key] ?? 0]),
    );
  }
  setViewState(partial: Record<string, number>): void {
    for (const field of this.metadata.viewStateFields) {
      const v = partial[field.key];
      if (!field.readOnly && Number.isFinite(v)) {
        this.state[field.key] = Math.max(field.min, Math.min(field.max, v));
        this.overrides.add(field.key);
      }
    }
    this.accumulator = 1;
  }
  getTransitionComponents() {
    const batch = this.batch;
    return batch
      ? this.components.map(({ id, start, count }) => ({
          ...batch.component(id),
          count,
          revision: count,
          positions: batch.positions.subarray(start * 6, (start + count) * 6),
          colors: batch.colors.subarray(start * 6, (start + count) * 6),
        }))
      : [];
  }

  dispose(): void {
    this.unsub();
    this.batch?.dispose();
    this.batch = null;
    this.components = [];
  }
}
