import * as THREE from 'three';
import { MessageBus } from '@cybernoetica/core';
import type { AudioFeatures, BusMessage, Unsubscribe } from '@cybernoetica/core';
import { EMASmoothing } from '../../smoothing.js';
import type { Visualizer, VisualizerMetadata } from '../types.js';
import { registerVisualizer } from '../registry.js';

/**
 * Lissajous / Harmonograph visualizer — oscilloscope art.
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
    { key: 'trailLength', label: 'Trail Length', min: 64, max: 512, step: 16, initial: 384, category: 'appearance' },
    { key: 'glowWidth', label: 'Glow Width', min: 0.5, max: 4.0, step: 0.25, initial: 2.5, category: 'appearance' },
    { key: 'damping', label: 'Damping', min: 0.0, max: 0.5, step: 0.02, initial: 0.05, category: 'appearance' },
    { key: 'rotationSpeed', label: 'Rotation', min: 0.0, max: 0.5, step: 0.02, initial: 0.08, category: 'appearance' },
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
    trailLength: 384,
    glowWidth: 2.5,
    damping: 0.05,
    rotationSpeed: 0.08,
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
    bass: new EMASmoothing(0.15),
    mid: new EMASmoothing(0.2),
    high: new EMASmoothing(0.25),
    rms: new EMASmoothing(0.2),
    spectralCentroid: new EMASmoothing(0.1),
    beatPulse: new EMASmoothing(0.5),
    amplitude: new EMASmoothing(0.1),
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

    // Damping envelope decays over time, reset on beats
    // Keep a generous floor so idle state always shows the curve
    this.dampingEnvelope *= (1.0 - this.userParams.damping / 60);
    this.dampingEnvelope = Math.max(0.6, this.dampingEnvelope);

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
      u.u_freqA2.value = preset.a * 0.5 + 0.1;
      u.u_freqB2.value = preset.b * 0.5 + 0.3;
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

  // Evaluate harmonograph position at parameter t
  vec2 harmonograph(float t, float time) {
    float decay1 = exp(-u_damping * t * 0.1) * u_dampingEnvelope;
    float decay2 = exp(-u_damping * t * 0.15) * u_dampingEnvelope;

    // Primary pendulum pair
    float x = sin(u_freqA * t + u_phaseDelta + time * u_rotationSpeed) * decay1;
    float y = sin(u_freqB * t + time * u_rotationSpeed * 0.7) * decay1;

    // Secondary pendulum pair (smaller amplitude, different frequencies)
    x += 0.3 * sin(u_freqA2 * t + time * 0.15) * decay2;
    y += 0.3 * sin(u_freqB2 * t + 1.5 + time * 0.12) * decay2;

    return vec2(x, y) * u_amplitude;
  }

  // Distance from point p to the line segment a--b
  float segDist(vec2 p, vec2 a, vec2 b) {
    vec2 ab = b - a;
    float t = clamp(dot(p - a, ab) / dot(ab, ab), 0.0, 1.0);
    return length(p - (a + t * ab));
  }

  void main() {
    vec2 uv = (gl_FragCoord.xy - 0.5 * u_resolution) / min(u_resolution.x, u_resolution.y);
    uv = uv / u_zoom + u_center;

    float minDist = 100.0;
    float closestT = 0.0;
    int numSamples = int(u_trailLength);

    // Compute distance to the parametric curve using line segments
    float tStep = 16.0 / u_trailLength;
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

    float glowRadius = u_glowWidth * 0.005;
    float core = exp(-minDist * minDist / (glowRadius * glowRadius));
    float soft = exp(-minDist * minDist / (glowRadius * glowRadius * 6.0));
    float glow = core * 0.9 + soft * 0.15;

    // Audio-driven brightness (strong idle base so curve is always visible)
    float brightness = 0.9 + u_rms * 0.6 * u_rmsToGlow;
    glow *= brightness;
    glow += u_beatPulse * core * 0.3;

    // Color: hue shifts along the curve parameter
    float hue = fract(closestT * 0.06 + u_time * 0.05 + u_spectralCentroid * 0.2);
    float sat = 0.6 + 0.3 * (1.0 - closestT / 16.0);
    float val = glow;

    vec3 color = hsv2rgb(vec3(hue, sat, 1.0)) * val;

    // Background
    vec3 bg = vec3(0.01, 0.01, 0.025);
    bg += vec3(0.015, 0.008, 0.03) * u_beatPulse;

    vec3 finalColor = bg + color;

    // Vignette
    float aspect = u_resolution.x / u_resolution.y;
    vec2 vUv2 = gl_FragCoord.xy / u_resolution;
    float vignette = 1.0 - 0.35 * length((vUv2 - 0.5) * vec2(aspect, 1.0));
    finalColor *= vignette;

    // Tone mapping
    finalColor = finalColor / (1.0 + finalColor);

    gl_FragColor = vec4(finalColor, 1.0);
  }
`;
