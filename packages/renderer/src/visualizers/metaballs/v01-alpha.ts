import * as THREE from 'three';
import { MessageBus } from '@cybernoetica/core';
import type { AudioFeatures, BusMessage, Unsubscribe } from '@cybernoetica/core';
import { EMASmoothing } from '../../smoothing.js';
import type { Visualizer, VisualizerMetadata } from '../types.js';
import { registerVisualizer } from '../registry.js';

/**
 * Metaballs visualizer -- organic blob field rendered by scalar summation.
 *
 * Classic Blinn-style metaballs: the field at each pixel is
 *     f(p) = sum_i  r_i^2 / |p - c_i|^2
 * A threshold isosurface creates smooth blob outlines that merge as the
 * ball centers drift. Ball positions orbit on Lissajous-like paths and
 * are modulated by audio features.
 *
 * Audio mapping:
 *   bass  -> ball radii inflation
 *   mid   -> orbit speed
 *   high  -> iso edge sharpness
 *   rms   -> overall glow
 *   beat  -> radial pulse wave
 */

const NUM_BALLS = 7;

const metaballsMetadata: VisualizerMetadata = {
  type: 'metaballs',
  label: 'Metaballs',
  description: 'Organic blob field with isosurface glow',
  usesPerspective: false,
  params: [
    // Appearance
    { key: 'ballCount', label: 'Ball Count', min: 3, max: 7, step: 1, initial: 6, category: 'appearance', description: 'Number of active metaballs' },
    { key: 'radius', label: 'Radius', min: 0.1, max: 0.6, step: 0.01, initial: 0.28, category: 'appearance', description: 'Base metaball radius' },
    { key: 'threshold', label: 'Threshold', min: 0.5, max: 2.5, step: 0.05, initial: 1.1, category: 'appearance', description: 'Isosurface level' },
    { key: 'edgeSharpness', label: 'Edge Sharpness', min: 0.01, max: 0.3, step: 0.005, initial: 0.08, category: 'appearance', description: 'Smoothness of isoline' },
    { key: 'orbitSpeed', label: 'Orbit Speed', min: 0.05, max: 2.0, step: 0.05, initial: 0.5, category: 'appearance', description: 'Ball drift speed' },
    { key: 'hue', label: 'Hue', min: 0.0, max: 1.0, step: 0.01, initial: 0.55, category: 'appearance', description: 'Base palette hue' },
    { key: 'colorSpread', label: 'Color Spread', min: 0.0, max: 1.0, step: 0.01, initial: 0.35, category: 'appearance', description: 'Hue variation across balls' },
    // Audio mapping
    { key: 'bassToSize', label: 'Bass \u2192 Size', min: 0.0, max: 2.0, step: 0.1, initial: 1.0, category: 'audio-mapping', description: 'Bass inflates balls' },
    { key: 'midToSpeed', label: 'Mid \u2192 Speed', min: 0.0, max: 2.0, step: 0.1, initial: 1.0, category: 'audio-mapping', description: 'Mids speed up orbits' },
    { key: 'highToEdge', label: 'High \u2192 Edge', min: 0.0, max: 2.0, step: 0.1, initial: 1.0, category: 'audio-mapping', description: 'Highs sharpen isoline' },
    { key: 'rmsToGlow', label: 'RMS \u2192 Glow', min: 0.0, max: 2.0, step: 0.1, initial: 1.0, category: 'audio-mapping', description: 'Volume drives inner glow' },
    { key: 'beatToPulse', label: 'Beat \u2192 Pulse', min: 0.0, max: 2.0, step: 0.1, initial: 1.0, category: 'audio-mapping', description: 'Beats emit radial pulse' },
  ],
  viewport: { pan: true, zoom: true, orbit: false },
  viewStateFields: [
    { key: 'centerX', label: 'Center X', min: -3, max: 3, step: 0.05 },
    { key: 'centerY', label: 'Center Y', min: -3, max: 3, step: 0.05 },
    { key: 'zoom', label: 'Zoom', min: 0.3, max: 4.0, step: 0.05 },
  ],
};

export class MetaballsVisualizer implements Visualizer {
  readonly metadata = metaballsMetadata;

  private unsub: Unsubscribe;
  private latestFeatures: AudioFeatures | null = null;
  private time = 0;
  private phaseAccum = 0;

  private userParams: Record<string, number> = {
    ballCount: 6,
    radius: 0.28,
    threshold: 1.1,
    edgeSharpness: 0.08,
    orbitSpeed: 0.5,
    hue: 0.55,
    colorSpread: 0.35,
    bassToSize: 1.0,
    midToSpeed: 1.0,
    highToEdge: 1.0,
    rmsToGlow: 1.0,
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
    beatPulse: new EMASmoothing(0.35),
  };

  private material: THREE.ShaderMaterial | null = null;
  private mesh: THREE.Mesh | null = null;

  // Per-ball Lissajous phases and frequencies (stable per session)
  private readonly ballPhases = new Float32Array(NUM_BALLS * 4);

  constructor(private bus: MessageBus) {
    this.unsub = bus.subscribe('audio:features', (msg: BusMessage<AudioFeatures>) => {
      this.latestFeatures = msg.payload;
    });
    this.smoothers.bass.reset(0);
    this.smoothers.mid.reset(0);
    this.smoothers.high.reset(0);
    this.smoothers.rms.reset(0.1);
    this.smoothers.beatPulse.reset(0);

    // Seed ball parameters: 4 floats per ball (fx, fy, px, py)
    for (let i = 0; i < NUM_BALLS; i++) {
      const t = i / NUM_BALLS;
      this.ballPhases[i * 4 + 0] = 0.3 + 0.9 * Math.sin(i * 1.9);   // x freq
      this.ballPhases[i * 4 + 1] = 0.4 + 0.8 * Math.cos(i * 2.3);   // y freq
      this.ballPhases[i * 4 + 2] = t * Math.PI * 2.0;               // x phase
      this.ballPhases[i * 4 + 3] = t * Math.PI * 2.0 + 1.2;         // y phase
    }
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
        u_ballCount: { value: 6.0 },
        u_radius: { value: 0.28 },
        u_threshold: { value: 1.1 },
        u_edgeSharpness: { value: 0.08 },
        u_hue: { value: 0.55 },
        u_colorSpread: { value: 0.35 },
        u_phases: { value: Array.from(this.ballPhases) },
        u_phaseAccum: { value: 0.0 },
        u_bass: { value: 0.0 },
        u_mid: { value: 0.0 },
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
    } else {
      this.smoothers.beatPulse.update(0.0);
    }

    // Integrate orbit phase (mid-reactive speed)
    const speedMult = this.userParams.orbitSpeed
      * (1.0 + this.smoothers.mid.value * 0.7 * this.userParams.midToSpeed);
    this.phaseAccum += (1 / 60) * speedMult;

    if (this.material) {
      const u = this.material.uniforms;
      u.u_time.value = this.time;
      u.u_zoom.value = this._zoom;
      u.u_center.value.set(this._centerX, this._centerY);
      u.u_ballCount.value = this.userParams.ballCount;
      u.u_radius.value = this.userParams.radius
        * (1.0 + this.smoothers.bass.value * 0.45 * this.userParams.bassToSize);
      u.u_threshold.value = this.userParams.threshold;
      // Highs sharpen (reduce) the edge
      const edgeMin = 0.01;
      u.u_edgeSharpness.value = Math.max(
        edgeMin,
        this.userParams.edgeSharpness * (1.0 - this.smoothers.high.value * 0.7 * this.userParams.highToEdge),
      );
      u.u_hue.value = this.userParams.hue;
      u.u_colorSpread.value = this.userParams.colorSpread;
      u.u_phaseAccum.value = this.phaseAccum;
      u.u_bass.value = this.smoothers.bass.value;
      u.u_mid.value = this.smoothers.mid.value;
      u.u_high.value = this.smoothers.high.value;
      u.u_rms.value = this.smoothers.rms.value * this.userParams.rmsToGlow;
      u.u_beatPulse.value = this.smoothers.beatPulse.value * this.userParams.beatToPulse;
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
  metadata: metaballsMetadata,
  create: (bus) => new MetaballsVisualizer(bus),
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
  #define NUM_BALLS 7

  uniform float u_time;
  uniform vec2 u_resolution;
  uniform float u_zoom;
  uniform vec2 u_center;
  uniform float u_ballCount;
  uniform float u_radius;
  uniform float u_threshold;
  uniform float u_edgeSharpness;
  uniform float u_hue;
  uniform float u_colorSpread;
  uniform float u_phases[NUM_BALLS * 4];
  uniform float u_phaseAccum;
  uniform float u_bass;
  uniform float u_mid;
  uniform float u_high;
  uniform float u_rms;
  uniform float u_beatPulse;

  varying vec2 vUv;

  #include <cyber_hsv2rgb>

  vec2 ballPosition(int i) {
    float fx = u_phases[i * 4 + 0];
    float fy = u_phases[i * 4 + 1];
    float px = u_phases[i * 4 + 2];
    float py = u_phases[i * 4 + 3];
    // Lissajous-like orbit within a bounded box
    float x = 0.85 * sin(u_phaseAccum * fx + px);
    float y = 0.72 * cos(u_phaseAccum * fy + py);
    return vec2(x, y);
  }

  void main() {
    vec2 uv = (gl_FragCoord.xy - 0.5 * u_resolution) / min(u_resolution.x, u_resolution.y);
    uv = uv / u_zoom + u_center;

    // Scalar field accumulation (r^2 / d^2)
    float field = 0.0;
    float weightedHue = 0.0;
    float totalW = 0.0;
    int count = int(u_ballCount);
    float r2 = u_radius * u_radius;

    for (int i = 0; i < NUM_BALLS; i++) {
      if (i >= count) break;
      vec2 c = ballPosition(i);
      vec2 d = uv - c;
      float d2 = max(dot(d, d), 0.0005);
      float contrib = r2 / d2;
      field += contrib;

      // Hue accumulator weighted by contribution
      float ballHue = fract(u_hue + float(i) / float(NUM_BALLS) * u_colorSpread);
      weightedHue += ballHue * contrib;
      totalW += contrib;
    }

    float ballHue = totalW > 0.0 ? weightedHue / totalW : u_hue;

    // Isosurface blend: smoothstep around threshold
    float edge = u_edgeSharpness;
    float iso = smoothstep(u_threshold - edge, u_threshold + edge, field);

    // Inner energy: how far above threshold
    float inner = max(0.0, field - u_threshold);
    float innerGlow = 1.0 - exp(-inner * 1.8);

    // Base saturation and value
    float sat = 0.70 + 0.25 * (1.0 - innerGlow);
    float val = iso * (0.55 + 0.5 * innerGlow) * (0.85 + u_rms * 0.7);

    // High-frequency rim: emphasise edges near the iso surface
    float rim = exp(-pow((field - u_threshold) / max(edge, 0.001), 2.0));
    vec3 rimColor = hsv2rgb(vec3(fract(ballHue + 0.5), 0.85, 1.0));

    vec3 bodyColor = hsv2rgb(vec3(ballHue, sat, clamp(val, 0.0, 1.0)));
    vec3 color = bodyColor + rimColor * rim * 0.5 * (0.3 + u_high);

    // Beat pulse: radial ripple
    float pulseDist = length(uv);
    float ripple = 0.0;
    if (u_beatPulse > 0.01) {
      // Expanding ring driven by beat age (reuse beatPulse as age proxy via time)
      float ringR = fract(u_time * 0.8) * 1.5;
      ripple = exp(-pow((pulseDist - ringR) * 3.0, 2.0)) * u_beatPulse * 0.6;
    }
    color += vec3(0.7, 0.85, 1.0) * ripple;

    // Background field (very subtle)
    vec3 bg = vec3(0.01, 0.012, 0.03) + 0.02 * vec3(field * 0.2);
    color = max(color, bg);

    // Vignette
    float aspect = u_resolution.x / u_resolution.y;
    vec2 screenUv = gl_FragCoord.xy / u_resolution;
    float vignette = 1.0 - 0.35 * length((screenUv - 0.5) * vec2(aspect, 1.0));
    color *= vignette;

    // Tone mapping
    color = color / (1.0 + color);

    gl_FragColor = vec4(color, 1.0);
  }
`;
