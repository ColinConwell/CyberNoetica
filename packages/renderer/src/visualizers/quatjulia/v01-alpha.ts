import * as THREE from 'three';
import { MessageBus } from '@cybernoetica/core';
import type { AudioFeatures, BusMessage, Unsubscribe } from '@cybernoetica/core';
import { EMASmoothing } from '../../smoothing.js';
import type { Visualizer, VisualizerMetadata } from '../types.js';
import { registerVisualizer } from '../registry.js';

/**
 * Quaternion Julia Set visualizer -- 3D raymarched fractal.
 *
 * Renders the 3D slice of a 4D quaternion Julia set using sphere-tracing
 * (raymarching with distance estimation). Produces organic, bone-like
 * structures that morph dramatically as the seed quaternion changes.
 *
 * Unlike the 2D Julia visualizer, this produces volumetric fractal surfaces
 * with lighting, shadows, and ambient occlusion for a striking 3D aesthetic.
 *
 * Audio mapping:
 *   bass  -> c.x (real) quaternion component -- gross structural morphing
 *   mid   -> c.y (i) component -- topological transitions
 *   high  -> ambient occlusion intensity
 *   rms   -> overall brightness / emissive glow
 *   beat  -> c perturbation spike through 4D parameter space
 */

const quatJuliaMetadata: VisualizerMetadata = {
  type: 'quatjulia',
  label: 'Quaternion Julia',
  description: '3D raymarched quaternion Julia fractal',
  usesPerspective: false,
  params: [
    // Appearance
    { key: 'seedX', label: 'Seed X', min: -1.5, max: 1.5, step: 0.01, initial: -0.45, category: 'appearance', description: 'Real component of seed quaternion c' },
    { key: 'seedY', label: 'Seed Y', min: -1.5, max: 1.5, step: 0.01, initial: 0.35, category: 'appearance', description: 'Imaginary i component of c' },
    { key: 'seedZ', label: 'Seed Z', min: -1.5, max: 1.5, step: 0.01, initial: 0.0, category: 'appearance', description: 'Imaginary j component of c' },
    { key: 'seedW', label: 'Seed W', min: -1.5, max: 1.5, step: 0.01, initial: 0.2, category: 'appearance', description: 'Imaginary k component of c' },
    { key: 'maxIter', label: 'Detail', min: 4, max: 16, step: 1, initial: 8, category: 'appearance', description: 'Fractal iteration count' },
    { key: 'aoStrength', label: 'AO Strength', min: 0.0, max: 2.0, step: 0.1, initial: 0.8, category: 'appearance', description: 'Ambient occlusion darkness' },
    { key: 'colorShift', label: 'Color Shift', min: 0.0, max: 1.0, step: 0.01, initial: 0.0, category: 'appearance', description: 'Palette hue rotation' },
    { key: 'orbitSpeed', label: 'Orbit Speed', min: 0.0, max: 1.0, step: 0.05, initial: 0.2, category: 'appearance', description: 'Camera auto-orbit speed' },
    // Audio mapping
    { key: 'bassToSeedX', label: 'Bass → Seed X', min: 0.0, max: 2.0, step: 0.1, initial: 1.0, category: 'audio-mapping', description: 'Bass modulates seed real part' },
    { key: 'midToSeedY', label: 'Mid → Seed Y', min: 0.0, max: 2.0, step: 0.1, initial: 0.8, category: 'audio-mapping', description: 'Mids modulate seed imaginary part' },
    { key: 'highToAO', label: 'High → AO', min: 0.0, max: 2.0, step: 0.1, initial: 1.0, category: 'audio-mapping', description: 'Highs intensify ambient occlusion' },
    { key: 'rmsToGlow', label: 'RMS → Glow', min: 0.0, max: 2.0, step: 0.1, initial: 1.0, category: 'audio-mapping', description: 'Volume drives surface brightness' },
    { key: 'beatToPerturb', label: 'Beat → Perturb', min: 0.0, max: 2.0, step: 0.1, initial: 1.0, category: 'audio-mapping', description: 'Beats jolt the seed quaternion' },
  ],
  viewport: { pan: false, zoom: true, orbit: false },
  viewStateFields: [
    { key: 'zoom', label: 'Zoom', min: 0.3, max: 5.0, step: 0.05 },
  ],
};

export class QuatJuliaVisualizer implements Visualizer {
  readonly metadata = quatJuliaMetadata;

  private unsub: Unsubscribe;
  private latestFeatures: AudioFeatures | null = null;
  private time = 0;
  private perturbDecay = 0;

  private userParams: Record<string, number> = {
    seedX: -0.45,
    seedY: 0.35,
    seedZ: 0.0,
    seedW: 0.2,
    maxIter: 8,
    aoStrength: 0.8,
    colorShift: 0.0,
    orbitSpeed: 0.2,
    bassToSeedX: 1.0,
    midToSeedY: 0.8,
    highToAO: 1.0,
    rmsToGlow: 1.0,
    beatToPerturb: 1.0,
  };

  private _zoom = 1.0;
  private viewOverrides: Record<string, boolean> = {};

  private smoothers = {
    bass: new EMASmoothing(0.1),
    mid: new EMASmoothing(0.15),
    high: new EMASmoothing(0.2),
    rms: new EMASmoothing(0.12),
    beatPulse: new EMASmoothing(0.4),
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
  }

  attach(scene: THREE.Scene): void {
    this.material = new THREE.ShaderMaterial({
      vertexShader: VERTEX_SHADER,
      fragmentShader: FRAGMENT_SHADER,
      uniforms: {
        u_time: { value: 0.0 },
        u_resolution: { value: new THREE.Vector2(1920, 1080) },
        u_zoom: { value: 1.0 },
        u_seed: { value: new THREE.Vector4(-0.45, 0.35, 0.0, 0.2) },
        u_maxIter: { value: 8.0 },
        u_aoStrength: { value: 0.8 },
        u_colorShift: { value: 0.0 },
        u_bass: { value: 0.0 },
        u_mid: { value: 0.0 },
        u_high: { value: 0.0 },
        u_rms: { value: 0.1 },
        u_beatPulse: { value: 0.0 },
        u_perturb: { value: 0.0 },
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

      if (f.beatOnset && this.userParams.beatToPerturb > 0) {
        this.perturbDecay = 0.3 * this.userParams.beatToPerturb;
      }
    } else {
      this.smoothers.beatPulse.update(0.0);
    }

    this.perturbDecay *= 0.93;

    // Modulate seed quaternion with audio
    const sx = this.userParams.seedX + (this.smoothers.bass.value - 0.3) * 0.2 * this.userParams.bassToSeedX;
    const sy = this.userParams.seedY + (this.smoothers.mid.value - 0.3) * 0.15 * this.userParams.midToSeedY;
    const sz = this.userParams.seedZ + this.perturbDecay * Math.sin(this.time * 7.0);
    const sw = this.userParams.seedW + this.perturbDecay * Math.cos(this.time * 5.0);

    if (this.material) {
      const u = this.material.uniforms;
      u.u_time.value = this.time * this.userParams.orbitSpeed;
      u.u_zoom.value = this._zoom;
      u.u_seed.value.set(sx, sy, sz, sw);
      u.u_maxIter.value = this.userParams.maxIter;
      u.u_aoStrength.value = this.userParams.aoStrength * (1.0 + this.smoothers.high.value * this.userParams.highToAO * 0.5);
      u.u_colorShift.value = this.userParams.colorShift;
      u.u_bass.value = this.smoothers.bass.value;
      u.u_mid.value = this.smoothers.mid.value;
      u.u_high.value = this.smoothers.high.value;
      u.u_rms.value = this.smoothers.rms.value;
      u.u_beatPulse.value = this.smoothers.beatPulse.value;
      u.u_perturb.value = this.perturbDecay;
    }
  }

  setResolution(width: number, height: number): void {
    if (this.material) this.material.uniforms.u_resolution.value.set(width, height);
  }

  setUserParam(key: string, value: number): void {
    if (key in this.userParams) this.userParams[key] = value;
  }

  getViewState(): Record<string, number> {
    return { zoom: this._zoom };
  }

  setViewState(partial: Record<string, number>): void {
    if ('zoom' in partial) {
      this._zoom = Math.max(0.3, Math.min(5.0, partial.zoom));
      this.viewOverrides.zoom = true;
    }
  }

  dispose(): void {
    this.unsub();
    this.material?.dispose();
    this.mesh?.geometry.dispose();
  }
}

registerVisualizer({
  metadata: quatJuliaMetadata,
  create: (bus) => new QuatJuliaVisualizer(bus),
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
  #define MAX_STEPS 80
  #define MAX_DIST 8.0
  #define SURF_DIST 0.001
  #define MAX_ITER 16

  uniform float u_time;
  uniform vec2 u_resolution;
  uniform float u_zoom;
  uniform vec4 u_seed;
  uniform float u_maxIter;
  uniform float u_aoStrength;
  uniform float u_colorShift;
  uniform float u_bass;
  uniform float u_mid;
  uniform float u_high;
  uniform float u_rms;
  uniform float u_beatPulse;
  uniform float u_perturb;

  varying vec2 vUv;

  vec3 hsv2rgb(vec3 c) {
    vec4 K = vec4(1.0, 2.0 / 3.0, 1.0 / 3.0, 3.0);
    vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
    return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
  }

  // Quaternion multiplication: q1 * q2
  // q = (x, y, z, w) = x + yi + zj + wk
  vec4 qmul(vec4 a, vec4 b) {
    return vec4(
      a.x * b.x - a.y * b.y - a.z * b.z - a.w * b.w,
      a.x * b.y + a.y * b.x + a.z * b.w - a.w * b.z,
      a.x * b.z - a.y * b.w + a.z * b.x + a.w * b.y,
      a.x * b.w + a.y * b.z - a.z * b.y + a.w * b.x
    );
  }

  // Quaternion squaring: q^2 (optimized)
  vec4 qsqr(vec4 q) {
    return vec4(
      q.x * q.x - q.y * q.y - q.z * q.z - q.w * q.w,
      2.0 * q.x * q.y,
      2.0 * q.x * q.z,
      2.0 * q.x * q.w
    );
  }

  // Distance estimator for quaternion Julia set
  // Returns (distance, iteration_count) for coloring
  vec2 quatJuliaDE(vec3 pos, vec4 c) {
    vec4 z = vec4(pos, 0.0);
    vec4 dz = vec4(1.0, 0.0, 0.0, 0.0);

    float md2 = 1.0;
    float mz2 = dot(z, z);

    int maxIter = int(u_maxIter);
    int hitIter = maxIter;

    for (int i = 0; i < MAX_ITER; i++) {
      if (i >= maxIter) break;

      // dz = 2 * z * dz
      dz = 2.0 * qmul(z, dz);
      // z = z^2 + c
      z = qsqr(z) + c;

      mz2 = dot(z, z);
      md2 = dot(dz, dz);

      if (mz2 > 256.0) {
        hitIter = i;
        break;
      }
    }

    float dist = 0.25 * sqrt(mz2 / md2) * log(mz2);
    float iterNorm = float(hitIter) / float(maxIter);
    return vec2(dist, iterNorm);
  }

  // Estimate normal via central differences
  vec3 calcNormal(vec3 pos, vec4 c) {
    vec2 e = vec2(0.001, 0.0);
    float d = quatJuliaDE(pos, c).x;
    return normalize(vec3(
      quatJuliaDE(pos + e.xyy, c).x - d,
      quatJuliaDE(pos + e.yxy, c).x - d,
      quatJuliaDE(pos + e.yyx, c).x - d
    ));
  }

  // Simple ambient occlusion
  float calcAO(vec3 pos, vec3 nor, vec4 c) {
    float occ = 0.0;
    float sca = 1.0;
    for (int i = 0; i < 5; i++) {
      float h = 0.01 + 0.12 * float(i) / 4.0;
      float d = quatJuliaDE(pos + h * nor, c).x;
      occ += (h - d) * sca;
      sca *= 0.7;
    }
    return clamp(1.0 - 3.0 * occ * u_aoStrength, 0.0, 1.0);
  }

  void main() {
    vec2 uv = (gl_FragCoord.xy - 0.5 * u_resolution) / min(u_resolution.x, u_resolution.y);

    // Camera setup: orbiting around the fractal
    float camDist = 2.8 / u_zoom;
    float camAngle = u_time * 0.5;
    float camPitch = 0.3 + sin(u_time * 0.3) * 0.15;

    vec3 ro = vec3(
      camDist * cos(camAngle) * cos(camPitch),
      camDist * sin(camPitch),
      camDist * sin(camAngle) * cos(camPitch)
    );
    vec3 target = vec3(0.0);
    vec3 fwd = normalize(target - ro);
    vec3 right = normalize(cross(fwd, vec3(0.0, 1.0, 0.0)));
    vec3 up = cross(right, fwd);

    vec3 rd = normalize(fwd + uv.x * right + uv.y * up);

    // Raymarch
    float t = 0.0;
    vec2 result = vec2(MAX_DIST, 0.0);
    bool hit = false;

    for (int i = 0; i < MAX_STEPS; i++) {
      vec3 pos = ro + rd * t;
      vec2 de = quatJuliaDE(pos, u_seed);
      float d = de.x;

      if (d < SURF_DIST) {
        result = vec2(t, de.y);
        hit = true;
        break;
      }
      if (t > MAX_DIST) break;

      t += d * 0.8; // Slight understep for safety
    }

    vec3 color = vec3(0.0);

    if (hit) {
      vec3 pos = ro + rd * result.x;
      vec3 nor = calcNormal(pos, u_seed);
      float ao = calcAO(pos, nor, u_seed);
      float iterColor = result.y;

      // Lighting
      vec3 lightDir = normalize(vec3(0.6, 0.8, -0.4));
      float diff = max(dot(nor, lightDir), 0.0);
      float spec = pow(max(dot(reflect(-lightDir, nor), -rd), 0.0), 16.0);

      // Fresnel rim light
      float fresnel = pow(1.0 - max(dot(nor, -rd), 0.0), 3.0);

      // Color from iteration count + position
      float hue = fract(u_colorShift + iterColor * 0.6 + length(pos) * 0.1 + u_time * 0.02);
      float sat = 0.55 + 0.3 * iterColor;
      float val = 0.2 + diff * 0.5 + spec * 0.3;
      val *= ao;

      // Audio: RMS brightness
      val *= 0.6 + u_rms * 0.7;

      color = hsv2rgb(vec3(hue, sat, val));

      // Rim light colored complementary
      vec3 rimColor = hsv2rgb(vec3(fract(hue + 0.4), 0.6, 1.0));
      color += rimColor * fresnel * 0.3;

      // Specular highlight
      color += vec3(1.0) * spec * 0.15;

      // Beat flash: emissive pulse on surface
      color += hsv2rgb(vec3(fract(hue + 0.2), 0.3, 1.0)) * u_beatPulse * 0.2;

      // Depth fog
      float fog = exp(-result.x * 0.3);
      color *= fog;

    } else {
      // Background: subtle gradient
      float bgGrad = 0.5 + 0.5 * dot(rd, vec3(0.0, 1.0, 0.0));
      color = mix(vec3(0.01, 0.01, 0.03), vec3(0.03, 0.02, 0.05), bgGrad);
      color += vec3(0.01) * u_rms;
    }

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
