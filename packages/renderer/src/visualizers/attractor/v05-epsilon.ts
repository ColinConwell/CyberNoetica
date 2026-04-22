import * as THREE from 'three';
import { MessageBus } from '@cybernoetica/core';
import type { AudioFeatures, BusMessage, Unsubscribe } from '@cybernoetica/core';
import { EMASmoothing } from '../../smoothing.js';
import type { Visualizer, VisualizerMetadata } from '../types.js';
import { registerVisualizer } from '../registry.js';

/**
 * Aizawa Attractor — 3D continuous-time chaotic system (Aizawa, 1982).
 *
 * A six-parameter ODE producing a striking torus-like structure with
 * a vertical spike:
 *
 *   dx/dt = (z - b) x  - d y
 *   dy/dt =  d x  + (z - b) y
 *   dz/dt = c + a z - z³/3 - (x² + y²)(1 + e z) + f z x³
 *
 * Standard params: a=0.95, b=0.7, c=0.6, d=3.5, e=0.25, f=0.1
 *
 * Rendered as a point-density projection: we integrate many orbits and
 * accumulate their projections onto a 2D plane with configurable rotation.
 *
 * Audio mapping:
 *   bass  -> parameter a (torus inflation)
 *   mid   -> parameter d (rotation speed)
 *   rms   -> luminance
 *   beat  -> projection angle kick
 *   centroid -> hue shift
 */

const aizawaMetadata: VisualizerMetadata = {
  type: 'aizawa',
  label: 'Aizawa Attractor',
  description: '3D chaotic torus with vertical spike',
  usesPerspective: false,
  params: [
    { key: 'paramA', label: 'Param a', min: 0.5, max: 1.5, step: 0.01, initial: 0.95, category: 'appearance', description: 'Linear z-growth' },
    { key: 'paramB', label: 'Param b', min: 0.3, max: 1.2, step: 0.01, initial: 0.7, category: 'appearance', description: 'Radial damping' },
    { key: 'paramC', label: 'Param c', min: 0.1, max: 1.2, step: 0.01, initial: 0.6, category: 'appearance', description: 'Constant drive' },
    { key: 'paramD', label: 'Param d', min: 1.0, max: 6.0, step: 0.1, initial: 3.5, category: 'appearance', description: 'Rotation coupling' },
    { key: 'paramE', label: 'Param e', min: 0.0, max: 0.8, step: 0.01, initial: 0.25, category: 'appearance', description: 'z-radial coupling' },
    { key: 'paramF', label: 'Param f', min: 0.0, max: 0.5, step: 0.01, initial: 0.1, category: 'appearance', description: 'Cubic nonlinearity' },
    { key: 'trailLength', label: 'Trail Length', min: 200, max: 1200, step: 50, initial: 600, category: 'appearance', description: 'Integration steps' },
    { key: 'brightness', label: 'Brightness', min: 0.3, max: 3.0, step: 0.1, initial: 1.5, category: 'appearance' },
    { key: 'hueShift', label: 'Hue Shift', min: 0.0, max: 1.0, step: 0.01, initial: 0.72, category: 'appearance' },
    { key: 'viewAngle', label: 'View Angle', min: 0.0, max: 6.28, step: 0.05, initial: 0.4, category: 'appearance', description: 'Projection rotation around Y' },
    { key: 'bassToShape', label: 'Bass → Shape', min: 0.0, max: 2.0, step: 0.1, initial: 1.0, category: 'audio-mapping', description: 'Bass inflates the torus' },
    { key: 'midToSpin', label: 'Mid → Spin', min: 0.0, max: 2.0, step: 0.1, initial: 1.0, category: 'audio-mapping', description: 'Mids accelerate rotation' },
    { key: 'rmsToGlow', label: 'RMS → Glow', min: 0.0, max: 2.0, step: 0.1, initial: 1.0, category: 'audio-mapping', description: 'Volume drives brightness' },
    { key: 'beatToAngle', label: 'Beat → Angle', min: 0.0, max: 2.0, step: 0.1, initial: 1.0, category: 'audio-mapping', description: 'Beats kick view angle' },
    { key: 'centroidToHue', label: 'Centroid → Hue', min: 0.0, max: 2.0, step: 0.1, initial: 0.8, category: 'audio-mapping', description: 'Spectral centroid shifts palette' },
  ],
  viewport: { pan: true, zoom: true, orbit: false },
  viewStateFields: [
    { key: 'zoom', label: 'Zoom', min: 0.2, max: 4.0, step: 0.05 },
    { key: 'panX', label: 'Pan X', min: -3, max: 3, step: 0.05 },
    { key: 'panY', label: 'Pan Y', min: -3, max: 3, step: 0.05 },
  ],
};

export class AizawaVisualizer implements Visualizer {
  readonly metadata = aizawaMetadata;

  private unsub: Unsubscribe;
  private latestFeatures: AudioFeatures | null = null;
  private time = 0;
  private angleAccum = 0;

  private userParams: Record<string, number> = {
    paramA: 0.95,
    paramB: 0.7,
    paramC: 0.6,
    paramD: 3.5,
    paramE: 0.25,
    paramF: 0.1,
    trailLength: 600,
    brightness: 1.5,
    hueShift: 0.72,
    viewAngle: 0.4,
    bassToShape: 1.0,
    midToSpin: 1.0,
    rmsToGlow: 1.0,
    beatToAngle: 1.0,
    centroidToHue: 0.8,
  };

  private _zoom = 1.0;
  private _panX = 0.0;
  private _panY = 0.0;
  private viewOverrides: Record<string, boolean> = {};

  private smoothers = {
    bass: new EMASmoothing(0.12),
    mid: new EMASmoothing(0.18),
    high: new EMASmoothing(0.25),
    rms: new EMASmoothing(0.15),
    spectralCentroid: new EMASmoothing(0.1),
    spectralFlux: new EMASmoothing(0.2),
    beatPulse: new EMASmoothing(0.45),
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
    this.smoothers.spectralCentroid.reset(0.5);
    this.smoothers.spectralFlux.reset(0);
    this.smoothers.beatPulse.reset(0);
  }

  attach(scene: THREE.Scene): void {
    this.material = new THREE.RawShaderMaterial({
      vertexShader: VERTEX_SHADER,
      fragmentShader: FRAGMENT_SHADER,
      uniforms: {
        u_time: { value: 0.0 },
        u_resolution: { value: new THREE.Vector2(1920, 1080) },
        u_zoom: { value: 1.0 },
        u_pan: { value: new THREE.Vector2(0, 0) },
        u_a: { value: 0.95 },
        u_b: { value: 0.7 },
        u_c: { value: 0.6 },
        u_d: { value: 3.5 },
        u_e: { value: 0.25 },
        u_f: { value: 0.1 },
        u_trailLength: { value: 600.0 },
        u_brightness: { value: 1.5 },
        u_hueShift: { value: 0.72 },
        u_viewAngle: { value: 0.4 },
        u_bass: { value: 0.0 },
        u_mid: { value: 0.0 },
        u_high: { value: 0.0 },
        u_rms: { value: 0.1 },
        u_spectralCentroid: { value: 0.5 },
        u_beatPulse: { value: 0.0 },
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
      this.smoothers.spectralCentroid.update(f.spectralCentroid);
      this.smoothers.spectralFlux.update(f.spectralFlux);
      this.smoothers.beatPulse.update(f.beatOnset ? 1.0 : 0.0);

      if (f.beatOnset && this.userParams.beatToAngle > 0) {
        this.angleAccum += (Math.random() - 0.3) * 0.3 * this.userParams.beatToAngle;
      }
    } else {
      this.smoothers.beatPulse.update(0.0);
    }

    const bass = this.smoothers.bass.value;
    const mid = this.smoothers.mid.value;
    const bassM = this.userParams.bassToShape;
    const midM = this.userParams.midToSpin;

    if (this.material) {
      const u = this.material.uniforms;
      u.u_time.value = this.time;
      u.u_zoom.value = this._zoom;
      u.u_pan.value.set(this._panX, this._panY);
      u.u_a.value = this.userParams.paramA + bass * 0.08 * bassM;
      u.u_b.value = this.userParams.paramB;
      u.u_c.value = this.userParams.paramC;
      u.u_d.value = this.userParams.paramD + mid * 0.4 * midM;
      u.u_e.value = this.userParams.paramE;
      u.u_f.value = this.userParams.paramF;
      u.u_trailLength.value = this.userParams.trailLength;
      u.u_brightness.value = this.userParams.brightness;
      u.u_hueShift.value = this.userParams.hueShift
        + this.smoothers.spectralCentroid.value * 0.15 * this.userParams.centroidToHue;
      u.u_viewAngle.value = this.userParams.viewAngle + this.angleAccum + this.time * 0.05;
      u.u_bass.value = bass;
      u.u_mid.value = this.smoothers.mid.value;
      u.u_high.value = this.smoothers.high.value;
      u.u_rms.value = this.smoothers.rms.value * this.userParams.rmsToGlow;
      u.u_spectralCentroid.value = this.smoothers.spectralCentroid.value;
      u.u_beatPulse.value = this.smoothers.beatPulse.value;
    }
  }

  setResolution(width: number, height: number): void {
    if (this.material) this.material.uniforms.u_resolution.value.set(width, height);
  }

  setUserParam(key: string, value: number): void {
    if (key in this.userParams) this.userParams[key] = value;
  }

  getViewState(): Record<string, number> {
    return { zoom: this._zoom, panX: this._panX, panY: this._panY };
  }

  setViewState(partial: Record<string, number>): void {
    if ('zoom' in partial) {
      this._zoom = Math.max(0.2, Math.min(4.0, partial.zoom));
      this.viewOverrides.zoom = true;
    }
    if ('panX' in partial) {
      this._panX = Math.max(-3, Math.min(3, partial.panX));
      this.viewOverrides.panX = true;
    }
    if ('panY' in partial) {
      this._panY = Math.max(-3, Math.min(3, partial.panY));
      this.viewOverrides.panY = true;
    }
  }

  dispose(): void {
    this.unsub();
    this.material?.dispose();
    this.mesh?.geometry.dispose();
  }
}

registerVisualizer({
  metadata: aizawaMetadata,
  create: (bus) => new AizawaVisualizer(bus),
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
  #define DT 0.008

  uniform float u_time;
  uniform vec2 u_resolution;
  uniform float u_zoom;
  uniform vec2 u_pan;
  uniform float u_a;
  uniform float u_b;
  uniform float u_c;
  uniform float u_d;
  uniform float u_e;
  uniform float u_f;
  uniform float u_trailLength;
  uniform float u_brightness;
  uniform float u_hueShift;
  uniform float u_viewAngle;
  uniform float u_bass;
  uniform float u_mid;
  uniform float u_high;
  uniform float u_rms;
  uniform float u_spectralCentroid;
  uniform float u_beatPulse;

  varying vec2 vUv;

  #include <cyber_hsv2rgb>

  // Project 3D point to 2D with Y-axis rotation
  vec2 project(vec3 p, float angle) {
    float ca = cos(angle);
    float sa = sin(angle);
    float x = p.x * ca - p.z * sa;
    float y = p.y;
    return vec2(x, y);
  }

  // Aizawa ODE derivatives
  vec3 aizawaDerivs(vec3 p) {
    float x = p.x, y = p.y, z = p.z;
    float r2 = x * x + y * y;
    float dx = (z - u_b) * x - u_d * y;
    float dy = u_d * x + (z - u_b) * y;
    float dz = u_c + u_a * z - z * z * z / 3.0 - r2 * (1.0 + u_e * z) + u_f * z * x * x * x;
    return vec3(dx, dy, dz);
  }

  void main() {
    vec2 uv = (gl_FragCoord.xy - 0.5 * u_resolution) / min(u_resolution.x, u_resolution.y);

    float scale = 2.8 / u_zoom;
    vec2 target = uv * scale + u_pan;

    float density = 0.0;
    float colorAccum = 0.0;
    float zAccum = 0.0;
    int steps = int(u_trailLength);

    // Multiple seed points on the attractor
    for (int seed = 0; seed < 3; seed++) {
      float sf = float(seed);
      vec3 pos = vec3(
        0.1 + sin(sf * 2.1 + u_time * 0.01) * 0.05,
        cos(sf * 3.7 + u_time * 0.015) * 0.05,
        sin(sf * 1.3 + u_time * 0.02) * 0.1
      );

      // Warm up the orbit (skip transient)
      for (int w = 0; w < 200; w++) {
        vec3 k1 = aizawaDerivs(pos);
        vec3 k2 = aizawaDerivs(pos + k1 * DT * 0.5);
        pos += k2 * DT;
      }

      for (int i = 0; i < 1200; i++) {
        if (i >= steps) break;

        // RK2 integration
        vec3 k1 = aizawaDerivs(pos);
        vec3 k2 = aizawaDerivs(pos + k1 * DT * 0.5);
        pos += k2 * DT;

        // Clamp to prevent divergence
        pos = clamp(pos, vec3(-3.0), vec3(3.0));

        // Project to 2D
        vec2 projected = project(pos, u_viewAngle);

        float dist = length(projected - target);
        float contribution = exp(-dist * dist * 80.0 * u_zoom * u_zoom);
        density += contribution;

        float iterFrac = float(i) / float(steps);
        colorAccum += contribution * iterFrac;
        zAccum += contribution * (pos.z + 1.5) * 0.25;
      }
    }

    density /= float(steps) * 0.15;
    colorAccum = density > 0.001 ? colorAccum / (density * float(steps) * 0.15) : 0.0;
    zAccum = density > 0.001 ? zAccum / (density * float(steps) * 0.15) : 0.0;

    float logDensity = log(1.0 + density * 15.0 * u_brightness);

    // Z-depth influences hue for pseudo-3D effect
    float hue = fract(
      u_hueShift
      + zAccum * 0.4
      + colorAccum * 0.3
      + u_spectralCentroid * 0.1
    );
    float sat = 0.5 + 0.4 * (1.0 - exp(-density * 1.5));
    float val = logDensity * (0.6 + u_rms * 0.8);

    val += u_beatPulse * 0.2 * logDensity;
    val += u_high * 0.12 * density * exp(-density * 0.5);

    vec3 color = hsv2rgb(vec3(hue, sat, clamp(val, 0.0, 1.0)));

    vec3 bg = vec3(0.005, 0.008, 0.02);
    color = max(color, bg);

    // Vignette
    float aspect = u_resolution.x / u_resolution.y;
    vec2 screenUv = gl_FragCoord.xy / u_resolution;
    float vignette = 1.0 - 0.28 * length((screenUv - 0.5) * vec2(aspect, 1.0));
    color *= vignette;

    color = color / (1.0 + color);

    gl_FragColor = vec4(color, 1.0);
  }
`;
