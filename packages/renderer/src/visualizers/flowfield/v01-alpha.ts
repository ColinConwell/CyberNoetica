import * as THREE from 'three';
import { MessageBus } from '@cybernoetica/core';
import type { AudioFeatures, BusMessage, Unsubscribe } from '@cybernoetica/core';
import { EMASmoothing } from '../../smoothing.js';
import type { Visualizer, VisualizerMetadata } from '../types.js';
import { registerVisualizer } from '../registry.js';

/**
 * Flow Field visualizer — curl noise particle streaks.
 *
 * Renders a 2D vector field defined by the curl of layered simplex noise,
 * producing smooth, swirling particle-like streaks entirely in the fragment
 * shader. Multiple octaves of noise create turbulent eddies at various scales.
 *
 * Bass drives turbulence intensity, mids control flow speed, spectral centroid
 * shifts the noise scale (revealing finer or coarser structure), and beat
 * onset triggers sudden field rotations that send streaks spiraling.
 */

const flowfieldMetadata: VisualizerMetadata = {
  type: 'flowfield',
  label: 'Flow Field',
  description: 'Curl noise vector field streaks',
  usesPerspective: false,
  params: [
    // Appearance
    { key: 'octaves', label: 'Octaves', min: 1, max: 6, step: 1, initial: 3, category: 'appearance', description: 'Noise octave layers (more = finer detail)' },
    { key: 'brightness', label: 'Brightness', min: 0.5, max: 3.0, step: 0.1, initial: 1.4, category: 'appearance', description: 'Overall brightness multiplier' },
    { key: 'streakLength', label: 'Streak Length', min: 4, max: 32, step: 2, initial: 16, category: 'appearance', description: 'Number of advection steps per pixel' },
    { key: 'colorCycle', label: 'Color Cycle', min: 0.0, max: 1.0, step: 0.05, initial: 0.3, category: 'appearance', description: 'Base hue cycling speed' },
    { key: 'flowSpeed', label: 'Flow Speed', min: 0.1, max: 2.0, step: 0.1, initial: 0.8, category: 'appearance', description: 'Base advection speed' },
    // Audio mapping
    { key: 'bassToTurbulence', label: 'Bass -> Turbulence', min: 0.0, max: 2.0, step: 0.1, initial: 1.0, category: 'audio-mapping', description: 'How bass increases turbulence' },
    { key: 'midToSpeed', label: 'Mid -> Speed', min: 0.0, max: 2.0, step: 0.1, initial: 1.0, category: 'audio-mapping', description: 'How mids accelerate flow' },
    { key: 'spectralToScale', label: 'Spectral -> Scale', min: 0.0, max: 2.0, step: 0.1, initial: 1.0, category: 'audio-mapping', description: 'How spectral centroid shifts noise scale' },
    { key: 'rmsToGlow', label: 'RMS -> Glow', min: 0.0, max: 2.0, step: 0.1, initial: 1.0, category: 'audio-mapping', description: 'How volume boosts glow intensity' },
  ],
  viewport: { pan: true, zoom: true, orbit: false },
  viewStateFields: [
    { key: 'zoom', label: 'Zoom', min: 0.3, max: 5.0, step: 0.05 },
    { key: 'panX', label: 'Pan X', min: -3.0, max: 3.0, step: 0.01 },
    { key: 'panY', label: 'Pan Y', min: -3.0, max: 3.0, step: 0.01 },
  ],
};

export class FlowFieldVisualizer implements Visualizer {
  readonly metadata = flowfieldMetadata;

  private unsub: Unsubscribe;
  private latestFeatures: AudioFeatures | null = null;
  private time = 0;

  private userParams: Record<string, number> = {
    octaves: 3,
    brightness: 1.4,
    streakLength: 16,
    colorCycle: 0.3,
    flowSpeed: 0.8,
    bassToTurbulence: 1.0,
    midToSpeed: 1.0,
    spectralToScale: 1.0,
    rmsToGlow: 1.0,
  };

  private _zoom = 1.0;
  private _panX = 0.0;
  private _panY = 0.0;

  private smoothers = {
    bass: new EMASmoothing(0.12),
    mid: new EMASmoothing(0.18),
    high: new EMASmoothing(0.22),
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
        u_pan: { value: new THREE.Vector2(0, 0) },
        u_octaves: { value: 3.0 },
        u_brightness: { value: 1.4 },
        u_streakLength: { value: 16.0 },
        u_colorCycle: { value: 0.3 },
        u_flowSpeed: { value: 0.8 },
        u_bass: { value: 0.0 },
        u_mid: { value: 0.0 },
        u_high: { value: 0.0 },
        u_rms: { value: 0.1 },
        u_spectralCentroid: { value: 0.5 },
        u_beatPulse: { value: 0.0 },
        u_turbulence: { value: 1.0 },
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
      u.u_pan.value.set(this._panX, this._panY);
      u.u_octaves.value = this.userParams.octaves;
      u.u_brightness.value = this.userParams.brightness;
      u.u_streakLength.value = this.userParams.streakLength;
      u.u_colorCycle.value = this.userParams.colorCycle;

      // Flow speed modulated by mids
      const speedMod = 1.0 + this.smoothers.mid.value * 0.8 * this.userParams.midToSpeed;
      u.u_flowSpeed.value = this.userParams.flowSpeed * speedMod;

      // Turbulence from bass
      u.u_turbulence.value = 1.0 + this.smoothers.bass.value * 1.5 * this.userParams.bassToTurbulence;

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
    return { zoom: this._zoom, panX: this._panX, panY: this._panY };
  }

  setViewState(partial: Record<string, number>): void {
    if ('zoom' in partial) this._zoom = Math.max(0.3, Math.min(5.0, partial.zoom));
    if ('panX' in partial) this._panX = Math.max(-3.0, Math.min(3.0, partial.panX));
    if ('panY' in partial) this._panY = Math.max(-3.0, Math.min(3.0, partial.panY));
  }

  dispose(): void {
    this.unsub();
    this.material?.dispose();
    this.mesh?.geometry.dispose();
  }
}

registerVisualizer({
  metadata: flowfieldMetadata,
  create: (bus) => new FlowFieldVisualizer(bus),
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
  #define MAX_STEPS 32

  uniform float u_time;
  uniform vec2 u_resolution;
  uniform float u_zoom;
  uniform vec2 u_pan;
  uniform float u_octaves;
  uniform float u_brightness;
  uniform float u_streakLength;
  uniform float u_colorCycle;
  uniform float u_flowSpeed;
  uniform float u_bass;
  uniform float u_mid;
  uniform float u_high;
  uniform float u_rms;
  uniform float u_spectralCentroid;
  uniform float u_beatPulse;
  uniform float u_turbulence;

  varying vec2 vUv;

  // --- Simplex-like noise ---
  vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
  vec2 mod289(vec2 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
  vec3 permute(vec3 x) { return mod289(((x * 34.0) + 1.0) * x); }

  float snoise(vec2 v) {
    const vec4 C = vec4(0.211324865405187, 0.366025403784439,
                        -0.577350269189626, 0.024390243902439);
    vec2 i = floor(v + dot(v, C.yy));
    vec2 x0 = v - i + dot(i, C.xx);
    vec2 i1 = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
    vec4 x12 = x0.xyxy + C.xxzz;
    x12.xy -= i1;
    i = mod289(i);
    vec3 p = permute(permute(i.y + vec3(0.0, i1.y, 1.0)) + i.x + vec3(0.0, i1.x, 1.0));
    vec3 m = max(0.5 - vec3(dot(x0, x0), dot(x12.xy, x12.xy), dot(x12.zw, x12.zw)), 0.0);
    m = m * m;
    m = m * m;
    vec3 x = 2.0 * fract(p * C.www) - 1.0;
    vec3 h = abs(x) - 0.5;
    vec3 ox = floor(x + 0.5);
    vec3 a0 = x - ox;
    m *= 1.79284291400159 - 0.85373472095314 * (a0 * a0 + h * h);
    vec3 g;
    g.x = a0.x * x0.x + h.x * x0.y;
    g.yz = a0.yz * x12.xz + h.yz * x12.yw;
    return 130.0 * dot(m, g);
  }

  // Curl of 2D scalar noise field (gives divergence-free vector field)
  vec2 curlNoise(vec2 p, float t) {
    float eps = 0.01;
    float n1 = snoise(vec2(p.x, p.y + eps) + t * 0.1);
    float n2 = snoise(vec2(p.x, p.y - eps) + t * 0.1);
    float n3 = snoise(vec2(p.x + eps, p.y) + t * 0.1);
    float n4 = snoise(vec2(p.x - eps, p.y) + t * 0.1);
    float dndx = (n3 - n4) / (2.0 * eps);
    float dndy = (n1 - n2) / (2.0 * eps);
    return vec2(dndy, -dndx);
  }

  // Multi-octave curl noise
  vec2 fbmCurl(vec2 p, float t, int octaves) {
    vec2 sum = vec2(0.0);
    float amp = 1.0;
    float freq = 1.0;
    for (int i = 0; i < 6; i++) {
      if (i >= octaves) break;
      sum += curlNoise(p * freq, t + float(i) * 1.37) * amp;
      freq *= 2.0;
      amp *= 0.5;
    }
    return sum;
  }

  vec3 hsv2rgb(vec3 c) {
    vec4 K = vec4(1.0, 2.0 / 3.0, 1.0 / 3.0, 3.0);
    vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
    return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
  }

  void main() {
    vec2 uv = (gl_FragCoord.xy - 0.5 * u_resolution) / min(u_resolution.x, u_resolution.y);
    uv = uv * 2.5 / u_zoom + u_pan;

    int steps = int(clamp(u_streakLength, 4.0, float(MAX_STEPS)));
    int octaves = int(clamp(u_octaves, 1.0, 6.0));

    // Scale shift from spectral centroid
    float scaleShift = 1.0 + (u_spectralCentroid - 0.5) * 0.6;

    // Advect the pixel position through the flow field
    vec2 pos = uv * scaleShift;
    float timeOffset = u_time * u_flowSpeed;
    float totalCurl = 0.0;
    float density = 0.0;
    float colorAccum = 0.0;

    for (int i = 0; i < MAX_STEPS; i++) {
      if (i >= steps) break;

      vec2 vel = fbmCurl(pos * u_turbulence, timeOffset, octaves);
      float speed = length(vel);

      // Accumulate density (convergence regions get brighter)
      density += speed;
      colorAccum += atan(vel.y, vel.x);

      // Step along the flow
      pos += vel * 0.02;
      totalCurl += abs(vel.x - vel.y);
    }

    density /= float(steps);
    totalCurl /= float(steps);

    // Streak intensity based on flow coherence
    float streak = smoothstep(0.0, 0.8, density);

    // --- Coloring ---
    float hue = fract(
      colorAccum * 0.05
      + u_time * u_colorCycle * 0.1
      + totalCurl * 0.3
      + u_spectralCentroid * 0.1
    );

    float sat = 0.55 + 0.35 * streak;
    float val = streak * u_brightness;

    // RMS glow boost
    val *= 0.5 + u_rms * 1.0;
    val += u_beatPulse * 0.12;

    vec3 color = hsv2rgb(vec3(hue, sat, clamp(val, 0.0, 1.0)));

    // Flow direction highlighting
    vec2 finalVel = fbmCurl(uv * scaleShift * u_turbulence, timeOffset, octaves);
    float dirAngle = atan(finalVel.y, finalVel.x);
    float dirHighlight = 0.5 + 0.5 * sin(dirAngle * 3.0 + u_time);
    color += vec3(0.03) * dirHighlight * u_high;

    // Vortex cores: where curl magnitude is high
    float vortex = smoothstep(0.6, 1.5, length(finalVel));
    vec3 vortexColor = hsv2rgb(vec3(fract(hue + 0.4), 0.6, 0.3));
    color += vortexColor * vortex * 0.3 * u_bass;

    // Beat flash
    color += vec3(0.06, 0.04, 0.08) * u_beatPulse * 0.4;

    // Background
    color = max(color, vec3(0.005, 0.005, 0.012));

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
