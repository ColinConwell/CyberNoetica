/** Integer-order Bessel functions on the drum's bounded domain (n <= 9, x < 27).
 * The periodic trapezoidal rule for the integral representation avoids the
 * unstable upward recurrence at small x. Tables are built only on mode changes.
 * https://dlmf.nist.gov/10.9.E2
 */
export function besselJ(n: number, x: number): number {
  if (x === 0) return n === 0 ? 1 : 0;
  const samples = 128;
  let sum = 0;
  for (let i = 0; i < samples; i++) {
    const theta = ((i + 0.5) * Math.PI) / samples;
    sum += Math.cos(n * theta - x * Math.sin(theta));
  }
  return sum / samples;
}

const rootCache = new Map<number, number[]>();

/** First four positive roots, with zero-based radial index. */
export function membraneRoots(n: number): readonly number[] {
  const cached = rootCache.get(n);
  if (cached) return cached;
  const roots: number[] = [];
  let left = Math.max(0.5, n);
  let fLeft = besselJ(n, left);
  while (roots.length < 4) {
    const right = left + 0.25;
    const fRight = besselJ(n, right);
    if (fLeft * fRight < 0) {
      let lo = left;
      let hi = right;
      for (let i = 0; i < 40; i++) {
        const mid = (lo + hi) / 2;
        if (besselJ(n, mid) * fLeft > 0) lo = mid;
        else hi = mid;
      }
      roots.push((lo + hi) / 2);
    }
    left = right;
    fLeft = fRight;
  }
  rootCache.set(n, roots);
  return roots;
}

export const RADIAL_SAMPLES = 1024;

export function membraneModeDescriptor(
  order: number,
  mode: number,
): { order: number; root: number } {
  const radialIndex = Math.floor(mode / 2);
  const angularOrder = order + radialIndex;
  return {
    order: angularOrder,
    root: membraneRoots(angularOrder)[radialIndex],
  };
}

/** Eight RGBA rows: J_n(j_nm r/R), including exact center and fixed rim. */
export function membraneModeTable(rotationalOrder: number): Float32Array {
  const data = new Float32Array(RADIAL_SAMPLES * 8 * 4);
  for (let mode = 0; mode < 8; mode++) {
    const { order: n, root } = membraneModeDescriptor(rotationalOrder, mode);
    for (let i = 0; i < RADIAL_SAMPLES; i++) {
      const offset = (mode * RADIAL_SAMPLES + i) * 4;
      data[offset] =
        i === RADIAL_SAMPLES - 1
          ? 0
          : besselJ(n, (root * i) / (RADIAL_SAMPLES - 1));
      data[offset + 3] = 1;
    }
  }
  return data;
}
