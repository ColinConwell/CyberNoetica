import * as THREE from 'three';
import { MessageBus } from '@cybernoetica/core';
import type { AudioFeatures, BusMessage, Unsubscribe } from '@cybernoetica/core';
import { EMASmoothing } from '../../smoothing.js';
import type { Visualizer, VisualizerMetadata } from '../types.js';
import { registerVisualizer } from '../registry.js';

/**
 * Interference visualizer -- cymatics-inspired wave interference patterns.
 *
 * Multiple point sources emit circular waves that overlap and interfere,
 * producing delicate nodal patterns reminiscent of Chladni plates and
 * cymatics experiments. Source positions orbit slowly, causing the
 * interference fringes to shift and evolve continuously.
 *
 * Audio mapping: bass drives wave amplitude for more vivid peaks, mids
 * shift spatial frequency (denser or sparser fringes), highs sharpen
 * the interference edges, RMS adds glow at constructive interference
 * peaks, and beat onsets spawn expanding ripple waves from center.
 */

const interferenceMetadata: VisualizerMetadata = {
  type: 'interference',
  label: 'Interference',
  description: 'Cymatics-inspired wave interference patterns',
  usesPerspective: false,
  params: [
    // Appearance
    { key: 'sources', label: 'Sources', min: 2, max: 8, step: 1, initial: 4, category: 'appearance', description: 'Number of wave emission sources' },
    { key: 'frequency', label: 'Frequency', min: 1.0, max: 10.0, step: 0.25, initial: 4.0, category: 'appearance', description: 'Wave spatial frequency' },
    { key: 'damping', label: 'Damping', min: 0.0, max: 1.0, step: 0.05, initial: 0.3, category: 'appearance', description: 'How quickly waves attenuate with distance' },
    { key: 'speed', label: 'Speed', min: 0.1, max: 2.0, step: 0.05, initial: 0.8, category: 'appearance', description: 'Wave propagation speed' },
    { key: 'palette', label: 'Palette', min: 0.0, max: 1.0, step: 0.01, initial: 0.5, category: 'appearance', description: 'Color palette blend (cool to warm)' },
    // Audio mapping
    { key: 'bassToAmplitude', label: 'Bass -> Amplitude', min: 0.0, max: 2.0, step: 0.1, initial: 1.0, category: 'audio-mapping', description: 'Bass drives wave amplitude' },
    { key: 'midToFrequency', label: 'Mid -> Frequency', min: 0.0, max: 2.0, step: 0.1, initial: 1.0, category: 'audio-mapping', description: 'Mids shift wave frequency' },
    { key: 'highToSharpness', label: 'High -> Sharpness', min: 0.0, max: 2.0, step: 0.1, initial: 1.0, category: 'audio-mapping', description: 'Highs sharpen interference fringes' },
    { key: 'rmsToGlow', label: 'RMS -> Glow', min: 0.0, max: 2.0, step: 0.1, initial: 1.0, category: 'audio-mapping', description: 'RMS drives bright node glow' },
    { key: 'beatToRipple', label: 'Beat -> Ripple', min: 0.0, max: 2.0, step: 0.1, initial: 1.0, category: 'audio-mapping', description: 'Beats spawn new ripple waves' },
  ],
  viewport: { pan: true, zoom: true, orbit: false },
  viewStateFields: [
    { key: 'centerX', label: 'Center X', min: -3, max: 3, step: 0.05 },
    { key: 'centerY', label: 'Center Y', min: -3, max: 3, step: 0.05 },
    { key: 'zoom', label: 'Zoom', min: 0.3, max: 4.0, step: 0.05 },
  ],
};

export class InterferenceVisualizer implements Visualizer {
  readonly metadata = interferenceMetadata;

  private unsub: Unsubscribe;
  private latestFeatures: AudioFeatures | null = null;
  private time = 0;

  private userParams: Record<string, number> = {
    sources: 4,
    frequency: 4.0,
    damping: 0.3,
    speed: 0.8,
    palette: 0.5,
    bassToAmplitude: 1.0,
    midToFrequency: 1.0,
    highToSharpness: 1.0,
    rmsToGlow: 1.0,
    beatToRipple: 1.0,
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
        u_sources: { value: 4.0 },
        u_frequency: { value: 4.0 },
        u_damping: { value: 0.3 },
        u_speed: { value: 0.8 },
        u_palette: { value: 0.5 },
        u_bass: { value: 0.0 },
        u_mid: { value: 0.0 },
        u_high: { value: 0.0 },
        u_rms: { value: 0.1 },
        u_spectralCentroid: { value: 0.5 },
        u_beatPulse: { value: 0.0 },
        u_bassToAmplitude: { value: 1.0 },
        u_midToFrequency: { value: 1.0 },
        u_highToSharpness: { value: 1.0 },
        u_rmsToGlow: { value: 1.0 },
        u_beatToRipple: { value: 1.0 },
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

      u.u_sources.value = this.userParams.sources;
      u.u_frequency.value = this.userParams.frequency;
      u.u_damping.value = this.userParams.damping;
      u.u_speed.value = this.userParams.speed;
      u.u_palette.value = this.userParams.palette;

      u.u_bass.value = this.smoothers.bass.value;
      u.u_mid.value = this.smoothers.mid.value;
      u.u_high.value = this.smoothers.high.value;
      u.u_rms.value = this.smoothers.rms.value;
      u.u_spectralCentroid.value = this.smoothers.spectralCentroid.value;
      u.u_beatPulse.value = this.smoothers.beatPulse.value;

      u.u_bassToAmplitude.value = this.userParams.bassToAmplitude;
      u.u_midToFrequency.value = this.userParams.midToFrequency;
      u.u_highToSharpness.value = this.userParams.highToSharpness;
      u.u_rmsToGlow.value = this.userParams.rmsToGlow;
      u.u_beatToRipple.value = this.userParams.beatToRipple;
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
  metadata: interferenceMetadata,
  create: (bus) => new InterferenceVisualizer(bus),
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
  #define MAX_SOURCES 8

  uniform float u_time;
  uniform vec2 u_resolution;
  uniform float u_zoom;
  uniform vec2 u_center;
  uniform float u_sources;
  uniform float u_frequency;
  uniform float u_damping;
  uniform float u_speed;
  uniform float u_palette;
  uniform float u_bass;
  uniform float u_mid;
  uniform float u_high;
  uniform float u_rms;
  uniform float u_spectralCentroid;
  uniform float u_beatPulse;
  uniform float u_bassToAmplitude;
  uniform float u_midToFrequency;
  uniform float u_highToSharpness;
  uniform float u_rmsToGlow;
  uniform float u_beatToRipple;

  varying vec2 vUv;

  // Cosine palette (based on technique by Inigo Quilez)
  vec3 cosPalette(float t, vec3 a, vec3 b, vec3 c, vec3 d) {
    return a + b * cos(TAU * (c * t + d));
  }

  // Hash for grain
  float hash(vec2 p) {
    vec3 p3 = fract(vec3(p.xyx) * 0.1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
  }

  // Source position: orbiting with perturbation
  vec2 sourcePos(int i, float t) {
    float fi = float(i);
    float count = u_sources;
    float baseAngle = fi * TAU / count;

    // Orbit radius with slight variation per source
    float radius = 0.6 + 0.15 * sin(t * 0.3 + fi * 1.7);

    // Main orbit with perturbation
    float angle = baseAngle + t * 0.15 + 0.1 * sin(t * 0.5 + fi * 2.3);

    // Spectral centroid causes slight drift
    angle += u_spectralCentroid * 0.3 * fi;

    return vec2(cos(angle), sin(angle)) * radius;
  }

  void main() {
    vec2 uv = (gl_FragCoord.xy - 0.5 * u_resolution) / min(u_resolution.x, u_resolution.y);
    uv = uv / u_zoom + u_center;

    int numSources = int(u_sources);

    // Audio-reactive parameters
    float effAmplitude = 1.0 + u_bass * 1.5 * u_bassToAmplitude;
    float effFrequency = u_frequency + u_mid * 3.0 * u_midToFrequency;
    float sharpness = 1.0 + u_high * 2.0 * u_highToSharpness;
    float glowStrength = u_rms * u_rmsToGlow;
    float rippleStrength = u_beatPulse * u_beatToRipple;

    // Sum wave contributions from all sources
    float waveSum = 0.0;

    for (int i = 0; i < MAX_SOURCES; i++) {
      if (i >= numSources) break;

      vec2 src = sourcePos(i, u_time);
      float dist = length(uv - src);

      // Wave: sin(dist * frequency - time * speed) / (1 + dist * damping)
      float wave = sin(dist * effFrequency * TAU - u_time * u_speed * TAU)
                   / (1.0 + dist * u_damping * 5.0);

      waveSum += wave;
    }

    // Beat ripple: expanding ring from center
    float rippleDist = length(uv);
    float rippleWave = sin(rippleDist * effFrequency * TAU * 1.5 - u_time * u_speed * TAU * 2.0)
                       / (1.0 + rippleDist * 2.0);
    waveSum += rippleWave * rippleStrength * 2.0;

    // Normalize by source count and apply amplitude
    waveSum = waveSum / max(float(numSources), 1.0) * effAmplitude;

    // Apply sharpness: power curve to make edges crisper
    float absWave = abs(waveSum);
    float signWave = sign(waveSum);
    float shapedWave = signWave * pow(absWave, 1.0 / sharpness);

    // Map wave to color
    // Nodes (near zero): dark deep blue/purple
    // Positive peaks: warm (gold, white)
    // Negative peaks: cool (teal, cyan)

    // Cosine palette parameters -- shift with palette param
    // Cool palette (palette=0): teal/cyan/deep blue
    // Warm palette (palette=1): gold/magenta/deep purple
    vec3 pa = vec3(0.5, 0.5, 0.5);
    vec3 pb = vec3(0.5, 0.5, 0.5);
    vec3 pc = vec3(1.0, 1.0, 1.0);
    vec3 pd = vec3(
      mix(0.0, 0.3, u_palette),
      mix(0.33, 0.2, u_palette),
      mix(0.67, 0.55, u_palette)
    );

    // Color based on wave value (-1 to 1 range roughly)
    float colorT = shapedWave * 0.5 + 0.5;
    vec3 color = cosPalette(colorT, pa, pb, pc, pd);

    // Darken at nodes (near zero crossings) for Chladni-plate look
    float nodeFactor = smoothstep(0.0, 0.15, absWave);
    vec3 nodeColor = vec3(0.02, 0.01, 0.04); // Very dark purple-black
    color = mix(nodeColor, color, nodeFactor);

    // Constructive interference glow at peaks
    float peakGlow = smoothstep(0.4, 0.9, absWave);
    vec3 glowColor = mix(vec3(0.4, 0.8, 1.0), vec3(1.0, 0.9, 0.6), u_palette);
    color += glowColor * peakGlow * glowStrength * 0.8;

    // Bright highlight at strong constructive peaks
    float brightPeak = smoothstep(0.7, 1.0, absWave);
    color += vec3(1.0, 0.95, 0.9) * brightPeak * effAmplitude * 0.15;

    // Subtle grain texture
    float grain = (hash(gl_FragCoord.xy + fract(u_time * 13.7)) - 0.5) * 0.04;
    color += grain;

    // Vignette
    float aspect = u_resolution.x / u_resolution.y;
    vec2 screenUv = gl_FragCoord.xy / u_resolution;
    float vignette = 1.0 - 0.4 * length((screenUv - 0.5) * vec2(aspect, 1.0));
    vignette = clamp(vignette, 0.0, 1.0);
    color *= vignette;

    // Dark background floor with slight color
    color = max(color, vec3(0.012, 0.008, 0.02));

    // Tone mapping
    color = color / (0.85 + color);

    gl_FragColor = vec4(color, 1.0);
  }
`;
