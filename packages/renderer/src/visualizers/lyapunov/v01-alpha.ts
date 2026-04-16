import * as THREE from 'three';
import { MessageBus } from '@cybernoetica/core';
import type { AudioFeatures, BusMessage, Unsubscribe } from '@cybernoetica/core';
import { EMASmoothing } from '../../smoothing.js';
import type { Visualizer, VisualizerMetadata } from '../types.js';
import { registerVisualizer } from '../registry.js';

/**
 * Markus-Lyapunov fractal (Mario Markus, 1989).
 *
 * For each pixel (a, b) in [0, 4] x [0, 4] we iterate the logistic map
 *
 *   x_{n+1} = r_n * x_n * (1 - x_n)
 *
 * where r_n alternates between "a" and "b" according to a fixed
 * binary sequence (default "AB", classical is "BBBBBBAA" for the
 * famous "zircon-zity" shape). After a warmup phase we accumulate
 * the Lyapunov exponent
 *
 *   lambda = (1/N) sum_n log |r_n * (1 - 2 * x_n)|
 *
 * Stable regions (lambda < 0) glow in warm tones, chaotic regions
 * (lambda > 0) fade to deep blue/black. The resulting shapes look
 * like floating biomechanical cloud-structures and are unique to
 * this construction.
 *
 * Audio mapping:
 *   bass   -> sequence morph (shifts between A/B patterns)
 *   mid    -> warp offset in parameter plane
 *   high   -> sparkle in chaotic regions
 *   rms    -> overall brightness
 *   beat   -> sequence rotation jolt
 */

const lyapunovMetadata: VisualizerMetadata = {
  type: 'lyapunov',
  label: 'Lyapunov Fractal',
  description: 'Markus-Lyapunov fractal -- biomechanical logistic-map basins',
  usesPerspective: false,
  params: [
    // Appearance
    { key: 'sequenceBias', label: 'Sequence Bias', min: 0.0, max: 1.0, step: 0.01, initial: 0.5, category: 'appearance', description: 'Fraction of B in alternation (0=all A, 1=all B)' },
    { key: 'warmup', label: 'Warmup Steps', min: 20, max: 200, step: 10, initial: 80, category: 'appearance', description: 'Burn-in iterations before measuring lambda' },
    { key: 'measure', label: 'Measure Steps', min: 40, max: 300, step: 10, initial: 140, category: 'appearance', description: 'Iterations used to compute lambda' },
    { key: 'brightness', label: 'Brightness', min: 0.3, max: 2.5, step: 0.05, initial: 1.2, category: 'appearance' },
    { key: 'contrast', label: 'Contrast', min: 0.3, max: 2.5, step: 0.05, initial: 1.1, category: 'appearance' },
    { key: 'hueShift', label: 'Hue Shift', min: 0.0, max: 1.0, step: 0.01, initial: 0.06, category: 'appearance', description: 'Palette rotation' },
    // Audio mapping
    { key: 'bassToBias', label: 'Bass \u2192 Bias', min: 0.0, max: 2.0, step: 0.1, initial: 1.0, category: 'audio-mapping', description: 'Bass shifts the A/B bias' },
    { key: 'midToWarp', label: 'Mid \u2192 Warp', min: 0.0, max: 2.0, step: 0.1, initial: 1.0, category: 'audio-mapping', description: 'Mids warp the parameter plane' },
    { key: 'highToSparkle', label: 'High \u2192 Sparkle', min: 0.0, max: 2.0, step: 0.1, initial: 1.0, category: 'audio-mapping', description: 'Highs sparkle in chaos regions' },
    { key: 'rmsToGlow', label: 'RMS \u2192 Glow', min: 0.0, max: 2.0, step: 0.1, initial: 1.0, category: 'audio-mapping', description: 'Volume drives overall brightness' },
    { key: 'beatToJolt', label: 'Beat \u2192 Jolt', min: 0.0, max: 2.0, step: 0.1, initial: 1.0, category: 'audio-mapping', description: 'Beats rotate the sequence phase' },
  ],
  viewport: { pan: true, zoom: true, orbit: false },
  viewStateFields: [
    { key: 'zoom', label: 'Zoom', min: 0.2, max: 8.0, step: 0.05 },
    { key: 'panX', label: 'Pan X', min: 0.0, max: 4.0, step: 0.02 },
    { key: 'panY', label: 'Pan Y', min: 0.0, max: 4.0, step: 0.02 },
  ],
};

export class LyapunovVisualizer implements Visualizer {
  readonly metadata = lyapunovMetadata;

  private unsub: Unsubscribe;
  private latestFeatures: AudioFeatures | null = null;
  private time = 0;
  private sequencePhase = 0;

  private userParams: Record<string, number> = {
    sequenceBias: 0.5,
    warmup: 80,
    measure: 140,
    brightness: 1.2,
    contrast: 1.1,
    hueShift: 0.06,
    bassToBias: 1.0,
    midToWarp: 1.0,
    highToSparkle: 1.0,
    rmsToGlow: 1.0,
    beatToJolt: 1.0,
  };

  private _zoom = 1.0;
  // Default center is the famous ~(3.4, 3.4) region
  private _panX = 2.5;
  private _panY = 2.5;
  private viewOverrides: Record<string, boolean> = {};

  private smoothers = {
    bass: new EMASmoothing(0.1),
    mid: new EMASmoothing(0.15),
    high: new EMASmoothing(0.22),
    rms: new EMASmoothing(0.12),
    beatPulse: new EMASmoothing(0.4),
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
  }

  attach(scene: THREE.Scene): void {
    this.material = new THREE.ShaderMaterial({
      vertexShader: VERTEX_SHADER,
      fragmentShader: FRAGMENT_SHADER,
      uniforms: {
        u_time: { value: 0.0 },
        u_resolution: { value: new THREE.Vector2(1920, 1080) },
        u_zoom: { value: 1.0 },
        u_pan: { value: new THREE.Vector2(2.5, 2.5) },
        u_sequenceBias: { value: 0.5 },
        u_sequencePhase: { value: 0.0 },
        u_warmup: { value: 80.0 },
        u_measure: { value: 140.0 },
        u_brightness: { value: 1.2 },
        u_contrast: { value: 1.1 },
        u_hueShift: { value: 0.06 },
        u_warpX: { value: 0.0 },
        u_warpY: { value: 0.0 },
        u_high: { value: 0.0 },
        u_rms: { value: 0.1 },
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
      this.smoothers.beatPulse.update(f.beatOnset ? 1.0 : 0.0);

      if (f.beatOnset && this.userParams.beatToJolt > 0) {
        this.sequencePhase += 0.15 * this.userParams.beatToJolt;
      }
    } else {
      this.smoothers.beatPulse.update(0.0);
    }

    // Slow continuous drift in sequence phase
    this.sequencePhase += (1 / 60) * 0.04;

    const bias = Math.max(
      0,
      Math.min(
        1,
        this.userParams.sequenceBias + (this.smoothers.bass.value - 0.3) * 0.4 * this.userParams.bassToBias,
      ),
    );

    const warpMag = 0.05 * this.smoothers.mid.value * this.userParams.midToWarp;

    if (this.material) {
      const u = this.material.uniforms;
      u.u_time.value = this.time;
      u.u_zoom.value = this._zoom;
      u.u_pan.value.set(this._panX, this._panY);
      u.u_sequenceBias.value = bias;
      u.u_sequencePhase.value = this.sequencePhase;
      u.u_warmup.value = this.userParams.warmup;
      u.u_measure.value = this.userParams.measure;
      u.u_brightness.value = this.userParams.brightness * (0.7 + this.smoothers.rms.value * 0.6 * this.userParams.rmsToGlow);
      u.u_contrast.value = this.userParams.contrast;
      u.u_hueShift.value = this.userParams.hueShift;
      u.u_warpX.value = Math.sin(this.time * 0.3) * warpMag;
      u.u_warpY.value = Math.cos(this.time * 0.25) * warpMag;
      u.u_high.value = this.smoothers.high.value * this.userParams.highToSparkle;
      u.u_rms.value = this.smoothers.rms.value;
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
    return {
      zoom: this._zoom,
      panX: this._panX,
      panY: this._panY,
    };
  }

  setViewState(partial: Record<string, number>): void {
    if ('zoom' in partial) {
      this._zoom = Math.max(0.2, Math.min(8.0, partial.zoom));
      this.viewOverrides.zoom = true;
    }
    if ('panX' in partial) {
      this._panX = Math.max(0.0, Math.min(4.0, partial.panX));
      this.viewOverrides.panX = true;
    }
    if ('panY' in partial) {
      this._panY = Math.max(0.0, Math.min(4.0, partial.panY));
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
  metadata: lyapunovMetadata,
  create: (bus) => new LyapunovVisualizer(bus),
});

// ── Shaders ────────────────────────────────────────────

const VERTEX_SHADER = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position, 1.0);
  }
`;

// GLSL ES 1.00 -- no dynamic loop bounds, so we use a fixed upper cap with early break.
const FRAGMENT_SHADER = /* glsl */ `
  precision highp float;

  #define PI 3.14159265359
  #define MAX_STEPS 500

  uniform float u_time;
  uniform vec2 u_resolution;
  uniform float u_zoom;
  uniform vec2 u_pan;
  uniform float u_sequenceBias;
  uniform float u_sequencePhase;
  uniform float u_warmup;
  uniform float u_measure;
  uniform float u_brightness;
  uniform float u_contrast;
  uniform float u_hueShift;
  uniform float u_warpX;
  uniform float u_warpY;
  uniform float u_high;
  uniform float u_rms;
  uniform float u_beatPulse;

  varying vec2 vUv;

  vec3 hsv2rgb(vec3 c) {
    vec4 K = vec4(1.0, 2.0 / 3.0, 1.0 / 3.0, 3.0);
    vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
    return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
  }

  // Returns 1.0 if the n-th element of the sequence picks B, else 0.0.
  // We use a smooth Bernoulli-like pattern parameterized by bias and a
  // deterministic hash-based permutation advanced by u_sequencePhase.
  float pickB(int n) {
    float h = fract(sin(float(n) * 12.9898 + u_sequencePhase * 17.3) * 43758.5453);
    return step(h, u_sequenceBias);
  }

  void main() {
    vec2 uv = (gl_FragCoord.xy - 0.5 * u_resolution) / min(u_resolution.x, u_resolution.y);

    // Map screen space into the parameter plane [0, 4] x [0, 4]
    float scale = 4.0 / u_zoom;
    vec2 ab = uv * scale + u_pan;
    ab.x += u_warpX;
    ab.y += u_warpY;

    // Clamp to the logistic-map stability range (0, 4)
    float a = clamp(ab.x, 0.01, 4.0);
    float b = clamp(ab.y, 0.01, 4.0);

    int warmup = int(clamp(u_warmup, 10.0, 250.0));
    int measure = int(clamp(u_measure, 20.0, 250.0));

    // Initial seed away from 0 and 1
    float x = 0.5;

    // Warmup: discard transient
    for (int i = 0; i < MAX_STEPS; i++) {
      if (i >= warmup) break;
      float pickBf = pickB(i);
      float r = mix(a, b, pickBf);
      x = r * x * (1.0 - x);
    }

    // Measurement: accumulate sum of log|r * (1 - 2x)|
    float lambdaSum = 0.0;
    for (int i = 0; i < MAX_STEPS; i++) {
      if (i >= measure) break;
      float pickBf = pickB(warmup + i);
      float r = mix(a, b, pickBf);
      x = r * x * (1.0 - x);
      float deriv = abs(r * (1.0 - 2.0 * x));
      // log(0) guard -- clamp
      lambdaSum += log(max(deriv, 1e-10));
    }

    float lambda = lambdaSum / float(measure);
    // Apply contrast
    float l = lambda * u_contrast;

    vec3 color;
    if (l < 0.0) {
      // Stable region: warm palette, brighter for more negative lambda
      float t = clamp(-l, 0.0, 2.5) / 2.5;
      float hue = fract(u_hueShift + 0.08 + t * 0.12);
      float sat = 0.55 + 0.35 * t;
      float val = pow(t, 0.7) * u_brightness;
      color = hsv2rgb(vec3(hue, sat, val));
    } else {
      // Chaotic region: deep indigo fading to near-black
      float t = clamp(l, 0.0, 1.5) / 1.5;
      float hue = fract(u_hueShift + 0.62 - t * 0.1);
      float sat = 0.5 * (1.0 - t);
      float val = 0.06 + 0.08 * (1.0 - t);
      color = hsv2rgb(vec3(hue, sat, val));

      // Sparkle in chaos regions driven by highs
      float sparkle = fract(sin(dot(gl_FragCoord.xy, vec2(93.7, 47.1)) + u_time * 3.0) * 51.3);
      sparkle = smoothstep(0.985, 1.0, sparkle);
      color += vec3(1.0, 0.85, 0.6) * sparkle * u_high * 0.5;
    }

    // Beat flash
    color += vec3(1.0, 0.7, 0.4) * u_beatPulse * 0.08;

    // Vignette
    float aspect = u_resolution.x / u_resolution.y;
    vec2 screenUv = gl_FragCoord.xy / u_resolution;
    float vignette = 1.0 - 0.3 * length((screenUv - 0.5) * vec2(aspect, 1.0));
    color *= vignette;

    // Tone mapping
    color = color / (1.0 + color);

    gl_FragColor = vec4(color, 1.0);
  }
`;
