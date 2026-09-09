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
 * Hyperbolic visualizer -- Poincare disk tessellation.
 *
 * Renders regular hyperbolic tessellations {p,q} inside the Poincare
 * disk model. Uses Mobius transformations (complex arithmetic) to
 * fold screen coordinates into the fundamental domain, then colors
 * based on the number of reflections (Escher-style parity coloring).
 *
 * Bass drives hyperbolic translation (tiles flow from center to edge),
 * mids control rotation, spectral centroid morphs the tessellation
 * parameters, and beats trigger boundary flashes at infinity.
 */

const hyperbolicMetadata: VisualizerMetadata = {
  type: 'hyperbolic',
  label: 'Hyperbolic',
  description: 'Poincar\u00e9 disk tessellation',
  usesPerspective: false,
  params: [
    // Appearance
    {
      key: 'pGon',
      label: 'P-gon Sides',
      min: 3,
      max: 10,
      step: 1,
      initial: 5,
      category: 'appearance',
      description: 'Number of sides per polygon',
    },
    {
      key: 'qMeet',
      label: 'Q Meeting',
      min: 3,
      max: 8,
      step: 1,
      initial: 4,
      category: 'appearance',
      description:
        'Polygons per vertex; increased when needed for a hyperbolic pair',
    },
    {
      key: 'lineThickness',
      label: 'Line Width',
      min: 0.005,
      max: 0.06,
      step: 0.005,
      initial: 0.02,
      category: 'appearance',
    },
    {
      key: 'flowSpeed',
      label: 'Flow Speed',
      min: 0.0,
      max: 0.5,
      step: 0.02,
      initial: 0.08,
      category: 'appearance',
    },
    {
      key: 'rotationSpeed',
      label: 'Rotation',
      min: 0.0,
      max: 0.3,
      step: 0.01,
      initial: 0.05,
      category: 'appearance',
    },
    {
      key: 'colorCycle',
      label: 'Color Cycle',
      min: 0.0,
      max: 1.0,
      step: 0.05,
      initial: 0.15,
      category: 'appearance',
    },
    // Audio mapping
    {
      key: 'bassToFlow',
      label: 'Bass \u2192 Flow',
      min: 0.0,
      max: 2.0,
      step: 0.1,
      initial: 1.0,
      category: 'audio-mapping',
      description: 'Bass drives hyperbolic translation',
    },
    {
      key: 'midToRotation',
      label: 'Mid \u2192 Rotation',
      min: 0.0,
      max: 2.0,
      step: 0.1,
      initial: 1.0,
      category: 'audio-mapping',
      description: 'Mids drive Mobius rotation',
    },
    {
      key: 'rmsToFill',
      label: 'RMS \u2192 Fill',
      min: 0.0,
      max: 2.0,
      step: 0.1,
      initial: 1.0,
      category: 'audio-mapping',
      description: 'Volume controls tile fill opacity',
    },
    {
      key: 'highToEdge',
      label: 'High \u2192 Edge',
      min: 0.0,
      max: 2.0,
      step: 0.1,
      initial: 1.0,
      category: 'audio-mapping',
      description: 'High frequencies light up geodesic edges',
    },
    {
      key: 'beatFlash',
      label: 'Beat \u2192 Flash',
      min: 0.0,
      max: 2.0,
      step: 0.1,
      initial: 1.0,
      category: 'audio-mapping',
      description: 'Beats flash the boundary circle',
    },
  ],
  viewport: { pan: false, zoom: true, orbit: false },
  viewStateFields: [
    {
      key: 'effectiveP',
      label: 'Effective p',
      min: 3,
      max: 12,
      step: 1,
      readOnly: true,
    },
    {
      key: 'effectiveQ',
      label: 'Effective q',
      min: 3,
      max: 12,
      step: 1,
      readOnly: true,
    },
    { key: 'zoom', label: 'Zoom', min: 0.5, max: 3.0, step: 0.05 },
    { key: 'rotation', label: 'Rotation', min: 0, max: 6.283, step: 0.01 },
  ],
};

export class HyperbolicVisualizer implements Visualizer {
  private deltaSeconds = 1 / 60;
  private phases = new PhaseClock();
  readonly metadata = hyperbolicMetadata;

  private unsub: Unsubscribe;
  private latestFeatures: AudioFeatures | null = null;
  private time = 0;
  private autoRotation = 0;
  private flowPhase = 0;

  private userParams: Record<string, number> = {
    pGon: 5,
    qMeet: 4,
    lineThickness: 0.02,
    flowSpeed: 0.08,
    rotationSpeed: 0.05,
    colorCycle: 0.15,
    bassToFlow: 1.0,
    midToRotation: 1.0,
    rmsToFill: 1.0,
    highToEdge: 1.0,
    beatFlash: 1.0,
  };

  private _zoom = 1.0;
  private _rotation = 0;
  private viewOverrides: Record<string, boolean> = {};

  private smoothers = {
    bass: new EMASmoothing(0.12),
    mid: new EMASmoothing(0.18),
    high: new EMASmoothing(0.22),
    rms: new EMASmoothing(0.15),
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
        u_colorCyclePhase: { value: 0 },
        u_time: { value: 0.0 },
        u_resolution: { value: new THREE.Vector2(1920, 1080) },
        u_zoom: { value: 1.0 },
        u_rotation: { value: 0.0 },
        u_p: { value: 5.0 },
        u_q: { value: 4.0 },
        u_lineWidth: { value: 0.02 },
        u_flowPhase: { value: 0.0 },
        u_colorCycle: { value: 0.15 },
        u_bass: { value: 0.0 },
        u_mid: { value: 0.0 },
        u_high: { value: 0.0 },
        u_rms: { value: 0.1 },
        u_spectralCentroid: { value: 0.5 },
        u_beatPulse: { value: 0.0 },
        u_rmsToFill: { value: 1.0 },
        u_highToEdge: { value: 1.0 },
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

    const bass = this.smoothers.bass.value;
    const mid = this.smoothers.mid.value;

    // Flow: hyperbolic translation driven by bass
    const flowSpeed =
      this.userParams.flowSpeed + bass * 0.15 * this.userParams.bassToFlow;
    this.flowPhase += flowSpeed * this.deltaSeconds;

    // Auto rotation driven by mids
    const rotSpeed =
      this.userParams.rotationSpeed + mid * 0.1 * this.userParams.midToRotation;
    this.autoRotation += rotSpeed * this.deltaSeconds;

    if (this.material) {
      const u = this.material.uniforms;
      u.u_time.value = this.time;
      u.u_zoom.value = this._zoom;
      u.u_rotation.value = this.viewOverrides.rotation
        ? this._rotation
        : this.autoRotation;
      u.u_p.value = Math.floor(this.userParams.pGon);
      // Hyperbolic triangles require 1/p + 1/q < 1/2.
      u.u_q.value = Math.max(
        Math.floor(this.userParams.qMeet),
        Math.floor((2 * u.u_p.value) / (u.u_p.value - 2)) + 1,
      );
      u.u_lineWidth.value = this.userParams.lineThickness;
      u.u_flowPhase.value = this.flowPhase;
      u.u_colorCycle.value = this.userParams.colorCycle;
      u.u_bass.value = bass;
      u.u_mid.value = mid;
      u.u_high.value = this.smoothers.high.value;
      u.u_rms.value = this.smoothers.rms.value;
      u.u_spectralCentroid.value = this.smoothers.spectralCentroid.value;
      u.u_beatPulse.value =
        this.smoothers.beatPulse.value * this.userParams.beatFlash;
      u.u_rmsToFill.value = this.userParams.rmsToFill;
      u.u_highToEdge.value = this.userParams.highToEdge;
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
      effectiveP: Math.floor(this.userParams.pGon),
      effectiveQ: Math.max(
        Math.floor(this.userParams.qMeet),
        Math.floor(
          (2 * Math.floor(this.userParams.pGon)) /
            (Math.floor(this.userParams.pGon) - 2),
        ) + 1,
      ),
      zoom: this._zoom,
      rotation: this.viewOverrides.rotation
        ? this._rotation
        : this.autoRotation % (Math.PI * 2),
    };
  }

  setViewState(partial: Record<string, number>): void {
    if ('zoom' in partial) {
      this._zoom = Math.max(0.5, Math.min(3.0, partial.zoom));
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
  metadata: hyperbolicMetadata,
  create: (bus) => new HyperbolicVisualizer(bus),
});

// ── Shaders ────────────────────────────────────────────

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
  #define MAX_REFLECTIONS 40

  uniform float u_time;
  uniform vec2 u_resolution;
  uniform float u_zoom;
  uniform float u_rotation;
  uniform float u_p;
  uniform float u_q;
  uniform float u_lineWidth;
  uniform float u_flowPhase;
  uniform float u_colorCycle;
  uniform float u_colorCyclePhase;
  uniform float u_bass;
  uniform float u_mid;
  uniform float u_high;
  uniform float u_rms;
  uniform float u_spectralCentroid;
  uniform float u_beatPulse;
  uniform float u_rmsToFill;
  uniform float u_highToEdge;

  varying vec2 vUv;

  // ── Complex number operations ──

  vec2 cmul(vec2 a, vec2 b) {
    return vec2(a.x * b.x - a.y * b.y, a.x * b.y + a.y * b.x);
  }

  vec2 cdiv(vec2 a, vec2 b) {
    float d = dot(b, b);
    return vec2(a.x * b.x + a.y * b.y, a.y * b.x - a.x * b.y) / d;
  }

  vec2 cconj(vec2 z) {
    return vec2(z.x, -z.y);
  }

  // Mobius transformation: (a*z + b) / (c*z + d)
  vec2 mobius(vec2 z, vec2 a, vec2 b, vec2 c, vec2 d) {
    return cdiv(cmul(a, z) + b, cmul(c, z) + d);
  }

  // Hyperbolic translation: moves center of disk by amount t along angle theta
  vec2 hypTranslate(vec2 z, float t, float theta) {
    // Mobius transformation for translation
    vec2 dir = vec2(cos(theta), sin(theta)) * tanh(t * 0.5);
    // (z - dir) / (1 - conj(dir) * z)
    vec2 num = z - dir;
    vec2 den = vec2(1.0, 0.0) - cmul(cconj(dir), z);
    return cdiv(num, den);
  }

  // HSV to RGB
  #include <cyber_hsv2rgb>

  // Hyperbolic distance from origin
  float hypDist(vec2 z) {
    float r = length(z);
    return 2.0 * atanh(min(r, 0.999));
  }

  void main() {
    vec2 uv = (gl_FragCoord.xy - 0.5 * u_resolution) / min(u_resolution.x, u_resolution.y);
    uv /= u_zoom;

    // Apply rotation
    float c = cos(u_rotation);
    float s = sin(u_rotation);
    uv = mat2(c, -s, s, c) * uv;

    float r = length(uv);

    // Outside the Poincare disk
    if (r >= 1.0) {
      // Boundary glow
      float boundaryDist = r - 1.0;
      float glow = exp(-boundaryDist * 60.0) * 0.4;
      glow += u_beatPulse * exp(-boundaryDist * 30.0) * 0.6;
      vec3 boundaryColor = vec3(0.15, 0.2, 0.5) * glow;
      gl_FragColor = vec4(boundaryColor, 1.0);
      return;
    }

    // Apply animated hyperbolic translation (flow)
    vec2 z = hypTranslate(uv, 2.0 * sin(u_flowPhase * 0.25), u_time * 0.2);

    // ── Tessellation via reflection folding ──
    // For a {p, q} tessellation, the fundamental domain is a triangle
    // with angles PI/p, PI/q, PI/2.

    float p = max(3.0, u_p);
    float q = max(3.0, u_q);

    // Reflection count tracks parity for coloring
    int reflections = 0;
    float minEdgeDist = 1000.0;

    // Convert to polar for angular folding
    for (int iter = 0; iter < MAX_REFLECTIONS; iter++) {
      float angle = atan(z.y, z.x);
      float radius = length(z);

      // Fold 1: Reflect into first sector (angle = [0, 2*PI/p])
      float sectorAngle = TAU / p;
      angle = mod(angle, sectorAngle);

      // Track edge distance before reflection
      float edgeDist1 = abs(angle);
      float edgeDist2 = abs(angle - sectorAngle);
      minEdgeDist = min(minEdgeDist, min(edgeDist1, edgeDist2) * radius * 2.0/max(1e-6,1.0-dot(z,z)));

      // Mirror within the sector
      if (angle > sectorAngle * 0.5) {
        angle = sectorAngle - angle;
        reflections++;
      }

      z = vec2(cos(angle), sin(angle)) * radius;

      // Fold 2: Reflect across the geodesic arc
      // Orthogonality to the unit disk plus triangle angles π/p, π/q.
      float cosB = cos(PI / q);
      float sinA = sin(PI / p);
      float discriminant = cosB * cosB - sinA * sinA;
      if (discriminant <= 0.0) break;
      float geodesicCenter = cosB / sqrt(discriminant);
      float geodesicRadius = sinA / sqrt(discriminant);

      // Only valid tessellations: (p-2)*(q-2) > 4
      if (geodesicRadius <= 0.01) break;

      // Distance from point to geodesic circle center
      vec2 circleCenter = vec2(geodesicCenter, 0.0);
      float distToCenter = length(z - circleCenter);

      // Track geodesic edge distance
      float geodesicEdgeDist = abs(distToCenter - geodesicRadius);
      minEdgeDist = min(minEdgeDist, geodesicEdgeDist * 2.0/max(1e-6,1.0-dot(z,z)));

      // If inside the geodesic circle, reflect (inversion in circle)
      if (distToCenter < geodesicRadius) {
        // Circle inversion: z' = center + r^2 * (z - center) / |z - center|^2
        vec2 diff = z - circleCenter;
        z = circleCenter + (geodesicRadius * geodesicRadius) * diff / dot(diff, diff);
        reflections++;
      }

      // Check if we're in the fundamental domain
      float newAngle = atan(z.y, z.x);
      float newDist = length(z - circleCenter);
      if (newAngle >= 0.0 && newAngle <= sectorAngle * 0.5 && newDist >= geodesicRadius) {
        break;
      }
    }

    // ── Coloring ──

    // Parity coloring (Escher-style black/white)
    float parity = mod(float(reflections), 2.0);

    // Hyperbolic distance from center for depth coloring
    float hDist = hypDist(uv);

    // Base colors for the two tile types
    float hue1 = fract(0.6 + u_colorCyclePhase * 0.05 + u_spectralCentroid * 0.15);
    float hue2 = fract(hue1 + 0.45); // Complementary

    float hue = mix(hue1, hue2, parity);
    float sat = 0.5 + 0.3 * parity;
    float val = mix(0.35, 0.55, parity);

    // Depth fade: tiles near boundary get darker (more reflections = deeper)
    float depthFade = exp(-hDist * 0.3);
    val *= 0.4 + 0.6 * depthFade;

    // Audio: RMS controls fill opacity
    val *= 0.6 + u_rms * 0.8 * u_rmsToFill;

    // Beat: pulse the boundary region
    float boundaryGlow = (1.0 - depthFade) * u_beatPulse * 0.5;
    val += boundaryGlow;

    // Geodesic edge lines
    float edgeLine=1.0-smoothstep(max(0.0,u_lineWidth-fwidth(minEdgeDist)),u_lineWidth+fwidth(minEdgeDist),minEdgeDist);
    float edgeIntensity = edgeLine * (0.5 + u_high * 1.0 * u_highToEdge);

    // Combine
    vec3 tileColor = hsv2rgb(vec3(hue, sat, clamp(val, 0.0, 1.0)));
    vec3 edgeColor = hsv2rgb(vec3(fract(hue + 0.1), 0.3, 0.9));

    vec3 color = mix(tileColor, edgeColor, edgeIntensity);

    // Disk border ring
    float borderDist = abs(r - 0.998);
    float border = exp(-borderDist * 500.0) * 0.5;
    color += vec3(0.2, 0.3, 0.6) * border;

    // Background outside disk (already handled above, but smooth transition)
    color *= (1.0 - smoothstep(0.995, 1.0, r));

    // Vignette
    float aspect = u_resolution.x / u_resolution.y;
    vec2 screenUv = gl_FragCoord.xy / u_resolution;
    float vignette = 1.0 - 0.25 * length((screenUv - 0.5) * vec2(aspect, 1.0));
    color *= vignette;

    // Tone mapping
    color = color / (1.0 + color);

    gl_FragColor = vec4(color, 1.0);
  }
`;
