import * as THREE from 'three';
import { MessageBus } from '@cybernoetica/core';
import type { AudioFeatures, BusMessage, Unsubscribe } from '@cybernoetica/core';
import { EMASmoothing } from '../../smoothing.js';
import type { Visualizer, VisualizerMetadata } from '../types.js';
import { registerVisualizer } from '../registry.js';

/**
 * Hopalong attractor variant -- Barry Martin's Hopalong.
 *
 * Discrete 2D map discovered by Barry Martin (popularized by A.K. Dewdney
 * in Scientific American, 1986):
 *
 *   x_{n+1} = y_n - sign(x_n) * sqrt(|b * x_n - c|)
 *   y_{n+1} = a - x_n
 *
 * Unlike Clifford/De Jong, Hopalong produces angular, filament-like
 * structures with crisp concentric-curve patterns. Audio reactivity
 * gently breathes the a/b/c coefficients while maintaining orbit stability.
 */

const hopalongMetadata: VisualizerMetadata = {
  type: 'hopalong',
  label: 'Hopalong',
  description: "Barry Martin's Hopalong attractor",
  usesPerspective: false,
  params: [
    // Appearance
    { key: 'paramA', label: 'Param A', min: -8.0, max: 8.0, step: 0.05, initial: 2.0, category: 'appearance', description: 'Hopalong coefficient A' },
    { key: 'paramB', label: 'Param B', min: -8.0, max: 8.0, step: 0.05, initial: 1.0, category: 'appearance', description: 'Hopalong coefficient B' },
    { key: 'paramC', label: 'Param C', min: -8.0, max: 8.0, step: 0.05, initial: 0.0, category: 'appearance', description: 'Hopalong coefficient C' },
    { key: 'iterations', label: 'Detail', min: 80, max: 400, step: 10, initial: 220, category: 'appearance', description: 'Iteration count per pixel' },
    { key: 'colorSpeed', label: 'Color Cycle', min: 0.0, max: 1.0, step: 0.05, initial: 0.25, category: 'appearance' },
    { key: 'brightness', label: 'Brightness', min: 0.3, max: 3.0, step: 0.1, initial: 1.4, category: 'appearance' },
    { key: 'hueShift', label: 'Hue Shift', min: 0.0, max: 1.0, step: 0.01, initial: 0.15, category: 'appearance', description: 'Base palette hue' },
    // Audio mapping
    { key: 'bassToParams', label: 'Bass \u2192 Shape', min: 0.0, max: 2.0, step: 0.1, initial: 1.0, category: 'audio-mapping', description: 'Bass breathes attractor coefficients' },
    { key: 'midToColor', label: 'Mid \u2192 Color', min: 0.0, max: 2.0, step: 0.1, initial: 1.0, category: 'audio-mapping', description: 'Mids drive color palette shift' },
    { key: 'rmsToGlow', label: 'RMS \u2192 Glow', min: 0.0, max: 2.0, step: 0.1, initial: 1.0, category: 'audio-mapping', description: 'Volume drives overall luminosity' },
    { key: 'beatToJolt', label: 'Beat \u2192 Jolt', min: 0.0, max: 2.0, step: 0.1, initial: 1.0, category: 'audio-mapping', description: 'Beats cause parameter jolts' },
  ],
  viewport: { pan: true, zoom: true, orbit: false },
  viewStateFields: [
    { key: 'zoom', label: 'Zoom', min: 0.1, max: 5.0, step: 0.05 },
    { key: 'panX', label: 'Pan X', min: -8, max: 8, step: 0.1 },
    { key: 'panY', label: 'Pan Y', min: -8, max: 8, step: 0.1 },
  ],
};

export class HopalongVisualizer implements Visualizer {
  readonly metadata = hopalongMetadata;

  private unsub: Unsubscribe;
  private latestFeatures: AudioFeatures | null = null;
  private time = 0;

  private userParams: Record<string, number> = {
    paramA: 2.0,
    paramB: 1.0,
    paramC: 0.0,
    iterations: 220,
    colorSpeed: 0.25,
    brightness: 1.4,
    hueShift: 0.15,
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
        u_a: { value: 2.0 },
        u_b: { value: 1.0 },
        u_c: { value: 0.0 },
        u_iterations: { value: 220.0 },
        u_brightness: { value: 1.4 },
        u_colorSpeed: { value: 0.25 },
        u_hueShift: { value: 0.15 },
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
        const strength = 0.2 * this.userParams.beatToJolt;
        this.joltA = (Math.random() - 0.5) * strength;
        this.joltB = (Math.random() - 0.5) * strength;
        this.joltC = (Math.random() - 0.5) * strength;
        this.joltDecay.reset(1.0);
      }
    } else {
      this.smoothers.beatPulse.update(0.0);
    }

    this.joltDecay.update(0.0);
    const joltMul = this.joltDecay.value;

    const bass = this.smoothers.bass.value;
    const bassM = this.userParams.bassToParams;

    const a = this.userParams.paramA + bass * 0.3 * bassM + this.joltA * joltMul;
    const b = this.userParams.paramB + this.smoothers.spectralFlux.value * 0.15 * bassM + this.joltB * joltMul;
    const c = this.userParams.paramC - bass * 0.2 * bassM + this.joltC * joltMul;

    if (this.material) {
      const u = this.material.uniforms;
      u.u_time.value = this.time;
      u.u_zoom.value = this._zoom;
      u.u_pan.value.set(this._panX, this._panY);
      u.u_a.value = a;
      u.u_b.value = b;
      u.u_c.value = c;
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
      this._panX = Math.max(-8, Math.min(8, partial.panX));
      this.viewOverrides.panX = true;
    }
    if ('panY' in partial) {
      this._panY = Math.max(-8, Math.min(8, partial.panY));
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
  metadata: hopalongMetadata,
  create: (bus) => new HopalongVisualizer(bus),
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

    // Map screen to attractor space -- Hopalong orbits are larger than Clifford
    float scale = 10.0 / u_zoom;
    vec2 target = uv * scale + u_pan;

    float density = 0.0;
    float colorAccum = 0.0;
    int iters = int(u_iterations);

    // Multiple seed orbits with small offsets
    for (int seed = 0; seed < 4; seed++) {
      float seedF = float(seed);
      float x = sin(seedF * 1.7 + u_time * 0.04) * 0.2;
      float y = cos(seedF * 2.3 + u_time * 0.06) * 0.2;

      for (int i = 0; i < 400; i++) {
        if (i >= iters) break;

        // Hopalong map (Barry Martin):
        //   x' = y - sign(x) * sqrt(|b*x - c|)
        //   y' = a - x
        float nx = y - sign(x) * sqrt(abs(u_b * x - u_c));
        float ny = u_a - x;
        x = nx;
        y = ny;

        // Proximity density -- scale factor smaller since orbit is larger
        vec2 p = vec2(x, y);
        float dist = length(p - target);
        float contribution = exp(-dist * dist * 12.0 * u_zoom * u_zoom);
        density += contribution;

        float iterFrac = float(i) / float(iters);
        colorAccum += contribution * iterFrac;
      }
    }

    density /= float(iters) * 0.2;
    colorAccum = density > 0.001 ? colorAccum / (density * float(iters) * 0.2) : 0.0;

    float logDensity = log(1.0 + density * 12.0 * u_brightness);

    float hue = fract(
      u_hueShift
      + colorAccum * 0.7
      + u_time * u_colorSpeed * 0.05
      + u_spectralCentroid * 0.15
    );
    float sat = 0.55 + 0.35 * (1.0 - exp(-density * 2.0));
    float val = logDensity * (0.65 + u_rms * 0.7);

    val += u_beatPulse * 0.18 * logDensity;
    val += u_high * 0.22 * density * exp(-density);

    vec3 color = hsv2rgb(vec3(hue, sat, clamp(val, 0.0, 1.0)));

    // Deep blue-black background tint
    vec3 bg = vec3(0.012, 0.006, 0.025);
    color = max(color, bg);

    // Vignette
    float aspect = u_resolution.x / u_resolution.y;
    vec2 screenUv = gl_FragCoord.xy / u_resolution;
    float vignette = 1.0 - 0.35 * length((screenUv - 0.5) * vec2(aspect, 1.0));
    color *= vignette;

    // Reinhard tone mapping
    color = color / (1.0 + color);

    gl_FragColor = vec4(color, 1.0);
  }
`;
