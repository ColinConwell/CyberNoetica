export interface Circle {
  x: number;
  y: number;
  k: number;
}
/** Descartes reflection: the replacement bend and bend-center are linear. */
export function reflectCircle(
  circles: readonly Circle[],
  index: number,
): Circle {
  let k = 0,
    x = 0,
    y = 0;
  for (let j = 0; j < 4; j++) {
    const coefficient = j === index ? -1 : 2,
      c = circles[j];
    k += coefficient * c.k;
    x += coefficient * c.k * c.x;
    y += coefficient * c.k * c.y;
  }
  return { k, x: x / k, y: y / k };
}
export function apollonianPacking(depth = 6, minRadius = 0.002): Circle[] {
  const initial: Circle[] = [
    { x: 0, y: 0, k: -1 },
    { x: -0.5, y: 0, k: 2 },
    { x: 0.5, y: 0, k: 2 },
    { x: 0, y: 2 / 3, k: 3 },
  ];
  const output = [...initial],
    seen = new Set(
      initial.map(
        (c) => `${c.k.toFixed(6)},${c.x.toFixed(6)},${c.y.toFixed(6)}`,
      ),
    );
  const visit = (quad: Circle[], previous: number, level: number): void => {
    if (level >= depth || output.length > 6000) return;
    for (let i = 0; i < 4; i++) {
      if (i === previous) continue;
      const circle = reflectCircle(quad, i);
      if (circle.k <= 0 || 1 / circle.k < minRadius) continue;
      const key = `${circle.k.toFixed(6)},${circle.x.toFixed(6)},${circle.y.toFixed(6)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      output.push(circle);
      const next = [...quad];
      next[i] = circle;
      visit(next, i, level + 1);
    }
  };
  visit(initial, -1, 0);
  return output;
}
/** Exact image under z ↦ (z+a)/(1+a*z), real |a|<1; circles and tangency are preserved. */
export function diskAutomorphismCircle(
  circle: Circle,
  a: number,
): { x: number; y: number; r: number } {
  const { x, y } = circle,
    r = 1 / Math.abs(circle.k),
    denominator = (1 + a * x) ** 2 + (a * y) ** 2 - a * a * r * r;
  return {
    x: ((x + a) * (1 + a * x) + a * y * y - a * r * r) / denominator,
    y: (y * (1 - a * a)) / denominator,
    r: (r * (1 - a * a)) / Math.abs(denominator),
  };
}
