/** Unit S³ fiber followed by an isometric complex rotation. */
export function hopfLift(
  theta: number,
  phi: number,
  t: number,
  twist: number,
): [number, number, number, number] {
  const a = Math.cos(theta / 2),
    b = Math.sin(theta / 2),
    c = Math.cos(twist),
    s = Math.sin(twist);
  const x = a * Math.cos(t),
    y = a * Math.sin(t),
    z = b * Math.cos(t + phi),
    w = b * Math.sin(t + phi);
  return [x * c - z * s, y * c - w * s, x * s + z * c, y * s + w * c];
}
export function projectHopf(
  point: readonly number[],
  minimumDenominator = 0.025,
): [number, number, number] | null {
  const denominator = 1 - point[3];
  return denominator < minimumDenominator
    ? null
    : [point[0] / denominator, point[1] / denominator, point[2] / denominator];
}
