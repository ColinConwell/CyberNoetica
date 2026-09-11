import { resonantLevel } from '../../audio-mapping.js';
import { membraneRoots, membraneModeDescriptor } from './membrane-modes.js';
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
import { membraneModeTable, RADIAL_SAMPLES } from './membrane-modes.js';

/**
 * Chladni Circular visualizer -- Bessel-function cymatics on a circular membrane.
 *
 * Where v01-alpha uses the rectangular Chladni equation (sin/cos products),
 * this variant models a circular drumhead using Bessel functions of the first
 * kind, J_n(k_nm * r) * cos(n*theta). Multiple modes are superposed with
 * amplitudes driven by eight spectrum bands. These are membrane eigenfunctions;
 * the audio weights are artistic, not a calibrated mechanical resonance model.
 *
 * A fixed-edge membrane differs from a rigid Chladni plate (biharmonic modes).
 *
 * Audio mapping:
 *   fftBins -> eight equal-width bands driving membrane modes
 *   bass          -> plate radius breathing
 *   rms           -> overall pattern brightness
 *   beat          -> mode phase reset (sharp pattern transitions)
 *   spectralCentroid -> dominant mode selection
 */

const chladniCircularMetadata: VisualizerMetadata = {
  type: 'chladni-circular',
  label: 'Chladni Circular',
  description: 'Bessel-function cymatics on circular membrane',
  usesPerspective: false,
  params: [
    {
      key: 'fundamentalHz',
      label: 'Fundamental (Hz)',
      min: 40,
      max: 440,
      step: 1,
      initial: 110,
      category: 'appearance',
      description:
        'f₀₁ = j₀₁ c / (2πR); all mode frequencies follow the Bessel-root ratios.',
    },
    {
      key: 'qualityFactor',
      label: 'Resonance Q',
      min: 5,
      max: 120,
      step: 1,
      initial: 30,
      category: 'appearance',
    },
    // Appearance
    {
      key: 'modeCount',
      label: 'Mode Count',
      min: 2,
      max: 8,
      step: 1,
      initial: 6,
      category: 'appearance',
      description: 'Number of superposed Bessel modes',
    },
    {
      key: 'lineSharpness',
      label: 'Sharpness',
      min: 0.5,
      max: 5.0,
      step: 0.25,
      initial: 2.5,
      category: 'appearance',
      description: 'Nodal line crispness',
    },
    {
      key: 'plateRadius',
      label: 'Plate Radius',
      min: 0.5,
      max: 1.5,
      step: 0.05,
      initial: 0.9,
      category: 'appearance',
      description: 'Circular plate size',
    },
    {
      key: 'colorSaturation',
      label: 'Saturation',
      min: 0.0,
      max: 1.0,
      step: 0.05,
      initial: 0.7,
      category: 'appearance',
      description: 'Color richness',
    },
    {
      key: 'rotationalOrder',
      label: 'Rotational Order',
      min: 0,
      max: 6,
      step: 1,
      initial: 3,
      category: 'appearance',
      description: 'Angular mode symmetry number n',
    },
    {
      key: 'animSpeed',
      label: 'Animation',
      min: 0.0,
      max: 1.0,
      step: 0.05,
      initial: 0.2,
      category: 'appearance',
      description: 'Idle pattern drift speed',
    },
    // Audio mapping
    {
      key: 'fftToModes',
      label: 'FFT → Modes',
      min: 0.0,
      max: 2.0,
      step: 0.1,
      initial: 1.0,
      category: 'audio-mapping',
      description: 'FFT bins drive mode amplitudes',
    },
    {
      key: 'bassToRadius',
      label: 'Bass → Radius',
      min: 0.0,
      max: 2.0,
      step: 0.1,
      initial: 1.0,
      category: 'audio-mapping',
      description: 'Bass breathes plate radius',
    },
    {
      key: 'rmsToGlow',
      label: 'RMS → Glow',
      min: 0.0,
      max: 2.0,
      step: 0.1,
      initial: 1.0,
      category: 'audio-mapping',
      description: 'Volume drives brightness',
    },
    {
      key: 'beatToPhase',
      label: 'Beat → Phase',
      min: 0.0,
      max: 2.0,
      step: 0.1,
      initial: 1.0,
      category: 'audio-mapping',
      description: 'Beats shift mode phases',
    },
    {
      key: 'centroidToMode',
      label: 'Centroid → Mode',
      min: 0.0,
      max: 2.0,
      step: 0.1,
      initial: 0.8,
      category: 'audio-mapping',
      description: 'Spectral centroid selects dominant mode',
    },
  ],
  viewport: { pan: true, zoom: true, orbit: false },
  viewStateFields: [
    { key: 'centerX', label: 'Center X', min: -2, max: 2, step: 0.05 },
    { key: 'centerY', label: 'Center Y', min: -2, max: 2, step: 0.05 },
    { key: 'zoom', label: 'Zoom', min: 0.3, max: 4.0, step: 0.05 },
  ],
};

export class ChladniCircularVisualizer implements Visualizer {
  private deltaSeconds = 1 / 60;
  private phases = new PhaseClock();
  readonly metadata = chladniCircularMetadata;

  private unsub: Unsubscribe;
  private latestFeatures: AudioFeatures | null = null;
  private time = 0;
  private phaseAccum = 0;

  private userParams: Record<string, number> = {
    fundamentalHz: 110,
    qualityFactor: 30,
    modeCount: 6,
    lineSharpness: 2.5,
    plateRadius: 0.9,
    colorSaturation: 0.7,
    rotationalOrder: 3,
    animSpeed: 0.2,
    fftToModes: 1.0,
    bassToRadius: 1.0,
    rmsToGlow: 1.0,
    beatToPhase: 1.0,
    centroidToMode: 0.8,
  };

  private _centerX = 0;
  private _centerY = 0;
  private _zoom = 0.48;
  private viewOverrides: Record<string, boolean> = {};

  // Store 8 FFT band amplitudes for mode driving
  private modeBands = new Float32Array(8);
  private radialTexture: THREE.DataTexture | null = null;
  private radialOrder = -1;

  private smoothers = {
    bass: new EMASmoothing(0.12),
    mid: new EMASmoothing(0.18),
    high: new EMASmoothing(0.22),
    rms: new EMASmoothing(0.15),
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
        u_radialModes: { value: null },
        u_time: { value: 0.0 },
        u_resolution: { value: new THREE.Vector2(1920, 1080) },
        u_center: { value: new THREE.Vector2(0, 0) },
        u_zoom: { value: 1.0 },
        u_modeCount: { value: 6.0 },
        u_lineSharpness: { value: 2.5 },
        u_plateRadius: { value: 0.9 },
        u_saturation: { value: 0.7 },
        u_rotOrder: { value: 3.0 },
        u_modeAmps: { value: [0.5, 0.4, 0.3, 0.3, 0.2, 0.2, 0.1, 0.1] },
        u_bass: { value: 0.0 },
        u_rms: { value: 0.1 },
        u_high: { value: 0.0 },
        u_spectralCentroid: { value: 0.5 },
        u_beatPulse: { value: 0.0 },
        u_phaseShift: { value: 0.0 },
        u_rmsToGlow: { value: 1.0 },
        u_bassToRadius: { value: 1.0 },
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

      const order = Math.max(
        0,
        Math.min(6, Math.round(this.userParams.rotationalOrder)),
      );
      const fundamental = this.userParams.fundamentalHz;
      const q = this.userParams.qualityFactor;
      for (let i = 0; i < 8; i++) {
        const frequency =
          (membraneModeDescriptor(order, i).root / membraneRoots(0)[0]) *
          fundamental;
        const response = resonantLevel(f, frequency, q);
        const decay = Math.exp((-Math.PI * frequency * this.deltaSeconds) / q);
        this.modeBands[i] = this.modeBands[i] * decay + response * (1 - decay);
      }

      if (f.beatOnset && this.userParams.beatToPhase > 0) {
        this.phaseAccum += 0.5 * this.userParams.beatToPhase;
      }
    } else {
      this.smoothers.beatPulse.update(0.0, this.deltaSeconds);
    }

    if (this.material) {
      const u = this.material.uniforms;
      const order = Math.max(
        0,
        Math.min(6, Math.round(this.userParams.rotationalOrder)),
      );
      if (order !== this.radialOrder) {
        this.radialTexture?.dispose();
        this.radialTexture = new THREE.DataTexture(
          membraneModeTable(order),
          RADIAL_SAMPLES,
          8,
          THREE.RGBAFormat,
          THREE.FloatType,
        );
        this.radialTexture.needsUpdate = true;
        this.radialOrder = order;
        u.u_radialModes.value = this.radialTexture;
      }
      u.u_time.value = this.phases.advance(
        'animation',
        this.userParams.animSpeed,
        this.deltaSeconds,
      );
      u.u_center.value.set(this._centerX, this._centerY);
      u.u_zoom.value = this._zoom;
      u.u_modeCount.value = this.userParams.modeCount;
      u.u_lineSharpness.value = this.userParams.lineSharpness;
      u.u_plateRadius.value =
        this.userParams.plateRadius +
        (this.smoothers.bass.value - 0.3) * 0.1 * this.userParams.bassToRadius;
      u.u_saturation.value = this.userParams.colorSaturation;
      u.u_rotOrder.value = order;

      // Mix FFT-driven amplitudes with idle defaults
      const fftScale = this.userParams.fftToModes;
      const amps = u.u_modeAmps.value as number[];
      for (let i = 0; i < 8; i++) {
        const idle = this.latestFeatures ? 0 : 0.5 / (1 + i * 0.5);
        const selected = this.smoothers.spectralCentroid.value * 7;
        const emphasis =
          1 +
          this.userParams.centroidToMode * Math.exp(-0.5 * (i - selected) ** 2);
        amps[i] = idle + this.modeBands[i] * 8 * fftScale * emphasis;
      }
      u.u_modeAmps.value = amps;

      u.u_bass.value = this.smoothers.bass.value;
      u.u_rms.value = this.smoothers.rms.value;
      u.u_high.value = this.smoothers.high.value;
      u.u_spectralCentroid.value = this.smoothers.spectralCentroid.value;
      u.u_beatPulse.value = this.smoothers.beatPulse.value;
      u.u_phaseShift.value = this.phaseAccum;
      u.u_rmsToGlow.value = this.userParams.rmsToGlow;
      u.u_bassToRadius.value = this.userParams.bassToRadius;
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
    return { centerX: this._centerX, centerY: this._centerY, zoom: this._zoom };
  }

  setViewState(partial: Record<string, number>): void {
    if ('centerX' in partial) {
      this._centerX = Math.max(-2, Math.min(2, partial.centerX));
      this.viewOverrides.pan = true;
    }
    if ('centerY' in partial) {
      this._centerY = Math.max(-2, Math.min(2, partial.centerY));
      this.viewOverrides.pan = true;
    }
    if ('zoom' in partial) {
      this._zoom = Math.max(0.3, Math.min(4.0, partial.zoom));
      this.viewOverrides.zoom = true;
    }
  }

  dispose(): void {
    this.unsub();
    this.radialTexture?.dispose();
    this.material?.dispose();
    this.mesh?.geometry.dispose();
  }
}

registerVisualizer({
  metadata: chladniCircularMetadata,
  create: (bus) => new ChladniCircularVisualizer(bus),
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

  uniform sampler2D u_radialModes;
  uniform float u_time;
  uniform vec2 u_resolution;
  uniform vec2 u_center;
  uniform float u_zoom;
  uniform float u_modeCount;
  uniform float u_lineSharpness;
  uniform float u_plateRadius;
  uniform float u_saturation;
  uniform float u_rotOrder;
  uniform float u_modeAmps[8];
  uniform float u_bass;
  uniform float u_rms;
  uniform float u_high;
  uniform float u_spectralCentroid;
  uniform float u_beatPulse;
  uniform float u_phaseShift;
  uniform float u_rmsToGlow;
  uniform float u_bassToRadius;

  varying vec2 vUv;

  #include <cyber_hsv2rgb>

  // Manual interpolation avoids requiring float-texture linear filtering.
  float radialMode(int mode, float radius) {
    float x = clamp(radius, 0.0, 1.0) * ${RADIAL_SAMPLES - 1}.0;
    float i = floor(x);
    float y = (float(mode) + 0.5) / 8.0;
    float a = texture2D(u_radialModes, vec2((i + 0.5) / ${RADIAL_SAMPLES}.0, y)).r;
    float b = texture2D(u_radialModes, vec2((min(i + 1.0, ${RADIAL_SAMPLES - 1}.0) + 0.5) / ${RADIAL_SAMPLES}.0, y)).r;
    return mix(a, b, fract(x));
  }

  void main() {
    vec2 uv = (gl_FragCoord.xy - 0.5 * u_resolution) / min(u_resolution.x, u_resolution.y);
    uv = uv / u_zoom + u_center;

    // Polar coordinates
    float r = length(uv);
    float theta = atan(uv.y, uv.x);

    float plateR = u_plateRadius;

    // Superpose multiple circular membrane modes
    // Each mode: J_n(k_nm * r/R) * cos(n*theta + phase)
    // where n = rotational order, m = radial mode index
    float field = 0.0;
    float excitation = 0.0;
    int nModes = int(u_modeCount);
    int rotN = int(u_rotOrder);

    for (int m = 0; m < 8; m++) {
      if (m >= nModes) break;

      float amp = u_modeAmps[m];
      excitation += abs(amp);

      // Pairs share a radial/angular eigenmode with different angular phase.
      int angularN = rotN + (m / 2);
      float radialPart = radialMode(m, r / plateR);

      // Angular part with phase offset from beat accumulation
      float phase = u_phaseShift + float(m) * PI * 0.3 + u_time * float(m + 1) * 0.15;
      float angularPart = cos(float(angularN) * theta + phase);

      field += amp * radialPart * angularPart;
    }

    // Nodal line detection: |field| ~ 0
    float absField = abs(field);
    float thickness = 0.06 / u_lineSharpness;
    float nodalIntensity = (1.0 - smoothstep(0.0, thickness * max(excitation, 0.01), absField)) * smoothstep(0.0, 0.1, excitation);

    // Screen derivatives preserve gradient direction without two more mode sums.
    vec2 grad = vec2(dFdx(field), dFdy(field));
    float gradAngle = atan(grad.y, grad.x);

    // Coloring
    float hue = fract(gradAngle / TAU + u_time * 0.03 + u_spectralCentroid * 0.2);
    float sat = u_saturation * (0.5 + 0.5 * nodalIntensity);
    float val = nodalIntensity * 0.8;

    // Volume glow
    val *= 0.5 + u_rms * 0.8 * u_rmsToGlow;

    // Anti-nodal regions: subtle warmth
    float antiNodal = smoothstep(0.2, 0.6, absField);

    vec3 nodalColor = hsv2rgb(vec3(hue, sat, val));
    vec3 antiNodalColor = hsv2rgb(vec3(fract(hue + 0.4), sat * 0.5, antiNodal * 0.12));
    vec3 color = nodalColor + antiNodalColor;

    // Beat flash
    color += vec3(nodalIntensity * u_beatPulse * 0.35);

    // High frequencies: sparkle on nodal edges
    color += hsv2rgb(vec3(fract(hue + 0.2), 0.3, 1.0)) * nodalIntensity * u_high * 0.15;

    // Circular plate boundary
    float plateMask = 1.0 - smoothstep(plateR - 0.02, plateR + 0.02, r);
    color *= plateMask;

    // Plate rim
    float rim = exp(-pow((r - plateR) * 20.0, 2.0)) * 0.25;
    color += vec3(rim * (0.4 + u_high * 0.6));

    // Subtle concentric reference rings (physical membrane overtones)
    float rings = sin(r * 40.0) * 0.02 * plateMask;
    color += vec3(rings * 0.5);

    // Vignette
    float aspect = u_resolution.x / u_resolution.y;
    vec2 screenUv = gl_FragCoord.xy / u_resolution;
    float vignette = 1.0 - 0.3 * length((screenUv - 0.5) * vec2(aspect, 1.0));
    color *= vignette;

    // Background
    color = max(color, vec3(0.006, 0.004, 0.01));

    // Tone mapping
    color = color / (0.9 + color);

    gl_FragColor = vec4(color, 1.0);
  }
`;
