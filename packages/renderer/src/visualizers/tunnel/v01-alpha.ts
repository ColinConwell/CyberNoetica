import * as THREE from 'three';
import { MessageBus } from '@cybernoetica/core';
import type { AudioFeatures, BusMessage, Unsubscribe } from '@cybernoetica/core';
import { EMASmoothing } from '../../smoothing.js';
import type { Visualizer, VisualizerMetadata } from '../types.js';
import { registerVisualizer } from '../registry.js';

/**
 * Tunnel visualizer -- infinite warp tunnel with neon geometry.
 *
 * Raymarched infinite tunnel using a polygonal cross-section SDF.
 * The camera flies forward through the tunnel while it twists along
 * its length. Neon grid lines (rings + longitudinal lines) glow on
 * the tunnel walls with cycling synthwave colors.
 *
 * Audio reactivity: bass warps walls, mids increase twist, highs
 * brighten neon edges, RMS drives flight speed, beats trigger
 * radial flash pulses. Chromatic aberration on edges for extra style.
 */

const tunnelMetadata: VisualizerMetadata = {
  type: 'tunnel',
  label: 'Tunnel',
  description: 'Infinite warp tunnel with neon geometry',
  usesPerspective: false,
  params: [
    // Appearance
    { key: 'segments', label: 'Segments', min: 3, max: 12, step: 1, initial: 6, category: 'appearance', description: 'Tunnel cross-section polygon sides' },
    { key: 'flySpeed', label: 'Fly Speed', min: 0.1, max: 3.0, step: 0.1, initial: 1.0, category: 'appearance', description: 'Forward travel speed' },
    { key: 'twist', label: 'Twist', min: 0.0, max: 2.0, step: 0.05, initial: 0.5, category: 'appearance', description: 'Tunnel twist amount' },
    { key: 'neonIntensity', label: 'Neon Intensity', min: 0.2, max: 2.0, step: 0.1, initial: 1.0, category: 'appearance', description: 'Brightness of neon edges' },
    { key: 'colorCycle', label: 'Color Cycle', min: 0.0, max: 1.0, step: 0.01, initial: 0.3, category: 'appearance', description: 'Speed of color cycling' },
    // Audio mapping
    { key: 'bassToWarp', label: 'Bass -> Warp', min: 0.0, max: 2.0, step: 0.1, initial: 1.0, category: 'audio-mapping', description: 'Bass warps tunnel walls' },
    { key: 'midToTwist', label: 'Mid -> Twist', min: 0.0, max: 2.0, step: 0.1, initial: 1.0, category: 'audio-mapping', description: 'Mids increase twist' },
    { key: 'highToGlow', label: 'High -> Glow', min: 0.0, max: 2.0, step: 0.1, initial: 1.0, category: 'audio-mapping', description: 'Highs brighten neon' },
    { key: 'rmsToSpeed', label: 'RMS -> Speed', min: 0.0, max: 2.0, step: 0.1, initial: 1.0, category: 'audio-mapping', description: 'Volume drives fly speed' },
    { key: 'beatToFlash', label: 'Beat -> Flash', min: 0.0, max: 2.0, step: 0.1, initial: 1.0, category: 'audio-mapping', description: 'Beats trigger tunnel flash' },
  ],
  viewport: { pan: true, zoom: true, orbit: false },
  viewStateFields: [
    { key: 'centerX', label: 'Center X', min: -3, max: 3, step: 0.05 },
    { key: 'centerY', label: 'Center Y', min: -3, max: 3, step: 0.05 },
    { key: 'zoom', label: 'Zoom', min: 0.3, max: 4.0, step: 0.05 },
  ],
};

export class TunnelVisualizer implements Visualizer {
  readonly metadata = tunnelMetadata;

  private unsub: Unsubscribe;
  private latestFeatures: AudioFeatures | null = null;
  private time = 0;

  private userParams: Record<string, number> = {
    segments: 6,
    flySpeed: 1.0,
    twist: 0.5,
    neonIntensity: 1.0,
    colorCycle: 0.3,
    bassToWarp: 1.0,
    midToTwist: 1.0,
    highToGlow: 1.0,
    rmsToSpeed: 1.0,
    beatToFlash: 1.0,
  };

  private _centerX = 0;
  private _centerY = 0;
  private _zoom = 1.0;
  private viewOverrides: Record<string, boolean> = {};

  private smoothers = {
    bass: new EMASmoothing(0.12),
    mid: new EMASmoothing(0.18),
    high: new EMASmoothing(0.25),
    rms: new EMASmoothing(0.15),
    spectralCentroid: new EMASmoothing(0.08),
    beatPulse: new EMASmoothing(0.4),
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
        u_center: { value: new THREE.Vector2(0, 0) },
        u_segments: { value: 6.0 },
        u_flySpeed: { value: 1.0 },
        u_twist: { value: 0.5 },
        u_neonIntensity: { value: 1.0 },
        u_colorCycle: { value: 0.3 },
        u_bass: { value: 0.0 },
        u_mid: { value: 0.0 },
        u_high: { value: 0.0 },
        u_rms: { value: 0.1 },
        u_beatPulse: { value: 0.0 },
        u_warpStrength: { value: 0.0 },
        u_twistAmount: { value: 0.5 },
        u_glowBoost: { value: 0.0 },
        u_speedMult: { value: 1.0 },
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

    // Effective speed modulated by RMS
    const speedMult = 0.7 + this.smoothers.rms.value * 0.6 * this.userParams.rmsToSpeed;

    // Warp strength from bass
    const warpStrength = this.smoothers.bass.value * 0.4 * this.userParams.bassToWarp;

    // Twist amount from base + mids
    const twistAmount = this.userParams.twist
      + this.smoothers.mid.value * 0.5 * this.userParams.midToTwist;

    // Glow boost from highs
    const glowBoost = this.smoothers.high.value * 0.8 * this.userParams.highToGlow;

    if (this.material) {
      const u = this.material.uniforms;
      u.u_time.value = this.time;
      u.u_zoom.value = this._zoom;
      u.u_center.value.set(this._centerX, this._centerY);
      u.u_segments.value = this.userParams.segments;
      u.u_flySpeed.value = this.userParams.flySpeed;
      u.u_twist.value = this.userParams.twist;
      u.u_neonIntensity.value = this.userParams.neonIntensity;
      u.u_colorCycle.value = this.userParams.colorCycle;
      u.u_bass.value = this.smoothers.bass.value;
      u.u_mid.value = this.smoothers.mid.value;
      u.u_high.value = this.smoothers.high.value;
      u.u_rms.value = this.smoothers.rms.value;
      u.u_beatPulse.value = this.smoothers.beatPulse.value * this.userParams.beatToFlash;
      u.u_warpStrength.value = warpStrength;
      u.u_twistAmount.value = twistAmount;
      u.u_glowBoost.value = glowBoost;
      u.u_speedMult.value = speedMult;
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
      this._centerX = Math.max(-3, Math.min(3, partial.centerX));
      this.viewOverrides.pan = true;
    }
    if ('centerY' in partial) {
      this._centerY = Math.max(-3, Math.min(3, partial.centerY));
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
  metadata: tunnelMetadata,
  create: (bus) => new TunnelVisualizer(bus),
});

// ── Shaders ────────────────────────────────────────────

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
  #define MAX_STEPS 80
  #define MAX_DIST 40.0
  #define SURF_DIST 0.002

  uniform float u_time;
  uniform vec2 u_resolution;
  uniform float u_zoom;
  uniform vec2 u_center;
  uniform float u_segments;
  uniform float u_flySpeed;
  uniform float u_twist;
  uniform float u_neonIntensity;
  uniform float u_colorCycle;
  uniform float u_bass;
  uniform float u_mid;
  uniform float u_high;
  uniform float u_rms;
  uniform float u_beatPulse;
  uniform float u_warpStrength;
  uniform float u_twistAmount;
  uniform float u_glowBoost;
  uniform float u_speedMult;

  varying vec2 vUv;

  // Rotate 2D point
  vec2 rot2d(vec2 p, float a) {
    float c = cos(a);
    float s = sin(a);
    return vec2(p.x * c - p.y * s, p.x * s + p.y * c);
  }

  // Synthwave neon palette
  vec3 neonPalette(float t) {
    vec3 a = vec3(0.5, 0.5, 0.5);
    vec3 b = vec3(0.5, 0.5, 0.5);
    vec3 c = vec3(1.0, 1.0, 1.0);
    vec3 d = vec3(0.0, 0.33, 0.67);
    return a + b * cos(TAU * (c * t + d));
  }

  // Hot neon color: magenta -> cyan -> blue -> pink cycle
  vec3 synthColor(float t) {
    vec3 col = vec3(0.0);
    col += 0.5 + 0.5 * cos(TAU * t + vec3(0.0, 0.8, 1.6));
    // Push toward neon: boost saturation
    float mx = max(col.r, max(col.g, col.b));
    float mn = min(col.r, min(col.g, col.b));
    float sat = (mx - mn) / (mx + 0.001);
    col = mix(vec3(mx), col, 0.7 + sat * 0.3);
    return col;
  }

  // Polygon SDF in 2D -- distance from point to regular polygon boundary
  float sdPolygon(vec2 p, float r, float n) {
    float an = PI / n;
    float he = r * cos(an);
    // Sector repetition
    float a = atan(p.x, p.y);
    float sector = floor(a / (2.0 * an) + 0.5);
    a = a - 2.0 * an * sector;
    vec2 q = vec2(length(p) * cos(a), length(p) * abs(sin(a)));
    // Distance to edge
    return q.x - he;
  }

  // Tunnel SDF: inside-out polygon tube
  float tunnelSDF(vec3 p, float n) {
    float tunnelRadius = 1.2;

    // Apply twist along z
    float twistAngle = p.z * u_twistAmount * 0.3;
    vec2 tp = rot2d(p.xy, twistAngle);

    // Bass warp: sinusoidal displacement of walls
    float warp = u_warpStrength;
    tunnelRadius += sin(p.z * 3.0 + u_time * 2.0) * warp * 0.3;
    tunnelRadius += sin(p.z * 1.5 - u_time * 1.3) * warp * 0.2;

    // Distance to polygon wall (negative inside, positive outside)
    float d = -sdPolygon(tp, tunnelRadius, n);
    return d;
  }

  // Raymarching
  float raymarch(vec3 ro, vec3 rd, float segments) {
    float t = 0.0;
    for (int i = 0; i < MAX_STEPS; i++) {
      vec3 p = ro + rd * t;
      float d = tunnelSDF(p, segments);
      if (d < SURF_DIST) return t;
      if (t > MAX_DIST) break;
      t += d * 0.8; // Slightly conservative step for stability
    }
    return -1.0;
  }

  // Grid line intensity on tunnel walls
  float gridLines(vec3 p, float segments) {
    float twistAngle = p.z * u_twistAmount * 0.3;
    vec2 tp = rot2d(p.xy, twistAngle);

    // Ring lines (perpendicular to tunnel axis)
    float ringSpacing = 0.8;
    float ringLine = abs(fract(p.z / ringSpacing) - 0.5) * 2.0;
    ringLine = 1.0 - smoothstep(0.0, 0.06, ringLine);

    // Longitudinal lines (along the tunnel)
    float angle = atan(tp.y, tp.x);
    float longiCount = segments * 2.0;
    float longiLine = abs(fract(angle / TAU * longiCount) - 0.5) * 2.0;
    longiLine = 1.0 - smoothstep(0.0, 0.08, longiLine);

    return max(ringLine, longiLine);
  }

  // Estimate surface normal via central differences
  vec3 getNormal(vec3 p, float segments) {
    vec2 e = vec2(0.005, 0.0);
    return normalize(vec3(
      tunnelSDF(p + e.xyy, segments) - tunnelSDF(p - e.xyy, segments),
      tunnelSDF(p + e.yxy, segments) - tunnelSDF(p - e.yxy, segments),
      tunnelSDF(p + e.yyx, segments) - tunnelSDF(p - e.yyx, segments)
    ));
  }

  void main() {
    vec2 uv = (gl_FragCoord.xy - 0.5 * u_resolution) / min(u_resolution.x, u_resolution.y);
    uv = uv / u_zoom + u_center;

    float flyTime = u_time * u_flySpeed * u_speedMult;

    // Ray setup -- camera flies forward along z
    vec3 ro = vec3(0.0, 0.0, flyTime);
    vec3 rd = normalize(vec3(uv, 1.5)); // FOV via z-component

    // Slight camera sway for organic feel
    float swayX = sin(flyTime * 0.3) * 0.05;
    float swayY = cos(flyTime * 0.4) * 0.04;
    ro.xy += vec2(swayX, swayY);

    float segments = floor(u_segments);

    // Chromatic aberration: offset R and B channels slightly
    float chromaticOff = 0.003 + u_beatPulse * 0.008;
    vec3 rdR = normalize(vec3(uv + vec2(chromaticOff, 0.0), 1.5));
    vec3 rdB = normalize(vec3(uv - vec2(chromaticOff, 0.0), 1.5));

    // Raymarch for each channel
    float tG = raymarch(ro, rd, segments);
    float tR = raymarch(ro, rdR, segments);
    float tB = raymarch(ro, rdB, segments);

    vec3 color = vec3(0.0);

    // Process green/main channel (also used for shared calculations)
    if (tG > 0.0) {
      vec3 hitG = ro + rd * tG;

      // Grid lines for neon effect
      float grid = gridLines(hitG, segments);

      // Distance-based fog
      float fog = exp(-tG * 0.08);

      // Color cycling based on depth and time
      float colorT = hitG.z * 0.1 + u_time * u_colorCycle;

      // Neon color
      vec3 neon = synthColor(colorT);
      neon *= u_neonIntensity + u_glowBoost;

      // Wall base color: very dark with subtle depth variation
      vec3 wallColor = vec3(0.01, 0.005, 0.02) + neon * 0.02;

      // Combine wall and grid
      vec3 surfColor = mix(wallColor, neon, grid);

      // Add glow around grid lines (broader, softer)
      float twistAngle = hitG.z * u_twistAmount * 0.3;
      vec2 tpG = rot2d(hitG.xy, twistAngle);
      float ringGlow = abs(fract(hitG.z / 0.8) - 0.5) * 2.0;
      ringGlow = 1.0 - smoothstep(0.0, 0.2, ringGlow);
      surfColor += neon * ringGlow * 0.15 * (u_neonIntensity + u_glowBoost);

      // Distance fade
      surfColor *= fog;

      // Beat flash: radial pulse from center
      float flashDist = length(uv);
      float flashWave = 1.0 - smoothstep(0.0, 0.8 + u_beatPulse * 2.0, flashDist);
      surfColor += neon * flashWave * u_beatPulse * 0.6;

      color.g = surfColor.g;

      // Process R channel
      if (tR > 0.0) {
        vec3 hitR = ro + rdR * tR;
        float gridR = gridLines(hitR, segments);
        float fogR = exp(-tR * 0.08);
        float colorTR = hitR.z * 0.1 + u_time * u_colorCycle;
        vec3 neonR = synthColor(colorTR) * (u_neonIntensity + u_glowBoost);
        vec3 wallR = vec3(0.01, 0.005, 0.02) + neonR * 0.02;
        vec3 surfR = mix(wallR, neonR, gridR);
        float ringGlowR = abs(fract(hitR.z / 0.8) - 0.5) * 2.0;
        ringGlowR = 1.0 - smoothstep(0.0, 0.2, ringGlowR);
        surfR += neonR * ringGlowR * 0.15 * (u_neonIntensity + u_glowBoost);
        surfR *= fogR;
        surfR += neonR * flashWave * u_beatPulse * 0.6;
        color.r = surfR.r;
      }

      // Process B channel
      if (tB > 0.0) {
        vec3 hitB = ro + rdB * tB;
        float gridB = gridLines(hitB, segments);
        float fogB = exp(-tB * 0.08);
        float colorTB = hitB.z * 0.1 + u_time * u_colorCycle;
        vec3 neonB = synthColor(colorTB) * (u_neonIntensity + u_glowBoost);
        vec3 wallB = vec3(0.01, 0.005, 0.02) + neonB * 0.02;
        vec3 surfB = mix(wallB, neonB, gridB);
        float ringGlowB = abs(fract(hitB.z / 0.8) - 0.5) * 2.0;
        ringGlowB = 1.0 - smoothstep(0.0, 0.2, ringGlowB);
        surfB += neonB * ringGlowB * 0.15 * (u_neonIntensity + u_glowBoost);
        surfB *= fogB;
        surfB += neonB * flashWave * u_beatPulse * 0.6;
        color.b = surfB.b;
      }
    }

    // Subtle scanlines for retro feel
    float scanline = 0.95 + 0.05 * sin(gl_FragCoord.y * 2.0);
    color *= scanline;

    // Vignette
    float aspect = u_resolution.x / u_resolution.y;
    vec2 screenUv = gl_FragCoord.xy / u_resolution;
    float vignette = 1.0 - 0.4 * length((screenUv - 0.5) * vec2(aspect, 1.0));
    color *= vignette;

    // Tone mapping -- allow slight overbright for bloom feel
    color = color / (0.8 + color);

    gl_FragColor = vec4(color, 1.0);
  }
`;
