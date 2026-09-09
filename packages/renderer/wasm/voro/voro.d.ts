interface VoroEmscriptenModule {
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
  _voro_volumes(ctx: number): number;
  _malloc(bytes: number): number;
  _free(ptr: number): void;
  HEAPF32: Float32Array;
  HEAPU32: Uint32Array;
}

declare const createVoroModule: (opts?: {
  locateFile?: (path: string, prefix: string) => string;
}) => Promise<VoroEmscriptenModule>;

export default createVoroModule;
