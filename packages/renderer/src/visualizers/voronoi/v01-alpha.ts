import * as THREE from 'three';
import { MessageBus } from '@cybernoetica/core';
import type { AudioFeatures, BusMessage, Unsubscribe } from '@cybernoetica/core';
import { EMASmoothing } from '../../smoothing.js';
import type { Visualizer, VisualizerMetadata } from '../types.js';
import { registerVisualizer } from '../registry.js';

/**
 * Voronoi / Worley Noise visualizer — living stained glass.
 *
 * Math:
 *   Each fragment is assigned to the nearest seed point under the chosen metric.
 *   This implementation shades with nearest/next-nearest cell distances (F1/F2).
 * Reference: https://mathworld.wolfram.com/VoronoiDiagram.html
 *
 * Renders animated Voronoi cells using distance-field techniques.
 * Cell seed points drift with time; audio modulates jitter, scale,
 * edge thickness, and the blend between distance metrics (Euclidean
 * vs Manhattan) for dramatic structural shifts.
 *
 * Bass pulses the cells outward, mids drive the color palette rotation,
 * and beats trigger brief crystalline flashes along cell edges.
 */

const voronoiMetadata: VisualizerMetadata = {
  type: 'voronoi',
  label: 'Voronoi',
  description: 'Living stained glass cellular noise',
  usesPerspective: false,
  params: [
    // Appearance
    { key: 'cellScale', label: 'Cell Scale', min: 2, max: 12, step: 0.5, initial: 5, category: 'appearance' },
    { key: 'edgeSharpness', label: 'Edge Sharpness', min: 0.5, max: 8.0, step: 0.5, initial: 3.0, category: 'appearance' },
    { key: 'colorSaturation', label: 'Color Saturation', min: 0.0, max: 1.0, step: 0.05, initial: 0.7, category: 'appearance' },
    { key: 'driftSpeed', label: 'Drift Speed', min: 0.0, max: 1.0, step: 0.05, initial: 0.3, category: 'appearance' },
    // Audio mapping
    { key: 'bassToJitter', label: 'Bass → Jitter', min: 0.0, max: 2.0, step: 0.1, initial: 1.0, category: 'audio-mapping', description: 'How strongly bass displaces cell centers' },
    { key: 'midToHue', label: 'Mid → Hue Shift', min: 0.0, max: 2.0, step: 0.1, initial: 1.0, category: 'audio-mapping', description: 'How strongly mids rotate the color palette' },
    { key: 'rmsToEdge', label: 'RMS → Edge Glow', min: 0.0, max: 2.0, step: 0.1, initial: 1.0, category: 'audio-mapping', description: 'How strongly volume brightens cell edges' },
    { key: 'spectralToMetric', label: 'Spectral → Metric', min: 0.0, max: 2.0, step: 0.1, initial: 1.0, category: 'audio-mapping', description: 'How strongly spectral centroid blends Euclidean/Manhattan' },
  ],
  viewport: { pan: true, zoom: true, orbit: false },
  viewStateFields: [
    { key: 'centerX', label: 'Center X', min: -5, max: 5, step: 0.1 },
    { key: 'centerY', label: 'Center Y', min: -5, max: 5, step: 0.1 },
    { key: 'zoom', label: 'Zoom', min: 0.5, max: 4.0, step: 0.05 },
  ],
};

export class VoronoiVisualizer implements Visualizer {
  readonly metadata = voronoiMetadata;

  private unsub: Unsubscribe;
  private latestFeatures: AudioFeatures | null = null;
  private time = 0;

  private userParams: Record<string, number> = {
    cellScale: 5,
    edgeSharpness: 3.0,
    colorSaturation: 0.7,
    driftSpeed: 0.3,
    bassToJitter: 1.0,
    midToHue: 1.0,
    rmsToEdge: 1.0,
    spectralToMetric: 1.0,
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
        u_cellScale: { value: 5.0 },
        u_edgeSharpness: { value: 3.0 },
        u_colorSaturation: { value: 0.7 },
        u_driftSpeed: { value: 0.3 },
        u_bass: { value: 0.0 },
        u_mid: { value: 0.0 },
        u_high: { value: 0.0 },
        u_rms: { value: 0.1 },
        u_spectralCentroid: { value: 0.5 },
        u_beatPulse: { value: 0.0 },
        u_center: { value: new THREE.Vector2(0, 0) },
        u_zoom: { value: 1.0 },
        u_bassToJitter: { value: 1.0 },
        u_midToHue: { value: 1.0 },
        u_rmsToEdge: { value: 1.0 },
        u_spectralToMetric: { value: 1.0 },
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
      u.u_cellScale.value = this.userParams.cellScale;
      u.u_edgeSharpness.value = this.userParams.edgeSharpness;
      u.u_colorSaturation.value = this.userParams.colorSaturation;
      u.u_driftSpeed.value = this.userParams.driftSpeed;
      u.u_bass.value = this.smoothers.bass.value;
      u.u_mid.value = this.smoothers.mid.value;
      u.u_high.value = this.smoothers.high.value;
      u.u_rms.value = this.smoothers.rms.value;
      u.u_spectralCentroid.value = this.smoothers.spectralCentroid.value;
      u.u_beatPulse.value = this.smoothers.beatPulse.value;
      u.u_center.value.set(this._centerX, this._centerY);
      u.u_zoom.value = this._zoom;
      u.u_bassToJitter.value = this.userParams.bassToJitter;
      u.u_midToHue.value = this.userParams.midToHue;
      u.u_rmsToEdge.value = this.userParams.rmsToEdge;
      u.u_spectralToMetric.value = this.userParams.spectralToMetric;
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
      this._centerX = Math.max(-5, Math.min(5, partial.centerX));
      this.viewOverrides.pan = true;
    }
    if ('centerY' in partial) {
      this._centerY = Math.max(-5, Math.min(5, partial.centerY));
      this.viewOverrides.pan = true;
    }
    if ('zoom' in partial) {
      this._zoom = Math.max(0.5, Math.min(4.0, partial.zoom));
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
  metadata: voronoiMetadata,
  create: (bus) => new VoronoiVisualizer(bus),
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

  uniform float u_time;
  uniform vec2 u_resolution;
  uniform float u_cellScale;
  uniform float u_edgeSharpness;
  uniform float u_colorSaturation;
  uniform float u_driftSpeed;
  uniform float u_bass;
  uniform float u_mid;
  uniform float u_high;
  uniform float u_rms;
  uniform float u_spectralCentroid;
  uniform float u_beatPulse;
  uniform vec2 u_center;
  uniform float u_zoom;
  uniform float u_bassToJitter;
  uniform float u_midToHue;
  uniform float u_rmsToEdge;
  uniform float u_spectralToMetric;

  varying vec2 vUv;

  // --- Hashing ---
  vec2 hash2(vec2 p) {
    p = vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)));
    return fract(sin(p) * 43758.5453);
  }

  // --- HSV to RGB ---
  vec3 hsv2rgb(vec3 c) {
    vec4 K = vec4(1.0, 2.0 / 3.0, 1.0 / 3.0, 3.0);
    vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
    return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
  }

  // --- Distance functions ---
  float distEuclidean(vec2 a, vec2 b) {
    vec2 d = a - b;
    return length(d);
  }

  float distManhattan(vec2 a, vec2 b) {
    vec2 d = abs(a - b);
    return d.x + d.y;
  }

  float distMixed(vec2 a, vec2 b, float t) {
    return mix(distEuclidean(a, b), distManhattan(a, b), t);
  }

  void main() {
    vec2 uv = (gl_FragCoord.xy - 0.5 * u_resolution) / min(u_resolution.x, u_resolution.y);
    uv = uv / u_zoom + u_center;

    // Scale to cell space
    vec2 st = uv * u_cellScale;

    // Audio-driven metric blend (Euclidean ↔ Manhattan)
    float metricBlend = clamp(u_spectralCentroid * u_spectralToMetric, 0.0, 1.0);

    // Jitter amount driven by bass
    float jitter = 0.3 + u_bass * 0.7 * u_bassToJitter;

    // Cell grid
    vec2 iSt = floor(st);
    vec2 fSt = fract(st);

    float minDist1 = 10.0;  // F1: nearest
    float minDist2 = 10.0;  // F2: second nearest
    vec2 nearestCell = vec2(0.0);

    // Search 3x3 neighborhood
    for (int y = -1; y <= 1; y++) {
      for (int x = -1; x <= 1; x++) {
        vec2 neighbor = vec2(float(x), float(y));
        vec2 cell = iSt + neighbor;

        // Pseudo-random seed point within cell
        vec2 point = hash2(cell);

        // Animate seed points
        float t = u_time * u_driftSpeed;
        point = 0.5 + jitter * sin(t * (0.5 + point) * 6.2831 + point * 6.2831);

        // Distance from fragment to this seed
        vec2 diff = neighbor + point - fSt;
        float d = distMixed(vec2(0.0), diff, metricBlend);

        if (d < minDist1) {
          minDist2 = minDist1;
          minDist1 = d;
          nearestCell = cell;
        } else if (d < minDist2) {
          minDist2 = d;
        }
      }
    }

    // --- Coloring ---

    // Edge detection (F2 - F1)
    float edge = minDist2 - minDist1;
    float edgeIntensity = 1.0 - smoothstep(0.0, 0.15 / u_edgeSharpness, edge);

    // Cell interior color based on cell ID
    vec2 cellHash = hash2(nearestCell);
    float hue = cellHash.x + u_time * 0.03 + u_mid * 0.3 * u_midToHue;
    hue = fract(hue);
    float sat = u_colorSaturation * (0.5 + 0.5 * cellHash.y);
    float val = 0.25 + 0.35 * (1.0 - minDist1);

    // Audio-driven brightness
    val += u_rms * 0.35;
    val *= 0.9 + u_bass * 0.5;

    vec3 cellColor = hsv2rgb(vec3(hue, sat, val));

    // Edge color: bright, desaturated
    float edgeHue = fract(hue + 0.5);
    vec3 edgeColor = hsv2rgb(vec3(edgeHue, 0.3, 0.75 + u_rms * 0.6 * u_rmsToEdge));

    // Beat flash on edges
    edgeColor += vec3(u_beatPulse * 0.5);

    // Combine cell + edge
    vec3 color = mix(cellColor, edgeColor, edgeIntensity);

    // Subtle depth from F1
    color *= 0.7 + 0.3 * smoothstep(0.0, 1.0, minDist1);

    // Vignette
    float aspect = u_resolution.x / u_resolution.y;
    vec2 vUv2 = gl_FragCoord.xy / u_resolution;
    float vignette = 1.0 - 0.25 * length((vUv2 - 0.5) * vec2(aspect, 1.0));
    color *= vignette;

    // Beat pulse background glow
    color += vec3(0.03, 0.015, 0.04) * u_beatPulse;

    // Tone mapping (softened to preserve brightness)
    color = color / (0.85 + color);

    gl_FragColor = vec4(color, 1.0);
  }
`;
