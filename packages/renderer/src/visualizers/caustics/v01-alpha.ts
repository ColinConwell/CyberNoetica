import * as THREE from 'three';
import { MessageBus } from '@cybernoetica/core';
import type { AudioFeatures, BusMessage, Unsubscribe } from '@cybernoetica/core';
import { EMASmoothing } from '../../smoothing.js';
import type { Visualizer, VisualizerMetadata } from '../types.js';
import { registerVisualizer } from '../registry.js';

/**
 * Caustics — underwater light refraction patterns.
 *
 * Simulates the luminous network of bright lines (caustics) formed when sunlight
 * refracts through a perturbed water surface and converges on a plane below.
 * The water surface is modeled as overlapping Gerstner waves; for each pixel on
 * the "sea floor," we reverse-trace multiple light rays through the surface,
 * accumulating brightness where refracted rays cluster (high photon density).
 *
 * The effect is approximated entirely in the fragment shader using analytic
 * Voronoi-like cellular noise to simulate the refraction convergence pattern,
 * layered with sine-wave interference for organic movement.
 *
 * Audio mapping:
 *   bass      -> wave amplitude (deeper waves = sharper caustics)
 *   mid       -> wave speed / animation rate
 *   high      -> surface detail / high-frequency ripples
 *   rms       -> overall brightness / light intensity
 *   beat      -> splash ripple burst from center
 *   centroid  -> color temperature (cool blue -> warm gold)
 */

const causticsMetadata: VisualizerMetadata = {
  type: 'caustics',
  label: 'Caustics',
  description: 'Underwater light refraction patterns',
  usesPerspective: false,
  params: [
    { key: 'waveAmplitude', label: 'Wave Amplitude', min: 0.2, max: 2.0, step: 0.05, initial: 1.0, category: 'appearance', description: 'Surface wave height' },
    { key: 'waveSpeed', label: 'Wave Speed', min: 0.1, max: 2.0, step: 0.05, initial: 0.7, category: 'appearance', description: 'Surface animation rate' },
    { key: 'surfaceDetail', label: 'Surface Detail', min: 1.0, max: 5.0, step: 0.5, initial: 3.0, category: 'appearance', description: 'Number of wave octaves' },
    { key: 'brightness', label: 'Brightness', min: 0.3, max: 3.0, step: 0.1, initial: 1.2, category: 'appearance', description: 'Light intensity' },
    { key: 'colorTemp', label: 'Color Temp', min: 0.0, max: 1.0, step: 0.05, initial: 0.3, category: 'appearance', description: 'Cool blue to warm gold' },
    { key: 'depth', label: 'Depth', min: 0.5, max: 4.0, step: 0.1, initial: 1.5, category: 'appearance', description: 'Simulated water depth' },
    { key: 'bassToAmplitude', label: 'Bass → Waves', min: 0.0, max: 2.0, step: 0.1, initial: 1.0, category: 'audio-mapping', description: 'Bass deepens waves' },
    { key: 'midToSpeed', label: 'Mid → Speed', min: 0.0, max: 2.0, step: 0.1, initial: 1.0, category: 'audio-mapping', description: 'Mids drive animation' },
    { key: 'highToDetail', label: 'High → Detail', min: 0.0, max: 2.0, step: 0.1, initial: 0.8, category: 'audio-mapping', description: 'Highs add surface ripples' },
    { key: 'rmsToGlow', label: 'RMS → Glow', min: 0.0, max: 2.0, step: 0.1, initial: 1.0, category: 'audio-mapping', description: 'Volume drives light intensity' },
    { key: 'beatToSplash', label: 'Beat → Splash', min: 0.0, max: 2.0, step: 0.1, initial: 1.0, category: 'audio-mapping', description: 'Beats create splash ripples' },
    { key: 'centroidToColor', label: 'Centroid → Color', min: 0.0, max: 2.0, step: 0.1, initial: 0.8, category: 'audio-mapping', description: 'Spectral centroid shifts color' },
  ],
  viewport: { pan: true, zoom: true, orbit: false },
  viewStateFields: [
    { key: 'centerX', label: 'Center X', min: -5, max: 5, step: 0.05 },
    { key: 'centerY', label: 'Center Y', min: -5, max: 5, step: 0.05 },
    { key: 'zoom', label: 'Zoom', min: 0.2, max: 4.0, step: 0.05 },
  ],
};

export class CausticsVisualizer implements Visualizer {
  readonly metadata = causticsMetadata;

  private unsub: Unsubscribe;
  private latestFeatures: AudioFeatures | null = null;
  private time = 0;

  private userParams: Record<string, number> = {
    waveAmplitude: 1.0,
    waveSpeed: 0.7,
    surfaceDetail: 3.0,
    brightness: 1.2,
    colorTemp: 0.3,
    depth: 1.5,
    bassToAmplitude: 1.0,
    midToSpeed: 1.0,
    highToDetail: 0.8,
    rmsToGlow: 1.0,
    beatToSplash: 1.0,
    centroidToColor: 0.8,
  };

  private _centerX = 0;
  private _centerY = 0;
  private _zoom = 1.0;
  private viewOverrides: Record<string, boolean> = {};

  private smoothers = {
    bass: new EMASmoothing(0.12),
    mid: new EMASmoothing(0.18),
    high: new EMASmoothing(0.22),
    rms: new EMASmoothing(0.15),
    spectralCentroid: new EMASmoothing(0.1),
    beatPulse: new EMASmoothing(0.35),
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
    this.material = new THREE.ShaderMaterial({
      vertexShader: VERTEX_SHADER,
      fragmentShader: FRAGMENT_SHADER,
      uniforms: {
        u_time: { value: 0.0 },
        u_resolution: { value: new THREE.Vector2(1920, 1080) },
        u_center: { value: new THREE.Vector2(0, 0) },
        u_zoom: { value: 1.0 },
        u_waveAmplitude: { value: 1.0 },
        u_waveSpeed: { value: 0.7 },
        u_surfaceDetail: { value: 3.0 },
        u_brightness: { value: 1.2 },
        u_colorTemp: { value: 0.3 },
        u_depth: { value: 1.5 },
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
      const bass = this.smoothers.bass.value;
      const mid = this.smoothers.mid.value;
      const high = this.smoothers.high.value;

      u.u_time.value = this.time;
      u.u_center.value.set(this._centerX, this._centerY);
      u.u_zoom.value = this._zoom;
      u.u_waveAmplitude.value = this.userParams.waveAmplitude
        + bass * 0.4 * this.userParams.bassToAmplitude;
      u.u_waveSpeed.value = this.userParams.waveSpeed
        + mid * 0.3 * this.userParams.midToSpeed;
      u.u_surfaceDetail.value = this.userParams.surfaceDetail
        + high * 1.5 * this.userParams.highToDetail;
      u.u_brightness.value = this.userParams.brightness;
      u.u_colorTemp.value = this.userParams.colorTemp
        + this.smoothers.spectralCentroid.value * 0.2 * this.userParams.centroidToColor;
      u.u_depth.value = this.userParams.depth;
      u.u_bass.value = bass;
      u.u_mid.value = mid;
      u.u_high.value = high;
      u.u_rms.value = this.smoothers.rms.value * this.userParams.rmsToGlow;
      u.u_spectralCentroid.value = this.smoothers.spectralCentroid.value;
      u.u_beatPulse.value = this.smoothers.beatPulse.value * this.userParams.beatToSplash;
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
    if ('centerX' in partial) {
      this._centerX = Math.max(-5, Math.min(5, partial.centerX));
      this.viewOverrides.pan = true;
    }
    if ('centerY' in partial) {
      this._centerY = Math.max(-5, Math.min(5, partial.centerY));
      this.viewOverrides.pan = true;
    }
    if ('zoom' in partial) {
      this._zoom = Math.max(0.2, Math.min(4.0, partial.zoom));
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
  metadata: causticsMetadata,
  create: (bus) => new CausticsVisualizer(bus),
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

  uniform float u_time;
  uniform vec2 u_resolution;
  uniform vec2 u_center;
  uniform float u_zoom;
  uniform float u_waveAmplitude;
  uniform float u_waveSpeed;
  uniform float u_surfaceDetail;
  uniform float u_brightness;
  uniform float u_colorTemp;
  uniform float u_depth;
  uniform float u_bass;
  uniform float u_mid;
  uniform float u_high;
  uniform float u_rms;
  uniform float u_spectralCentroid;
  uniform float u_beatPulse;

  varying vec2 vUv;

  // Water surface height at position p using layered Gerstner-like waves
  float waterHeight(vec2 p, float t) {
    float h = 0.0;
    float amp = u_waveAmplitude * 0.15;
    float freq = 2.5;
    float speed = u_waveSpeed;

    // Layer multiple wave octaves
    int octaves = int(u_surfaceDetail);
    for (int i = 0; i < 5; i++) {
      if (i >= octaves) break;
      float fi = float(i);
      // Rotate each octave's direction for organic look
      float angle = fi * 2.399 + fi * 0.3;
      vec2 dir = vec2(cos(angle), sin(angle));
      float phase = dot(p, dir) * freq - t * speed * (1.0 + fi * 0.3);
      h += sin(phase) * amp;
      // Beat splash: radial ripple
      float beatRipple = sin(length(p) * 8.0 - t * 6.0) * u_beatPulse * 0.06;
      h += beatRipple;
      amp *= 0.55;
      freq *= 1.8;
    }
    return h;
  }

  // Compute caustic intensity via Jacobian determinant of refracted ray mapping
  // This measures how much refracted rays converge/diverge at the sea floor
  float causticIntensity(vec2 p, float t) {
    float eps = 0.004 / u_zoom;

    // Surface normal via central differences
    float hc = waterHeight(p, t);
    float hx = waterHeight(p + vec2(eps, 0.0), t);
    float hy = waterHeight(p + vec2(0.0, eps), t);

    // Gradient of height field = surface slope
    vec2 grad = vec2(hx - hc, hy - hc) / eps;

    // Refracted ray displacement on the sea floor
    // Snell's law simplified: displacement ~ -depth * gradient / n_water
    float n_water = 1.33;
    vec2 displacement = -u_depth * grad / n_water;

    // The "refracted position" on the floor
    vec2 floorPos = p + displacement;

    // Jacobian determinant via finite differences of the refraction map
    vec2 floorPosX = (p + vec2(eps, 0.0))
      + (-u_depth / n_water) * vec2(
          waterHeight(p + vec2(2.0 * eps, 0.0), t) - hx,
          waterHeight(p + vec2(eps, eps), t) - waterHeight(p + vec2(eps, 0.0), t)
        ) / eps;
    vec2 floorPosY = (p + vec2(0.0, eps))
      + (-u_depth / n_water) * vec2(
          waterHeight(p + vec2(eps, eps), t) - hy,
          waterHeight(p + vec2(0.0, 2.0 * eps), t) - waterHeight(p + vec2(0.0, eps), t)
        ) / eps;

    vec2 dFdx = (floorPosX - floorPos) / eps;
    vec2 dFdy = (floorPosY - floorPos) / eps;

    // Jacobian determinant: ratio of original to refracted area
    float det = abs(dFdx.x * dFdy.y - dFdx.y * dFdy.x);

    // Caustic brightness is inverse of area ratio (convergence = bright)
    // Clamp to avoid singularities at perfect focus
    return 1.0 / max(det, 0.05);
  }

  // Second caustic layer at different scale for richness
  float causticLayerB(vec2 p, float t) {
    // Offset and rotate for a non-correlated second layer
    float angle = 0.7;
    mat2 rot = mat2(cos(angle), -sin(angle), sin(angle), cos(angle));
    vec2 p2 = rot * (p * 1.7) + vec2(3.14, 1.59);
    return causticIntensity(p2, t * 0.85 + 5.0);
  }

  vec3 palette(float t, float warmth) {
    // Deep blue water base -> warm gold caustics
    vec3 coolCaustic = vec3(0.4, 0.75, 1.0);
    vec3 warmCaustic = vec3(1.0, 0.85, 0.5);
    vec3 causticColor = mix(coolCaustic, warmCaustic, warmth);

    vec3 deep = vec3(0.01, 0.04, 0.12);
    vec3 mid = vec3(0.02, 0.12, 0.25);

    float f = clamp(t, 0.0, 1.0);
    if (f < 0.3) return mix(deep, mid, f / 0.3);
    return mix(mid, causticColor, (f - 0.3) / 0.7);
  }

  void main() {
    vec2 uv = (gl_FragCoord.xy - 0.5 * u_resolution) / min(u_resolution.x, u_resolution.y);
    float scale = 3.0 / u_zoom;
    vec2 pos = uv * scale + u_center;

    float t = u_time;

    // Two caustic layers for richness
    float c1 = causticIntensity(pos, t);
    float c2 = causticLayerB(pos, t);

    // Combine layers: primary + secondary at lower weight
    float caustic = c1 * 0.6 + c2 * 0.4;

    // Normalize: most values cluster around 1.0 (flat surface)
    // Caustics appear where value exceeds 1.0 significantly
    float intensity = max(0.0, caustic - 0.7) * 1.5;

    // Apply brightness and RMS glow
    intensity *= u_brightness * (0.5 + u_rms * 0.8);

    // Soft power curve for contrast
    intensity = pow(intensity, 0.85);

    // Color
    float warmth = clamp(u_colorTemp, 0.0, 1.0);
    vec3 color = palette(intensity * 0.5, warmth);

    // Add bright caustic highlights
    float highlight = smoothstep(0.5, 2.0, intensity);
    vec3 highlightColor = mix(vec3(0.5, 0.8, 1.0), vec3(1.0, 0.95, 0.8), warmth);
    color += highlightColor * highlight * 0.6;

    // Extra-bright peaks: white flash on strongest convergence
    float peak = smoothstep(2.0, 4.0, intensity);
    color += vec3(1.0) * peak * 0.3;

    // Beat pulse: ripple ring
    float beatDist = length(uv);
    float beatRing = exp(-pow(beatDist - u_beatPulse * 0.8, 2.0) * 20.0) * u_beatPulse;
    color += highlightColor * beatRing * 0.15;

    // High frequency shimmer: subtle sparkle on peaks
    float shimmer = sin(pos.x * 40.0 + t * 3.0) * sin(pos.y * 40.0 - t * 2.5);
    shimmer = shimmer * shimmer;
    color += vec3(shimmer * u_high * 0.08 * highlight);

    // Vignette
    float aspect = u_resolution.x / u_resolution.y;
    vec2 screenUv = gl_FragCoord.xy / u_resolution;
    float vignette = 1.0 - 0.35 * length((screenUv - 0.5) * vec2(aspect, 1.0));
    color *= vignette;

    // Ensure deep blue minimum
    color = max(color, vec3(0.005, 0.01, 0.03));

    // Tone mapping
    color = color / (0.9 + color);

    gl_FragColor = vec4(color, 1.0);
  }
`;
