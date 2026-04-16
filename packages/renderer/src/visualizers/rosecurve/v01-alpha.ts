import * as THREE from 'three';
import { MessageBus } from '@cybernoetica/core';
import type { AudioFeatures, BusMessage, Unsubscribe } from '@cybernoetica/core';
import { EMASmoothing } from '../../smoothing.js';
import type { Visualizer, VisualizerMetadata } from '../types.js';
import { registerVisualizer } from '../registry.js';

/**
 * Rose Curve (Rhodonea) visualizer.
 *
 * Based on the polar equation r = A * cos(k * theta), where k = n/d
 * determines the number of petals and their topology. Rational k
 * produces closed curves with n or 2n petals; irrational k produces
 * dense quasi-periodic flowers.
 *
 * This visualizer renders a stacked family of rose curves -- multiple
 * layered roses with slightly different k values creating a moire-like
 * interference pattern. The petal count and phase evolve with the music.
 *
 * Audio mapping:
 *   bass  -> petal amplitude (radial reach)
 *   mid   -> k parameter drift (petal topology)
 *   high  -> line sharpness / thickness
 *   rms   -> layer count luminosity
 *   beat  -> rotation impulse
 */

const roseMetadata: VisualizerMetadata = {
  type: 'rosecurve',
  label: 'Rose Curve',
  description: 'Rhodonea polar rose family with harmonics',
  usesPerspective: false,
  params: [
    // Appearance
    { key: 'numerator', label: 'Petals N', min: 1, max: 12, step: 1, initial: 5, category: 'appearance', description: 'Petal count numerator' },
    { key: 'denominator', label: 'Petals D', min: 1, max: 8, step: 1, initial: 2, category: 'appearance', description: 'Denominator of k = N/D' },
    { key: 'layers', label: 'Layers', min: 1, max: 6, step: 1, initial: 4, category: 'appearance', description: 'Stacked rose layers' },
    { key: 'amplitude', label: 'Amplitude', min: 0.2, max: 1.2, step: 0.02, initial: 0.85, category: 'appearance', description: 'Radial extent of petals' },
    { key: 'thickness', label: 'Thickness', min: 0.005, max: 0.1, step: 0.002, initial: 0.02, category: 'appearance', description: 'Line width' },
    { key: 'spin', label: 'Spin', min: 0.0, max: 1.0, step: 0.01, initial: 0.15, category: 'appearance', description: 'Rotation speed' },
    { key: 'hue', label: 'Hue', min: 0.0, max: 1.0, step: 0.01, initial: 0.85, category: 'appearance', description: 'Base palette hue' },
    { key: 'hueSpread', label: 'Hue Spread', min: 0.0, max: 1.0, step: 0.01, initial: 0.3, category: 'appearance', description: 'Hue offset per layer' },
    // Audio mapping
    { key: 'bassToAmp', label: 'Bass \u2192 Amplitude', min: 0.0, max: 2.0, step: 0.1, initial: 1.0, category: 'audio-mapping', description: 'Bass grows petals' },
    { key: 'midToK', label: 'Mid \u2192 Topology', min: 0.0, max: 2.0, step: 0.1, initial: 1.0, category: 'audio-mapping', description: 'Mids drift rose k' },
    { key: 'highToSharpness', label: 'High \u2192 Sharpness', min: 0.0, max: 2.0, step: 0.1, initial: 1.0, category: 'audio-mapping', description: 'Highs tighten lines' },
    { key: 'rmsToGlow', label: 'RMS \u2192 Glow', min: 0.0, max: 2.0, step: 0.1, initial: 1.0, category: 'audio-mapping', description: 'Volume drives overall glow' },
    { key: 'beatToSpin', label: 'Beat \u2192 Spin', min: 0.0, max: 2.0, step: 0.1, initial: 1.0, category: 'audio-mapping', description: 'Beats kick rotation' },
  ],
  viewport: { pan: true, zoom: true, orbit: false },
  viewStateFields: [
    { key: 'centerX', label: 'Center X', min: -3, max: 3, step: 0.05 },
    { key: 'centerY', label: 'Center Y', min: -3, max: 3, step: 0.05 },
    { key: 'zoom', label: 'Zoom', min: 0.3, max: 4.0, step: 0.05 },
  ],
};

export class RoseCurveVisualizer implements Visualizer {
  readonly metadata = roseMetadata;

  private unsub: Unsubscribe;
  private latestFeatures: AudioFeatures | null = null;
  private time = 0;
  private rotation = 0;
  private spinVelocity = 0;

  private userParams: Record<string, number> = {
    numerator: 5,
    denominator: 2,
    layers: 4,
    amplitude: 0.85,
    thickness: 0.02,
    spin: 0.15,
    hue: 0.85,
    hueSpread: 0.3,
    bassToAmp: 1.0,
    midToK: 1.0,
    highToSharpness: 1.0,
    rmsToGlow: 1.0,
    beatToSpin: 1.0,
  };

  private _centerX = 0;
  private _centerY = 0;
  private _zoom = 1.0;
  private viewOverrides: Record<string, boolean> = {};

  private smoothers = {
    bass: new EMASmoothing(0.12),
    mid: new EMASmoothing(0.18),
    high: new EMASmoothing(0.25),
    rms: new EMASmoothing(0.15),
    beatPulse: new EMASmoothing(0.35),
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
        u_center: { value: new THREE.Vector2(0, 0) },
        u_k: { value: 2.5 },
        u_layers: { value: 4.0 },
        u_amplitude: { value: 0.85 },
        u_thickness: { value: 0.02 },
        u_rotation: { value: 0.0 },
        u_hue: { value: 0.85 },
        u_hueSpread: { value: 0.3 },
        u_rms: { value: 0.1 },
        u_high: { value: 0.0 },
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

      if (f.beatOnset && this.userParams.beatToSpin > 0) {
        this.spinVelocity += 1.2 * this.userParams.beatToSpin;
      }
    } else {
      this.smoothers.beatPulse.update(0.0);
    }

    // Spin dynamics: base spin + beat-impulse decay
    const baseSpin = this.userParams.spin;
    this.spinVelocity *= 0.94;
    this.rotation += (baseSpin + this.spinVelocity) * (1 / 60);

    // k = numerator/denominator + mid drift
    const baseK = this.userParams.numerator / this.userParams.denominator;
    const k = baseK + (this.smoothers.mid.value - 0.25) * 0.6 * this.userParams.midToK;

    // Amplitude breathing on bass
    const amplitude = this.userParams.amplitude
      * (1.0 + this.smoothers.bass.value * 0.35 * this.userParams.bassToAmp);

    // Thickness tightened by highs
    const highM = this.userParams.highToSharpness;
    const thickness = Math.max(
      0.003,
      this.userParams.thickness * (1.0 - this.smoothers.high.value * 0.6 * highM),
    );

    if (this.material) {
      const u = this.material.uniforms;
      u.u_time.value = this.time;
      u.u_zoom.value = this._zoom;
      u.u_center.value.set(this._centerX, this._centerY);
      u.u_k.value = k;
      u.u_layers.value = this.userParams.layers;
      u.u_amplitude.value = amplitude;
      u.u_thickness.value = thickness;
      u.u_rotation.value = this.rotation;
      u.u_hue.value = this.userParams.hue;
      u.u_hueSpread.value = this.userParams.hueSpread;
      u.u_rms.value = this.smoothers.rms.value * this.userParams.rmsToGlow;
      u.u_high.value = this.smoothers.high.value;
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
    return { centerX: this._centerX, centerY: this._centerY, zoom: this._zoom };
  }

  setViewState(partial: Record<string, number>): void {
    if ('centerX' in partial) {
      this._centerX = Math.max(-3, Math.min(3, partial.centerX));
      this.viewOverrides.pan = true;
    }
    if ('centerY' in partial) {
      this._centerY = Math.max(-3, Math.min(3, partial.centerY));
      this.viewOverrides.pan = true;
    }
    if ('zoom' in partial) {
      this._zoom = Math.max(0.3, Math.min(4.0, partial.zoom));
      this.viewOverrides.zoom = true;
    }
  }

  dispose(): void {
    this.unsub();
    this.material?.dispose();
    this.mesh?.geometry.dispose();
  }
}

registerVisualizer({
  metadata: roseMetadata,
  create: (bus) => new RoseCurveVisualizer(bus),
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
  #define TAU 6.28318530718
  #define MAX_LAYERS 6

  uniform float u_time;
  uniform vec2 u_resolution;
  uniform float u_zoom;
  uniform vec2 u_center;
  uniform float u_k;
  uniform float u_layers;
  uniform float u_amplitude;
  uniform float u_thickness;
  uniform float u_rotation;
  uniform float u_hue;
  uniform float u_hueSpread;
  uniform float u_rms;
  uniform float u_high;
  uniform float u_beatPulse;

  varying vec2 vUv;

  vec3 hsv2rgb(vec3 c) {
    vec4 K = vec4(1.0, 2.0 / 3.0, 1.0 / 3.0, 3.0);
    vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
    return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
  }

  // Distance from a point (r, theta) to the rose curve r = A * |cos(k*theta)|
  // Since the exact closest-point problem is non-trivial, we use a soft
  // radial distance comparison |r_pixel - r_curve| which produces nice
  // glowing petal outlines.
  float roseField(vec2 p, float k, float amp) {
    float r = length(p);
    float theta = atan(p.y, p.x);
    float target = amp * abs(cos(k * theta));
    return abs(r - target);
  }

  void main() {
    vec2 uv = (gl_FragCoord.xy - 0.5 * u_resolution) / min(u_resolution.x, u_resolution.y);
    uv = uv / u_zoom + u_center;

    // Rotate whole scene
    float c = cos(u_rotation);
    float s = sin(u_rotation);
    vec2 rp = vec2(uv.x * c - uv.y * s, uv.x * s + uv.y * c);

    float totalLuma = 0.0;
    vec3 totalColor = vec3(0.0);
    int layers = int(u_layers);

    for (int i = 0; i < MAX_LAYERS; i++) {
      if (i >= layers) break;
      float li = float(i);
      float lnorm = li / max(1.0, float(layers));
      // Slight k offset per layer produces harmonic overlays
      float kLayer = u_k + (lnorm - 0.5) * 0.6;
      // Slight amplitude taper
      float ampLayer = u_amplitude * (1.0 - lnorm * 0.15);
      // Counter-rotate each layer slightly
      float rot = u_rotation * (0.5 + lnorm);
      float cc = cos(rot);
      float ss = sin(rot);
      vec2 lp = vec2(rp.x * cc - rp.y * ss, rp.x * ss + rp.y * cc);

      float d = roseField(lp, kLayer, ampLayer);

      // Soft line profile
      float t = u_thickness * (1.0 + lnorm * 0.3);
      float line = exp(-(d * d) / (2.0 * t * t));

      float hue = fract(u_hue + lnorm * u_hueSpread);
      float sat = 0.85 - lnorm * 0.15;
      float val = line * (0.8 + u_rms * 0.8);

      vec3 col = hsv2rgb(vec3(hue, sat, val));
      totalColor += col;
      totalLuma += line;
    }

    // High-frequency sparkle near the line (derivative-based shimmer)
    float sparkle = u_high * totalLuma * 0.35;
    totalColor += vec3(1.0, 0.9, 1.0) * sparkle;

    // Beat flash ring at amplitude radius
    float beatR = u_amplitude * (1.0 + u_beatPulse * 0.6);
    float rpLen = length(rp);
    float flash = exp(-pow((rpLen - beatR) * 8.0, 2.0)) * u_beatPulse * 0.5;
    totalColor += vec3(0.9, 0.95, 1.0) * flash;

    // Subtle radial glow around center
    float centerGlow = exp(-length(rp) * 2.0) * 0.08 * (0.4 + u_rms);
    totalColor += hsv2rgb(vec3(u_hue, 0.8, 1.0)) * centerGlow;

    // Dark background tint
    vec3 bg = vec3(0.01, 0.008, 0.022);
    vec3 color = max(totalColor, bg);

    // Vignette
    float aspect = u_resolution.x / u_resolution.y;
    vec2 screenUv = gl_FragCoord.xy / u_resolution;
    float vignette = 1.0 - 0.3 * length((screenUv - 0.5) * vec2(aspect, 1.0));
    color *= vignette;

    // Tone mapping
    color = color / (0.85 + color);

    gl_FragColor = vec4(color, 1.0);
  }
`;
