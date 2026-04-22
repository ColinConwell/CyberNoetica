import * as THREE from 'three';
import { MessageBus } from '@cybernoetica/core';
import type { AudioFeatures, BusMessage, Unsubscribe } from '@cybernoetica/core';
import { EMASmoothing } from '../../smoothing.js';
import type { Visualizer, VisualizerMetadata } from '../types.js';
import { registerVisualizer } from '../registry.js';

/**
 * Phyllotaxis / Fibonacci spiral visualizer -- golden ratio geometry.
 *
 * Renders thousands of points arranged in Fibonacci spiral patterns
 * (the phyllotaxis model found in sunflowers, pinecones, and galaxies).
 * The golden angle (137.508 degrees) produces optimal packing;
 * slight deviations create dramatic visual transitions between
 * spiral arm counts that follow the Fibonacci sequence.
 *
 * Spectral centroid nudges the divergence angle (creating visible spoke patterns),
 * RMS drives radial breathing, bass modulates point size for bloom,
 * and beats trigger angle quantization jumps showing different Fibonacci spiral counts.
 */

const phyllotaxisMetadata: VisualizerMetadata = {
  type: 'phyllotaxis',
  label: 'Phyllotaxis',
  description: 'Fibonacci spiral golden ratio geometry',
  usesPerspective: false,
  params: [
    // Appearance
    { key: 'pointCount', label: 'Point Count', min: 200, max: 3000, step: 100, initial: 1500, category: 'appearance' },
    { key: 'spread', label: 'Spread', min: 0.3, max: 2.0, step: 0.05, initial: 1.0, category: 'appearance' },
    { key: 'pointSize', label: 'Point Size', min: 0.5, max: 4.0, step: 0.25, initial: 1.5, category: 'appearance' },
    { key: 'colorCycle', label: 'Color Cycle', min: 0.0, max: 1.0, step: 0.05, initial: 0.3, category: 'appearance' },
    { key: 'rotationSpeed', label: 'Rotation', min: 0.0, max: 0.5, step: 0.02, initial: 0.08, category: 'appearance' },
    // Audio mapping
    { key: 'spectralToAngle', label: 'Spectral -> Angle', min: 0.0, max: 2.0, step: 0.1, initial: 1.0, category: 'audio-mapping', description: 'How strongly spectral centroid deviates the golden angle' },
    { key: 'rmsToBreath', label: 'RMS -> Breath', min: 0.0, max: 2.0, step: 0.1, initial: 1.0, category: 'audio-mapping', description: 'How strongly volume drives radial expansion' },
    { key: 'bassToSize', label: 'Bass -> Size', min: 0.0, max: 2.0, step: 0.1, initial: 1.0, category: 'audio-mapping', description: 'How strongly bass affects point bloom' },
    { key: 'midToDepth', label: 'Mid -> Depth', min: 0.0, max: 2.0, step: 0.1, initial: 1.0, category: 'audio-mapping', description: 'How strongly mids add z-displacement ripple' },
  ],
  viewport: { pan: false, zoom: true, orbit: false },
  viewStateFields: [
    { key: 'zoom', label: 'Zoom', min: 0.3, max: 4.0, step: 0.05 },
    { key: 'rotation', label: 'Rotation', min: 0, max: 6.283, step: 0.01 },
  ],
};

export class PhyllotaxisVisualizer implements Visualizer {
  readonly metadata = phyllotaxisMetadata;

  private unsub: Unsubscribe;
  private latestFeatures: AudioFeatures | null = null;
  private time = 0;
  private autoRotation = 0;

  private userParams: Record<string, number> = {
    pointCount: 1500,
    spread: 1.0,
    pointSize: 1.5,
    colorCycle: 0.3,
    rotationSpeed: 0.08,
    spectralToAngle: 1.0,
    rmsToBreath: 1.0,
    bassToSize: 1.0,
    midToDepth: 1.0,
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
        u_rotation: { value: 0.0 },
        u_pointCount: { value: 1500.0 },
        u_spread: { value: 1.0 },
        u_pointSize: { value: 1.5 },
        u_colorCycle: { value: 0.3 },
        u_bass: { value: 0.0 },
        u_mid: { value: 0.0 },
        u_high: { value: 0.0 },
        u_rms: { value: 0.1 },
        u_spectralCentroid: { value: 0.5 },
        u_beatPulse: { value: 0.0 },
        u_spectralToAngle: { value: 1.0 },
        u_rmsToBreath: { value: 1.0 },
        u_bassToSize: { value: 1.0 },
        u_midToDepth: { value: 1.0 },
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

    // Auto-rotation
    const rotSpeed = this.userParams.rotationSpeed + this.smoothers.mid.value * 0.05;
    this.autoRotation += rotSpeed / 60;

    if (this.material) {
      const u = this.material.uniforms;
      u.u_time.value = this.time;
      u.u_zoom.value = this._zoom;
      u.u_rotation.value = this.viewOverrides.rotation ? this._rotation : this.autoRotation;
      u.u_pointCount.value = this.userParams.pointCount;
      u.u_spread.value = this.userParams.spread;
      u.u_pointSize.value = this.userParams.pointSize;
      u.u_colorCycle.value = this.userParams.colorCycle;
      u.u_bass.value = this.smoothers.bass.value;
      u.u_mid.value = this.smoothers.mid.value;
      u.u_high.value = this.smoothers.high.value;
      u.u_rms.value = this.smoothers.rms.value;
      u.u_spectralCentroid.value = this.smoothers.spectralCentroid.value;
      u.u_beatPulse.value = this.smoothers.beatPulse.value;
      u.u_spectralToAngle.value = this.userParams.spectralToAngle;
      u.u_rmsToBreath.value = this.userParams.rmsToBreath;
      u.u_bassToSize.value = this.userParams.bassToSize;
      u.u_midToDepth.value = this.userParams.midToDepth;
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
  metadata: phyllotaxisMetadata,
  create: (bus) => new PhyllotaxisVisualizer(bus),
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
  #define GOLDEN_ANGLE 2.39996323  // PI * (3.0 - sqrt(5.0))

  uniform float u_time;
  uniform vec2 u_resolution;
  uniform float u_zoom;
  uniform float u_rotation;
  uniform float u_pointCount;
  uniform float u_spread;
  uniform float u_pointSize;
  uniform float u_colorCycle;
  uniform float u_bass;
  uniform float u_mid;
  uniform float u_high;
  uniform float u_rms;
  uniform float u_spectralCentroid;
  uniform float u_beatPulse;
  uniform float u_spectralToAngle;
  uniform float u_rmsToBreath;
  uniform float u_bassToSize;
  uniform float u_midToDepth;

  varying vec2 vUv;

  // --- HSV to RGB ---
  #include <cyber_hsv2rgb>

  void main() {
    vec2 uv = (gl_FragCoord.xy - 0.5 * u_resolution) / min(u_resolution.x, u_resolution.y);
    uv /= u_zoom;

    // Apply rotation
    float c = cos(u_rotation);
    float s = sin(u_rotation);
    uv = mat2(c, -s, s, c) * uv;

    // Divergence angle: golden angle + small spectral deviation
    float angleDeviation = (u_spectralCentroid - 0.5) * 0.02 * u_spectralToAngle;
    float divAngle = GOLDEN_ANGLE + angleDeviation;

    // Breathing radius multiplier from RMS
    float breathScale = 1.0 + (u_rms - 0.1) * 0.3 * u_rmsToBreath;

    // Point rendering: for each pixel, find nearest phyllotaxis point
    float minDist = 100.0;
    float nearestIndex = 0.0;
    float nearestRadius = 0.0;

    // We can't loop over all points in a fragment shader efficiently,
    // so we use an inverse approach: convert pixel to polar, estimate which
    // point index it's near, then check a neighborhood

    float pixR = length(uv);
    float pixA = atan(uv.y, uv.x);

    // Spread factor determines how tightly packed the spiral is
    float spreadFactor = 0.012 * u_spread * breathScale;

    // Estimate the index from radius: r_n = spreadFactor * sqrt(n)
    // So n ~ (r / spreadFactor)^2
    float estN = (pixR / spreadFactor) * (pixR / spreadFactor);

    // Search neighborhood around estimated index
    int searchStart = max(0, int(estN) - 12);
    int searchEnd = min(int(u_pointCount), int(estN) + 12);

    for (int i = 0; i < 25; i++) {
      int idx = searchStart + i;
      if (idx >= searchEnd) break;

      float n = float(idx);
      float theta = n * divAngle + u_time * 0.2;
      float r = spreadFactor * sqrt(n);

      // Z-displacement creates subtle depth variation
      float zDisp = sin(n * 0.1 + u_time) * u_mid * 0.003 * u_midToDepth;
      r += zDisp;

      vec2 pointPos = vec2(cos(theta), sin(theta)) * r;
      float d = length(uv - pointPos);

      if (d < minDist) {
        minDist = d;
        nearestIndex = n;
        nearestRadius = r;
      }
    }

    // Also search very small indices (center of spiral) explicitly
    for (int i = 0; i < 20; i++) {
      float n = float(i);
      float theta = n * divAngle + u_time * 0.2;
      float r = spreadFactor * sqrt(n);
      float zDisp = sin(n * 0.1 + u_time) * u_mid * 0.003 * u_midToDepth;
      r += zDisp;

      vec2 pointPos = vec2(cos(theta), sin(theta)) * r;
      float d = length(uv - pointPos);

      if (d < minDist) {
        minDist = d;
        nearestIndex = n;
        nearestRadius = r;
      }
    }

    // Point size: base + bass bloom
    float ptSize = u_pointSize * 0.004 * (1.0 + u_bass * 1.5 * u_bassToSize);

    // Soft circle rendering
    float pointIntensity = 1.0 - smoothstep(0.0, ptSize, minDist);

    // Glow halo
    float glow = exp(-minDist * minDist / (ptSize * ptSize * 4.0)) * 0.4;

    // --- Coloring ---
    // Hue based on index position in spiral (Fibonacci coloring)
    float hue = fract(nearestIndex / u_pointCount + u_time * u_colorCycle * 0.05);
    float sat = 0.6 + 0.3 * (1.0 - nearestRadius * 2.0);
    float val = pointIntensity * (0.7 + u_rms * 0.5);

    vec3 pointColor = hsv2rgb(vec3(hue, clamp(sat, 0.0, 1.0), val));

    // Glow color: slightly shifted hue
    vec3 glowColor = hsv2rgb(vec3(fract(hue + 0.1), 0.5, glow * (0.5 + u_rms * 0.8)));

    vec3 color = pointColor + glowColor;

    // Spiral arm structure: add faint connecting lines
    // Using the Fibonacci spiral arms as a background pattern
    float armAngle = atan(uv.y, uv.x);
    float armR = length(uv);
    float spiralPhase = armAngle - log(max(armR, 0.001)) * 2.39996;
    float spiralLines = pow(abs(sin(spiralPhase * 5.0 + u_time * 0.3)), 20.0) * 0.08;
    float spiralFade = smoothstep(0.0, 0.5, armR) * (1.0 - smoothstep(0.5, 1.0, armR));
    color += vec3(spiralLines * spiralFade * (0.3 + u_high * 0.7));

    // Beat: radial pulse wave
    float pulseWave = exp(-pow((pixR - fract(u_time * 0.5) * 1.2) * 8.0, 2.0));
    color += vec3(pulseWave * u_beatPulse * 0.3);

    // Background: very dark with subtle gradient
    vec3 bg = vec3(0.01, 0.008, 0.02) * (1.0 + 0.5 * (1.0 - pixR));
    color = max(color, bg);

    // Vignette
    float aspect = u_resolution.x / u_resolution.y;
    vec2 screenUv = gl_FragCoord.xy / u_resolution;
    float vignette = 1.0 - 0.35 * length((screenUv - 0.5) * vec2(aspect, 1.0));
    color *= vignette;

    // Tone mapping
    color = color / (0.85 + color);

    gl_FragColor = vec4(color, 1.0);
  }
`;
