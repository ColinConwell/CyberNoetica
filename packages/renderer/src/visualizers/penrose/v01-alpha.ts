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
 * Penrose tiling visualizer -- aperiodic beauty.
 *
 * Draws the five directional grids used in the de Bruijn construction.
 * Their dual would form Penrose rhombs, but this shader renders the multigrid
 * itself. It does not implement the dualization or rhomb matching rules.
 *
 * Audio: bass shifts grid offsets (tiles breathe), spectral centroid drives
 * color cycling, mids control edge glow width, beats trigger symmetry pulses.
 */

const penroseMetadata: VisualizerMetadata = {
  type: 'penrose',
  label: 'Penrose',
  description: 'Aperiodic tiling with 5-fold symmetry',
  usesPerspective: false,
  params: [
    {
      key: 'edgeGlow',
      label: 'Edge Glow',
      min: 0.3,
      max: 3.0,
      step: 0.1,
      initial: 1.2,
      category: 'appearance',
      description: 'Brightness of tile edges',
    },
    {
      key: 'fillOpacity',
      label: 'Fill Opacity',
      min: 0.0,
      max: 1.0,
      step: 0.05,
      initial: 0.3,
      category: 'appearance',
      description: 'Tile interior fill strength',
    },
    {
      key: 'scale',
      label: 'Scale',
      min: 2.0,
      max: 20.0,
      step: 0.5,
      initial: 8.0,
      category: 'appearance',
      description: 'Tiling scale',
    },
    {
      key: 'colorCycle',
      label: 'Color Cycle',
      min: 0.0,
      max: 1.0,
      step: 0.01,
      initial: 0.2,
      category: 'appearance',
      description: 'Speed of palette rotation',
    },
    {
      key: 'animSpeed',
      label: 'Anim Speed',
      min: 0.0,
      max: 1.0,
      step: 0.05,
      initial: 0.2,
      category: 'appearance',
      description: 'Grid drift animation speed',
    },
    {
      key: 'bassToBreath',
      label: 'Bass -> Breath',
      min: 0.0,
      max: 2.0,
      step: 0.1,
      initial: 1.0,
      category: 'audio-mapping',
      description: 'Bass makes tiles breathe',
    },
    {
      key: 'spectralToColor',
      label: 'Spectral -> Color',
      min: 0.0,
      max: 2.0,
      step: 0.1,
      initial: 1.0,
      category: 'audio-mapping',
      description: 'Spectral centroid shifts colors',
    },
    {
      key: 'midToEdge',
      label: 'Mid -> Edge',
      min: 0.0,
      max: 2.0,
      step: 0.1,
      initial: 1.0,
      category: 'audio-mapping',
      description: 'Mids widen edge glow',
    },
    {
      key: 'beatToPulse',
      label: 'Beat -> Pulse',
      min: 0.0,
      max: 2.0,
      step: 0.1,
      initial: 1.0,
      category: 'audio-mapping',
      description: 'Beats flash the pattern',
    },
  ],
  viewport: { pan: true, zoom: true, orbit: false },
  viewStateFields: [
    { key: 'centerX', label: 'Center X', min: -5, max: 5, step: 0.05 },
    { key: 'centerY', label: 'Center Y', min: -5, max: 5, step: 0.05 },
    { key: 'zoom', label: 'Zoom', min: 0.2, max: 4.0, step: 0.05 },
  ],
};

export class PenroseVisualizer implements Visualizer {
  private deltaSeconds = 1 / 60;
  private phases = new PhaseClock();
  readonly metadata = penroseMetadata;

  private unsub: Unsubscribe;
  private latestFeatures: AudioFeatures | null = null;
  private time = 0;

  private userParams: Record<string, number> = {
    edgeGlow: 1.2,
    fillOpacity: 0.3,
    scale: 8.0,
    colorCycle: 0.2,
    animSpeed: 0.2,
    bassToBreath: 1.0,
    spectralToColor: 1.0,
    midToEdge: 1.0,
    beatToPulse: 1.0,
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
        u_colorCyclePhase: { value: 0 },
        u_time: { value: 0.0 },
        u_resolution: { value: new THREE.Vector2(1920, 1080) },
        u_center: { value: new THREE.Vector2(0, 0) },
        u_zoom: { value: 1.0 },
        u_edgeGlow: { value: 1.2 },
        u_fillOpacity: { value: 0.3 },
        u_scale: { value: 8.0 },
        u_colorCycle: { value: 0.2 },
        u_bass: { value: 0.0 },
        u_mid: { value: 0.0 },
        u_high: { value: 0.0 },
        u_rms: { value: 0.1 },
        u_spectralCentroid: { value: 0.5 },
        u_beatPulse: { value: 0.0 },
        u_breathOffset: { value: 0.0 },
        u_edgeWidth: { value: 1.0 },
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

    const breathOffset =
      this.smoothers.bass.value * 0.1 * this.userParams.bassToBreath;
    const edgeWidth =
      1.0 + this.smoothers.mid.value * 0.5 * this.userParams.midToEdge;

    if (this.material) {
      const u = this.material.uniforms;
      u.u_time.value = this.phases.advance(
        'animation',
        this.userParams.animSpeed,
        this.deltaSeconds,
      );
      u.u_center.value.set(this._centerX, this._centerY);
      u.u_zoom.value = this._zoom;
      u.u_edgeGlow.value = this.userParams.edgeGlow;
      u.u_fillOpacity.value = this.userParams.fillOpacity;
      u.u_scale.value = this.userParams.scale;
      u.u_colorCycle.value = this.userParams.colorCycle;
      u.u_bass.value = this.smoothers.bass.value;
      u.u_mid.value = this.smoothers.mid.value;
      u.u_high.value = this.smoothers.high.value;
      u.u_rms.value = this.smoothers.rms.value;
      u.u_spectralCentroid.value =
        this.smoothers.spectralCentroid.value * this.userParams.spectralToColor;
      u.u_beatPulse.value =
        this.smoothers.beatPulse.value * this.userParams.beatToPulse;
      u.u_breathOffset.value = breathOffset;
      u.u_edgeWidth.value = edgeWidth;
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
  metadata: penroseMetadata,
  create: (bus) => new PenroseVisualizer(bus),
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
  #define N_GRIDS 5

  uniform float u_time;
  uniform vec2 u_resolution;
  uniform vec2 u_center;
  uniform float u_zoom;
  uniform float u_edgeGlow;
  uniform float u_fillOpacity;
  uniform float u_scale;
  uniform float u_colorCycle;
  uniform float u_colorCyclePhase;
  uniform float u_bass;
  uniform float u_mid;
  uniform float u_high;
  uniform float u_rms;
  uniform float u_spectralCentroid;
  uniform float u_beatPulse;
  uniform float u_breathOffset;
  uniform float u_edgeWidth;

  varying vec2 vUv;

  // HSV to RGB
  #include <cyber_hsv2rgb>

  // de Bruijn multigrid: 5 sets of parallel lines at 72-degree intervals
  // Each grid family has direction (cos(k*72°), sin(k*72°)) and we measure
  // the signed distance from any point to the nearest line in that family.
  // The cell identity comes from rounding grid coordinates; edges appear
  // where the fractional part is near 0 or 1.

  void main() {
    vec2 uv = (gl_FragCoord.xy - 0.5 * u_resolution) / min(u_resolution.x, u_resolution.y);
    uv = uv / u_zoom + u_center;

    vec2 p = uv * u_scale;

    // Grid directions at 72-degree (TAU/5) intervals
    float minEdgeDist = 1e10;
    float cellId = 0.0;
    vec2 cellCenter = vec2(0.0);
    float edgeAngle = 0.0;

    // Accumulate grid coordinates for cell identification
    float gridSum = 0.0;
    float gridProd = 0.0;

    for (int k = 0; k < N_GRIDS; k++) {
      float angle = float(k) * TAU / float(N_GRIDS);
      vec2 dir = vec2(cos(angle), sin(angle));

      // Grid offset drifts slowly + bass breathing
      float offset = u_breathOffset * float(k + 1) * 0.7
                   + sin(u_time * 0.3 + float(k) * 1.2) * 0.15;

      // Project point onto grid direction
      float proj = dot(p, dir) + offset;

      // Grid coordinate
      float gridCoord = proj;
      float fractPart = fract(gridCoord);

      // Distance to nearest grid line (0 or 1 boundary)
      float edgeDist = min(fractPart, 1.0 - fractPart);

      if (edgeDist < minEdgeDist) {
        minEdgeDist = edgeDist;
        edgeAngle = angle;
      }

      // Cell identity from rounded grid coordinates
      float cellCoord = floor(gridCoord);
      gridSum += cellCoord * (float(k) * 7.0 + 3.0);
      gridProd += cellCoord * sin(float(k) * 2.39996);
    }

    // Cell hash for coloring
    cellId = fract(sin(gridSum * 12.9898 + gridProd * 78.233) * 43758.5453);

    // Second hash for tile type (fat vs thin rhombus approximation)
    float tileType = fract(sin(gridSum * 39.346 + gridProd * 11.135) * 28461.637);

    // Edge rendering
    float edgeThickness = 0.06 * u_edgeWidth;
    float edge = 1.0 - smoothstep(0.0, edgeThickness, minEdgeDist);

    // Thinner inner line for crisp look
    float innerEdge = 1.0 - smoothstep(0.0, edgeThickness * 0.3, minEdgeDist);

    // --- Coloring ---

    // Tile fill color based on cell identity
    float hue = fract(cellId * 0.618033 + u_colorCyclePhase + u_spectralCentroid * 0.4);
    float sat = 0.5 + tileType * 0.3;
    float val = u_fillOpacity * (0.15 + tileType * 0.1);

    vec3 fillColor = hsv2rgb(vec3(hue, sat, val));

    // Edge color: bright neon derived from tile hue but shifted
    float edgeHue = fract(hue + 0.15 + edgeAngle / TAU * 0.3);
    vec3 neonColor = hsv2rgb(vec3(edgeHue, 0.7, 1.0));

    // Broad glow around edges
    float glowDist = 1.0 - smoothstep(0.0, edgeThickness * 3.0, minEdgeDist);
    vec3 glowColor = neonColor * glowDist * 0.15 * u_edgeGlow;

    // Combine
    vec3 color = fillColor;
    color += neonColor * edge * u_edgeGlow * (0.6 + u_rms * 0.4);
    color += vec3(1.0) * innerEdge * 0.3; // white core
    color += glowColor;

    // Beat pulse: flash all edges white
    color += vec3(edge * u_beatPulse * 0.5);

    // High frequency shimmer on edges
    color += neonColor * edge * u_high * 0.3;

    // Tile highlight on strong beats
    float tileFlash = u_beatPulse * step(0.7, cellId) * 0.2;
    color += hsv2rgb(vec3(hue, 0.6, tileFlash));

    // Vignette
    float aspect = u_resolution.x / u_resolution.y;
    vec2 screenUv = gl_FragCoord.xy / u_resolution;
    float vignette = 1.0 - 0.3 * length((screenUv - 0.5) * vec2(aspect, 1.0));
    color *= vignette;

    // Background ambience
    color = max(color, vec3(0.008, 0.005, 0.012));

    // Tone mapping
    color = color / (0.9 + color);

    gl_FragColor = vec4(color, 1.0);
  }
`;
