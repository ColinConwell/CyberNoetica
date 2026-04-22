import * as THREE from 'three';
import { MessageBus } from '@cybernoetica/core';
import type { AudioFeatures, BusMessage, Unsubscribe } from '@cybernoetica/core';
import { EMASmoothing } from '../../smoothing.js';
import type { Visualizer, VisualizerMetadata } from '../types.js';
import { registerVisualizer } from '../registry.js';

/**
 * Superformula visualizer -- organic morphing geometry.
 *
 * Renders Johan Gielis's superformula, a generalization of the superellipse
 * that produces an extraordinary range of shapes from a single equation:
 * r(theta) = ( |cos(m*theta/4)/a|^n2 + |sin(m*theta/4)/b|^n3 )^(-1/n1)
 *
 * Six parameters morph continuously between circles, stars, flowers,
 * polygons, and organic blobs. Two superformulas are blended for
 * richer structure.
 *
 * Spectral centroid drives symmetry order (m), RMS controls angularity (n1),
 * bass/high independently drive n2/n3 for asymmetric morphing, and beats
 * snap m to integer values for crisp shape transitions.
 */

const superformulaMetadata: VisualizerMetadata = {
  type: 'superformula',
  label: 'Superformula',
  description: 'Organic morphing Gielis shapes',
  usesPerspective: false,
  params: [
    // Appearance
    { key: 'symmetry', label: 'Symmetry (m)', min: 1, max: 12, step: 0.5, initial: 5, category: 'appearance' },
    { key: 'shapeN1', label: 'Shape n1', min: 0.1, max: 10.0, step: 0.1, initial: 1.0, category: 'appearance' },
    { key: 'shapeN2', label: 'Shape n2', min: 0.1, max: 10.0, step: 0.1, initial: 1.0, category: 'appearance' },
    { key: 'shapeN3', label: 'Shape n3', min: 0.1, max: 10.0, step: 0.1, initial: 1.0, category: 'appearance' },
    { key: 'lineGlow', label: 'Line Glow', min: 0.5, max: 4.0, step: 0.25, initial: 2.0, category: 'appearance' },
    { key: 'layerCount', label: 'Layers', min: 1, max: 5, step: 1, initial: 3, category: 'appearance' },
    // Audio mapping
    { key: 'spectralToM', label: 'Spectral -> Symmetry', min: 0.0, max: 2.0, step: 0.1, initial: 1.0, category: 'audio-mapping', description: 'How strongly spectral centroid shifts symmetry order' },
    { key: 'rmsToN1', label: 'RMS -> Shape', min: 0.0, max: 2.0, step: 0.1, initial: 1.0, category: 'audio-mapping', description: 'How strongly volume affects overall angularity' },
    { key: 'bassToN2', label: 'Bass -> n2', min: 0.0, max: 2.0, step: 0.1, initial: 1.0, category: 'audio-mapping', description: 'How strongly bass drives n2 parameter' },
    { key: 'highToN3', label: 'High -> n3', min: 0.0, max: 2.0, step: 0.1, initial: 1.0, category: 'audio-mapping', description: 'How strongly highs drive n3 parameter' },
  ],
  viewport: { pan: false, zoom: true, orbit: false },
  viewStateFields: [
    { key: 'zoom', label: 'Zoom', min: 0.3, max: 4.0, step: 0.05 },
    { key: 'rotation', label: 'Rotation', min: 0, max: 6.283, step: 0.01 },
  ],
};

export class SuperformulaVisualizer implements Visualizer {
  readonly metadata = superformulaMetadata;

  private unsub: Unsubscribe;
  private latestFeatures: AudioFeatures | null = null;
  private time = 0;
  private autoRotation = 0;

  private userParams: Record<string, number> = {
    symmetry: 5,
    shapeN1: 1.0,
    shapeN2: 1.0,
    shapeN3: 1.0,
    lineGlow: 2.0,
    layerCount: 3,
    spectralToM: 1.0,
    rmsToN1: 1.0,
    bassToN2: 1.0,
    highToN3: 1.0,
  };

  private _zoom = 1.0;
  private _rotation = 0;
  private viewOverrides: Record<string, boolean> = {};

  private smoothers = {
    bass: new EMASmoothing(0.15),
    mid: new EMASmoothing(0.2),
    high: new EMASmoothing(0.25),
    rms: new EMASmoothing(0.2),
    spectralCentroid: new EMASmoothing(0.1),
    beatPulse: new EMASmoothing(0.45),
    mSmooth: new EMASmoothing(0.08),
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
    this.smoothers.mSmooth.reset(5);
  }

  attach(scene: THREE.Scene): void {
    this.material = new THREE.RawShaderMaterial({
      vertexShader: VERTEX_SHADER,
      fragmentShader: FRAGMENT_SHADER,
      uniforms: {
        u_time: { value: 0.0 },
        u_resolution: { value: new THREE.Vector2(1920, 1080) },
        u_zoom: { value: 1.0 },
        u_rotation: { value: 0.0 },
        u_m: { value: 5.0 },
        u_n1: { value: 1.0 },
        u_n2: { value: 1.0 },
        u_n3: { value: 1.0 },
        u_lineGlow: { value: 2.0 },
        u_layers: { value: 3.0 },
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

    // Auto-rotation driven by mids
    const rotSpeed = 0.05 + this.smoothers.mid.value * 0.1;
    this.autoRotation += rotSpeed / 60;

    // Symmetry: base + spectral modulation
    const targetM = this.userParams.symmetry + this.smoothers.spectralCentroid.value * 4 * this.userParams.spectralToM;
    this.smoothers.mSmooth.update(targetM);

    // Shape params driven by audio
    const n1 = this.userParams.shapeN1 + (this.smoothers.rms.value - 0.1) * 3.0 * this.userParams.rmsToN1;
    const n2 = this.userParams.shapeN2 + this.smoothers.bass.value * 3.0 * this.userParams.bassToN2;
    const n3 = this.userParams.shapeN3 + this.smoothers.high.value * 3.0 * this.userParams.highToN3;

    if (this.material) {
      const u = this.material.uniforms;
      u.u_time.value = this.time;
      u.u_zoom.value = this._zoom;
      u.u_rotation.value = this.viewOverrides.rotation ? this._rotation : this.autoRotation;
      u.u_m.value = this.smoothers.mSmooth.value;
      u.u_n1.value = Math.max(0.1, n1);
      u.u_n2.value = Math.max(0.1, n2);
      u.u_n3.value = Math.max(0.1, n3);
      u.u_lineGlow.value = this.userParams.lineGlow;
      u.u_layers.value = this.userParams.layerCount;
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
    if (key in this.userParams) {
      this.userParams[key] = value;
    }
  }

  getViewState(): Record<string, number> {
    return {
      zoom: this._zoom,
      rotation: this.viewOverrides.rotation ? this._rotation : this.autoRotation % (Math.PI * 2),
    };
  }

  setViewState(partial: Record<string, number>): void {
    if ('zoom' in partial) {
      this._zoom = Math.max(0.3, Math.min(4.0, partial.zoom));
      this.viewOverrides.zoom = true;
    }
    if ('rotation' in partial) {
      this._rotation = partial.rotation;
      this.viewOverrides.rotation = true;
    }
  }

  dispose(): void {
    this.unsub();
    this.material?.dispose();
    this.mesh?.geometry.dispose();
  }
}

registerVisualizer({
  metadata: superformulaMetadata,
  create: (bus) => new SuperformulaVisualizer(bus),
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
  uniform float u_rotation;
  uniform float u_m;
  uniform float u_n1;
  uniform float u_n2;
  uniform float u_n3;
  uniform float u_lineGlow;
  uniform float u_layers;
  uniform float u_bass;
  uniform float u_mid;
  uniform float u_high;
  uniform float u_rms;
  uniform float u_spectralCentroid;
  uniform float u_beatPulse;

  varying vec2 vUv;

  // --- HSV to RGB ---
  #include <cyber_hsv2rgb>

  // --- Superformula ---
  // r(theta) = ( |cos(m*theta/4)/a|^n2 + |sin(m*theta/4)/b|^n3 )^(-1/n1)
  float superformula(float theta, float m, float n1, float n2, float n3, float a, float b) {
    float t = m * theta / 4.0;
    float term1 = pow(abs(cos(t) / a), n2);
    float term2 = pow(abs(sin(t) / b), n3);
    return pow(term1 + term2, -1.0 / n1);
  }

  // Signed distance to a superformula curve
  // For each pixel in polar coords, compute the superformula radius at that angle
  // and return the distance between pixel radius and curve radius
  float superformulaSDF(vec2 p, float m, float n1, float n2, float n3, float a, float b) {
    float theta = atan(p.y, p.x);
    float pixR = length(p);

    // Compute the curve radius at this angle
    float curveR = superformula(theta, m, n1, n2, n3, a, b);

    // Basic radial distance (not true SDF but good enough for glow rendering)
    return abs(pixR - curveR);
  }

  // Better SDF: sample nearby angles to find minimum distance to curve
  float superformulaDist(vec2 p, float m, float n1, float n2, float n3, float a, float b) {
    float theta = atan(p.y, p.x);
    float pixR = length(p);
    float minDist = 100.0;

    // Sample the curve at nearby angles
    for (int i = -4; i <= 4; i++) {
      float dTheta = float(i) * 0.02;
      float sampleTheta = theta + dTheta;
      float r = superformula(sampleTheta, m, n1, n2, n3, a, b);
      vec2 curvePoint = vec2(cos(sampleTheta), sin(sampleTheta)) * r;
      float d = length(p - curvePoint);
      minDist = min(minDist, d);
    }

    return minDist;
  }

  void main() {
    vec2 uv = (gl_FragCoord.xy - 0.5 * u_resolution) / min(u_resolution.x, u_resolution.y);
    uv /= u_zoom;

    // Apply rotation
    float cs = cos(u_rotation);
    float sn = sin(u_rotation);
    uv = mat2(cs, -sn, sn, cs) * uv;

    // Scale to a nice viewing range
    uv *= 2.5;

    vec3 color = vec3(0.0);
    float totalGlow = 0.0;

    // Render multiple layers with different parameters
    int layers = int(u_layers);
    for (int layer = 0; layer < 5; layer++) {
      if (layer >= layers) break;

      float layerF = float(layer);
      float layerPhase = layerF * 0.3;

      // Per-layer parameter variation
      float lm = u_m + sin(u_time * 0.3 + layerPhase) * 0.5;
      float ln1 = u_n1 + layerF * 0.3;
      float ln2 = u_n2 + sin(u_time * 0.2 + layerPhase * 2.0) * 0.3;
      float ln3 = u_n3 + cos(u_time * 0.25 + layerPhase * 3.0) * 0.3;

      // Per-layer scale and rotation
      float layerScale = 1.0 - layerF * 0.12;
      float layerRot = layerF * 0.2 + u_time * 0.05 * (1.0 + layerF * 0.3);

      float lcs = cos(layerRot);
      float lsn = sin(layerRot);
      vec2 luv = mat2(lcs, -lsn, lsn, lcs) * uv * layerScale;

      // Compute distance to superformula curve
      float dist = superformulaDist(luv, lm, ln1, ln2, ln3, 1.0, 1.0);

      // Glow rendering
      float glowWidth = 0.03 * u_lineGlow;
      float lineIntensity = exp(-dist * dist / (glowWidth * glowWidth));

      // Sharper core
      float coreIntensity = exp(-dist * dist / (glowWidth * glowWidth * 0.1));

      // Per-layer color
      float hue = fract(layerF * 0.18 + u_time * 0.04 + u_spectralCentroid * 0.2);
      float sat = 0.6 + 0.3 * (1.0 - layerF / 5.0);
      float val = (coreIntensity * 0.7 + lineIntensity * 0.3) * (1.0 - layerF * 0.15);

      // Audio brightness
      val *= 0.5 + u_rms * 0.8;

      vec3 layerColor = hsv2rgb(vec3(hue, sat, val));
      color += layerColor;
      totalGlow += lineIntensity;
    }

    // Beat pulse: bright flash on all curves
    color += vec3(totalGlow * u_beatPulse * 0.3);

    // Interior fill: subtle radial gradient inside the shape
    float theta = atan(uv.y, uv.x);
    float mainR = superformula(theta, u_m, u_n1, u_n2, u_n3, 1.0, 1.0);
    float pixR = length(uv);
    float inside = smoothstep(mainR * 0.98, mainR * 0.9, pixR);
    float fillHue = fract(theta / TAU + u_time * 0.02);
    vec3 fillColor = hsv2rgb(vec3(fillHue, 0.3, inside * 0.06 * (0.5 + u_bass * 0.5)));
    color += fillColor;

    // Background: dark with subtle noise
    vec3 bg = vec3(0.01, 0.008, 0.018);
    color = max(color, bg);

    // Vignette
    float aspect = u_resolution.x / u_resolution.y;
    vec2 screenUv = gl_FragCoord.xy / u_resolution;
    float vignette = 1.0 - 0.35 * length((screenUv - 0.5) * vec2(aspect, 1.0));
    color *= vignette;

    // Tone mapping
    color = color / (0.9 + color);

    gl_FragColor = vec4(color, 1.0);
  }
`;
