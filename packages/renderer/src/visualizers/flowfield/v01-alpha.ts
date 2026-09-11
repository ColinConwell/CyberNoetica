import * as THREE from 'three';
import type { MessageBus } from '@cybernoetica/core';
import type { VisualizerMetadata } from '../types.js';
import { registerVisualizer } from '../registry.js';
import { ModelVisualizer } from '../model-base.js';
import { FixedStepClock, seededRandom } from '../../timing.js';
import { SegmentBatch } from '../../geometry/segment-batch.js';
import { streamField } from '../../geometry/vector-fields.js';
const flowfieldMetadata: VisualizerMetadata = {
  type: 'flowfield',
  label: 'Flow Field',
  description: 'Curl noise vector field streaks',
  usesPerspective: false,
  params: [
    // Appearance
    {
      key: 'octaves',
      label: 'Octaves',
      min: 1,
      max: 6,
      step: 1,
      initial: 3,
      category: 'appearance',
      description: 'Fourier stream-function modes (more = finer flow)',
    },
    {
      key: 'brightness',
      label: 'Brightness',
      min: 0.5,
      max: 3.0,
      step: 0.1,
      initial: 1.4,
      category: 'appearance',
      description: 'Overall brightness multiplier',
    },
    {
      key: 'streakLength',
      label: 'Streak Length',
      min: 4,
      max: 32,
      step: 2,
      initial: 16,
      category: 'appearance',
      description: 'Number of recent trajectory segments per tracer',
    },
    {
      key: 'colorCycle',
      label: 'Color Cycle',
      min: 0.0,
      max: 1.0,
      step: 0.05,
      initial: 0.3,
      category: 'appearance',
      description: 'Base hue cycling speed',
    },
    {
      key: 'flowSpeed',
      label: 'Flow Speed',
      min: 0.1,
      max: 2.0,
      step: 0.1,
      initial: 0.8,
      category: 'appearance',
      description: 'Base advection speed',
    },
    // Audio mapping
    {
      key: 'bassToTurbulence',
      label: 'Bass -> Turbulence',
      min: 0.0,
      max: 2.0,
      step: 0.1,
      initial: 1.0,
      category: 'audio-mapping',
      description: 'How bass increases turbulence',
    },
    {
      key: 'midToSpeed',
      label: 'Mid -> Speed',
      min: 0.0,
      max: 2.0,
      step: 0.1,
      initial: 1.0,
      category: 'audio-mapping',
      description: 'How mids accelerate flow',
    },
    {
      key: 'spectralToScale',
      label: 'Spectral -> Scale',
      min: 0.0,
      max: 2.0,
      step: 0.1,
      initial: 1.0,
      category: 'audio-mapping',
      description: 'How spectral centroid shifts noise scale',
    },
    {
      key: 'rmsToGlow',
      label: 'RMS -> Glow',
      min: 0.0,
      max: 2.0,
      step: 0.1,
      initial: 1.0,
      category: 'audio-mapping',
      description: 'How volume boosts glow intensity',
    },
  ],
  viewport: { pan: true, zoom: true, orbit: false },
  viewStateFields: [
    { key: 'zoom', label: 'Zoom', min: 0.3, max: 5.0, step: 0.05 },
    { key: 'panX', label: 'Pan X', min: -3.0, max: 3.0, step: 0.01 },
    { key: 'panY', label: 'Pan Y', min: -3.0, max: 3.0, step: 0.01 },
  ],
};
const COUNT = 512,
  TRAIL = 32,
  GRID = 64,
  TAU = 2 * Math.PI;
export class FlowFieldVisualizer extends ModelVisualizer {
  private batch: SegmentBatch | null = null;
  private points = new Float32Array(COUNT * 2);
  private history = new Float32Array(COUNT * TRAIL * 4);
  private field = new Float32Array(GRID * GRID * 3);
  private clock = new FixedStepClock(1 / 60, 6);
  private head = 0;
  private elapsed = 1;
  private flowPhase = 0;
  private colorPhase = 0;
  constructor(bus: MessageBus) {
    super(flowfieldMetadata, bus);
    const random = seededRandom(411);
    for (let i = 0; i < this.points.length; i++)
      this.points[i] = random() * TAU;
  }
  protected build(): void {
    this.batch = new SegmentBatch(COUNT * TRAIL);
    this.root.add(this.batch.object);
  }
  protected update(dt: number): void {
    const p = this.params,
      a = this.audio;
    this.flowPhase += dt * p.flowSpeed * 0.25;
    this.colorPhase += dt * p.colorCycle * 0.05;
    this.elapsed += dt;
    if (this.elapsed >= 0.1) {
      this.elapsed %= 0.1;
      const octaves = Math.min(
        6,
        Math.round(p.octaves + a.spectralCentroid * p.spectralToScale),
      );
      for (let y = 0; y < GRID; y++)
        for (let x = 0; x < GRID; x++)
          this.field.set(
            streamField(
              (x / GRID) * TAU,
              (y / GRID) * TAU,
              this.flowPhase,
              octaves,
            ),
            (y * GRID + x) * 3,
          );
    }
    const velocity = (x: number, y: number): [number, number, number] => {
      const gx = ((x / TAU) * GRID + GRID) % GRID,
        gy = ((y / TAU) * GRID + GRID) % GRID,
        ix = Math.floor(gx),
        iy = Math.floor(gy),
        fx = gx - ix,
        fy = gy - iy;
      const result: [number, number, number] = [0, 0, 0];
      for (let yy = 0; yy < 2; yy++)
        for (let xx = 0; xx < 2; xx++) {
          const weight = (xx ? fx : 1 - fx) * (yy ? fy : 1 - fy),
            offset = (((iy + yy) % GRID) * GRID + ((ix + xx) % GRID)) * 3;
          for (let c = 0; c < 3; c++)
            result[c] += this.field[offset + c] * weight;
        }
      return result;
    };
    this.clock.advance(dt, (step) => {
      const speed =
        p.flowSpeed *
        (1 + a.mid * p.midToSpeed) *
        (1 + 0.25 * a.bass * p.bassToTurbulence);
      for (let i = 0; i < COUNT; i++) {
        const x = this.points[2 * i],
          y = this.points[2 * i + 1],
          v = velocity(x, y),
          mid = velocity(
            (x + v[0] * step * speed * 0.5 + TAU) % TAU,
            (y + v[1] * step * speed * 0.5 + TAU) % TAU,
          );
        const nx = x + mid[0] * step * speed,
          ny = y + mid[1] * step * speed,
          k = (this.head * COUNT + i) * 4;
        this.history.set([x, y, nx, ny], k);
        if (nx < 0 || nx >= TAU || ny < 0 || ny >= TAU)
          this.history.set([x, y, x, y], k);
        this.points[2 * i] = (nx + TAU) % TAU;
        this.points[2 * i + 1] = (ny + TAU) % TAU;
      }
      this.head = (this.head + 1) % TRAIL;
    });
    const batch = this.batch;
    if (!batch) return;
    batch.setResolution(this.width, this.height);
    let count = 0;
    const color = new THREE.Color();
    const scale = (0.9 / TAU) * this.view.zoom,
      sx = (2 * Math.min(this.width, this.height)) / this.width,
      sy = (2 * Math.min(this.width, this.height)) / this.height;
    const length = Math.round(p.streakLength);
    for (let age = 0; age < length; age++)
      for (let i = 0; i < COUNT; i++) {
        const slot = (this.head - 1 - age + TRAIL) % TRAIL,
          k = (slot * COUNT + i) * 4,
          x = this.history[k],
          y = this.history[k + 1],
          nx = this.history[k + 2],
          ny = this.history[k + 3];
        const panX = this.view.panX ?? 0,
          panY = this.view.panY ?? 0;
        batch.positions.set(
          [
            ((x - Math.PI) * scale - panX) * sx,
            ((y - Math.PI) * scale - panY) * sy,
            -0.5,
            ((nx - Math.PI) * scale - panX) * sx,
            ((ny - Math.PI) * scale - panY) * sy,
            -0.5,
          ],
          count * 6,
        );
        const curl = velocity(x, y)[2];
        color
          .setHSL((0.6 + curl * 0.08 + this.colorPhase + 1) % 1, 0.65, 0.5)
          .multiplyScalar(
            (1 - age / length) * p.brightness * (0.5 + a.rms * p.rmsToGlow),
          );
        batch.colors.set(
          [color.r, color.g, color.b, color.r, color.g, color.b],
          count * 6,
        );
        count++;
      }
    batch.material.linewidth = 1.6;
    batch.upload(count);
  }
  override dispose(): void {
    this.batch?.dispose();
    super.dispose();
  }
}
registerVisualizer({
  metadata: flowfieldMetadata,
  create: (bus) => new FlowFieldVisualizer(bus),
});
