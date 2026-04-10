import * as THREE from 'three';
import { MessageBus } from '@cybernoetica/core';
import type { AudioFeatures, BusMessage, Unsubscribe } from '@cybernoetica/core';
import { EMASmoothing } from '../../smoothing.js';
import type { Visualizer, VisualizerMetadata } from '../types.js';
import { registerVisualizer } from '../registry.js';

/**
 * Clifford Attractor visualizer — chaotic orbit density field.
 *
 * Iterates the Clifford attractor map per-pixel to compute an
 * orbit-trap density field, producing gossamer filaments of light
 * that swoop in graceful arcs. The four attractor parameters (a,b,c,d)
 * create dramatically different shapes — from tight spirals to
 * wide arcs to delicate dust clouds.
 *
 * Bass morphs the `a` parameter, mids modulate `c` and `d`,
 * spectral centroid controls iteration depth, and beats trigger
 * parameter jumps to pre-selected beautiful regions.
 */

// Known beautiful parameter presets
const PRESETS = [
  { a: -1.4, b: 1.6, c: 1.0, d: 0.7 },    // classic flowing curves
  { a: 1.7, b: 1.7, c: 0.6, d: 1.2 },      // tight spiral clusters
  { a: -1.8, b: -2.0, c: -0.5, d: -0.9 },   // delicate filaments
  { a: 1.5, b: -1.8, c: 1.6, d: 0.9 },      // wide symmetric arcs
  { a: -1.7, b: 1.3, c: -0.1, d: -1.2 },    // organic tendrils
  { a: 1.1, b: -1.32, c: -1.03, d: 1.54 },  // intricate lattice
];

const cliffordMetadata: VisualizerMetadata = {
  type: 'clifford',
  label: 'Clifford Attractor',
  description: 'Chaotic orbit density filaments',
  usesPerspective: false,
  params: [
    // Appearance
    { key: 'iterations', label: 'Iterations', min: 16, max: 96, step: 4, initial: 48, category: 'appearance', description: 'Orbit iteration count (more = finer detail)' },
    { key: 'brightness', label: 'Brightness', min: 0.5, max: 3.0, step: 0.1, initial: 1.5, category: 'appearance', description: 'Overall brightness multiplier' },
    { key: 'falloff', label: 'Falloff', min: 100, max: 1000, step: 50, initial: 400, category: 'appearance', description: 'Density falloff sharpness (wispy to bold)' },
    { key: 'colorShift', label: 'Color Shift', min: 0.0, max: 1.0, step: 0.05, initial: 0.0, category: 'appearance', description: 'Base hue offset' },
    { key: 'morphSpeed', label: 'Morph Speed', min: 0.0, max: 1.0, step: 0.05, initial: 0.2, category: 'appearance', description: 'Speed of parameter interpolation' },
    // Audio mapping
    { key: 'bassToA', label: 'Bass → Shape', min: 0.0, max: 2.0, step: 0.1, initial: 1.0, category: 'audio-mapping', description: 'How bass morphs the attractor shape' },
    { key: 'midToCD', label: 'Mid → Curvature', min: 0.0, max: 2.0, step: 0.1, initial: 1.0, category: 'audio-mapping', description: 'How mids modulate arm width and curvature' },
    { key: 'spectralToIter', label: 'Spectral → Detail', min: 0.0, max: 2.0, step: 0.1, initial: 1.0, category: 'audio-mapping', description: 'How spectral centroid reveals detail depth' },
    { key: 'rmsToFalloff', label: 'RMS → Boldness', min: 0.0, max: 2.0, step: 0.1, initial: 1.0, category: 'audio-mapping', description: 'How volume controls wispy vs bold rendering' },
  ],
  viewport: { pan: true, zoom: true, orbit: false },
  viewStateFields: [
    { key: 'zoom', label: 'Zoom', min: 0.2, max: 5.0, step: 0.05 },
    { key: 'panX', label: 'Pan X', min: -3.0, max: 3.0, step: 0.01 },
    { key: 'panY', label: 'Pan Y', min: -3.0, max: 3.0, step: 0.01 },
  ],
};

export class CliffordVisualizer implements Visualizer {
  readonly metadata = cliffordMetadata;

  private unsub: Unsubscribe;
  private latestFeatures: AudioFeatures | null = null;
  private time = 0;
  private presetIndex = 0;
  private presetLerp = 0;
  private lastBeatTime = -10;

  private userParams: Record<string, number> = {
    iterations: 48,
    brightness: 1.5,
    falloff: 400,
    colorShift: 0.0,
    morphSpeed: 0.2,
    bassToA: 1.0,
    midToCD: 1.0,
    spectralToIter: 1.0,
    rmsToFalloff: 1.0,
  };

  private _zoom = 1.0;
  private _panX = 0.0;
  private _panY = 0.0;

  private smoothers = {
    bass: new EMASmoothing(0.1),
    mid: new EMASmoothing(0.15),
    high: new EMASmoothing(0.2),
    rms: new EMASmoothing(0.18),
    spectralCentroid: new EMASmoothing(0.1),
    beatPulse: new EMASmoothing(0.5),
    paramA: new EMASmoothing(0.03),
    paramB: new EMASmoothing(0.03),
    paramC: new EMASmoothing(0.03),
    paramD: new EMASmoothing(0.03),
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

    const p = PRESETS[0];
    this.smoothers.paramA.reset(p.a);
    this.smoothers.paramB.reset(p.b);
    this.smoothers.paramC.reset(p.c);
    this.smoothers.paramD.reset(p.d);
  }

  attach(scene: THREE.Scene): void {
    this.material = new THREE.ShaderMaterial({
      vertexShader: VERTEX_SHADER,
      fragmentShader: FRAGMENT_SHADER,
      uniforms: {
        u_time: { value: 0.0 },
        u_resolution: { value: new THREE.Vector2(1920, 1080) },
        u_zoom: { value: 1.0 },
        u_pan: { value: new THREE.Vector2(0, 0) },
        u_paramA: { value: PRESETS[0].a },
        u_paramB: { value: PRESETS[0].b },
        u_paramC: { value: PRESETS[0].c },
        u_paramD: { value: PRESETS[0].d },
        u_iterations: { value: 48.0 },
        u_brightness: { value: 1.5 },
        u_falloff: { value: 400.0 },
        u_colorShift: { value: 0.0 },
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

      // On beat, advance to next preset (with cooldown)
      if (f.beatOnset && this.time - this.lastBeatTime > 2.0) {
        this.lastBeatTime = this.time;
        this.presetIndex = (this.presetIndex + 1) % PRESETS.length;
      }
    } else {
      this.smoothers.beatPulse.update(0.0);
    }

    // Slowly morph toward current preset
    const target = PRESETS[this.presetIndex];

    // Bass modulates the 'a' parameter around the preset value
    const bassOffset = this.smoothers.bass.value * 0.5 * this.userParams.bassToA;
    this.smoothers.paramA.update(target.a + bassOffset);
    this.smoothers.paramB.update(target.b);

    // Mids modulate c and d
    const midOffset = this.smoothers.mid.value * 0.3 * this.userParams.midToCD;
    this.smoothers.paramC.update(target.c + midOffset);
    this.smoothers.paramD.update(target.d - midOffset * 0.5);

    if (this.material) {
      const u = this.material.uniforms;
      u.u_time.value = this.time;
      u.u_zoom.value = this._zoom;
      u.u_pan.value.set(this._panX, this._panY);
      u.u_paramA.value = this.smoothers.paramA.value;
      u.u_paramB.value = this.smoothers.paramB.value;
      u.u_paramC.value = this.smoothers.paramC.value;
      u.u_paramD.value = this.smoothers.paramD.value;
      u.u_iterations.value = this.userParams.iterations;
      u.u_brightness.value = this.userParams.brightness;

      // RMS modulates falloff (boldness)
      const falloffMod = 1.0 - this.smoothers.rms.value * 0.4 * this.userParams.rmsToFalloff;
      u.u_falloff.value = this.userParams.falloff * Math.max(0.3, falloffMod);

      u.u_colorShift.value = this.userParams.colorShift;
      u.u_bass.value = this.smoothers.bass.value;
      u.u_mid.value = this.smoothers.mid.value;
      u.u_high.value = this.smoothers.high.value;
      u.u_rms.value = this.smoothers.rms.value;
      u.u_spectralCentroid.value = this.smoothers.spectralCentroid.value;
      u.u_beatPulse.value = this.smoothers.beatPulse.value;
    }
  }

  setResolution(width: number, height: number): void {
    if (this.material) this.material.uniforms.u_resolution.value.set(width, height);
  }

  setUserParam(key: string, value: number): void {
    if (key in this.userParams) this.userParams[key] = value;
  }

  getViewState(): Record<string, number> {
    return { zoom: this._zoom, panX: this._panX, panY: this._panY };
  }

  setViewState(partial: Record<string, number>): void {
    if ('zoom' in partial) this._zoom = Math.max(0.2, Math.min(5.0, partial.zoom));
    if ('panX' in partial) this._panX = Math.max(-3.0, Math.min(3.0, partial.panX));
    if ('panY' in partial) this._panY = Math.max(-3.0, Math.min(3.0, partial.panY));
  }

  dispose(): void {
    this.unsub();
    this.material?.dispose();
    this.mesh?.geometry.dispose();
  }
}

registerVisualizer({
  metadata: cliffordMetadata,
  create: (bus) => new CliffordVisualizer(bus),
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
  #define MAX_ITER 96

  uniform float u_time;
  uniform vec2 u_resolution;
  uniform float u_zoom;
  uniform vec2 u_pan;
  uniform float u_paramA;
  uniform float u_paramB;
  uniform float u_paramC;
  uniform float u_paramD;
  uniform float u_iterations;
  uniform float u_brightness;
  uniform float u_falloff;
  uniform float u_colorShift;
  uniform float u_bass;
  uniform float u_mid;
  uniform float u_high;
  uniform float u_rms;
  uniform float u_spectralCentroid;
  uniform float u_beatPulse;

  varying vec2 vUv;

  vec3 hsv2rgb(vec3 c) {
    vec4 K = vec4(1.0, 2.0 / 3.0, 1.0 / 3.0, 3.0);
    vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
    return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
  }

  void main() {
    vec2 uv = (gl_FragCoord.xy - 0.5 * u_resolution) / min(u_resolution.x, u_resolution.y);
    uv = uv * 2.5 / u_zoom + u_pan;

    int iters = int(clamp(u_iterations, 16.0, float(MAX_ITER)));

    float a = u_paramA;
    float b = u_paramB;
    float c = u_paramC;
    float d = u_paramD;

    // Use pixel position as seed, iterate the Clifford map
    vec2 p = uv;
    float density = 0.0;
    float colorAccum = 0.0;

    for (int i = 0; i < MAX_ITER; i++) {
      if (i >= iters) break;

      // Clifford attractor iteration
      vec2 np = vec2(
        sin(a * p.y) + c * cos(a * p.x),
        sin(b * p.x) + d * cos(b * p.y)
      );
      p = np;

      // Orbit trap: accumulate density based on proximity to origin
      float dist = length(p);
      density += exp(-dist * 2.0);

      // Color: accumulate angle for hue variation
      colorAccum += atan(p.y, p.x);
    }

    density /= float(iters);

    // Alternative density: per-pixel field evaluation
    // (seed from the pixel, see how close orbit comes to reference points)
    vec2 p2 = uv * 0.8;
    float field = 0.0;
    for (int i = 0; i < MAX_ITER; i++) {
      if (i >= iters / 2) break;
      p2 = vec2(
        sin(a * p2.y) + c * cos(a * p2.x),
        sin(b * p2.x) + d * cos(b * p2.y)
      );
      // Distance to the unit circle as orbit trap
      float trapDist = abs(length(p2) - 1.0);
      field += 1.0 / (1.0 + trapDist * trapDist * u_falloff);
    }
    field /= float(iters / 2);

    // Combine both density methods
    float combined = density * 0.6 + field * 0.4;

    // --- Coloring ---
    float hue = fract(
      colorAccum * 0.02
      + u_colorShift
      + combined * 0.5
      + u_spectralCentroid * 0.15
    );

    float sat = 0.5 + 0.4 * (1.0 - combined);
    float val = combined * u_brightness;

    // Audio brightness
    val *= 0.6 + u_rms * 0.8;
    val += u_beatPulse * 0.1;

    vec3 color = hsv2rgb(vec3(hue, sat, clamp(val, 0.0, 1.0)));

    // Add subtle glow in dense regions
    float glow = smoothstep(0.0, 0.5, combined);
    vec3 glowColor = hsv2rgb(vec3(fract(hue + 0.3), 0.3, 0.4));
    color += glowColor * glow * 0.2;

    // Beat flash
    color += vec3(0.08, 0.06, 0.1) * u_beatPulse * 0.3;

    // Background
    color = max(color, vec3(0.006, 0.006, 0.015));

    // Vignette
    float aspect = u_resolution.x / u_resolution.y;
    vec2 screenUv = gl_FragCoord.xy / u_resolution;
    float vignette = 1.0 - 0.4 * length((screenUv - 0.5) * vec2(aspect, 1.0));
    color *= vignette;

    // Tone mapping
    color = color / (1.0 + color);

    gl_FragColor = vec4(color, 1.0);
  }
`;
