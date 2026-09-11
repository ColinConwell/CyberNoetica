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
 * Quasicrystal visualizer — aperiodic plane-wave interference.
 *
 * Sums N plane waves oriented at evenly-spaced angles to produce
 * Penrose-tiling-like interference patterns with rotational symmetry
 * but no translational periodicity. Threshold coloring creates
 * jewel-like geometric mosaics that morph between crystalline and fluid.
 *
 * Bass drives phase (breathing), mids break symmetry via per-wave
 * phase offsets, spectral centroid controls spatial frequency,
 * and beats shift the wave count for sudden symmetry transitions.
 */

const quasicrystalMetadata: VisualizerMetadata = {
  type: 'quasicrystal',
  label: 'Quasicrystal',
  description: 'Aperiodic plane-wave interference mosaic',
  usesPerspective: false,
  params: [
    // Appearance
    {
      key: 'waveCount',
      label: 'Wave Count',
      min: 3,
      max: 12,
      step: 1,
      initial: 7,
      category: 'appearance',
      description: 'Number of interfering plane waves (symmetry order)',
    },
    {
      key: 'frequency',
      label: 'Spatial Frequency',
      min: 2.0,
      max: 30.0,
      step: 0.5,
      initial: 12.0,
      category: 'appearance',
      description: 'Spatial density of the pattern',
    },
    {
      key: 'colorSteps',
      label: 'Color Steps',
      min: 2,
      max: 16,
      step: 1,
      initial: 6,
      category: 'appearance',
      description: 'Quantization levels for mosaic look',
    },
    {
      key: 'animSpeed',
      label: 'Animation Speed',
      min: 0.0,
      max: 1.0,
      step: 0.05,
      initial: 0.3,
      category: 'appearance',
      description: 'Phase animation rate',
    },
    {
      key: 'colorSaturation',
      label: 'Saturation',
      min: 0.0,
      max: 1.0,
      step: 0.05,
      initial: 0.7,
      category: 'appearance',
      description: 'Color vibrancy',
    },
    // Audio mapping
    {
      key: 'bassToPhase',
      label: 'Bass → Phase',
      min: 0.0,
      max: 2.0,
      step: 0.1,
      initial: 1.0,
      category: 'audio-mapping',
      description: 'How strongly bass pulses the global phase',
    },
    {
      key: 'midToAsymmetry',
      label: 'Mid → Asymmetry',
      min: 0.0,
      max: 2.0,
      step: 0.1,
      initial: 1.0,
      category: 'audio-mapping',
      description: 'How strongly mids break wave symmetry',
    },
    {
      key: 'spectralToFreq',
      label: 'Spectral → Frequency',
      min: 0.0,
      max: 2.0,
      step: 0.1,
      initial: 1.0,
      category: 'audio-mapping',
      description: 'How spectral centroid modulates spatial frequency',
    },
    {
      key: 'rmsToContrast',
      label: 'RMS → Contrast',
      min: 0.0,
      max: 2.0,
      step: 0.1,
      initial: 1.0,
      category: 'audio-mapping',
      description: 'How volume drives color contrast',
    },
  ],
  viewport: { pan: true, zoom: true, orbit: false },
  viewStateFields: [
    { key: 'zoom', label: 'Zoom', min: 0.2, max: 5.0, step: 0.05 },
    { key: 'panX', label: 'Pan X', min: -5.0, max: 5.0, step: 0.01 },
    { key: 'panY', label: 'Pan Y', min: -5.0, max: 5.0, step: 0.01 },
  ],
};

export class QuasicrystalVisualizer implements Visualizer {
  private deltaSeconds = 1 / 60;
  private phases = new PhaseClock();
  readonly metadata = quasicrystalMetadata;

  private unsub: Unsubscribe;
  private latestFeatures: AudioFeatures | null = null;
  private time = 0;

  private userParams: Record<string, number> = {
    waveCount: 7,
    frequency: 12.0,
    colorSteps: 6,
    animSpeed: 0.3,
    colorSaturation: 0.7,
    bassToPhase: 1.0,
    midToAsymmetry: 1.0,
    spectralToFreq: 1.0,
    rmsToContrast: 1.0,
  };

  private _zoom = 1.0;
  private _panX = 0.0;
  private _panY = 0.0;

  private smoothers = {
    bass: new EMASmoothing(0.15),
    mid: new EMASmoothing(0.2),
    high: new EMASmoothing(0.25),
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
    this.material = new THREE.ShaderMaterial({
      vertexShader: VERTEX_SHADER,
      fragmentShader: FRAGMENT_SHADER,
      uniforms: {
        u_time: { value: 0.0 },
        u_resolution: { value: new THREE.Vector2(1920, 1080) },
        u_zoom: { value: 1.0 },
        u_pan: { value: new THREE.Vector2(0, 0) },
        u_waveCount: { value: 7.0 },
        u_frequency: { value: 12.0 },
        u_colorSteps: { value: 6.0 },
        u_colorSaturation: { value: 0.7 },
        u_bass: { value: 0.0 },
        u_mid: { value: 0.0 },
        u_high: { value: 0.0 },
        u_rms: { value: 0.1 },
        u_spectralCentroid: { value: 0.5 },
        u_beatPulse: { value: 0.0 },
        u_bassToPhase: { value: 1.0 },
        u_midToAsymmetry: { value: 1.0 },
        u_spectralToFreq: { value: 1.0 },
        u_rmsToContrast: { value: 1.0 },
      },
      transparent: true,
    });

    const geometry = new THREE.PlaneGeometry(2, 2);
    this.mesh = new THREE.Mesh(geometry, this.material);
    scene.add(this.mesh);
  }

  tick(deltaSeconds = 1 / 60): void {
    this.deltaSeconds = frameDelta(deltaSeconds);
    this.time += this.deltaSeconds * this.userParams.animSpeed;

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
      u.u_zoom.value = this._zoom;
      u.u_pan.value.set(this._panX, this._panY);
      u.u_waveCount.value = this.userParams.waveCount;
      u.u_frequency.value = this.userParams.frequency;
      u.u_colorSteps.value = this.userParams.colorSteps;
      u.u_colorSaturation.value = this.userParams.colorSaturation;
      u.u_bass.value = this.smoothers.bass.value;
      u.u_mid.value = this.smoothers.mid.value;
      u.u_high.value = this.smoothers.high.value;
      u.u_rms.value = this.smoothers.rms.value;
      u.u_spectralCentroid.value = this.smoothers.spectralCentroid.value;
      u.u_beatPulse.value = this.smoothers.beatPulse.value;
      u.u_bassToPhase.value = this.userParams.bassToPhase;
      u.u_midToAsymmetry.value = this.userParams.midToAsymmetry;
      u.u_spectralToFreq.value = this.userParams.spectralToFreq;
      u.u_rmsToContrast.value = this.userParams.rmsToContrast;
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
      this._zoom = Math.max(0.2, Math.min(5.0, partial.zoom));
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
  metadata: quasicrystalMetadata,
  create: (bus) => new QuasicrystalVisualizer(bus),
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
  #define MAX_WAVES 12

  uniform float u_time;
  uniform vec2 u_resolution;
  uniform float u_zoom;
  uniform vec2 u_pan;
  uniform float u_waveCount;
  uniform float u_frequency;
  uniform float u_colorSteps;
  uniform float u_colorSaturation;
  uniform float u_bass;
  uniform float u_mid;
  uniform float u_high;
  uniform float u_rms;
  uniform float u_spectralCentroid;
  uniform float u_beatPulse;
  uniform float u_bassToPhase;
  uniform float u_midToAsymmetry;
  uniform float u_spectralToFreq;
  uniform float u_rmsToContrast;

  varying vec2 vUv;

  #include <cyber_hsv2rgb>

  void main() {
    vec2 uv = (gl_FragCoord.xy - 0.5 * u_resolution) / min(u_resolution.x, u_resolution.y);
    uv = uv / u_zoom + u_pan;

    int N = int(clamp(u_waveCount, 3.0, float(MAX_WAVES)));

    // Audio-modulated frequency
    float freq = u_frequency + (u_spectralCentroid - 0.5) * 8.0 * u_spectralToFreq;

    // Global phase from bass
    float globalPhase = u_time * 2.0 + u_bass * 4.0 * u_bassToPhase;

    // Sum plane waves
    float sum = 0.0;
    for (int i = 0; i < MAX_WAVES; i++) {
      if (i >= N) break;

      float angle = float(i) * PI / float(N);

      // Per-wave phase offset from mids (breaks symmetry)
      float perWavePhase = float(i) * u_mid * 2.0 * u_midToAsymmetry;

      vec2 k = vec2(cos(angle), sin(angle)) * freq;
      float phase=dot(k,uv)+globalPhase+perWavePhase;
      float attenuation=1.0-smoothstep(1.5,3.14159,fwidth(phase));
      sum += attenuation*cos(phase);
    }

    // Normalize to [0, 1]
    float val = (sum / float(N)) * 0.5 + 0.5;

    // Quantize for mosaic look
    float steps = max(2.0, u_colorSteps);
    float quantized = floor(val * steps) / steps;

    // Blend between smooth and quantized based on contrast
    float contrast = 0.5 + u_rms * 0.5 * u_rmsToContrast;
    float finalVal = mix(val, quantized, contrast);

    // Color mapping — hue cycles through the quantized value
    float hue = fract(finalVal * 1.5 + u_time * 0.05);

    // Shift hue toward warm tones on bass, cool on treble
    hue = fract(hue + u_bass * 0.1 - u_high * 0.05);

    float sat = u_colorSaturation * (0.6 + 0.4 * abs(sin(finalVal * PI * 2.0)));
    float brightness = 0.15 + 0.65 * finalVal;

    // Audio brightness boost
    brightness *= 0.7 + u_rms * 0.6;
    brightness += u_beatPulse * 0.12;

    vec3 color = hsv2rgb(vec3(hue, sat, brightness));

    // Beat flash — brief global brightening
    color += vec3(u_beatPulse * 0.08);

    // Subtle edge glow between quantized regions
    float edge = abs(fract(val * steps) - 0.5) * 2.0;
    float edgeLine = 1.0 - smoothstep(0.0, 0.08, edge);
    color += vec3(edgeLine * u_high * 0.15);

    // Background
    color = max(color, vec3(0.01, 0.01, 0.025));

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
