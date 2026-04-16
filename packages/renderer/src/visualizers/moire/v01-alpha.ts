import * as THREE from 'three';
import { MessageBus } from '@cybernoetica/core';
import type { AudioFeatures, BusMessage, Unsubscribe } from '@cybernoetica/core';
import { EMASmoothing } from '../../smoothing.js';
import type { Visualizer, VisualizerMetadata } from '../types.js';
import { registerVisualizer } from '../registry.js';

/**
 * Moire visualizer -- interference pattern generator.
 *
 * Overlays multiple sets of concentric circles or parallel lines at
 * slightly different scales, positions, and rotations to produce moire
 * interference patterns. The resulting visual illusion creates organic,
 * flowing structures from simple geometric primitives.
 *
 * Audio mapping: bass shifts the offset between grating centers (creating
 * large-scale pattern motion), mids control grating frequency (line density),
 * spectral centroid rotates gratings, and RMS drives overall contrast.
 * Beat detection triggers sudden angular shifts for dramatic reconfigurations.
 */

const moireMetadata: VisualizerMetadata = {
  type: 'moire',
  label: 'Moire',
  description: 'Overlapping grating interference patterns',
  usesPerspective: false,
  params: [
    // Appearance
    { key: 'gratingFreq', label: 'Grating Density', min: 5.0, max: 60.0, step: 1.0, initial: 25.0, category: 'appearance', description: 'Base spatial frequency of gratings' },
    { key: 'layerCount', label: 'Layers', min: 2, max: 5, step: 1, initial: 3, category: 'appearance', description: 'Number of overlapping grating layers' },
    { key: 'patternType', label: 'Pattern Type', min: 0.0, max: 1.0, step: 0.05, initial: 0.5, category: 'appearance', description: 'Concentric circles (0) vs radial lines (1)' },
    { key: 'contrast', label: 'Contrast', min: 0.3, max: 2.0, step: 0.05, initial: 1.0, category: 'appearance' },
    { key: 'rotationSpeed', label: 'Rotation Speed', min: 0.0, max: 0.5, step: 0.01, initial: 0.08, category: 'appearance' },
    { key: 'colorShift', label: 'Color Shift', min: 0.0, max: 1.0, step: 0.05, initial: 0.4, category: 'appearance', description: 'Hue offset between layers' },
    // Audio mapping
    { key: 'bassToOffset', label: 'Bass -> Offset', min: 0.0, max: 2.0, step: 0.1, initial: 1.0, category: 'audio-mapping', description: 'Bass shifts grating centers' },
    { key: 'midToFreq', label: 'Mid -> Density', min: 0.0, max: 2.0, step: 0.1, initial: 1.0, category: 'audio-mapping', description: 'Mids modulate grating frequency' },
    { key: 'spectralToRotation', label: 'Spectral -> Rotation', min: 0.0, max: 2.0, step: 0.1, initial: 1.0, category: 'audio-mapping', description: 'Spectral centroid drives rotation' },
    { key: 'rmsToContrast', label: 'RMS -> Contrast', min: 0.0, max: 2.0, step: 0.1, initial: 1.0, category: 'audio-mapping', description: 'Volume boosts pattern contrast' },
  ],
  viewport: { pan: true, zoom: true, orbit: false },
  viewStateFields: [
    { key: 'centerX', label: 'Center X', min: -2, max: 2, step: 0.05 },
    { key: 'centerY', label: 'Center Y', min: -2, max: 2, step: 0.05 },
    { key: 'zoom', label: 'Zoom', min: 0.3, max: 4.0, step: 0.05 },
  ],
};

export class MoireVisualizer implements Visualizer {
  readonly metadata = moireMetadata;

  private unsub: Unsubscribe;
  private latestFeatures: AudioFeatures | null = null;
  private time = 0;

  private userParams: Record<string, number> = {
    gratingFreq: 25.0,
    layerCount: 3,
    patternType: 0.5,
    contrast: 1.0,
    rotationSpeed: 0.08,
    colorShift: 0.4,
    bassToOffset: 1.0,
    midToFreq: 1.0,
    spectralToRotation: 1.0,
    rmsToContrast: 1.0,
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
    this.material = new THREE.ShaderMaterial({
      vertexShader: VERTEX_SHADER,
      fragmentShader: FRAGMENT_SHADER,
      uniforms: {
        u_time: { value: 0.0 },
        u_resolution: { value: new THREE.Vector2(1920, 1080) },
        u_zoom: { value: 1.0 },
        u_center: { value: new THREE.Vector2(0, 0) },
        u_gratingFreq: { value: 25.0 },
        u_layerCount: { value: 3.0 },
        u_patternType: { value: 0.5 },
        u_contrast: { value: 1.0 },
        u_rotationSpeed: { value: 0.08 },
        u_colorShift: { value: 0.4 },
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
      this.smoothers.beatPulse.update(f.beatOnset ? 1.0 : 0.0);
    } else {
      this.smoothers.beatPulse.update(0.0);
    }

    if (this.material) {
      const u = this.material.uniforms;
      u.u_time.value = this.time;
      u.u_zoom.value = this._zoom;
      u.u_center.value.set(this._centerX, this._centerY);

      // Effective grating frequency modulated by mids
      const effFreq = this.userParams.gratingFreq
        + this.smoothers.mid.value * 8.0 * this.userParams.midToFreq;
      u.u_gratingFreq.value = effFreq;

      u.u_layerCount.value = this.userParams.layerCount;
      u.u_patternType.value = this.userParams.patternType;

      // Contrast boosted by RMS
      const effContrast = this.userParams.contrast
        * (0.6 + this.smoothers.rms.value * 0.8 * this.userParams.rmsToContrast);
      u.u_contrast.value = effContrast;

      u.u_rotationSpeed.value = this.userParams.rotationSpeed;
      u.u_colorShift.value = this.userParams.colorShift;
      u.u_bass.value = this.smoothers.bass.value;
      u.u_mid.value = this.smoothers.mid.value;
      u.u_high.value = this.smoothers.high.value;
      u.u_rms.value = this.smoothers.rms.value;
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
      centerX: this._centerX,
      centerY: this._centerY,
      zoom: this._zoom,
    };
  }

  setViewState(partial: Record<string, number>): void {
    if ('centerX' in partial) {
      this._centerX = Math.max(-2, Math.min(2, partial.centerX));
      this.viewOverrides.pan = true;
    }
    if ('centerY' in partial) {
      this._centerY = Math.max(-2, Math.min(2, partial.centerY));
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
  metadata: moireMetadata,
  create: (bus) => new MoireVisualizer(bus),
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

  uniform float u_time;
  uniform vec2 u_resolution;
  uniform float u_zoom;
  uniform vec2 u_center;
  uniform float u_gratingFreq;
  uniform float u_layerCount;
  uniform float u_patternType;
  uniform float u_contrast;
  uniform float u_rotationSpeed;
  uniform float u_colorShift;
  uniform float u_bass;
  uniform float u_mid;
  uniform float u_high;
  uniform float u_rms;
  uniform float u_spectralCentroid;
  uniform float u_beatPulse;

  varying vec2 vUv;

  // HSV to RGB
  vec3 hsv2rgb(vec3 c) {
    vec4 K = vec4(1.0, 2.0 / 3.0, 1.0 / 3.0, 3.0);
    vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
    return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
  }

  // Rotate a 2D point
  vec2 rotate(vec2 p, float angle) {
    float c = cos(angle);
    float s = sin(angle);
    return vec2(p.x * c - p.y * s, p.x * s + p.y * c);
  }

  // Single grating layer: concentric circles blended with radial lines
  float grating(vec2 p, float freq, float blend) {
    // Concentric circles pattern
    float circles = sin(length(p) * freq * TAU);

    // Radial line pattern (angular)
    float angle = atan(p.y, p.x);
    float radial = sin(angle * freq * 0.5);

    return mix(circles, radial, blend);
  }

  void main() {
    vec2 uv = (gl_FragCoord.xy - 0.5 * u_resolution) / min(u_resolution.x, u_resolution.y);
    uv = uv / u_zoom + u_center;

    int layers = int(u_layerCount);
    float accumR = 0.0;
    float accumG = 0.0;
    float accumB = 0.0;

    for (int i = 0; i < 5; i++) {
      if (i >= layers) break;
      float fi = float(i);

      // Each layer has a different center, rotation, and slight frequency offset
      float layerAngle = fi * PI / float(layers)
        + u_time * u_rotationSpeed * (1.0 + fi * 0.3)
        + u_spectralCentroid * fi * 0.5;

      // Center offset: each layer drifts based on bass
      float offsetScale = 0.1 + u_bass * 0.15;
      vec2 layerCenter = vec2(
        sin(u_time * 0.3 + fi * 2.094) * offsetScale,
        cos(u_time * 0.25 + fi * 2.094) * offsetScale
      );

      // Frequency varies slightly per layer for richer interference
      float layerFreq = u_gratingFreq * (1.0 + fi * 0.08);

      // Compute grating value
      vec2 p = rotate(uv - layerCenter, layerAngle);
      float g = grating(p, layerFreq, u_patternType);

      // Map to 0-1 range
      g = g * 0.5 + 0.5;
      g = pow(g, 1.0 / u_contrast);

      // Color: each layer has a hue offset
      float hue = fract(fi * u_colorShift / float(layers) + u_time * 0.02);
      vec3 layerColor = hsv2rgb(vec3(hue, 0.5 + u_rms * 0.3, g));

      accumR += layerColor.r;
      accumG += layerColor.g;
      accumB += layerColor.b;
    }

    // Average the layers
    float invLayers = 1.0 / float(layers);
    vec3 color = vec3(accumR, accumG, accumB) * invLayers;

    // Interference boost: multiply layers for stronger moire effect
    // The magic of moire comes from the multiplication (or modulation)
    // Blend between additive average and multiplicative interference
    float interferenceStrength = 0.5 + u_rms * 0.3;

    // Apply contrast enhancement to bring out interference fringes
    color = (color - 0.5) * (1.0 + interferenceStrength) + 0.5;
    color = clamp(color, 0.0, 1.0);

    // Beat pulse: invert pattern briefly
    color = mix(color, 1.0 - color, u_beatPulse * 0.3);

    // High frequency shimmer on interference peaks
    float brightness = dot(color, vec3(0.299, 0.587, 0.114));
    color += vec3(u_high * 0.1 * brightness * sin(length(uv) * 50.0 + u_time * 5.0));

    // Vignette
    float aspect = u_resolution.x / u_resolution.y;
    vec2 screenUv = gl_FragCoord.xy / u_resolution;
    float vignette = 1.0 - 0.35 * length((screenUv - 0.5) * vec2(aspect, 1.0));
    color *= vignette;

    // Subtle dark background floor
    color = max(color, vec3(0.01, 0.008, 0.015));

    // Tone mapping
    color = color / (0.9 + color);

    gl_FragColor = vec4(color, 1.0);
  }
`;
