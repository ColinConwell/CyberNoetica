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
 * Truchet Flow visualizer — connected quarter-arc tile patterns.
 *
 * Divides space into a grid where each cell contains quarter-arc
 * curves connecting edges. Random tile orientations form continuous,
 * weaving paths that meander across the canvas — luminous rivers
 * of light resembling circuitry or Celtic knotwork.
 *
 * Bass flips tile orientations (topology rewires), mids modulate
 * line thickness, treble adds multi-scale layering, and beats
 * trigger global re-randomization with satisfying path reconnection.
 */

const truchetMetadata: VisualizerMetadata = {
  type: 'truchet',
  label: 'Truchet Flow',
  description: 'Connected arc tiling, luminous circuitry',
  usesPerspective: false,
  params: [
    // Appearance
    {
      key: 'gridScale',
      label: 'Grid Scale',
      min: 3.0,
      max: 20.0,
      step: 0.5,
      initial: 8.0,
      category: 'appearance',
      description: 'Number of tiles across the screen',
    },
    {
      key: 'lineWidth',
      label: 'Line Width',
      min: 0.02,
      max: 0.2,
      step: 0.01,
      initial: 0.08,
      category: 'appearance',
      description: 'Thickness of the arc paths',
    },
    {
      key: 'layers',
      label: 'Scale Layers',
      min: 1,
      max: 4,
      step: 1,
      initial: 2,
      category: 'appearance',
      description: 'Number of overlapping grids at different scales',
    },
    {
      key: 'glowIntensity',
      label: 'Glow',
      min: 0.0,
      max: 1.0,
      step: 0.05,
      initial: 0.5,
      category: 'appearance',
      description: 'Soft glow around paths',
    },
    {
      key: 'colorCycle',
      label: 'Color Cycle',
      min: 0.0,
      max: 1.0,
      step: 0.05,
      initial: 0.3,
      category: 'appearance',
      description: 'Speed of hue rotation along paths',
    },
    // Audio mapping
    {
      key: 'bassToFlip',
      label: 'Bass → Tile Flip',
      min: 0.0,
      max: 2.0,
      step: 0.1,
      initial: 1.0,
      category: 'audio-mapping',
      description: 'How strongly bass rewires tile connections',
    },
    {
      key: 'midToWidth',
      label: 'Mid → Width',
      min: 0.0,
      max: 2.0,
      step: 0.1,
      initial: 1.0,
      category: 'audio-mapping',
      description: 'How mids modulate path thickness',
    },
    {
      key: 'highToLayers',
      label: 'High → Detail',
      min: 0.0,
      max: 2.0,
      step: 0.1,
      initial: 1.0,
      category: 'audio-mapping',
      description: 'How treble reveals fine-scale layers',
    },
    {
      key: 'rmsToGlow',
      label: 'RMS → Glow',
      min: 0.0,
      max: 2.0,
      step: 0.1,
      initial: 1.0,
      category: 'audio-mapping',
      description: 'How volume drives glow intensity',
    },
  ],
  viewport: { pan: true, zoom: true, orbit: false },
  viewStateFields: [
    { key: 'zoom', label: 'Zoom', min: 0.3, max: 5.0, step: 0.05 },
    { key: 'panX', label: 'Pan X', min: -5.0, max: 5.0, step: 0.01 },
    { key: 'panY', label: 'Pan Y', min: -5.0, max: 5.0, step: 0.01 },
  ],
};

export class TruchetVisualizer implements Visualizer {
  private deltaSeconds = 1 / 60;
  private phases = new PhaseClock();
  readonly metadata = truchetMetadata;

  private unsub: Unsubscribe;
  private latestFeatures: AudioFeatures | null = null;
  private time = 0;
  private flipPrevious = 0.5;
  private flipTarget = 0.5;
  private flipAge = 1;

  private userParams: Record<string, number> = {
    gridScale: 8.0,
    lineWidth: 0.08,
    layers: 2,
    glowIntensity: 0.5,
    colorCycle: 0.3,
    bassToFlip: 1.0,
    midToWidth: 1.0,
    highToLayers: 1.0,
    rmsToGlow: 1.0,
  };

  private _zoom = 1.0;
  private _panX = 0.0;
  private _panY = 0.0;

  private smoothers = {
    bass: new EMASmoothing(0.15),
    mid: new EMASmoothing(0.18),
    high: new EMASmoothing(0.22),
    rms: new EMASmoothing(0.2),
    spectralCentroid: new EMASmoothing(0.1),
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
    this.material = new THREE.ShaderMaterial({
      vertexShader: VERTEX_SHADER,
      fragmentShader: FRAGMENT_SHADER,
      uniforms: {
        u_flipPrevious: { value: 0.5 },
        u_flipTarget: { value: 0.5 },
        u_flipMix: { value: 1 },
        u_colorCyclePhase: { value: 0 },
        u_time: { value: 0.0 },
        u_resolution: { value: new THREE.Vector2(1920, 1080) },
        u_zoom: { value: 1.0 },
        u_pan: { value: new THREE.Vector2(0, 0) },
        u_gridScale: { value: 8.0 },
        u_lineWidth: { value: 0.08 },
        u_layers: { value: 2.0 },
        u_glowIntensity: { value: 0.5 },
        u_colorCycle: { value: 0.3 },
        u_bass: { value: 0.0 },
        u_mid: { value: 0.0 },
        u_high: { value: 0.0 },
        u_rms: { value: 0.1 },
        u_spectralCentroid: { value: 0.5 },
        u_beatPulse: { value: 0.0 },
        u_bassToFlip: { value: 1.0 },
        u_midToWidth: { value: 1.0 },
        u_highToLayers: { value: 1.0 },
        u_rmsToGlow: { value: 1.0 },
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
    this.flipAge += this.deltaSeconds;

    if (this.latestFeatures) {
      const f = takeAudioFrame(this.latestFeatures);
      if (f.beatOnset) {
        this.flipPrevious = this.flipTarget;
        this.flipTarget = 0.5 + f.bass * 0.3 * this.userParams.bassToFlip;
        this.flipAge = 0;
      }
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

    if (this.material) {
      const u = this.material.uniforms;
      u.u_flipPrevious.value = this.flipPrevious;
      u.u_flipTarget.value = this.flipTarget;
      u.u_flipMix.value = Math.min(1, this.flipAge / 0.35);
      u.u_time.value = this.time;
      u.u_zoom.value = this._zoom;
      u.u_pan.value.set(this._panX, this._panY);
      u.u_gridScale.value = this.userParams.gridScale;
      u.u_lineWidth.value = this.userParams.lineWidth;
      u.u_layers.value = this.userParams.layers;
      u.u_glowIntensity.value = this.userParams.glowIntensity;
      u.u_colorCycle.value = this.userParams.colorCycle;
      u.u_bass.value = this.smoothers.bass.value;
      u.u_mid.value = this.smoothers.mid.value;
      u.u_high.value = this.smoothers.high.value;
      u.u_rms.value = this.smoothers.rms.value;
      u.u_spectralCentroid.value = this.smoothers.spectralCentroid.value;
      u.u_beatPulse.value = this.smoothers.beatPulse.value;
      u.u_bassToFlip.value = this.userParams.bassToFlip;
      u.u_midToWidth.value = this.userParams.midToWidth;
      u.u_highToLayers.value = this.userParams.highToLayers;
      u.u_rmsToGlow.value = this.userParams.rmsToGlow;
    }
    if (this.material)
      this.material.uniforms.u_colorCyclePhase.value = this.phases.advance(
        'u_colorCyclePhase',
        this.material.uniforms.u_colorCycle.value,
        this.deltaSeconds,
      );
  }

  setResolution(width: number, height: number): void {
    if (this.material)
      this.material.uniforms.u_resolution.value.set(width, height);
  }

  setUserParam(key: string, value: number): void {
    if (key in this.userParams) this.userParams[key] = value;
  }

  getViewState(): Record<string, number> {
    return { zoom: this._zoom, panX: this._panX, panY: this._panY };
  }

  setViewState(partial: Record<string, number>): void {
    if ('zoom' in partial)
      this._zoom = Math.max(0.3, Math.min(5.0, partial.zoom));
    if ('panX' in partial)
      this._panX = Math.max(-5.0, Math.min(5.0, partial.panX));
    if ('panY' in partial)
      this._panY = Math.max(-5.0, Math.min(5.0, partial.panY));
  }

  dispose(): void {
    this.unsub();
    this.material?.dispose();
    this.mesh?.geometry.dispose();
  }
}

registerVisualizer({
  metadata: truchetMetadata,
  create: (bus) => new TruchetVisualizer(bus),
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
  #define MAX_LAYERS 4

  uniform float u_flipPrevious;uniform float u_flipTarget;uniform float u_flipMix;
  uniform float u_time;
  uniform vec2 u_resolution;
  uniform float u_zoom;
  uniform vec2 u_pan;
  uniform float u_gridScale;
  uniform float u_lineWidth;
  uniform float u_layers;
  uniform float u_glowIntensity;
  uniform float u_colorCycle;
  uniform float u_colorCyclePhase;
  uniform float u_bass;
  uniform float u_mid;
  uniform float u_high;
  uniform float u_rms;
  uniform float u_spectralCentroid;
  uniform float u_beatPulse;
  uniform float u_bassToFlip;
  uniform float u_midToWidth;
  uniform float u_highToLayers;
  uniform float u_rmsToGlow;

  varying vec2 vUv;

  // Cell hash for tile orientation
  float hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
  }

  // Truchet arc distance for a single cell
  float truchetArc(vec2 uv, vec2 cell, float flipThreshold) {
    vec2 local = fract(uv);
    float h = hash(cell);

    // Flip tile orientation based on hash vs threshold
    if (h > flipThreshold) {
      local = vec2(1.0 - local.x, local.y);
    }

    // Two quarter-circle arcs
    float d1 = abs(length(local) - 0.5);
    float d2 = abs(length(local - 1.0) - 0.5);

    return min(d1, d2);
  }

  // Single truchet layer
  vec2 truchetLayer(vec2 uv, float scale, float flipThreshold, float lineW) {
    vec2 suv = uv * scale;
    vec2 cell = floor(suv);
    float d = truchetArc(suv, cell, flipThreshold);

    // Sharp line
    float line = 1.0-smoothstep(lineW-fwidth(d),lineW+fwidth(d),d);

    // Soft glow around the line
    float glow = exp(-d * d * 80.0);

    return vec2(line, glow);
  }

  #include <cyber_hsv2rgb>

  void main() {
    vec2 uv = (gl_FragCoord.xy - 0.5 * u_resolution) / min(u_resolution.x, u_resolution.y);
    uv = uv / u_zoom + u_pan;

    int numLayers = int(clamp(u_layers, 1.0, float(MAX_LAYERS)));

    // Bass modulates flip threshold (rewires tile connections)
    float flipBase = u_flipTarget;

    // Mids modulate line width
    float lineW = u_lineWidth + u_mid * 0.04 * u_midToWidth;

    // Accumulate layers
    vec3 color = vec3(0.0);
    float totalLine = 0.0;
    float totalGlow = 0.0;

    float scale = u_gridScale;
    float weight = 1.0;

    for (int i = 0; i < MAX_LAYERS; i++) {
      if (i >= numLayers) break;

      // Each layer slightly different flip threshold for variety
      float layerFlip = flipBase + float(i) * 0.12;

      // Time-varying flip for subtle animation
      float animFlip = layerFlip;

      vec2 result = mix(truchetLayer(uv,scale,u_flipPrevious+float(i)*.12,lineW*weight),truchetLayer(uv,scale,animFlip,lineW*weight),smoothstep(0.,1.,u_flipMix));

      // Color per layer — hue shifts with layer index and position
      vec2 suv = uv * scale;
      vec2 cell = floor(suv);
      float cellHash = hash(cell + float(i) * 100.0);

      float hue = fract(
        cellHash * 0.5
        + u_colorCyclePhase * 0.05
        + u_spectralCentroid * 0.3
        + float(i) * 0.25
      );

      float sat = 0.6 + 0.3 * (1.0 - float(i) / float(MAX_LAYERS));
      float val = weight * (0.7 + u_rms * 0.4);

      vec3 layerColor = hsv2rgb(vec3(hue, sat, val));

      // Higher-frequency treble reveals more fine layers
      float layerVisibility = float(i) <= 0.0 ? 1.0 :
        smoothstep(0.0, 0.5, u_high * u_highToLayers - float(i - 1) * 0.3);
      color += layerColor * result.x * weight * layerVisibility;
      totalGlow += result.y * weight * layerVisibility;

      scale *= 2.0;
      weight *= 0.5;
    }

    // Apply glow
    float glowAmount = u_glowIntensity * (0.5 + u_rms * 0.5 * u_rmsToGlow);
    vec3 glowColor = mix(vec3(0.2, 0.4, 0.8), vec3(0.8, 0.3, 0.5), u_spectralCentroid);
    color += glowColor * totalGlow * glowAmount * 0.3;

    // Beat flash
    color += vec3(0.1, 0.08, 0.12) * u_beatPulse * 0.25;

    // Background — very dark with subtle blue
    color = max(color, vec3(0.008, 0.01, 0.02));

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
