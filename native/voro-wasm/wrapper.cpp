#include <set>
#include <utility>
// Thin C ABI around Voro++ for WASM tessellation of 3D Voronoi cells.
// Upstream library: https://math.lbl.gov/voro++/
//
// Modes: 0 = box (non-periodic), 1 = periodic, 2 = radical/Laguerre, 3 = spherical wall.

#include "container.hh"
#include "c_loops.hh"
#include "cell.hh"
#include "wall.hh"

#include <algorithm>
#include <cmath>
#include <cstdint>
#include <vector>

#ifdef __EMSCRIPTEN__
#include <emscripten.h>
#else
#define EMSCRIPTEN_KEEPALIVE
#endif

enum VoroMode {
  MODE_BOX = 0,
  MODE_PERIODIC = 1,
  MODE_RADICAL = 2,
  MODE_SPHERE = 3
};

struct VoroContext {
  double ax, bx, ay, by, az, bz;
  int nx, ny, nz;
  int mode;
  double sphere_r;
  voro::container *con;
  voro::container_poly *con_poly;
  voro::wall_sphere *sphere;

  std::vector<float> vertices;
  std::vector<float> normals;
  std::vector<std::uint32_t> indices;
  std::vector<std::uint32_t> cell_ids;
  std::vector<float> edges;
  std::vector<std::uint32_t> edge_cell_ids;
  std::vector<float> centroids;
  std::vector<float> volumes;
  std::vector<std::uint32_t> seed_ids;
  int n_cells;
};

static void clear_mesh(VoroContext *ctx) {
  ctx->vertices.clear();
  ctx->normals.clear();
  ctx->indices.clear();
  ctx->cell_ids.clear();
  ctx->edges.clear();
  ctx->edge_cell_ids.clear();
  ctx->centroids.clear();
  ctx->volumes.clear();
  ctx->seed_ids.clear();
  ctx->n_cells = 0;
}

static void append_cell(
  VoroContext *ctx,
  voro::voronoicell &cell,
  double px, double py, double pz,
  int cell_index
) {
  double cx, cy, cz;
  cell.centroid(cx, cy, cz);
  ctx->centroids.push_back(static_cast<float>(px + cx));
  ctx->centroids.push_back(static_cast<float>(py + cy));
  ctx->centroids.push_back(static_cast<float>(pz + cz));
  ctx->volumes.push_back(static_cast<float>(cell.volume()));

  std::vector<double> verts;
  std::vector<int> faces;
  cell.vertices(px, py, pz, verts);
  cell.face_vertices(faces);

  const int nverts = static_cast<int>(verts.size() / 3);
  std::set<std::pair<int, int>> emitted_edges;
  int f = 0;
  while (f < static_cast<int>(faces.size())) {
    const int nv = faces[f++];
    if (nv < 3 || f + nv > static_cast<int>(faces.size())) break;

    auto vert_at = [&](int local, float out[3]) {
      const int vi = faces[f + local];
      if (vi < 0 || vi >= nverts) {
        out[0] = out[1] = out[2] = 0.f;
        return;
      }
      out[0] = static_cast<float>(verts[vi * 3]);
      out[1] = static_cast<float>(verts[vi * 3 + 1]);
      out[2] = static_cast<float>(verts[vi * 3 + 2]);
    };

    float a[3], b[3], c[3];
    vert_at(0, a);
    for (int i = 1; i < nv - 1; i++) {
      vert_at(i, b);
      vert_at(i + 1, c);
      const float abx = b[0] - a[0], aby = b[1] - a[1], abz = b[2] - a[2];
      const float acx = c[0] - a[0], acy = c[1] - a[1], acz = c[2] - a[2];
      float nx = aby * acz - abz * acy;
      float ny = abz * acx - abx * acz;
      float nz = abx * acy - aby * acx;
      const float len = std::sqrt(nx * nx + ny * ny + nz * nz);
      if (len > 1e-12f) {
        nx /= len; ny /= len; nz /= len;
      }

      const std::uint32_t base = static_cast<std::uint32_t>(ctx->vertices.size() / 3);
      ctx->vertices.insert(ctx->vertices.end(), {a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]});
      ctx->normals.insert(ctx->normals.end(), {nx, ny, nz, nx, ny, nz, nx, ny, nz});
      ctx->indices.insert(ctx->indices.end(), {base, base + 1, base + 2});
      const std::uint32_t cid = static_cast<std::uint32_t>(cell_index);
      ctx->cell_ids.insert(ctx->cell_ids.end(), {cid, cid, cid});
    }

    const std::uint32_t cid = static_cast<std::uint32_t>(cell_index);
    for (int i = 0; i < nv; i++) {
      const int va = faces[f + i], vb = faces[f + (i + 1) % nv];
      if (!emitted_edges.insert(std::minmax(va, vb)).second) continue;
      float p0[3], p1[3];
      vert_at(i, p0);
      vert_at((i + 1) % nv, p1);
      ctx->edges.insert(ctx->edges.end(), {p0[0], p0[1], p0[2], p1[0], p1[1], p1[2]});
      ctx->edge_cell_ids.insert(ctx->edge_cell_ids.end(), {cid, cid});
    }

    f += nv;
  }
}

template<class CON>
static int extract_cells(VoroContext *ctx, CON *con) {
  clear_mesh(ctx);
  voro::voronoicell cell;
  voro::c_loop_all cl(*con);
  int cell_index = 0;
  if (cl.start()) do {
    if (!con->compute_cell(cell, cl)) continue;
    double px, py, pz;
    cl.pos(px, py, pz);
    ctx->seed_ids.push_back(static_cast<std::uint32_t>(cl.pid()));
    append_cell(ctx, cell, px, py, pz, cell_index);
    cell_index++;
  } while (cl.inc());
  ctx->n_cells = cell_index;
  return cell_index;
}

static void recreate_container(VoroContext *ctx) {
  delete ctx->con;
  delete ctx->con_poly;
  ctx->con = nullptr;
  ctx->con_poly = nullptr;

  const bool periodic = ctx->mode == MODE_PERIODIC;
  if (ctx->mode == MODE_RADICAL) {
    ctx->con_poly = new voro::container_poly(
      ctx->ax, ctx->bx, ctx->ay, ctx->by, ctx->az, ctx->bz,
      ctx->nx, ctx->ny, ctx->nz,
      false, false, false,
      32
    );
    return;
  }

  ctx->con = new voro::container(
    ctx->ax, ctx->bx, ctx->ay, ctx->by, ctx->az, ctx->bz,
    ctx->nx, ctx->ny, ctx->nz,
    periodic, periodic, periodic,
    32
  );
  if (ctx->mode == MODE_SPHERE && ctx->sphere) {
    ctx->con->add_wall(ctx->sphere);
  }
}

static void clamp_point(VoroContext *ctx, double &x, double &y, double &z) {
  if (ctx->mode == MODE_PERIODIC) return;

  if (ctx->mode == MODE_SPHERE) {
    const double rmax = std::max(0.05, ctx->sphere_r * 0.92);
    const double len = std::sqrt(x * x + y * y + z * z);
    if (len > rmax && len > 1e-9) {
      const double s = rmax / len;
      x *= s; y *= s; z *= s;
    }
    return;
  }

  const double eps = 1e-4;
  x = std::min(ctx->bx - eps, std::max(ctx->ax + eps, x));
  y = std::min(ctx->by - eps, std::max(ctx->ay + eps, y));
  z = std::min(ctx->bz - eps, std::max(ctx->az + eps, z));
}

extern "C" {

EMSCRIPTEN_KEEPALIVE
VoroContext *voro_create(
  float ax, float bx, float ay, float by, float az, float bz,
  int nx, int ny, int nz,
  int mode
) {
  if (nx < 1) nx = 1;
  if (ny < 1) ny = 1;
  if (nz < 1) nz = 1;
  if (mode < MODE_BOX || mode > MODE_SPHERE) mode = MODE_BOX;

  VoroContext *ctx = new VoroContext();
  ctx->ax = ax; ctx->bx = bx;
  ctx->ay = ay; ctx->by = by;
  ctx->az = az; ctx->bz = bz;
  ctx->nx = nx; ctx->ny = ny; ctx->nz = nz;
  ctx->mode = mode;
  ctx->sphere_r = std::min(bx, std::min(by, bz)) * 0.92;
  ctx->con = nullptr;
  ctx->con_poly = nullptr;
  ctx->sphere = nullptr;
  ctx->n_cells = 0;

  if (mode == MODE_SPHERE) {
    ctx->sphere = new voro::wall_sphere(0.0, 0.0, 0.0, ctx->sphere_r);
  }
  recreate_container(ctx);
  return ctx;
}

EMSCRIPTEN_KEEPALIVE
void voro_destroy(VoroContext *ctx) {
  if (!ctx) return;
  delete ctx->con;
  delete ctx->con_poly;
  delete ctx->sphere;
  delete ctx;
}

EMSCRIPTEN_KEEPALIVE
void voro_set_sphere_radius(VoroContext *ctx, float r) {
  if (!ctx || ctx->mode != MODE_SPHERE) return;
  const double nr = std::max(0.2, static_cast<double>(r));
  if (std::fabs(nr - ctx->sphere_r) < 1e-3) return;
  ctx->sphere_r = nr;
  delete ctx->sphere;
  ctx->sphere = new voro::wall_sphere(0.0, 0.0, 0.0, ctx->sphere_r);
  recreate_container(ctx);
}

EMSCRIPTEN_KEEPALIVE
int voro_compute(VoroContext *ctx, const float *xyz, int n) {
  if (!ctx || n <= 0 || !xyz) {
    if (ctx) ctx->n_cells = 0;
    return 0;
  }

  if (ctx->mode == MODE_RADICAL) {
    if (!ctx->con_poly) return 0;
    ctx->con_poly->clear();
    for (int i = 0; i < n; i++) {
      double x = xyz[i * 3], y = xyz[i * 3 + 1], z = xyz[i * 3 + 2];
      clamp_point(ctx, x, y, z);
      ctx->con_poly->put(i, x, y, z, 0.18);
    }
    return extract_cells(ctx, ctx->con_poly);
  }

  if (!ctx->con) return 0;
  ctx->con->clear();
  for (int i = 0; i < n; i++) {
    double x = xyz[i * 3], y = xyz[i * 3 + 1], z = xyz[i * 3 + 2];
    clamp_point(ctx, x, y, z);
    ctx->con->put(i, x, y, z);
  }
  return extract_cells(ctx, ctx->con);
}

EMSCRIPTEN_KEEPALIVE
int voro_compute_weighted(VoroContext *ctx, const float *xyz, const float *radii, int n) {
  if (!ctx || ctx->mode != MODE_RADICAL || !ctx->con_poly || n <= 0 || !xyz || !radii) {
    if (ctx) ctx->n_cells = 0;
    return 0;
  }
  ctx->con_poly->clear();
  for (int i = 0; i < n; i++) {
    double x = xyz[i * 3], y = xyz[i * 3 + 1], z = xyz[i * 3 + 2];
    clamp_point(ctx, x, y, z);
    const double r = std::max(0.02, static_cast<double>(radii[i]));
    ctx->con_poly->put(i, x, y, z, r);
  }
  return extract_cells(ctx, ctx->con_poly);
}

EMSCRIPTEN_KEEPALIVE int voro_n_cells(VoroContext *ctx) {
  return ctx ? ctx->n_cells : 0;
}
EMSCRIPTEN_KEEPALIVE int voro_n_vertices(VoroContext *ctx) {
  return ctx ? static_cast<int>(ctx->vertices.size() / 3) : 0;
}
EMSCRIPTEN_KEEPALIVE int voro_n_indices(VoroContext *ctx) {
  return ctx ? static_cast<int>(ctx->indices.size()) : 0;
}
EMSCRIPTEN_KEEPALIVE int voro_n_edge_floats(VoroContext *ctx) {
  return ctx ? static_cast<int>(ctx->edges.size()) : 0;
}

EMSCRIPTEN_KEEPALIVE const float *voro_vertices(VoroContext *ctx) {
  return ctx && !ctx->vertices.empty() ? ctx->vertices.data() : nullptr;
}
EMSCRIPTEN_KEEPALIVE const float *voro_normals(VoroContext *ctx) {
  return ctx && !ctx->normals.empty() ? ctx->normals.data() : nullptr;
}
EMSCRIPTEN_KEEPALIVE const std::uint32_t *voro_indices(VoroContext *ctx) {
  return ctx && !ctx->indices.empty() ? ctx->indices.data() : nullptr;
}
EMSCRIPTEN_KEEPALIVE const std::uint32_t *voro_cell_ids(VoroContext *ctx) {
  return ctx && !ctx->cell_ids.empty() ? ctx->cell_ids.data() : nullptr;
}
EMSCRIPTEN_KEEPALIVE const float *voro_edges(VoroContext *ctx) {
  return ctx && !ctx->edges.empty() ? ctx->edges.data() : nullptr;
}
EMSCRIPTEN_KEEPALIVE const std::uint32_t *voro_edge_cell_ids(VoroContext *ctx) {
  return ctx && !ctx->edge_cell_ids.empty() ? ctx->edge_cell_ids.data() : nullptr;
}
EMSCRIPTEN_KEEPALIVE const std::uint32_t *voro_seed_ids(VoroContext *ctx) {
  return ctx && !ctx->seed_ids.empty() ? ctx->seed_ids.data() : nullptr;
}
EMSCRIPTEN_KEEPALIVE const float *voro_centroids(VoroContext *ctx) {
  return ctx && !ctx->centroids.empty() ? ctx->centroids.data() : nullptr;
}
EMSCRIPTEN_KEEPALIVE const float *voro_volumes(VoroContext *ctx) {
  return ctx && !ctx->volumes.empty() ? ctx->volumes.data() : nullptr;
}

}  // extern "C"
