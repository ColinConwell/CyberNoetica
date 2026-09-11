export type MapKind = 'clifford' | 'hopalong' | 'dejong' | 'ikeda';
export function mapPoint(
  kind: MapKind,
  x: number,
  y: number,
  p: readonly number[],
): [number, number] {
  const [a, b, c, d] = p;
  if (kind === 'hopalong')
    return [y - Math.sign(x) * Math.sqrt(Math.abs(b * x - c)), a - x];
  if (kind === 'dejong')
    return [
      Math.sin(a * y) - Math.cos(b * x),
      Math.sin(c * x) - Math.cos(d * y),
    ];
  if (kind === 'ikeda') {
    const t = b - c / (1 + x * x + y * y);
    return [
      1 + a * (x * Math.cos(t) - y * Math.sin(t)),
      a * (x * Math.sin(t) + y * Math.cos(t)),
    ];
  }
  return [
    Math.sin(a * y) + c * Math.cos(a * x),
    Math.sin(b * x) + d * Math.cos(b * y),
  ];
}
/** Fixed seeds and burn-in make density comparisons reproducible. Escaped orbits are excluded. */
export function mapTrajectory(
  kind: MapKind,
  parameters: readonly number[],
  output: Float32Array,
  burnIn = 512,
): number {
  let x = 0.173,
    y = 0.217,
    count = 0;
  for (let i = -burnIn; i < output.length / 2; i++) {
    [x, y] = mapPoint(kind, x, y, parameters);
    if (!Number.isFinite(x + y) || Math.abs(x) + Math.abs(y) > 10000) break;
    if (i >= 0) {
      output[count * 2] = x;
      output[count * 2 + 1] = y;
      count++;
    }
  }
  return count;
}
