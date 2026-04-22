import * as THREE from 'three';
import { MessageBus } from '@cybernoetica/core';
import type { AudioFeatures, BusMessage, Unsubscribe } from '@cybernoetica/core';
import { EMASmoothing } from '../../smoothing.js';
import type { Visualizer, VisualizerMetadata } from '../types.js';
import { registerVisualizer } from '../registry.js';

/**
 * Plasma visualizer -- classic demo-scene plasma with modern audio reactivity.
 *
 * Combines multiple sine wave interference patterns at different scales
 * and orientations to create the iconic "plasma" effect from 1990s demoscene.
 * Modern additions: smooth palette cycling, audio-driven distortion fields,
 * and spectral-reactive color temperature.
 *
 * The mathematical core: sum of sine functions evaluated at different
 * spatial frequencies and phases, creating smooth interference fringes.
 * Each sine component has its own time evolution, and audio features
 * modulate frequencies, amplitudes, and phase velocities independently.
 */

const plasmaMetadata: VisualizerMetadata = {
  type: 'plasma',
  label: 'Plasma',
  description: 'Classic demoscene plasma interference',
  usesPerspective: false,
  params: [
    // Appearance
    { key: 'complexity', label: 'Complexity', min: 2, max: 8, step: 1, initial: 5, category: 'appearance', description: 'Number of sine wave layers' },
    { key: 'speed', label: 'Speed', min: 0.1, max: 2.0, step: 0.05, initial: 0.6, category: 'appearance', description: 'Animation speed' },
    { key: 'scale', label: 'Scale', min: 1.0, max: 8.0, step: 0.25, initial: 3.0, category: 'appearance', description: 'Spatial frequency of patterns' },
    { key: 'saturation', label: 'Saturation', min: 0.2, max: 1.0, step: 0.05, initial: 0.75, category: 'appearance' },
    { key: 'paletteSpeed', label: 'Palette Speed', min: 0.0, max: 0.5, step: 0.01, initial: 0.1, category: 'appearance', description: 'Color palette rotation speed' },
    // Audio mapping
    { key: 'bassToWarp', label: 'Bass -> Warp', min: 0.0, max: 2.0, step: 0.1, initial: 1.0, category: 'audio-mapping', description: 'Bass warps spatial coordinates' },
    { key: 'midToSpeed', label: 'Mid -> Speed', min: 0.0, max: 2.0, step: 0.1, initial: 1.0, category: 'audio-mapping', description: 'Mids modulate animation speed' },
    { key: 'spectralToHue', label: 'Spectral -> Hue', min: 0.0, max: 2.0, step: 0.1, initial: 1.0, category: 'audio-mapping', description: 'Spectral centroid shifts color temperature' },
    { key: 'rmsToIntensity', label: 'RMS -> Intensity', min: 0.0, max: 2.0, step: 0.1, initial: 1.0, category: 'audio-mapping', description: 'Volume drives overall brightness' },
    { key: 'beatToPulse', label: 'Beat -> Pulse', min: 0.0, max: 2.0, step: 0.1, initial: 1.0, category: 'audio-mapping', description: 'Beats trigger contrast pulses' },
  ],
  viewport: { pan: true, zoom: true, orbit: false },
  viewStateFields: [
    { key: 'centerX', label: 'Center X', min: -3, max: 3, step: 0.05 },
    { key: 'centerY', label: 'Center Y', min: -3, max: 3, step: 0.05 },
    { key: 'zoom', label: 'Zoom', min: 0.3, max: 4.0, step: 0.05 },
  ],
};

export class PlasmaVisualizer implements Visualizer {
  readonly metadata = plasmaMetadata;

  private unsub: Unsubscribe;
  private latestFeatures: AudioFeatures | null = null;
  private time = 0;

  private userParams: Record<string, number> = {
    complexity: 5,
    speed: 0.6,
    scale: 3.0,
    saturation: 0.75,
    paletteSpeed: 0.1,
    bassToWarp: 1.0,
    midToSpeed: 1.0,
    spectralToHue: 1.0,
    rmsToIntensity: 1.0,
    beatToPulse: 1.0,
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
    spectralCentroid: new EMASmoothing(0.08),
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
    this.smoothers.spectralCentroid.reset(0.5);
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
        u_center: { value: new THREE.Vector2(0, 0) },
        u_complexity: { value: 5.0 },
        u_speed: { value: 0.6 },
        u_scale: { value: 3.0 },
        u_saturation: { value: 0.75 },
        u_paletteSpeed: { value: 0.1 },
        u_bass: { value: 0.0 },
        u_mid: { value: 0.0 },
        u_high: { value: 0.0 },
        u_rms: { value: 0.1 },
        u_spectralCentroid: { value: 0.5 },
        u_beatPulse: { value: 0.0 },
        u_warpStrength: { value: 0.0 },
        u_hueShift: { value: 0.0 },
        u_intensity: { value: 1.0 },
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
      this.smoothers.beatPulse.update(f.beatOnset ? 1.0 : 0.0);
    } else {
      this.smoothers.beatPulse.update(0.0);
    }

    // Effective speed modulated by mids
    const effSpeed = this.userParams.speed
      * (0.7 + this.smoothers.mid.value * 0.6 * this.userParams.midToSpeed);

    // Warp strength from bass
    const warpStrength = this.smoothers.bass.value * 0.3 * this.userParams.bassToWarp;

    // Hue shift from spectral centroid
    const hueShift = this.smoothers.spectralCentroid.value * 0.3 * this.userParams.spectralToHue;

    // Intensity from RMS
    const intensity = 0.6 + this.smoothers.rms.value * 0.8 * this.userParams.rmsToIntensity;

    if (this.material) {
      const u = this.material.uniforms;
      u.u_time.value = this.time * effSpeed;
      u.u_zoom.value = this._zoom;
      u.u_center.value.set(this._centerX, this._centerY);
      u.u_complexity.value = this.userParams.complexity;
      u.u_speed.value = effSpeed;
      u.u_scale.value = this.userParams.scale;
      u.u_saturation.value = this.userParams.saturation;
      u.u_paletteSpeed.value = this.userParams.paletteSpeed;
      u.u_bass.value = this.smoothers.bass.value;
      u.u_mid.value = this.smoothers.mid.value;
      u.u_high.value = this.smoothers.high.value;
      u.u_rms.value = this.smoothers.rms.value;
      u.u_spectralCentroid.value = this.smoothers.spectralCentroid.value;
      u.u_beatPulse.value = this.smoothers.beatPulse.value * this.userParams.beatToPulse;
      u.u_warpStrength.value = warpStrength;
      u.u_hueShift.value = hueShift;
      u.u_intensity.value = intensity;
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
    };
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
  metadata: plasmaMetadata,
  create: (bus) => new PlasmaVisualizer(bus),
});

// ── Shaders ────────────────────────────────────────────

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
  uniform float u_complexity;
  uniform float u_speed;
  uniform float u_scale;
  uniform float u_saturation;
  uniform float u_paletteSpeed;
  uniform float u_bass;
  uniform float u_mid;
  uniform float u_high;
  uniform float u_rms;
  uniform float u_spectralCentroid;
  uniform float u_beatPulse;
  uniform float u_warpStrength;
  uniform float u_hueShift;
  uniform float u_intensity;

  varying vec2 vUv;

  // Attempt a smooth, rich palette inspired by classic plasma
  vec3 palette(float t, float hueOff) {
    // Multi-cosine palette: attempt to create smooth transitions
    vec3 a = vec3(0.5, 0.5, 0.5);
    vec3 b = vec3(0.5, 0.5, 0.5);
    vec3 c = vec3(1.0, 1.0, 1.0);
    vec3 d = vec3(0.00 + hueOff, 0.33 + hueOff, 0.67 + hueOff);
    return a + b * cos(TAU * (c * t + d));
  }

  void main() {
    vec2 uv = (gl_FragCoord.xy - 0.5 * u_resolution) / min(u_resolution.x, u_resolution.y);
    uv = uv / u_zoom + u_center;

    // Apply bass-driven coordinate warp
    float warp = u_warpStrength;
    uv += vec2(
      sin(uv.y * 5.0 + u_time * 0.7) * warp,
      cos(uv.x * 5.0 + u_time * 0.6) * warp
    );

    // Scale to spatial frequency
    vec2 p = uv * u_scale;

    // Classic plasma: sum of sine functions at different orientations
    float value = 0.0;
    int layers = int(u_complexity);

    // Layer 1: horizontal sine
    value += sin(p.x + u_time);

    // Layer 2: vertical sine
    if (layers >= 2) {
      value += sin(p.y + u_time * 1.1);
    }

    // Layer 3: diagonal sine
    if (layers >= 3) {
      value += sin((p.x + p.y) * 0.707 + u_time * 0.8);
    }

    // Layer 4: circular pattern
    if (layers >= 4) {
      float d = length(p - vec2(sin(u_time * 0.3), cos(u_time * 0.4)));
      value += sin(d + u_time * 0.9);
    }

    // Layer 5: spiral pattern
    if (layers >= 5) {
      float angle = atan(p.y, p.x);
      float d = length(p);
      value += sin(d * 2.0 - angle + u_time * 0.7) * 0.8;
    }

    // Layer 6: interference rings from offset center
    if (layers >= 6) {
      vec2 center2 = vec2(cos(u_time * 0.5), sin(u_time * 0.6)) * 1.5;
      float d2 = length(p - center2);
      value += sin(d2 * 1.5 + u_time * 1.2) * 0.7;
    }

    // Layer 7: cross-modulation
    if (layers >= 7) {
      value += sin(p.x * sin(u_time * 0.3) + p.y * cos(u_time * 0.4)) * 0.6;
    }

    // Layer 8: fine detail
    if (layers >= 8) {
      value += sin(length(p * 2.0 + vec2(sin(u_time), cos(u_time * 0.7))) * 2.0) * 0.5;
    }

    // Normalize
    value /= float(layers) * 0.5;

    // Map to color using palette
    float paletteT = value * 0.5 + 0.5 + u_time * u_paletteSpeed;
    vec3 color = palette(paletteT, u_hueShift);

    // Desaturate control
    float gray = dot(color, vec3(0.299, 0.587, 0.114));
    color = mix(vec3(gray), color, u_saturation);

    // Intensity control
    color *= u_intensity;

    // Beat pulse: contrast boost
    float contrast = 1.0 + u_beatPulse * 0.6;
    color = (color - 0.5) * contrast + 0.5;
    color = clamp(color, 0.0, 1.5); // Allow slight overbright for HDR feel

    // High frequency detail: subtle noise grain
    float grain = sin(gl_FragCoord.x * 1.3 + gl_FragCoord.y * 0.7 + u_time * 20.0) * 0.5 + 0.5;
    color += vec3(u_high * 0.03 * grain);

    // Vignette
    float aspect = u_resolution.x / u_resolution.y;
    vec2 screenUv = gl_FragCoord.xy / u_resolution;
    float vignette = 1.0 - 0.3 * length((screenUv - 0.5) * vec2(aspect, 1.0));
    color *= vignette;

    // Background floor
    color = max(color, vec3(0.01, 0.008, 0.015));

    // Tone mapping
    color = color / (0.9 + color);

    gl_FragColor = vec4(color, 1.0);
  }
`;
