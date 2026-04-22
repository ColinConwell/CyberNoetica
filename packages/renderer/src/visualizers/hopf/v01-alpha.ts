import * as THREE from 'three';
import { MessageBus } from '@cybernoetica/core';
import type { AudioFeatures, BusMessage, Unsubscribe } from '@cybernoetica/core';
import { EMASmoothing } from '../../smoothing.js';
import type { Visualizer, VisualizerMetadata } from '../types.js';
import { registerVisualizer } from '../registry.js';

const FIBER_COUNT = 48;
const POINTS_PER_FIBER = 128;
const TOTAL_VERTICES = FIBER_COUNT * POINTS_PER_FIBER;

const hopfMetadata: VisualizerMetadata = {
  type: 'hopf',
  label: 'Hopf Fibration',
  description: 'Topological fiber bundles from S³ to S²',
  usesPerspective: true,
  params: [
    { key: 'latitude', label: 'Latitude', min: -0.9, max: 0.9, step: 0.05, initial: 0.3, category: 'appearance', description: 'S² latitude of fibers' },
    { key: 'fiberSpread', label: 'Fiber Spread', min: 0.1, max: 1.0, step: 0.05, initial: 0.5, category: 'appearance', description: 'Distribution of fiber latitudes' },
    { key: 'twistSpeed', label: 'Twist Speed', min: 0.0, max: 2.0, step: 0.1, initial: 0.5, category: 'appearance', description: '4D rotation speed' },
    { key: 'lineWidth', label: 'Line Width', min: 1.0, max: 5.0, step: 0.5, initial: 2.0, category: 'appearance', description: 'Fiber line thickness' },
    { key: 'colorShift', label: 'Color Shift', min: 0.0, max: 1.0, step: 0.05, initial: 0.3, category: 'appearance', description: 'Hue cycling speed' },
    { key: 'bassToLatitude', label: 'Bass -> Latitude', min: 0.0, max: 2.0, step: 0.1, initial: 1.0, category: 'audio-mapping', description: 'Bass shifts fiber latitude band' },
    { key: 'midToTwist', label: 'Mid -> Twist', min: 0.0, max: 2.0, step: 0.1, initial: 1.0, category: 'audio-mapping', description: 'Mids drive 4D rotation' },
    { key: 'highToSpread', label: 'High -> Spread', min: 0.0, max: 2.0, step: 0.1, initial: 1.0, category: 'audio-mapping', description: 'Highs expand fiber distribution' },
    { key: 'rmsToGlow', label: 'RMS -> Glow', min: 0.0, max: 2.0, step: 0.1, initial: 1.0, category: 'audio-mapping', description: 'Volume drives brightness' },
    { key: 'beatToPulse', label: 'Beat -> Pulse', min: 0.0, max: 2.0, step: 0.1, initial: 1.0, category: 'audio-mapping', description: 'Beats flash fibers' },
  ],
  viewport: { pan: false, zoom: false, orbit: true },
  viewStateFields: [
    { key: 'orbitAngle', label: 'Orbit', min: -Math.PI, max: Math.PI, step: 0.02 },
    { key: 'elevation', label: 'Elevation', min: -1.2, max: 1.2, step: 0.02 },
    { key: 'distance', label: 'Distance', min: 3, max: 15, step: 0.1 },
  ],
};

export class HopfVisualizer implements Visualizer {
  readonly metadata = hopfMetadata;

  private unsub: Unsubscribe;
  private latestFeatures: AudioFeatures | null = null;
  private time = 0;

  private userParams: Record<string, number> = {
    latitude: 0.3,
    fiberSpread: 0.5,
    twistSpeed: 0.5,
    lineWidth: 2.0,
    colorShift: 0.3,
    bassToLatitude: 1.0,
    midToTwist: 1.0,
    highToSpread: 1.0,
    rmsToGlow: 1.0,
    beatToPulse: 1.0,
  };

  private _orbitAngle = 0;
  private _elevation = 0.4;
  private _distance = 7;

  private smoothers = {
    bass: new EMASmoothing(0.12),
    mid: new EMASmoothing(0.18),
    high: new EMASmoothing(0.25),
    rms: new EMASmoothing(0.15),
    beatPulse: new EMASmoothing(0.4),
    spectralCentroid: new EMASmoothing(0.08),
  };

  private lines: THREE.Line[] = [];
  private positions: Float32Array[] = [];
  private colors: Float32Array[] = [];
  private geometries: THREE.BufferGeometry[] = [];
  private material: THREE.ShaderMaterial | null = null;

  constructor(private bus: MessageBus) {
    this.unsub = bus.subscribe('audio:features', (msg: BusMessage<AudioFeatures>) => {
      this.latestFeatures = msg.payload;
    });
    this.smoothers.bass.reset(0);
    this.smoothers.mid.reset(0);
    this.smoothers.high.reset(0);
    this.smoothers.rms.reset(0.1);
    this.smoothers.beatPulse.reset(0);
    this.smoothers.spectralCentroid.reset(0.5);
  }

  private stereographicProject(x: number, y: number, z: number, w: number): [number, number, number] {
    const denom = 1.0 - w + 0.001;
    return [x / denom, y / denom, z / denom];
  }

  private hopfFiber(
    theta: number, phi: number, fiberParam: number, twist4D: number
  ): [number, number, number] {
    const cosTheta2 = Math.cos(theta / 2);
    const sinTheta2 = Math.sin(theta / 2);

    let z1Re = cosTheta2 * Math.cos(fiberParam);
    let z1Im = cosTheta2 * Math.sin(fiberParam);
    let z2Re = sinTheta2 * Math.cos(fiberParam + phi);
    let z2Im = sinTheta2 * Math.sin(fiberParam + phi);

    const ct = Math.cos(twist4D);
    const st = Math.sin(twist4D);
    const newZ1Re = z1Re * ct - z2Re * st;
    const newZ1Im = z1Im * ct - z2Im * st;
    const newZ2Re = z1Re * st + z2Re * ct;
    const newZ2Im = z1Im * st + z2Im * ct;

    return this.stereographicProject(newZ1Re, newZ1Im, newZ2Re, newZ2Im);
  }

  attach(scene: THREE.Scene): void {
    this.material = new THREE.RawShaderMaterial({
      vertexShader: VERTEX_SHADER,
      fragmentShader: FRAGMENT_SHADER,
      uniforms: {
        u_opacity: { value: 0.85 },
        u_glowIntensity: { value: 1.0 },
        u_beatPulse: { value: 0.0 },
      },
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });

    for (let f = 0; f < FIBER_COUNT; f++) {
      const posArr = new Float32Array(POINTS_PER_FIBER * 3);
      const colArr = new Float32Array(POINTS_PER_FIBER * 3);

      const geom = new THREE.BufferGeometry();
      geom.setAttribute('position', new THREE.BufferAttribute(posArr, 3));
      geom.setAttribute('color', new THREE.BufferAttribute(colArr, 3));

      const line = new THREE.Line(geom, this.material);
      line.frustumCulled = false;

      this.positions.push(posArr);
      this.colors.push(colArr);
      this.geometries.push(geom);
      this.lines.push(line);
      scene.add(line);
    }
  }

  tick(): void {
    this.time += 1 / 60;

    if (this.latestFeatures) {
      const f = this.latestFeatures;
      this.smoothers.bass.update(f.bass);
      this.smoothers.mid.update(f.mid);
      this.smoothers.high.update(f.high);
      this.smoothers.rms.update(f.rms);
      this.smoothers.beatPulse.update(f.beatOnset ? 1.0 : 0.0);
      this.smoothers.spectralCentroid.update(f.spectralCentroid);
    } else {
      this.smoothers.beatPulse.update(0.0);
    }

    const baseLat = this.userParams.latitude
      + (this.smoothers.bass.value - 0.3) * 0.4 * this.userParams.bassToLatitude;
    const spread = this.userParams.fiberSpread
      + this.smoothers.high.value * 0.3 * this.userParams.highToSpread;
    const twistPhase = this.time * this.userParams.twistSpeed
      * (0.5 + this.smoothers.mid.value * 1.0 * this.userParams.midToTwist);
    const glowMult = 0.6 + this.smoothers.rms.value * 0.8 * this.userParams.rmsToGlow;
    const beatFlash = this.smoothers.beatPulse.value * this.userParams.beatToPulse;

    if (this.material) {
      this.material.uniforms.u_glowIntensity.value = glowMult;
      this.material.uniforms.u_beatPulse.value = beatFlash;
    }

    for (let f = 0; f < FIBER_COUNT; f++) {
      const fiberRatio = f / FIBER_COUNT;
      const theta = Math.acos(baseLat + (fiberRatio - 0.5) * 2.0 * spread);
      const phi = fiberRatio * Math.PI * 2.0;

      const hue = (fiberRatio + this.time * this.userParams.colorShift
        + this.smoothers.spectralCentroid.value * 0.3) % 1.0;

      const r = 0.5 + 0.5 * Math.cos(hue * Math.PI * 2.0);
      const g = 0.5 + 0.5 * Math.cos(hue * Math.PI * 2.0 + Math.PI * 2.0 / 3.0);
      const b = 0.5 + 0.5 * Math.cos(hue * Math.PI * 2.0 + Math.PI * 4.0 / 3.0);

      const posArr = this.positions[f];
      const colArr = this.colors[f];

      for (let p = 0; p < POINTS_PER_FIBER; p++) {
        const t = (p / POINTS_PER_FIBER) * Math.PI * 2.0;
        const [x, y, z] = this.hopfFiber(theta, phi, t, twistPhase);

        const scale = 2.0;
        posArr[p * 3] = x * scale;
        posArr[p * 3 + 1] = y * scale;
        posArr[p * 3 + 2] = z * scale;

        const intensity = glowMult + beatFlash * 0.3;
        colArr[p * 3] = r * intensity;
        colArr[p * 3 + 1] = g * intensity;
        colArr[p * 3 + 2] = b * intensity;
      }

      this.geometries[f].attributes.position.needsUpdate = true;
      this.geometries[f].attributes.color.needsUpdate = true;
    }
  }

  setResolution(_w: number, _h: number): void {}

  setUserParam(key: string, value: number): void {
    if (key in this.userParams) this.userParams[key] = value;
  }

  getViewState(): Record<string, number> {
    return {
      orbitAngle: this._orbitAngle,
      elevation: this._elevation,
      distance: this._distance,
    };
  }

  setViewState(partial: Record<string, number>): void {
    if ('orbitAngle' in partial) this._orbitAngle = partial.orbitAngle;
    if ('elevation' in partial) this._elevation = Math.max(-1.2, Math.min(1.2, partial.elevation));
    if ('distance' in partial) this._distance = Math.max(3, Math.min(15, partial.distance));
  }

  dispose(): void {
    this.unsub();
    for (const line of this.lines) {
      line.geometry.dispose();
    }
    this.material?.dispose();
    this.lines = [];
    this.geometries = [];
    this.positions = [];
    this.colors = [];
  }
}

registerVisualizer({
  metadata: hopfMetadata,
  create: (bus) => new HopfVisualizer(bus),
});

const VERTEX_SHADER = /* glsl */ `
  attribute vec3 position;
  attribute vec2 uv;
  attribute vec3 color;
  varying vec3 vColor;
  varying float vDepth;

  void main() {
    vColor = color;
    vec4 mvPos = modelViewMatrix * vec4(position, 1.0);
    vDepth = -mvPos.z;
    gl_Position = projectionMatrix * mvPos;
  }
`;

const FRAGMENT_SHADER = /* glsl */ `
  precision highp float;

  uniform float u_opacity;
  uniform float u_glowIntensity;
  uniform float u_beatPulse;

  varying vec3 vColor;
  varying float vDepth;

  void main() {
    float depthFade = exp(-vDepth * 0.06);
    vec3 col = vColor * u_glowIntensity * depthFade;
    col += vColor * u_beatPulse * 0.2;

    // Soft glow via color boost
    col = col / (0.8 + col);

    gl_FragColor = vec4(col, u_opacity * depthFade);
  }
`;
