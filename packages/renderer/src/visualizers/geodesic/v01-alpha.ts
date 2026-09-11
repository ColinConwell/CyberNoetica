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
 * Geodesic visualizer -- audio-reactive geodesic sphere via SDF raymarching.
 *
 * A crystalline icosphere rendered entirely in a fragment shader using
 * signed distance field raymarching. The sphere surface is displaced by
 * layered noise and angular faceting to create a geodesic / crystalline
 * geometry. Facet edges glow as wireframe lines. Surface color uses
 * view-angle-dependent iridescence (thin-film interference approximation).
 *
 * Audio reactivity: bass deforms the surface, mids drive rotation speed,
 * highs brighten wireframe edges, RMS scales the sphere (breathing),
 * and beat onsets trigger radial expansion pulses that propagate outward.
 */

const geodesicMetadata: VisualizerMetadata = {
  type: 'geodesic',
  label: 'Geodesic',
  description: 'Audio-reactive faceted sphere approximation',
  usesPerspective: false,
  params: [
    // Appearance
    {
      key: 'facetCount',
      label: 'Facet Count',
      min: 3,
      max: 12,
      step: 1,
      initial: 6,
      category: 'appearance',
      description: 'Latitude/longitude facet resolution',
    },
    {
      key: 'deformation',
      label: 'Deformation',
      min: 0.0,
      max: 1.5,
      step: 0.05,
      initial: 0.5,
      category: 'appearance',
      description: 'Noise-based surface deformation amount',
    },
    {
      key: 'rotationSpeed',
      label: 'Rotation Speed',
      min: 0.0,
      max: 1.0,
      step: 0.05,
      initial: 0.3,
      category: 'appearance',
      description: 'Sphere auto-rotation speed',
    },
    {
      key: 'wireframe',
      label: 'Wireframe',
      min: 0.0,
      max: 1.0,
      step: 0.05,
      initial: 0.4,
      category: 'appearance',
      description: 'Edge/wireframe visibility blend',
    },
    {
      key: 'iridescence',
      label: 'Iridescence',
      min: 0.0,
      max: 1.0,
      step: 0.05,
      initial: 0.6,
      category: 'appearance',
      description: 'Iridescent color effect strength',
    },
    // Audio mapping
    {
      key: 'bassToDeform',
      label: 'Bass -> Deform',
      min: 0.0,
      max: 2.0,
      step: 0.1,
      initial: 1.0,
      category: 'audio-mapping',
      description: 'Bass drives sphere deformation',
    },
    {
      key: 'midToRotation',
      label: 'Mid -> Rotation',
      min: 0.0,
      max: 2.0,
      step: 0.1,
      initial: 1.0,
      category: 'audio-mapping',
      description: 'Mids modulate rotation',
    },
    {
      key: 'highToWireframe',
      label: 'High -> Wireframe',
      min: 0.0,
      max: 2.0,
      step: 0.1,
      initial: 1.0,
      category: 'audio-mapping',
      description: 'Highs brighten wireframe edges',
    },
    {
      key: 'rmsToScale',
      label: 'RMS -> Scale',
      min: 0.0,
      max: 2.0,
      step: 0.1,
      initial: 1.0,
      category: 'audio-mapping',
      description: 'RMS scales the sphere',
    },
    {
      key: 'beatToPulse',
      label: 'Beat -> Pulse',
      min: 0.0,
      max: 2.0,
      step: 0.1,
      initial: 1.0,
      category: 'audio-mapping',
      description: 'Beats trigger expansion pulses',
    },
  ],
  viewport: { pan: true, zoom: true, orbit: false },
  viewStateFields: [
    { key: 'centerX', label: 'Center X', min: -3, max: 3, step: 0.05 },
    { key: 'centerY', label: 'Center Y', min: -3, max: 3, step: 0.05 },
    { key: 'zoom', label: 'Zoom', min: 0.3, max: 4.0, step: 0.05 },
  ],
};

export class GeodesicVisualizer implements Visualizer {
  private deltaSeconds = 1 / 60;
  private phases = new PhaseClock();
  readonly metadata = geodesicMetadata;

  private unsub: Unsubscribe;
  private latestFeatures: AudioFeatures | null = null;
  private time = 0;

  private userParams: Record<string, number> = {
    facetCount: 6,
    deformation: 0.5,
    rotationSpeed: 0.3,
    wireframe: 0.4,
    iridescence: 0.6,
    bassToDeform: 1.0,
    midToRotation: 1.0,
    highToWireframe: 1.0,
    rmsToScale: 1.0,
    beatToPulse: 1.0,
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
        u_rotationSpeedPhase: { value: 0 },
        u_workBudget: { value: 1 },
        u_time: { value: 0.0 },
        u_resolution: { value: new THREE.Vector2(1920, 1080) },
        u_zoom: { value: 1.0 },
        u_center: { value: new THREE.Vector2(0, 0) },
        u_facetCount: { value: 6.0 },
        u_deformation: { value: 0.5 },
        u_rotationSpeed: { value: 0.3 },
        u_wireframe: { value: 0.4 },
        u_iridescence: { value: 0.6 },
        u_bass: { value: 0.0 },
        u_mid: { value: 0.0 },
        u_high: { value: 0.0 },
        u_rms: { value: 0.1 },
        u_spectralCentroid: { value: 0.5 },
        u_beatPulse: { value: 0.0 },
        u_bassDeform: { value: 0.0 },
        u_midRotation: { value: 0.0 },
        u_highWireframe: { value: 0.0 },
        u_rmsScale: { value: 1.0 },
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

    // Audio-modulated values
    const bassDeform = this.smoothers.bass.value * this.userParams.bassToDeform;
    const midRotation =
      this.smoothers.mid.value * this.userParams.midToRotation;
    const highWireframe =
      this.smoothers.high.value * this.userParams.highToWireframe;
    const rmsScale =
      0.8 + this.smoothers.rms.value * 0.5 * this.userParams.rmsToScale;
    const beatPulse =
      this.smoothers.beatPulse.value * this.userParams.beatToPulse;

    if (this.material) {
      const u = this.material.uniforms;
      u.u_time.value = this.time;
      u.u_zoom.value = this._zoom;
      u.u_center.value.set(this._centerX, this._centerY);
      u.u_facetCount.value = this.userParams.facetCount;
      u.u_deformation.value = this.userParams.deformation;
      u.u_rotationSpeed.value =
        this.userParams.rotationSpeed + midRotation * 0.5;
      u.u_rotationSpeedPhase.value = this.phases.advance(
        'u_rotationSpeed',
        u.u_rotationSpeed.value,
        this.deltaSeconds,
      );
      u.u_wireframe.value = this.userParams.wireframe;
      u.u_iridescence.value = this.userParams.iridescence;
      u.u_bass.value = this.smoothers.bass.value;
      u.u_mid.value = this.smoothers.mid.value;
      u.u_high.value = this.smoothers.high.value;
      u.u_rms.value = this.smoothers.rms.value;
      u.u_spectralCentroid.value = this.smoothers.spectralCentroid.value;
      u.u_beatPulse.value = beatPulse;
      u.u_bassDeform.value = bassDeform;
      u.u_midRotation.value = midRotation;
      u.u_highWireframe.value = highWireframe;
      u.u_rmsScale.value = rmsScale;
    }
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
  metadata: geodesicMetadata,
  create: (bus) => new GeodesicVisualizer(bus),
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
  #define MAX_DIST 20.0
  #define SURF_DIST 0.001

  uniform float u_rotationSpeedPhase;
  uniform float u_workBudget;
  uniform float u_time;
  uniform vec2 u_resolution;
  uniform float u_zoom;
  uniform vec2 u_center;
  uniform float u_facetCount;
  uniform float u_deformation;
  uniform float u_rotationSpeed;
  uniform float u_wireframe;
  uniform float u_iridescence;
  uniform float u_bass;
  uniform float u_mid;
  uniform float u_high;
  uniform float u_rms;
  uniform float u_spectralCentroid;
  uniform float u_beatPulse;
  uniform float u_bassDeform;
  uniform float u_midRotation;
  uniform float u_highWireframe;
  uniform float u_rmsScale;

  varying vec2 vUv;

  // ── Noise ──────────────────────────────────────────

  // Hash for simplex-style noise
  vec3 hash33(vec3 p) {
    p = vec3(
      dot(p, vec3(127.1, 311.7, 74.7)),
      dot(p, vec3(269.5, 183.3, 246.1)),
      dot(p, vec3(113.5, 271.9, 124.6))
    );
    return -1.0 + 2.0 * fract(sin(p) * 43758.5453123);
  }

  float snoise(vec3 p) {
    const float K1 = 0.333333333;
    const float K2 = 0.166666667;
    vec3 i = floor(p + (p.x + p.y + p.z) * K1);
    vec3 d0 = p - (i - (i.x + i.y + i.z) * K2);
    vec3 e = step(vec3(0.0), d0 - d0.yzx);
    vec3 i1 = e * (1.0 - e.zxy);
    vec3 i2 = 1.0 - e.zxy * (1.0 - e);
    vec3 d1 = d0 - i1 + K2;
    vec3 d2 = d0 - i2 + 2.0 * K2;
    vec3 d3 = d0 - 1.0 + 3.0 * K2;
    vec4 h = max(0.6 - vec4(dot(d0,d0), dot(d1,d1), dot(d2,d2), dot(d3,d3)), 0.0);
    vec4 n = h * h * h * h * vec4(
      dot(d0, hash33(i)),
      dot(d1, hash33(i + i1)),
      dot(d2, hash33(i + i2)),
      dot(d3, hash33(i + 1.0))
    );
    return dot(n, vec4(52.0));
  }

  float fbm(vec3 p, int octaves) {
    float value = 0.0;
    float amp = 0.5;
    float freq = 1.0;
    for (int i = 0; i < 5; i++) {
      if (i >= octaves) break;
      value += amp * snoise(p * freq);
      freq *= 2.0;
      amp *= 0.5;
    }
    return value;
  }

  // ── Rotation matrices ─────────────────────────────

  mat3 rotateY(float a) {
    float c = cos(a), s = sin(a);
    return mat3(c, 0.0, s, 0.0, 1.0, 0.0, -s, 0.0, c);
  }

  mat3 rotateX(float a) {
    float c = cos(a), s = sin(a);
    return mat3(1.0, 0.0, 0.0, 0.0, c, -s, 0.0, s, c);
  }

  // ── Geodesic faceting ──────────────────────────────

  // Approximate geodesic faceting by quantizing directions on the sphere
  // into discrete angular cells. This creates sharp facet boundaries.
  float geodesicFacet(vec3 dir, float subdivisions) {
    // Spherical coordinates
    float theta = atan(dir.z, dir.x);
    float phi = acos(clamp(dir.y, -1.0, 1.0));

    // Quantize into geodesic-like cells
    float latBands = subdivisions;
    float phiQ = floor(phi * latBands / PI + 0.5) * PI / latBands;

    // Longitude bands vary with latitude for more uniform cells
    float lonBands = max(3.0, subdivisions * 2.0 * sin(phiQ));
    float thetaQ = floor(theta * lonBands / TAU + 0.5) * TAU / lonBands;

    // Distance from pixel direction to quantized cell center
    vec3 cellCenter = vec3(
      sin(phiQ) * cos(thetaQ),
      cos(phiQ),
      sin(phiQ) * sin(thetaQ)
    );

    // Edge distance: how close to the boundary between cells
    float cellDist = 1.0 - dot(normalize(dir), cellCenter);
    return cellDist;
  }

  // ── SDF for the geodesic sphere ────────────────────

  float sdGeodesicSphere(vec3 p, float radius, float time, float facets, float deform, float bassDeform) {
    // Base sphere
    float d = length(p) - radius;

    // Direction on sphere surface for faceting and noise
    vec3 dir = normalize(p);

    // Noise-based surface deformation
    float noiseScale = 2.0 + facets * 0.3;
    float noiseVal = fbm(dir * noiseScale + time * 0.15, 3);

    // Total deformation: base + bass-driven
    float totalDeform = deform + bassDeform * 0.8;
    d -= noiseVal * totalDeform * 0.15;

    // Geodesic faceting: push surface inward at facet boundaries
    float edgeDist = geodesicFacet(dir, facets);
    float facetDepth = smoothstep(0.0, 0.03, edgeDist) * 0.05 * (1.0 + totalDeform);
    d += facetDepth;

    return d;
  }

  // ── Raymarching ────────────────────────────────────

  struct MarchResult {
    bool hit;
    float dist;
    int steps;
    vec3 pos;
  };

  MarchResult raymarch(vec3 ro, vec3 rd, float radius, float time, float facets, float deform, float bassDeform) {
    MarchResult res;
    res.hit = false;
    res.pos = ro;
    res.dist = 0.0;
    res.steps = 0;

    for (int i = 0; i < MAX_STEPS; i++) {
      if (float(i) >= max(32.0, float(MAX_STEPS) * u_workBudget)) break;
      res.steps = i;
      res.pos = ro + rd * res.dist;
      float d = sdGeodesicSphere(res.pos, radius, time, facets, deform, bassDeform);
      if (abs(d) < SURF_DIST) { res.hit = true; break; }
      res.dist += d;
      if (res.dist > MAX_DIST) break;
    }

    return res;
  }

  // ── Normal estimation ──────────────────────────────

  vec3 getNormal(vec3 p, float radius, float time, float facets, float deform, float bassDeform) {
    float e = 0.001;
    float d = sdGeodesicSphere(p, radius, time, facets, deform, bassDeform);
    return normalize(vec3(
      sdGeodesicSphere(p + vec3(e,0,0), radius, time, facets, deform, bassDeform) - d,
      sdGeodesicSphere(p + vec3(0,e,0), radius, time, facets, deform, bassDeform) - d,
      sdGeodesicSphere(p + vec3(0,0,e), radius, time, facets, deform, bassDeform) - d
    ));
  }

  // ── Iridescence (thin-film interference) ───────────

  vec3 iridescence(float cosTheta, float strength, float time) {
    // Thin-film interference: different wavelengths constructively
    // interfere at different angles
    float phase = cosTheta * 6.0 + time * 0.3;
    vec3 film = vec3(
      cos(phase) * 0.5 + 0.5,
      cos(phase + TAU / 3.0) * 0.5 + 0.5,
      cos(phase + 2.0 * TAU / 3.0) * 0.5 + 0.5
    );
    // Shift hue based on spectral centroid for more variety
    return mix(vec3(0.6, 0.7, 0.8), film, strength);
  }

  // ── Ambient occlusion approximation ────────────────

  float ao(vec3 p, vec3 n, float radius, float time, float facets, float deform, float bassDeform) {
    float occ = 0.0;
    float sca = 1.0;
    for (int i = 0; i < 5; i++) {
      float h = 0.01 + 0.12 * float(i);
      float d = sdGeodesicSphere(p + n * h, radius, time, facets, deform, bassDeform);
      occ += (h - d) * sca;
      sca *= 0.7;
    }
    return clamp(1.0 - 3.0 * occ, 0.0, 1.0);
  }

  void main() {
    // Screen coordinates
    vec2 uv = (gl_FragCoord.xy - 0.5 * u_resolution) / min(u_resolution.x, u_resolution.y);
    uv = uv / u_zoom + u_center;

    // Camera setup
    vec3 ro = vec3(0.0, 0.0, 3.5);
    vec3 rd = normalize(vec3(uv, -1.5));

    // Rotation
    float rotTime = u_rotationSpeedPhase;
    mat3 rotY = rotateY(rotTime);
    mat3 rotX = rotateX(sin(u_rotationSpeedPhase * 0.37) * 0.3);
    mat3 rot = rotY * rotX;

    // Sphere parameters
    float radius = 1.0 * u_rmsScale;
    float facets = u_facetCount;
    float deform = u_deformation;
    float bassDeform = u_bassDeform;

    // Beat pulse: radial expansion
    radius += u_beatPulse * 0.15;

    // Apply rotation to ray (rotate the world, not the camera)
    vec3 ro_rot = rot * ro;
    vec3 rd_rot = rot * rd;

    // Raymarch
    MarchResult hit = raymarch(ro_rot, rd_rot, radius, u_time, facets, deform, bassDeform);

    vec3 color = vec3(0.0);

    if (hit.hit) {
      vec3 p = hit.pos;
      vec3 n = getNormal(p, radius, u_time, facets, deform, bassDeform);
      vec3 dir = normalize(p);

      // ── Lighting ──────────────────────────────
      vec3 lightDir = normalize(vec3(1.0, 1.2, 0.8));
      vec3 viewDir = normalize(ro_rot - p);
      vec3 halfDir = normalize(lightDir + viewDir);

      float NdotL = max(dot(n, lightDir), 0.0);
      float NdotV = max(dot(n, viewDir), 0.0);
      float NdotH = max(dot(n, halfDir), 0.0);

      // Diffuse
      float diff = NdotL * 0.7 + 0.3;

      // Specular (Blinn-Phong)
      float spec = pow(NdotH, 64.0) * 0.8;

      // Fresnel rim lighting
      float fresnel = pow(1.0 - NdotV, 3.0);
      float rim = fresnel * 0.6;

      // Ambient occlusion
      float occl = ao(p, n, radius, u_time, facets, deform, bassDeform);

      // ── Surface color ─────────────────────────

      // Base color: cool metallic with iridescence
      vec3 iriColor = iridescence(NdotV, u_iridescence, u_time + u_spectralCentroid * 2.0);

      // Wireframe edges
      float edgeDist = geodesicFacet(dir, facets);
      float edgeWidth = 0.008 + 0.004 * u_wireframe;
      float edge = 1.0 - smoothstep(0.0, edgeWidth, edgeDist);

      // Highs brighten wireframe
      float wireGlow = u_wireframe + u_highWireframe * 0.6;
      vec3 wireColor = vec3(0.7, 0.85, 1.0) * wireGlow * 2.0;

      // Combine surface
      vec3 surfaceColor = iriColor * diff;
      surfaceColor += spec * vec3(1.0, 0.95, 0.9);
      surfaceColor += rim * vec3(0.4, 0.5, 0.7);
      surfaceColor *= occl;

      // Blend in wireframe
      color = mix(surfaceColor, wireColor, edge * wireGlow);

      // Beat pulse: brief bright flash on the expansion wave front
      float distFromCenter = length(p);
      float pulseWave = 1.0 - smoothstep(0.0, 0.3, abs(distFromCenter - radius - 0.05));
      color += vec3(0.3, 0.5, 1.0) * pulseWave * u_beatPulse * 2.0;

      // Glow from AO-darkened edges
      color += vec3(0.05, 0.08, 0.15) * (1.0 - occl) * 0.5;

    } else {
      // ── Background ────────────────────────────
      // Subtle radial gradient
      float d = length(uv);
      color = mix(vec3(0.02, 0.015, 0.03), vec3(0.005, 0.003, 0.008), smoothstep(0.0, 2.0, d));

      // Faint glow around sphere position
      float glow = exp(-d * d * 3.0) * 0.08;
      color += vec3(0.15, 0.2, 0.35) * glow * (0.5 + u_rms * 0.5);
    }

    // ── Post-processing ───────────────────────────

    // Vignette
    float aspect = u_resolution.x / u_resolution.y;
    vec2 screenUv = gl_FragCoord.xy / u_resolution;
    float vignette = 1.0 - 0.4 * length((screenUv - 0.5) * vec2(aspect, 1.0));
    color *= vignette;

    // Background floor
    color = max(color, vec3(0.005, 0.003, 0.008));

    // Tone mapping (Reinhard)
    color = color / (0.9 + color);

    // Slight gamma for richness
    color = pow(color, vec3(0.95));

    gl_FragColor = vec4(color, 1.0);
  }
`;
