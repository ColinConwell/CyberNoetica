import { seededRandom } from '../timing.js';
import type { TransportMap } from './types.js';

const distance = (
  a: Float32Array,
  i: number,
  b: Float32Array,
  j: number,
): number =>
  (a[i * 3] - b[j * 3]) ** 2 +
  (a[i * 3 + 1] - b[j * 3 + 1]) ** 2 +
  (a[i * 3 + 2] - b[j * 3 + 2]) ** 2;
export function assignmentCost(
  a: Float32Array,
  b: Float32Array,
  map: Uint32Array,
): number {
  let sum = 0;
  for (let i = 0; i < map.length; i++) sum += distance(a, i, b, map[i]);
  return sum / Math.max(1, map.length);
}
export function isPermutation(map: Uint32Array, n = map.length): boolean {
  if (map.length !== n) return false;
  const seen = new Uint8Array(n);
  for (const i of map) {
    if (i >= n || seen[i]) return false;
    seen[i] = 1;
  }
  return true;
}
export function projectionTransport(
  a: Float32Array,
  b: Float32Array,
  seed = 1,
): TransportMap {
  const started = performance.now(),
    n = a.length / 3;
  if (
    !Number.isInteger(n) ||
    n < 1 ||
    a.length !== b.length ||
    n > 8192 ||
    !a.every(Number.isFinite) ||
    !b.every(Number.isFinite)
  )
    throw new Error('Transport needs equal finite clouds of 1–8192 samples');
  const random = seededRandom(seed),
    av = new Float64Array(n),
    bv = new Float64Array(n);
  let best = Infinity,
    indices = new Uint32Array(n);
  for (let p = 0; p < 7; p++) {
    const direction =
      p < 3
        ? [Number(p === 0), Number(p === 1), Number(p === 2)]
        : [random() * 2 - 1, random() * 2 - 1, random() * 2 - 1];
    for (let i = 0; i < n; i++) {
      av[i] =
        a[i * 3] * direction[0] +
        a[i * 3 + 1] * direction[1] +
        a[i * 3 + 2] * direction[2];
      bv[i] =
        b[i * 3] * direction[0] +
        b[i * 3 + 1] * direction[1] +
        b[i * 3 + 2] * direction[2];
    }
    const ai = Uint32Array.from({ length: n }, (_, i) => i),
      bi = ai.slice(),
      candidate = new Uint32Array(n);
    ai.sort((i, j) => av[i] - av[j] || i - j);
    bi.sort((i, j) => bv[i] - bv[j] || i - j);
    for (let i = 0; i < n; i++) candidate[ai[i]] = bi[i];
    const cost = assignmentCost(a, b, candidate);
    if (cost < best) {
      best = cost;
      indices = candidate;
    }
  }
  return {
    indices,
    cost: best,
    baselineCost: best,
    residual: 0,
    backend: 'projection',
    milliseconds: performance.now() - started,
  };
}

/** Sparse balanced entropic transport. Projection edges guarantee feasible support.
 * Rounding uses improving permutation swaps, preserving both empirical marginals.
 * It is a bounded approximation, not a full optimal-assignment solver.
 */
export function refineTransport(
  a: Float32Array,
  b: Float32Array,
  base: TransportMap,
  budgetMs = 180,
): TransportMap {
  const started = performance.now(),
    n = base.indices.length,
    k = 25;
  const targets = new Uint32Array(n * k),
    logKernel = new Float64Array(n * k);
  const columns: Array<number[]> = Array.from({ length: n }, () => []);
  const orders = [0, 1, 2].map((axis) =>
    Uint32Array.from({ length: n }, (_, i) => i).sort(
      (i, j) => b[i * 3 + axis] - b[j * 3 + axis] || i - j,
    ),
  );
  const epsilon = Math.max(0.002, base.cost * 0.15);
  for (let i = 0; i < n; i++) {
    const neighbors = new Set<number>([base.indices[i]]);
    for (let axis = 0; axis < 3; axis++) {
      const order = orders[axis];
      let lo = 0,
        hi = n;
      while (lo < hi) {
        const m = (lo + hi) >>> 1;
        if (b[order[m] * 3 + axis] < a[i * 3 + axis]) lo = m + 1;
        else hi = m;
      }
      for (let j = Math.max(0, lo - 4); j < Math.min(n, lo + 4); j++)
        neighbors.add(order[j]);
    }
    const nearest = [...neighbors]
      .sort((j, l) => distance(a, i, b, j) - distance(a, i, b, l) || j - l)
      .slice(0, k);
    if (!nearest.includes(base.indices[i]))
      nearest[nearest.length - 1] = base.indices[i];
    for (let q = 0; q < k; q++) {
      const edge = i * k + q,
        j = nearest[q];
      targets[edge] = j ?? base.indices[i];
      logKernel[edge] =
        j === undefined ? -Infinity : -distance(a, i, b, j) / epsilon;
      if (j !== undefined) columns[j].push(edge);
    }
  }
  const u = new Float64Array(n),
    v = new Float64Array(n);
  let residual = Infinity;
  for (let iteration = 0; iteration < 48; iteration++) {
    if (performance.now() - started > budgetMs)
      return {
        ...base,
        milliseconds: base.milliseconds + performance.now() - started,
      };
    for (let i = 0; i < n; i++) {
      let max = -Infinity;
      for (let q = 0; q < k; q++) {
        const e = i * k + q;
        max = Math.max(max, logKernel[e] + v[targets[e]]);
      }
      let sum = 0;
      for (let q = 0; q < k; q++) {
        const e = i * k + q;
        sum += Math.exp(logKernel[e] + v[targets[e]] - max);
      }
      u[i] = -max - Math.log(sum);
    }
    for (let j = 0; j < n; j++) {
      let max = -Infinity;
      for (const e of columns[j])
        max = Math.max(max, logKernel[e] + u[Math.floor(e / k)]);
      let sum = 0;
      for (const e of columns[j])
        sum += Math.exp(logKernel[e] + u[Math.floor(e / k)] - max);
      v[j] = -max - Math.log(sum);
    }
    if (iteration % 4 === 3) {
      residual = 0;
      for (let i = 0; i < n; i++) {
        let sum = 0;
        for (let q = 0; q < k; q++) {
          const e = i * k + q;
          sum += Math.exp(logKernel[e] + u[i] + v[targets[e]]);
        }
        residual = Math.max(residual, Math.abs(sum - 1));
      }
      if (residual < 1e-3) break;
    }
  }
  if (!Number.isFinite(residual) || residual > 0.05)
    return {
      ...base,
      residual,
      milliseconds: base.milliseconds + performance.now() - started,
    };
  const map = base.indices.slice(),
    owner = new Uint32Array(n);
  for (let i = 0; i < n; i++) owner[map[i]] = i;
  // High-probability sparse proposals can improve a bijection without losing points.
  for (let pass = 0; pass < 3; pass++)
    for (let i = 0; i < n; i++) {
      let chosen = map[i],
        score = -Infinity;
      for (let q = 0; q < k; q++) {
        const e = i * k + q,
          s = logKernel[e] + v[targets[e]];
        if (s > score) {
          score = s;
          chosen = targets[e];
        }
      }
      const other = owner[chosen],
        old = map[i];
      if (
        distance(a, i, b, chosen) + distance(a, other, b, old) + 1e-12 <
        distance(a, i, b, old) + distance(a, other, b, chosen)
      ) {
        map[i] = chosen;
        map[other] = old;
        owner[chosen] = i;
        owner[old] = other;
      }
    }
  const cost = assignmentCost(a, b, map);
  return cost < base.cost && isPermutation(map)
    ? {
        indices: map,
        cost,
        baselineCost: base.cost,
        residual,
        backend: 'sparse-sinkhorn',
        milliseconds: base.milliseconds + performance.now() - started,
      }
    : {
        ...base,
        residual,
        milliseconds: base.milliseconds + performance.now() - started,
      };
}
