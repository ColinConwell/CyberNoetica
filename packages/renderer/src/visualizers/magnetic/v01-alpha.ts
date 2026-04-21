import * as THREE from 'three';
import { MessageBus } from '@cybernoetica/core';
import type { AudioFeatures, BusMessage, Unsubscribe } from '@cybernoetica/core';
import { EMASmoothing } from '../../smoothing.js';
import type { Visualizer, VisualizerMetadata } from '../types.js';
import { registerVisualizer } from '../registry.js';

/**
 * Magnetic Field — dipole/multipole field line visualization.
 *
 * Renders the magnetic field of N oscillating point charges using
 * the analytic dipole formula in 2D (field of infinite wire segments).
 * Each pole's position and strength are audio-driven, creating flowing
 * field line patterns that breathe with the music.
 *
 * The field direction is visualized via line-integral convolution (LIC)
 * approximation: at each pixel, we trace the field direction to build
 * streaklines colored by field magnitude and direction.
 *
 * Audio mapping:
 *   bass  -> pole separation (breathes the dipole apart)
 *   mid   -> pole rotation speed
 *   rms   -> field glow intensity
 *   beat  -> polarity flips / charge pulses
 *   high  -> detail / streak length
 *   centroid -> color palette
 */

const magneticMetadata: VisualizerMetadata = {
  type: 'magnetic',
  label: 'Magnetic Field',
  description: 'Electromagnetic dipole/multipole field lines',
  usesPerspective: false,
  params: [
    { key: 'poleCount', label: 'Pole Count', min: 2, max: 6, step: 1, initial: 2, category: 'appearance', description: 'Number of magnetic poles' },
    { key: 'poleSeparation', label: 'Separation', min: 0.1, max: 1.5, step: 0.05, initial: 0.5, category: 'appearance', description: 'Distance between poles' },
    { key: 'streakLength', label: 'Streak Length', min: 4, max: 32, step: 2, initial: 16, category: 'appearance', description: 'Field line trace steps' },
    { key: 'fieldIntensity', label: 'Intensity', min: 0.5, max: 3.0, step: 0.1, initial: 1.5, category: 'appearance', description: 'Field strength multiplier' },
    { key: 'rotationSpeed', label: 'Rotation', min: 0.0, max: 1.0, step: 0.05, initial: 0.15, category: 'appearance', description: 'Pole orbit speed' },
    { key: 'colorWarmth', label: 'Warmth', min: 0.0, max: 1.0, step: 0.05, initial: 0.5, category: 'appearance', description: 'Color temperature' },
    { key: 'brightness', label: 'Brightness', min: 0.3, max: 3.0, step: 0.1, initial: 1.4, category: 'appearance' },
    { key: 'bassToSeparation', label: 'Bass → Spread', min: 0.0, max: 2.0, step: 0.1, initial: 1.0, category: 'audio-mapping', description: 'Bass breathes poles apart' },
    { key: 'midToRotation', label: 'Mid → Rotation', min: 0.0, max: 2.0, step: 0.1, initial: 1.0, category: 'audio-mapping', description: 'Mids drive pole orbit' },
    { key: 'rmsToGlow', label: 'RMS → Glow', min: 0.0, max: 2.0, step: 0.1, initial: 1.0, category: 'audio-mapping', description: 'Volume drives field glow' },
    { key: 'beatToFlip', label: 'Beat → Pulse', min: 0.0, max: 2.0, step: 0.1, initial: 1.0, category: 'audio-mapping', description: 'Beats pulse charge strength' },
    { key: 'highToDetail', label: 'High → Detail', min: 0.0, max: 2.0, step: 0.1, initial: 0.8, category: 'audio-mapping', description: 'Highs add streak detail' },
    { key: 'centroidToColor', label: 'Centroid → Color', min: 0.0, max: 2.0, step: 0.1, initial: 0.8, category: 'audio-mapping', description: 'Spectral centroid shifts palette' },
  ],
  viewport: { pan: true, zoom: true, orbit: false },
  viewStateFields: [
    { key: 'zoom', label: 'Zoom', min: 0.2, max: 4.0, step: 0.05 },
    { key: 'panX', label: 'Pan X', min: -3, max: 3, step: 0.05 },
    { key: 'panY', label: 'Pan Y', min: -3, max: 3, step: 0.05 },
  ],
};

export class MagneticVisualizer implements Visualizer {
  readonly metadata = magneticMetadata;

  private unsub: Unsubscribe;
  private latestFeatures: AudioFeatures | null = null;
  private time = 0;

  private userParams: Record<string, number> = {
    poleCount: 2,
    poleSeparation: 0.5,
    streakLength: 16,
    fieldIntensity: 1.5,
    rotationSpeed: 0.15,
    colorWarmth: 0.5,
    brightness: 1.4,
    bassToSeparation: 1.0,
    midToRotation: 1.0,
    rmsToGlow: 1.0,
    beatToFlip: 1.0,
    highToDetail: 0.8,
    centroidToColor: 0.8,
  };

  private _zoom = 1.0;
  private _panX = 0.0;
  private _panY = 0.0;
  private viewOverrides: Record<string, boolean> = {};

  private smoothers = {
    bass: new EMASmoothing(0.12),
    mid: new EMASmoothing(0.18),
    high: new EMASmoothing(0.22),
    rms: new EMASmoothing(0.15),
    spectralCentroid: new EMASmoothing(0.1),
    spectralFlux: new EMASmoothing(0.2),
    beatPulse: new EMASmoothing(0.4),
  };

  private chargePulse = new EMASmoothing(0.08);
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
    this.chargePulse.reset(0);
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
        u_poleCount: { value: 2.0 },
        u_poleSeparation: { value: 0.5 },
        u_streakLength: { value: 16.0 },
        u_fieldIntensity: { value: 1.5 },
        u_rotationSpeed: { value: 0.15 },
        u_colorWarmth: { value: 0.5 },
        u_brightness: { value: 1.4 },
        u_bass: { value: 0.0 },
        u_mid: { value: 0.0 },
        u_high: { value: 0.0 },
        u_rms: { value: 0.1 },
        u_spectralCentroid: { value: 0.5 },
        u_beatPulse: { value: 0.0 },
        u_chargePulse: { value: 0.0 },
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

      if (f.beatOnset && this.userParams.beatToFlip > 0) {
        this.chargePulse.reset(1.0);
      }
    } else {
      this.smoothers.beatPulse.update(0.0);
    }

    this.chargePulse.update(0.0);

    if (this.material) {
      const u = this.material.uniforms;
      const bass = this.smoothers.bass.value;
      const mid = this.smoothers.mid.value;
      const high = this.smoothers.high.value;

      u.u_time.value = this.time;
      u.u_zoom.value = this._zoom;
      u.u_pan.value.set(this._panX, this._panY);
      u.u_poleCount.value = this.userParams.poleCount;
      u.u_poleSeparation.value = this.userParams.poleSeparation
        + bass * 0.2 * this.userParams.bassToSeparation;
      u.u_streakLength.value = this.userParams.streakLength
        + high * 6.0 * this.userParams.highToDetail;
      u.u_fieldIntensity.value = this.userParams.fieldIntensity;
      u.u_rotationSpeed.value = this.userParams.rotationSpeed
        + mid * 0.15 * this.userParams.midToRotation;
      u.u_colorWarmth.value = this.userParams.colorWarmth
        + this.smoothers.spectralCentroid.value * 0.2 * this.userParams.centroidToColor;
      u.u_brightness.value = this.userParams.brightness;
      u.u_bass.value = bass;
      u.u_mid.value = mid;
      u.u_high.value = high;
      u.u_rms.value = this.smoothers.rms.value * this.userParams.rmsToGlow;
      u.u_spectralCentroid.value = this.smoothers.spectralCentroid.value;
      u.u_beatPulse.value = this.smoothers.beatPulse.value;
      u.u_chargePulse.value = this.chargePulse.value * this.userParams.beatToFlip;
    }
  }

  setResolution(width: number, height: number): void {
    if (this.material) this.material.uniforms.u_resolution.value.set(width, height);
  }

  setUserParam(key: string, value: number): void {
    if (key in this.userParams) this.userParams[key] = value;
  }

  getViewState(): Record<string, number> {
    return { zoom: this._zoom, panX: this._panX, panY: this._panY };
  }

  setViewState(partial: Record<string, number>): void {
    if ('zoom' in partial) {
      this._zoom = Math.max(0.2, Math.min(4.0, partial.zoom));
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
  metadata: magneticMetadata,
  create: (bus) => new MagneticVisualizer(bus),
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
  #define MAX_POLES 6

  uniform float u_time;
  uniform vec2 u_resolution;
  uniform float u_zoom;
  uniform vec2 u_pan;
  uniform float u_poleCount;
  uniform float u_poleSeparation;
  uniform float u_streakLength;
  uniform float u_fieldIntensity;
  uniform float u_rotationSpeed;
  uniform float u_colorWarmth;
  uniform float u_brightness;
  uniform float u_bass;
  uniform float u_mid;
  uniform float u_high;
  uniform float u_rms;
  uniform float u_spectralCentroid;
  uniform float u_beatPulse;
  uniform float u_chargePulse;

  varying vec2 vUv;

  vec3 hsv2rgb(vec3 c) {
    vec4 K = vec4(1.0, 2.0 / 3.0, 1.0 / 3.0, 3.0);
    vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
    return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
  }

  // Compute pole positions (alternating charge, arranged in circle or line)
  vec2 polePosition(int idx, int count) {
    float fi = float(idx);
    float fc = float(count);
    float angle = TAU * fi / fc + u_time * u_rotationSpeed;
    float r = u_poleSeparation;
    return vec2(cos(angle) * r, sin(angle) * r);
  }

  float poleCharge(int idx, int count) {
    float base = (mod(float(idx), 2.0) < 0.5) ? 1.0 : -1.0;
    // Beat pulses modulate charge magnitude
    return base * (1.0 + u_chargePulse * 0.5);
  }

  // Compute total magnetic field at position p
  vec2 fieldAt(vec2 p, int count) {
    vec2 B = vec2(0.0);
    for (int i = 0; i < MAX_POLES; i++) {
      if (i >= count) break;
      vec2 pole = polePosition(i, count);
      float q = poleCharge(i, count);
      vec2 r = p - pole;
      float d2 = dot(r, r) + 0.01; // Softening to avoid singularity
      // 2D "magnetic" field: radial from positive, inward to negative
      // For dipole-like behavior, use gradient of potential
      B += q * r / (d2 * u_fieldIntensity);
    }
    return B;
  }

  // Pseudo-random hash
  float hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
  }

  void main() {
    vec2 uv = (gl_FragCoord.xy - 0.5 * u_resolution) / min(u_resolution.x, u_resolution.y);

    float scale = 2.5 / u_zoom;
    vec2 pos = uv * scale + u_pan;

    int count = int(u_poleCount);
    int streaks = int(u_streakLength);

    // Compute field at this pixel
    vec2 B = fieldAt(pos, count);
    float fieldMag = length(B);
    vec2 fieldDir = fieldMag > 0.001 ? normalize(B) : vec2(0.0);

    // Line-integral convolution: trace field line in both directions
    float lic = 0.0;
    float totalWeight = 0.0;
    vec2 tracePos = pos;
    float stepSize = 0.008 / u_zoom;

    // Forward trace
    for (int i = 0; i < 32; i++) {
      if (i >= streaks) break;
      vec2 localB = fieldAt(tracePos, count);
      float localMag = length(localB);
      if (localMag < 0.0001) break;
      vec2 dir = normalize(localB);
      tracePos += dir * stepSize;

      float noise = hash(tracePos * 50.0 + vec2(u_time * 0.3));
      float w = 1.0 / (1.0 + float(i) * 0.15);
      lic += noise * w;
      totalWeight += w;
    }

    // Backward trace
    tracePos = pos;
    for (int i = 0; i < 32; i++) {
      if (i >= streaks) break;
      vec2 localB = fieldAt(tracePos, count);
      float localMag = length(localB);
      if (localMag < 0.0001) break;
      vec2 dir = normalize(localB);
      tracePos -= dir * stepSize;

      float noise = hash(tracePos * 50.0 + vec2(u_time * 0.3));
      float w = 1.0 / (1.0 + float(i) * 0.15);
      lic += noise * w;
      totalWeight += w;
    }

    lic = totalWeight > 0.0 ? lic / totalWeight : 0.5;

    // Field magnitude drives base brightness
    float magNorm = 1.0 - exp(-fieldMag * 3.0);

    // Direction angle for coloring
    float angle = atan(B.y, B.x);

    // Color: warm/cool based on field direction and magnitude
    float hue = fract(angle / TAU + u_colorWarmth * 0.5 + u_spectralCentroid * 0.15);
    float sat = 0.6 + 0.3 * magNorm;
    float val = lic * magNorm * u_brightness * (0.5 + u_rms * 0.8);

    // Enhance near poles (high field regions)
    val += magNorm * magNorm * 0.3 * u_brightness;

    // Beat flash
    val += u_beatPulse * 0.15 * magNorm;

    // High frequencies add sparkle at field line intersections
    float sparkle = pow(abs(lic - 0.5) * 2.0, 3.0);
    val += sparkle * u_high * 0.25;

    vec3 color = hsv2rgb(vec3(hue, sat, clamp(val, 0.0, 1.0)));

    // Pole glow: bright spots at pole positions
    for (int i = 0; i < MAX_POLES; i++) {
      if (i >= count) break;
      vec2 pole = polePosition(i, count);
      float q = poleCharge(i, count);
      float d = length(pos - pole);
      float glow = exp(-d * d * 40.0 * u_zoom * u_zoom);
      vec3 poleColor = q > 0.0
        ? vec3(1.0, 0.3, 0.1)  // Positive: warm
        : vec3(0.1, 0.3, 1.0); // Negative: cool
      color += poleColor * glow * 1.5 * (1.0 + u_beatPulse * 0.5);
    }

    // Dark background
    vec3 bg = vec3(0.005, 0.006, 0.018);
    color = max(color, bg);

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
