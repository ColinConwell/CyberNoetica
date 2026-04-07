import * as THREE from 'three';
import { MessageBus } from '@cybernoetica/core';
import type { AudioFeatures, BusMessage, Unsubscribe } from '@cybernoetica/core';
import { EMASmoothing } from '../../smoothing.js';
import type { Visualizer, VisualizerMetadata } from '../types.js';
import { registerVisualizer } from '../registry.js';

export interface MandelbrotUniforms {
  zoom: number;
  colorSpeed: number;
  iterations: number;
  brightness: number;
  colorWarmth: number;
  centerX: number;
  centerY: number;
  time: number;
}

/**
 * Interesting regions on the Mandelbrot set boundary.
 * Each has a center point and a target zoom depth where the detail is most visible.
 */
const ZOOM_TARGETS = [
  // Seahorse Valley — the cleft between main cardioid and period-2 bulb
  { cx: -0.7463, cy: 0.1102, name: 'Seahorse Valley' },
  // Elephant Valley — the cusp between main cardioid and the negative real axis
  { cx: -0.1528, cy: 1.0397, name: 'Elephant Valley' },
  // Double spiral near Seahorse Valley
  { cx: -0.7453, cy: 0.1127, name: 'Double Spiral' },
  // Mini Mandelbrot on the real axis
  { cx: -1.7686, cy: 0.0, name: 'Mini Mandelbrot' },
  // Antenna tip spirals
  { cx: -0.158, cy: 1.033, name: 'Antenna Spirals' },
  // Satellite mini-brot
  { cx: 0.2820, cy: 0.0100, name: 'Satellite' },
  // Deep zoom needle
  { cx: -0.7436447860, cy: 0.1318252536, name: 'Deep Needle' },
  // Star pattern
  { cx: -0.0452407412, cy: 0.9868162205, name: 'Star Pattern' },
];

const mandelbrotMetadata: VisualizerMetadata = {
  type: 'mandelbrot',
  label: 'Mandelbrot',
  description: 'Deep zoom into infinite fractal edges',
  usesPerspective: false,
  params: [
    // Appearance
    { key: 'zoomSpeed', label: 'Zoom Speed', min: 0.0002, max: 0.003, step: 0.0001, initial: 0.0008, category: 'appearance' },
    { key: 'rotationSpeed', label: 'Rotation', min: 0.0, max: 0.015, step: 0.001, initial: 0.003, category: 'appearance' },
    // Audio mapping strengths
    { key: 'bassToZoom', label: 'Bass \u2192 Zoom', min: 0.0, max: 2.0, step: 0.1, initial: 1.0, category: 'audio-mapping', description: 'How strongly bass drives zoom speed' },
    { key: 'rmsToBrightness', label: 'RMS \u2192 Brightness', min: 0.0, max: 2.0, step: 0.1, initial: 1.0, category: 'audio-mapping', description: 'How strongly volume affects brightness' },
    { key: 'centroidToWarmth', label: 'Centroid \u2192 Warmth', min: 0.0, max: 2.0, step: 0.1, initial: 1.0, category: 'audio-mapping', description: 'How strongly spectral centroid shifts color temperature' },
  ],
  viewport: { pan: true, zoom: true, orbit: false },
};

export class MandelbrotVisualizer implements Visualizer {
  readonly metadata = mandelbrotMetadata;

  private unsub: Unsubscribe;
  private latestFeatures: AudioFeatures | null = null;
  private time = 0;

  private zoomLevel = 0.8;
  private zoomSpeed = 0.0008;
  private targetIndex = 0;
  private target = ZOOM_TARGETS[0];
  private cx: number;
  private cy: number;
  private rotation = 0;
  private rotationEnabled = true;
  private rotationSpeed = 0.003;

  private audioMapStrengths: Record<string, number> = {
    bassToZoom: 1.0,
    rmsToBrightness: 1.0,
    centroidToWarmth: 1.0,
  };

  // Zoom cycle state: zoom in → peak → zoom out → switch target → zoom in
  private zoomDirection: 'in' | 'out' = 'in';
  private maxZoom = 8000;         // stay within float32 precision
  private minZoom = 0.8;

  // Smoothed audio parameters
  private smoothers = {
    zoomRate: new EMASmoothing(0.08),   // bass drives how fast we zoom
    colorSpeed: new EMASmoothing(0.15),
    iterations: new EMASmoothing(0.05),
    brightness: new EMASmoothing(0.12),
    colorWarmth: new EMASmoothing(0.08),
    beatPulse: new EMASmoothing(0.4),   // fast-decaying beat pulse
  };

  private material: THREE.ShaderMaterial | null = null;
  private mesh: THREE.Mesh | null = null;

  constructor(private bus: MessageBus) {
    // Pick a random starting target
    this.targetIndex = Math.floor(Math.random() * ZOOM_TARGETS.length);
    this.target = ZOOM_TARGETS[this.targetIndex];
    this.cx = this.target.cx;
    this.cy = this.target.cy;

    this.unsub = bus.subscribe('audio:features', (msg: BusMessage<AudioFeatures>) => {
      this.latestFeatures = msg.payload;
    });

    this.smoothers.zoomRate.reset(0.3);
    this.smoothers.colorSpeed.reset(0.5);
    this.smoothers.iterations.reset(200);
    this.smoothers.brightness.reset(0.8);
    this.smoothers.colorWarmth.reset(0.5);
    this.smoothers.beatPulse.reset(0);
  }

  attach(scene: THREE.Scene): void {
    this.material = new THREE.ShaderMaterial({
      vertexShader: VERTEX_SHADER,
      fragmentShader: FRAGMENT_SHADER,
      uniforms: {
        u_zoom: { value: this.zoomLevel },
        u_center: { value: new THREE.Vector2(this.cx, this.cy) },
        u_rotation: { value: 0.0 },
        u_iterations: { value: 200.0 },
        u_colorSpeed: { value: 0.5 },
        u_brightness: { value: 0.8 },
        u_colorWarmth: { value: 0.5 },
        u_beatPulse: { value: 0.0 },
        u_time: { value: 0.0 },
        u_resolution: { value: new THREE.Vector2(1920, 1080) },
      },
    });
    const geometry = new THREE.PlaneGeometry(2, 2);
    this.mesh = new THREE.Mesh(geometry, this.material);
    scene.add(this.mesh);
  }

  tick(): void {
    this.time += 1 / 60;

    if (this.latestFeatures) {
      const f = this.latestFeatures;
      const am = this.audioMapStrengths;
      this.smoothers.zoomRate.update(0.2 + f.bass * 0.8 * am.bassToZoom);
      this.smoothers.colorSpeed.update(0.3 + f.mid * 2.0);
      this.smoothers.iterations.update(150 + f.high * 350);
      this.smoothers.brightness.update(0.5 + f.rms * 0.8 * am.rmsToBrightness);
      this.smoothers.colorWarmth.update(f.spectralCentroid * am.centroidToWarmth);
      this.smoothers.beatPulse.update(f.beatOnset ? 1.0 : 0.0);
    } else {
      // Idle: gentle defaults
      this.smoothers.zoomRate.update(0.3);
      this.smoothers.beatPulse.update(0.0);
    }

    // Zoom cycle: zoom in to maxZoom, then reverse out, switch target, zoom in again
    const rate = this.zoomSpeed * this.smoothers.zoomRate.value;
    if (this.zoomDirection === 'in') {
      this.zoomLevel *= (1.0 + rate);
      if (this.zoomLevel >= this.maxZoom) {
        this.zoomDirection = 'out';
      }
    } else {
      this.zoomLevel *= (1.0 - rate * 1.5); // zoom out a bit faster
      if (this.zoomLevel <= this.minZoom) {
        // Pick next target and start zooming in again
        this.zoomDirection = 'in';
        this.targetIndex = (this.targetIndex + 1) % ZOOM_TARGETS.length;
        this.target = ZOOM_TARGETS[this.targetIndex];
        this.cx = this.target.cx;
        this.cy = this.target.cy;
        this.zoomLevel = this.minZoom;
      }
    }

    // Camera rotation — gentle spiral as we zoom
    if (this.rotationEnabled) {
      this.rotation += this.rotationSpeed * (0.5 + this.smoothers.zoomRate.value * 0.5);
    }

    // Increase iterations as we zoom deeper (needed for detail at depth)
    const depthIterBoost = Math.min(Math.log2(Math.max(this.zoomLevel, 1)) * 25, 400);
    const totalIterations = this.smoothers.iterations.value + depthIterBoost;

    // Update uniforms
    if (this.material) {
      this.material.uniforms.u_zoom.value = this.zoomLevel * this.userZoom;
      this.material.uniforms.u_center.value.set(
        this.cx + this.userPanX / this.zoomLevel,
        this.cy + this.userPanY / this.zoomLevel,
      );
      this.material.uniforms.u_rotation.value = this.rotation;
      this.material.uniforms.u_iterations.value = Math.round(Math.min(totalIterations, 1000));
      this.material.uniforms.u_colorSpeed.value = this.smoothers.colorSpeed.value;
      this.material.uniforms.u_brightness.value = this.smoothers.brightness.value + this.smoothers.beatPulse.value * 0.3;
      this.material.uniforms.u_colorWarmth.value = this.smoothers.colorWarmth.value;
      this.material.uniforms.u_beatPulse.value = this.smoothers.beatPulse.value;
      this.material.uniforms.u_time.value = this.time;
    }
  }

  getUniforms(): MandelbrotUniforms {
    return {
      zoom: this.zoomLevel,
      colorSpeed: this.smoothers.colorSpeed.value,
      iterations: Math.round(this.smoothers.iterations.value),
      brightness: this.smoothers.brightness.value,
      colorWarmth: this.smoothers.colorWarmth.value,
      centerX: this.cx,
      centerY: this.cy,
      time: this.time,
    };
  }

  private userPanX = 0;
  private userPanY = 0;
  private userZoom = 1.0;

  setPan(x: number, y: number): void {
    this.userPanX = x;
    this.userPanY = y;
  }

  setZoom(z: number): void {
    this.userZoom = z;
  }

  setResolution(width: number, height: number): void {
    if (this.material) this.material.uniforms.u_resolution.value.set(width, height);
  }

  setUserParam(key: string, value: number): void {
    switch (key) {
      case 'zoomSpeed': this.zoomSpeed = value; break;
      case 'rotationSpeed':
        this.rotationSpeed = value;
        this.rotationEnabled = value > 0;
        break;
      default:
        if (key in this.audioMapStrengths) {
          this.audioMapStrengths[key] = value;
        }
        break;
    }
  }

  dispose(): void {
    this.unsub();
    this.material?.dispose();
    this.mesh?.geometry.dispose();
  }
}

registerVisualizer({
  metadata: mandelbrotMetadata,
  create: (bus) => new MandelbrotVisualizer(bus),
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
  uniform float u_zoom;
  uniform vec2 u_center;
  uniform float u_rotation;
  uniform float u_iterations;
  uniform float u_colorSpeed;
  uniform float u_brightness;
  uniform float u_colorWarmth;
  uniform float u_beatPulse;
  uniform float u_time;
  uniform vec2 u_resolution;
  varying vec2 vUv;

  vec3 palette(float t, float warmth) {
    vec3 warm = vec3(0.5, 0.3, 0.1);
    vec3 cool = vec3(0.1, 0.3, 0.5);
    vec3 base = mix(cool, warm, warmth);
    vec3 a = base;
    vec3 b = vec3(0.5, 0.5, 0.5);
    vec3 c = vec3(1.0, 1.0, 1.0);
    vec3 d = vec3(0.0, 0.33, 0.67);
    return a + b * cos(6.28318 * (c * t + d));
  }

  void main() {
    vec2 uv = (gl_FragCoord.xy - 0.5 * u_resolution) / min(u_resolution.x, u_resolution.y);

    // Apply rotation around center
    float cosR = cos(u_rotation);
    float sinR = sin(u_rotation);
    uv = vec2(uv.x * cosR - uv.y * sinR, uv.x * sinR + uv.y * cosR);

    // Apply zoom: divide by zoom level to narrow the view
    vec2 c = uv / u_zoom + u_center;
    vec2 z = vec2(0.0);

    int maxIter = int(u_iterations);
    int i;
    for (i = 0; i < 1000; i++) {
      if (i >= maxIter) break;
      if (dot(z, z) > 256.0) break;  // larger escape radius for smoother coloring
      z = vec2(z.x * z.x - z.y * z.y + c.x, 2.0 * z.x * z.y + c.y);
    }

    float t = float(i) / float(maxIter);

    // Smooth iteration count for anti-banding
    if (i < maxIter) {
      float log_zn = log(dot(z, z)) / 2.0;
      float nu = log(log_zn / log(2.0)) / log(2.0);
      t = (float(i) + 1.0 - nu) / float(maxIter);
    }

    // Color with time-varying palette
    vec3 color = palette(t * u_colorSpeed + u_time * 0.05, u_colorWarmth);
    color *= u_brightness;

    // Beat pulse adds a white flash to the boundary region
    if (u_beatPulse > 0.01 && i < maxIter) {
      float edge = 1.0 - smoothstep(0.0, 0.15, t);
      color += vec3(edge * u_beatPulse * 0.5);
    }

    // Interior: very dark blue instead of pure black, with subtle time variation
    if (i >= maxIter) {
      color = vec3(0.01, 0.01, 0.03) * (1.0 + 0.3 * sin(u_time * 0.5));
    }

    gl_FragColor = vec4(color, 1.0);
  }
`;
