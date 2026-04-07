import * as THREE from 'three';
import { MessageBus } from '@cybernoetica/core';
import type { AudioFeatures, BusMessage, Unsubscribe } from '@cybernoetica/core';
import { EMASmoothing } from '../../smoothing.js';
import type { Visualizer, VisualizerMetadata } from '../types.js';
import { registerVisualizer } from '../registry.js';

/**
 * Julia Set visualizer — the Mandelbrot's shape-shifting sibling.
 *
 * Every point c in the complex plane defines a unique Julia set.
 * Small changes in c produce dramatic visual transformations:
 * connected ↔ dust, spirals ↔ dendrites, symmetry changes.
 *
 * Audio drives the c parameter on a slow orbit through interesting regions,
 * creating an endlessly morphing fractal that breathes with the music.
 */

/** Interesting c-values that produce beautiful Julia sets */
const JULIA_ORBITS = [
  { cx: -0.7269, cy: 0.1889 },   // Dendrite spirals
  { cx: -0.8, cy: 0.156 },       // Classic "San Marco" dragon
  { cx: -0.4, cy: 0.6 },         // Rabbit-like connected set
  { cx: 0.285, cy: 0.01 },       // Near the Mandelbrot boundary
  { cx: -0.0352, cy: 0.6862 },   // Douady's rabbit
  { cx: -0.7017, cy: 0.3842 },   // Near seahorse valley
  { cx: 0.0, cy: 0.8 },          // Dendrites
  { cx: -1.037, cy: 0.17 },      // Near period-3 bulb
];

const juliaMetadata: VisualizerMetadata = {
  type: 'julia',
  label: 'Julia Set',
  description: 'Shape-shifting fractal morphology',
  usesPerspective: false,
  params: [
    // Appearance
    { key: 'orbitSpeed', label: 'Orbit Speed', min: 0.02, max: 0.5, step: 0.02, initial: 0.15, category: 'appearance' },
    { key: 'orbitRadius', label: 'Orbit Radius', min: 0.01, max: 0.25, step: 0.01, initial: 0.08, category: 'appearance' },
    { key: 'transitionDuration', label: 'Morph Speed', min: 2, max: 20, step: 1, initial: 8, category: 'appearance' },
    // Audio mapping strengths
    { key: 'bassToOrbit', label: 'Bass \u2192 Orbit', min: 0.0, max: 2.0, step: 0.1, initial: 1.0, category: 'audio-mapping', description: 'How strongly bass pushes the c-parameter orbit' },
    { key: 'midToZoom', label: 'Mid \u2192 Zoom', min: 0.0, max: 2.0, step: 0.1, initial: 1.0, category: 'audio-mapping', description: 'How strongly mids drive zoom breathing' },
    { key: 'rmsToBrightness', label: 'RMS \u2192 Brightness', min: 0.0, max: 2.0, step: 0.1, initial: 1.0, category: 'audio-mapping', description: 'How strongly volume affects brightness' },
  ],
  viewport: { pan: false, zoom: true, orbit: false },
  viewStateFields: [
    { key: 'seedReal', label: 'Seed (Real)', min: -2, max: 2, step: 0.001 },
    { key: 'seedImaginary', label: 'Seed (Imag)', min: -2, max: 2, step: 0.001 },
    { key: 'zoom', label: 'Zoom', min: 0.3, max: 5, step: 0.05 },
  ],
};

export class JuliaVisualizer implements Visualizer {
  readonly metadata = juliaMetadata;

  private unsub: Unsubscribe;
  private latestFeatures: AudioFeatures | null = null;
  private time = 0;

  private orbitPhase = Math.random() * Math.PI * 2;
  private orbitSpeed = 0.15;
  private orbitRadius = 0.08;
  private baseCx: number;
  private baseCy: number;
  private targetIdx = 0;

  private smoothers = {
    cx: new EMASmoothing(0.03),
    cy: new EMASmoothing(0.03),
    zoom: new EMASmoothing(0.06),
    colorSpeed: new EMASmoothing(0.12),
    iterations: new EMASmoothing(0.05),
    brightness: new EMASmoothing(0.1),
    colorWarmth: new EMASmoothing(0.08),
    beatPulse: new EMASmoothing(0.5),
  };

  private audioMapStrengths: Record<string, number> = {
    bassToOrbit: 1.0,
    midToZoom: 1.0,
    rmsToBrightness: 1.0,
  };

  private material: THREE.ShaderMaterial | null = null;
  private mesh: THREE.Mesh | null = null;
  private transitionTime = 0;
  private transitionDuration = 8;

  constructor(private bus: MessageBus) {
    this.targetIdx = Math.floor(Math.random() * JULIA_ORBITS.length);
    const target = JULIA_ORBITS[this.targetIdx];
    this.baseCx = target.cx;
    this.baseCy = target.cy;

    this.unsub = bus.subscribe('audio:features', (msg: BusMessage<AudioFeatures>) => {
      this.latestFeatures = msg.payload;
    });

    this.smoothers.cx.reset(this.baseCx);
    this.smoothers.cy.reset(this.baseCy);
    this.smoothers.zoom.reset(1.2);
    this.smoothers.colorSpeed.reset(0.6);
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
        u_c: { value: new THREE.Vector2(this.baseCx, this.baseCy) },
        u_zoom: { value: 1.2 },
        u_iterations: { value: 200.0 },
        u_colorSpeed: { value: 0.6 },
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
    this.transitionTime += 1 / 60;

    // Orbit the c-parameter around the current base point
    this.orbitPhase += this.orbitSpeed / 60;

    // Slowly transition between interesting base points (unless user overrode seed)
    if (!this.viewOverrides.seed) {
      if (this.transitionTime > this.transitionDuration) {
        this.transitionTime = 0;
        this.targetIdx = (this.targetIdx + 1) % JULIA_ORBITS.length;
      }
      const nextIdx = (this.targetIdx + 1) % JULIA_ORBITS.length;
      const t = this.transitionTime / this.transitionDuration;
      const smoothT = t * t * (3 - 2 * t);
      const current = JULIA_ORBITS[this.targetIdx];
      const next = JULIA_ORBITS[nextIdx];
      this.baseCx = current.cx + (next.cx - current.cx) * smoothT;
      this.baseCy = current.cy + (next.cy - current.cy) * smoothT;
    }

    if (this.latestFeatures) {
      const f = this.latestFeatures;
      const am = this.audioMapStrengths;
      const audioRadius = this.orbitRadius * (0.5 + f.bass * 1.5 * am.bassToOrbit);
      const cx = this.baseCx + Math.cos(this.orbitPhase) * audioRadius;
      const cy = this.baseCy + Math.sin(this.orbitPhase) * audioRadius;

      this.smoothers.cx.update(cx);
      this.smoothers.cy.update(cy);
      this.smoothers.zoom.update(1.0 + f.mid * 0.8 * am.midToZoom);
      this.smoothers.colorSpeed.update(0.3 + f.mid * 2.0);
      this.smoothers.iterations.update(150 + f.high * 350);
      this.smoothers.brightness.update(0.5 + f.rms * 0.8 * am.rmsToBrightness);
      this.smoothers.colorWarmth.update(f.spectralCentroid);
      this.smoothers.beatPulse.update(f.beatOnset ? 1.0 : 0.0);

      // Beat onset can speed up the orbit temporarily
      if (f.beatOnset) {
        this.orbitSpeed = 0.4;
      } else {
        this.orbitSpeed += (0.15 - this.orbitSpeed) * 0.02;
      }
    } else {
      // Idle: gentle orbit
      const cx = this.baseCx + Math.cos(this.orbitPhase) * this.orbitRadius;
      const cy = this.baseCy + Math.sin(this.orbitPhase) * this.orbitRadius;
      this.smoothers.cx.update(cx);
      this.smoothers.cy.update(cy);
      this.smoothers.beatPulse.update(0);
    }

    if (this.material) {
      this.material.uniforms.u_c.value.set(this.smoothers.cx.value, this.smoothers.cy.value);
      this.material.uniforms.u_zoom.value = this.smoothers.zoom.value;
      this.material.uniforms.u_iterations.value = Math.round(Math.min(this.smoothers.iterations.value, 800));
      this.material.uniforms.u_colorSpeed.value = this.smoothers.colorSpeed.value;
      this.material.uniforms.u_brightness.value = this.smoothers.brightness.value + this.smoothers.beatPulse.value * 0.25;
      this.material.uniforms.u_colorWarmth.value = this.smoothers.colorWarmth.value;
      this.material.uniforms.u_beatPulse.value = this.smoothers.beatPulse.value;
      this.material.uniforms.u_time.value = this.time;
    }
  }

  private viewOverrides: Record<string, boolean> = {};

  getViewState(): Record<string, number> {
    return {
      seedReal: this.smoothers.cx.value,
      seedImaginary: this.smoothers.cy.value,
      zoom: this.smoothers.zoom.value,
    };
  }

  setViewState(partial: Record<string, number>): void {
    if ('seedReal' in partial) {
      this.baseCx = partial.seedReal;
      this.smoothers.cx.reset(partial.seedReal);
      this.viewOverrides.seed = true;
    }
    if ('seedImaginary' in partial) {
      this.baseCy = partial.seedImaginary;
      this.smoothers.cy.reset(partial.seedImaginary);
      this.viewOverrides.seed = true;
    }
    if ('zoom' in partial) {
      this.smoothers.zoom.reset(partial.zoom);
      this.viewOverrides.zoom = true;
    }
  }

  setResolution(width: number, height: number): void {
    if (this.material) this.material.uniforms.u_resolution.value.set(width, height);
  }

  setUserParam(key: string, value: number): void {
    switch (key) {
      case 'orbitSpeed': this.orbitSpeed = value; break;
      case 'orbitRadius': this.orbitRadius = value; break;
      case 'transitionDuration': this.transitionDuration = value; break;
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
  metadata: juliaMetadata,
  create: (bus) => new JuliaVisualizer(bus),
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
  uniform vec2 u_c;
  uniform float u_zoom;
  uniform float u_iterations;
  uniform float u_colorSpeed;
  uniform float u_brightness;
  uniform float u_colorWarmth;
  uniform float u_beatPulse;
  uniform float u_time;
  uniform vec2 u_resolution;
  varying vec2 vUv;

  vec3 palette(float t, float warmth) {
    vec3 warm = vec3(0.6, 0.2, 0.1);
    vec3 cool = vec3(0.1, 0.2, 0.6);
    vec3 base = mix(cool, warm, warmth);
    vec3 a = base;
    vec3 b = vec3(0.5, 0.5, 0.5);
    vec3 c = vec3(1.0, 1.0, 0.5);
    vec3 d = vec3(0.8, 0.9, 0.3);
    return a + b * cos(6.28318 * (c * t + d));
  }

  void main() {
    vec2 uv = (gl_FragCoord.xy - 0.5 * u_resolution) / min(u_resolution.x, u_resolution.y);

    // Julia set: z starts at the pixel position, c is the uniform parameter
    vec2 z = uv / u_zoom;
    vec2 c = u_c;

    int maxIter = int(u_iterations);
    int i;
    for (i = 0; i < 800; i++) {
      if (i >= maxIter) break;
      if (dot(z, z) > 256.0) break;
      z = vec2(z.x * z.x - z.y * z.y + c.x, 2.0 * z.x * z.y + c.y);
    }

    float t = float(i) / float(maxIter);

    // Smooth iteration count
    if (i < maxIter) {
      float log_zn = log(dot(z, z)) / 2.0;
      float nu = log(log_zn / log(2.0)) / log(2.0);
      t = (float(i) + 1.0 - nu) / float(maxIter);
    }

    vec3 color = palette(t * u_colorSpeed + u_time * 0.08, u_colorWarmth);
    color *= u_brightness;

    // Beat pulse: glow at boundary
    if (u_beatPulse > 0.01 && i < maxIter) {
      float edge = 1.0 - smoothstep(0.0, 0.12, t);
      color += vec3(edge * u_beatPulse * 0.4);
    }

    // Interior: dark with subtle color
    if (i >= maxIter) {
      color = vec3(0.02, 0.01, 0.04) * (1.0 + 0.2 * sin(u_time * 0.3));
    }

    gl_FragColor = vec4(color, 1.0);
  }
`;
