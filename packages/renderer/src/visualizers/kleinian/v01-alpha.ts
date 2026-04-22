import * as THREE from 'three';
import { MessageBus } from '@cybernoetica/core';
import type { AudioFeatures, BusMessage, Unsubscribe } from '@cybernoetica/core';
import { EMASmoothing } from '../../smoothing.js';
import type { Visualizer, VisualizerMetadata } from '../types.js';
import { registerVisualizer } from '../registry.js';

const kleinianMetadata: VisualizerMetadata = {
  type: 'kleinian',
  label: 'Kleinian',
  description: "Indra's Pearls — Möbius-group limit sets",
  usesPerspective: false,
  params: [
    { key: 'paramRe', label: 'Trace Re', min: 1.5, max: 2.5, step: 0.01, initial: 1.96, category: 'appearance', description: 'Real part of generator trace' },
    { key: 'paramIm', label: 'Trace Im', min: -0.5, max: 0.5, step: 0.01, initial: 0.0, category: 'appearance', description: 'Imaginary part of generator trace' },
    { key: 'iterations', label: 'Iterations', min: 30, max: 200, step: 5, initial: 80, category: 'appearance', description: 'Max orbit iterations' },
    { key: 'colorSpeed', label: 'Color Speed', min: 0.0, max: 1.0, step: 0.05, initial: 0.2, category: 'appearance', description: 'Hue cycling rate' },
    { key: 'brightness', label: 'Brightness', min: 0.5, max: 3.0, step: 0.1, initial: 1.5, category: 'appearance', description: 'Overall brightness' },
    { key: 'bassToTrace', label: 'Bass -> Trace', min: 0.0, max: 2.0, step: 0.1, initial: 1.0, category: 'audio-mapping', description: 'Bass modulates generator trace' },
    { key: 'midToColor', label: 'Mid -> Color', min: 0.0, max: 2.0, step: 0.1, initial: 1.0, category: 'audio-mapping', description: 'Mids shift palette hue' },
    { key: 'highToDetail', label: 'High -> Detail', min: 0.0, max: 2.0, step: 0.1, initial: 1.0, category: 'audio-mapping', description: 'Highs increase iteration clarity' },
    { key: 'rmsToGlow', label: 'RMS -> Glow', min: 0.0, max: 2.0, step: 0.1, initial: 1.0, category: 'audio-mapping', description: 'Volume drives glow' },
    { key: 'beatToPulse', label: 'Beat -> Pulse', min: 0.0, max: 2.0, step: 0.1, initial: 1.0, category: 'audio-mapping', description: 'Beats flash the fractal' },
  ],
  viewport: { pan: true, zoom: true, orbit: false },
  viewStateFields: [
    { key: 'centerX', label: 'Center X', min: -4, max: 4, step: 0.05 },
    { key: 'centerY', label: 'Center Y', min: -4, max: 4, step: 0.05 },
    { key: 'zoom', label: 'Zoom', min: 0.1, max: 10.0, step: 0.05 },
  ],
};

export class KleinianVisualizer implements Visualizer {
  readonly metadata = kleinianMetadata;

  private unsub: Unsubscribe;
  private latestFeatures: AudioFeatures | null = null;
  private time = 0;

  private userParams: Record<string, number> = {
    paramRe: 1.96,
    paramIm: 0.0,
    iterations: 80,
    colorSpeed: 0.2,
    brightness: 1.5,
    bassToTrace: 1.0,
    midToColor: 1.0,
    highToDetail: 1.0,
    rmsToGlow: 1.0,
    beatToPulse: 1.0,
  };

  private _centerX = 0;
  private _centerY = 0;
  private _zoom = 1.0;

  private smoothers = {
    bass: new EMASmoothing(0.12),
    mid: new EMASmoothing(0.18),
    high: new EMASmoothing(0.25),
    rms: new EMASmoothing(0.15),
    beatPulse: new EMASmoothing(0.4),
    spectralCentroid: new EMASmoothing(0.08),
  };

  private material: THREE.ShaderMaterial | null = null;
  private mesh: THREE.Mesh | null = null;

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

  attach(scene: THREE.Scene): void {
    this.material = new THREE.RawShaderMaterial({
      vertexShader: VERTEX_SHADER,
      fragmentShader: FRAGMENT_SHADER,
      uniforms: {
        u_time: { value: 0.0 },
        u_resolution: { value: new THREE.Vector2(1920, 1080) },
        u_zoom: { value: 1.0 },
        u_center: { value: new THREE.Vector2(0, 0) },
        u_paramRe: { value: 1.96 },
        u_paramIm: { value: 0.0 },
        u_iterations: { value: 80.0 },
        u_colorSpeed: { value: 0.2 },
        u_brightness: { value: 1.5 },
        u_bass: { value: 0.0 },
        u_mid: { value: 0.0 },
        u_high: { value: 0.0 },
        u_rms: { value: 0.1 },
        u_beatPulse: { value: 0.0 },
        u_spectralCentroid: { value: 0.5 },
      },
      transparent: true,
    });

    const geometry = new THREE.PlaneGeometry(2, 2);
    this.mesh = new THREE.Mesh(geometry, this.material);
    scene.add(this.mesh);
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

    if (this.material) {
      const u = this.material.uniforms;
      u.u_time.value = this.time;
      u.u_zoom.value = this._zoom;
      u.u_center.value.set(this._centerX, this._centerY);
      u.u_paramRe.value = this.userParams.paramRe
        + (this.smoothers.bass.value - 0.2) * 0.15 * this.userParams.bassToTrace;
      u.u_paramIm.value = this.userParams.paramIm
        + this.smoothers.mid.value * 0.1 * this.userParams.bassToTrace;
      u.u_iterations.value = this.userParams.iterations;
      u.u_colorSpeed.value = this.userParams.colorSpeed;
      u.u_brightness.value = this.userParams.brightness
        + this.smoothers.rms.value * 0.5 * this.userParams.rmsToGlow;
      u.u_bass.value = this.smoothers.bass.value;
      u.u_mid.value = this.smoothers.mid.value;
      u.u_high.value = this.smoothers.high.value;
      u.u_rms.value = this.smoothers.rms.value;
      u.u_beatPulse.value = this.smoothers.beatPulse.value * this.userParams.beatToPulse;
      u.u_spectralCentroid.value = this.smoothers.spectralCentroid.value;
    }
  }

  setResolution(width: number, height: number): void {
    if (this.material) this.material.uniforms.u_resolution.value.set(width, height);
  }

  setUserParam(key: string, value: number): void {
    if (key in this.userParams) this.userParams[key] = value;
  }

  getViewState(): Record<string, number> {
    return { centerX: this._centerX, centerY: this._centerY, zoom: this._zoom };
  }

  setViewState(partial: Record<string, number>): void {
    if ('centerX' in partial) this._centerX = Math.max(-4, Math.min(4, partial.centerX));
    if ('centerY' in partial) this._centerY = Math.max(-4, Math.min(4, partial.centerY));
    if ('zoom' in partial) this._zoom = Math.max(0.1, Math.min(10.0, partial.zoom));
  }

  dispose(): void {
    this.unsub();
    this.material?.dispose();
    this.mesh?.geometry.dispose();
  }
}

registerVisualizer({
  metadata: kleinianMetadata,
  create: (bus) => new KleinianVisualizer(bus),
});

const VERTEX_SHADER = /* glsl */ `
  attribute vec3 position;
  attribute vec2 uv;
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position, 1.0);
  }
`;

const FRAGMENT_SHADER = /* glsl */ `
  precision highp float;

  #define PI 3.14159265359
  #define TAU 6.28318530718

  uniform float u_time;
  uniform vec2 u_resolution;
  uniform float u_zoom;
  uniform vec2 u_center;
  uniform float u_paramRe;
  uniform float u_paramIm;
  uniform float u_iterations;
  uniform float u_colorSpeed;
  uniform float u_brightness;
  uniform float u_bass;
  uniform float u_mid;
  uniform float u_high;
  uniform float u_rms;
  uniform float u_beatPulse;
  uniform float u_spectralCentroid;

  varying vec2 vUv;

  #include <cyber_hsv2rgb>

  // Complex multiplication
  vec2 cmul(vec2 a, vec2 b) {
    return vec2(a.x*b.x - a.y*b.y, a.x*b.y + a.y*b.x);
  }

  // Complex division
  vec2 cdiv(vec2 a, vec2 b) {
    float d = dot(b, b);
    return vec2(a.x*b.x + a.y*b.y, a.y*b.x - a.x*b.y) / d;
  }

  // Möbius transformation: (az + b) / (cz + d)
  vec2 mobius(vec2 z, vec2 a, vec2 b, vec2 c, vec2 d) {
    return cdiv(cmul(a, z) + b, cmul(c, z) + d);
  }

  // Circle inversion: invert z through circle with center c and radius r
  vec2 circleInvert(vec2 z, vec2 center, float radius) {
    vec2 diff = z - center;
    float d2 = dot(diff, diff);
    return center + radius * radius * diff / d2;
  }

  void main() {
    vec2 uv = (gl_FragCoord.xy - 0.5 * u_resolution) / min(u_resolution.x, u_resolution.y);
    uv = uv / u_zoom + u_center;

    // Scale to interesting region
    uv *= 2.5;

    float ta_re = u_paramRe;
    float ta_im = u_paramIm;

    // Kleinian group limit set via iterated circle inversions
    // Using a Schottky group with two pairs of circles
    float minDist = 1e10;
    float orbitTrap = 1e10;
    int maxIter = int(u_iterations);

    vec2 z = uv;
    float totalAngle = 0.0;
    int escapeIter = maxIter;

    // Define four inversion circles based on the trace parameter
    float r1 = 1.0 / ta_re;
    float r2 = r1 * 0.8;
    float sep = ta_re * 0.6;

    vec2 c1 = vec2(sep, ta_im);
    vec2 c2 = vec2(-sep, -ta_im);
    vec2 c3 = vec2(ta_im, sep * 0.7);
    vec2 c4 = vec2(-ta_im, -sep * 0.7);

    float rad1 = r1 + u_bass * 0.1;
    float rad2 = r2 + u_mid * 0.08;

    for (int i = 0; i < 200; i++) {
      if (i >= maxIter) break;

      vec2 prevZ = z;

      // Apply circle inversions — pick the one that moves z the most
      vec2 z1 = circleInvert(z, c1, rad1);
      vec2 z2 = circleInvert(z, c2, rad1);
      vec2 z3 = circleInvert(z, c3, rad2);
      vec2 z4 = circleInvert(z, c4, rad2);

      // Fold: reflect to keep z in a fundamental domain
      if (z.x > 0.0) {
        z = (z.y > 0.0) ? z1 : z2;
      } else {
        z = (z.y > 0.0) ? z3 : z4;
      }

      // Reflect across axes to maintain symmetry
      z = abs(z);
      z -= vec2(sep * 0.5);

      totalAngle += atan(z.y - prevZ.y, z.x - prevZ.x);

      float d = length(z);
      minDist = min(minDist, d);
      orbitTrap = min(orbitTrap, length(z - vec2(0.0, 0.5)));

      if (d > 50.0) {
        escapeIter = i;
        break;
      }
    }

    // Coloring
    float iterRatio = float(escapeIter) / float(maxIter);
    float hue = u_time * u_colorSpeed
      + iterRatio * 0.5
      + u_mid * 0.3 * u_spectralCentroid
      + totalAngle * 0.02;

    float sat = 0.7 + u_high * 0.3;
    float val = 0.0;

    if (escapeIter < maxIter) {
      float logDist = log(minDist + 1.0);
      val = pow(1.0 - iterRatio, 1.2) * u_brightness;
      val *= 0.6 + 0.4 * sin(logDist * 8.0);
    } else {
      float trapVal = 1.0 - clamp(orbitTrap * 1.5, 0.0, 1.0);
      val = trapVal * u_brightness * 0.8;
      hue += 0.3;
      sat = 0.6;
    }

    float minDistGlow = exp(-minDist * 3.0);
    val += minDistGlow * 0.4;
    val *= 0.85 + u_rms * 0.4;
    val += u_beatPulse * 0.2;

    vec3 color = hsv2rgb(vec3(fract(hue), sat, clamp(val, 0.0, 1.0)));

    float edgeGlow = exp(-minDist * 4.0) * 0.5;
    color += edgeGlow * hsv2rgb(vec3(fract(hue + 0.15), 0.9, 1.0));

    // Vignette
    float aspect = u_resolution.x / u_resolution.y;
    vec2 screenUv = gl_FragCoord.xy / u_resolution;
    float vignette = 1.0 - 0.35 * length((screenUv - 0.5) * vec2(aspect, 1.0));
    color *= vignette;

    // Tone mapping
    color = color / (0.9 + color);

    gl_FragColor = vec4(color, 1.0);
  }
`;
