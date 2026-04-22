import * as THREE from 'three';
import { MessageBus } from '@cybernoetica/core';
import type { AudioFeatures, BusMessage, Unsubscribe } from '@cybernoetica/core';
import { EMASmoothing } from '../../smoothing.js';
import type { Visualizer, VisualizerMetadata } from '../types.js';
import { registerVisualizer } from '../registry.js';

/**
 * Dendrite — crystal/frost growth patterns inspired by diffusion-limited aggregation.
 *
 * Uses a fractal branching algorithm in the fragment shader: starting from seed
 * points, the pattern grows outward through recursive distance-field evaluation
 * of branching structures. Each branch splits at angles determined by the
 * crystallographic lattice, creating the distinctive six-fold symmetry of ice
 * crystals or the organic branching of metallic dendrites.
 *
 * The shader evaluates a procedural SDF that encodes branching: at each
 * recursive level, the space is folded via rotational symmetry, and a new
 * branch segment is placed. The accumulated minimum distance gives the
 * crystal structure.
 *
 * Audio mapping:
 *   bass      -> branch thickness / crystal mass
 *   mid       -> growth animation speed
 *   high      -> branching detail / recursion depth appearance
 *   rms       -> glow intensity
 *   beat      -> growth burst (extends crystal tips)
 *   centroid  -> color palette shift (ice blue -> gold -> copper)
 */

const dendriteMetadata: VisualizerMetadata = {
  type: 'dendrite',
  label: 'Dendrite',
  description: 'Crystal frost growth patterns',
  usesPerspective: false,
  params: [
    { key: 'branchThickness', label: 'Branch Thickness', min: 0.01, max: 0.15, step: 0.005, initial: 0.06, category: 'appearance', description: 'Width of crystal branches' },
    { key: 'growthSpeed', label: 'Growth Speed', min: 0.05, max: 1.0, step: 0.05, initial: 0.3, category: 'appearance', description: 'Crystal growth animation rate' },
    { key: 'symmetry', label: 'Symmetry', min: 3.0, max: 8.0, step: 1.0, initial: 6.0, category: 'appearance', description: 'Rotational symmetry order' },
    { key: 'branches', label: 'Branch Depth', min: 2.0, max: 6.0, step: 1.0, initial: 4.0, category: 'appearance', description: 'Branching recursion depth' },
    { key: 'brightness', label: 'Brightness', min: 0.3, max: 3.0, step: 0.1, initial: 1.5, category: 'appearance', description: 'Crystal glow intensity' },
    { key: 'branchAngle', label: 'Branch Angle', min: 15.0, max: 75.0, step: 5.0, initial: 40.0, category: 'appearance', description: 'Angle between branches (degrees)' },
    { key: 'bassToThickness', label: 'Bass → Thickness', min: 0.0, max: 2.0, step: 0.1, initial: 1.0, category: 'audio-mapping', description: 'Bass drives branch width' },
    { key: 'midToGrowth', label: 'Mid → Growth', min: 0.0, max: 2.0, step: 0.1, initial: 1.0, category: 'audio-mapping', description: 'Mids drive growth speed' },
    { key: 'highToDetail', label: 'High → Detail', min: 0.0, max: 2.0, step: 0.1, initial: 1.0, category: 'audio-mapping', description: 'Highs increase branching detail' },
    { key: 'rmsToGlow', label: 'RMS → Glow', min: 0.0, max: 2.0, step: 0.1, initial: 1.0, category: 'audio-mapping', description: 'Volume drives glow' },
    { key: 'beatToBurst', label: 'Beat → Burst', min: 0.0, max: 2.0, step: 0.1, initial: 1.0, category: 'audio-mapping', description: 'Beats extend crystal tips' },
    { key: 'centroidToColor', label: 'Centroid → Color', min: 0.0, max: 2.0, step: 0.1, initial: 0.8, category: 'audio-mapping', description: 'Spectral centroid shifts palette' },
  ],
  viewport: { pan: true, zoom: true, orbit: false },
  viewStateFields: [
    { key: 'centerX', label: 'Center X', min: -3, max: 3, step: 0.05 },
    { key: 'centerY', label: 'Center Y', min: -3, max: 3, step: 0.05 },
    { key: 'zoom', label: 'Zoom', min: 0.2, max: 6.0, step: 0.05 },
  ],
};

export class DendriteVisualizer implements Visualizer {
  readonly metadata = dendriteMetadata;

  private unsub: Unsubscribe;
  private latestFeatures: AudioFeatures | null = null;
  private time = 0;

  private userParams: Record<string, number> = {
    branchThickness: 0.06,
    growthSpeed: 0.3,
    symmetry: 6.0,
    branches: 4.0,
    brightness: 1.5,
    branchAngle: 40.0,
    bassToThickness: 1.0,
    midToGrowth: 1.0,
    highToDetail: 1.0,
    rmsToGlow: 1.0,
    beatToBurst: 1.0,
    centroidToColor: 0.8,
  };

  private _centerX = 0;
  private _centerY = 0;
  private _zoom = 1.0;

  private smoothers = {
    bass: new EMASmoothing(0.12),
    mid: new EMASmoothing(0.18),
    high: new EMASmoothing(0.22),
    rms: new EMASmoothing(0.15),
    spectralCentroid: new EMASmoothing(0.08),
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
        u_center: { value: new THREE.Vector2(0, 0) },
        u_zoom: { value: 1.0 },
        u_branchThickness: { value: 0.06 },
        u_growthSpeed: { value: 0.3 },
        u_symmetry: { value: 6.0 },
        u_branches: { value: 4.0 },
        u_brightness: { value: 1.5 },
        u_branchAngle: { value: 40.0 },
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
      const bass = this.smoothers.bass.value;
      const mid = this.smoothers.mid.value;
      const high = this.smoothers.high.value;

      u.u_time.value = this.time;
      u.u_center.value.set(this._centerX, this._centerY);
      u.u_zoom.value = this._zoom;
      u.u_branchThickness.value = this.userParams.branchThickness
        + bass * 0.03 * this.userParams.bassToThickness;
      u.u_growthSpeed.value = this.userParams.growthSpeed
        + mid * 0.2 * this.userParams.midToGrowth;
      u.u_symmetry.value = this.userParams.symmetry;
      u.u_branches.value = this.userParams.branches;
      u.u_brightness.value = this.userParams.brightness;
      u.u_branchAngle.value = this.userParams.branchAngle;
      u.u_bass.value = bass;
      u.u_mid.value = mid;
      u.u_high.value = high;
      u.u_rms.value = this.smoothers.rms.value * this.userParams.rmsToGlow;
      u.u_spectralCentroid.value = this.smoothers.spectralCentroid.value;
      u.u_beatPulse.value = this.smoothers.beatPulse.value * this.userParams.beatToBurst;
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
    if ('centerX' in partial) this._centerX = Math.max(-3, Math.min(3, partial.centerX));
    if ('centerY' in partial) this._centerY = Math.max(-3, Math.min(3, partial.centerY));
    if ('zoom' in partial) this._zoom = Math.max(0.2, Math.min(6.0, partial.zoom));
  }

  dispose(): void {
    this.unsub();
    this.material?.dispose();
    this.mesh?.geometry.dispose();
  }
}

registerVisualizer({
  metadata: dendriteMetadata,
  create: (bus) => new DendriteVisualizer(bus),
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
  #define TAU 6.28318530718

  uniform float u_time;
  uniform vec2 u_resolution;
  uniform vec2 u_center;
  uniform float u_zoom;
  uniform float u_branchThickness;
  uniform float u_growthSpeed;
  uniform float u_symmetry;
  uniform float u_branches;
  uniform float u_brightness;
  uniform float u_branchAngle;
  uniform float u_bass;
  uniform float u_mid;
  uniform float u_high;
  uniform float u_rms;
  uniform float u_spectralCentroid;
  uniform float u_beatPulse;

  varying vec2 vUv;

  vec2 rot2d(vec2 p, float a) {
    float c = cos(a), s = sin(a);
    return vec2(p.x * c - p.y * s, p.x * s + p.y * c);
  }

  float hash(vec2 p) {
    p = fract(p * vec2(443.897, 397.297));
    p += dot(p, p.yx + 19.19);
    return fract(p.x * p.y);
  }

  // Fractal ice crystal via recursive space-folding
  // Each iteration: apply N-fold symmetry, translate outward, scale down, branch
  float crystalField(vec2 p) {
    float sym = u_symmetry;
    int depth = int(u_branches);
    float angleRad = u_branchAngle * PI / 180.0;
    float thickness = u_branchThickness;

    float d = abs(p.y) - thickness;  // central line along x-axis
    float scale = 1.0;

    for (int i = 0; i < 6; i++) {
      if (i >= depth) break;

      // N-fold symmetry: fold into one sector
      float sectorAngle = TAU / sym;
      float a = atan(p.y, p.x);
      a = mod(a + sectorAngle * 0.5, sectorAngle) - sectorAngle * 0.5;
      p = vec2(cos(a), abs(sin(a))) * length(p);

      // Track distance to the radial axis (the branch)
      d = min(d, (abs(p.y) - thickness * scale) / scale);

      // Translate along branch and scale for next level
      p.x -= 0.35 * scale;
      scale *= 0.5;

      // Rotate for sub-branching
      p = rot2d(p, angleRad * 0.3);
    }

    return d;
  }

  // Growth animation: reveals crystal from center outward
  float growthMask(float r, float t) {
    float front = t * u_growthSpeed * 2.0 + 0.5 + u_beatPulse * 0.3;
    return smoothstep(front, max(front - 0.3, 0.0), r);
  }

  vec3 crystalPalette(float t, float cent) {
    float hueShift = cent * 0.4;
    vec3 a = vec3(0.5, 0.6, 0.85);
    vec3 b = vec3(0.35, 0.3, 0.3);
    vec3 c = vec3(1.0, 1.0, 0.8);
    vec3 d_col = vec3(0.0, 0.15, 0.3);
    return a + b * cos(TAU * (c * (t + hueShift) + d_col));
  }

  void main() {
    vec2 uv = (gl_FragCoord.xy - 0.5 * u_resolution) / min(u_resolution.x, u_resolution.y);
    vec2 pos = uv * 2.5 / u_zoom + u_center;

    float dist = crystalField(pos);
    float r = length(pos);
    float growth = growthMask(r, u_time);

    // Background
    vec3 bgInner = vec3(0.01, 0.015, 0.04);
    vec3 bgOuter = vec3(0.003, 0.003, 0.012);
    vec3 color = mix(bgInner, bgOuter, clamp(length(uv) * 1.5, 0.0, 1.0));

    // Crystal body with anti-aliased edge
    float pixelSize = 2.5 / (min(u_resolution.x, u_resolution.y) * u_zoom);
    float body = 1.0 - smoothstep(-pixelSize, pixelSize * 2.0, dist);
    body *= growth;

    // Glow layers
    float innerGlow = exp(-max(dist, 0.0) * 50.0) * growth;
    float outerGlow = exp(-max(dist, 0.0) * 15.0) * growth;
    float wideGlow = exp(-max(dist, 0.0) * 4.0) * growth;

    // Color varies with distance from center
    vec3 crystalColor = crystalPalette(r * 1.5 + u_time * 0.05, u_spectralCentroid);

    // Bright white-blue crystal body
    vec3 bodyColor = mix(vec3(0.85, 0.92, 1.0), crystalColor, 0.3);
    color += bodyColor * body * u_brightness * (0.8 + u_rms * 0.6);

    // Inner glow: white-blue
    color += vec3(0.6, 0.8, 1.0) * innerGlow * 0.7 * u_brightness;

    // Mid glow: colored
    color += crystalColor * outerGlow * 0.4 * u_brightness;

    // Wide atmospheric glow
    color += crystalColor * wideGlow * 0.12 * u_brightness;

    // Beat flash
    color += vec3(0.7, 0.85, 1.0) * body * u_beatPulse * 0.6;

    // High-frequency sparkle on crystal surface
    float sparkle = hash(floor(pos * 300.0) + floor(u_time * 3.0));
    sparkle = step(0.97, sparkle) * body * (0.3 + u_high * 0.7);
    color += vec3(0.8, 0.9, 1.0) * sparkle;

    // Vignette
    float aspect = u_resolution.x / u_resolution.y;
    vec2 screenUv = gl_FragCoord.xy / u_resolution;
    float vignette = 1.0 - 0.35 * length((screenUv - 0.5) * vec2(aspect, 1.0));
    color *= vignette;

    // Tone mapping
    color = color / (0.9 + color);

    gl_FragColor = vec4(color, 1.0);
  }
`;
