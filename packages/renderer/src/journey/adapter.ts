import { Matrix4, Vector3 } from 'three';
import type { Camera } from 'three';
import type {
  ComponentFrame,
  ComponentSource,
  SampleFrame,
  TransitionAdapter,
} from './types.js';

/** Sampling stays attached to model coordinates; screen projection uses the native camera. */
export class GeometryTransitionAdapter implements TransitionAdapter {
  private frame: SampleFrame;
  private cumulative = new Float64Array(0);
  private primitiveComponents = new Uint16Array(0);
  private primitives = new Uint32Array(0);
  private a = new Float32Array(3);
  private b = new Float32Array(3);
  private c = new Float32Array(3);
  private point = new Vector3();
  private projection = new Matrix4();
  private matrices: Matrix4[] = [];
  private disposed = false;
  private previousRevision = '';
  private fade = 1;
  private sampledRevision = '';
  private slots: Array<{ component: number; index: number; t: number }> = [];
  private identity = new Matrix4();
  private end = new Vector3();
  constructor(
    private source: ComponentSource,
    readonly count: number,
  ) {
    this.frame = {
      positions: new Float32Array(count * 3),
      colors: new Float32Array(count * 4),
      tangents: new Float32Array(count * 3),
      ids: Uint32Array.from({ length: count }, (_, i) => i),
      revision: '',
      bounds: { min: [0, 0, 0], max: [0, 0, 0] },
    };
  }
  private vertex(
    component: ComponentFrame,
    index: number,
    out: Float32Array,
  ): void {
    if (component.vertex) component.vertex(index, out);
    else {
      out[0] = component.positions[index * 3];
      out[1] = component.positions[index * 3 + 1];
      out[2] = component.positions[index * 3 + 2];
    }
  }
  read(camera: Camera, dt = 1 / 60): SampleFrame {
    if (this.disposed) throw new Error('Transition adapter has been disposed');
    const components = this.source.getTransitionComponents();
    const revision = components
      .map((c) => `${c.id}:${c.revision}:${c.count}`)
      .join('|');
    if (
      this.sampledRevision &&
      revision !== this.sampledRevision &&
      this.fade > 0
    ) {
      const previous = this.fade;
      this.fade = Math.max(0, this.fade - Math.max(0, dt) / 0.12);
      for (let i = 0; i < this.count; i++)
        this.frame.colors[i * 4 + 3] *= this.fade / previous;
      return this.frame;
    }
    const rebuild = revision !== this.sampledRevision;
    this.previousRevision = revision;
    if (!rebuild) this.fade = Math.min(1, this.fade + Math.max(0, dt) / 0.12);
    this.frame.revision = revision;
    camera.updateMatrixWorld(true);
    this.projection.multiplyMatrices(
      camera.projectionMatrix,
      camera.matrixWorldInverse,
    );
    let capacity = 0;
    for (const c of components)
      capacity +=
        c.kind === 'surface'
          ? Math.floor((c.indices?.length ?? c.count) / 3)
          : c.count;
    if (this.cumulative.length < capacity) {
      const n = Math.max(capacity, this.cumulative.length * 2, 16);
      this.cumulative = new Float64Array(n);
      this.primitives = new Uint32Array(n);
      this.primitiveComponents = new Uint16Array(n);
    }
    let used = 0,
      total = 0;
    components.forEach((component, ci) => {
      component.object?.updateWorldMatrix(true, false);
      const matrix = this.matrices[ci] ?? (this.matrices[ci] = new Matrix4());
      matrix.copy(
        component.transform ?? component.object?.matrixWorld ?? this.identity,
      );
      matrix.premultiply(this.projection);
      if (!rebuild) return;
      const n =
        component.kind === 'surface'
          ? Math.floor((component.indices?.length ?? component.count) / 3)
          : component.count;
      for (let i = 0; i < n; i++) {
        let mass = 1;
        // Particle indices remain stable across death and recycling. Visibility is an alpha, never an assignment edit.
        if (component.kind === 'curves') {
          this.vertex(component, i * 2, this.a);
          this.vertex(component, i * 2 + 1, this.b);
          mass = Math.hypot(
            this.a[0] - this.b[0],
            this.a[1] - this.b[1],
            this.a[2] - this.b[2],
          );
        } else if (component.kind === 'surface') {
          this.vertex(component, component.indices?.[i * 3] ?? i * 3, this.a);
          this.vertex(
            component,
            component.indices?.[i * 3 + 1] ?? i * 3 + 1,
            this.b,
          );
          this.vertex(
            component,
            component.indices?.[i * 3 + 2] ?? i * 3 + 2,
            this.c,
          );
          const ux = this.b[0] - this.a[0],
            uy = this.b[1] - this.a[1],
            uz = this.b[2] - this.a[2];
          const vx = this.c[0] - this.a[0],
            vy = this.c[1] - this.a[1],
            vz = this.c[2] - this.a[2];
          mass =
            Math.hypot(
              uy * vz - uz * vy,
              uz * vx - ux * vz,
              ux * vy - uy * vx,
            ) / 2;
        }
        if (!(mass > 1e-12) || !Number.isFinite(mass)) continue;
        total += mass;
        this.cumulative[used] = total;
        this.primitiveComponents[used] = ci;
        this.primitives[used++] = i;
      }
    });
    if (rebuild) this.slots = [];
    const { positions, colors, tangents, bounds } = this.frame;
    bounds.min.fill(Infinity);
    bounds.max.fill(-Infinity);
    let primitive = 0;
    for (let i = 0; i < this.count; i++) {
      const mass = ((i + 0.5) / this.count) * total;
      while (primitive < used - 1 && this.cumulative[primitive] < mass)
        primitive++;
      if (rebuild && !used) {
        positions.fill(0);
        colors.fill(0);
        tangents.fill(0);
        bounds.min.fill(0);
        bounds.max.fill(0);
        break;
      }
      if (rebuild) {
        const before = primitive ? this.cumulative[primitive - 1] : 0;
        this.slots[i] = {
          component: this.primitiveComponents[primitive],
          index: this.primitives[primitive],
          t:
            (mass - before) /
            Math.max(1e-12, this.cumulative[primitive] - before),
        };
      }
      const slot = this.slots[i];
      if (!slot) continue;
      const component = components[slot.component],
        index = slot.index,
        t = slot.t;
      tangents[i * 3] = tangents[i * 3 + 1] = tangents[i * 3 + 2] = 0;
      let colorIndex = index;
      if (component.kind === 'curves') {
        colorIndex = index * 2;
        this.vertex(component, index * 2, this.a);
        this.vertex(component, index * 2 + 1, this.b);
        for (let axis = 0; axis < 3; axis++) {
          tangents[i * 3 + axis] = this.b[axis] - this.a[axis];
          this.a[axis] += t * (this.b[axis] - this.a[axis]);
        }
      } else if (component.kind === 'surface') {
        colorIndex = component.indices?.[index * 3] ?? index * 3;
        this.vertex(component, colorIndex, this.a);
        this.vertex(
          component,
          component.indices?.[index * 3 + 1] ?? index * 3 + 1,
          this.b,
        );
        this.vertex(
          component,
          component.indices?.[index * 3 + 2] ?? index * 3 + 2,
          this.c,
        );
        const u = Math.sqrt((i * 0.61803398875 + 0.5) % 1),
          v = (i * 0.754877666 + 0.25) % 1;
        for (let axis = 0; axis < 3; axis++)
          this.a[axis] =
            (1 - u) * this.a[axis] +
            u * (1 - v) * this.b[axis] +
            u * v * this.c[axis];
      } else this.vertex(component, index, this.a);
      this.point
        .set(this.a[0], this.a[1], this.a[2])
        .applyMatrix4(this.matrices[slot.component]);
      if (component.kind === 'curves') {
        this.end
          .set(this.b[0], this.b[1], this.b[2])
          .applyMatrix4(this.matrices[slot.component])
          .sub(this.point)
          .normalize();
        tangents[i * 3] = this.end.x;
        tangents[i * 3 + 1] = this.end.y;
        tangents[i * 3 + 2] = this.end.z;
      }
      const visible =
        (!component.visible || component.visible(index)) &&
        Number.isFinite(this.point.x + this.point.y + this.point.z) &&
        this.point.z >= -1 &&
        this.point.z <= 1;
      for (let axis = 0; axis < 3; axis++) {
        const value = visible ? this.point.getComponent(axis) : 0;
        positions[i * 3 + axis] = value;
        colors[i * 4 + axis] =
          component.colors?.[colorIndex * 3 + axis] ?? [0.45, 0.65, 1][axis];
        bounds.min[axis] = Math.min(bounds.min[axis], value);
        bounds.max[axis] = Math.max(bounds.max[axis], value);
      }
      colors[i * 4 + 3] = visible
        ? (component.opacity ?? 1) *
          this.fade *
          (component.sampleAlpha?.(index) ?? 1)
        : 0;
    }
    this.sampledRevision = revision;
    return this.frame;
  }
  dispose(): void {
    this.disposed = true;
    this.cumulative = new Float64Array(0);
    this.matrices = [];
  }
}
export function createTransitionAdapter(
  source: ComponentSource,
  count: number,
): TransitionAdapter {
  return new GeometryTransitionAdapter(source, count);
}
