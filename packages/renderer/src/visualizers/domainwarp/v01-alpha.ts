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
 * Domain Warp visualizer — recursive fBM distortion.
 *
 * Evaluates fractal Brownian motion noise where the output of one fBM
 * call distorts the input coordinates of another, producing painterly,
 * smoke-like, nebula forms. Based on Inigo Quilez's domain warping technique.
 *
 * Bass drives warp amplitude (gentle marbling → violent swirling),
 * mids modulate differential flow rates between layers,
 * treble controls fBM gain (smooth clouds → detailed filaments),
 * and RMS maps to overall brightness.
 */

const domainwarpMetadata: VisualizerMetadata = {
  type: 'domainwarp',
  label: 'Domain Warp',
  description: 'Recursive noise distortion, painterly nebulae',
  usesPerspective: false,
  params: [
    // Appearance
    {
      key: 'warpStrength',
      label: 'Warp Strength',
      min: 1.0,
      max: 8.0,
      step: 0.25,
      initial: 4.0,
      category: 'appearance',
      description: 'Intensity of coordinate distortion',
    },
    {
      key: 'octaves',
      label: 'Detail Level',
      min: 2,
      max: 8,
      step: 1,
      initial: 5,
      category: 'appearance',
      description: 'fBM octave count (more = finer detail)',
    },
    {
      key: 'flowSpeed',
      label: 'Flow Speed',
      min: 0.0,
      max: 1.0,
      step: 0.05,
      initial: 0.3,
      category: 'appearance',
      description: 'Animation speed of the flowing pattern',
    },
    {
      key: 'colorMode',
      label: 'Color Warmth',
      min: 0.0,
      max: 1.0,
      step: 0.05,
      initial: 0.5,
      category: 'appearance',
      description: 'Cool (blue-purple) to warm (amber-orange)',
    },
    {
      key: 'patternScale',
      label: 'Pattern Scale',
      min: 0.5,
      max: 4.0,
      step: 0.25,
      initial: 1.5,
      category: 'appearance',
      description: 'Overall scale of noise pattern',
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
      description: 'How strongly bass intensifies distortion',
    },
    {
      key: 'midToFlow',
      label: 'Mid → Flow',
      min: 0.0,
      max: 2.0,
      step: 0.1,
      initial: 1.0,
      category: 'audio-mapping',
      description: 'How mids modulate layer flow rates',
    },
    {
      key: 'highToDetail',
      label: 'High → Detail',
      min: 0.0,
      max: 2.0,
      step: 0.1,
      initial: 1.0,
      category: 'audio-mapping',
      description: 'How treble controls fine detail',
    },
    {
      key: 'rmsToBrightness',
      label: 'RMS → Brightness',
      min: 0.0,
      max: 2.0,
      step: 0.1,
      initial: 1.0,
      category: 'audio-mapping',
      description: 'How volume drives brightness',
    },
  ],
  viewport: { pan: true, zoom: true, orbit: false },
  viewStateFields: [
    { key: 'zoom', label: 'Zoom', min: 0.3, max: 4.0, step: 0.05 },
    { key: 'panX', label: 'Pan X', min: -5.0, max: 5.0, step: 0.01 },
    { key: 'panY', label: 'Pan Y', min: -5.0, max: 5.0, step: 0.01 },
  ],
};

export class DomainWarpVisualizer implements Visualizer {
  private deltaSeconds = 1 / 60;
  private phases = new PhaseClock();
  readonly metadata = domainwarpMetadata;

  private unsub: Unsubscribe;
  private latestFeatures: AudioFeatures | null = null;
  private time = 0;

  private userParams: Record<string, number> = {
    warpStrength: 4.0,
    octaves: 5,
    flowSpeed: 0.3,
    colorMode: 0.5,
    patternScale: 1.5,
    bassToWarp: 1.0,
    midToFlow: 1.0,
    highToDetail: 1.0,
    rmsToBrightness: 1.0,
  };

  private _zoom = 1.0;
  private _panX = 0.0;
  private _panY = 0.0;

  private smoothers = {
    bass: new EMASmoothing(0.12),
    mid: new EMASmoothing(0.18),
    high: new EMASmoothing(0.22),
    rms: new EMASmoothing(0.2),
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
    this.material = new THREE.RawShaderMaterial({
      vertexShader: VERTEX_SHADER,
      fragmentShader: FRAGMENT_SHADER,
      uniforms: {
        u_workBudget: { value: 1 },
        u_time: { value: 0.0 },
        u_layerTimes: { value: new THREE.Vector3() },
        u_resolution: { value: new THREE.Vector2(1920, 1080) },
        u_zoom: { value: 1.0 },
        u_pan: { value: new THREE.Vector2(0, 0) },
        u_warpStrength: { value: 4.0 },
        u_octaves: { value: 5.0 },
        u_colorMode: { value: 0.5 },
        u_patternScale: { value: 1.5 },
        u_bass: { value: 0.0 },
        u_mid: { value: 0.0 },
        u_high: { value: 0.0 },
        u_rms: { value: 0.1 },
        u_spectralCentroid: { value: 0.5 },
        u_beatPulse: { value: 0.0 },
        u_bassToWarp: { value: 1.0 },
        u_midToFlow: { value: 1.0 },
        u_highToDetail: { value: 1.0 },
        u_rmsToBrightness: { value: 1.0 },
      },
      transparent: true,
    });

    const geometry = new THREE.PlaneGeometry(2, 2);
    this.mesh = new THREE.Mesh(geometry, this.material);
    scene.add(this.mesh);
  }

  tick(deltaSeconds = 1 / 60): void {
    this.deltaSeconds = frameDelta(deltaSeconds);
    this.time += this.deltaSeconds * this.userParams.flowSpeed;

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
    } else {
      this.smoothers.beatPulse.update(0.0, this.deltaSeconds);
    }

    if (this.material) {
      const u = this.material.uniforms;
      u.u_time.value = this.time;
      const mid = this.smoothers.mid.value * this.userParams.midToFlow;
      u.u_layerTimes.value.set(
        this.time * 0.8,
        this.phases.advance(
          'layer2',
          this.userParams.flowSpeed * (0.6 + mid * 0.4),
          this.deltaSeconds,
        ),
        this.phases.advance(
          'layer3',
          this.userParams.flowSpeed * (0.5 + mid * 0.6),
          this.deltaSeconds,
        ),
      );
      u.u_zoom.value = this._zoom;
      u.u_pan.value.set(this._panX, this._panY);
      u.u_warpStrength.value = this.userParams.warpStrength;
      u.u_octaves.value = this.userParams.octaves;
      u.u_colorMode.value = this.userParams.colorMode;
      u.u_patternScale.value = this.userParams.patternScale;
      u.u_bass.value = this.smoothers.bass.value;
      u.u_mid.value = this.smoothers.mid.value;
      u.u_high.value = this.smoothers.high.value;
      u.u_rms.value = this.smoothers.rms.value;
      u.u_spectralCentroid.value = this.smoothers.spectralCentroid.value;
      u.u_beatPulse.value = this.smoothers.beatPulse.value;
      u.u_bassToWarp.value = this.userParams.bassToWarp;
      u.u_midToFlow.value = this.userParams.midToFlow;
      u.u_highToDetail.value = this.userParams.highToDetail;
      u.u_rmsToBrightness.value = this.userParams.rmsToBrightness;
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
    return { zoom: this._zoom, panX: this._panX, panY: this._panY };
  }

  setViewState(partial: Record<string, number>): void {
    if ('zoom' in partial)
      this._zoom = Math.max(0.3, Math.min(4.0, partial.zoom));
    if ('panX' in partial)
      this._panX = Math.max(-5.0, Math.min(5.0, partial.panX));
    if ('panY' in partial)
      this._panY = Math.max(-5.0, Math.min(5.0, partial.panY));
  }

  dispose(): void {
    this.unsub();
    this.material?.dispose();
    this.mesh?.geometry.dispose();
  }
}

registerVisualizer({
  metadata: domainwarpMetadata,
  create: (bus) => new DomainWarpVisualizer(bus),
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
  #define MAX_OCTAVES 8

  uniform float u_workBudget;
  uniform float u_time;
  uniform vec3 u_layerTimes;
  uniform vec2 u_resolution;
  uniform float u_zoom;
  uniform vec2 u_pan;
  uniform float u_warpStrength;
  uniform float u_octaves;
  uniform float u_colorMode;
  uniform float u_patternScale;
  uniform float u_bass;
  uniform float u_mid;
  uniform float u_high;
  uniform float u_rms;
  uniform float u_spectralCentroid;
  uniform float u_beatPulse;
  uniform float u_bassToWarp;
  uniform float u_midToFlow;
  uniform float u_highToDetail;
  uniform float u_rmsToBrightness;

  varying vec2 vUv;

  // Hash-based value noise
  float hash(vec2 p) {
    vec3 p3 = fract(vec3(p.xyx) * 0.13);
    p3 += dot(p3, p3.yzx + 3.333);
    return fract((p3.x + p3.y) * p3.z);
  }

  float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);

    float a = hash(i);
    float b = hash(i + vec2(1.0, 0.0));
    float c = hash(i + vec2(0.0, 1.0));
    float d = hash(i + vec2(1.0, 1.0));

    return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
  }

  float fbm(vec2 p, int octaves, float gain) {
    float sum = 0.0;
    float amp = 0.5;
    float freq = 1.0;
    for (int i = 0; i < MAX_OCTAVES; i++) {
      if (float(i) >= max(3.0, floor(float(MAX_OCTAVES) * u_workBudget))) break;
      if (i >= octaves) break;
      sum += amp * noise(p * freq);
      freq *= 2.0;
      amp *= gain;
    }
    return sum;
  }

  void main() {
    vec2 uv = (gl_FragCoord.xy - 0.5 * u_resolution) / min(u_resolution.x, u_resolution.y);
    uv = uv / u_zoom + u_pan;
    uv *= u_patternScale;

    int octaves = int(clamp(u_octaves, 2.0, float(MAX_OCTAVES)));

    // fBM gain: treble increases detail
    float gain = 0.45 + u_high * 0.15 * u_highToDetail;

    // Warp amplitude: bass intensifies distortion
    float warp = u_warpStrength * (0.6 + u_bass * 0.8 * u_bassToWarp);

    // Time offsets: mids create differential flow between layers
    float t1 = u_layerTimes.x;
    float t2 = u_layerTimes.y;
    float t3 = u_layerTimes.z;

    // First warp layer
    vec2 q = vec2(
      fbm(uv + vec2(0.0, 0.0) + vec2(t1 * 0.12, t1 * 0.08), octaves, gain),
      fbm(uv + vec2(5.2, 1.3) + vec2(t1 * 0.1, t1 * 0.14), octaves, gain)
    );

    // Second warp layer (warp the warp)
    vec2 r = vec2(
      fbm(uv + warp * q + vec2(1.7, 9.2) + vec2(t2 * 0.1, t2 * 0.06), octaves, gain),
      fbm(uv + warp * q + vec2(8.3, 2.8) + vec2(t2 * 0.08, t2 * 0.12), octaves, gain)
    );

    // Final evaluation
    float f = fbm(uv + warp * r + vec2(t3 * 0.05), octaves, gain);

    // --- Coloring ---
    // Cool palette (blue-indigo-violet)
    vec3 coolA = vec3(0.05, 0.08, 0.2);
    vec3 coolB = vec3(0.2, 0.35, 0.7);
    vec3 coolC = vec3(0.5, 0.3, 0.8);

    // Warm palette (amber-coral-gold)
    vec3 warmA = vec3(0.15, 0.05, 0.02);
    vec3 warmB = vec3(0.7, 0.25, 0.05);
    vec3 warmC = vec3(0.9, 0.6, 0.2);

    // Blend based on colorMode
    vec3 colA = mix(coolA, warmA, u_colorMode);
    vec3 colB = mix(coolB, warmB, u_colorMode);
    vec3 colC = mix(coolC, warmC, u_colorMode);

    // Build color from warp layers
    float lenQ = clamp(length(q), 0.0, 1.0);
    float lenR = clamp(length(r.x), 0.0, 1.0);

    vec3 color = mix(colA, colB, lenQ);
    color = mix(color, colC, lenR);

    // Contrast boost from final fBM
    color *= (f * f * 3.5 + 0.15);

    // Audio brightness
    float bright = 0.6 + u_rms * 0.8 * u_rmsToBrightness;
    color *= bright;

    // Beat pulse — flash of lighter tone
    color += vec3(0.15, 0.12, 0.08) * u_beatPulse * 0.3;

    // Spectral centroid adds a subtle shimmer
    float shimmer = sin(f * 20.0 + u_time * 3.0) * 0.5 + 0.5;
    color += vec3(0.03, 0.05, 0.08) * shimmer * u_spectralCentroid * 0.3;

    // Background
    color = max(color, vec3(0.008, 0.008, 0.02));

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
