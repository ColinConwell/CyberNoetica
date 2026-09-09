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
 * Reaction-Diffusion visualizer -- Turing-pattern generator.
 *
 * Produces organic, living patterns inspired by Alan Turing's 1952
 * morphogenesis model. Uses layered noise with reaction-diffusion-like
 * interactions to generate spots, stripes, spirals, and coral growth.
 *
 * Bass controls pattern scale (organic to crystalline), mids morph
 * the pattern type, RMS drives animation speed, and beats trigger
 * radial disturbances that ripple through the pattern field.
 */

const reactionMetadata: VisualizerMetadata = {
  type: 'reaction',
  label: 'Reaction-Diffusion',
  description: 'Noise patterns inspired by reaction-diffusion',
  usesPerspective: false,
  params: [
    // Appearance
    {
      key: 'patternScale',
      label: 'Pattern Scale',
      min: 1.0,
      max: 8.0,
      step: 0.25,
      initial: 3.0,
      category: 'appearance',
      description: 'Scale of the Turing patterns',
    },
    {
      key: 'morphSpeed',
      label: 'Morph Speed',
      min: 0.0,
      max: 1.0,
      step: 0.05,
      initial: 0.3,
      category: 'appearance',
      description: 'How fast patterns evolve',
    },
    {
      key: 'sharpness',
      label: 'Sharpness',
      min: 0.0,
      max: 1.0,
      step: 0.05,
      initial: 0.5,
      category: 'appearance',
      description: 'Crisp edges vs soft gradients',
    },
    {
      key: 'colorWarmth',
      label: 'Color Warmth',
      min: 0.0,
      max: 1.0,
      step: 0.05,
      initial: 0.4,
      category: 'appearance',
      description: 'Color palette from cool to warm',
    },
    {
      key: 'layerCount',
      label: 'Layers',
      min: 1.0,
      max: 4.0,
      step: 1.0,
      initial: 3.0,
      category: 'appearance',
      description: 'Pattern complexity layers',
    },
    // Audio mapping
    {
      key: 'bassToScale',
      label: 'Bass \u2192 Scale',
      min: 0.0,
      max: 2.0,
      step: 0.1,
      initial: 1.0,
      category: 'audio-mapping',
      description: 'Bass modulates pattern scale',
    },
    {
      key: 'midToMorph',
      label: 'Mid \u2192 Morph',
      min: 0.0,
      max: 2.0,
      step: 0.1,
      initial: 1.0,
      category: 'audio-mapping',
      description: 'Mids drive pattern morphing',
    },
    {
      key: 'rmsToIntensity',
      label: 'RMS \u2192 Intensity',
      min: 0.0,
      max: 2.0,
      step: 0.1,
      initial: 1.0,
      category: 'audio-mapping',
      description: 'Volume drives brightness',
    },
    {
      key: 'beatPulse',
      label: 'Beat \u2192 Pulse',
      min: 0.0,
      max: 2.0,
      step: 0.1,
      initial: 1.0,
      category: 'audio-mapping',
      description: 'Beats create radial disturbances',
    },
  ],
  viewport: { pan: false, zoom: true, orbit: false },
  viewStateFields: [
    { key: 'zoom', label: 'Zoom', min: 0.3, max: 4.0, step: 0.05 },
  ],
};

export class ReactionDiffusionVisualizer implements Visualizer {
  private deltaSeconds = 1 / 60;
  private phases = new PhaseClock();
  readonly metadata = reactionMetadata;

  private unsub: Unsubscribe;
  private latestFeatures: AudioFeatures | null = null;
  private time = 0;

  private userParams: Record<string, number> = {
    patternScale: 3.0,
    morphSpeed: 0.3,
    sharpness: 0.5,
    colorWarmth: 0.4,
    layerCount: 3.0,
    bassToScale: 1.0,
    midToMorph: 1.0,
    rmsToIntensity: 1.0,
    beatPulse: 1.0,
  };

  private _zoom = 1.0;
  private viewOverrides: Record<string, boolean> = {};

  private smoothers = {
    bass: new EMASmoothing(0.12),
    mid: new EMASmoothing(0.18),
    high: new EMASmoothing(0.22),
    rms: new EMASmoothing(0.15),
    spectralCentroid: new EMASmoothing(0.1),
    spectralFlux: new EMASmoothing(0.2),
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
    this.smoothers.spectralFlux.reset(0);
    this.smoothers.beatPulse.reset(0);
  }

  attach(scene: THREE.Scene): void {
    this.material = new THREE.RawShaderMaterial({
      vertexShader: VERTEX_SHADER,
      fragmentShader: FRAGMENT_SHADER,
      uniforms: {
        u_morphSpeedPhase: { value: 0 },
        u_time: { value: 0.0 },
        u_resolution: { value: new THREE.Vector2(1920, 1080) },
        u_zoom: { value: 1.0 },
        u_patternScale: { value: 3.0 },
        u_morphSpeed: { value: 0.3 },
        u_sharpness: { value: 0.5 },
        u_warmth: { value: 0.4 },
        u_layers: { value: 3.0 },
        u_bass: { value: 0.0 },
        u_mid: { value: 0.0 },
        u_high: { value: 0.0 },
        u_rms: { value: 0.1 },
        u_spectralCentroid: { value: 0.5 },
        u_spectralFlux: { value: 0.0 },
        u_beatPulse: { value: 0.0 },
        u_bassToScale: { value: 1.0 },
        u_midToMorph: { value: 1.0 },
        u_rmsToIntensity: { value: 1.0 },
        u_beatStrength: { value: 1.0 },
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
      this.smoothers.spectralFlux.update(f.spectralFlux, this.deltaSeconds);
      this.smoothers.beatPulse.update(
        f.beatOnset ? 1.0 : 0.0,
        this.deltaSeconds,
      );
    } else {
      this.smoothers.beatPulse.update(0.0, this.deltaSeconds);
    }

    if (this.material) {
      const u = this.material.uniforms;
      u.u_time.value = this.time;
      u.u_zoom.value = this._zoom;
      u.u_patternScale.value = this.userParams.patternScale;
      u.u_morphSpeed.value = this.userParams.morphSpeed;
      u.u_morphSpeedPhase.value = this.phases.advance(
        'u_morphSpeed',
        u.u_morphSpeed.value,
        this.deltaSeconds,
      );
      u.u_sharpness.value = this.userParams.sharpness;
      u.u_warmth.value = this.userParams.colorWarmth;
      u.u_layers.value = this.userParams.layerCount;
      u.u_bass.value = this.smoothers.bass.value;
      u.u_mid.value = this.smoothers.mid.value;
      u.u_high.value = this.smoothers.high.value;
      u.u_rms.value = this.smoothers.rms.value;
      u.u_spectralCentroid.value = this.smoothers.spectralCentroid.value;
      u.u_spectralFlux.value = this.smoothers.spectralFlux.value;
      u.u_beatPulse.value = this.smoothers.beatPulse.value;
      u.u_bassToScale.value = this.userParams.bassToScale;
      u.u_midToMorph.value = this.userParams.midToMorph;
      u.u_rmsToIntensity.value = this.userParams.rmsToIntensity;
      u.u_beatStrength.value = this.userParams.beatPulse;
    }
  }

  setResolution(width: number, height: number): void {
    if (this.material)
      this.material.uniforms.u_resolution.value.set(width, height);
  }

  setUserParam(key: string, value: number): void {
    if (key in this.userParams) {
      this.userParams[key] = value;
    }
  }

  getViewState(): Record<string, number> {
    return { zoom: this._zoom };
  }

  setViewState(partial: Record<string, number>): void {
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
  metadata: reactionMetadata,
  create: (bus) => new ReactionDiffusionVisualizer(bus),
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

  uniform float u_morphSpeedPhase;
  uniform float u_time;
  uniform vec2 u_resolution;
  uniform float u_zoom;
  uniform float u_patternScale;
  uniform float u_morphSpeed;
  uniform float u_sharpness;
  uniform float u_warmth;
  uniform float u_layers;
  uniform float u_bass;
  uniform float u_mid;
  uniform float u_high;
  uniform float u_rms;
  uniform float u_spectralCentroid;
  uniform float u_spectralFlux;
  uniform float u_beatPulse;
  uniform float u_bassToScale;
  uniform float u_midToMorph;
  uniform float u_rmsToIntensity;
  uniform float u_beatStrength;

  varying vec2 vUv;

  // ── Noise functions ──

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

  // Reaction-diffusion-like pattern using coupled noise fields
  // Approximates the activator-inhibitor system:
  // Activator (short-range, positive) - Inhibitor (long-range, negative)
  float turingPattern(vec2 p, float t, float scale, float morph) {
    // Activator: high-frequency noise (local excitation)
    float activator = 0.0;
    activator += gnoise(p * scale + vec2(t * 0.12, t * 0.08)) * 0.6;
    activator += gnoise(p * scale * 1.7 + vec2(-t * 0.09, t * 0.14)) * 0.3;
    activator += gnoise(p * scale * 2.9 + vec2(t * 0.06, -t * 0.11)) * 0.1;

    // Inhibitor: low-frequency noise (lateral inhibition)
    float inhibitor = 0.0;
    inhibitor += gnoise(p * scale * 0.4 + vec2(t * 0.05, -t * 0.04) + morph) * 0.7;
    inhibitor += gnoise(p * scale * 0.7 + vec2(-t * 0.07, t * 0.06) + morph * 0.5) * 0.3;

    // The Turing instability: activator - inhibitor creates patterns
    return activator - inhibitor * 0.8;
  }

  // HSV to RGB
  #include <cyber_hsv2rgb>

  void main() {
    vec2 uv = (gl_FragCoord.xy - 0.5 * u_resolution) / min(u_resolution.x, u_resolution.y);
    uv /= u_zoom;

    float t = u_morphSpeedPhase;

    // Audio-modulated pattern scale
    float scale = u_patternScale + u_bass * 2.0 * u_bassToScale;

    // Audio-modulated morph offset
    float morph = u_mid * 3.0 * u_midToMorph;

    // Beat disturbance: radial wave
    float radius = length(uv);
    float beatWave = sin(radius * 12.0 - u_time * 6.0) * u_beatPulse * u_beatStrength * 0.08;
    uv += normalize(uv + 0.001) * beatWave;

    // Spectral flux causes spatial warping
    float warpAngle = u_spectralFlux * 2.0;
    vec2 warp = vec2(
      gnoise(uv * 2.0 + t * 0.5) * warpAngle,
      gnoise(uv * 2.0 + t * 0.5 + 100.0) * warpAngle
    );
    uv += warp * 0.08;

    // Multi-layer Turing patterns
    float pattern = 0.0;
    float totalWeight = 0.0;
    int layers = int(u_layers);

    for (int i = 0; i < 4; i++) {
      if (i >= layers) break;
      float fi = float(i);
      float layerScale = scale * (1.0 + fi * 0.8);
      float layerMorph = morph + fi * 1.5;
      float layerTime = t * (1.0 - fi * 0.15);
      float weight = 1.0 / (1.0 + fi * 0.6);

      float p = turingPattern(uv, layerTime, layerScale, layerMorph);

      // Apply sharpness: sigmoid-like thresholding
      float sharp = mix(1.0, 8.0, u_sharpness);
      p = 1.0 / (1.0 + exp(-p * sharp));

      pattern += p * weight;
      totalWeight += weight;
    }
    pattern /= totalWeight;

    // Gradient for edge detection
    float eps = 0.005;
    float px = turingPattern(uv + vec2(eps, 0.0), t, scale, morph);
    float py = turingPattern(uv + vec2(0.0, eps), t, scale, morph);
    float nx = turingPattern(uv - vec2(eps, 0.0), t, scale, morph);
    float ny = turingPattern(uv - vec2(0.0, eps), t, scale, morph);
    float edge = length(vec2(px - nx, py - ny)) * 3.0;

    // ── Coloring ──

    // Bio-luminescent palette
    float hueBase = mix(0.5, 0.05, u_warmth); // cyan-blue to amber
    float hueShift = u_spectralCentroid * 0.2 + pattern * 0.15;
    float hue = fract(hueBase + hueShift);

    float sat = 0.45 + 0.35 * pattern;
    float val = 0.05 + pattern * 0.65;

    // Edge glow driven by high frequencies
    val += edge * (0.2 + u_high * 0.6);
    hue = fract(hue - edge * 0.05);

    // Audio brightness
    val *= 0.7 + u_rms * 0.7 * u_rmsToIntensity;
    val += u_beatPulse * 0.1;

    vec3 color = hsv2rgb(vec3(hue, sat, clamp(val, 0.0, 1.0)));

    // Subtle secondary chemical glow (the inhibitor field)
    float inhib = gnoise(uv * scale * 0.4 + vec2(t * 0.05, -t * 0.04));
    color += vec3(0.02, 0.04, 0.06) * (0.5 + 0.5 * inhib);

    // Vignette
    float aspect = u_resolution.x / u_resolution.y;
    vec2 screenUv = gl_FragCoord.xy / u_resolution;
    float vignette = 1.0 - 0.4 * length((screenUv - 0.5) * vec2(aspect, 1.0));
    color *= vignette;

    // Background minimum
    color = max(color, vec3(0.01, 0.012, 0.02));

    // Tone mapping
    color = color / (1.0 + color);

    gl_FragColor = vec4(color, 1.0);
  }
`;
