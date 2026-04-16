import * as THREE from 'three';
import { MessageBus } from '@cybernoetica/core';
import type { AudioFeatures, BusMessage, Unsubscribe } from '@cybernoetica/core';
import { EMASmoothing } from '../../smoothing.js';
import type { Visualizer, VisualizerMetadata } from '../types.js';
import { registerVisualizer } from '../registry.js';

/**
 * Harmonograph visualizer -- coupled damped pendulum spirograph.
 *
 * Simulates a harmonograph: two pendulums driving x and y axes with
 * independent frequencies, phases, and damping. The result is intricate
 * spirograph-like curves that decay over time. A third rotary pendulum
 * adds rotation to the drawing surface.
 *
 * Audio mapping: bass drives frequency ratios (creating different curve
 * families), mids control damping (sustain vs. decay), spectral centroid
 * shifts phase relationships, and beats trigger new curve initiations.
 */

const harmonographMetadata: VisualizerMetadata = {
  type: 'harmonograph',
  label: 'Harmonograph',
  description: 'Damped pendulum spirograph patterns',
  usesPerspective: false,
  params: [
    // Appearance
    { key: 'freqRatio', label: 'Freq Ratio', min: 0.5, max: 4.0, step: 0.01, initial: 1.5, category: 'appearance', description: 'Frequency ratio between X and Y pendulums' },
    { key: 'damping', label: 'Damping', min: 0.0, max: 0.02, step: 0.001, initial: 0.004, category: 'appearance', description: 'Pendulum energy decay rate' },
    { key: 'trailLength', label: 'Trail Length', min: 200, max: 2000, step: 50, initial: 800, category: 'appearance', description: 'Number of curve samples rendered' },
    { key: 'lineGlow', label: 'Line Glow', min: 0.3, max: 2.0, step: 0.05, initial: 1.0, category: 'appearance', description: 'Brightness of the curve' },
    { key: 'rotaryFreq', label: 'Rotary Freq', min: 0.0, max: 2.0, step: 0.05, initial: 0.3, category: 'appearance', description: 'Third pendulum rotation frequency' },
    { key: 'colorCycle', label: 'Color Cycle', min: 0.0, max: 1.0, step: 0.05, initial: 0.3, category: 'appearance', description: 'Hue cycling speed along the curve' },
    // Audio mapping
    { key: 'bassToFreq', label: 'Bass -> Freq', min: 0.0, max: 2.0, step: 0.1, initial: 1.0, category: 'audio-mapping', description: 'Bass modulates frequency ratio' },
    { key: 'midToDamping', label: 'Mid -> Sustain', min: 0.0, max: 2.0, step: 0.1, initial: 1.0, category: 'audio-mapping', description: 'Mids reduce damping (more sustain)' },
    { key: 'spectralToPhase', label: 'Spectral -> Phase', min: 0.0, max: 2.0, step: 0.1, initial: 1.0, category: 'audio-mapping', description: 'Spectral centroid shifts phase offset' },
    { key: 'rmsToGlow', label: 'RMS -> Glow', min: 0.0, max: 2.0, step: 0.1, initial: 1.0, category: 'audio-mapping', description: 'Volume drives curve brightness' },
  ],
  viewport: { pan: false, zoom: true, orbit: false },
  viewStateFields: [
    { key: 'zoom', label: 'Zoom', min: 0.3, max: 4.0, step: 0.05 },
  ],
};

export class HarmonographVisualizer implements Visualizer {
  readonly metadata = harmonographMetadata;

  private unsub: Unsubscribe;
  private latestFeatures: AudioFeatures | null = null;
  private time = 0;

  private userParams: Record<string, number> = {
    freqRatio: 1.5,
    damping: 0.004,
    trailLength: 800,
    lineGlow: 1.0,
    rotaryFreq: 0.3,
    colorCycle: 0.3,
    bassToFreq: 1.0,
    midToDamping: 1.0,
    spectralToPhase: 1.0,
    rmsToGlow: 1.0,
  };

  private _zoom = 1.0;
  private viewOverrides: Record<string, boolean> = {};

  private smoothers = {
    bass: new EMASmoothing(0.12),
    mid: new EMASmoothing(0.18),
    high: new EMASmoothing(0.25),
    rms: new EMASmoothing(0.15),
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
    this.material = new THREE.ShaderMaterial({
      vertexShader: VERTEX_SHADER,
      fragmentShader: FRAGMENT_SHADER,
      uniforms: {
        u_time: { value: 0.0 },
        u_resolution: { value: new THREE.Vector2(1920, 1080) },
        u_zoom: { value: 1.0 },
        u_freqRatio: { value: 1.5 },
        u_damping: { value: 0.004 },
        u_trailLength: { value: 800.0 },
        u_lineGlow: { value: 1.0 },
        u_rotaryFreq: { value: 0.3 },
        u_colorCycle: { value: 0.3 },
        u_bass: { value: 0.0 },
        u_mid: { value: 0.0 },
        u_high: { value: 0.0 },
        u_rms: { value: 0.1 },
        u_spectralCentroid: { value: 0.5 },
        u_beatPulse: { value: 0.0 },
        u_phaseOffset: { value: 0.0 },
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

    // Effective frequency ratio: base + bass modulation
    const effFreqRatio = this.userParams.freqRatio
      + (this.smoothers.bass.value - 0.3) * 0.5 * this.userParams.bassToFreq;

    // Effective damping: reduced by mids (more sustain when louder)
    const effDamping = Math.max(0.0001,
      this.userParams.damping * (1.0 - this.smoothers.mid.value * 0.6 * this.userParams.midToDamping));

    // Phase offset from spectral centroid
    const phaseOffset = this.smoothers.spectralCentroid.value * Math.PI * this.userParams.spectralToPhase;

    if (this.material) {
      const u = this.material.uniforms;
      u.u_time.value = this.time;
      u.u_zoom.value = this._zoom;
      u.u_freqRatio.value = effFreqRatio;
      u.u_damping.value = effDamping;
      u.u_trailLength.value = this.userParams.trailLength;
      u.u_lineGlow.value = this.userParams.lineGlow * (0.6 + this.smoothers.rms.value * 0.8 * this.userParams.rmsToGlow);
      u.u_rotaryFreq.value = this.userParams.rotaryFreq;
      u.u_colorCycle.value = this.userParams.colorCycle;
      u.u_bass.value = this.smoothers.bass.value;
      u.u_mid.value = this.smoothers.mid.value;
      u.u_high.value = this.smoothers.high.value;
      u.u_rms.value = this.smoothers.rms.value;
      u.u_spectralCentroid.value = this.smoothers.spectralCentroid.value;
      u.u_beatPulse.value = this.smoothers.beatPulse.value;
      u.u_phaseOffset.value = phaseOffset;
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
  metadata: harmonographMetadata,
  create: (bus) => new HarmonographVisualizer(bus),
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

  uniform float u_time;
  uniform vec2 u_resolution;
  uniform float u_zoom;
  uniform float u_freqRatio;
  uniform float u_damping;
  uniform float u_trailLength;
  uniform float u_lineGlow;
  uniform float u_rotaryFreq;
  uniform float u_colorCycle;
  uniform float u_bass;
  uniform float u_mid;
  uniform float u_high;
  uniform float u_rms;
  uniform float u_spectralCentroid;
  uniform float u_beatPulse;
  uniform float u_phaseOffset;

  varying vec2 vUv;

  // HSV to RGB
  vec3 hsv2rgb(vec3 c) {
    vec4 K = vec4(1.0, 2.0 / 3.0, 1.0 / 3.0, 3.0);
    vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
    return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
  }

  // Distance from point p to line segment a-b
  float distToSegment(vec2 p, vec2 a, vec2 b) {
    vec2 ab = b - a;
    float t = clamp(dot(p - a, ab) / dot(ab, ab), 0.0, 1.0);
    return length(p - (a + t * ab));
  }

  // Harmonograph position at parameter t
  vec2 harmonograph(float t, float f1, float f2, float f3, float d, float phase) {
    float decay = exp(-d * t);

    float x = sin(f1 * t + phase) * decay
            + 0.5 * sin(f1 * 1.002 * t + phase + 1.0) * decay * 0.7;

    float y = sin(f2 * t) * decay
            + 0.5 * sin(f2 * 0.998 * t + 0.5) * decay * 0.7;

    float angle = f3 * t * 0.1;
    float ca = cos(angle);
    float sa = sin(angle);
    return vec2(x * ca - y * sa, x * sa + y * ca) * 0.42;
  }

  void main() {
    vec2 uv = (gl_FragCoord.xy - 0.5 * u_resolution) / min(u_resolution.x, u_resolution.y);
    uv /= u_zoom;

    float f1 = TAU * 2.0;
    float f2 = TAU * 2.0 * u_freqRatio;
    float f3 = TAU * u_rotaryFreq;

    // Accumulate glow from line segments
    float totalGlow = 0.0;
    float totalCore = 0.0;
    vec3 colorAccum = vec3(0.0);

    int samples = int(min(u_trailLength, 600.0));
    float tStart = u_time * 2.0;
    float tSpan = 15.0;
    float dt = tSpan / float(samples);

    float lineW = 0.0015 / u_zoom;
    float glowW = 0.012 / u_zoom;

    vec2 prevP = harmonograph(tStart, f1, f2, f3, u_damping, u_phaseOffset);

    for (int i = 1; i < 600; i++) {
      if (i >= samples) break;

      float t = tStart + float(i) * dt;
      vec2 curP = harmonograph(t, f1, f2, f3, u_damping, u_phaseOffset);

      float dist = distToSegment(uv, prevP, curP);

      // Additive glow from this segment
      float segCore = exp(-dist * dist / (lineW * lineW));
      float segGlow = exp(-dist * dist / (glowW * glowW));

      // Age-based fade: newer segments brighter
      float age = float(i) / float(samples);
      float fade = 1.0 - age * 0.6;

      // Color per segment
      float hue = fract(age * u_colorCycle + u_time * 0.03 + u_spectralCentroid * 0.2);
      vec3 segColor = hsv2rgb(vec3(hue, 0.65 + 0.2 * segCore, 1.0));

      colorAccum += segColor * (segCore * 0.6 + segGlow * 0.2) * fade;
      totalCore += segCore * fade;
      totalGlow += segGlow * fade;

      prevP = curP;
    }

    // Normalize and apply glow strength
    float normFactor = 1.0 / max(float(samples) * 0.01, 1.0);
    vec3 color = colorAccum * u_lineGlow * normFactor;

    // Beat pulse: bloom flash on core
    color += vec3(totalCore * u_beatPulse * 0.3 * normFactor);

    // High frequencies: shimmer
    float shimmer = sin(totalGlow * 50.0 + u_time * 8.0) * 0.5 + 0.5;
    color += vec3(totalGlow * u_high * 0.08 * shimmer * normFactor);

    // Background
    float bgR = length(uv) * 0.06;
    vec3 bg = vec3(0.01, 0.008, 0.02) * (1.0 - bgR);
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
