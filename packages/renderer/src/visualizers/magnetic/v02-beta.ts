import * as THREE from 'three';
import type { MessageBus } from '@cybernoetica/core';
import { ModelVisualizer, MODEL_PARAMS, MODEL_VIEW_2D } from '../model-base.js';
import { SegmentBatch } from '../../geometry/segment-batch.js';
import { dipoleField } from '../../geometry/vector-fields.js';
import { registerVisualizer } from '../registry.js';
import type { VisualizerMetadata } from '../types.js';
const metadata: VisualizerMetadata = {
  type: 'magnetic-beta',
  label: 'Dipole Field Lines',
  description:
    'Planar field-line traces of the three-dimensional magnetic dipole equation',
  usesPerspective: false,
  params: [
    {
      key: 'dipoles',
      label: 'Dipoles',
      min: 1,
      max: 3,
      step: 1,
      initial: 1,
      category: 'appearance',
    },
    ...MODEL_PARAMS,
  ],
  viewport: { pan: true, zoom: true, orbit: false },
  viewStateFields: MODEL_VIEW_2D,
};
export class DipoleVisualizer extends ModelVisualizer {
  private batch: SegmentBatch | null = null;
  private elapsed = 1;
  constructor(bus: MessageBus) {
    super(metadata, bus);
  }
  protected build(): void {
    this.batch = new SegmentBatch(24000);
    this.root.add(this.batch.object);
  }
  protected update(dt: number): void {
    this.elapsed += dt;
    if (this.elapsed < 1 / 20 || !this.batch) return;
    this.elapsed %= 1 / 20;
    const batch = this.batch;
    batch.setResolution(this.width, this.height);
    const dipoles = Math.round(this.params.dipoles),
      angle = this.phase,
      mx = Math.cos(angle),
      my = Math.sin(angle),
      centers = Array.from(
        { length: dipoles },
        (_, i) => (i - (dipoles - 1) / 2) * 0.9,
      ),
      color = new THREE.Color();
    let count = 0;
    const direction = (x: number, y: number): [number, number] => {
      let bx = 0,
        by = 0;
      for (const center of centers) {
        const b = dipoleField(x - center, y, mx, my);
        bx += b[0];
        by += b[1];
      }
      const norm = Math.max(1e-12, Math.hypot(bx, by));
      return [bx / norm, by / norm];
    };
    const step = 0.012,
      scale =
        0.26 *
        this.view.zoom *
        (1 + this.audio.bass * this.params.bassResponse * 0.04),
      sx = (2 * Math.min(this.width, this.height)) / this.width,
      sy = (2 * Math.min(this.width, this.height)) / this.height;
    for (const center of centers)
      for (let seed = 0; seed < 32; seed++)
        for (const sign of [-1, 1]) {
          const a = (2 * Math.PI * (seed + 0.5)) / 32;
          let x = center + 0.12 * Math.cos(a),
            y = 0.12 * Math.sin(a);
          for (let j = 0; j < 180 && count < batch.capacity; j++) {
            const k1 = direction(x, y),
              k2 = direction(
                x + (k1[0] * step * sign) / 2,
                y + (k1[1] * step * sign) / 2,
              ),
              k3 = direction(
                x + (k2[0] * step * sign) / 2,
                y + (k2[1] * step * sign) / 2,
              ),
              k4 = direction(x + k3[0] * step * sign, y + k3[1] * step * sign);
            const nx =
                x + (sign * step * (k1[0] + 2 * k2[0] + 2 * k3[0] + k4[0])) / 6,
              ny =
                y + (sign * step * (k1[1] + 2 * k2[1] + 2 * k3[1] + k4[1])) / 6;
            if (
              Math.hypot(nx, ny) > 2.1 ||
              centers.some((c) => Math.hypot(nx - c, ny) < 0.09)
            )
              break;
            batch.positions.set(
              [
                (x * scale - this.view.centerX) * sx,
                (y * scale - this.view.centerY) * sy,
                -0.5,
                (nx * scale - this.view.centerX) * sx,
                (ny * scale - this.view.centerY) * sy,
                -0.5,
              ],
              count * 6,
            );
            color
              .setHSL(
                (0.55 +
                  this.audio.spectralCentroid * this.params.centroidResponse +
                  seed / 96) %
                  1,
                0.65,
                0.5,
              )
              .multiplyScalar(
                this.params.brightness *
                  (0.6 + this.audio.rms * this.params.rmsResponse),
              );
            batch.colors.set(
              [color.r, color.g, color.b, color.r, color.g, color.b],
              count * 6,
            );
            count++;
            x = nx;
            y = ny;
          }
        }
    batch.material.linewidth = 1.25;
    batch.upload(count);
  }
  override dispose(): void {
    this.batch?.dispose();
    super.dispose();
  }
}
registerVisualizer({ metadata, create: (bus) => new DipoleVisualizer(bus) });
