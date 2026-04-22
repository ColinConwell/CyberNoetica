import * as THREE from 'three';
import { MessageBus } from '@cybernoetica/core';
import type { AudioFeatures, BusMessage, Unsubscribe } from '@cybernoetica/core';
import { EMASmoothing } from '../../smoothing.js';
import type { Visualizer, VisualizerMetadata } from '../types.js';
import { registerVisualizer } from '../registry.js';

/**
 * Terrain visualizer -- raymarched 3D landscape driven by fractal noise.
 *
 * Renders a flyover view of an infinite procedural terrain using a
 * fragment-shader raymarcher against an fbm heightmap. The camera
 * looks down at an oblique angle and the terrain scrolls forward
 * continuously, creating the sensation of flight over an alien world.
 *
 * Audio reactivity: bass lifts mountain ridges, mids ripple the surface,
 * spectral centroid shifts the colour palette between cool and warm,
 * RMS drives a peak glow, and beat onsets trigger brief lightning flashes
 * that illuminate the landscape.
 */

const terrainMetadata: VisualizerMetadata = {
  type: 'terrain',
  label: 'Terrain',
  description: 'Audio-reactive 3D terrain landscape',
  usesPerspective: false,
  params: [
    // Appearance
    { key: 'ridgeHeight', label: 'Ridge Height', min: 0.1, max: 2.0, step: 0.05, initial: 0.8, category: 'appearance', description: 'Height of terrain ridges' },
    { key: 'noiseScale', label: 'Noise Scale', min: 1.0, max: 8.0, step: 0.25, initial: 3.0, category: 'appearance', description: 'Scale of noise patterns' },
    { key: 'speed', label: 'Speed', min: 0.1, max: 2.0, step: 0.05, initial: 0.4, category: 'appearance', description: 'Animation speed' },
    { key: 'fogDensity', label: 'Fog Density', min: 0.0, max: 1.0, step: 0.05, initial: 0.5, category: 'appearance', description: 'Atmospheric fog amount' },
    { key: 'colorShift', label: 'Color Shift', min: 0.0, max: 1.0, step: 0.01, initial: 0.3, category: 'appearance', description: 'Color temperature' },
    // Audio mapping
    { key: 'bassToHeight', label: 'Bass -> Height', min: 0.0, max: 2.0, step: 0.1, initial: 1.0, category: 'audio-mapping', description: 'Bass drives terrain height' },
    { key: 'midToRipple', label: 'Mid -> Ripple', min: 0.0, max: 2.0, step: 0.1, initial: 1.0, category: 'audio-mapping', description: 'Mids create ripple waves' },
    { key: 'spectralToColor', label: 'Spectral -> Color', min: 0.0, max: 2.0, step: 0.1, initial: 1.0, category: 'audio-mapping', description: 'Spectral centroid shifts palette' },
    { key: 'rmsToGlow', label: 'RMS -> Glow', min: 0.0, max: 2.0, step: 0.1, initial: 1.0, category: 'audio-mapping', description: 'Volume drives glow intensity' },
    { key: 'beatToFlash', label: 'Beat -> Flash', min: 0.0, max: 2.0, step: 0.1, initial: 1.0, category: 'audio-mapping', description: 'Beats trigger lightning flashes' },
  ],
  viewport: { pan: true, zoom: true, orbit: false },
  viewStateFields: [
    { key: 'centerX', label: 'Center X', min: -3, max: 3, step: 0.05 },
    { key: 'centerY', label: 'Center Y', min: -3, max: 3, step: 0.05 },
    { key: 'zoom', label: 'Zoom', min: 0.3, max: 4.0, step: 0.05 },
  ],
};

export class TerrainVisualizer implements Visualizer {
  readonly metadata = terrainMetadata;

  private unsub: Unsubscribe;
  private latestFeatures: AudioFeatures | null = null;
  private time = 0;

  private userParams: Record<string, number> = {
    ridgeHeight: 0.8,
    noiseScale: 3.0,
    speed: 0.4,
    fogDensity: 0.5,
    colorShift: 0.3,
    bassToHeight: 1.0,
    midToRipple: 1.0,
    spectralToColor: 1.0,
    rmsToGlow: 1.0,
    beatToFlash: 1.0,
  };

  private _centerX = 0;
  private _centerY = 0;
  private _zoom = 1.0;
  private viewOverrides: Record<string, boolean> = {};

  private smoothers = {
    bass: new EMASmoothing(0.12),
    mid: new EMASmoothing(0.18),
    high: new EMASmoothing(0.25),
    rms: new EMASmoothing(0.15),
    spectralCentroid: new EMASmoothing(0.08),
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
    this.smoothers.spectralCentroid.reset(0.5);
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
        u_center: { value: new THREE.Vector2(0, 0) },
        u_ridgeHeight: { value: 0.8 },
        u_noiseScale: { value: 3.0 },
        u_speed: { value: 0.4 },
        u_fogDensity: { value: 0.5 },
        u_colorShift: { value: 0.3 },
        u_bass: { value: 0.0 },
        u_mid: { value: 0.0 },
        u_high: { value: 0.0 },
        u_rms: { value: 0.1 },
        u_spectralCentroid: { value: 0.5 },
        u_beatPulse: { value: 0.0 },
        u_bassToHeight: { value: 1.0 },
        u_midToRipple: { value: 1.0 },
        u_spectralToColor: { value: 1.0 },
        u_rmsToGlow: { value: 1.0 },
        u_beatToFlash: { value: 1.0 },
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
      u.u_center.value.set(this._centerX, this._centerY);
      u.u_ridgeHeight.value = this.userParams.ridgeHeight;
      u.u_noiseScale.value = this.userParams.noiseScale;
      u.u_speed.value = this.userParams.speed;
      u.u_fogDensity.value = this.userParams.fogDensity;
      u.u_colorShift.value = this.userParams.colorShift;
      u.u_bass.value = this.smoothers.bass.value;
      u.u_mid.value = this.smoothers.mid.value;
      u.u_high.value = this.smoothers.high.value;
      u.u_rms.value = this.smoothers.rms.value;
      u.u_spectralCentroid.value = this.smoothers.spectralCentroid.value;
      u.u_beatPulse.value = this.smoothers.beatPulse.value;
      u.u_bassToHeight.value = this.userParams.bassToHeight;
      u.u_midToRipple.value = this.userParams.midToRipple;
      u.u_spectralToColor.value = this.userParams.spectralToColor;
      u.u_rmsToGlow.value = this.userParams.rmsToGlow;
      u.u_beatToFlash.value = this.userParams.beatToFlash;
    }
  }

  setResolution(width: number, height: number): void {
    if (this.material) this.material.uniforms.u_resolution.value.set(width, height);
  }

  setUserParam(key: string, value: number): void {
    if (key in this.userParams) {
      this.userParams[key] = value;
    }
  }

  getViewState(): Record<string, number> {
    return {
      centerX: this._centerX,
      centerY: this._centerY,
      zoom: this._zoom,
    };
  }

  setViewState(partial: Record<string, number>): void {
    if ('centerX' in partial) {
      this._centerX = Math.max(-3, Math.min(3, partial.centerX));
      this.viewOverrides.pan = true;
    }
    if ('centerY' in partial) {
      this._centerY = Math.max(-3, Math.min(3, partial.centerY));
      this.viewOverrides.pan = true;
    }
    if ('zoom' in partial) {
      this._zoom = Math.max(0.3, Math.min(4.0, partial.zoom));
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
  metadata: terrainMetadata,
  create: (bus) => new TerrainVisualizer(bus),
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
  #define MAX_STEPS 80
  #define MAX_DIST 40.0
  #define SURF_DIST 0.01

  uniform float u_time;
  uniform vec2 u_resolution;
  uniform float u_zoom;
  uniform vec2 u_center;
  uniform float u_ridgeHeight;
  uniform float u_noiseScale;
  uniform float u_speed;
  uniform float u_fogDensity;
  uniform float u_colorShift;
  uniform float u_bass;
  uniform float u_mid;
  uniform float u_high;
  uniform float u_rms;
  uniform float u_spectralCentroid;
  uniform float u_beatPulse;
  uniform float u_bassToHeight;
  uniform float u_midToRipple;
  uniform float u_spectralToColor;
  uniform float u_rmsToGlow;
  uniform float u_beatToFlash;

  varying vec2 vUv;

  // ── Noise primitives ─────────────────────────────────

  // Hash without sine -- better distribution on GPU
  vec2 hash22(vec2 p) {
    vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973));
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.xx + p3.yz) * p3.zy);
  }

  float hash21(vec2 p) {
    vec3 p3 = fract(vec3(p.xyx) * 0.1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
  }

  // Smooth value noise
  float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f); // smoothstep

    float a = hash21(i);
    float b = hash21(i + vec2(1.0, 0.0));
    float c = hash21(i + vec2(0.0, 1.0));
    float d = hash21(i + vec2(1.0, 1.0));

    return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
  }

  // Fractal Brownian Motion -- 5 octaves
  float fbm(vec2 p) {
    float value = 0.0;
    float amplitude = 0.5;
    float frequency = 1.0;
    for (int i = 0; i < 5; i++) {
      value += amplitude * noise(p * frequency);
      frequency *= 2.0;
      amplitude *= 0.5;
    }
    return value;
  }

  // Ridge noise variant for sharp peaks
  float ridgeNoise(vec2 p) {
    float n = noise(p);
    n = abs(n - 0.5) * 2.0;
    return 1.0 - n * n;
  }

  float ridgeFbm(vec2 p) {
    float value = 0.0;
    float amplitude = 0.5;
    float frequency = 1.0;
    for (int i = 0; i < 5; i++) {
      value += amplitude * ridgeNoise(p * frequency);
      frequency *= 2.1;
      amplitude *= 0.48;
    }
    return value;
  }

  // ── Terrain height ───────────────────────────────────

  float terrainHeight(vec2 p) {
    float t = u_time * u_speed;
    vec2 pos = p * u_noiseScale + vec2(0.0, t * 2.0);

    // Base terrain: blend of smooth fbm and ridged fbm
    float smooth_h = fbm(pos * 0.6);
    float ridge_h = ridgeFbm(pos * 0.4);
    float h = mix(smooth_h, ridge_h, 0.6) * u_ridgeHeight;

    // Bass lifts overall terrain height
    h *= (1.0 + u_bass * 0.8 * u_bassToHeight);

    // Mid-frequency ripples -- concentric waves from centre
    float ripple = sin(length(pos) * 4.0 - t * 6.0) * 0.08;
    h += ripple * u_mid * u_midToRipple;

    // High-frequency shimmer
    h += noise(pos * 8.0 + t) * 0.02 * u_high;

    return h;
  }

  // ── Raymarching ──────────────────────────────────────

  float raymarchTerrain(vec3 ro, vec3 rd) {
    float t = 0.0;
    for (int i = 0; i < MAX_STEPS; i++) {
      vec3 p = ro + rd * t;
      float h = terrainHeight(p.xz);
      float d = p.y - h;
      if (d < SURF_DIST) return t;
      // Adaptive step -- larger steps when far from surface
      t += max(d * 0.4, 0.02);
      if (t > MAX_DIST) break;
    }
    return -1.0;
  }

  // Surface normal via central differences
  vec3 terrainNormal(vec2 p) {
    float eps = 0.02;
    float h = terrainHeight(p);
    float hx = terrainHeight(p + vec2(eps, 0.0));
    float hz = terrainHeight(p + vec2(0.0, eps));
    return normalize(vec3(h - hx, eps, h - hz));
  }

  // ── Colour palette ──────────────────────────────────

  vec3 terrainColor(float h, float normalY, vec2 p) {
    // Normalised height (0..1 approx)
    float hn = clamp(h / (u_ridgeHeight * 1.5), 0.0, 1.0);

    // Cool palette (blue/teal/green)
    vec3 deep = vec3(0.05, 0.08, 0.18);
    vec3 low  = vec3(0.06, 0.18, 0.35);
    vec3 mid  = vec3(0.08, 0.38, 0.32);
    vec3 high_c = vec3(0.25, 0.55, 0.35);
    vec3 peak = vec3(0.85, 0.90, 0.95);

    // Warm palette (orange/red/gold)
    vec3 deep_w = vec3(0.15, 0.05, 0.08);
    vec3 low_w  = vec3(0.35, 0.12, 0.06);
    vec3 mid_w  = vec3(0.55, 0.30, 0.08);
    vec3 high_w = vec3(0.70, 0.50, 0.15);
    vec3 peak_w = vec3(0.95, 0.85, 0.70);

    // Blend cool/warm based on colorShift + spectral centroid
    float warmth = u_colorShift + (u_spectralCentroid - 0.5) * 0.6 * u_spectralToColor;
    warmth = clamp(warmth, 0.0, 1.0);

    deep   = mix(deep,   deep_w,   warmth);
    low    = mix(low,    low_w,    warmth);
    mid    = mix(mid,    mid_w,    warmth);
    high_c = mix(high_c, high_w, warmth);
    peak   = mix(peak,   peak_w,   warmth);

    // Height-based colour ramp
    vec3 col;
    if (hn < 0.15) {
      col = mix(deep, low, hn / 0.15);
    } else if (hn < 0.35) {
      col = mix(low, mid, (hn - 0.15) / 0.2);
    } else if (hn < 0.6) {
      col = mix(mid, high_c, (hn - 0.35) / 0.25);
    } else {
      col = mix(high_c, peak, (hn - 0.6) / 0.4);
    }

    return col;
  }

  // ── Main ─────────────────────────────────────────────

  void main() {
    vec2 uv = (gl_FragCoord.xy - 0.5 * u_resolution) / min(u_resolution.x, u_resolution.y);
    uv = uv / u_zoom + u_center;

    float t = u_time * u_speed;

    // Camera setup -- flying over the terrain
    float camHeight = 1.8 + u_bass * 0.4 * u_bassToHeight;
    vec3 ro = vec3(u_center.x, camHeight, u_center.y + t * 2.0); // camera origin
    vec3 target = ro + vec3(0.0, -0.5, 2.0); // look ahead and down

    // Camera basis vectors
    vec3 forward = normalize(target - ro);
    vec3 right = normalize(cross(vec3(0.0, 1.0, 0.0), forward));
    vec3 up = cross(forward, right);

    // Ray direction with zoom
    vec3 rd = normalize(forward + uv.x * right + uv.y * up);

    // Background -- dark sky with subtle gradient
    vec3 skyColor = mix(
      vec3(0.02, 0.03, 0.06),
      vec3(0.05, 0.04, 0.10),
      uv.y * 0.5 + 0.5
    );

    // Stars
    vec2 starUv = gl_FragCoord.xy * 0.01;
    float star = hash21(floor(starUv * 80.0));
    star = smoothstep(0.97, 1.0, star) * smoothstep(0.3, 0.5, uv.y);
    skyColor += vec3(star * 0.5);

    vec3 color = skyColor;

    // Raymarch the terrain
    float dist = raymarchTerrain(ro, rd);

    if (dist > 0.0) {
      vec3 p = ro + rd * dist;
      vec3 normal = terrainNormal(p.xz);
      float h = terrainHeight(p.xz);

      // Base terrain colour
      vec3 terrCol = terrainColor(h, normal.y, p.xz);

      // Directional light (sun/moon)
      vec3 lightDir = normalize(vec3(0.4, 0.6, 0.3));
      float diff = max(dot(normal, lightDir), 0.0);
      float amb = 0.15;

      // Specular highlight on wet/icy peaks
      vec3 halfDir = normalize(lightDir - rd);
      float spec = pow(max(dot(normal, halfDir), 0.0), 32.0);
      float hn = clamp(h / (u_ridgeHeight * 1.5), 0.0, 1.0);
      spec *= smoothstep(0.5, 0.9, hn) * 0.4;

      // Lighting
      vec3 lit = terrCol * (amb + diff * 0.85) + vec3(spec);

      // RMS glow on peaks
      float glow = smoothstep(0.5, 1.0, hn) * u_rms * u_rmsToGlow;
      lit += vec3(0.3, 0.5, 0.8) * glow * 0.5;

      // Beat flash -- lightning illumination
      float flash = u_beatPulse * u_beatToFlash;
      lit += vec3(0.8, 0.85, 1.0) * flash * 0.6;

      // Atmospheric fog
      float fogAmount = 1.0 - exp(-dist * 0.04 * (0.3 + u_fogDensity * 0.7));
      vec3 fogColor = mix(vec3(0.03, 0.04, 0.08), vec3(0.08, 0.06, 0.12), u_colorShift);
      // Warm the fog with beat flashes
      fogColor += vec3(0.1, 0.08, 0.15) * flash * 0.3;
      lit = mix(lit, fogColor, fogAmount);

      color = lit;
    }

    // Lightning bolts in the sky during beats
    float flash = u_beatPulse * u_beatToFlash;
    if (flash > 0.1 && dist < 0.0) {
      // Simulate a lightning streak
      float bolt = noise(vec2(uv.x * 8.0, uv.y * 2.0 + u_time * 20.0));
      bolt = smoothstep(0.75, 0.78, bolt);
      color += vec3(0.7, 0.75, 1.0) * bolt * flash * 1.5;
      // Ambient flash on sky
      color += vec3(0.05, 0.04, 0.08) * flash;
    }

    // Vignette
    float aspect = u_resolution.x / u_resolution.y;
    vec2 screenUv = gl_FragCoord.xy / u_resolution;
    float vignette = 1.0 - 0.4 * length((screenUv - 0.5) * vec2(aspect, 1.0));
    color *= vignette;

    // Background floor
    color = max(color, vec3(0.008, 0.006, 0.012));

    // Tone mapping (Reinhard)
    color = color / (0.9 + color);

    gl_FragColor = vec4(color, 1.0);
  }
`;
