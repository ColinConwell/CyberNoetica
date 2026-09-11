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
 * Aurora Borealis — curtain-like luminous bands modeled after the northern lights.
 *
 * The effect layers multiple sine-displaced noise ridges at different heights,
 * each with its own color and movement. A vertical falloff concentrates the
 * glow in the upper half with soft tendrils reaching downward. The distinctive
 * "curtain fold" appearance comes from domain-warped fbm controlling the
 * horizontal displacement of each luminous band.
 *
 * Audio mapping:
 *   bass      -> curtain amplitude (how far the bands sway)
 *   mid       -> animation speed
 *   high      -> shimmer / fine detail in the folds
 *   rms       -> overall luminosity
 *   beat      -> bright pulse / solar flare
 *   centroid  -> hue rotation (green -> blue -> purple)
 */

const auroraMetadata: VisualizerMetadata = {
  type: 'aurora',
  label: 'Aurora',
  description: 'Northern lights curtain simulation',
  usesPerspective: false,
  params: [
    {
      key: 'curtainAmplitude',
      label: 'Curtain Amplitude',
      min: 0.1,
      max: 2.0,
      step: 0.05,
      initial: 0.8,
      category: 'appearance',
      description: 'How far the aurora bands sway',
    },
    {
      key: 'speed',
      label: 'Speed',
      min: 0.05,
      max: 1.5,
      step: 0.05,
      initial: 0.4,
      category: 'appearance',
      description: 'Animation speed',
    },
    {
      key: 'layers',
      label: 'Layers',
      min: 2.0,
      max: 7.0,
      step: 1.0,
      initial: 5.0,
      category: 'appearance',
      description: 'Number of aurora bands',
    },
    {
      key: 'brightness',
      label: 'Brightness',
      min: 0.3,
      max: 3.0,
      step: 0.1,
      initial: 1.2,
      category: 'appearance',
      description: 'Overall luminosity',
    },
    {
      key: 'foldDetail',
      label: 'Fold Detail',
      min: 0.5,
      max: 3.0,
      step: 0.1,
      initial: 1.5,
      category: 'appearance',
      description: 'Fine detail in curtain folds',
    },
    {
      key: 'verticalSpread',
      label: 'Vertical Spread',
      min: 0.2,
      max: 2.0,
      step: 0.05,
      initial: 0.8,
      category: 'appearance',
      description: 'How far aurora extends vertically',
    },
    {
      key: 'bassToCurtain',
      label: 'Bass → Curtain',
      min: 0.0,
      max: 2.0,
      step: 0.1,
      initial: 1.0,
      category: 'audio-mapping',
      description: 'Bass drives curtain sway',
    },
    {
      key: 'midToSpeed',
      label: 'Mid → Speed',
      min: 0.0,
      max: 2.0,
      step: 0.1,
      initial: 1.0,
      category: 'audio-mapping',
      description: 'Mids drive animation',
    },
    {
      key: 'highToShimmer',
      label: 'High → Shimmer',
      min: 0.0,
      max: 2.0,
      step: 0.1,
      initial: 1.0,
      category: 'audio-mapping',
      description: 'Highs add shimmer detail',
    },
    {
      key: 'rmsToGlow',
      label: 'RMS → Glow',
      min: 0.0,
      max: 2.0,
      step: 0.1,
      initial: 1.0,
      category: 'audio-mapping',
      description: 'Volume drives brightness',
    },
    {
      key: 'beatToFlare',
      label: 'Beat → Flare',
      min: 0.0,
      max: 2.0,
      step: 0.1,
      initial: 1.0,
      category: 'audio-mapping',
      description: 'Beats trigger bright pulse',
    },
    {
      key: 'centroidToHue',
      label: 'Centroid → Hue',
      min: 0.0,
      max: 2.0,
      step: 0.1,
      initial: 0.8,
      category: 'audio-mapping',
      description: 'Spectral centroid shifts hue',
    },
  ],
  viewport: { pan: true, zoom: true, orbit: false },
  viewStateFields: [
    { key: 'centerX', label: 'Center X', min: -5, max: 5, step: 0.05 },
    { key: 'centerY', label: 'Center Y', min: -5, max: 5, step: 0.05 },
    { key: 'zoom', label: 'Zoom', min: 0.2, max: 4.0, step: 0.05 },
  ],
};

export class AuroraVisualizer implements Visualizer {
  private deltaSeconds = 1 / 60;
  private phases = new PhaseClock();
  readonly metadata = auroraMetadata;

  private unsub: Unsubscribe;
  private latestFeatures: AudioFeatures | null = null;
  private time = 0;

  private userParams: Record<string, number> = {
    curtainAmplitude: 0.8,
    speed: 0.4,
    layers: 5.0,
    brightness: 1.2,
    foldDetail: 1.5,
    verticalSpread: 0.8,
    bassToCurtain: 1.0,
    midToSpeed: 1.0,
    highToShimmer: 1.0,
    rmsToGlow: 1.0,
    beatToFlare: 1.0,
    centroidToHue: 0.8,
  };

  private _centerX = 0;
  private _centerY = 0;
  private _zoom = 1.0;

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
        u_speedPhase: { value: 0 },
        u_time: { value: 0.0 },
        u_resolution: { value: new THREE.Vector2(1920, 1080) },
        u_center: { value: new THREE.Vector2(0, 0) },
        u_zoom: { value: 1.0 },
        u_curtainAmplitude: { value: 0.8 },
        u_speed: { value: 0.4 },
        u_layers: { value: 5.0 },
        u_brightness: { value: 1.2 },
        u_foldDetail: { value: 1.5 },
        u_verticalSpread: { value: 0.8 },
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

    if (this.material) {
      const u = this.material.uniforms;
      const bass = this.smoothers.bass.value;
      const mid = this.smoothers.mid.value;
      const high = this.smoothers.high.value;

      u.u_time.value = this.time;
      u.u_center.value.set(this._centerX, this._centerY);
      u.u_zoom.value = this._zoom;
      u.u_curtainAmplitude.value =
        this.userParams.curtainAmplitude +
        bass * 0.5 * this.userParams.bassToCurtain;
      u.u_speed.value =
        this.userParams.speed + mid * 0.3 * this.userParams.midToSpeed;
      u.u_speedPhase.value = this.phases.advance(
        'u_speed',
        u.u_speed.value,
        this.deltaSeconds,
      );
      u.u_layers.value = this.userParams.layers;
      u.u_brightness.value = this.userParams.brightness;
      u.u_foldDetail.value =
        this.userParams.foldDetail + high * 1.0 * this.userParams.highToShimmer;
      u.u_verticalSpread.value = this.userParams.verticalSpread;
      u.u_bass.value = bass;
      u.u_mid.value = mid;
      u.u_high.value = high;
      u.u_rms.value = this.smoothers.rms.value * this.userParams.rmsToGlow;
      u.u_spectralCentroid.value =
        this.smoothers.spectralCentroid.value * this.userParams.centroidToHue;
      u.u_beatPulse.value =
        this.smoothers.beatPulse.value * this.userParams.beatToFlare;
    }
  }

  setResolution(width: number, height: number): void {
    if (this.material)
      this.material.uniforms.u_resolution.value.set(width, height);
  }

  setUserParam(key: string, value: number): void {
    if (key in this.userParams) this.userParams[key] = value;
  }

  getViewState(): Record<string, number> {
    return { centerX: this._centerX, centerY: this._centerY, zoom: this._zoom };
  }

  setViewState(partial: Record<string, number>): void {
    if ('centerX' in partial)
      this._centerX = Math.max(-5, Math.min(5, partial.centerX));
    if ('centerY' in partial)
      this._centerY = Math.max(-5, Math.min(5, partial.centerY));
    if ('zoom' in partial)
      this._zoom = Math.max(0.2, Math.min(4.0, partial.zoom));
  }

  dispose(): void {
    this.unsub();
    this.material?.dispose();
    this.mesh?.geometry.dispose();
  }
}

registerVisualizer({
  metadata: auroraMetadata,
  create: (bus) => new AuroraVisualizer(bus),
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

  uniform float u_speedPhase;
  uniform float u_time;
  uniform vec2 u_resolution;
  uniform vec2 u_center;
  uniform float u_zoom;
  uniform float u_curtainAmplitude;
  uniform float u_speed;
  uniform float u_layers;
  uniform float u_brightness;
  uniform float u_foldDetail;
  uniform float u_verticalSpread;
  uniform float u_bass;
  uniform float u_mid;
  uniform float u_high;
  uniform float u_rms;
  uniform float u_spectralCentroid;
  uniform float u_beatPulse;

  varying vec2 vUv;

  // Hash-based noise
  float hash(vec2 p) {
    p = fract(p * vec2(443.8975, 397.2973));
    p += dot(p, p.yx + 19.19);
    return fract(p.x * p.y);
  }

  float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    float a = hash(i);
    float b = hash(i + vec2(1.0, 0.0));
    float c = hash(i + vec2(0.0, 1.0));
    float d = hash(i + vec2(1.0, 1.0));
    return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
  }

  float fbm(vec2 p, int octaves) {
    float value = 0.0;
    float amplitude = 0.5;
    float frequency = 1.0;
    for (int i = 0; i < 6; i++) {
      if (i >= octaves) break;
      value += amplitude * noise(p * frequency);
      amplitude *= 0.5;
      frequency *= 2.0;
    }
    return value;
  }

  // Aurora band: a luminous ridge at a certain height with curtain-like displacement
  float auroraBand(vec2 uv, float bandY, float t, float fold, float amp) {
    // Domain warp for curtain fold effect
    float warp = fbm(vec2(uv.x * 2.0 + t * 0.3, bandY * 3.0 + t * 0.1), int(fold + 2.0)) * 2.0 - 1.0;
    warp += sin(uv.x * 3.0 + t * 0.7) * 0.3;

    // Displaced y-position for this band
    float displaced = bandY + warp * amp * 0.3;

    // Vertical distance from band center — creates the luminous "sheet"
    float dist = abs(uv.y - displaced);

    // Soft falloff with thin bright core
    float core = exp(-dist * 12.0) * 0.8;
    float glow = exp(-dist * 3.0) * 0.4;

    // Fine shimmer detail
    float shimmer = noise(vec2(uv.x * 20.0 + t, uv.y * 10.0)) * 0.3;
    shimmer *= exp(-dist * 8.0);

    return core + glow + shimmer * u_high;
  }

  vec3 auroraColor(float bandIndex, float total, float cent) {
    // Classic aurora color palette: green -> blue -> purple -> red
    float t = bandIndex / max(total - 1.0, 1.0);
    // Centroid shifts the hue distribution
    t = fract(t + cent * 0.4);

    vec3 green = vec3(0.1, 0.9, 0.3);
    vec3 cyan = vec3(0.1, 0.7, 0.8);
    vec3 blue = vec3(0.2, 0.3, 0.9);
    vec3 purple = vec3(0.6, 0.1, 0.8);
    vec3 red = vec3(0.8, 0.15, 0.2);

    vec3 col;
    if (t < 0.25) col = mix(green, cyan, t / 0.25);
    else if (t < 0.5) col = mix(cyan, blue, (t - 0.25) / 0.25);
    else if (t < 0.75) col = mix(blue, purple, (t - 0.5) / 0.25);
    else col = mix(purple, red, (t - 0.75) / 0.25);

    return col;
  }

  void main() {
    vec2 uv = (gl_FragCoord.xy - 0.5 * u_resolution) / min(u_resolution.x, u_resolution.y);
    float scale = 2.0 / u_zoom;
    uv = uv * scale + u_center;

    float t = u_speedPhase;
    int numLayers = int(u_layers);

    // Dark sky background with subtle gradient
    vec3 skyTop = vec3(0.005, 0.01, 0.04);
    vec3 skyBot = vec3(0.01, 0.005, 0.015);
    vec3 color = mix(skyBot, skyTop, clamp(uv.y * 0.5 + 0.5, 0.0, 1.0));

    // Subtle star field
    float stars = hash(floor(uv * 200.0));
    stars = step(0.997, stars) * stars;
    float twinkle = sin(u_time * 2.0 + stars * 100.0) * 0.5 + 0.5;
    color += vec3(stars * twinkle * 0.5);

    vec2 curtainUv=uv.y<0.0?vec2(uv.x,-uv.y*.6):uv;
    curtainUv.x-=t*.08;
    // Accumulate aurora bands
    float totalIntensity = 0.0;
    vec3 auroraAccum = vec3(0.0);

    for (int i = 0; i < 7; i++) {
      if (i >= numLayers) break;
      float fi = float(i);
      float bandCount = float(numLayers);

      // Distribute bands in the upper portion of the view
      float baseY = 0.1 + fi * u_verticalSpread * 0.25;
      // Slight oscillation in base height
      baseY += sin(t * 0.5 + fi * 1.7) * 0.05;

      float intensity = auroraBand(curtainUv, baseY, t + fi * 0.5, u_foldDetail, u_curtainAmplitude);
      vec3 bandColor = mix(vec3(.12,.9,.35),vec3(.85,.12,.18),smoothstep(.35,1.,curtainUv.y));
      bandColor=mix(bandColor,auroraColor(fi,bandCount,u_spectralCentroid),.25);

      auroraAccum += bandColor * intensity;
      totalIntensity += intensity;
    }

    // Apply brightness and RMS
    float lumMult = u_brightness * (0.4 + u_rms * 1.2);
    auroraAccum *= lumMult;

    // Beat flare: brief brightening across all bands
    auroraAccum += auroraAccum * u_beatPulse * 0.6;
    // Beat also adds a subtle white flash at peak
    float flareWhite = u_beatPulse * 0.1 * totalIntensity;
    auroraAccum += vec3(flareWhite);

    color += auroraAccum*(uv.y<0.0?.15*exp(uv.y*3.0):1.0);

    // Vignette
    float aspect = u_resolution.x / u_resolution.y;
    vec2 screenUv = gl_FragCoord.xy / u_resolution;
    float vignette = 1.0 - 0.4 * length((screenUv - 0.5) * vec2(aspect, 1.0));
    color *= vignette;

    // Tone mapping
    color = color / (0.9 + color);

    gl_FragColor = vec4(color, 1.0);
  }
`;
