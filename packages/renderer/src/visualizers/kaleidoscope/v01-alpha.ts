import * as THREE from 'three';
import { MessageBus } from '@cybernoetica/core';
import type { AudioFeatures, BusMessage, Unsubscribe } from '@cybernoetica/core';
import { EMASmoothing } from '../../smoothing.js';
import type { Visualizer, VisualizerMetadata } from '../types.js';
import { registerVisualizer } from '../registry.js';

/**
 * Kaleidoscope visualizer — psychedelic mandala generator.
 *
 * Math:
 *   Polar coordinates are folded into a wedge of angle 2pi / n and mirrored,
 *   which corresponds to the dihedral symmetry group D_n.
 * Reference: https://mathworld.wolfram.com/DihedralGroup.html
 *
 * Uses angular domain folding (dihedral symmetry groups) to create
 * N-fold kaleidoscopic patterns from a generative noise base.
 * The underlying pattern combines layered simplex noise with
 * spiral distortion and color cycling.
 *
 * Bass controls fold count (more folds = more symmetry axes),
 * mids drive rotation speed, spectral centroid morphs the
 * underlying pattern between organic and crystalline forms,
 * and beats trigger symmetry group transitions.
 */

const kaleidoscopeMetadata: VisualizerMetadata = {
  type: 'kaleidoscope',
  label: 'Kaleidoscope',
  description: 'Psychedelic mandala symmetry',
  usesPerspective: false,
  params: [
    // Appearance
    { key: 'foldCount', label: 'Symmetry Folds', min: 3, max: 16, step: 1, initial: 6, category: 'appearance' },
    { key: 'patternScale', label: 'Pattern Scale', min: 0.5, max: 5.0, step: 0.25, initial: 2.0, category: 'appearance' },
    { key: 'spiralStrength', label: 'Spiral Twist', min: 0.0, max: 3.0, step: 0.1, initial: 1.0, category: 'appearance' },
    { key: 'colorCycleSpeed', label: 'Color Cycle', min: 0.0, max: 1.0, step: 0.05, initial: 0.3, category: 'appearance' },
    { key: 'rotationSpeed', label: 'Rotation', min: 0.0, max: 0.5, step: 0.02, initial: 0.1, category: 'appearance' },
    // Audio mapping
    { key: 'bassToFolds', label: 'Bass → Folds', min: 0.0, max: 2.0, step: 0.1, initial: 1.0, category: 'audio-mapping', description: 'How strongly bass modulates symmetry count' },
    { key: 'midToRotation', label: 'Mid → Rotation', min: 0.0, max: 2.0, step: 0.1, initial: 1.0, category: 'audio-mapping', description: 'How strongly mids drive rotation speed' },
    { key: 'rmsToIntensity', label: 'RMS → Intensity', min: 0.0, max: 2.0, step: 0.1, initial: 1.0, category: 'audio-mapping', description: 'How strongly volume affects brightness' },
    { key: 'spectralToPattern', label: 'Spectral → Pattern', min: 0.0, max: 2.0, step: 0.1, initial: 1.0, category: 'audio-mapping', description: 'How strongly spectral centroid morphs the pattern' },
  ],
  viewport: { pan: false, zoom: true, orbit: false },
  viewStateFields: [
    { key: 'zoom', label: 'Zoom', min: 0.3, max: 4.0, step: 0.05 },
    { key: 'rotation', label: 'Rotation', min: 0, max: 6.283, step: 0.01 },
  ],
};

export class KaleidoscopeVisualizer implements Visualizer {
  readonly metadata = kaleidoscopeMetadata;

  private unsub: Unsubscribe;
  private latestFeatures: AudioFeatures | null = null;
  private time = 0;
  private autoRotation = 0;

  private userParams: Record<string, number> = {
    foldCount: 6,
    patternScale: 2.0,
    spiralStrength: 1.0,
    colorCycleSpeed: 0.3,
    rotationSpeed: 0.1,
    bassToFolds: 1.0,
    midToRotation: 1.0,
    rmsToIntensity: 1.0,
    spectralToPattern: 1.0,
  };

  private _zoom = 1.0;
  private _rotation = 0;
  private viewOverrides: Record<string, boolean> = {};

  private smoothers = {
    bass: new EMASmoothing(0.15),
    mid: new EMASmoothing(0.2),
    high: new EMASmoothing(0.25),
    rms: new EMASmoothing(0.2),
    spectralCentroid: new EMASmoothing(0.1),
    beatPulse: new EMASmoothing(0.45),
    foldSmooth: new EMASmoothing(0.05),
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
    this.smoothers.foldSmooth.reset(6);
  }

  attach(scene: THREE.Scene): void {
    this.material = new THREE.ShaderMaterial({
      vertexShader: VERTEX_SHADER,
      fragmentShader: FRAGMENT_SHADER,
      uniforms: {
        u_time: { value: 0.0 },
        u_resolution: { value: new THREE.Vector2(1920, 1080) },
        u_zoom: { value: 1.0 },
        u_rotation: { value: 0.0 },
        u_foldCount: { value: 6.0 },
        u_patternScale: { value: 2.0 },
        u_spiralStrength: { value: 1.0 },
        u_colorCycleSpeed: { value: 0.3 },
        u_bass: { value: 0.0 },
        u_mid: { value: 0.0 },
        u_high: { value: 0.0 },
        u_rms: { value: 0.1 },
        u_spectralCentroid: { value: 0.5 },
        u_beatPulse: { value: 0.0 },
        u_rmsToIntensity: { value: 1.0 },
        u_spectralToPattern: { value: 1.0 },
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

    // Auto-rotation driven by mids
    const rotSpeed = this.userParams.rotationSpeed
      + this.smoothers.mid.value * 0.15 * this.userParams.midToRotation;
    this.autoRotation += rotSpeed / 60;

    // Fold count: base + bass modulation (quantized for clean symmetry)
    const baseFolds = this.userParams.foldCount;
    const bassOffset = Math.round(this.smoothers.bass.value * 4 * this.userParams.bassToFolds);
    const targetFolds = Math.max(3, Math.min(16, baseFolds + bassOffset));
    this.smoothers.foldSmooth.update(targetFolds);

    if (this.material) {
      const u = this.material.uniforms;
      u.u_time.value = this.time;
      u.u_zoom.value = this._zoom;
      u.u_rotation.value = this.viewOverrides.rotation
        ? this._rotation
        : this.autoRotation;
      u.u_foldCount.value = this.smoothers.foldSmooth.value;
      u.u_patternScale.value = this.userParams.patternScale;
      u.u_spiralStrength.value = this.userParams.spiralStrength;
      u.u_colorCycleSpeed.value = this.userParams.colorCycleSpeed;
      u.u_bass.value = this.smoothers.bass.value;
      u.u_mid.value = this.smoothers.mid.value;
      u.u_high.value = this.smoothers.high.value;
      u.u_rms.value = this.smoothers.rms.value;
      u.u_spectralCentroid.value = this.smoothers.spectralCentroid.value;
      u.u_beatPulse.value = this.smoothers.beatPulse.value;
      u.u_rmsToIntensity.value = this.userParams.rmsToIntensity;
      u.u_spectralToPattern.value = this.userParams.spectralToPattern;
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
      rotation: this.viewOverrides.rotation ? this._rotation : this.autoRotation % (Math.PI * 2),
    };
  }

  setViewState(partial: Record<string, number>): void {
    if ('zoom' in partial) {
      this._zoom = Math.max(0.3, Math.min(4.0, partial.zoom));
      this.viewOverrides.zoom = true;
    }
    if ('rotation' in partial) {
      this._rotation = partial.rotation;
      this.viewOverrides.rotation = true;
    }
  }

  dispose(): void {
    this.unsub();
    this.material?.dispose();
    this.mesh?.geometry.dispose();
  }
}

registerVisualizer({
  metadata: kaleidoscopeMetadata,
  create: (bus) => new KaleidoscopeVisualizer(bus),
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

  #define PI 3.14159265359
  #define TAU 6.28318530718

  uniform float u_time;
  uniform vec2 u_resolution;
  uniform float u_zoom;
  uniform float u_rotation;
  uniform float u_foldCount;
  uniform float u_patternScale;
  uniform float u_spiralStrength;
  uniform float u_colorCycleSpeed;
  uniform float u_bass;
  uniform float u_mid;
  uniform float u_high;
  uniform float u_rms;
  uniform float u_spectralCentroid;
  uniform float u_beatPulse;
  uniform float u_rmsToIntensity;
  uniform float u_spectralToPattern;

  varying vec2 vUv;

  // --- Noise functions ---

  // 2D hash
  vec2 hash2(vec2 p) {
    p = vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)));
    return -1.0 + 2.0 * fract(sin(p) * 43758.5453123);
  }

  // Gradient noise (simplex-like)
  float gnoise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);

    return mix(
      mix(dot(hash2(i + vec2(0.0, 0.0)), f - vec2(0.0, 0.0)),
          dot(hash2(i + vec2(1.0, 0.0)), f - vec2(1.0, 0.0)), u.x),
      mix(dot(hash2(i + vec2(0.0, 1.0)), f - vec2(0.0, 1.0)),
          dot(hash2(i + vec2(1.0, 1.0)), f - vec2(1.0, 1.0)), u.x),
      u.y
    );
  }

  // Fractal Brownian Motion
  float fbm(vec2 p) {
    float value = 0.0;
    float amplitude = 0.5;
    float frequency = 1.0;
    for (int i = 0; i < 5; i++) {
      value += amplitude * gnoise(p * frequency);
      frequency *= 2.0;
      amplitude *= 0.5;
    }
    return value;
  }

  // --- HSV to RGB ---
  vec3 hsv2rgb(vec3 c) {
    vec4 K = vec4(1.0, 2.0 / 3.0, 1.0 / 3.0, 3.0);
    vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
    return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
  }

  // --- Kaleidoscope fold ---
  vec2 kaleidoscope(vec2 uv, float n) {
    float angle = atan(uv.y, uv.x);
    float radius = length(uv);

    // N-fold rotational symmetry
    float segmentAngle = TAU / n;
    angle = mod(angle, segmentAngle);

    // Mirror within segment (dihedral symmetry)
    angle = min(angle, segmentAngle - angle);

    return vec2(cos(angle), sin(angle)) * radius;
  }

  void main() {
    vec2 uv = (gl_FragCoord.xy - 0.5 * u_resolution) / min(u_resolution.x, u_resolution.y);
    uv /= u_zoom;

    // Apply rotation
    float c = cos(u_rotation);
    float s = sin(u_rotation);
    uv = mat2(c, -s, s, c) * uv;

    // Kaleidoscope fold
    float folds = max(3.0, floor(u_foldCount + 0.5));
    vec2 kUv = kaleidoscope(uv, folds);

    float radius = length(uv);

    // Spiral distortion
    float spiralAngle = radius * u_spiralStrength * (2.0 + u_bass * 3.0);
    float sc = cos(spiralAngle);
    float ss = sin(spiralAngle);
    kUv = mat2(sc, -ss, ss, sc) * kUv;

    // Pattern coordinates
    vec2 patternUv = kUv * u_patternScale;

    // Animate pattern
    float t = u_time * 0.15;

    // Organic vs crystalline blend driven by spectral centroid
    float organicBlend = u_spectralCentroid * u_spectralToPattern;

    // Layer 1: flowing noise
    float n1 = fbm(patternUv + vec2(t * 0.3, t * 0.2));

    // Layer 2: warped by first layer
    float n2 = fbm(patternUv + vec2(n1 * 0.8 * organicBlend, t * 0.1));

    // Layer 3: radial structure
    float n3 = fbm(patternUv * 1.5 + vec2(cos(t * 0.4) * 0.5, sin(t * 0.3) * 0.5));

    // Combine layers
    float pattern = n1 * 0.4 + n2 * 0.35 + n3 * 0.25;

    // Add radial pulse on bass
    pattern += sin(radius * 8.0 - u_time * 2.0) * u_bass * 0.3;

    // --- Coloring ---
    float hue = fract(pattern * 0.5 + u_time * u_colorCycleSpeed * 0.1 + radius * 0.2);
    float sat = 0.55 + 0.35 * abs(sin(pattern * PI));
    float val = 0.2 + 0.5 * (0.5 + 0.5 * pattern);

    // Audio brightness
    val *= 0.7 + u_rms * 0.6 * u_rmsToIntensity;
    val += u_beatPulse * 0.15;

    // Radial fade for depth
    val *= 1.0 - 0.3 * smoothstep(0.0, 1.5, radius);

    vec3 color = hsv2rgb(vec3(hue, sat, val));

    // Beat: brief white flash at center
    float centerFlash = u_beatPulse * exp(-radius * radius * 8.0) * 0.3;
    color += vec3(centerFlash);

    // Edge highlight between folds
    float originalAngle = atan(uv.y, uv.x);
    float segAngle = TAU / folds;
    float edgeDist = abs(mod(originalAngle + segAngle * 0.5, segAngle) - segAngle * 0.5);
    float edgeGlow = exp(-edgeDist * edgeDist * 400.0) * u_high * 0.3;
    color += vec3(edgeGlow * 0.5, edgeGlow * 0.3, edgeGlow);

    // Background
    vec3 bg = vec3(0.01, 0.01, 0.025);
    color = max(color, bg);

    // Vignette
    float aspect = u_resolution.x / u_resolution.y;
    vec2 screenUv = gl_FragCoord.xy / u_resolution;
    float vignette = 1.0 - 0.4 * length((screenUv - 0.5) * vec2(aspect, 1.0));
    color *= vignette;

    // Tone mapping
    color = color / (1.0 + color);

    gl_FragColor = vec4(color, 1.0);
  }
`;
