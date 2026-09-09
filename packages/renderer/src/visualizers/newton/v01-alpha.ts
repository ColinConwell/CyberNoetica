import { topologyValue } from '../../audio-mapping.js';
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
 * Newton fractal visualizer.
 *
 * Classic complex-plane fractal: iterate Newton's method on
 *   f(z) = z^n - 1
 * to find which of the n roots of unity each starting point converges to.
 * The basins of attraction tile the plane in sharp, fractally-bounded
 * regions colored by root index, with additional shading from iteration
 * count (convergence speed).
 *
 * Unlike Julia/Mandelbrot, Newton fractals have smooth convergent interiors
 * separated by crisp fractal boundaries -- a completely different aesthetic.
 *
 * Audio mapping:
 *   bass  -> relaxation parameter "a" (pulling trajectory to different basins)
 *   mid   -> integer polynomial degree
 *   high  -> boundary highlight intensity
 *   rms   -> overall luminance
 *   beat  -> root rotation impulse
 */

const newtonMetadata: VisualizerMetadata = {
  type: 'newton',
  label: 'Newton Fractal',
  description: "Newton's method basins of attraction",
  usesPerspective: false,
  params: [
    // Appearance
    {
      key: 'exponent',
      label: 'Exponent',
      min: 3,
      max: 8,
      step: 1,
      initial: 5,
      category: 'appearance',
      description: 'Polynomial z^n - 1 exponent',
    },
    {
      key: 'relaxation',
      label: 'Relaxation',
      min: 0.3,
      max: 1.8,
      step: 0.02,
      initial: 1.0,
      category: 'appearance',
      description: 'Over/under-relaxation factor a',
    },
    {
      key: 'iterations',
      label: 'Detail',
      min: 10,
      max: 40,
      step: 1,
      initial: 20,
      category: 'appearance',
      description: 'Newton iteration count',
    },
    {
      key: 'brightness',
      label: 'Brightness',
      min: 0.3,
      max: 2.5,
      step: 0.05,
      initial: 1.1,
      category: 'appearance',
      description: 'Overall luminance',
    },
    {
      key: 'boundaryGlow',
      label: 'Boundary Glow',
      min: 0.0,
      max: 2.0,
      step: 0.05,
      initial: 0.8,
      category: 'appearance',
      description: 'Strength of fractal edge highlight',
    },
    {
      key: 'hueShift',
      label: 'Hue Shift',
      min: 0.0,
      max: 1.0,
      step: 0.01,
      initial: 0.0,
      category: 'appearance',
      description: 'Base palette rotation',
    },
    {
      key: 'rootRotation',
      label: 'Root Rotation',
      min: -1.0,
      max: 1.0,
      step: 0.01,
      initial: 0.0,
      category: 'appearance',
      description: 'Phase offset of roots',
    },
    // Audio mapping
    {
      key: 'bassToRelax',
      label: 'Bass \u2192 Relax',
      min: 0.0,
      max: 2.0,
      step: 0.1,
      initial: 1.0,
      category: 'audio-mapping',
      description: 'Bass modulates relaxation factor',
    },
    {
      key: 'midToExponent',
      label: 'Mid \u2192 Exponent',
      min: 0.0,
      max: 2.0,
      step: 0.1,
      initial: 0.8,
      category: 'audio-mapping',
      description: 'Mids select an integer polynomial degree',
    },
    {
      key: 'highToBoundary',
      label: 'High \u2192 Boundary',
      min: 0.0,
      max: 2.0,
      step: 0.1,
      initial: 1.0,
      category: 'audio-mapping',
      description: 'Highs intensify boundary glow',
    },
    {
      key: 'rmsToGlow',
      label: 'RMS \u2192 Glow',
      min: 0.0,
      max: 2.0,
      step: 0.1,
      initial: 1.0,
      category: 'audio-mapping',
      description: 'Volume drives overall brightness',
    },
    {
      key: 'beatToSpin',
      label: 'Beat \u2192 Spin',
      min: 0.0,
      max: 2.0,
      step: 0.1,
      initial: 1.0,
      category: 'audio-mapping',
      description: 'Beats spin the root configuration',
    },
  ],
  viewport: { pan: true, zoom: true, orbit: false },
  viewStateFields: [
    { key: 'zoom', label: 'Zoom', min: 0.1, max: 8.0, step: 0.05 },
    { key: 'panX', label: 'Pan X', min: -3, max: 3, step: 0.05 },
    { key: 'panY', label: 'Pan Y', min: -3, max: 3, step: 0.05 },
  ],
};

export class NewtonVisualizer implements Visualizer {
  private deltaSeconds = 1 / 60;
  private phases = new PhaseClock();
  readonly metadata = newtonMetadata;

  private unsub: Unsubscribe;
  private latestFeatures: AudioFeatures | null = null;
  private time = 0;
  private degree = 3;
  private rootSpinVelocity = 0;
  private rootSpinAccum = 0;

  private userParams: Record<string, number> = {
    exponent: 5,
    relaxation: 1.0,
    iterations: 20,
    brightness: 1.1,
    boundaryGlow: 0.8,
    hueShift: 0.0,
    rootRotation: 0.0,
    bassToRelax: 1.0,
    midToExponent: 0.8,
    highToBoundary: 1.0,
    rmsToGlow: 1.0,
    beatToSpin: 1.0,
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
        u_exponent: { value: 5.0 },
        u_relaxation: { value: 1.0 },
        u_iterations: { value: 20.0 },
        u_brightness: { value: 1.1 },
        u_boundaryGlow: { value: 0.8 },
        u_hueShift: { value: 0.0 },
        u_rootRotation: { value: 0.0 },
        u_rms: { value: 0.1 },
        u_high: { value: 0.0 },
        u_beatPulse: { value: 0.0 },
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

      if (f.beatOnset && this.userParams.beatToSpin > 0) {
        this.rootSpinVelocity += 0.6 * this.userParams.beatToSpin;
      }
    } else {
      this.smoothers.beatPulse.update(0.0, this.deltaSeconds);
    }

    // Decay spin impulse
    this.rootSpinVelocity *= Math.pow(0.95, this.deltaSeconds * 60);
    this.rootSpinAccum += this.rootSpinVelocity * this.deltaSeconds;

    // Relaxation breathing
    const relax =
      this.userParams.relaxation +
      (this.smoothers.bass.value - 0.3) * 0.25 * this.userParams.bassToRelax;

    // Integer polynomial degree, bounded by the shader power loop
    const expMorph =
      this.userParams.exponent +
      this.smoothers.mid.value * 0.9 * this.userParams.midToExponent;

    if (this.material) {
      const u = this.material.uniforms;
      u.u_time.value = this.time;
      u.u_zoom.value = this._zoom;
      u.u_pan.value.set(this._panX, this._panY);
      this.degree = topologyValue(this.degree, expMorph, 2, 8);
      u.u_exponent.value = this.degree;
      u.u_relaxation.value = relax;
      u.u_iterations.value = this.userParams.iterations;
      u.u_brightness.value = this.userParams.brightness;
      u.u_boundaryGlow.value =
        this.userParams.boundaryGlow *
        (1.0 + this.smoothers.high.value * this.userParams.highToBoundary);
      u.u_hueShift.value = this.userParams.hueShift;
      u.u_rootRotation.value =
        this.userParams.rootRotation + this.rootSpinAccum;
      u.u_rms.value = this.smoothers.rms.value * this.userParams.rmsToGlow;
      u.u_high.value = this.smoothers.high.value;
      u.u_beatPulse.value = this.smoothers.beatPulse.value;
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
      this._zoom = Math.max(0.1, Math.min(8.0, partial.zoom));
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
  metadata: newtonMetadata,
  create: (bus) => new NewtonVisualizer(bus),
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
  #define MAX_ITERS 40
  #define MAX_N 8

  uniform float u_time;
  uniform vec2 u_resolution;
  uniform float u_zoom;
  uniform vec2 u_pan;
  uniform float u_exponent;
  uniform float u_relaxation;
  uniform float u_iterations;
  uniform float u_brightness;
  uniform float u_boundaryGlow;
  uniform float u_hueShift;
  uniform float u_rootRotation;
  uniform float u_rms;
  uniform float u_high;
  uniform float u_beatPulse;

  varying vec2 vUv;

  #include <cyber_hsv2rgb>

  // Complex multiplication
  vec2 cmul(vec2 a, vec2 b) {
    return vec2(a.x * b.x - a.y * b.y, a.x * b.y + a.y * b.x);
  }

  // Complex division: a/b
  vec2 cdiv(vec2 a, vec2 b) {
    float denom = dot(b, b);
    return vec2(a.x * b.x + a.y * b.y, a.y * b.x - a.x * b.y) / denom;
  }

  // Complex power z^n for integer n >= 1
  vec2 cpow(vec2 z, int n) {
    vec2 r = vec2(1.0, 0.0);
    for (int i = 0; i < 8; i++) {
      if (i >= n) break;
      r = cmul(r, z);
    }
    return r;
  }

  void main() {
    vec2 uv = (gl_FragCoord.xy - 0.5 * u_resolution) / min(u_resolution.x, u_resolution.y);

    // Map screen to complex plane
    float scale = 2.5 / u_zoom;
    vec2 z = uv * scale + u_pan;
    // Solve in the rotated root frame: world roots are exp(i*(rotation+2πk/n)).
    z = cmul(z, vec2(cos(u_rootRotation), -sin(u_rootRotation)));

    int n = int(clamp(floor(u_exponent + 0.5), 2.0, 8.0));

    int iters = int(u_iterations);
    int hitIter = iters;
    bool converged = false;

    // Newton iteration for f(z) = z^n - 1
    // Update: z_{k+1} = z_k - a * (z^n - 1) / (n * z^(n-1))
    for (int i = 0; i < MAX_ITERS; i++) {
      if (i >= iters) break;

      vec2 zn = cpow(z, n);
      vec2 numer = zn - vec2(1.0, 0.0);
      vec2 znm1 = cpow(z, n - 1);
      vec2 denom = float(n) * znm1;
      if (dot(numer, numer) < 1e-10) {
        hitIter = i;
        converged = true;
        break;
      }
      // A stationary point is not a root; do not divide by f'(z)=0.
      if (dot(denom, denom) < 1e-20 || dot(z, z) > 1e8) break;
      vec2 step = cdiv(numer, denom);

      vec2 zNext = z - u_relaxation * step;

      z = zNext;
    }

    // Identify which root we converged to
    float theta = atan(z.y, z.x);
    // Nearest root angle: 2*pi*k/n with a possible global rotation
    float rootIdxF = theta / TAU * float(n);
    rootIdxF = floor(rootIdxF + 0.5);
    float rootFrac = fract(rootIdxF / float(n) + 1.0);

    // Basin color
    float hue = fract(u_hueShift + rootFrac);
    float sat = 0.72;

    // Convergence shading: slower convergence = darker
    float convT = float(hitIter) / float(iters);
    float bodyVal = (1.0 - convT) * u_brightness;

    // Distance to nearest root in complex plane (proxy for "edge softness")
    float rootAngle = rootIdxF * TAU / float(n);
    vec2 rootPos = vec2(cos(rootAngle), sin(rootAngle));
    float rootDist = length(z - rootPos);

    // Boundary glow: points near iteration cap form the fractal boundary
    float boundary = 0.0;
    if (!converged) {
      boundary = 1.0;
    } else {
      // Points that took many iterations but eventually converged are still near boundary
      boundary = smoothstep(0.3, 0.8, convT);
    }

    vec3 basinColor = hsv2rgb(vec3(hue, sat, bodyVal));

    // Boundary highlight in complementary color
    vec3 edgeColor = hsv2rgb(vec3(fract(hue + 0.5), 0.4, 1.0));
    vec3 color = mix(basinColor, edgeColor, boundary * u_boundaryGlow * 0.7);

    // Volume glow
    color *= (0.75 + u_rms * 0.5);

    // Highs: add sparkle along boundaries
    color += edgeColor * u_high * boundary * 0.2;

    // Beat flash: brief white highlight on boundaries
    color += vec3(1.0) * boundary * u_beatPulse * 0.25;

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
