/** Prescribed incompressible Fourier flow, v=(∂yψ,−∂xψ), curl(v)=−∇²ψ. */
export function streamField(
  x: number,
  y: number,
  phase: number,
  octaves: number,
): [number, number, number] {
  let vx = 0,
    vy = 0,
    curl = 0;
  for (let i = 0; i < octaves; i++) {
    const kx = i + 1,
      ky = i % 2 ? i + 2 : i + 1,
      a = 1 / (kx * kx + ky * ky),
      sx = Math.sin(kx * x + phase * (1 + i * 0.07)),
      cx = Math.cos(kx * x + phase * (1 + i * 0.07)),
      sy = Math.sin(ky * y - phase * 0.7 + i),
      cy = Math.cos(ky * y - phase * 0.7 + i);
    vx += a * ky * sx * cy;
    vy -= a * kx * cx * sy;
    curl += a * (kx * kx + ky * ky) * sx * sy;
  }
  return [vx, vy, curl];
}
/** Magnetic dipole B=(3r(m·r)/r²−m)/r³, omitting the common μ0/4π factor. */
export function dipoleField(
  x: number,
  y: number,
  mx: number,
  my: number,
): [number, number] {
  const r2 = x * x + y * y;
  if (r2 < 1e-8) return [0, 0];
  const scale = 1 / (r2 * Math.sqrt(r2)),
    dot = mx * x + my * y;
  return [((3 * x * dot) / r2 - mx) * scale, ((3 * y * dot) / r2 - my) * scale];
}
