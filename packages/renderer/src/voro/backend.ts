export type VoroMode = 'box' | 'periodic' | 'radical' | 'sphere';

export interface VoroMesh {
  inputSeeds: Float32Array;
  vertices: Float32Array;
  normals: Float32Array;
  indices: Uint32Array;
  cellIds: Uint32Array;
  edges: Float32Array;
  edgeCellIds: Uint32Array;
  centroids: Float32Array;
  volumes: Float32Array;
  cellCount: number;
  /** Compact mesh cell index → persistent input seed index. */
  seedIds: Uint32Array;
}

export interface VoroBackendOptions {
  halfExtent?: number;
  grid?: number;
  mode?: VoroMode;
  sphereRadius?: number;
}

const MODE_CODE: Record<VoroMode, number> = {
  box: 0,
  periodic: 1,
  radical: 2,
  sphere: 3,
};

type VoroModule = {
  _voro_create(
    ax: number,
    bx: number,
    ay: number,
    by: number,
    az: number,
    bz: number,
    nx: number,
    ny: number,
    nz: number,
    mode: number,
  ): number;
  _voro_destroy(ctx: number): void;
  _voro_compute(ctx: number, xyzPtr: number, n: number): number;
  _voro_compute_weighted(
    ctx: number,
    xyzPtr: number,
    radiiPtr: number,
    n: number,
  ): number;
  _voro_set_sphere_radius(ctx: number, r: number): void;
  _voro_n_cells(ctx: number): number;
  _voro_n_vertices(ctx: number): number;
  _voro_n_indices(ctx: number): number;
  _voro_n_edge_floats(ctx: number): number;
  _voro_vertices(ctx: number): number;
  _voro_normals(ctx: number): number;
  _voro_indices(ctx: number): number;
  _voro_cell_ids(ctx: number): number;
  _voro_edges(ctx: number): number;
  _voro_edge_cell_ids(ctx: number): number;
  _voro_centroids(ctx: number): number;
  _voro_seed_ids(ctx: number): number;
  _voro_volumes(ctx: number): number;
  _malloc(bytes: number): number;
  _free(ptr: number): void;
  HEAPF32: Float32Array;
  HEAPU32: Uint32Array;
};

function copyF32(mod: VoroModule, ptr: number, count: number): Float32Array {
  if (!ptr || count <= 0) return new Float32Array(0);
  return new Float32Array(mod.HEAPF32.subarray(ptr >> 2, (ptr >> 2) + count));
}

function copyU32(mod: VoroModule, ptr: number, count: number): Uint32Array {
  if (!ptr || count <= 0) return new Uint32Array(0);
  return new Uint32Array(mod.HEAPU32.subarray(ptr >> 2, (ptr >> 2) + count));
}

export class VoroBackend {
  private ctx: number;
  private xyzPtr = 0;
  private xyzCap = 0;
  private radiiPtr = 0;
  private radiiCap = 0;
  private readonly mode: VoroMode;

  constructor(
    private readonly mod: VoroModule,
    halfExtent: number,
    grid: number,
    mode: VoroMode,
    sphereRadius?: number,
  ) {
    this.mode = mode;
    const h = halfExtent;
    this.ctx = mod._voro_create(
      -h,
      h,
      -h,
      h,
      -h,
      h,
      grid,
      grid,
      grid,
      MODE_CODE[mode],
    );
    if (mode === 'sphere' && sphereRadius != null) {
      mod._voro_set_sphere_radius(this.ctx, sphereRadius);
    }
  }

  setSphereRadius(r: number): void {
    if (this.mode !== 'sphere' || !this.ctx) return;
    this.mod._voro_set_sphere_radius(this.ctx, r);
  }

  compute(xyz: Float32Array, radii?: Float32Array): VoroMesh | null {
    const n = (xyz.length / 3) | 0;
    if (n <= 0) return null;

    const xyzBytes = n * 3 * 4;
    if (xyzBytes > this.xyzCap) {
      if (this.xyzPtr) this.mod._free(this.xyzPtr);
      this.xyzPtr = this.mod._malloc(xyzBytes);
      this.xyzCap = xyzBytes;
    }
    this.mod.HEAPF32.set(xyz.subarray(0, n * 3), this.xyzPtr >> 2);

    let cellCount: number;
    if (this.mode === 'radical' && radii && radii.length >= n) {
      const rBytes = n * 4;
      if (rBytes > this.radiiCap) {
        if (this.radiiPtr) this.mod._free(this.radiiPtr);
        this.radiiPtr = this.mod._malloc(rBytes);
        this.radiiCap = rBytes;
      }
      this.mod.HEAPF32.set(radii.subarray(0, n), this.radiiPtr >> 2);
      cellCount = this.mod._voro_compute_weighted(
        this.ctx,
        this.xyzPtr,
        this.radiiPtr,
        n,
      );
    } else {
      cellCount = this.mod._voro_compute(this.ctx, this.xyzPtr, n);
    }

    const nVerts = this.mod._voro_n_vertices(this.ctx);
    const nIdx = this.mod._voro_n_indices(this.ctx);
    const nEdge = this.mod._voro_n_edge_floats(this.ctx);

    return {
      inputSeeds: xyz.slice(),
      vertices: copyF32(
        this.mod,
        this.mod._voro_vertices(this.ctx),
        nVerts * 3,
      ),
      normals: copyF32(this.mod, this.mod._voro_normals(this.ctx), nVerts * 3),
      indices: copyU32(this.mod, this.mod._voro_indices(this.ctx), nIdx),
      cellIds: copyU32(this.mod, this.mod._voro_cell_ids(this.ctx), nVerts),
      edges: copyF32(this.mod, this.mod._voro_edges(this.ctx), nEdge),
      edgeCellIds: copyU32(
        this.mod,
        this.mod._voro_edge_cell_ids(this.ctx),
        nEdge / 3,
      ),
      centroids: copyF32(
        this.mod,
        this.mod._voro_centroids(this.ctx),
        cellCount * 3,
      ),
      volumes: copyF32(this.mod, this.mod._voro_volumes(this.ctx), cellCount),
      cellCount,
      seedIds: copyU32(this.mod, this.mod._voro_seed_ids(this.ctx), cellCount),
    };
  }

  dispose(): void {
    if (this.xyzPtr) {
      this.mod._free(this.xyzPtr);
      this.xyzPtr = 0;
      this.xyzCap = 0;
    }
    if (this.radiiPtr) {
      this.mod._free(this.radiiPtr);
      this.radiiPtr = 0;
      this.radiiCap = 0;
    }
    if (this.ctx) {
      this.mod._voro_destroy(this.ctx);
      this.ctx = 0;
    }
  }
}

export async function loadVoroBackend(
  opts: VoroBackendOptions = {},
): Promise<VoroBackend | null> {
  try {
    const glue = await import('../../wasm/voro/voro.js');
    const mod = await glue.default();
    return new VoroBackend(
      mod as VoroModule,
      opts.halfExtent ?? 2.0,
      opts.grid ?? 3,
      opts.mode ?? 'box',
      opts.sphereRadius,
    );
  } catch (err) {
    console.warn('Voro++ WASM unavailable', err);
    return null;
  }
}
