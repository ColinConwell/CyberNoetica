import * as THREE from 'three';
import { MessageBus } from '@cybernoetica/core';
import type { AudioFeatures, BusMessage, Unsubscribe } from '@cybernoetica/core';
import { EMASmoothing } from '../../smoothing.js';
import type { Visualizer, VisualizerMetadata } from '../types.js';
import { registerVisualizer } from '../registry.js';

/**
 * Burning Ship fractal -- Michael Michelitsch & Otto E. Rössler (1992).
 *
 * A Mandelbrot-family fractal with a single absolute-value twist:
 *
 *   z_{n+1} = (|Re(z_n)| + i|Im(z_n)|)^2 + c
 *
 * The symmetry-breaking abs() produces the iconic spar-and-mast
 * "ship in flames" silhouette, flanked by fractal antennae and
 * tiny mini-ships along the hull. Much sharper edges than
 * Mandelbrot, with a strikingly architectural feel.
 *
 * Audio mapping:
 *   bass   -> zoom drive
 *   mid    -> iteration depth
 *   high   -> boundary shimmer
 *   rms    -> overall brightness
 *   beat   -> parameter jolt
 */

// Interesting regions of the Burning Ship fractal
const ZOOM_TARGETS = [
  { cx: -1.7600, cy: -0.0300, name: 'Main Ship' },
  { cx: -1.7490, cy: -0.0100, name: 'Mast' },
  { cx: -1.6260, cy:  0.0400, name: 'Antenna' },
  { cx: -1.9400, cy:  0.0000, name: 'Left Prow' },
  { cx: -1.7550, cy: -0.0285, name: 'Hull Mini' },
  { cx:  0.2300, cy: -1.1000, name: 'Lower Satellite' },
];

const burningShipMetadata: VisualizerMetadata = {
  type: 'burningship',
  label: 'Burning Ship',
  description: 'Absolute-value Mandelbrot variant with architectural spars',
  usesPerspective: false,
  params: [
    { key: 'zoomSpeed', label: 'Zoom Speed', min: 0.0002, max: 0.003, step: 0.0001, initial: 0.0008, category: 'appearance' },
    { key: 'rotationSpeed', label: 'Rotation', min: 0.0, max: 0.015, step: 0.001, initial: 0.002, category: 'appearance' },
    { key: 'maxIterations', label: 'Max Iterations', min: 40, max: 220, step: 10, initial: 120, category: 'appearance', description: 'Escape-time iteration ceiling' },
    { key: 'brightness', label: 'Brightness', min: 0.3, max: 2.5, step: 0.05, initial: 1.1, category: 'appearance' },
    { key: 'hueShift', label: 'Hue Shift', min: 0.0, max: 1.0, step: 0.01, initial: 0.08, category: 'appearance', description: 'Base palette rotation' },
    { key: 'bassToZoom', label: 'Bass \u2192 Zoom', min: 0.0, max: 2.0, step: 0.1, initial: 1.0, category: 'audio-mapping', description: 'Bass drives zoom rate' },
    { key: 'midToIters', label: 'Mid \u2192 Detail', min: 0.0, max: 2.0, step: 0.1, initial: 1.0, category: 'audio-mapping', description: 'Mids push iteration count' },
    { key: 'highToShimmer', label: 'High \u2192 Shimmer', min: 0.0, max: 2.0, step: 0.1, initial: 1.0, category: 'audio-mapping', description: 'Highs brighten fractal edges' },
    { key: 'rmsToBrightness', label: 'RMS \u2192 Brightness', min: 0.0, max: 2.0, step: 0.1, initial: 1.0, category: 'audio-mapping', description: 'Volume sets overall brightness' },
    { key: 'beatToJolt', label: 'Beat \u2192 Jolt', min: 0.0, max: 2.0, step: 0.1, initial: 1.0, category: 'audio-mapping', description: 'Beats spin the rotation' },
  ],
  viewport: { pan: true, zoom: true, orbit: false },
  viewStateFields: [
    { key: 'centerReal', label: 'Center (Real)', min: -2.5, max: 1.0, step: 0.001 },
    { key: 'centerImaginary', label: 'Center (Imag)', min: -2.0, max: 1.0, step: 0.001 },
    { key: 'zoom', label: 'Zoom', min: 0.5, max: 10000, step: 1 },
    { key: 'rotation', label: 'Rotation', min: 0, max: 6.283, step: 0.01 },
  ],
};

export class BurningShipVisualizer implements Visualizer {
  readonly metadata = burningShipMetadata;

  private unsub: Unsubscribe;
  private latestFeatures: AudioFeatures | null = null;
  private time = 0;

  private zoomLevel = 0.6;
  private zoomDirection: 'in' | 'out' = 'in';
  private maxZoom = 5000;
  private minZoom = 0.6;
  private targetIndex = 0;
  private target = ZOOM_TARGETS[0];
  private cx: number;
  private cy: number;
  private rotation = 0;

  private userParams: Record<string, number> = {
    zoomSpeed: 0.0008,
    rotationSpeed: 0.002,
    maxIterations: 120,
    brightness: 1.1,
    hueShift: 0.08,
    bassToZoom: 1.0,
    midToIters: 1.0,
    highToShimmer: 1.0,
    rmsToBrightness: 1.0,
    beatToJolt: 1.0,
  };

  private viewOverrides: Record<string, boolean> = {};

  private smoothers = {
    bass: new EMASmoothing(0.1),
    mid: new EMASmoothing(0.15),
    high: new EMASmoothing(0.22),
    rms: new EMASmoothing(0.12),
    beatPulse: new EMASmoothing(0.4),
  };

  private material: THREE.ShaderMaterial | null = null;
  private mesh: THREE.Mesh | null = null;

  constructor(private bus: MessageBus) {
    this.cx = this.target.cx;
    this.cy = this.target.cy;

    this.unsub = bus.subscribe('audio:features', (msg: BusMessage<AudioFeatures>) => {
      this.latestFeatures = msg.payload;
    });

    this.smoothers.bass.reset(0);
    this.smoothers.mid.reset(0);
    this.smoothers.high.reset(0);
    this.smoothers.rms.reset(0.1);
    this.smoothers.beatPulse.reset(0);
  }

  attach(scene: THREE.Scene): void {
    this.material = new THREE.ShaderMaterial({
      vertexShader: VERTEX_SHADER,
      fragmentShader: FRAGMENT_SHADER,
      uniforms: {
        u_time: { value: 0.0 },
        u_resolution: { value: new THREE.Vector2(1920, 1080) },
        u_center: { value: new THREE.Vector2(this.cx, this.cy) },
        u_zoom: { value: 0.6 },
        u_rotation: { value: 0.0 },
        u_maxIterations: { value: 120.0 },
        u_brightness: { value: 1.1 },
        u_hueShift: { value: 0.08 },
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

  tick(): void {
    this.time += 1 / 60;

    if (this.latestFeatures) {
      const f = this.latestFeatures;
      this.smoothers.bass.update(f.bass);
      this.smoothers.mid.update(f.mid);
      this.smoothers.high.update(f.high);
      this.smoothers.rms.update(f.rms);
      this.smoothers.beatPulse.update(f.beatOnset ? 1.0 : 0.0);
    } else {
      this.smoothers.beatPulse.update(0.0);
    }

    const bassBoost = this.smoothers.bass.value * 0.8 * this.userParams.bassToZoom;
    const zoomRate = this.userParams.zoomSpeed * (1.0 + bassBoost);

    // Auto zoom cycle (unless user has overridden the view)
    if (!this.viewOverrides.zoom) {
      if (this.zoomDirection === 'in') {
        this.zoomLevel *= (1.0 + zoomRate);
        if (this.zoomLevel >= this.maxZoom) this.zoomDirection = 'out';
      } else {
        this.zoomLevel *= (1.0 - zoomRate * 1.5);
        if (this.zoomLevel <= this.minZoom) {
          this.zoomDirection = 'in';
          this.targetIndex = (this.targetIndex + 1) % ZOOM_TARGETS.length;
          this.target = ZOOM_TARGETS[this.targetIndex];
          this.cx = this.target.cx;
          this.cy = this.target.cy;
        }
      }
    }

    if (!this.viewOverrides.rotation) {
      this.rotation += this.userParams.rotationSpeed * (1.0 + this.smoothers.beatPulse.value * 0.5 * this.userParams.beatToJolt);
      if (this.rotation > Math.PI * 2) this.rotation -= Math.PI * 2;
    }

    const iters = this.userParams.maxIterations * (1.0 + this.smoothers.mid.value * 0.3 * this.userParams.midToIters);

    if (this.material) {
      const u = this.material.uniforms;
      u.u_time.value = this.time;
      u.u_center.value.set(this.cx, this.cy);
      u.u_zoom.value = this.zoomLevel;
      u.u_rotation.value = this.rotation;
      u.u_maxIterations.value = iters;
      u.u_brightness.value = this.userParams.brightness * (0.7 + this.smoothers.rms.value * this.userParams.rmsToBrightness);
      u.u_hueShift.value = this.userParams.hueShift;
      u.u_rms.value = this.smoothers.rms.value;
      u.u_high.value = this.smoothers.high.value * this.userParams.highToShimmer;
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
    return {
      centerReal: this.cx,
      centerImaginary: this.cy,
      zoom: this.zoomLevel,
      rotation: this.rotation,
    };
  }

  setViewState(partial: Record<string, number>): void {
    if ('centerReal' in partial) {
      this.cx = Math.max(-2.5, Math.min(1.0, partial.centerReal));
      this.viewOverrides.centerReal = true;
    }
    if ('centerImaginary' in partial) {
      this.cy = Math.max(-2.0, Math.min(1.0, partial.centerImaginary));
      this.viewOverrides.centerImaginary = true;
    }
    if ('zoom' in partial) {
      this.zoomLevel = Math.max(0.5, Math.min(10000, partial.zoom));
      this.viewOverrides.zoom = true;
    }
    if ('rotation' in partial) {
      this.rotation = ((partial.rotation % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
      this.viewOverrides.rotation = true;
    }
  }

  dispose(): void {
    this.unsub();
    this.material?.dispose();
    this.mesh?.geometry.dispose();
  }
}

registerVisualizer({
  metadata: burningShipMetadata,
  create: (bus) => new BurningShipVisualizer(bus),
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

  uniform float u_time;
  uniform vec2 u_resolution;
  uniform vec2 u_center;
  uniform float u_zoom;
  uniform float u_rotation;
  uniform float u_maxIterations;
  uniform float u_brightness;
  uniform float u_hueShift;
  uniform float u_rms;
  uniform float u_high;
  uniform float u_beatPulse;

  varying vec2 vUv;

  vec3 hsv2rgb(vec3 c) {
    vec4 K = vec4(1.0, 2.0 / 3.0, 1.0 / 3.0, 3.0);
    vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
    return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
  }

  void main() {
    vec2 uv = (gl_FragCoord.xy - 0.5 * u_resolution) / min(u_resolution.x, u_resolution.y);

    // Rotate
    float cr = cos(u_rotation);
    float sr = sin(u_rotation);
    uv = mat2(cr, -sr, sr, cr) * uv;

    // Map to complex plane -- zoom is a linear "magnification"
    float scale = 3.0 / u_zoom;
    vec2 c = uv * scale + u_center;

    // Conventionally Burning Ship is displayed upside down to look like a ship;
    // leave as-is so the "flames" point up naturally.
    c.y = -c.y;

    vec2 z = vec2(0.0);
    float iterations = 0.0;
    int maxIter = int(clamp(u_maxIterations, 8.0, 300.0));
    float escape = 0.0;

    for (int i = 0; i < 300; i++) {
      if (i >= maxIter) break;
      // Burning Ship: z = (|Re(z)| + i*|Im(z)|)^2 + c
      vec2 az = abs(z);
      float zr = az.x * az.x - az.y * az.y + c.x;
      float zi = 2.0 * az.x * az.y + c.y;
      z = vec2(zr, zi);
      float m = dot(z, z);
      if (m > 256.0) {
        // Smooth iteration count
        iterations = float(i) - log2(log2(m)) + 4.0;
        escape = 1.0;
        break;
      }
      iterations = float(i);
    }

    float t = iterations / u_maxIterations;

    vec3 color;
    if (escape < 0.5) {
      // Interior -- deep ember
      color = vec3(0.008, 0.004, 0.015);
    } else {
      // Fiery palette with optional hue shift
      float hue = fract(u_hueShift + t * 0.85 + u_time * 0.02);
      float sat = 0.75 + 0.2 * sin(t * 12.0);
      float val = pow(t, 0.55) * u_brightness;

      // High-end shimmer along outer edges
      val += (1.0 - t) * u_high * 0.35;

      color = hsv2rgb(vec3(hue, sat, clamp(val, 0.0, 1.0)));
    }

    // Beat flash
    color += vec3(1.0, 0.6, 0.2) * u_beatPulse * 0.15 * escape;

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
