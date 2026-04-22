import * as THREE from 'three';
import { MessageBus } from '@cybernoetica/core';
import type { AudioFeatures, BusMessage, Unsubscribe } from '@cybernoetica/core';
import { EMASmoothing } from '../../smoothing.js';
import type { Visualizer, VisualizerMetadata } from '../types.js';
import { registerVisualizer } from '../registry.js';

/**
 * Lissajous / Harmonograph visualizer — oscilloscope art.
 *
 * Math:
 *   Pure Lissajous figures follow x = A cos(omega_x t - delta_x),
 *   y = B cos(omega_y t - delta_y). This shader adds damping and
 *   a second harmonic layer for harmonograph-like richness.
 * References:
 *   https://mathworld.wolfram.com/LissajousCurve.html
 *   https://mathworld.wolfram.com/Harmonograph.html
 *
 * Renders damped Lissajous curves as glowing light trails.
 * Two superimposed pendulum pairs trace parametric curves;
 * the frequency ratios determine pattern complexity.
 *
 * Audio maps naturally: bass drives amplitude, spectral centroid
 * shifts frequency ratios (simple → complex patterns), beats
 * reset damping for fresh bloom effects, and RMS controls trail glow.
 */

/** Preset frequency ratio pairs that produce beautiful figures */
const RATIO_PRESETS = [
  { a: 1, b: 1, label: 'circle' },
  { a: 1, b: 2, label: 'figure-8' },
  { a: 2, b: 3, label: 'trefoil' },
  { a: 3, b: 4, label: 'clover' },
  { a: 3, b: 5, label: 'star' },
  { a: 5, b: 6, label: 'rose' },
  { a: 5, b: 7, label: 'lace' },
  { a: 7, b: 9, label: 'web' },
];

const lissajousMetadata: VisualizerMetadata = {
  type: 'lissajous',
  label: 'Lissajous',
  description: 'Oscilloscope light curves',
  usesPerspective: false,
  params: [
    // Appearance
    { key: 'complexity', label: 'Complexity', min: 0, max: 7, step: 1, initial: 2, category: 'appearance' },
    { key: 'trailLength', label: 'Trail Length', min: 128, max: 512, step: 16, initial: 480, category: 'appearance' },
    { key: 'glowWidth', label: 'Glow Width', min: 0.5, max: 4.0, step: 0.25, initial: 2.0, category: 'appearance' },
    { key: 'damping', label: 'Damping', min: 0.0, max: 0.5, step: 0.02, initial: 0.03, category: 'appearance' },
    { key: 'rotationSpeed', label: 'Rotation', min: 0.0, max: 0.5, step: 0.02, initial: 0.06, category: 'appearance' },
    // Audio mapping
    { key: 'bassToAmplitude', label: 'Bass → Amplitude', min: 0.0, max: 2.0, step: 0.1, initial: 1.0, category: 'audio-mapping', description: 'How strongly bass affects curve size' },
    { key: 'spectralToRatio', label: 'Spectral → Ratio', min: 0.0, max: 2.0, step: 0.1, initial: 1.0, category: 'audio-mapping', description: 'How strongly spectral centroid shifts frequency ratios' },
    { key: 'rmsToGlow', label: 'RMS → Glow', min: 0.0, max: 2.0, step: 0.1, initial: 1.0, category: 'audio-mapping', description: 'How strongly volume affects trail brightness' },
    { key: 'beatToBloom', label: 'Beat → Bloom', min: 0.0, max: 2.0, step: 0.1, initial: 1.0, category: 'audio-mapping', description: 'How strongly beats trigger fresh curve bloom' },
  ],
  viewport: { pan: true, zoom: true, orbit: false },
  viewStateFields: [
    { key: 'centerX', label: 'Center X', min: -2, max: 2, step: 0.01 },
    { key: 'centerY', label: 'Center Y', min: -2, max: 2, step: 0.01 },
    { key: 'zoom', label: 'Zoom', min: 0.3, max: 3.0, step: 0.05 },
    { key: 'phase', label: 'Phase', min: 0, max: 6.283, step: 0.01, readOnly: true },
  ],
};

export class LissajousVisualizer implements Visualizer {
  readonly metadata = lissajousMetadata;

  private unsub: Unsubscribe;
  private latestFeatures: AudioFeatures | null = null;
  private time = 0;
  private phase = 0;
  private dampingEnvelope = 1.0;

  private userParams: Record<string, number> = {
    complexity: 2,
    trailLength: 480,
    glowWidth: 2.0,
    damping: 0.03,
    rotationSpeed: 0.06,
    bassToAmplitude: 1.0,
    spectralToRatio: 1.0,
    rmsToGlow: 1.0,
    beatToBloom: 1.0,
  };

  private _zoom = 1.0;
  private _centerX = 0;
  private _centerY = 0;
  private viewOverrides: Record<string, boolean> = {};

  private smoothers = {
    bass: new EMASmoothing(0.08),
    mid: new EMASmoothing(0.1),
    high: new EMASmoothing(0.12),
    rms: new EMASmoothing(0.1),
    spectralCentroid: new EMASmoothing(0.06),
    beatPulse: new EMASmoothing(0.35),
    amplitude: new EMASmoothing(0.06),
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
    this.smoothers.beatPulse.reset(0);
    this.smoothers.amplitude.reset(0.45);
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
        u_freqA: { value: 2.0 },
        u_freqB: { value: 3.0 },
        u_phaseDelta: { value: Math.PI / 4 },
        u_amplitude: { value: 0.45 },
        u_damping: { value: 0.05 },
        u_dampingEnvelope: { value: 1.0 },
        u_trailLength: { value: 384.0 },
        u_glowWidth: { value: 2.5 },
        u_rotationSpeed: { value: 0.08 },
        u_bass: { value: 0.0 },
        u_mid: { value: 0.0 },
        u_high: { value: 0.0 },
        u_rms: { value: 0.1 },
        u_spectralCentroid: { value: 0.5 },
        u_beatPulse: { value: 0.0 },
        u_rmsToGlow: { value: 1.0 },
        // Second harmonic pair for harmonograph richness
        u_freqA2: { value: 1.0 },
        u_freqB2: { value: 1.0 },
      },
      transparent: true,
    });

    const geometry = new THREE.PlaneGeometry(2, 2);
    this.mesh = new THREE.Mesh(geometry, this.material);
    scene.add(this.mesh);
  }

  tick(): void {
    this.time += 1 / 60;
    this.phase += 0.02;

    this.dampingEnvelope *= (1.0 - this.userParams.damping / 60);
    this.dampingEnvelope = Math.max(0.7, this.dampingEnvelope);

    if (this.latestFeatures) {
      const f = this.latestFeatures;
      this.smoothers.bass.update(f.bass);
      this.smoothers.mid.update(f.mid);
      this.smoothers.high.update(f.high);
      this.smoothers.rms.update(f.rms);
      this.smoothers.spectralCentroid.update(f.spectralCentroid);
      this.smoothers.beatPulse.update(f.beatOnset ? 1.0 : 0.0);

      const amp = 0.35 + f.bass * 0.3 * this.userParams.bassToAmplitude;
      this.smoothers.amplitude.update(amp);

      // Beat resets the damping envelope (fresh bloom)
      if (f.beatOnset && this.userParams.beatToBloom > 0) {
        this.dampingEnvelope = Math.min(1.0, this.dampingEnvelope + 0.5 * this.userParams.beatToBloom);
      }
    } else {
      this.smoothers.beatPulse.update(0.0);
      this.smoothers.amplitude.update(0.45);
    }

    // Get frequency ratios from preset
    const idx = Math.round(this.userParams.complexity);
    const preset = RATIO_PRESETS[Math.min(idx, RATIO_PRESETS.length - 1)];

    // Spectral centroid adds a slight irrational offset for rotation effect
    const spectralOffset = this.smoothers.spectralCentroid.value * 0.15 * this.userParams.spectralToRatio;

    if (this.material) {
      const u = this.material.uniforms;
      u.u_time.value = this.time;
      u.u_zoom.value = this._zoom;
      u.u_center.value.set(this._centerX, this._centerY);
      u.u_freqA.value = preset.a + spectralOffset;
      u.u_freqB.value = preset.b;
      u.u_freqA2.value = preset.a * 0.7 + 0.2;
      u.u_freqB2.value = preset.b * 0.6 + 0.3;
      u.u_phaseDelta.value = Math.PI / 4 + this.smoothers.mid.value * 0.5;
      u.u_amplitude.value = this.smoothers.amplitude.value;
      u.u_damping.value = this.userParams.damping;
      u.u_dampingEnvelope.value = this.dampingEnvelope;
      u.u_trailLength.value = this.userParams.trailLength;
      u.u_glowWidth.value = this.userParams.glowWidth;
      u.u_rotationSpeed.value = this.userParams.rotationSpeed;
      u.u_bass.value = this.smoothers.bass.value;
      u.u_mid.value = this.smoothers.mid.value;
      u.u_high.value = this.smoothers.high.value;
      u.u_rms.value = this.smoothers.rms.value;
      u.u_spectralCentroid.value = this.smoothers.spectralCentroid.value;
      u.u_beatPulse.value = this.smoothers.beatPulse.value;
      u.u_rmsToGlow.value = this.userParams.rmsToGlow;
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
      centerX: this._centerX,
      centerY: this._centerY,
      zoom: this._zoom,
      phase: this.phase % (Math.PI * 2),
    };
  }

  setViewState(partial: Record<string, number>): void {
    if ('centerX' in partial) {
      this._centerX = Math.max(-2, Math.min(2, partial.centerX));
      this.viewOverrides.center = true;
    }
    if ('centerY' in partial) {
      this._centerY = Math.max(-2, Math.min(2, partial.centerY));
      this.viewOverrides.center = true;
    }
    if ('zoom' in partial) {
      this._zoom = Math.max(0.3, Math.min(3.0, partial.zoom));
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
  metadata: lissajousMetadata,
  create: (bus) => new LissajousVisualizer(bus),
});

const VERTEX_SHADER = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position, 1.0);
  }
`;

const FRAGMENT_SHADER = /* glsl */ `
  precision highp float;

  uniform float u_time;
  uniform vec2 u_resolution;
  uniform float u_zoom;
  uniform vec2 u_center;
  uniform float u_freqA;
  uniform float u_freqB;
  uniform float u_freqA2;
  uniform float u_freqB2;
  uniform float u_phaseDelta;
  uniform float u_amplitude;
  uniform float u_damping;
  uniform float u_dampingEnvelope;
  uniform float u_trailLength;
  uniform float u_glowWidth;
  uniform float u_rotationSpeed;
  uniform float u_bass;
  uniform float u_mid;
  uniform float u_high;
  uniform float u_rms;
  uniform float u_spectralCentroid;
  uniform float u_beatPulse;
  uniform float u_rmsToGlow;

  varying vec2 vUv;

  vec3 hsv2rgb(vec3 c) {
    vec4 K = vec4(1.0, 2.0 / 3.0, 1.0 / 3.0, 3.0);
    vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
    return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
  }

  vec2 harmonograph(float t, float time) {
    float decay1 = exp(-u_damping * t * 0.08) * u_dampingEnvelope;
    float decay2 = exp(-u_damping * t * 0.12) * u_dampingEnvelope;
    float decay3 = exp(-u_damping * t * 0.18) * u_dampingEnvelope;

    float x = sin(u_freqA * t + u_phaseDelta + time * u_rotationSpeed) * decay1;
    float y = sin(u_freqB * t + time * u_rotationSpeed * 0.7) * decay1;

    x += 0.35 * sin(u_freqA2 * t + time * 0.15) * decay2;
    y += 0.35 * sin(u_freqB2 * t + 1.5 + time * 0.12) * decay2;

    // Third harmonic layer for additional detail
    float fA3 = u_freqA * 1.618 + 0.5;
    float fB3 = u_freqB * 1.618 + 0.3;
    x += 0.15 * sin(fA3 * t + time * 0.08 + 2.1) * decay3;
    y += 0.15 * sin(fB3 * t + time * 0.06 + 0.7) * decay3;

    return vec2(x, y) * u_amplitude;
  }

  float segDist(vec2 p, vec2 a, vec2 b) {
    vec2 ab = b - a;
    float len2 = dot(ab, ab);
    if (len2 < 1e-10) return length(p - a);
    float t = clamp(dot(p - a, ab) / len2, 0.0, 1.0);
    return length(p - (a + t * ab));
  }

  void main() {
    vec2 uv = (gl_FragCoord.xy - 0.5 * u_resolution) / min(u_resolution.x, u_resolution.y);
    uv = uv / u_zoom + u_center;

    float minDist = 100.0;
    float closestT = 0.0;
    int numSamples = int(u_trailLength);

    // Higher sampling density: finer step for smoother curves
    float tStep = 12.0 / u_trailLength;
    vec2 prev = harmonograph(0.0, u_time);
    for (int i = 1; i < 512; i++) {
      if (i >= numSamples) break;
      float t = float(i) * tStep;
      vec2 cur = harmonograph(t, u_time);
      float d = segDist(uv, prev, cur);
      if (d < minDist) {
        minDist = d;
        closestT = t - tStep * 0.5;
      }
      prev = cur;
    }

    float glowRadius = u_glowWidth * 0.004;

    // Core glow (tight)
    float core = exp(-minDist * minDist / (glowRadius * glowRadius));
    // Soft bloom (wide)
    float bloom = exp(-minDist * minDist / (glowRadius * glowRadius * 8.0));
    // Ultra-wide atmosphere
    float atmosphere = exp(-minDist * minDist / (glowRadius * glowRadius * 40.0));

    float glow = core * 0.85 + bloom * 0.2 + atmosphere * 0.06;

    float brightness = 0.85 + u_rms * 0.7 * u_rmsToGlow;
    glow *= brightness;
    glow += u_beatPulse * (core * 0.4 + bloom * 0.15);

    // Color: dual-hue system for richer palette
    float hue1 = fract(closestT * 0.05 + u_time * 0.04 + u_spectralCentroid * 0.25);
    float hue2 = fract(hue1 + 0.33);
    float sat = 0.5 + 0.4 * (1.0 - closestT / 12.0);
    float mixFactor = 0.5 + 0.5 * sin(closestT * 0.3 + u_time * 0.2);

    vec3 color1 = hsv2rgb(vec3(hue1, sat, 1.0));
    vec3 color2 = hsv2rgb(vec3(hue2, sat * 0.8, 1.0));
    vec3 curveColor = mix(color1, color2, mixFactor);

    vec3 color = curveColor * glow;

    // Bloom gets a desaturated tint
    vec3 bloomColor = mix(curveColor, vec3(0.6, 0.7, 1.0), 0.5) * atmosphere * 0.08;
    color += bloomColor;

    // Background with subtle radial gradient
    vec2 bgUv = gl_FragCoord.xy / u_resolution;
    float bgDist = length(bgUv - 0.5);
    vec3 bg = mix(vec3(0.015, 0.012, 0.035), vec3(0.005, 0.005, 0.015), bgDist * 1.5);
    bg += vec3(0.02, 0.01, 0.04) * u_beatPulse;

    vec3 finalColor = bg + color;

    // Vignette
    float aspect = u_resolution.x / u_resolution.y;
    float vignette = 1.0 - 0.3 * length((bgUv - 0.5) * vec2(aspect, 1.0));
    finalColor *= vignette;

    // Tone mapping (ACES-inspired)
    finalColor = (finalColor * (2.51 * finalColor + 0.03)) / (finalColor * (2.43 * finalColor + 0.59) + 0.14);

    gl_FragColor = vec4(finalColor, 1.0);
  }
`;
