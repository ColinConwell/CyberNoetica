import { Curve, Vector3 } from 'three';
import { gcd, TAU } from './curves.js';
/** Components satisfy p*meridian − q*longitude = 2πj on the torus. */
export class TorusLinkCurve extends Curve<Vector3> {
  readonly components: number;
  constructor(
    readonly p: number,
    readonly q: number,
    readonly component = 0,
  ) {
    super();
    this.components = gcd(p, q);
  }
  getPoint(t: number, target = new Vector3()): Vector3 {
    const longitude = ((TAU * this.p) / this.components) * t;
    const meridian =
      ((TAU * this.q) / this.components) * t + (TAU * this.component) / this.p;
    const radius = 1 + 0.4 * Math.cos(meridian);
    return target.set(
      radius * Math.cos(longitude),
      radius * Math.sin(longitude),
      0.4 * Math.sin(meridian),
    );
  }
}
