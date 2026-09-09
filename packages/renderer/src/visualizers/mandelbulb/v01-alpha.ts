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
 * Mandelbulb visualizer -- 3D fractal raymarching.
 *
 * The Mandelbulb is a three-dimensional fractal constructed by mapping the
 * squaring operation of complex numbers to spherical coordinates. The iterative
 * formula is: v -> v^n + c, where the power n (typically 8) produces the
 * characteristic bulbous fractal geometry discovered by Daniel White (2009).
 *
 * Distance estimation via the running derivative allows efficient sphere-tracing.
 * Audio maps: bass modulates the power (morphing the fractal shape), spectral
 * centroid rotates the camera orbit, RMS drives glow intensity, beats trigger
 * power pulses that temporarily warp the geometry.
 */

const mandelbulbMetadata: VisualizerMetadata = {
  type: 'mandelbulb',
  label: 'Mandelbulb',
  description: '3D fractal raymarched in real-time',
  usesPerspective: false,
  params: [
    {
      key: 'stableShape',
      label: 'Stable shape preset',
      min: 0,
      max: 1,
      step: 1,
      initial: 1,
      category: 'appearance',
      description:
        'Hold geometric parameters while sound changes light and camera',
    },
    {
      key: 'stepSafety',
      label: 'March safety factor',
      min: 0.2,
      max: 0.8,
      step: 0.05,
      initial: 0.5,
      category: 'appearance',
      description:
        'Conservative multiplier for an approximate distance estimate',
    },
    {
      key: 'hitTolerance',
      label: 'Hit tolerance',
      min: 0.0002,
      max: 0.005,
      step: 0.0002,
      initial: 0.001,
      category: 'appearance',
    },
    {
      key: 'power',
      label: 'Power',
      min: 2,
      max: 16,
      step: 0.5,
      initial: 8,
      category: 'appearance',
      description: 'Fractal power exponent (8 = classic Mandelbulb)',
    },
    {
      key: 'iterations',
      label: 'Iterations',
      min: 2,
      max: 12,
      step: 1,
      initial: 6,
      category: 'appearance',
      description: 'Fractal iteration depth',
    },
    {
      key: 'orbitSpeed',
      label: 'Orbit Speed',
      min: 0.0,
      max: 1.0,
      step: 0.05,
      initial: 0.15,
      category: 'appearance',
      description: 'Camera orbit speed',
    },
    {
      key: 'colorScheme',
      label: 'Color Shift',
      min: 0.0,
      max: 1.0,
      step: 0.01,
      initial: 0.0,
      category: 'appearance',
      description: 'Palette hue offset',
    },
    {
      key: 'glowIntensity',
      label: 'Glow',
      min: 0.2,
      max: 2.0,
      step: 0.1,
      initial: 1.0,
      category: 'appearance',
      description: 'Surface glow intensity',
    },
    {
      key: 'bassToPower',
      label: 'Bass -> Power',
      min: 0.0,
      max: 2.0,
      step: 0.1,
      initial: 1.0,
      category: 'audio-mapping',
      description: 'Bass modulates fractal power',
    },
    {
      key: 'spectralToOrbit',
      label: 'Spectral -> Orbit',
      min: 0.0,
      max: 2.0,
      step: 0.1,
      initial: 1.0,
      category: 'audio-mapping',
      description: 'Spectral centroid drives orbit angle',
    },
    {
      key: 'rmsToGlow',
      label: 'RMS -> Glow',
      min: 0.0,
      max: 2.0,
      step: 0.1,
      initial: 1.0,
      category: 'audio-mapping',
      description: 'Volume drives surface glow',
    },
    {
      key: 'beatToPulse',
      label: 'Beat -> Pulse',
      min: 0.0,
      max: 2.0,
      step: 0.1,
      initial: 1.0,
      category: 'audio-mapping',
      description: 'Beats trigger power spikes',
    },
  ],
  viewport: { pan: false, zoom: true, orbit: false },
  viewStateFields: [
    { key: 'zoom', label: 'Zoom', min: 0.5, max: 5.0, step: 0.05 },
  ],
};

export class MandelbulbVisualizer implements Visualizer {
  private deltaSeconds = 1 / 60;
  private phases = new PhaseClock();
  readonly metadata = mandelbulbMetadata;

  private unsub: Unsubscribe;
  private latestFeatures: AudioFeatures | null = null;
  private time = 0;

  private userParams: Record<string, number> = {
    stableShape: 1,
    stepSafety: 0.5,
    hitTolerance: 0.001,
    power: 8,
    iterations: 6,
    orbitSpeed: 0.15,
    colorScheme: 0.0,
    glowIntensity: 1.0,
    bassToPower: 1.0,
    spectralToOrbit: 1.0,
    rmsToGlow: 1.0,
    beatToPulse: 1.0,
  };

  private _zoom = 1.0;
  private viewOverrides: Record<string, boolean> = {};

  private smoothers = {
    bass: new EMASmoothing(0.12),
    mid: new EMASmoothing(0.18),
    high: new EMASmoothing(0.22),
    rms: new EMASmoothing(0.15),
    spectralCentroid: new EMASmoothing(0.08),
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
    this.smoothers.spectralCentroid.reset(0.5);
    this.smoothers.beatPulse.reset(0);
  }

  attach(scene: THREE.Scene): void {
    this.material = new THREE.RawShaderMaterial({
      vertexShader: VERTEX_SHADER,
      fragmentShader: FRAGMENT_SHADER,
      uniforms: {
        u_stepSafety: { value: 0.5 },
        u_hitTolerance: { value: 0.001 },
        u_workBudget: { value: 1 },
        u_time: { value: 0.0 },
        u_resolution: { value: new THREE.Vector2(1920, 1080) },
        u_zoom: { value: 1.0 },
        u_power: { value: 8.0 },
        u_iterations: { value: 6.0 },
        u_orbitAngle: { value: 0.0 },
        u_colorShift: { value: 0.0 },
        u_glowIntensity: { value: 1.0 },
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

  tick(deltaSeconds = 1 / 60): void {
    this.deltaSeconds = frameDelta(deltaSeconds);
    this.time += this.deltaSeconds;

    if (this.latestFeatures) {
      const f = takeAudioFrame(this.latestFeatures);
      this.smoothers.bass.update(f.bass, this.deltaSeconds);
      this.smoothers.mid.update(f.mid, this.deltaSeconds);
      this.smoothers.high.update(f.high, this.deltaSeconds);
      this.smoothers.rms.update(f.rms, this.deltaSeconds);
      this.smoothers.spectralCentroid.update(
        f.spectralCentroid,
        this.deltaSeconds,
      );
      this.smoothers.beatPulse.update(
        f.beatOnset ? 1.0 : 0.0,
        this.deltaSeconds,
      );
    } else {
      this.smoothers.beatPulse.update(0.0, this.deltaSeconds);
    }

    const orbitAngle = this.phases.advance(
      'orbit',
      this.userParams.orbitSpeed *
        (1 +
          this.smoothers.spectralCentroid.value *
            this.userParams.spectralToOrbit),
      this.deltaSeconds,
    );

    const effectivePower =
      this.userParams.power +
      (1 - this.userParams.stableShape) *
        this.smoothers.bass.value *
        2.0 *
        this.userParams.bassToPower +
      (1 - this.userParams.stableShape) *
        this.smoothers.beatPulse.value *
        3.0 *
        this.userParams.beatToPulse;

    const effectiveGlow =
      this.userParams.glowIntensity +
      this.smoothers.rms.value * 0.8 * this.userParams.rmsToGlow;

    if (this.material) {
      const u = this.material.uniforms;
      u.u_stepSafety.value = this.userParams.stepSafety;
      u.u_hitTolerance.value = this.userParams.hitTolerance;
      u.u_time.value = this.time;
      u.u_zoom.value = this._zoom;
      u.u_power.value = effectivePower;
      u.u_iterations.value = this.userParams.iterations;
      u.u_orbitAngle.value = orbitAngle;
      u.u_colorShift.value = this.userParams.colorScheme;
      u.u_glowIntensity.value = effectiveGlow;
      u.u_bass.value = this.smoothers.bass.value;
      u.u_mid.value = this.smoothers.mid.value;
      u.u_high.value = this.smoothers.high.value;
      u.u_rms.value = this.smoothers.rms.value;
      u.u_spectralCentroid.value = this.smoothers.spectralCentroid.value;
      u.u_beatPulse.value = this.smoothers.beatPulse.value;
    }
  }

  setResolution(width: number, height: number): void {
    if (this.material)
      this.material.uniforms.u_resolution.value.set(width, height);
  }

  setUserParam(key: string, value: number): void {
    if (key in this.userParams) {
      this.userParams[key] = value;
    }
  }

  getViewState(): Record<string, number> {
    return { zoom: this._zoom };
  }

  setViewState(partial: Record<string, number>): void {
    if ('zoom' in partial) {
      this._zoom = Math.max(0.5, Math.min(5.0, partial.zoom));
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
  metadata: mandelbulbMetadata,
  create: (bus) => new MandelbulbVisualizer(bus),
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
  #define TAU 6.28318530718
  #define MAX_STEPS 96
  #define MAX_DIST 10.0
  #define SURF_DIST 0.001

  uniform float u_workBudget;
  uniform float u_stepSafety;uniform float u_hitTolerance;
  uniform float u_time;
  uniform vec2 u_resolution;
  uniform float u_zoom;
  uniform float u_power;
  uniform float u_iterations;
  uniform float u_orbitAngle;
  uniform float u_colorShift;
  uniform float u_glowIntensity;
  uniform float u_bass;
  uniform float u_mid;
  uniform float u_high;
  uniform float u_rms;
  uniform float u_spectralCentroid;
  uniform float u_beatPulse;

  varying vec2 vUv;

  // Rotation matrices
  mat3 rotateY(float a) {
    float c = cos(a), s = sin(a);
    return mat3(c, 0.0, s, 0.0, 1.0, 0.0, -s, 0.0, c);
  }

  mat3 rotateX(float a) {
    float c = cos(a), s = sin(a);
    return mat3(1.0, 0.0, 0.0, 0.0, c, -s, 0.0, s, c);
  }

  // Cosine palette
  vec3 palette(float t, vec3 a, vec3 b, vec3 c, vec3 d) {
    return a + b * cos(TAU * (c * t + d));
  }

  // Mandelbulb distance estimator
  // Based on the triplex algebra formulation by Daniel White
  float mandelbulbDE(vec3 pos, float power, int iters, out float orbitTrap) {
    vec3 z = pos;
    float dr = 1.0;
    float r = 0.0;
    orbitTrap = 1e10;

    for (int i = 0; i < 12; i++) {
      if (i >= iters) break;

      r = length(z);
      if (r > 2.0) break;

      // Convert to spherical coordinates
      float theta = acos(clamp(z.z / max(r, 1e-12), -1.0, 1.0));
      float phi = atan(z.y, z.x);

      // Running derivative for distance estimation
      dr = pow(r, power - 1.0) * power * dr + 1.0;

      // Scale and rotate the point (triplex power)
      float zr = pow(r, power);
      theta = theta * power;
      phi = phi * power;

      // Convert back to cartesian
      z = zr * vec3(
        sin(theta) * cos(phi),
        sin(theta) * sin(phi),
        cos(theta)
      );
      z += pos;

      // Orbit trap for coloring
      orbitTrap = min(orbitTrap, length(z));
    }

    r = length(z);
    if (r <= 2.0) return 0.0; // No escape within the iteration budget.
    return 0.5 * log(r) * r / max(dr, 1e-12);
  }

  // Ambient occlusion approximation
  float ambientOcclusion(vec3 p, vec3 n, float power, int iters) {
    float ao = 0.0;
    float scale = 1.0;
    float dummy;
    for (int i = 0; i < 5; i++) {
      float dist = 0.01 + 0.12 * float(i);
      float d = mandelbulbDE(p + n * dist, power, iters, dummy);
      ao += (dist - d) * scale;
      scale *= 0.5;
    }
    return 1.0 - clamp(ao * 3.0, 0.0, 1.0);
  }

  // Soft shadow
  float softShadow(vec3 ro, vec3 rd, float mint, float maxt, float k, float power, int iters) {
    float res = 1.0;
    float t = mint;
    float dummy;
    for (int i = 0; i < 32; i++) {
      if (t > maxt) break;
      float d = mandelbulbDE(ro + rd * t, power, iters, dummy);
      if (d < 0.0005) return 0.0;
      res = min(res, k * d / t);
      t += d;
    }
    return clamp(res, 0.0, 1.0);
  }

  void main() {
    vec2 uv = (gl_FragCoord.xy - 0.5 * u_resolution) / min(u_resolution.x, u_resolution.y);
    uv /= u_zoom;

    int iters = int(u_iterations);

    // Camera orbiting around the Mandelbulb
    float camDist = 2.5;
    float elevation = sin(u_time * 0.08) * 0.3 + 0.4;
    float azimuth = u_orbitAngle;

    vec3 ro = camDist * vec3(
      cos(elevation) * sin(azimuth),
      sin(elevation),
      cos(elevation) * cos(azimuth)
    );

    // Look-at camera
    vec3 target = vec3(0.0);
    vec3 forward = normalize(target - ro);
    vec3 right = normalize(cross(forward, vec3(0.0, 1.0, 0.0)));
    vec3 up = cross(right, forward);
    vec3 rd = normalize(forward * 1.5 + right * uv.x + up * uv.y);

    // Raymarching
    float t = 0.0;
    float orbitTrap = 0.0;
    float glow = 0.0;
    bool hit = false;

    for (int i = 0; i < MAX_STEPS; i++) {
      if (float(i) >= max(32.0, float(MAX_STEPS) * u_workBudget)) break;
      vec3 p = ro + rd * t;
      float trapVal;
      float d = mandelbulbDE(p, u_power, iters, trapVal);

      glow += 0.015 / (0.05 + d * d);

      if (d < u_hitTolerance) {
        orbitTrap = trapVal;
        hit = true;
        break;
      }
      if (t > MAX_DIST) break;
      t += d * u_stepSafety;
    }

    vec3 color = vec3(0.0);

    if (hit) {
      vec3 p = ro + rd * t;

      // Normal via central differences
      vec2 e = vec2(0.0005, 0.0);
      float dummy;
      vec3 n = normalize(vec3(
        mandelbulbDE(p + e.xyy, u_power, iters, dummy) - mandelbulbDE(p - e.xyy, u_power, iters, dummy),
        mandelbulbDE(p + e.yxy, u_power, iters, dummy) - mandelbulbDE(p - e.yxy, u_power, iters, dummy),
        mandelbulbDE(p + e.yyx, u_power, iters, dummy) - mandelbulbDE(p - e.yyx, u_power, iters, dummy)
      ));

      // Lighting
      vec3 lightDir = normalize(vec3(1.0, 1.5, -0.5));
      float diff = max(dot(n, lightDir), 0.0);
      float spec = pow(max(dot(reflect(-lightDir, n), -rd), 0.0), 32.0);

      // AO
      float ao = ambientOcclusion(p, n, u_power, iters);

      // Soft shadow
      float shadow = softShadow(p + n * 0.005, lightDir, 0.01, 3.0, 8.0, u_power, iters);

      // Coloring based on orbit trap + audio
      float colorT = orbitTrap * 0.5 + u_colorShift + u_spectralCentroid * 0.2;
      vec3 surfColor = palette(
        colorT,
        vec3(0.5, 0.5, 0.5),
        vec3(0.5, 0.5, 0.5),
        vec3(1.0, 1.0, 1.0),
        vec3(0.0 + u_colorShift, 0.33, 0.67)
      );

      // Combine lighting
      vec3 ambient = surfColor * 0.15;
      color = ambient + surfColor * diff * shadow * 0.7 + vec3(spec * 0.4 * u_high);
      color *= ao;

      // Distance fog
      float fog = exp(-t * 0.3);
      color *= fog;

      // Beat flash on surface
      color += surfColor * u_beatPulse * 0.3;
    }

    // Volumetric glow around the fractal
    glow = clamp(glow * 0.03, 0.0, 1.0);
    vec3 glowColor = palette(
      u_time * 0.05 + u_colorShift,
      vec3(0.5, 0.5, 0.5),
      vec3(0.5, 0.5, 0.5),
      vec3(1.0, 0.7, 0.4),
      vec3(0.0, 0.15, 0.2)
    );
    color += glowColor * glow * u_glowIntensity * (0.5 + u_rms * 0.5);

    // Vignette
    float aspect = u_resolution.x / u_resolution.y;
    vec2 screenUv = gl_FragCoord.xy / u_resolution;
    float vignette = 1.0 - 0.35 * length((screenUv - 0.5) * vec2(aspect, 1.0));
    color *= vignette;

    // Background gradient
    vec3 bg = mix(vec3(0.01, 0.005, 0.02), vec3(0.02, 0.01, 0.04), uv.y * 0.5 + 0.5);
    color = max(color, bg);

    // Tone mapping
    color = color / (0.85 + color);

    gl_FragColor = vec4(color, 1.0);
  }
`;
