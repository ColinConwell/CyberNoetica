import { AdditiveBlending, DynamicDrawUsage } from 'three';
import type { InterleavedBufferAttribute } from 'three';
import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';

/** Portable pixel-width ribbons in one draw call; buffers retain allocated capacity. */
export class SegmentBatch {
  readonly positions: Float32Array;
  readonly colors: Float32Array;
  readonly geometry = new LineSegmentsGeometry();
  readonly material = new LineMaterial({
    color: 0xffffff,
    linewidth: 2,
    vertexColors: true,
    transparent: true,
    opacity: 0.8,
    depthWrite: false,
    blending: AdditiveBlending,
  });
  readonly object: LineSegments2;
  constructor(readonly capacity: number) {
    this.positions = new Float32Array(capacity * 6);
    this.colors = new Float32Array(capacity * 6).fill(1);
    this.geometry.setPositions(this.positions);
    this.geometry.setColors(this.colors);
    (
      this.geometry.getAttribute('instanceStart') as InterleavedBufferAttribute
    ).data.setUsage(DynamicDrawUsage);
    (
      this.geometry.getAttribute(
        'instanceColorStart',
      ) as InterleavedBufferAttribute
    ).data.setUsage(DynamicDrawUsage);
    this.geometry.instanceCount = 0;
    this.object = new LineSegments2(this.geometry, this.material);
    this.object.frustumCulled = false;
  }
  upload(count: number, colors = true): void {
    this.geometry.instanceCount = Math.max(0, Math.min(this.capacity, count));
    (
      this.geometry.getAttribute('instanceStart') as InterleavedBufferAttribute
    ).data.needsUpdate = true;
    if (colors)
      (
        this.geometry.getAttribute(
          'instanceColorStart',
        ) as InterleavedBufferAttribute
      ).data.needsUpdate = true;
  }
  setResolution(w: number, h: number): void {
    this.material.resolution.set(w, h);
  }
  dispose(): void {
    this.object.removeFromParent();
    this.geometry.dispose();
    this.material.dispose();
  }
}
