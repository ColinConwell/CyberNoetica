import * as THREE from 'three';
import { MessageBus } from '@cybernoetica/core';
import type { AudioFeatures, BusMessage, Unsubscribe } from '@cybernoetica/core';
import { EMASmoothing } from '../../smoothing.js';
import type { Visualizer, VisualizerMetadata } from '../types.js';
import { registerVisualizer } from '../registry.js';

const gyroidMetadata: VisualizerMetadata = {
  type: 'gyroid',
  label: 'Gyroid',
  description: 'Triply periodic minimal surface with iridescent lighting',
  usesPerspective: false,
  params: [
    { key: 'threshold', label: 'Threshold', min: -1.5, max: 1.5, step: 0.05, initial: 0.0, category: 'appearance', description: 'Surface iso-value (controls topology)' },
    { key: 'period', label: 'Period', min: 1.0, max: 6.0, step: 0.1, initial: 3.0, category: 'appearance', description: 'Spatial repetition frequency' },
    { key: 'rotSpeed', label: 'Rotation Speed', min: 0.0, max: 1.0, step: 0.05, initial: 0.3, category: 'appearance', description: 'Auto-rotation speed' },
    { key: 'iridescence', label: 'Iridescence', min: 0.0, max: 2.0, step: 0.1, initial: 1.0, category: 'appearance', description: 'Rainbow sheen intensity' },
    { key: 'smoothness', label: 'Smoothness', min: 0.5, max: 3.0, step: 0.1, initial: 1.5, category: 'appearance', description: 'Surface smoothing factor' },
    { key: 'bassToThreshold', label: 'Bass -> Threshold', min: 0.0, max: 2.0, step: 0.1, initial: 1.0, category: 'audio-mapping', description: 'Bass morphs surface topology' },
    { key: 'midToPeriod', label: 'Mid -> Period', min: 0.0, max: 2.0, step: 0.1, initial: 1.0, category: 'audio-mapping', description: 'Mids modulate spatial period' },
    { key: 'highToIridescence', label: 'High -> Iridescence', min: 0.0, max: 2.0, step: 0.1, initial: 1.0, category: 'audio-mapping', description: 'Highs drive rainbow coloring' },
    { key: 'rmsToGlow', label: 'RMS -> Glow', min: 0.0, max: 2.0, step: 0.1, initial: 1.0, category: 'audio-mapping', description: 'Volume boosts emission' },
    { key: 'beatToPulse', label: 'Beat -> Pulse', min: 0.0, max: 2.0, step: 0.1, initial: 1.0, category: 'audio-mapping', description: 'Beats trigger surface pulse' },
  ],
  viewport: { pan: true, zoom: true, orbit: false },
  viewStateFields: [
    { key: 'centerX', label: 'Center X', min: -3, max: 3, step: 0.05 },
    { key: 'centerY', label: 'Center Y', min: -3, max: 3, step: 0.05 },
    { key: 'zoom', label: 'Zoom', min: 0.2, max: 4.0, step: 0.05 },
  ],
};

export class GyroidVisualizer implements Visualizer {
  readonly metadata = gyroidMetadata;

  private unsub: Unsubscribe;
  private latestFeatures: AudioFeatures | null = null;
  private time = 0;

  private userParams: Record<string, number> = {
    threshold: 0.0,
    period: 3.0,
    rotSpeed: 0.3,
    iridescence: 1.0,
    smoothness: 1.5,
    bassToThreshold: 1.0,
    midToPeriod: 1.0,
    highToIridescence: 1.0,
    rmsToGlow: 1.0,
    beatToPulse: 1.0,
  };

  private _centerX = 0;
  private _centerY = 0;
  private _zoom = 1.0;

  private smoothers = {
    bass: new EMASmoothing(0.12),
    mid: new EMASmoothing(0.18),
    high: new EMASmoothing(0.25),
    rms: new EMASmoothing(0.15),
    beatPulse: new EMASmoothing(0.4),
    spectralCentroid: new EMASmoothing(0.08),
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
    this.smoothers.beatPulse.reset(0);
    this.smoothers.spectralCentroid.reset(0.5);
  }

  attach(scene: THREE.Scene): void {
    this.material = new THREE.ShaderMaterial({
      vertexShader: VERTEX_SHADER,
      fragmentShader: FRAGMENT_SHADER,
      uniforms: {
        u_time: { value: 0.0 },
        u_resolution: { value: new THREE.Vector2(1920, 1080) },
        u_zoom: { value: 1.0 },
        u_center: { value: new THREE.Vector2(0, 0) },
        u_threshold: { value: 0.0 },
        u_period: { value: 3.0 },
        u_rotSpeed: { value: 0.3 },
        u_iridescence: { value: 1.0 },
        u_smoothness: { value: 1.5 },
        u_bass: { value: 0.0 },
        u_mid: { value: 0.0 },
        u_high: { value: 0.0 },
        u_rms: { value: 0.1 },
        u_beatPulse: { value: 0.0 },
        u_spectralCentroid: { value: 0.5 },
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
      this.smoothers.spectralCentroid.update(f.spectralCentroid);
    } else {
      this.smoothers.beatPulse.update(0.0);
    }

    if (this.material) {
      const u = this.material.uniforms;
      u.u_time.value = this.time;
      u.u_zoom.value = this._zoom;
      u.u_center.value.set(this._centerX, this._centerY);
      u.u_threshold.value = this.userParams.threshold
        + (this.smoothers.bass.value - 0.3) * 0.8 * this.userParams.bassToThreshold;
      u.u_period.value = this.userParams.period
        + this.smoothers.mid.value * 1.0 * this.userParams.midToPeriod;
      u.u_rotSpeed.value = this.userParams.rotSpeed;
      u.u_iridescence.value = this.userParams.iridescence
        + this.smoothers.high.value * 0.8 * this.userParams.highToIridescence;
      u.u_smoothness.value = this.userParams.smoothness;
      u.u_bass.value = this.smoothers.bass.value;
      u.u_mid.value = this.smoothers.mid.value;
      u.u_high.value = this.smoothers.high.value;
      u.u_rms.value = this.smoothers.rms.value;
      u.u_beatPulse.value = this.smoothers.beatPulse.value * this.userParams.beatToPulse;
      u.u_spectralCentroid.value = this.smoothers.spectralCentroid.value;
    }
  }

  setResolution(width: number, height: number): void {
    if (this.material) this.material.uniforms.u_resolution.value.set(width, height);
  }

  setUserParam(key: string, value: number): void {
    if (key in this.userParams) this.userParams[key] = value;
  }

  getViewState(): Record<string, number> {
    return { centerX: this._centerX, centerY: this._centerY, zoom: this._zoom };
  }

  setViewState(partial: Record<string, number>): void {
    if ('centerX' in partial) this._centerX = Math.max(-3, Math.min(3, partial.centerX));
    if ('centerY' in partial) this._centerY = Math.max(-3, Math.min(3, partial.centerY));
    if ('zoom' in partial) this._zoom = Math.max(0.2, Math.min(4.0, partial.zoom));
  }

  dispose(): void {
    this.unsub();
    this.material?.dispose();
    this.mesh?.geometry.dispose();
  }
}

registerVisualizer({
  metadata: gyroidMetadata,
  create: (bus) => new GyroidVisualizer(bus),
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
  #define MAX_STEPS 80
  #define MAX_DIST 20.0
  #define SURF_DIST 0.001

  uniform float u_time;
  uniform vec2 u_resolution;
  uniform float u_zoom;
  uniform vec2 u_center;
  uniform float u_threshold;
  uniform float u_period;
  uniform float u_rotSpeed;
  uniform float u_iridescence;
  uniform float u_smoothness;
  uniform float u_bass;
  uniform float u_mid;
  uniform float u_high;
  uniform float u_rms;
  uniform float u_beatPulse;
  uniform float u_spectralCentroid;

  varying vec2 vUv;

  mat3 rotateX(float a) {
    float c = cos(a), s = sin(a);
    return mat3(1,0,0, 0,c,-s, 0,s,c);
  }
  mat3 rotateY(float a) {
    float c = cos(a), s = sin(a);
    return mat3(c,0,s, 0,1,0, -s,0,c);
  }

  float gyroidSDF(vec3 p, float scale, float threshold, float smooth_f) {
    p *= scale;
    float g = sin(p.x) * cos(p.y) + sin(p.y) * cos(p.z) + sin(p.z) * cos(p.x);
    float d = (g - threshold) / (scale * smooth_f);
    return d;
  }

  float sceneSDF(vec3 p) {
    float gyroid = gyroidSDF(p, u_period, u_threshold, u_smoothness);
    float sphere = length(p) - 2.8;
    return max(gyroid, sphere);
  }

  vec3 calcNormal(vec3 p) {
    vec2 e = vec2(0.001, 0.0);
    return normalize(vec3(
      sceneSDF(p + e.xyy) - sceneSDF(p - e.xyy),
      sceneSDF(p + e.yxy) - sceneSDF(p - e.yxy),
      sceneSDF(p + e.yyx) - sceneSDF(p - e.yyx)
    ));
  }

  float raymarch(vec3 ro, vec3 rd) {
    float t = 0.0;
    for (int i = 0; i < MAX_STEPS; i++) {
      vec3 p = ro + rd * t;
      float d = sceneSDF(p);
      if (abs(d) < SURF_DIST) return t;
      if (t > MAX_DIST) break;
      t += abs(d) * 0.7;
    }
    return -1.0;
  }

  float calcAO(vec3 p, vec3 n) {
    float ao = 0.0;
    float scale = 1.0;
    for (int i = 0; i < 5; i++) {
      float h = 0.01 + 0.12 * float(i);
      float d = sceneSDF(p + n * h);
      ao += (h - d) * scale;
      scale *= 0.6;
    }
    return clamp(1.0 - 3.0 * ao, 0.0, 1.0);
  }

  vec3 iridescent(vec3 n, vec3 v, float intensity) {
    float fresnel = pow(1.0 - abs(dot(n, v)), 3.0);
    float angle = dot(n, v) * 0.5 + 0.5;
    vec3 col;
    col.r = 0.5 + 0.5 * cos(TAU * (angle * 1.0 + 0.0 + u_spectralCentroid));
    col.g = 0.5 + 0.5 * cos(TAU * (angle * 1.0 + 0.33 + u_spectralCentroid));
    col.b = 0.5 + 0.5 * cos(TAU * (angle * 1.0 + 0.67 + u_spectralCentroid));
    return mix(vec3(0.7), col, fresnel * intensity);
  }

  void main() {
    vec2 uv = (gl_FragCoord.xy - 0.5 * u_resolution) / min(u_resolution.x, u_resolution.y);
    uv = uv / u_zoom + u_center;

    float rotAngle = u_time * u_rotSpeed;
    mat3 rot = rotateY(rotAngle) * rotateX(rotAngle * 0.7 + sin(u_time * 0.2) * 0.3);

    vec3 ro = rot * vec3(0.0, 0.0, 5.5);
    vec3 target = vec3(0.0);
    vec3 fwd = normalize(target - ro);
    vec3 right = normalize(cross(vec3(0, 1, 0), fwd));
    vec3 up = cross(fwd, right);
    vec3 rd = normalize(fwd + uv.x * right + uv.y * up);

    float t = raymarch(ro, rd);

    vec3 color = vec3(0.01, 0.005, 0.02);

    if (t > 0.0) {
      vec3 p = ro + rd * t;
      vec3 n = calcNormal(p);
      float ao = calcAO(p, n);

      vec3 lightDir1 = normalize(vec3(1.0, 1.2, 0.8));
      vec3 lightDir2 = normalize(vec3(-0.5, -0.3, -1.0));

      float diff1 = max(dot(n, lightDir1), 0.0);
      float diff2 = max(dot(n, lightDir2), 0.0) * 0.3;

      vec3 halfVec = normalize(lightDir1 - rd);
      float spec = pow(max(dot(n, halfVec), 0.0), 32.0);

      vec3 iriColor = iridescent(n, -rd, u_iridescence);

      float emissionBoost = 0.5 + u_rms * 1.5;
      vec3 baseLight = vec3(0.9, 0.85, 1.0) * diff1 + vec3(0.3, 0.4, 0.6) * diff2;
      color = iriColor * baseLight * ao * emissionBoost;
      color += spec * vec3(1.0, 0.95, 0.9) * 0.5;

      color += iriColor * u_beatPulse * 0.4;

      float fog = exp(-t * 0.15);
      color *= fog;
    }

    float aspect = u_resolution.x / u_resolution.y;
    vec2 screenUv = gl_FragCoord.xy / u_resolution;
    float vignette = 1.0 - 0.35 * length((screenUv - 0.5) * vec2(aspect, 1.0));
    color *= vignette;

    color = color / (0.9 + color);

    gl_FragColor = vec4(color, 1.0);
  }
`;
