/** Reference scalar rules used by numerical tests and mirrored in the GPU solver. */
export function lifeRule(alive: boolean, neighbors: number): number {
  return neighbors === 3 || (alive && neighbors === 2) ? 1 : 0;
}
export function grayScottStep(
  u: number,
  v: number,
  lapU: number,
  lapV: number,
  feed: number,
  kill: number,
  dt = 0.25,
): [number, number] {
  const reaction = u * v * v;
  return [
    u + dt * (lapU - reaction + feed * (1 - u)),
    v + dt * (0.5 * lapV + reaction - (feed + kill) * v),
  ];
}
export function gridStep(
  state: Float32Array,
  size: number,
  kind: 'life' | 'reaction',
  feed = 0.0367,
  kill = 0.0649,
): Float32Array {
  const next = new Float32Array(state.length);
  const at = (x: number, y: number, channel: number) =>
    state[(((y + size) % size) * size + ((x + size) % size)) * 2 + channel];
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const index = (y * size + x) * 2;
      const u = state[index];
      const v = state[index + 1];
      if (kind === 'life') {
        let count = 0;
        for (let dy = -1; dy <= 1; dy++)
          for (let dx = -1; dx <= 1; dx++)
            if (dx || dy) count += at(x + dx, y + dy, 0);
        next[index] = lifeRule(u > 0.5, count);
      } else {
        const lap = (channel: number) =>
          -at(x, y, channel) +
          0.2 *
            (at(x - 1, y, channel) +
              at(x + 1, y, channel) +
              at(x, y - 1, channel) +
              at(x, y + 1, channel)) +
          0.05 *
            (at(x - 1, y - 1, channel) +
              at(x + 1, y - 1, channel) +
              at(x - 1, y + 1, channel) +
              at(x + 1, y + 1, channel));
        const updated = grayScottStep(u, v, lap(0), lap(1), feed, kill);
        next[index] = updated[0];
        next[index + 1] = updated[1];
      }
    }
  return next;
}
