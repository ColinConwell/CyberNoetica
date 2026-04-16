import * as THREE from 'three';
import { MessageBus } from '@cybernoetica/core';
import type { AudioFeatures, BusMessage, Unsubscribe } from '@cybernoetica/core';
import { EMASmoothing } from '../../smoothing.js';
import type { Visualizer, VisualizerMetadata } from '../types.js';
import { registerVisualizer } from '../registry.js';

/**
 * Peter de Jong attractor -- the "true" four-parameter variant.
 *
 * Discrete 2D map (de Jong, 1983):
 *
 *   x_{n+1} = sin(a * y_n) - cos(b * x_n)
 *   y_{n+1} = sin(c * x_n) - cos(d * y_n)
 *
 * Distinct from Clifford (no cross-coupling of a/b) and Hopalong.
 * De Jong orbits produce softly-shaded, fabric-like density fields
 * with long filament arcs that feel hand-drawn. Four independent
 * coefficients give a larger morph space than Clifford's two.
 *
 * Audio mapping:
 *   bass  -> paramA breathing (dominant morph)
 *   flux  -> paramB tweaks (spectral texture)
 *   mids  -> paramC/D micro-jitter
 *   rms   -> overall luminance
 *   beat  -> randomized jolts to all four coefficients
 */

const dejongMetadata: VisualizerMetadata = {
  type: 'dejong',
  label: 'De Jong Attractor',
  description: 'Peter de Jong strange attractor density field',
  usesPerspective: false,
  params: [
    // Appearance
    { key: 'paramA', label: 'Param A', min: -3.0, max: 3.0, step: 0.01, initial: 1.4, category: 'appearance', description: 'De Jong coefficient A' },
    { key: 'paramB', label: 'Param B', min: -3.0, max: 3.0, step: 0.01, initial: -2.3, category: 'appearance', description: 'De Jong coefficient B' },
    { key: 'paramC', label: 'Param C', min: -3.0, max: 3.0, step: 0.01, initial: 2.4, category: 'appearance', description: 'De Jong coefficient C' },
    { key: 'paramD', label: 'Param D', min: -3.0, max: 3.0, step: 0.01, initial: -2.1, category: 'appearance', description: 'De Jong coefficient D' },
    { key: 'iterations', label: 'Detail', min: 60, max: 360, step: 10, initial: 200, category: 'appearance', description: 'Iteration count per pixel' },
    { key: 'colorSpeed', label: 'Color Cycle', min: 0.0, max: 1.0, step: 0.05, initial: 0.2, category: 'appearance' },
    { key: 'brightness', label: 'Brightness', min: 0.3, max: 3.0, step: 0.1, initial: 1.3, category: 'appearance' },
    { key: 'hueShift', label: 'Hue Shift', min: 0.0, max: 1.0, step: 0.01, initial: 0.55, category: 'appearance', description: 'Base palette hue' },
    // Audio mapping
    { key: 'bassToParams', label: 'Bass \u2192 Shape', min: 0.0, max: 2.0, step: 0.1, initial: 1.0, category: 'audio-mapping', description: 'Bass breathes attractor coefficients' },
    { key: 'midToColor', label: 'Mid \u2192 Color', min: 0.0, max: 2.0, step: 0.1, initial: 1.0, category: 'audio-mapping', description: 'Mids drive color palette shift' },
    { key: 'rmsToGlow', label: 'RMS \u2192 Glow', min: 0.0, max: 2.0, step: 0.1, initial: 1.0, category: 'audio-mapping', description: 'Volume drives overall luminosity' },
    { key: 'beatToJolt', label: 'Beat \u2192 Jolt', min: 0.0, max: 2.0, step: 0.1, initial: 1.0, category: 'audio-mapping', description: 'Beats cause parameter jolts' },
  ],
  viewport: { pan: true, zoom: true, orbit: false },
  viewStateFields: [
    { key: 'zoom', label: 'Zoom', min: 0.1, max: 5.0, step: 0.05 },
    { key: 'panX', label: 'Pan X', min: -3, max: 3, step: 0.05 },
    { key: 'panY', label: 'Pan Y', min: -3, max: 3, step: 0.05 },
  ],
};

export class DeJongVisualizer implements Visualizer {
  readonly metadata = dejongMetadata;

  private unsub: Unsubscribe;
  private latestFeatures: AudioFeatures | null = null;
  private time = 0;

  private userParams: Record<string, number> = {
    paramA: 1.4,
    paramB: -2.3,
    paramC: 2.4,
    paramD: -2.1,
    iterations: 200,
    colorSpeed: 0.2,
    brightness: 1.3,
    hueShift: 0.55,
    bassToParams: 1.0,
    midToColor: 1.0,
    rmsToGlow: 1.0,
    beatToJolt: 1.0,
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

  private joltA = 0;
  private joltB = 0;
  private joltC = 0;
  private joltD = 0;
  private joltDecay = new EMASmoothing(0.08);

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
    this.joltDecay.reset(0);
  }

  attach(scene: THREE.Scene): void {
    this.material = new THREE.ShaderMaterial({
      vertexShader: VERTEX_SHADER,
      fragmentShader: FRAGMENT_SHADER,
      uniforms: {
        u_time: { value: 0.0 },
        u_resolution: { value: new THREE.Vector2(1920, 1080) },
        u_zoom: { value: 1.0 },
        u_pan: { value: new THREE.Vector2(0, 0) },
        u_a: { value: 1.4 },
        u_b: { value: -2.3 },
        u_c: { value: 2.4 },
        u_d: { value: -2.1 },
        u_iterations: { value: 200.0 },
        u_brightness: { value: 1.3 },
        u_colorSpeed: { value: 0.2 },
        u_hueShift: { value: 0.55 },
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

      if (f.beatOnset && this.userParams.beatToJolt > 0) {
        const strength = 0.12 * this.userParams.beatToJolt;
        this.joltA = (Math.random() - 0.5) * strength;
        this.joltB = (Math.random() - 0.5) * strength;
        this.joltC = (Math.random() - 0.5) * strength;
        this.joltD = (Math.random() - 0.5) * strength;
        this.joltDecay.reset(1.0);
      }
    } else {
      this.smoothers.beatPulse.update(0.0);
    }

    this.joltDecay.update(0.0);
    const joltMul = this.joltDecay.value;

    const bass = this.smoothers.bass.value;
    const bassM = this.userParams.bassToParams;
    const flux = this.smoothers.spectralFlux.value;
    const mid = this.smoothers.mid.value;

    const a = this.userParams.paramA + bass * 0.22 * bassM + this.joltA * joltMul;
    const b = this.userParams.paramB + flux * 0.18 * bassM + this.joltB * joltMul;
    const c = this.userParams.paramC + mid * 0.15 * bassM + this.joltC * joltMul;
    const d = this.userParams.paramD - bass * 0.18 * bassM + this.joltD * joltMul;

    if (this.material) {
      const u = this.material.uniforms;
      u.u_time.value = this.time;
      u.u_zoom.value = this._zoom;
      u.u_pan.value.set(this._panX, this._panY);
      u.u_a.value = a;
      u.u_b.value = b;
      u.u_c.value = c;
      u.u_d.value = d;
      u.u_iterations.value = this.userParams.iterations;
      u.u_brightness.value = this.userParams.brightness;
      u.u_colorSpeed.value = this.userParams.colorSpeed;
      u.u_hueShift.value = this.userParams.hueShift + this.smoothers.mid.value * 0.2 * this.userParams.midToColor;
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
    if (key in this.userParams) {
      this.userParams[key] = value;
    }
  }

  getViewState(): Record<string, number> {
    return {
      zoom: this._zoom,
      panX: this._panX,
      panY: this._panY,
    };
  }

  setViewState(partial: Record<string, number>): void {
    if ('zoom' in partial) {
      this._zoom = Math.max(0.1, Math.min(5.0, partial.zoom));
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
  metadata: dejongMetadata,
  create: (bus) => new DeJongVisualizer(bus),
});

// ── Shaders ────────────────────────────────────────────

const VERTEX_SHADER = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position, 1.0);
  }
`;

const FRAGMENT_SHADER = /* glsl */ `
  precision highp float;

  #define PI 3.14159265359

  uniform float u_time;
  uniform vec2 u_resolution;
  uniform float u_zoom;
  uniform vec2 u_pan;
  uniform float u_a;
  uniform float u_b;
  uniform float u_c;
  uniform float u_d;
  uniform float u_iterations;
  uniform float u_brightness;
  uniform float u_colorSpeed;
  uniform float u_hueShift;
  uniform float u_bass;
  uniform float u_mid;
  uniform float u_high;
  uniform float u_rms;
  uniform float u_spectralCentroid;
  uniform float u_beatPulse;

  varying vec2 vUv;

  vec3 hsv2rgb(vec3 c) {
    vec4 K = vec4(1.0, 2.0 / 3.0, 1.0 / 3.0, 3.0);
    vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
    return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
  }

  void main() {
    vec2 uv = (gl_FragCoord.xy - 0.5 * u_resolution) / min(u_resolution.x, u_resolution.y);

    // De Jong attractor lives roughly in [-2, 2] square
    float scale = 4.5 / u_zoom;
    vec2 target = uv * scale + u_pan;

    float density = 0.0;
    float colorAccum = 0.0;
    int iters = int(u_iterations);

    // Multiple seed orbits with small offsets
    for (int seed = 0; seed < 4; seed++) {
      float seedF = float(seed);
      float x = sin(seedF * 1.23 + u_time * 0.03) * 0.25;
      float y = cos(seedF * 2.71 + u_time * 0.05) * 0.25;

      for (int i = 0; i < 360; i++) {
        if (i >= iters) break;

        // Peter de Jong map:
        //   x' = sin(a*y) - cos(b*x)
        //   y' = sin(c*x) - cos(d*y)
        float nx = sin(u_a * y) - cos(u_b * x);
        float ny = sin(u_c * x) - cos(u_d * y);
        x = nx;
        y = ny;

        // Proximity density contribution
        vec2 p = vec2(x, y);
        float dist = length(p - target);
        float contribution = exp(-dist * dist * 55.0 * u_zoom * u_zoom);
        density += contribution;

        float iterFrac = float(i) / float(iters);
        colorAccum += contribution * iterFrac;
      }
    }

    density /= float(iters) * 0.2;
    colorAccum = density > 0.001 ? colorAccum / (density * float(iters) * 0.2) : 0.0;

    float logDensity = log(1.0 + density * 18.0 * u_brightness);

    float hue = fract(
      u_hueShift
      + colorAccum * 0.6
      + u_time * u_colorSpeed * 0.05
      + u_spectralCentroid * 0.15
    );
    float sat = 0.5 + 0.4 * (1.0 - exp(-density * 2.0));
    float val = logDensity * (0.7 + u_rms * 0.6);

    val += u_beatPulse * 0.18 * logDensity;
    val += u_high * 0.2 * density * exp(-density);

    vec3 color = hsv2rgb(vec3(hue, sat, clamp(val, 0.0, 1.0)));

    // Soft background tint (indigo-black)
    vec3 bg = vec3(0.008, 0.012, 0.028);
    color = max(color, bg);

    // Vignette
    float aspect = u_resolution.x / u_resolution.y;
    vec2 screenUv = gl_FragCoord.xy / u_resolution;
    float vignette = 1.0 - 0.32 * length((screenUv - 0.5) * vec2(aspect, 1.0));
    color *= vignette;

    // Reinhard tone mapping
    color = color / (1.0 + color);

    gl_FragColor = vec4(color, 1.0);
  }
`;
