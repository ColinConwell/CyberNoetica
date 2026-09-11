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
 * Apollonian Gasket visualizer -- fractal circle packing.
 *
 * Iterated circle inversions inspired by Apollonian packing. This is not
 * a Descartes-circle construction, and no packing dimension is asserted.
 *
 * Audio mapping:
 *   bass  -> scale pulsation (circles breathe outward)
 *   mid   -> recursion depth (more mids = finer fractal detail)
 *   high  -> small-circle luminance (treble lights up deep structure)
 *   rms   -> overall brightness and fill opacity
 *   beat  -> inversion parameter jolt (ripple through fractal hierarchy)
 */

const apollonianMetadata: VisualizerMetadata = {
  type: 'apollonian',
  label: 'Apollonian Gasket',
  description: 'Apollonian-inspired circle inversions',
  usesPerspective: false,
  params: [
    // Appearance
    {
      key: 'iterations',
      label: 'Depth',
      min: 4,
      max: 14,
      step: 1,
      initial: 9,
      category: 'appearance',
      description: 'Inversion recursion depth',
    },
    {
      key: 'lineWidth',
      label: 'Line Width',
      min: 0.5,
      max: 4.0,
      step: 0.25,
      initial: 1.5,
      category: 'appearance',
      description: 'Circle outline thickness',
    },
    {
      key: 'colorCycles',
      label: 'Color Cycles',
      min: 0.5,
      max: 4.0,
      step: 0.25,
      initial: 1.5,
      category: 'appearance',
      description: 'Hue cycles across recursion depth',
    },
    {
      key: 'brightness',
      label: 'Brightness',
      min: 0.3,
      max: 2.0,
      step: 0.05,
      initial: 1.0,
      category: 'appearance',
      description: 'Overall luminance',
    },
    {
      key: 'rotationSpeed',
      label: 'Rotation',
      min: 0.0,
      max: 1.0,
      step: 0.05,
      initial: 0.15,
      category: 'appearance',
      description: 'Slow rotation animation',
    },
    {
      key: 'fillOpacity',
      label: 'Fill Opacity',
      min: 0.0,
      max: 1.0,
      step: 0.05,
      initial: 0.3,
      category: 'appearance',
      description: 'Circle interior fill',
    },
    // Audio mapping
    {
      key: 'bassToPulse',
      label: 'Bass → Pulse',
      min: 0.0,
      max: 2.0,
      step: 0.1,
      initial: 1.0,
      category: 'audio-mapping',
      description: 'Bass drives circle breathing',
    },
    {
      key: 'midToDepth',
      label: 'Mid → Depth',
      min: 0.0,
      max: 2.0,
      step: 0.1,
      initial: 1.0,
      category: 'audio-mapping',
      description: 'Mids reveal deeper structure',
    },
    {
      key: 'highToGlow',
      label: 'High → Glow',
      min: 0.0,
      max: 2.0,
      step: 0.1,
      initial: 1.0,
      category: 'audio-mapping',
      description: 'Highs light up small circles',
    },
    {
      key: 'rmsToFill',
      label: 'RMS → Fill',
      min: 0.0,
      max: 2.0,
      step: 0.1,
      initial: 1.0,
      category: 'audio-mapping',
      description: 'Volume drives fill opacity',
    },
    {
      key: 'beatToJolt',
      label: 'Beat → Jolt',
      min: 0.0,
      max: 2.0,
      step: 0.1,
      initial: 1.0,
      category: 'audio-mapping',
      description: 'Beats perturb inversions',
    },
  ],
  viewport: { pan: true, zoom: true, orbit: false },
  viewStateFields: [
    { key: 'zoom', label: 'Zoom', min: 0.2, max: 6.0, step: 0.05 },
    { key: 'panX', label: 'Pan X', min: -3, max: 3, step: 0.05 },
    { key: 'panY', label: 'Pan Y', min: -3, max: 3, step: 0.05 },
  ],
};

export class ApollonianVisualizer implements Visualizer {
  private deltaSeconds = 1 / 60;
  private phases = new PhaseClock();
  readonly metadata = apollonianMetadata;

  private unsub: Unsubscribe;
  private latestFeatures: AudioFeatures | null = null;
  private time = 0;
  private joltAccum = 0;
  private joltVelocity = 0;

  private userParams: Record<string, number> = {
    iterations: 9,
    lineWidth: 1.5,
    colorCycles: 1.5,
    brightness: 1.0,
    rotationSpeed: 0.15,
    fillOpacity: 0.3,
    bassToPulse: 1.0,
    midToDepth: 1.0,
    highToGlow: 1.0,
    rmsToFill: 1.0,
    beatToJolt: 1.0,
  };

  private _zoom = 1.0;
  private _panX = 0.0;
  private _panY = 0.0;
  private viewOverrides: Record<string, boolean> = {};

  private smoothers = {
    bass: new EMASmoothing(0.12),
    mid: new EMASmoothing(0.18),
    high: new EMASmoothing(0.25),
    rms: new EMASmoothing(0.15),
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
        u_pan: { value: new THREE.Vector2(0, 0) },
        u_iterations: { value: 9.0 },
        u_lineWidth: { value: 1.5 },
        u_colorCycles: { value: 1.5 },
        u_brightness: { value: 1.0 },
        u_fillOpacity: { value: 0.3 },
        u_bass: { value: 0.0 },
        u_mid: { value: 0.0 },
        u_high: { value: 0.0 },
        u_rms: { value: 0.1 },
        u_beatPulse: { value: 0.0 },
        u_jolt: { value: 0.0 },
        u_bassToPulse: { value: 1.0 },
        u_midToDepth: { value: 1.0 },
        u_highToGlow: { value: 1.0 },
        u_rmsToFill: { value: 1.0 },
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
      this.smoothers.beatPulse.update(
        f.beatOnset ? 1.0 : 0.0,
        this.deltaSeconds,
      );

      if (f.beatOnset && this.userParams.beatToJolt > 0) {
        this.joltVelocity += 0.4 * this.userParams.beatToJolt;
      }
    } else {
      this.smoothers.beatPulse.update(0.0, this.deltaSeconds);
    }

    this.joltVelocity *= 0.92;
    this.joltAccum += this.joltVelocity * this.deltaSeconds;

    if (this.material) {
      const u = this.material.uniforms;
      u.u_time.value = this.phases.advance(
        'animation',
        this.userParams.rotationSpeed,
        this.deltaSeconds,
      );
      u.u_zoom.value = this._zoom;
      u.u_pan.value.set(this._panX, this._panY);
      u.u_iterations.value =
        this.userParams.iterations +
        this.smoothers.mid.value * 3.0 * this.userParams.midToDepth;
      u.u_lineWidth.value = this.userParams.lineWidth;
      u.u_colorCycles.value = this.userParams.colorCycles;
      u.u_brightness.value = this.userParams.brightness;
      u.u_fillOpacity.value =
        this.userParams.fillOpacity +
        this.smoothers.rms.value * 0.3 * this.userParams.rmsToFill;
      u.u_bass.value = this.smoothers.bass.value;
      u.u_mid.value = this.smoothers.mid.value;
      u.u_high.value = this.smoothers.high.value;
      u.u_rms.value = this.smoothers.rms.value;
      u.u_beatPulse.value = this.smoothers.beatPulse.value;
      u.u_jolt.value = this.joltAccum;
      u.u_bassToPulse.value = this.userParams.bassToPulse;
      u.u_midToDepth.value = this.userParams.midToDepth;
      u.u_highToGlow.value = this.userParams.highToGlow;
      u.u_rmsToFill.value = this.userParams.rmsToFill;
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
    if ('zoom' in partial) {
      this._zoom = Math.max(0.2, Math.min(6.0, partial.zoom));
      this.viewOverrides.zoom = true;
    }
    if ('panX' in partial) {
      this._panX = Math.max(-3, Math.min(3, partial.panX));
      this.viewOverrides.panX = true;
    }
    if ('panY' in partial) {
      this._panY = Math.max(-3, Math.min(3, partial.panY));
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
  metadata: apollonianMetadata,
  create: (bus) => new ApollonianVisualizer(bus),
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
  #define MAX_ITERS 14

  uniform float u_time;
  uniform vec2 u_resolution;
  uniform float u_zoom;
  uniform vec2 u_pan;
  uniform float u_iterations;
  uniform float u_lineWidth;
  uniform float u_colorCycles;
  uniform float u_brightness;
  uniform float u_fillOpacity;
  uniform float u_bass;
  uniform float u_mid;
  uniform float u_high;
  uniform float u_rms;
  uniform float u_beatPulse;
  uniform float u_jolt;
  uniform float u_bassToPulse;
  uniform float u_midToDepth;
  uniform float u_highToGlow;
  uniform float u_rmsToFill;

  varying vec2 vUv;

  #include <cyber_hsv2rgb>

  // Circle inversion: invert point p through circle at center c with radius r
  vec2 inversion(vec2 p, vec2 c, float r) {
    vec2 d = p - c;
    float dist2 = dot(d, d);
    return c + r * r * d / max(dist2, 1e-8);
  }

  void main() {
    vec2 uv = (gl_FragCoord.xy - 0.5 * u_resolution) / min(u_resolution.x, u_resolution.y);
    float scale = 2.2 / u_zoom;
    vec2 p = uv * scale + u_pan;

    // Slow rotation
    float angle = u_time + u_jolt;
    float ca = cos(angle);
    float sa = sin(angle);
    p = vec2(ca * p.x - sa * p.y, sa * p.x + ca * p.y);

    // Bass-driven breathing: scale the inversion radii
    float breathe = 1.0 + (u_bass - 0.3) * 0.12 * u_bassToPulse;

    // Four inversion circles forming an Apollonian configuration
    // Three outer circles + one enclosing circle
    float r1 = 1.0 * breathe;
    float r2 = 1.0 * breathe;
    float r3 = 1.0 * breathe;

    // Positions of the three tangent circles (equilateral triangle arrangement)
    float sep = 1.15470053838 * breathe; // sqrt(4/3) ≈ 1.155 for mutually tangent unit circles
    vec2 c1 = vec2(0.0, sep);
    vec2 c2 = vec2(-breathe, -sep * 0.5);
    vec2 c3 = vec2(breathe, -sep * 0.5);

    int iters = int(min(u_iterations, float(MAX_ITERS)));

    float minDist = 1e10;
    float totalFold = 0.0;
    float depthHit = 0.0;

    vec2 z = p;

    // Iterative circle inversions -- the core Apollonian construction
    for (int i = 0; i < MAX_ITERS; i++) {
      if (i >= iters) break;

      float fi = float(i);
      float prevLen = length(z);

      // Invert through each of the three circles
      // Track which inversion brings us closest to a circle
      float d1 = length(z - c1) - r1;

      // Fold into the nearest circle
      if (d1 < 0.0) {
        z = inversion(z, c1, r1);
        totalFold += 1.0;
      }
      if (length(z - c2) < r2) {
        z = inversion(z, c2, r2);
        totalFold += 1.0;
      }
      if (length(z - c3) < r3) {
        z = inversion(z, c3, r3);
        totalFold += 1.0;
      }

      // Also fold through the enclosing circle (inversion in outer boundary)
      float outerR = (1.0 + 1.15470053838) * breathe;
      if (length(z) > outerR) {
        z = z * outerR * outerR / max(dot(z, z), 1e-8);
        totalFold += 1.0;
      }

      // Track minimum distance to any circle boundary
      float dc1 = abs(length(z - c1) - r1);
      float dc2 = abs(length(z - c2) - r2);
      float dc3 = abs(length(z - c3) - r3);
      float dcOuter = abs(length(z) - outerR);
      float localMin = min(min(dc1, dc2), min(dc3, dcOuter));

      if (localMin < minDist) {
        minDist = localMin;
        depthHit = fi;
      }
    }

    // Normalize fold count for coloring
    float foldNorm = totalFold / max(float(iters) * 2.0, 1.0);

    // Circle edge detection
    float pixelSize = scale / min(u_resolution.x, u_resolution.y) * 2.0;
    float edgeThickness = pixelSize * u_lineWidth * 3.0;
    float edge = 1.0 - smoothstep(0.0, edgeThickness, minDist);

    // Interior fill based on recursion depth
    float fillIntensity = foldNorm * u_fillOpacity;

    // Color by recursion depth and fold count
    float hue = fract(foldNorm * u_colorCycles + depthHit * 0.08 + u_time * 0.03);
    float sat = 0.6 + 0.3 * edge;
    float val = edge * 0.8 + fillIntensity * 0.4;

    // High-frequency glow on deep structure (small circles)
    float deepGlow = smoothstep(0.3, 0.8, foldNorm) * u_high * u_highToGlow;
    val += deepGlow * 0.4;
    hue = fract(hue - deepGlow * 0.1);

    // Brightness and RMS
    val *= u_brightness * (0.6 + u_rms * 0.6 * u_rmsToFill);

    vec3 color = hsv2rgb(vec3(hue, sat, clamp(val, 0.0, 1.0)));

    // Beat flash on edges
    color += vec3(1.0) * edge * u_beatPulse * 0.35;

    // Subtle inner glow: color the interior based on which inversions were dominant
    vec3 innerGlow = hsv2rgb(vec3(fract(hue + 0.33), 0.4, fillIntensity * 0.15));
    color += innerGlow;

    // Vignette
    float aspect = u_resolution.x / u_resolution.y;
    vec2 screenUv = gl_FragCoord.xy / u_resolution;
    float vignette = 1.0 - 0.3 * length((screenUv - 0.5) * vec2(aspect, 1.0));
    color *= vignette;

    // Background minimum
    color = max(color, vec3(0.006, 0.004, 0.012));

    // Tone mapping
    color = color / (1.0 + color);

    gl_FragColor = vec4(color, 1.0);
  }
`;
