export const SCHOTTKY_CENTERS = [
  [-1.3, 0],
  [1.3, 0],
  [0, -1.3],
  [0, 1.3],
] as const;
/** g(z)=target+r²/(z-source); g^-1 pairs the same circles in reverse. */
export function schottkyMap(
  x: number,
  y: number,
  generator: number,
  radius: number,
): [number, number] {
  const source = SCHOTTKY_CENTERS[generator],
    target = SCHOTTKY_CENTERS[generator ^ 1],
    dx = x - source[0],
    dy = y - source[1],
    scale = (radius * radius) / (dx * dx + dy * dy);
  return [target[0] + scale * dx, target[1] - scale * dy];
}
export function validSchottkyRadius(radius: number): boolean {
  return radius > 0 && 2 * radius < 1.3 * Math.sqrt(2);
}
export function schottkyPoints(output: Float32Array, radius: number): void {
  if (!validSchottkyRadius(radius))
    throw new Error('Schottky defining circles must be disjoint');
  let x = 0,
    y = 0,
    last = 0,
    seed = 731;
  for (let i = -100; i < output.length / 3; i++) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    const generator = ((last ^ 1) + 1 + (seed % 3)) % 4;
    [x, y] = schottkyMap(x, y, generator, radius);
    last = generator;
    if (i >= 0) output.set([x, y, 0], i * 3);
  }
}
