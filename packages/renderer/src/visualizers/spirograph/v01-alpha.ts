import * as THREE from 'three';
import { MessageBus } from '@cybernoetica/core';
import type { AudioFeatures, BusMessage, Unsubscribe } from '@cybernoetica/core';
import { EMASmoothing } from '../../smoothing.js';
import type { Visualizer, VisualizerMetadata } from '../types.js';
import { registerVisualizer } from '../registry.js';

/**
 * Spirograph / Epitrochoid visualizer — layered roulette curves.
 *
 * Renders parametric epitrochoid and hypotrochoid curves:
 *   x(t) = (R+r)cos(t) - d*cos((R+r)/r * t)
 *   y(t) = (R+r)sin(t) - d*sin((R+r)/r * t)
 *
 * Multiple layers with different radius ratios produce complex interference
 * patterns. Each layer traces its curve as a glowing distance field, and the
 * curves slowly evolve their parameters over time.
 *
 * Bass modulates the pen offset (d), mids shift the radius ratio,
 * spectral centroid controls the number of petals, and beat onset
 * triggers phase resets that create blossoming animations.
 */

const LAYERS = 4;

// Beautiful ratio presets (R:r ratios that produce closed curves)
const RATIO_PRESETS = [
  { R: 5, r: 3, d: 3.5 },   // 5-petal rose
  { R: 7, r: 4, d: 4.2 },   // 7-pointed star
  { R: 3, r: 2, d: 2.8 },   // trefoil
  { R: 8, r: 5, d: 5.0 },   // 8-fold symmetry
  { R: 4, r: 3, d: 2.5 },   // classic 4-petal
  { R: 9, r: 7, d: 6.0 },   // complex web
];

const spirographMetadata: VisualizerMetadata = {
  type: 'spirograph',
  label: 'Spirograph',
  description: 'Layered epitrochoid roulette curves',
  usesPerspective: false,
  params: [
    // Appearance
    { key: 'layers', label: 'Layers', min: 1, max: 4, step: 1, initial: 3, category: 'appearance', description: 'Number of overlaid curve layers' },
    { key: 'brightness', label: 'Brightness', min: 0.5, max: 3.0, step: 0.1, initial: 1.5, category: 'appearance', description: 'Overall glow intensity' },
    { key: 'lineWidth', label: 'Line Width', min: 0.5, max: 4.0, step: 0.25, initial: 1.5, category: 'appearance', description: 'Curve thickness' },
    { key: 'rotationSpeed', label: 'Rotation Speed', min: 0.0, max: 1.0, step: 0.05, initial: 0.3, category: 'appearance', description: 'Overall rotation speed' },
    { key: 'morphSpeed', label: 'Morph Speed', min: 0.0, max: 1.0, step: 0.05, initial: 0.15, category: 'appearance', description: 'Speed of parameter evolution' },
    // Audio mapping
    { key: 'bassToPen', label: 'Bass -> Pen', min: 0.0, max: 2.0, step: 0.1, initial: 1.0, category: 'audio-mapping', description: 'How bass modulates pen offset' },
    { key: 'midToRatio', label: 'Mid -> Ratio', min: 0.0, max: 2.0, step: 0.1, initial: 1.0, category: 'audio-mapping', description: 'How mids shift radius ratio' },
    { key: 'spectralToPetals', label: 'Spectral -> Petals', min: 0.0, max: 2.0, step: 0.1, initial: 1.0, category: 'audio-mapping', description: 'How spectral centroid modulates petal count' },
    { key: 'rmsToGlow', label: 'RMS -> Glow', min: 0.0, max: 2.0, step: 0.1, initial: 1.0, category: 'audio-mapping', description: 'How volume boosts glow' },
  ],
  viewport: { pan: false, zoom: true, orbit: false },
  viewStateFields: [
    { key: 'zoom', label: 'Zoom', min: 0.3, max: 4.0, step: 0.05 },
  ],
};

export class SpirographVisualizer implements Visualizer {
  readonly metadata = spirographMetadata;

  private unsub: Unsubscribe;
  private latestFeatures: AudioFeatures | null = null;
  private time = 0;
  private presetIndex = 0;
  private lastBeatTime = -10;

  private userParams: Record<string, number> = {
    layers: 3,
    brightness: 1.5,
    lineWidth: 1.5,
    rotationSpeed: 0.3,
    morphSpeed: 0.15,
    bassToPen: 1.0,
    midToRatio: 1.0,
    spectralToPetals: 1.0,
    rmsToGlow: 1.0,
  };

  private _zoom = 1.0;

  private smoothers = {
    bass: new EMASmoothing(0.12),
    mid: new EMASmoothing(0.18),
    high: new EMASmoothing(0.22),
    rms: new EMASmoothing(0.16),
    spectralCentroid: new EMASmoothing(0.1),
    beatPulse: new EMASmoothing(0.45),
    ratioR: new EMASmoothing(0.04),
    ratioR2: new EMASmoothing(0.04),
    penD: new EMASmoothing(0.04),
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

    const p = RATIO_PRESETS[0];
    this.smoothers.ratioR.reset(p.R);
    this.smoothers.ratioR2.reset(p.r);
    this.smoothers.penD.reset(p.d);
  }

  attach(scene: THREE.Scene): void {
    this.material = new THREE.RawShaderMaterial({
      vertexShader: VERTEX_SHADER,
      fragmentShader: FRAGMENT_SHADER,
      uniforms: {
        u_time: { value: 0.0 },
        u_resolution: { value: new THREE.Vector2(1920, 1080) },
        u_zoom: { value: 1.0 },
        u_layers: { value: 3.0 },
        u_brightness: { value: 1.5 },
        u_lineWidth: { value: 1.5 },
        u_bigR: { value: RATIO_PRESETS[0].R },
        u_smallR: { value: RATIO_PRESETS[0].r },
        u_penD: { value: RATIO_PRESETS[0].d },
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

      // On beat, advance to next preset
      if (f.beatOnset && this.time - this.lastBeatTime > 3.0) {
        this.lastBeatTime = this.time;
        this.presetIndex = (this.presetIndex + 1) % RATIO_PRESETS.length;
      }
    } else {
      this.smoothers.beatPulse.update(0.0);
    }

    const target = RATIO_PRESETS[this.presetIndex];

    // Spectral centroid shifts the effective big R (petal count)
    const spectralShift = (this.smoothers.spectralCentroid.value - 0.5) * 2.0 * this.userParams.spectralToPetals;
    this.smoothers.ratioR.update(target.R + spectralShift);

    // Mid shifts small r
    const midShift = this.smoothers.mid.value * 0.5 * this.userParams.midToRatio;
    this.smoothers.ratioR2.update(target.r + midShift);

    // Bass modulates pen offset
    const bassOffset = this.smoothers.bass.value * 1.0 * this.userParams.bassToPen;
    this.smoothers.penD.update(target.d + bassOffset);

    if (this.material) {
      const u = this.material.uniforms;
      u.u_time.value = this.time * this.userParams.rotationSpeed;
      u.u_zoom.value = this._zoom;
      u.u_layers.value = this.userParams.layers;
      u.u_brightness.value = this.userParams.brightness;
      u.u_lineWidth.value = this.userParams.lineWidth;
      u.u_bigR.value = this.smoothers.ratioR.value;
      u.u_smallR.value = this.smoothers.ratioR2.value;
      u.u_penD.value = this.smoothers.penD.value;
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
    if (key in this.userParams) this.userParams[key] = value;
  }

  getViewState(): Record<string, number> {
    return { zoom: this._zoom };
  }

  setViewState(partial: Record<string, number>): void {
    if ('zoom' in partial) this._zoom = Math.max(0.3, Math.min(4.0, partial.zoom));
  }

  dispose(): void {
    this.unsub();
    this.material?.dispose();
    this.mesh?.geometry.dispose();
  }
}

registerVisualizer({
  metadata: spirographMetadata,
  create: (bus) => new SpirographVisualizer(bus),
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
  #define SAMPLES 256

  uniform float u_time;
  uniform vec2 u_resolution;
  uniform float u_zoom;
  uniform float u_layers;
  uniform float u_brightness;
  uniform float u_lineWidth;
  uniform float u_bigR;
  uniform float u_smallR;
  uniform float u_penD;
  uniform float u_bass;
  uniform float u_mid;
  uniform float u_high;
  uniform float u_rms;
  uniform float u_spectralCentroid;
  uniform float u_beatPulse;

  varying vec2 vUv;

  #include <cyber_hsv2rgb>

  // Epitrochoid curve point
  vec2 epitrochoid(float t, float R, float r, float d) {
    float ratio = (R + r) / r;
    return vec2(
      (R + r) * cos(t) - d * cos(ratio * t),
      (R + r) * sin(t) - d * sin(ratio * t)
    );
  }

  // Minimum distance from point to the curve (sampled)
  float curveDistance(vec2 p, float R, float r, float d, float phase) {
    float minDist = 1e10;
    float periods = TAU * r / 1.0; // One full pattern cycle
    // Use max of r to determine period; clamp to reasonable range
    float maxT = TAU * max(R, r);
    maxT = min(maxT, TAU * 12.0);

    for (int i = 0; i < SAMPLES; i++) {
      float t = float(i) / float(SAMPLES) * maxT + phase;
      vec2 cp = epitrochoid(t, R, r, d);
      float dist = length(p - cp);
      minDist = min(minDist, dist);
    }
    return minDist;
  }

  void main() {
    vec2 uv = (gl_FragCoord.xy - 0.5 * u_resolution) / min(u_resolution.x, u_resolution.y);
    uv *= 12.0 / u_zoom; // Scale to fit typical curve extent

    int layerCount = int(clamp(u_layers, 1.0, 4.0));
    vec3 color = vec3(0.0);

    for (int layer = 0; layer < 4; layer++) {
      if (layer >= layerCount) break;

      float layerOffset = float(layer) * 0.25;

      // Each layer uses slightly different parameters
      float R = u_bigR + float(layer) * 0.7;
      float r = u_smallR + float(layer) * 0.3;
      float d = u_penD * (1.0 - float(layer) * 0.1);
      float phase = u_time * (1.0 + float(layer) * 0.3);

      // Normalize the curve so it fits in view
      float maxExtent = R + r + d;
      vec2 scaledUv = uv * maxExtent / 10.0;

      float dist = curveDistance(scaledUv, R, r, d, phase);

      // Soft glow around the curve
      float thickness = u_lineWidth * 0.08 * maxExtent / 10.0;
      float glow = thickness / (dist + thickness * 0.1);
      glow = pow(glow, 1.5);

      // Per-layer hue
      float hue = fract(
        layerOffset * 0.6
        + u_time * 0.05
        + u_spectralCentroid * 0.2
        + float(layer) * 0.15
      );

      float sat = 0.6 + 0.3 * (1.0 - glow);
      float val = glow * u_brightness * (0.6 + u_rms * 0.8);
      val *= 1.0 / float(layerCount) * 2.0; // Balance layer contributions

      vec3 layerColor = hsv2rgb(vec3(hue, sat, clamp(val, 0.0, 1.0)));

      // RMS glow
      layerColor *= 0.6 + u_rms * 0.8;

      color += layerColor;
    }

    // Beat flash
    color += vec3(0.07, 0.05, 0.09) * u_beatPulse * 0.4;

    // Background
    color = max(color, vec3(0.005, 0.004, 0.012));

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
