import { frameDelta, takeAudioFrame, PhaseClock } from '../../timing.js';
import * as THREE from 'three';
import { MessageBus } from '@cybernoetica/core';
import type {
  AudioFeatures,
  BusMessage,
  Unsubscribe,
} from '@cybernoetica/core';
import { EMASmoothing, EventEnvelope } from '../../smoothing.js';
import type { Visualizer, VisualizerMetadata } from '../types.js';
import { registerVisualizer } from '../registry.js';

/**
 * Domain Warp Recursive visualizer -- Quilez triple-nested FBM warping.
 *
 * Where v01-alpha uses single-pass domain warping, this variant implements
 * Inigo Quilez's recursive technique: f(p + f(p + f(p))), where FBM warps
 * the domain of another FBM which warps the domain of another FBM.
 * Produces extraordinary organic, painterly, cloud-like textures that
 * continuously evolve through an ever-changing landscape.
 *
 * Audio mapping:
 *   bass  -> warp strength (bass swells stretch and pull the domain)
 *   mid   -> lacunarity (mids control large-to-small feature ratio)
 *   high  -> FBM octave count (treble adds fine detail)
 *   rms   -> color vibrancy and temporal coherence
 *   beat  -> phase discontinuity (sharp visual breaks)
 */

const domainWarpRecursiveMetadata: VisualizerMetadata = {
  type: 'domainwarp-recursive',
  label: 'Domain Warp Recursive',
  description: 'Triple-nested FBM warping (Quilez technique)',
  usesPerspective: false,
  params: [
    // Appearance
    {
      key: 'warpDepth',
      label: 'Warp Depth',
      min: 1,
      max: 3,
      step: 1,
      initial: 3,
      category: 'appearance',
      description: 'Nesting levels (1-3)',
    },
    {
      key: 'warpStrength',
      label: 'Warp Strength',
      min: 0.5,
      max: 6.0,
      step: 0.25,
      initial: 3.0,
      category: 'appearance',
      description: 'Displacement magnitude',
    },
    {
      key: 'lacunarity',
      label: 'Lacunarity',
      min: 1.5,
      max: 3.0,
      step: 0.1,
      initial: 2.0,
      category: 'appearance',
      description: 'Octave frequency scaling',
    },
    {
      key: 'gain',
      label: 'Gain',
      min: 0.3,
      max: 0.7,
      step: 0.05,
      initial: 0.5,
      category: 'appearance',
      description: 'Octave amplitude decay',
    },
    {
      key: 'octaves',
      label: 'Octaves',
      min: 2,
      max: 7,
      step: 1,
      initial: 5,
      category: 'appearance',
      description: 'FBM complexity layers',
    },
    {
      key: 'timeScale',
      label: 'Flow Speed',
      min: 0.0,
      max: 1.0,
      step: 0.05,
      initial: 0.25,
      category: 'appearance',
      description: 'Evolution speed',
    },
    {
      key: 'palette',
      label: 'Palette',
      min: 0.0,
      max: 1.0,
      step: 0.05,
      initial: 0.3,
      category: 'appearance',
      description: 'Color palette selection',
    },
    // Audio mapping
    {
      key: 'bassToWarp',
      label: 'Bass → Warp',
      min: 0.0,
      max: 2.0,
      step: 0.1,
      initial: 1.0,
      category: 'audio-mapping',
      description: 'Bass modulates warp strength',
    },
    {
      key: 'midToLacunarity',
      label: 'Mid → Lacunarity',
      min: 0.0,
      max: 2.0,
      step: 0.1,
      initial: 0.8,
      category: 'audio-mapping',
      description: 'Mids shift feature scaling',
    },
    {
      key: 'highToOctaves',
      label: 'High → Octaves',
      min: 0.0,
      max: 2.0,
      step: 0.1,
      initial: 1.0,
      category: 'audio-mapping',
      description: 'Highs add fine detail',
    },
    {
      key: 'rmsToVibrancy',
      label: 'RMS → Vibrancy',
      min: 0.0,
      max: 2.0,
      step: 0.1,
      initial: 1.0,
      category: 'audio-mapping',
      description: 'Volume drives color vibrancy',
    },
    {
      key: 'beatToBreak',
      label: 'Beat → Break',
      min: 0.0,
      max: 2.0,
      step: 0.1,
      initial: 1.0,
      category: 'audio-mapping',
      description: 'Beats create phase breaks',
    },
  ],
  viewport: { pan: true, zoom: true, orbit: false },
  viewStateFields: [
    { key: 'panX', label: 'Pan X', min: -5, max: 5, step: 0.05 },
    { key: 'panY', label: 'Pan Y', min: -5, max: 5, step: 0.05 },
    { key: 'zoom', label: 'Zoom', min: 0.2, max: 5.0, step: 0.05 },
  ],
};

export class DomainWarpRecursiveVisualizer implements Visualizer {
  private deltaSeconds = 1 / 60;
  private phases = new PhaseClock();
  readonly metadata = domainWarpRecursiveMetadata;

  private unsub: Unsubscribe;
  private latestFeatures: AudioFeatures | null = null;
  private time = 0;
  private breakAccum = 0;

  private userParams: Record<string, number> = {
    warpDepth: 3,
    warpStrength: 3.0,
    lacunarity: 2.0,
    gain: 0.5,
    octaves: 5,
    timeScale: 0.25,
    palette: 0.3,
    bassToWarp: 1.0,
    midToLacunarity: 0.8,
    highToOctaves: 1.0,
    rmsToVibrancy: 1.0,
    beatToBreak: 1.0,
  };

  private _panX = 0.0;
  private _panY = 0.0;
  private _zoom = 1.0;
  private viewOverrides: Record<string, boolean> = {};

  private smoothers = {
    bass: new EMASmoothing(0.1),
    mid: new EMASmoothing(0.15),
    high: new EMASmoothing(0.2),
    rms: new EMASmoothing(0.12),
    spectralCentroid: new EMASmoothing(0.1),
    beatPulse: new EventEnvelope(),
  };

  private material: THREE.ShaderMaterial | null = null;
  private mesh: THREE.Mesh | null = null;

  constructor(private bus: MessageBus) {
    this.unsub = bus.subscribe(
      'audio:features',
      (msg: BusMessage<AudioFeatures>) => {
        this.latestFeatures = { ...msg.payload };
      },
    );
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
        u_workBudget: { value: 1 },
        u_time: { value: 0.0 },
        u_resolution: { value: new THREE.Vector2(1920, 1080) },
        u_pan: { value: new THREE.Vector2(0, 0) },
        u_zoom: { value: 1.0 },
        u_warpDepth: { value: 3.0 },
        u_warpStrength: { value: 3.0 },
        u_lacunarity: { value: 2.0 },
        u_gain: { value: 0.5 },
        u_octaves: { value: 5.0 },
        u_palette: { value: 0.3 },
        u_bass: { value: 0.0 },
        u_mid: { value: 0.0 },
        u_high: { value: 0.0 },
        u_rms: { value: 0.1 },
        u_spectralCentroid: { value: 0.5 },
        u_beatPulse: { value: 0.0 },
        u_breakOffset: { value: 0.0 },
        u_bassToWarp: { value: 1.0 },
        u_midToLac: { value: 0.8 },
        u_highToOct: { value: 1.0 },
        u_rmsToVib: { value: 1.0 },
      },
      transparent: true,
    });

    const geometry = new THREE.PlaneGeometry(2, 2);
    this.mesh = new THREE.Mesh(geometry, this.material);
    scene.add(this.mesh);
  }

  tick(deltaSeconds = 1 / 60): void {
    this.deltaSeconds = frameDelta(deltaSeconds);
    this.time += this.deltaSeconds;

    if (this.latestFeatures) {
      const f = takeAudioFrame(this.latestFeatures);
      this.smoothers.bass.update(f.bass, this.deltaSeconds);
      this.smoothers.mid.update(f.mid, this.deltaSeconds);
      this.smoothers.high.update(f.high, this.deltaSeconds);
      this.smoothers.rms.update(f.rms, this.deltaSeconds);
      this.smoothers.spectralCentroid.update(
        f.spectralCentroid,
        this.deltaSeconds,
      );
      this.smoothers.beatPulse.update(
        f.beatOnset ? 1.0 : 0.0,
        this.deltaSeconds,
      );

      if (f.beatOnset && this.userParams.beatToBreak > 0) {
        this.breakAccum += 0.8 * this.userParams.beatToBreak;
      }
    } else {
      this.smoothers.beatPulse.update(0.0, this.deltaSeconds);
    }

    if (this.material) {
      const u = this.material.uniforms;
      u.u_time.value = this.phases.advance(
        'animation',
        this.userParams.timeScale,
        this.deltaSeconds,
      );
      u.u_pan.value.set(this._panX, this._panY);
      u.u_zoom.value = this._zoom;
      u.u_warpDepth.value = this.userParams.warpDepth;
      u.u_warpStrength.value =
        this.userParams.warpStrength +
        (this.smoothers.bass.value - 0.2) * 1.5 * this.userParams.bassToWarp;
      u.u_lacunarity.value =
        this.userParams.lacunarity +
        this.smoothers.mid.value * 0.4 * this.userParams.midToLacunarity;
      u.u_gain.value = this.userParams.gain;
      u.u_octaves.value =
        this.userParams.octaves +
        this.smoothers.high.value * 2.0 * this.userParams.highToOctaves;
      u.u_palette.value = this.userParams.palette;
      u.u_bass.value = this.smoothers.bass.value;
      u.u_mid.value = this.smoothers.mid.value;
      u.u_high.value = this.smoothers.high.value;
      u.u_rms.value = this.smoothers.rms.value;
      u.u_spectralCentroid.value = this.smoothers.spectralCentroid.value;
      u.u_beatPulse.value = this.smoothers.beatPulse.value;
      u.u_breakOffset.value = this.breakAccum;
      u.u_bassToWarp.value = this.userParams.bassToWarp;
      u.u_midToLac.value = this.userParams.midToLacunarity;
      u.u_highToOct.value = this.userParams.highToOctaves;
      u.u_rmsToVib.value = this.userParams.rmsToVibrancy;
    }
  }

  setResolution(width: number, height: number): void {
    if (this.material)
      this.material.uniforms.u_resolution.value.set(width, height);
  }

  setUserParam(key: string, value: number): void {
    if (key in this.userParams) this.userParams[key] = value;
  }

  getViewState(): Record<string, number> {
    return { panX: this._panX, panY: this._panY, zoom: this._zoom };
  }

  setViewState(partial: Record<string, number>): void {
    if ('panX' in partial) {
      this._panX = Math.max(-5, Math.min(5, partial.panX));
      this.viewOverrides.panX = true;
    }
    if ('panY' in partial) {
      this._panY = Math.max(-5, Math.min(5, partial.panY));
      this.viewOverrides.panY = true;
    }
    if ('zoom' in partial) {
      this._zoom = Math.max(0.2, Math.min(5.0, partial.zoom));
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
  metadata: domainWarpRecursiveMetadata,
  create: (bus) => new DomainWarpRecursiveVisualizer(bus),
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
  #define MAX_OCTAVES 7

  uniform float u_workBudget;
  uniform float u_time;
  uniform vec2 u_resolution;
  uniform vec2 u_pan;
  uniform float u_zoom;
  uniform float u_warpDepth;
  uniform float u_warpStrength;
  uniform float u_lacunarity;
  uniform float u_gain;
  uniform float u_octaves;
  uniform float u_palette;
  uniform float u_bass;
  uniform float u_mid;
  uniform float u_high;
  uniform float u_rms;
  uniform float u_spectralCentroid;
  uniform float u_beatPulse;
  uniform float u_breakOffset;
  uniform float u_bassToWarp;
  uniform float u_midToLac;
  uniform float u_highToOct;
  uniform float u_rmsToVib;

  varying vec2 vUv;

  // ── Noise ──

  vec2 hash2(vec2 p) {
    p = vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)));
    return -1.0 + 2.0 * fract(sin(p) * 43758.5453123);
  }

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

  // Fractal Brownian Motion with configurable lacunarity and gain
  float fbm(vec2 p, float lac, float g, int oct) {
    float value = 0.0;
    float amplitude = 0.5;
    float frequency = 1.0;

    for (int i = 0; i < MAX_OCTAVES; i++) {
      if (float(i) >= max(3.0, floor(float(MAX_OCTAVES) * u_workBudget))) break;
      if (i >= oct) break;
      value += amplitude * gnoise(p * frequency);
      frequency *= lac;
      amplitude *= g;
    }
    return value;
  }

  // Quilez-style recursive domain warping:
  // pattern(p) = fbm(p + warp_strength * fbm(p + warp_strength * fbm(p)))
  // Each level uses different offset seeds to break symmetry
  float recursiveWarp(vec2 p, float t, float warpStr, float lac, float g, int oct, int depth) {
    // Level 1: innermost FBM
    vec2 q = vec2(
      fbm(p + vec2(0.0, 0.0) + t * 0.11, lac, g, oct),
      fbm(p + vec2(5.2, 1.3) + t * 0.13, lac, g, oct)
    );

    if (depth <= 1) {
      return fbm(p + warpStr * q, lac, g, oct);
    }

    // Level 2: warp with q
    vec2 r = vec2(
      fbm(p + warpStr * q + vec2(1.7, 9.2) + t * 0.07, lac, g, oct),
      fbm(p + warpStr * q + vec2(8.3, 2.8) + t * 0.09, lac, g, oct)
    );

    if (depth <= 2) {
      return fbm(p + warpStr * r, lac, g, oct);
    }

    // Level 3: triple nesting
    vec2 s = vec2(
      fbm(p + warpStr * r + vec2(3.1, 7.4) + t * 0.05, lac, g, oct),
      fbm(p + warpStr * r + vec2(6.7, 4.2) + t * 0.06, lac, g, oct)
    );

    return fbm(p + warpStr * s, lac, g, oct);
  }

  // Cosine palette (Quilez technique)
  vec3 palette(float t, vec3 a, vec3 b, vec3 c, vec3 d) {
    return a + b * cos(TAU * (c * t + d));
  }

  #include <cyber_hsv2rgb>

  void main() {
    vec2 uv = (gl_FragCoord.xy - 0.5 * u_resolution) / min(u_resolution.x, u_resolution.y);
    uv = uv / u_zoom + u_pan;

    float t = u_time + u_breakOffset;
    int depth = int(min(u_warpDepth,max(1.0,ceil(3.0*u_workBudget))));
    int oct = int(clamp(u_octaves, 2.0, 7.0));

    // Core recursive domain warp
    float f = recursiveWarp(uv, t, u_warpStrength, u_lacunarity, u_gain, oct, depth);

    // Gradient for edge/flow coloring
    vec2 grad = vec2(dFdx(f),dFdy(f))*min(u_resolution.x,u_resolution.y)*u_zoom;
    float gradMag = length(grad);
    float gradAngle = atan(grad.y, grad.x);

    // ── Coloring ──

    // Palette selection blends between different cosine palettes
    vec3 col;
    float palT = f * 0.5 + 0.5; // Remap from [-1,1] to [0,1]

    if (u_palette < 0.33) {
      // Ocean/earth palette
      col = palette(palT,
        vec3(0.5, 0.5, 0.5),
        vec3(0.5, 0.5, 0.5),
        vec3(1.0, 1.0, 1.0),
        vec3(0.0, 0.1, 0.2)
      );
    } else if (u_palette < 0.66) {
      // Sunset/warm palette
      col = palette(palT,
        vec3(0.5, 0.5, 0.5),
        vec3(0.5, 0.5, 0.5),
        vec3(1.0, 0.7, 0.4),
        vec3(0.0, 0.15, 0.2)
      );
    } else {
      // Aurora/cool palette
      col = palette(palT,
        vec3(0.5, 0.5, 0.5),
        vec3(0.5, 0.5, 0.5),
        vec3(2.0, 1.0, 0.0),
        vec3(0.5, 0.2, 0.25)
      );
    }

    // Edge highlighting from gradient
    float edgeGlow = smoothstep(0.5, 2.0, gradMag);
    vec3 edgeColor = hsv2rgb(vec3(fract(gradAngle / TAU + u_time * 0.05), 0.5, 0.8));
    col = mix(col, edgeColor, edgeGlow * 0.25);

    // Spectral centroid shifts hue
    col = mix(col, col.gbr, u_spectralCentroid * 0.15);

    // Audio vibrancy: RMS increases saturation/contrast
    float vibrancy = 0.6 + u_rms * 0.6 * u_rmsToVib;
    col *= vibrancy;

    // Beat pulse: brief luminance boost
    col += vec3(0.1) * u_beatPulse;

    // High frequency detail shimmer
    col += edgeColor * u_high * 0.08;

    // Vignette
    float aspect = u_resolution.x / u_resolution.y;
    vec2 screenUv = gl_FragCoord.xy / u_resolution;
    float vignette = 1.0 - 0.35 * length((screenUv - 0.5) * vec2(aspect, 1.0));
    col *= vignette;

    // Background minimum
    col = max(col, vec3(0.01, 0.008, 0.015));

    // Tone mapping
    col = col / (1.0 + col);

    gl_FragColor = vec4(col, 1.0);
  }
`;
