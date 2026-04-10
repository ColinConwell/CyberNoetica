import * as THREE from 'three';
import { MessageBus } from '@cybernoetica/core';
import type { AudioFeatures, BusMessage, Unsubscribe } from '@cybernoetica/core';
import { EMASmoothing } from '../../smoothing.js';
import type { Visualizer, VisualizerMetadata } from '../types.js';
import { registerVisualizer } from '../registry.js';

/**
 * Chladni / Cymatics visualizer -- sound made visible.
 *
 * Renders the standing wave nodal patterns that form on vibrating plates,
 * the mathematical equivalent of sand accumulating at nodes of vibration.
 * The Chladni equation f(x,y) = a*sin(n*pi*x)*sin(m*pi*y) + b*cos(n*pi*x)*cos(m*pi*y)
 * produces intricate symmetry patterns whose complexity scales with mode numbers.
 *
 * Spectral centroid drives the mode numbers (higher frequencies = more complex patterns),
 * bass/RMS drives the sin/cos blend, beat detection triggers mode transitions,
 * and mid-range adds jitter to simulate sand scattering away from nodes.
 */

const chladniMetadata: VisualizerMetadata = {
  type: 'chladni',
  label: 'Chladni',
  description: 'Cymatics standing wave patterns',
  usesPerspective: false,
  params: [
    // Appearance
    { key: 'modeN', label: 'Mode N', min: 1, max: 12, step: 1, initial: 3, category: 'appearance' },
    { key: 'modeM', label: 'Mode M', min: 1, max: 12, step: 1, initial: 5, category: 'appearance' },
    { key: 'lineThickness', label: 'Line Thickness', min: 0.5, max: 5.0, step: 0.25, initial: 2.0, category: 'appearance' },
    { key: 'colorIntensity', label: 'Color Intensity', min: 0.3, max: 1.5, step: 0.05, initial: 0.8, category: 'appearance' },
    { key: 'animSpeed', label: 'Animation Speed', min: 0.0, max: 1.0, step: 0.05, initial: 0.3, category: 'appearance' },
    // Audio mapping
    { key: 'spectralToMode', label: 'Spectral -> Mode', min: 0.0, max: 2.0, step: 0.1, initial: 1.0, category: 'audio-mapping', description: 'How strongly spectral centroid shifts mode numbers' },
    { key: 'bassToBlend', label: 'Bass -> Blend', min: 0.0, max: 2.0, step: 0.1, initial: 1.0, category: 'audio-mapping', description: 'How strongly bass shifts sin/cos blend coefficient' },
    { key: 'rmsToGlow', label: 'RMS -> Glow', min: 0.0, max: 2.0, step: 0.1, initial: 1.0, category: 'audio-mapping', description: 'How strongly volume affects nodal line glow' },
    { key: 'midToScatter', label: 'Mid -> Scatter', min: 0.0, max: 2.0, step: 0.1, initial: 1.0, category: 'audio-mapping', description: 'How strongly mids scatter the pattern' },
  ],
  viewport: { pan: true, zoom: true, orbit: false },
  viewStateFields: [
    { key: 'centerX', label: 'Center X', min: -2, max: 2, step: 0.05 },
    { key: 'centerY', label: 'Center Y', min: -2, max: 2, step: 0.05 },
    { key: 'zoom', label: 'Zoom', min: 0.3, max: 4.0, step: 0.05 },
  ],
};

export class ChladniVisualizer implements Visualizer {
  readonly metadata = chladniMetadata;

  private unsub: Unsubscribe;
  private latestFeatures: AudioFeatures | null = null;
  private time = 0;

  private userParams: Record<string, number> = {
    modeN: 3,
    modeM: 5,
    lineThickness: 2.0,
    colorIntensity: 0.8,
    animSpeed: 0.3,
    spectralToMode: 1.0,
    bassToBlend: 1.0,
    rmsToGlow: 1.0,
    midToScatter: 1.0,
  };

  private _centerX = 0;
  private _centerY = 0;
  private _zoom = 1.0;
  private viewOverrides: Record<string, boolean> = {};

  private smoothers = {
    bass: new EMASmoothing(0.15),
    mid: new EMASmoothing(0.2),
    high: new EMASmoothing(0.25),
    rms: new EMASmoothing(0.2),
    spectralCentroid: new EMASmoothing(0.1),
    beatPulse: new EMASmoothing(0.45),
    modeNSmooth: new EMASmoothing(0.05),
    modeMSmooth: new EMASmoothing(0.05),
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
    this.smoothers.modeNSmooth.reset(3);
    this.smoothers.modeMSmooth.reset(5);
  }

  attach(scene: THREE.Scene): void {
    this.material = new THREE.ShaderMaterial({
      vertexShader: VERTEX_SHADER,
      fragmentShader: FRAGMENT_SHADER,
      uniforms: {
        u_time: { value: 0.0 },
        u_resolution: { value: new THREE.Vector2(1920, 1080) },
        u_modeN: { value: 3.0 },
        u_modeM: { value: 5.0 },
        u_lineThickness: { value: 2.0 },
        u_colorIntensity: { value: 0.8 },
        u_blend: { value: 0.5 },
        u_bass: { value: 0.0 },
        u_mid: { value: 0.0 },
        u_high: { value: 0.0 },
        u_rms: { value: 0.1 },
        u_spectralCentroid: { value: 0.5 },
        u_beatPulse: { value: 0.0 },
        u_center: { value: new THREE.Vector2(0, 0) },
        u_zoom: { value: 1.0 },
        u_rmsToGlow: { value: 1.0 },
        u_midToScatter: { value: 1.0 },
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

    // Mode numbers: base + spectral centroid modulation
    const spectralOffset = this.smoothers.spectralCentroid.value * 4 * this.userParams.spectralToMode;
    const targetN = Math.max(1, Math.min(12, Math.round(this.userParams.modeN + spectralOffset * 0.5)));
    const targetM = Math.max(1, Math.min(12, Math.round(this.userParams.modeM + spectralOffset)));
    this.smoothers.modeNSmooth.update(targetN);
    this.smoothers.modeMSmooth.update(targetM);

    // Blend coefficient driven by bass
    const blend = 0.5 + (this.smoothers.bass.value - 0.5) * this.userParams.bassToBlend;

    if (this.material) {
      const u = this.material.uniforms;
      u.u_time.value = this.time * this.userParams.animSpeed;
      u.u_modeN.value = this.smoothers.modeNSmooth.value;
      u.u_modeM.value = this.smoothers.modeMSmooth.value;
      u.u_lineThickness.value = this.userParams.lineThickness;
      u.u_colorIntensity.value = this.userParams.colorIntensity;
      u.u_blend.value = Math.max(0, Math.min(1, blend));
      u.u_bass.value = this.smoothers.bass.value;
      u.u_mid.value = this.smoothers.mid.value;
      u.u_high.value = this.smoothers.high.value;
      u.u_rms.value = this.smoothers.rms.value;
      u.u_spectralCentroid.value = this.smoothers.spectralCentroid.value;
      u.u_beatPulse.value = this.smoothers.beatPulse.value;
      u.u_center.value.set(this._centerX, this._centerY);
      u.u_zoom.value = this._zoom;
      u.u_rmsToGlow.value = this.userParams.rmsToGlow;
      u.u_midToScatter.value = this.userParams.midToScatter;
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
      this._centerX = Math.max(-2, Math.min(2, partial.centerX));
      this.viewOverrides.pan = true;
    }
    if ('centerY' in partial) {
      this._centerY = Math.max(-2, Math.min(2, partial.centerY));
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
  metadata: chladniMetadata,
  create: (bus) => new ChladniVisualizer(bus),
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
  uniform float u_modeN;
  uniform float u_modeM;
  uniform float u_lineThickness;
  uniform float u_colorIntensity;
  uniform float u_blend;
  uniform float u_bass;
  uniform float u_mid;
  uniform float u_high;
  uniform float u_rms;
  uniform float u_spectralCentroid;
  uniform float u_beatPulse;
  uniform vec2 u_center;
  uniform float u_zoom;
  uniform float u_rmsToGlow;
  uniform float u_midToScatter;

  varying vec2 vUv;

  // --- Hash for scatter noise ---
  float hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
  }

  vec2 hash2(vec2 p) {
    p = vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)));
    return -1.0 + 2.0 * fract(sin(p) * 43758.5453123);
  }

  float gnoise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(
      mix(dot(hash2(i + vec2(0.0, 0.0)), f - vec2(0.0, 0.0)),
          dot(hash2(i + vec2(1.0, 0.0)), f - vec2(1.0, 0.0)), u.x),
      mix(dot(hash2(i + vec2(0.0, 1.0)), f - vec2(0.0, 1.0)),
          dot(hash2(i + vec2(1.0, 1.0)), f - vec2(1.0, 1.0)), u.x),
      u.y
    );
  }

  // --- HSV to RGB ---
  vec3 hsv2rgb(vec3 c) {
    vec4 K = vec4(1.0, 2.0 / 3.0, 1.0 / 3.0, 3.0);
    vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
    return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
  }

  // --- Chladni equation ---
  // f(x,y) = a*sin(n*PI*x)*sin(m*PI*y) + b*cos(n*PI*x)*cos(m*PI*y)
  // Nodal lines occur where f(x,y) ~ 0
  float chladni(vec2 p, float n, float m, float a, float b) {
    return a * sin(PI * n * p.x) * sin(PI * m * p.y)
         + b * cos(PI * n * p.x) * cos(PI * m * p.y);
  }

  // Superposition of two Chladni modes for richer patterns
  float chladniSuper(vec2 p, float n, float m, float blend) {
    float f1 = chladni(p, n, m, blend, 1.0 - blend);
    float f2 = chladni(p, m, n, 1.0 - blend, blend);
    return f1 * 0.6 + f2 * 0.4;
  }

  void main() {
    vec2 uv = (gl_FragCoord.xy - 0.5 * u_resolution) / min(u_resolution.x, u_resolution.y);
    uv = uv / u_zoom + u_center;

    // Scatter/jitter driven by mids (simulates sand vibrating away from nodes)
    float scatterAmt = u_mid * 0.015 * u_midToScatter;
    vec2 scatter = vec2(gnoise(uv * 30.0 + u_time * 2.0), gnoise(uv * 30.0 + 100.0 + u_time * 2.0)) * scatterAmt;
    vec2 p = uv + scatter;

    // Slow animation: modes drift slightly with time
    float timeWarp = sin(u_time * 0.5) * 0.15;

    // Evaluate Chladni function
    float f = chladniSuper(p, u_modeN + timeWarp, u_modeM - timeWarp * 0.7, u_blend);

    // Distance to nodal line (|f| ~ 0)
    float absF = abs(f);
    float thickness = 0.04 * u_lineThickness;

    // Soft nodal line rendering
    float nodalIntensity = 1.0 - smoothstep(0.0, thickness, absF);

    // Secondary: gradient magnitude for flow direction coloring
    float eps = 0.005;
    float fx = chladniSuper(p + vec2(eps, 0.0), u_modeN + timeWarp, u_modeM - timeWarp * 0.7, u_blend);
    float fy = chladniSuper(p + vec2(0.0, eps), u_modeN + timeWarp, u_modeM - timeWarp * 0.7, u_blend);
    vec2 grad = vec2(fx - f, fy - f) / eps;
    float gradMag = length(grad);
    float gradAngle = atan(grad.y, grad.x);

    // --- Coloring ---

    // Nodal lines: bright, colored by gradient direction
    float hue = fract(gradAngle / TAU + u_time * 0.05 + u_spectralCentroid * 0.3);
    float sat = 0.6 + 0.3 * nodalIntensity;
    float val = nodalIntensity * u_colorIntensity;

    // Glow boost from RMS
    val *= 0.6 + u_rms * 0.8 * u_rmsToGlow;

    // Background: subtle field visualization
    float bgField = abs(f) * 0.15;
    float bgHue = fract(f * 0.3 + u_time * 0.02);

    vec3 nodalColor = hsv2rgb(vec3(hue, sat, val));
    vec3 bgColor = hsv2rgb(vec3(bgHue, 0.4, bgField * u_colorIntensity * 0.5));

    vec3 color = nodalColor + bgColor;

    // Beat pulse: flash nodal lines white
    color += vec3(nodalIntensity * u_beatPulse * 0.4);

    // Anti-nodal glow: regions of maximum displacement
    float antiNodal = smoothstep(0.3, 0.8, absF);
    color += hsv2rgb(vec3(fract(hue + 0.5), 0.3, antiNodal * u_bass * 0.15));

    // Plate boundary: circular fade
    float r = length(uv);
    float plateMask = 1.0 - smoothstep(0.8, 1.0, r);
    color *= plateMask;

    // Plate edge ring
    float edgeRing = exp(-pow((r - 0.9) * 15.0, 2.0)) * 0.2;
    color += vec3(edgeRing * (0.5 + u_high * 0.5));

    // Vignette
    float aspect = u_resolution.x / u_resolution.y;
    vec2 screenUv = gl_FragCoord.xy / u_resolution;
    float vignette = 1.0 - 0.3 * length((screenUv - 0.5) * vec2(aspect, 1.0));
    color *= vignette;

    // Background ambience
    color = max(color, vec3(0.008, 0.005, 0.015));

    // Tone mapping
    color = color / (0.9 + color);

    gl_FragColor = vec4(color, 1.0);
  }
`;
