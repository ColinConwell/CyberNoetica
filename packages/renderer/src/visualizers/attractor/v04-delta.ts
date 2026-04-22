import * as THREE from 'three';
import { MessageBus } from '@cybernoetica/core';
import type { AudioFeatures, BusMessage, Unsubscribe } from '@cybernoetica/core';
import { EMASmoothing } from '../../smoothing.js';
import type { Visualizer, VisualizerMetadata } from '../types.js';
import { registerVisualizer } from '../registry.js';

/**
 * Ikeda Map — discrete-time chaotic system from nonlinear optics (Ikeda, 1979).
 *
 * Models light circulating in a ring cavity with a nonlinear dielectric:
 *
 *   t_n   = 0.4 - 6 / (1 + x_n² + y_n²)
 *   x_{n+1} = 1 + u * (x_n cos(t_n) - y_n sin(t_n))
 *   y_{n+1} = u * (x_n sin(t_n) + y_n cos(t_n))
 *
 * The parameter u controls the laser coupling; for u ≥ 0.6 the system
 * produces a fractal strange attractor with intricate spiral arms.
 *
 * Audio mapping:
 *   bass  -> coupling parameter u (morphs attractor shape)
 *   flux  -> rotation offset (twists the spiral arms)
 *   rms   -> overall luminance
 *   beat  -> parameter jolts
 *   centroid -> hue rotation
 */

const ikedaMetadata: VisualizerMetadata = {
  type: 'ikeda',
  label: 'Ikeda Map',
  description: 'Nonlinear optical resonator strange attractor',
  usesPerspective: false,
  params: [
    { key: 'coupling', label: 'Coupling (u)', min: 0.5, max: 1.0, step: 0.01, initial: 0.918, category: 'appearance', description: 'Laser coupling parameter' },
    { key: 'phaseOffset', label: 'Phase Offset', min: -1.0, max: 1.0, step: 0.05, initial: 0.4, category: 'appearance', description: 'Nonlinear phase constant' },
    { key: 'detuning', label: 'Detuning', min: 1.0, max: 10.0, step: 0.5, initial: 6.0, category: 'appearance', description: 'Cavity detuning factor' },
    { key: 'iterations', label: 'Detail', min: 80, max: 400, step: 10, initial: 220, category: 'appearance', description: 'Iteration depth' },
    { key: 'colorSpeed', label: 'Color Cycle', min: 0.0, max: 1.0, step: 0.05, initial: 0.15, category: 'appearance' },
    { key: 'brightness', label: 'Brightness', min: 0.3, max: 3.0, step: 0.1, initial: 1.4, category: 'appearance' },
    { key: 'hueShift', label: 'Hue Shift', min: 0.0, max: 1.0, step: 0.01, initial: 0.6, category: 'appearance', description: 'Base palette hue' },
    { key: 'bassToCoupling', label: 'Bass → Coupling', min: 0.0, max: 2.0, step: 0.1, initial: 1.0, category: 'audio-mapping', description: 'Bass modulates laser coupling' },
    { key: 'fluxToPhase', label: 'Flux → Phase', min: 0.0, max: 2.0, step: 0.1, initial: 1.0, category: 'audio-mapping', description: 'Spectral flux rotates phase' },
    { key: 'rmsToGlow', label: 'RMS → Glow', min: 0.0, max: 2.0, step: 0.1, initial: 1.0, category: 'audio-mapping', description: 'Volume drives luminosity' },
    { key: 'beatToJolt', label: 'Beat → Jolt', min: 0.0, max: 2.0, step: 0.1, initial: 1.0, category: 'audio-mapping', description: 'Beats jolt parameters' },
    { key: 'centroidToHue', label: 'Centroid → Hue', min: 0.0, max: 2.0, step: 0.1, initial: 0.8, category: 'audio-mapping', description: 'Spectral centroid shifts palette' },
  ],
  viewport: { pan: true, zoom: true, orbit: false },
  viewStateFields: [
    { key: 'zoom', label: 'Zoom', min: 0.1, max: 5.0, step: 0.05 },
    { key: 'panX', label: 'Pan X', min: -5, max: 5, step: 0.05 },
    { key: 'panY', label: 'Pan Y', min: -5, max: 5, step: 0.05 },
  ],
};

export class IkedaVisualizer implements Visualizer {
  readonly metadata = ikedaMetadata;

  private unsub: Unsubscribe;
  private latestFeatures: AudioFeatures | null = null;
  private time = 0;

  private userParams: Record<string, number> = {
    coupling: 0.918,
    phaseOffset: 0.4,
    detuning: 6.0,
    iterations: 220,
    colorSpeed: 0.15,
    brightness: 1.4,
    hueShift: 0.6,
    bassToCoupling: 1.0,
    fluxToPhase: 1.0,
    rmsToGlow: 1.0,
    beatToJolt: 1.0,
    centroidToHue: 0.8,
  };

  private _zoom = 1.0;
  private _panX = 0.5;
  private _panY = 0.0;
  private viewOverrides: Record<string, boolean> = {};

  private smoothers = {
    bass: new EMASmoothing(0.12),
    mid: new EMASmoothing(0.18),
    high: new EMASmoothing(0.25),
    rms: new EMASmoothing(0.15),
    spectralCentroid: new EMASmoothing(0.1),
    spectralFlux: new EMASmoothing(0.2),
    beatPulse: new EMASmoothing(0.45),
  };

  private joltU = 0;
  private joltPhase = 0;
  private joltDecay = new EMASmoothing(0.08);

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
    this.smoothers.spectralFlux.reset(0);
    this.smoothers.beatPulse.reset(0);
    this.joltDecay.reset(0);
  }

  attach(scene: THREE.Scene): void {
    this.material = new THREE.RawShaderMaterial({
      vertexShader: VERTEX_SHADER,
      fragmentShader: FRAGMENT_SHADER,
      uniforms: {
        u_time: { value: 0.0 },
        u_resolution: { value: new THREE.Vector2(1920, 1080) },
        u_zoom: { value: 1.0 },
        u_pan: { value: new THREE.Vector2(0.5, 0) },
        u_coupling: { value: 0.918 },
        u_phaseOffset: { value: 0.4 },
        u_detuning: { value: 6.0 },
        u_iterations: { value: 220.0 },
        u_brightness: { value: 1.4 },
        u_colorSpeed: { value: 0.15 },
        u_hueShift: { value: 0.6 },
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
      this.smoothers.spectralFlux.update(f.spectralFlux);
      this.smoothers.beatPulse.update(f.beatOnset ? 1.0 : 0.0);

      if (f.beatOnset && this.userParams.beatToJolt > 0) {
        const strength = 0.04 * this.userParams.beatToJolt;
        this.joltU = (Math.random() - 0.5) * strength;
        this.joltPhase = (Math.random() - 0.5) * strength * 2;
        this.joltDecay.reset(1.0);
      }
    } else {
      this.smoothers.beatPulse.update(0.0);
    }

    this.joltDecay.update(0.0);
    const joltMul = this.joltDecay.value;

    const bass = this.smoothers.bass.value;
    const flux = this.smoothers.spectralFlux.value;
    const bassM = this.userParams.bassToCoupling;

    const coupling = this.userParams.coupling + bass * 0.03 * bassM + this.joltU * joltMul;
    const phaseOffset = this.userParams.phaseOffset + flux * 0.15 * this.userParams.fluxToPhase + this.joltPhase * joltMul;

    if (this.material) {
      const u = this.material.uniforms;
      u.u_time.value = this.time;
      u.u_zoom.value = this._zoom;
      u.u_pan.value.set(this._panX, this._panY);
      u.u_coupling.value = coupling;
      u.u_phaseOffset.value = phaseOffset;
      u.u_detuning.value = this.userParams.detuning;
      u.u_iterations.value = this.userParams.iterations;
      u.u_brightness.value = this.userParams.brightness;
      u.u_colorSpeed.value = this.userParams.colorSpeed;
      u.u_hueShift.value = this.userParams.hueShift
        + this.smoothers.spectralCentroid.value * 0.15 * this.userParams.centroidToHue;
      u.u_bass.value = bass;
      u.u_mid.value = this.smoothers.mid.value;
      u.u_high.value = this.smoothers.high.value;
      u.u_rms.value = this.smoothers.rms.value * this.userParams.rmsToGlow;
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
    return { zoom: this._zoom, panX: this._panX, panY: this._panY };
  }

  setViewState(partial: Record<string, number>): void {
    if ('zoom' in partial) {
      this._zoom = Math.max(0.1, Math.min(5.0, partial.zoom));
      this.viewOverrides.zoom = true;
    }
    if ('panX' in partial) {
      this._panX = Math.max(-5, Math.min(5, partial.panX));
      this.viewOverrides.panX = true;
    }
    if ('panY' in partial) {
      this._panY = Math.max(-5, Math.min(5, partial.panY));
      this.viewOverrides.panY = true;
    }
  }

  dispose(): void {
    this.unsub();
    this.material?.dispose();
    this.mesh?.geometry.dispose();
  }
}

registerVisualizer({
  metadata: ikedaMetadata,
  create: (bus) => new IkedaVisualizer(bus),
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

  uniform float u_time;
  uniform vec2 u_resolution;
  uniform float u_zoom;
  uniform vec2 u_pan;
  uniform float u_coupling;
  uniform float u_phaseOffset;
  uniform float u_detuning;
  uniform float u_iterations;
  uniform float u_brightness;
  uniform float u_colorSpeed;
  uniform float u_hueShift;
  uniform float u_bass;
  uniform float u_mid;
  uniform float u_high;
  uniform float u_rms;
  uniform float u_spectralCentroid;
  uniform float u_beatPulse;

  varying vec2 vUv;

  #include <cyber_hsv2rgb>

  void main() {
    vec2 uv = (gl_FragCoord.xy - 0.5 * u_resolution) / min(u_resolution.x, u_resolution.y);

    // Ikeda attractor lives in roughly [0, 2] x [-1, 1]
    float scale = 3.5 / u_zoom;
    vec2 target = uv * scale + u_pan;

    float density = 0.0;
    float colorAccum = 0.0;
    int iters = int(u_iterations);

    // Multiple seed orbits
    for (int seed = 0; seed < 5; seed++) {
      float seedF = float(seed);
      float x = sin(seedF * 1.7 + u_time * 0.02) * 0.5;
      float y = cos(seedF * 2.3 + u_time * 0.03) * 0.5;

      for (int i = 0; i < 400; i++) {
        if (i >= iters) break;

        // Ikeda map:
        //   t = phaseOffset - detuning / (1 + x² + y²)
        //   x' = 1 + u * (x cos(t) - y sin(t))
        //   y' = u * (x sin(t) + y cos(t))
        float t = u_phaseOffset - u_detuning / (1.0 + x * x + y * y);
        float ct = cos(t);
        float st = sin(t);
        float nx = 1.0 + u_coupling * (x * ct - y * st);
        float ny = u_coupling * (x * st + y * ct);
        x = nx;
        y = ny;

        // Proximity density contribution
        vec2 p = vec2(x, y);
        float dist = length(p - target);
        float contribution = exp(-dist * dist * 60.0 * u_zoom * u_zoom);
        density += contribution;

        float iterFrac = float(i) / float(iters);
        colorAccum += contribution * iterFrac;
      }
    }

    density /= float(iters) * 0.25;
    colorAccum = density > 0.001 ? colorAccum / (density * float(iters) * 0.25) : 0.0;

    float logDensity = log(1.0 + density * 20.0 * u_brightness);

    // Spiral-arm coloring: use iteration depth and angle
    float hue = fract(
      u_hueShift
      + colorAccum * 0.5
      + u_time * u_colorSpeed * 0.04
      + u_spectralCentroid * 0.12
    );
    float sat = 0.55 + 0.35 * (1.0 - exp(-density * 2.5));
    float val = logDensity * (0.65 + u_rms * 0.7);

    val += u_beatPulse * 0.2 * logDensity;
    val += u_high * 0.15 * density * exp(-density);

    vec3 color = hsv2rgb(vec3(hue, sat, clamp(val, 0.0, 1.0)));

    // Deep space background
    vec3 bg = vec3(0.006, 0.008, 0.022);
    color = max(color, bg);

    // Vignette
    float aspect = u_resolution.x / u_resolution.y;
    vec2 screenUv = gl_FragCoord.xy / u_resolution;
    float vignette = 1.0 - 0.3 * length((screenUv - 0.5) * vec2(aspect, 1.0));
    color *= vignette;

    // Reinhard tone mapping
    color = color / (1.0 + color);

    gl_FragColor = vec4(color, 1.0);
  }
`;
