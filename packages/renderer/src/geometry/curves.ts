export type Point2 = readonly [number, number];
export const TAU = Math.PI * 2;
export function gcd(a: number, b: number): number {
  a = Math.abs(Math.round(a));
  b = Math.abs(Math.round(b));
  while (b) {
    const r = a % b;
    a = b;
    b = r;
  }
  return a || 1;
}
export function rosePeriod(n: number, d: number): number {
  const g = gcd(n, d);
  n /= g;
  d /= g;
  return (n % 2 === 1 && d % 2 === 1 ? Math.PI : TAU) * d;
}
export function rosePoint(
  t: number,
  n: number,
  d: number,
  amplitude = 1,
): Point2 {
  const r = amplitude * Math.cos((n / d) * t);
  return [r * Math.cos(t), r * Math.sin(t)];
}
export function roulettePeriod(R: number, r: number): number {
  return (TAU * r) / gcd(R, r);
}
export function roulettePoint(
  t: number,
  R: number,
  r: number,
  d: number,
  inside = false,
): Point2 {
  const base = inside ? R - r : R + r,
    ratio = base / r;
  return inside
    ? [
        base * Math.cos(t) + d * Math.cos(ratio * t),
        base * Math.sin(t) - d * Math.sin(ratio * t),
      ]
    : [
        base * Math.cos(t) - d * Math.cos(ratio * t),
        base * Math.sin(t) - d * Math.sin(ratio * t),
      ];
}
/** Even integer m closes for independent n2/n3. Odd m requires n2=n3 (a=b=1). */
export function superRadius(
  t: number,
  m: number,
  n1: number,
  n2: number,
  n3: number,
): number {
  return Math.pow(
    Math.max(
      1e-12,
      Math.abs(Math.cos((m * t) / 4)) ** n2 +
        Math.abs(Math.sin((m * t) / 4)) ** n3,
    ),
    -1 / n1,
  );
}
/** Subdivide by chord error; the seed partition also resolves high-frequency loops. */
export function sampleCurve(
  fn: (t: number) => Point2,
  start: number,
  end: number,
  seedSegments: number,
  tolerance: number,
  maxSegments: number,
  emit: (a: Point2, b: Point2, t: number) => void,
): number {
  let count = 0;
  const visit = (
    a: Point2,
    b: Point2,
    t0: number,
    t1: number,
    depth: number,
    budget: number,
  ): void => {
    const tm = (t0 + t1) / 2,
      m = fn(tm),
      error = Math.hypot(m[0] - (a[0] + b[0]) / 2, m[1] - (a[1] + b[1]) / 2);
    if (error > tolerance && depth < 8 && budget >= 2) {
      const firstBudget = Math.floor(budget / 2);
      visit(a, m, t0, tm, depth + 1, firstBudget);
      visit(m, b, tm, t1, depth + 1, budget - firstBudget);
    } else {
      emit(a, b, tm);
      count++;
    }
  };
  const seeds = Math.min(maxSegments, Math.max(8, Math.ceil(seedSegments)));
  let a = fn(start);
  for (let i = 1; i <= seeds; i++) {
    const budget = Math.max(
        1,
        Math.floor((maxSegments - count) / (seeds - i + 1)),
      ),
      t = start + ((end - start) * i) / seeds,
      b = fn(t);
    visit(a, b, start + ((end - start) * (i - 1)) / seeds, t, 0, budget);
    a = b;
  }
  return count;
}
