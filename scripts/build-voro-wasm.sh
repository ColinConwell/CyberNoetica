#!/usr/bin/env bash
# Compile the Voro++ C ABI wrapper to WASM.
# Uses emcc if available, otherwise the emscripten/emsdk Docker image.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SRC="$ROOT/third_party/voro++/src"
WRAP="$ROOT/native/voro-wasm/wrapper.cpp"
OUT_DIR="$ROOT/packages/renderer/wasm/voro"
IMAGE="${EMSDK_IMAGE:-emscripten/emsdk:4.0.10}"

mkdir -p "$OUT_DIR"

SOURCES=(
  "$WRAP"
  "$SRC/cell.cc"
  "$SRC/common.cc"
  "$SRC/v_base.cc"
  "$SRC/container.cc"
  "$SRC/unitcell.cc"
  "$SRC/container_prd.cc"
  "$SRC/pre_container.cc"
  "$SRC/v_compute.cc"
  "$SRC/c_loops.cc"
  "$SRC/wall.cc"
)

EMCC_FLAGS=(
  -O3
  -std=c++17
  -fno-exceptions
  -fno-rtti
  -DVOROPP_VERBOSE=0
  -I "$SRC"
  -s MODULARIZE=1
  -s EXPORT_ES6=1
  -s ENVIRONMENT=web,worker
  -s ALLOW_MEMORY_GROWTH=1
  -s EXPORT_NAME=createVoroModule
  -s EXPORTED_FUNCTIONS=_voro_create,_voro_destroy,_voro_compute,_voro_compute_weighted,_voro_set_sphere_radius,_voro_n_cells,_voro_n_vertices,_voro_n_indices,_voro_n_edge_floats,_voro_vertices,_voro_normals,_voro_indices,_voro_cell_ids,_voro_edges,_voro_edge_cell_ids,_voro_centroids,_voro_volumes,_voro_seed_ids,_malloc,_free
  -s EXPORTED_RUNTIME_METHODS=HEAPF32,HEAPU32
  -o "$OUT_DIR/voro.js"
)

run_emcc() {
  local emcc_bin="$1"
  shift
  "$emcc_bin" "$@"
}

if command -v emcc >/dev/null 2>&1; then
  echo "Building Voro++ WASM with local emcc..."
  run_emcc emcc "${SOURCES[@]}" "${EMCC_FLAGS[@]}"
else
  echo "emcc not on PATH; building Voro++ WASM with Docker ($IMAGE)..."
  docker run --rm \
    -v "$ROOT":/src \
    -w /src \
    "$IMAGE" \
    emcc \
      native/voro-wasm/wrapper.cpp \
      third_party/voro++/src/cell.cc \
      third_party/voro++/src/common.cc \
      third_party/voro++/src/v_base.cc \
      third_party/voro++/src/container.cc \
      third_party/voro++/src/unitcell.cc \
      third_party/voro++/src/container_prd.cc \
      third_party/voro++/src/pre_container.cc \
      third_party/voro++/src/v_compute.cc \
      third_party/voro++/src/c_loops.cc \
      third_party/voro++/src/wall.cc \
      -O3 -std=c++17 -fno-exceptions -fno-rtti -DVOROPP_VERBOSE=0 \
      -I third_party/voro++/src \
      -s MODULARIZE=1 \
      -s EXPORT_ES6=1 \
      -s ENVIRONMENT=web,worker \
      -s ALLOW_MEMORY_GROWTH=1 \
      -s EXPORT_NAME=createVoroModule \
      -s EXPORTED_FUNCTIONS=_voro_create,_voro_destroy,_voro_compute,_voro_compute_weighted,_voro_set_sphere_radius,_voro_n_cells,_voro_n_vertices,_voro_n_indices,_voro_n_edge_floats,_voro_vertices,_voro_normals,_voro_indices,_voro_cell_ids,_voro_edges,_voro_edge_cell_ids,_voro_centroids,_voro_volumes,_voro_seed_ids,_malloc,_free \
      -s EXPORTED_RUNTIME_METHODS=HEAPF32,HEAPU32 \
      -o packages/renderer/wasm/voro/voro.js
fi

ls -lh "$OUT_DIR"
echo "Voro++ WASM written to $OUT_DIR"
