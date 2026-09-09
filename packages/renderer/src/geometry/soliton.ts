/** u=2∂x² log τ, τ=1+e^η1+e^η2+A12 e^(η1+η2), ηj=2kj(x−4kj²t−xj). */
export function twoSoliton(
  x: number,
  t: number,
  k1 = 0.9,
  k2 = 0.5,
  x1 = -8,
  x2 = -2,
): number {
  const eta1 = 2 * k1 * (x - 4 * k1 * k1 * t - x1),
    eta2 = 2 * k2 * (x - 4 * k2 * k2 * t - x2);
  const interaction = ((k1 - k2) / (k1 + k2)) ** 2;
  const exponents = [
      0,
      eta1,
      eta2,
      eta1 + eta2 + Math.log(Math.max(1e-30, interaction)),
    ],
    slopes = [0, 2 * k1, 2 * k2, 2 * (k1 + k2)];
  const maximum = Math.max(...exponents);
  let weight = 0,
    first = 0,
    second = 0;
  for (let i = 0; i < 4; i++) {
    const w = Math.exp(exponents[i] - maximum);
    weight += w;
    first += w * slopes[i];
    second += w * slopes[i] ** 2;
  }
  return Math.max(0, 2 * (second / weight - (first / weight) ** 2));
}
