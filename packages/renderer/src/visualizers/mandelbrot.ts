import * as THREE from 'three';
import { MessageBus } from '@cybernoetica/core';
import type { AudioFeatures, BusMessage, Unsubscribe } from '@cybernoetica/core';
import { EMASmoothing } from '../smoothing.js';

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

const DEFAULT_MAPPING = {
  bass: { target: 'zoom' as const, range: [0.5, 4.0] as const, smoothing: 0.15 },
  mid: { target: 'colorSpeed' as const, range: [0.0, 2.0] as const, smoothing: 0.2 },
  high: { target: 'iterations' as const, range: [50, 300] as const, smoothing: 0.1 },
  rms: { target: 'brightness' as const, range: [0.3, 1.2] as const, smoothing: 0.2 },
  spectralCentroid: { target: 'colorWarmth' as const, range: [0.0, 1.0] as const, smoothing: 0.1 },
};

export class MandelbrotVisualizer {
  private unsub: Unsubscribe;
  private latestFeatures: AudioFeatures | null = null;
  private time = 0;

  private smoothers = {
    zoom: new EMASmoothing(DEFAULT_MAPPING.bass.smoothing),
    colorSpeed: new EMASmoothing(DEFAULT_MAPPING.mid.smoothing),
    iterations: new EMASmoothing(DEFAULT_MAPPING.high.smoothing),
    brightness: new EMASmoothing(DEFAULT_MAPPING.rms.smoothing),
    colorWarmth: new EMASmoothing(DEFAULT_MAPPING.spectralCentroid.smoothing),
  };

  private material: THREE.ShaderMaterial | null = null;
  private mesh: THREE.Mesh | null = null;

  constructor(private bus: MessageBus) {
    this.unsub = bus.subscribe('audio:features', (msg: BusMessage<AudioFeatures>) => {
      this.latestFeatures = msg.payload;
    });
    this.smoothers.zoom.reset(1.0);
    this.smoothers.colorSpeed.reset(0.5);
    this.smoothers.iterations.reset(100);
    this.smoothers.brightness.reset(0.7);
    this.smoothers.colorWarmth.reset(0.5);
  }

  attach(scene: THREE.Scene): void {
    this.material = new THREE.ShaderMaterial({
      vertexShader: VERTEX_SHADER,
      fragmentShader: FRAGMENT_SHADER,
      uniforms: {
        u_zoom: { value: 1.0 },
        u_center: { value: new THREE.Vector2(-0.5, 0.0) },
        u_iterations: { value: 100.0 },
        u_colorSpeed: { value: 0.5 },
        u_brightness: { value: 0.7 },
        u_colorWarmth: { value: 0.5 },
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
      const m = DEFAULT_MAPPING;
      this.smoothers.zoom.update(lerp(m.bass.range[0], m.bass.range[1], f.bass));
      this.smoothers.colorSpeed.update(lerp(m.mid.range[0], m.mid.range[1], f.mid));
      this.smoothers.iterations.update(lerp(m.high.range[0], m.high.range[1], f.high));
      this.smoothers.brightness.update(lerp(m.rms.range[0], m.rms.range[1], f.rms));
      this.smoothers.colorWarmth.update(lerp(m.spectralCentroid.range[0], m.spectralCentroid.range[1], f.spectralCentroid));
    }
    if (this.material) {
      this.material.uniforms.u_zoom.value = this.smoothers.zoom.value;
      this.material.uniforms.u_colorSpeed.value = this.smoothers.colorSpeed.value;
      this.material.uniforms.u_iterations.value = Math.round(this.smoothers.iterations.value);
      this.material.uniforms.u_brightness.value = this.smoothers.brightness.value;
      this.material.uniforms.u_colorWarmth.value = this.smoothers.colorWarmth.value;
      this.material.uniforms.u_time.value = this.time;
    }
  }

  getUniforms(): MandelbrotUniforms {
    return {
      zoom: this.smoothers.zoom.value,
      colorSpeed: this.smoothers.colorSpeed.value,
      iterations: Math.round(this.smoothers.iterations.value),
      brightness: this.smoothers.brightness.value,
      colorWarmth: this.smoothers.colorWarmth.value,
      centerX: -0.5,
      centerY: 0.0,
      time: this.time,
    };
  }

  setResolution(width: number, height: number): void {
    if (this.material) this.material.uniforms.u_resolution.value.set(width, height);
  }

  dispose(): void {
    this.unsub();
    this.material?.dispose();
    this.mesh?.geometry.dispose();
  }
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

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
  uniform float u_iterations;
  uniform float u_colorSpeed;
  uniform float u_brightness;
  uniform float u_colorWarmth;
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
    vec2 c = uv / u_zoom + u_center;
    vec2 z = vec2(0.0);
    int maxIter = int(u_iterations);
    int i;
    for (i = 0; i < 1000; i++) {
      if (i >= maxIter) break;
      if (dot(z, z) > 4.0) break;
      z = vec2(z.x * z.x - z.y * z.y + c.x, 2.0 * z.x * z.y + c.y);
    }
    float t = float(i) / float(maxIter);
    if (i < maxIter) {
      float log_zn = log(dot(z, z)) / 2.0;
      float nu = log(log_zn / log(2.0)) / log(2.0);
      t = (float(i) + 1.0 - nu) / float(maxIter);
    }
    vec3 color = palette(t * u_colorSpeed + u_time * 0.1, u_colorWarmth);
    color *= u_brightness;
    if (i >= maxIter) color = vec3(0.0);
    gl_FragColor = vec4(color, 1.0);
  }
`;
