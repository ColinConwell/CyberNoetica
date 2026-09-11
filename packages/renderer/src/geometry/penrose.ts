import type { Point2 } from './curves.js';
export interface RobinsonTriangle {
  type: 0 | 1;
  a: Point2;
  b: Point2;
  c: Point2;
}
const PHI = (1 + Math.sqrt(5)) / 2;
const divide = (a: Point2, b: Point2): Point2 => [
  a[0] + (b[0] - a[0]) / PHI,
  a[1] + (b[1] - a[1]) / PHI,
];
/** Oriented Robinson-triangle substitution; alternating initial chirality supplies matching edges. */
export function penroseTriangles(depth: number): RobinsonTriangle[] {
  let triangles: RobinsonTriangle[] = Array.from({ length: 10 }, (_, i) => {
    let b: Point2 = [
        Math.cos(((2 * i - 1) * Math.PI) / 10),
        Math.sin(((2 * i - 1) * Math.PI) / 10),
      ],
      c: Point2 = [
        Math.cos(((2 * i + 1) * Math.PI) / 10),
        Math.sin(((2 * i + 1) * Math.PI) / 10),
      ];
    if (i % 2 === 0) [b, c] = [c, b];
    return { type: 0, a: [0, 0], b, c };
  });
  for (let level = 0; level < depth; level++) {
    const next: RobinsonTriangle[] = [];
    for (const { type, a, b, c } of triangles) {
      if (type === 0) {
        const p = divide(a, b);
        next.push({ type: 0, a: c, b: p, c: b }, { type: 1, a: p, b: c, c: a });
      } else {
        const q = divide(b, a),
          r = divide(b, c);
        next.push(
          { type: 1, a: r, b: c, c: a },
          { type: 1, a: q, b: r, c: b },
          { type: 0, a: r, b: q, c: a },
        );
      }
    }
    triangles = next;
  }
  return triangles;
}
