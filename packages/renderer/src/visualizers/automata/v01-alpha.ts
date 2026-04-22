import * as THREE from 'three';
import { MessageBus } from '@cybernoetica/core';
import type { AudioFeatures, BusMessage, Unsubscribe } from '@cybernoetica/core';
import { EMASmoothing } from '../../smoothing.js';
import type { Visualizer, VisualizerMetadata } from '../types.js';
import { registerVisualizer } from '../registry.js';

/**
 * Cellular Automata visualizer — generative life patterns.
 *
 * Renders a continuous-valued cellular automaton inspired by Lenia
 * (continuous Game of Life). Rather than discrete alive/dead states,
 * cells have smooth values that evolve via a growth function applied
 * to neighborhood sums, producing organic, amoeba-like patterns.
 *
 * The automaton state is computed in the fragment shader using a
 * multi-pass-like approach: previous state is encoded in a feedback
 * texture, but for simplicity we use a procedural approximation
 * that captures the visual essence of cellular automata.
 *
 * Bass drives the growth rate, mids control neighborhood radius,
 * spectral centroid shifts the growth function center, and beats
 * inject random seed patterns.
 */

const automataMetadata: VisualizerMetadata = {
  type: 'automata',
  label: 'Automata',
  description: 'Continuous cellular automata patterns',
  usesPerspective: false,
  params: [
    // Appearance
    { key: 'cellScale', label: 'Cell Scale', min: 2.0, max: 20.0, step: 1.0, initial: 8.0, category: 'appearance', description: 'Size of cell grid' },
    { key: 'brightness', label: 'Brightness', min: 0.5, max: 3.0, step: 0.1, initial: 1.3, category: 'appearance', description: 'Overall brightness' },
    { key: 'evolutionSpeed', label: 'Evolution Speed', min: 0.1, max: 2.0, step: 0.1, initial: 0.6, category: 'appearance', description: 'How fast patterns evolve' },
    { key: 'colorShift', label: 'Color Shift', min: 0.0, max: 1.0, step: 0.05, initial: 0.0, category: 'appearance', description: 'Base hue offset' },
    { key: 'trailLength', label: 'Trail Length', min: 0.0, max: 1.0, step: 0.05, initial: 0.5, category: 'appearance', description: 'Temporal persistence of cells' },
    // Audio mapping
    { key: 'bassToGrowth', label: 'Bass -> Growth', min: 0.0, max: 2.0, step: 0.1, initial: 1.0, category: 'audio-mapping', description: 'How bass drives growth rate' },
    { key: 'midToRadius', label: 'Mid -> Radius', min: 0.0, max: 2.0, step: 0.1, initial: 1.0, category: 'audio-mapping', description: 'How mids expand neighborhood radius' },
    { key: 'spectralToRule', label: 'Spectral -> Rule', min: 0.0, max: 2.0, step: 0.1, initial: 1.0, category: 'audio-mapping', description: 'How spectral centroid shifts the growth function' },
    { key: 'rmsToLife', label: 'RMS -> Life', min: 0.0, max: 2.0, step: 0.1, initial: 1.0, category: 'audio-mapping', description: 'How volume affects cell vitality' },
  ],
  viewport: { pan: true, zoom: true, orbit: false },
  viewStateFields: [
    { key: 'zoom', label: 'Zoom', min: 0.3, max: 5.0, step: 0.05 },
    { key: 'panX', label: 'Pan X', min: -3.0, max: 3.0, step: 0.01 },
    { key: 'panY', label: 'Pan Y', min: -3.0, max: 3.0, step: 0.01 },
  ],
};

export class AutomataVisualizer implements Visualizer {
  readonly metadata = automataMetadata;

  private unsub: Unsubscribe;
  private latestFeatures: AudioFeatures | null = null;
  private time = 0;

  private userParams: Record<string, number> = {
    cellScale: 8.0,
    brightness: 1.3,
    evolutionSpeed: 0.6,
    colorShift: 0.0,
    trailLength: 0.5,
    bassToGrowth: 1.0,
    midToRadius: 1.0,
    spectralToRule: 1.0,
    rmsToLife: 1.0,
  };

  private _zoom = 1.0;
  private _panX = 0.0;
  private _panY = 0.0;

  private smoothers = {
    bass: new EMASmoothing(0.12),
    mid: new EMASmoothing(0.18),
    high: new EMASmoothing(0.22),
    rms: new EMASmoothing(0.15),
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
    this.material = new THREE.RawShaderMaterial({
      vertexShader: VERTEX_SHADER,
      fragmentShader: FRAGMENT_SHADER,
      uniforms: {
        u_time: { value: 0.0 },
        u_resolution: { value: new THREE.Vector2(1920, 1080) },
        u_zoom: { value: 1.0 },
        u_pan: { value: new THREE.Vector2(0, 0) },
        u_cellScale: { value: 8.0 },
        u_brightness: { value: 1.3 },
        u_trailLength: { value: 0.5 },
        u_colorShift: { value: 0.0 },
        u_growthRate: { value: 1.0 },
        u_neighborRadius: { value: 1.0 },
        u_ruleShift: { value: 0.0 },
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
      u.u_time.value = this.time * this.userParams.evolutionSpeed;
      u.u_zoom.value = this._zoom;
      u.u_pan.value.set(this._panX, this._panY);
      u.u_cellScale.value = this.userParams.cellScale;
      u.u_brightness.value = this.userParams.brightness;
      u.u_trailLength.value = this.userParams.trailLength;
      u.u_colorShift.value = this.userParams.colorShift;

      // Bass drives growth rate
      u.u_growthRate.value = 0.5 + this.smoothers.bass.value * 1.5 * this.userParams.bassToGrowth;

      // Mids expand neighborhood radius
      u.u_neighborRadius.value = 1.0 + this.smoothers.mid.value * 0.8 * this.userParams.midToRadius;

      // Spectral centroid shifts rule parameters
      u.u_ruleShift.value = (this.smoothers.spectralCentroid.value - 0.5) * this.userParams.spectralToRule;

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
    if ('zoom' in partial) this._zoom = Math.max(0.3, Math.min(5.0, partial.zoom));
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
  metadata: automataMetadata,
  create: (bus) => new AutomataVisualizer(bus),
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

  uniform float u_time;
  uniform vec2 u_resolution;
  uniform float u_zoom;
  uniform vec2 u_pan;
  uniform float u_cellScale;
  uniform float u_brightness;
  uniform float u_trailLength;
  uniform float u_colorShift;
  uniform float u_growthRate;
  uniform float u_neighborRadius;
  uniform float u_ruleShift;
  uniform float u_bass;
  uniform float u_mid;
  uniform float u_high;
  uniform float u_rms;
  uniform float u_spectralCentroid;
  uniform float u_beatPulse;

  varying vec2 vUv;

  // --- Hash functions ---
  float hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
  }

  vec2 hash2(vec2 p) {
    p = vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)));
    return fract(sin(p) * 43758.5453123);
  }

  float gnoise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);

    float a = hash(i);
    float b = hash(i + vec2(1.0, 0.0));
    float c = hash(i + vec2(0.0, 1.0));
    float d = hash(i + vec2(1.0, 1.0));

    return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
  }

  // Multi-octave noise
  float fbm(vec2 p) {
    float sum = 0.0;
    float amp = 0.5;
    for (int i = 0; i < 5; i++) {
      sum += gnoise(p) * amp;
      p *= 2.0;
      amp *= 0.5;
    }
    return sum;
  }

  // Lenia-inspired growth function: Gaussian bump
  float growth(float x, float center, float width) {
    return exp(-pow((x - center) / width, 2.0)) * 2.0 - 1.0;
  }

  #include <cyber_hsv2rgb>

  void main() {
    vec2 uv = (gl_FragCoord.xy - 0.5 * u_resolution) / min(u_resolution.x, u_resolution.y);
    uv = uv * 3.0 / u_zoom + u_pan;

    // Grid coordinates
    vec2 cellUv = uv * u_cellScale;
    vec2 cellId = floor(cellUv);
    vec2 cellFract = fract(cellUv);

    // Time-stepped evolution (discrete generations)
    float gen = floor(u_time * 3.0);
    float genFract = fract(u_time * 3.0);

    // --- Compute cell state using neighborhood ---
    // Sum neighboring cells' states (using noise as a procedural state)
    float neighborSum = 0.0;
    float neighborCount = 0.0;
    float maxNeighbor = 0.0;

    int radius = int(ceil(u_neighborRadius));
    for (int dy = -2; dy <= 2; dy++) {
      for (int dx = -2; dx <= 2; dx++) {
        if (abs(dx) > radius || abs(dy) > radius) continue;
        if (dx == 0 && dy == 0) continue;

        vec2 neighbor = cellId + vec2(float(dx), float(dy));
        float dist = length(vec2(float(dx), float(dy)));

        // Kernel weight: smooth ring at radius
        float weight = exp(-pow(dist - u_neighborRadius, 2.0) * 2.0);

        // Neighbor state: time-seeded procedural automaton
        float nState = fbm(neighbor * 0.3 + gen * 0.17);
        // Add temporal variation that creates wave-like propagation
        nState += 0.3 * sin(gen * 0.5 + dot(neighbor, vec2(0.3, 0.7)));
        nState = clamp(nState, 0.0, 1.0);

        neighborSum += nState * weight;
        neighborCount += weight;
        maxNeighbor = max(maxNeighbor, nState);
      }
    }

    float avgNeighbor = neighborSum / max(neighborCount, 1.0);

    // Current cell state
    float cellState = fbm(cellId * 0.3 + gen * 0.17);
    cellState += 0.3 * sin(gen * 0.5 + dot(cellId, vec2(0.3, 0.7)));
    cellState = clamp(cellState, 0.0, 1.0);

    // Apply Lenia-style growth function
    float growthCenter = 0.25 + u_ruleShift * 0.2;
    float growthWidth = 0.15 * u_growthRate;
    float delta = growth(avgNeighbor, growthCenter, growthWidth);

    // Next state with growth applied
    float nextState = clamp(cellState + delta * 0.1, 0.0, 1.0);

    // Interpolate between generations for smooth animation
    float displayState = mix(cellState, nextState, genFract);

    // Trail effect: add persistence
    float prevGen = gen - 1.0;
    float prevState = fbm(cellId * 0.3 + prevGen * 0.17);
    prevState += 0.3 * sin(prevGen * 0.5 + dot(cellId, vec2(0.3, 0.7)));
    prevState = clamp(prevState, 0.0, 1.0);
    displayState = max(displayState, prevState * u_trailLength);

    // Cell border softening
    vec2 borderDist = abs(cellFract - 0.5);
    float cellMask = 1.0 - smoothstep(0.35, 0.5, max(borderDist.x, borderDist.y));
    displayState *= cellMask;

    // Beat injection: boost random cells
    float beatSeed = hash(cellId + vec2(gen * 0.1, 0.0));
    displayState += u_beatPulse * step(0.85, beatSeed) * 0.6;
    displayState = clamp(displayState, 0.0, 1.0);

    // --- Coloring ---
    float age = fbm(cellId * 0.5 + gen * 0.05);
    float hue = fract(
      u_colorShift
      + age * 0.4
      + displayState * 0.3
      + u_spectralCentroid * 0.15
    );

    float sat = 0.5 + 0.4 * displayState;
    float val = displayState * u_brightness;

    // RMS vitality
    val *= 0.5 + u_rms * 1.0;

    vec3 color = hsv2rgb(vec3(hue, sat, clamp(val, 0.0, 1.0)));

    // Living cell glow
    float glow = smoothstep(0.3, 0.8, displayState);
    vec3 glowColor = hsv2rgb(vec3(fract(hue + 0.15), 0.4, 0.3));
    color += glowColor * glow * 0.25;

    // High-frequency shimmer on active cells
    float shimmer = sin(u_time * 8.0 + dot(cellId, vec2(3.7, 7.3))) * 0.5 + 0.5;
    color += vec3(0.02) * shimmer * displayState * u_high;

    // Beat flash
    color += vec3(0.06, 0.04, 0.08) * u_beatPulse * 0.35;

    // Background
    color = max(color, vec3(0.006, 0.005, 0.014));

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
