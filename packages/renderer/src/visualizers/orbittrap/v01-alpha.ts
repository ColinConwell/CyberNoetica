import * as THREE from 'three';
import { MessageBus } from '@cybernoetica/core';
import type { AudioFeatures, BusMessage, Unsubscribe } from '@cybernoetica/core';
import { EMASmoothing } from '../../smoothing.js';
import type { Visualizer, VisualizerMetadata } from '../types.js';
import { registerVisualizer } from '../registry.js';

/**
 * Orbit Trap Julia — Julia set fractal with geometric orbit trap coloring.
 *
 * Instead of the standard escape-time coloring (which colors by iteration count),
 * this visualizer tracks the minimum distance from each orbit point to geometric
 * "trap" shapes during iteration. This produces dramatically different imagery:
 * intricate filigree, kaleidoscopic tessellations, and organic vein-like patterns
 * that reveal the internal structure of the Julia set.
 *
 * Multiple trap types are blended: cross (two perpendicular lines), ring (circle
 * at a given radius), and point (single attractor). The trap distances are mapped
 * to color channels for rich multi-hued output.
 *
 * The Julia c-parameter animates on a smooth curve through aesthetically
 * interesting regions of parameter space, with audio features modulating
 * the trajectory and trap geometry.
 *
 * Audio mapping:
 *   bass      -> trap radius / size
 *   mid       -> c-parameter animation speed
 *   high      -> trap shape morph (blend between trap types)
 *   rms       -> overall brightness / saturation
 *   beat      -> palette phase shift
 *   centroid  -> color hue rotation
 */

const orbitTrapMetadata: VisualizerMetadata = {
  type: 'orbittrap',
  label: 'Orbit Trap',
  description: 'Julia fractal with geometric orbit trap coloring',
  usesPerspective: false,
  params: [
    { key: 'trapRadius', label: 'Trap Radius', min: 0.05, max: 1.5, step: 0.05, initial: 0.5, category: 'appearance', description: 'Size of the orbit trap' },
    { key: 'cSpeed', label: 'C Speed', min: 0.0, max: 1.0, step: 0.05, initial: 0.3, category: 'appearance', description: 'Julia parameter animation speed' },
    { key: 'maxIterations', label: 'Iterations', min: 32, max: 200, step: 8, initial: 96, category: 'appearance', description: 'Fractal iteration depth' },
    { key: 'colorIntensity', label: 'Color Intensity', min: 0.3, max: 2.0, step: 0.1, initial: 1.2, category: 'appearance', description: 'Color saturation' },
    { key: 'trapMix', label: 'Trap Mix', min: 0.0, max: 1.0, step: 0.05, initial: 0.5, category: 'appearance', description: 'Cross vs ring trap blend' },
    { key: 'paletteRotation', label: 'Palette', min: 0.0, max: 1.0, step: 0.05, initial: 0.0, category: 'appearance', description: 'Color palette rotation' },
    { key: 'bassToTrap', label: 'Bass → Trap', min: 0.0, max: 2.0, step: 0.1, initial: 1.0, category: 'audio-mapping', description: 'Bass modulates trap size' },
    { key: 'midToC', label: 'Mid → C-Param', min: 0.0, max: 2.0, step: 0.1, initial: 1.0, category: 'audio-mapping', description: 'Mids drive c animation' },
    { key: 'highToMorph', label: 'High → Morph', min: 0.0, max: 2.0, step: 0.1, initial: 0.8, category: 'audio-mapping', description: 'Highs morph trap shape' },
    { key: 'rmsToGlow', label: 'RMS → Glow', min: 0.0, max: 2.0, step: 0.1, initial: 1.0, category: 'audio-mapping', description: 'Volume drives brightness' },
    { key: 'beatToPalette', label: 'Beat → Palette', min: 0.0, max: 2.0, step: 0.1, initial: 1.0, category: 'audio-mapping', description: 'Beats shift palette phase' },
    { key: 'centroidToHue', label: 'Centroid → Hue', min: 0.0, max: 2.0, step: 0.1, initial: 0.8, category: 'audio-mapping', description: 'Spectral centroid rotates hue' },
  ],
  viewport: { pan: true, zoom: true, orbit: false },
  viewStateFields: [
    { key: 'centerReal', label: 'Center Real', min: -3, max: 3, step: 0.01 },
    { key: 'centerImaginary', label: 'Center Imaginary', min: -3, max: 3, step: 0.01 },
    { key: 'zoom', label: 'Zoom', min: 0.3, max: 500.0, step: 0.1 },
  ],
};

export class OrbitTrapVisualizer implements Visualizer {
  readonly metadata = orbitTrapMetadata;

  private unsub: Unsubscribe;
  private latestFeatures: AudioFeatures | null = null;
  private time = 0;
  private palettePhase = 0;

  private userParams: Record<string, number> = {
    trapRadius: 0.5,
    cSpeed: 0.3,
    maxIterations: 96,
    colorIntensity: 1.2,
    trapMix: 0.5,
    paletteRotation: 0.0,
    bassToTrap: 1.0,
    midToC: 1.0,
    highToMorph: 0.8,
    rmsToGlow: 1.0,
    beatToPalette: 1.0,
    centroidToHue: 0.8,
  };

  private _centerReal = 0.0;
  private _centerImag = 0.0;
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
        u_trapRadius: { value: 0.5 },
        u_cReal: { value: -0.4 },
        u_cImag: { value: 0.6 },
        u_maxIter: { value: 96.0 },
        u_colorIntensity: { value: 1.2 },
        u_trapMix: { value: 0.5 },
        u_palettePhase: { value: 0.0 },
        u_bass: { value: 0.0 },
        u_mid: { value: 0.0 },
        u_high: { value: 0.0 },
        u_rms: { value: 0.1 },
        u_spectralCentroid: { value: 0.5 },
        u_beatPulse: { value: 0.0 },
        u_hueShift: { value: 0.0 },
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
      if (f.beatOnset) {
        this.palettePhase += 0.15 * this.userParams.beatToPalette;
      }
    } else {
      this.smoothers.beatPulse.update(0.0);
    }

    const cSpeed = this.userParams.cSpeed
      + this.smoothers.mid.value * 0.15 * this.userParams.midToC;
    const t = this.time * cSpeed;

    // Smooth lemniscate path through interesting Julia c-parameter space
    const cReal = -0.4 + 0.35 * Math.sin(t * 0.7) + 0.1 * Math.cos(t * 1.3);
    const cImag = 0.6 + 0.25 * Math.cos(t * 0.9) + 0.08 * Math.sin(t * 1.7);

    if (this.material) {
      const u = this.material.uniforms;
      const bass = this.smoothers.bass.value;

      u.u_time.value = this.time;
      u.u_center.value.set(this._centerReal, this._centerImag);
      u.u_zoom.value = this._zoom;
      u.u_trapRadius.value = this.userParams.trapRadius
        + bass * 0.2 * this.userParams.bassToTrap;
      u.u_cReal.value = cReal;
      u.u_cImag.value = cImag;
      u.u_maxIter.value = this.userParams.maxIterations;
      u.u_colorIntensity.value = this.userParams.colorIntensity;
      u.u_trapMix.value = this.userParams.trapMix
        + this.smoothers.high.value * 0.3 * this.userParams.highToMorph;
      u.u_palettePhase.value = this.userParams.paletteRotation + this.palettePhase;
      u.u_bass.value = bass;
      u.u_mid.value = this.smoothers.mid.value;
      u.u_high.value = this.smoothers.high.value;
      u.u_rms.value = this.smoothers.rms.value * this.userParams.rmsToGlow;
      u.u_spectralCentroid.value = this.smoothers.spectralCentroid.value;
      u.u_beatPulse.value = this.smoothers.beatPulse.value;
      u.u_hueShift.value = this.smoothers.spectralCentroid.value * 0.3 * this.userParams.centroidToHue;
    }
  }

  setResolution(width: number, height: number): void {
    if (this.material) this.material.uniforms.u_resolution.value.set(width, height);
  }

  setUserParam(key: string, value: number): void {
    if (key in this.userParams) this.userParams[key] = value;
  }

  getViewState(): Record<string, number> {
    return {
      centerReal: this._centerReal,
      centerImaginary: this._centerImag,
      zoom: this._zoom,
    };
  }

  setViewState(partial: Record<string, number>): void {
    if ('centerReal' in partial) {
      this._centerReal = Math.max(-3, Math.min(3, partial.centerReal));
      this.viewOverrides.pan = true;
    }
    if ('centerImaginary' in partial) {
      this._centerImag = Math.max(-3, Math.min(3, partial.centerImaginary));
      this.viewOverrides.pan = true;
    }
    if ('zoom' in partial) {
      this._zoom = Math.max(0.3, Math.min(500.0, partial.zoom));
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
  metadata: orbitTrapMetadata,
  create: (bus) => new OrbitTrapVisualizer(bus),
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
  #define MAX_ITER 200

  uniform float u_time;
  uniform vec2 u_resolution;
  uniform vec2 u_center;
  uniform float u_zoom;
  uniform float u_trapRadius;
  uniform float u_cReal;
  uniform float u_cImag;
  uniform float u_maxIter;
  uniform float u_colorIntensity;
  uniform float u_trapMix;
  uniform float u_palettePhase;
  uniform float u_bass;
  uniform float u_mid;
  uniform float u_high;
  uniform float u_rms;
  uniform float u_spectralCentroid;
  uniform float u_beatPulse;
  uniform float u_hueShift;

  varying vec2 vUv;

  vec3 hsv2rgb(vec3 c) {
    vec4 K = vec4(1.0, 2.0 / 3.0, 1.0 / 3.0, 3.0);
    vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
    return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
  }

  // Cosine palette: attempt a richer color scheme
  vec3 cosPalette(float t, vec3 a, vec3 b, vec3 c, vec3 d) {
    return a + b * cos(TAU * (c * t + d));
  }

  // Orbit trap: distance to cross (two perpendicular lines through origin)
  float trapCross(vec2 z) {
    return min(abs(z.x), abs(z.y));
  }

  // Orbit trap: distance to a ring of given radius
  float trapRing(vec2 z, float r) {
    return abs(length(z) - r);
  }

  // Orbit trap: distance to a point
  float trapPoint(vec2 z, vec2 pt) {
    return length(z - pt);
  }

  void main() {
    vec2 uv = (gl_FragCoord.xy - 0.5 * u_resolution) / min(u_resolution.x, u_resolution.y);
    float scale = 2.5 / u_zoom;
    vec2 z = uv * scale + u_center;

    vec2 c = vec2(u_cReal, u_cImag);

    int maxIter = int(min(u_maxIter, float(MAX_ITER)));

    // Track minimum trap distances across the orbit
    float minCross = 1e10;
    float minRing = 1e10;
    float minPoint = 1e10;

    // Also track the orbit point at minimum trap distance for coloring
    vec2 trapZ = vec2(0.0);
    float trapIter = 0.0;

    float trapR = u_trapRadius;

    bool escaped = false;
    int escapeIter = maxIter;

    for (int i = 0; i < MAX_ITER; i++) {
      if (i >= maxIter) break;

      // z = z² + c
      float zx = z.x * z.x - z.y * z.y + c.x;
      float zy = 2.0 * z.x * z.y + c.y;
      z = vec2(zx, zy);

      if (dot(z, z) > 64.0) {
        escaped = true;
        escapeIter = i;
        break;
      }

      // Evaluate trap distances
      float dc = trapCross(z);
      float dr = trapRing(z, trapR);
      float dp = trapPoint(z, vec2(0.0));

      // Track minimum for each trap
      if (dc < minCross) {
        minCross = dc;
      }
      if (dr < minRing) {
        minRing = dr;
      }
      if (dp < minPoint) {
        minPoint = dp;
        trapZ = z;
        trapIter = float(i);
      }
    }

    // Blend trap types based on trapMix parameter
    float mix1 = clamp(u_trapMix, 0.0, 1.0);
    float combinedTrap = mix(minCross, minRing, mix1);

    // Smooth the trap distance into a 0-1 range
    float trapVal = exp(-combinedTrap * 3.0);
    float pointVal = exp(-minPoint * 2.0);

    // Color channels from different trap distances
    float r_chan = exp(-minCross * 4.0);
    float g_chan = exp(-minRing * 4.0);
    float b_chan = exp(-minPoint * 3.0);

    // Palette phase
    float phase = u_palettePhase + u_hueShift;

    // Rich color composition using cosine palette
    vec3 trapColor = cosPalette(
      trapVal + phase,
      vec3(0.5, 0.5, 0.5),
      vec3(0.5, 0.5, 0.5),
      vec3(1.0, 1.0, 1.0),
      vec3(phase, phase + 0.33, phase + 0.67)
    );

    // Channel-separated coloring for extra richness
    vec3 channelColor = vec3(r_chan, g_chan, b_chan);
    channelColor = mix(channelColor, channelColor.gbr, 0.3); // Cross-mix channels

    // Compose final color
    vec3 color = mix(trapColor, channelColor, 0.4) * u_colorIntensity;

    // Iteration-based luminance modulation
    float iterNorm = trapIter / float(maxIter);
    color *= 0.5 + 0.5 * (1.0 - iterNorm);

    // Point trap creates bright vein-like structures
    color += vec3(0.8, 0.9, 1.0) * pointVal * 0.3;

    // RMS brightness
    color *= 0.5 + u_rms * 0.8;

    // Beat pulse: brief saturation/brightness boost
    color *= 1.0 + u_beatPulse * 0.2;

    // Interior of the set: subtle dark coloring (not pure black)
    if (!escaped) {
      float interiorGlow = trapVal * 0.3;
      vec3 interiorColor = cosPalette(
        combinedTrap * 2.0 + phase,
        vec3(0.1, 0.05, 0.15),
        vec3(0.15, 0.1, 0.2),
        vec3(1.0, 1.0, 1.0),
        vec3(phase + 0.1, phase + 0.4, phase + 0.7)
      );
      color = interiorColor * interiorGlow * u_colorIntensity;
      color *= 0.4 + u_rms * 0.4;
    }

    // Escaped region: blend trap coloring with distance shading
    if (escaped) {
      float smooth_iter = float(escapeIter) - log2(log2(dot(z, z))) + 4.0;
      float edgeGlow = exp(-smooth_iter * 0.05);
      color += vec3(edgeGlow * 0.1);
    }

    // Vignette
    float aspect = u_resolution.x / u_resolution.y;
    vec2 screenUv = gl_FragCoord.xy / u_resolution;
    float vignette = 1.0 - 0.3 * length((screenUv - 0.5) * vec2(aspect, 1.0));
    color *= vignette;

    // Minimum visibility
    color = max(color, vec3(0.005, 0.003, 0.01));

    // Tone mapping
    color = color / (0.9 + color);

    gl_FragColor = vec4(color, 1.0);
  }
`;
