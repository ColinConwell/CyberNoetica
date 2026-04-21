import * as THREE from 'three';
import { MessageBus } from '@cybernoetica/core';
import type { AudioFeatures, BusMessage, Unsubscribe } from '@cybernoetica/core';
import { EMASmoothing } from '../../smoothing.js';
import type { Visualizer, VisualizerMetadata } from '../types.js';
import { registerVisualizer } from '../registry.js';

/**
 * Torus Knot — raymarched mathematical knots.
 *
 * A torus knot is a curve on the surface of a torus that winds p times around
 * the axis of rotational symmetry and q times around the interior of the torus.
 * The parametric form: x = (R + r·cos(q·t)) · cos(p·t), etc. When p and q are
 * coprime the result is a single closed curve; otherwise it produces a link.
 *
 * The shader raymarches against the SDF of a tube following this curve. The tube
 * radius, p/q parameters, and rotation are all audio-reactive. Iridescent
 * Fresnel coloring gives the knot a metallic, holographic appearance.
 *
 * Audio mapping:
 *   bass      -> tube radius (thicker knot)
 *   mid       -> rotation speed
 *   high      -> iridescence intensity
 *   rms       -> emission glow
 *   beat      -> pulse (tube radius throb)
 *   centroid  -> hue shift in iridescence
 */

const torusKnotMetadata: VisualizerMetadata = {
  type: 'torusknot',
  label: 'Torus Knot',
  description: 'Raymarched mathematical knots with iridescent shading',
  usesPerspective: false,
  params: [
    { key: 'knotP', label: 'P (windings)', min: 1.0, max: 9.0, step: 1.0, initial: 3.0, category: 'appearance', description: 'Windings around symmetry axis' },
    { key: 'knotQ', label: 'Q (windings)', min: 1.0, max: 7.0, step: 1.0, initial: 2.0, category: 'appearance', description: 'Windings around torus interior' },
    { key: 'tubeRadius', label: 'Tube Radius', min: 0.02, max: 0.3, step: 0.01, initial: 0.14, category: 'appearance', description: 'Thickness of the knot tube' },
    { key: 'torusRadius', label: 'Torus Radius', min: 0.5, max: 2.0, step: 0.05, initial: 1.0, category: 'appearance', description: 'Major radius of the torus' },
    { key: 'rotSpeed', label: 'Rotation Speed', min: 0.0, max: 1.0, step: 0.05, initial: 0.3, category: 'appearance', description: 'Auto-rotation speed' },
    { key: 'iridescence', label: 'Iridescence', min: 0.0, max: 2.0, step: 0.1, initial: 1.2, category: 'appearance', description: 'Rainbow sheen intensity' },
    { key: 'bassToRadius', label: 'Bass → Radius', min: 0.0, max: 2.0, step: 0.1, initial: 1.0, category: 'audio-mapping', description: 'Bass thickens the tube' },
    { key: 'midToRotation', label: 'Mid → Rotation', min: 0.0, max: 2.0, step: 0.1, initial: 1.0, category: 'audio-mapping', description: 'Mids drive rotation speed' },
    { key: 'highToIridescence', label: 'High → Iridescence', min: 0.0, max: 2.0, step: 0.1, initial: 1.0, category: 'audio-mapping', description: 'Highs drive rainbow coloring' },
    { key: 'rmsToGlow', label: 'RMS → Glow', min: 0.0, max: 2.0, step: 0.1, initial: 1.0, category: 'audio-mapping', description: 'Volume boosts emission' },
    { key: 'beatToPulse', label: 'Beat → Pulse', min: 0.0, max: 2.0, step: 0.1, initial: 1.0, category: 'audio-mapping', description: 'Beats pulse the tube radius' },
    { key: 'centroidToHue', label: 'Centroid → Hue', min: 0.0, max: 2.0, step: 0.1, initial: 0.8, category: 'audio-mapping', description: 'Spectral centroid shifts hue' },
  ],
  viewport: { pan: true, zoom: true, orbit: false },
  viewStateFields: [
    { key: 'centerX', label: 'Center X', min: -3, max: 3, step: 0.05 },
    { key: 'centerY', label: 'Center Y', min: -3, max: 3, step: 0.05 },
    { key: 'zoom', label: 'Zoom', min: 0.2, max: 4.0, step: 0.05 },
  ],
};

export class TorusKnotVisualizer implements Visualizer {
  readonly metadata = torusKnotMetadata;

  private unsub: Unsubscribe;
  private latestFeatures: AudioFeatures | null = null;
  private time = 0;

  private userParams: Record<string, number> = {
    knotP: 3.0,
    knotQ: 2.0,
    tubeRadius: 0.14,
    torusRadius: 1.0,
    rotSpeed: 0.3,
    iridescence: 1.2,
    bassToRadius: 1.0,
    midToRotation: 1.0,
    highToIridescence: 1.0,
    rmsToGlow: 1.0,
    beatToPulse: 1.0,
    centroidToHue: 0.8,
  };

  private _centerX = 0;
  private _centerY = 0;
  private _zoom = 1.0;

  private smoothers = {
    bass: new EMASmoothing(0.12),
    mid: new EMASmoothing(0.18),
    high: new EMASmoothing(0.25),
    rms: new EMASmoothing(0.15),
    beatPulse: new EMASmoothing(0.4),
    spectralCentroid: new EMASmoothing(0.08),
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
    this.smoothers.beatPulse.reset(0);
    this.smoothers.spectralCentroid.reset(0.5);
  }

  attach(scene: THREE.Scene): void {
    this.material = new THREE.ShaderMaterial({
      vertexShader: VERTEX_SHADER,
      fragmentShader: FRAGMENT_SHADER,
      uniforms: {
        u_time: { value: 0.0 },
        u_resolution: { value: new THREE.Vector2(1920, 1080) },
        u_zoom: { value: 1.0 },
        u_center: { value: new THREE.Vector2(0, 0) },
        u_knotP: { value: 3.0 },
        u_knotQ: { value: 2.0 },
        u_tubeRadius: { value: 0.14 },
        u_torusRadius: { value: 1.0 },
        u_rotSpeed: { value: 0.3 },
        u_iridescence: { value: 1.2 },
        u_bass: { value: 0.0 },
        u_mid: { value: 0.0 },
        u_high: { value: 0.0 },
        u_rms: { value: 0.1 },
        u_beatPulse: { value: 0.0 },
        u_spectralCentroid: { value: 0.5 },
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
      this.smoothers.beatPulse.update(f.beatOnset ? 1.0 : 0.0);
      this.smoothers.spectralCentroid.update(f.spectralCentroid);
    } else {
      this.smoothers.beatPulse.update(0.0);
    }

    if (this.material) {
      const u = this.material.uniforms;
      u.u_time.value = this.time;
      u.u_zoom.value = this._zoom;
      u.u_center.value.set(this._centerX, this._centerY);
      u.u_knotP.value = this.userParams.knotP;
      u.u_knotQ.value = this.userParams.knotQ;
      u.u_tubeRadius.value = this.userParams.tubeRadius
        + this.smoothers.bass.value * 0.05 * this.userParams.bassToRadius
        + this.smoothers.beatPulse.value * 0.03 * this.userParams.beatToPulse;
      u.u_torusRadius.value = this.userParams.torusRadius;
      u.u_rotSpeed.value = this.userParams.rotSpeed
        + this.smoothers.mid.value * 0.2 * this.userParams.midToRotation;
      u.u_iridescence.value = this.userParams.iridescence
        + this.smoothers.high.value * 0.6 * this.userParams.highToIridescence;
      u.u_bass.value = this.smoothers.bass.value;
      u.u_mid.value = this.smoothers.mid.value;
      u.u_high.value = this.smoothers.high.value;
      u.u_rms.value = this.smoothers.rms.value;
      u.u_beatPulse.value = this.smoothers.beatPulse.value * this.userParams.beatToPulse;
      u.u_spectralCentroid.value = this.smoothers.spectralCentroid.value;
    }
  }

  setResolution(width: number, height: number): void {
    if (this.material) this.material.uniforms.u_resolution.value.set(width, height);
  }

  setUserParam(key: string, value: number): void {
    if (key in this.userParams) this.userParams[key] = value;
  }

  getViewState(): Record<string, number> {
    return { centerX: this._centerX, centerY: this._centerY, zoom: this._zoom };
  }

  setViewState(partial: Record<string, number>): void {
    if ('centerX' in partial) this._centerX = Math.max(-3, Math.min(3, partial.centerX));
    if ('centerY' in partial) this._centerY = Math.max(-3, Math.min(3, partial.centerY));
    if ('zoom' in partial) this._zoom = Math.max(0.2, Math.min(4.0, partial.zoom));
  }

  dispose(): void {
    this.unsub();
    this.material?.dispose();
    this.mesh?.geometry.dispose();
  }
}

registerVisualizer({
  metadata: torusKnotMetadata,
  create: (bus) => new TorusKnotVisualizer(bus),
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
  #define MAX_STEPS 100
  #define MAX_DIST 25.0
  #define SURF_DIST 0.001

  uniform float u_time;
  uniform vec2 u_resolution;
  uniform float u_zoom;
  uniform vec2 u_center;
  uniform float u_knotP;
  uniform float u_knotQ;
  uniform float u_tubeRadius;
  uniform float u_torusRadius;
  uniform float u_rotSpeed;
  uniform float u_iridescence;
  uniform float u_bass;
  uniform float u_mid;
  uniform float u_high;
  uniform float u_rms;
  uniform float u_beatPulse;
  uniform float u_spectralCentroid;

  varying vec2 vUv;

  mat3 rotateX(float a) {
    float c = cos(a), s = sin(a);
    return mat3(1,0,0, 0,c,-s, 0,s,c);
  }
  mat3 rotateY(float a) {
    float c = cos(a), s = sin(a);
    return mat3(c,0,s, 0,1,0, -s,0,c);
  }
  mat3 rotateZ(float a) {
    float c = cos(a), s = sin(a);
    return mat3(c,-s,0, s,c,0, 0,0,1);
  }

  // Torus knot: find closest point on the curve to point p
  // by sampling along the parametric curve
  float torusKnotSDF(vec3 p) {
    float R = u_torusRadius;
    float r = R * 0.4; // minor radius of the torus the knot lives on
    float tubeR = u_tubeRadius;

    float minDist = 1e10;
    float kp = u_knotP;
    float kq = u_knotQ;

    // Sample the knot curve and find minimum distance
    for (int i = 0; i < 192; i++) {
      float t = float(i) / 192.0 * TAU;

      // Parametric torus knot
      float ct = cos(t);
      float st = sin(t);
      float rt = R + r * cos(kq * t);

      vec3 knotPoint = vec3(
        rt * cos(kp * t),
        rt * sin(kp * t),
        r * sin(kq * t)
      );

      float d = length(p - knotPoint) - tubeR;
      minDist = min(minDist, d);
    }

    return minDist;
  }

  float sceneSDF(vec3 p) {
    return torusKnotSDF(p);
  }

  vec3 calcNormal(vec3 p) {
    vec2 e = vec2(0.002, 0.0);
    return normalize(vec3(
      sceneSDF(p + e.xyy) - sceneSDF(p - e.xyy),
      sceneSDF(p + e.yxy) - sceneSDF(p - e.yxy),
      sceneSDF(p + e.yyx) - sceneSDF(p - e.yyx)
    ));
  }

  float raymarch(vec3 ro, vec3 rd) {
    float t = 0.0;
    for (int i = 0; i < MAX_STEPS; i++) {
      vec3 p = ro + rd * t;
      float d = sceneSDF(p);
      if (abs(d) < SURF_DIST) return t;
      if (t > MAX_DIST) break;
      t += d * 0.8;
    }
    return -1.0;
  }

  float calcAO(vec3 p, vec3 n) {
    float ao = 0.0;
    float scale = 1.0;
    for (int i = 0; i < 5; i++) {
      float h = 0.01 + 0.1 * float(i);
      float d = sceneSDF(p + n * h);
      ao += (h - d) * scale;
      scale *= 0.6;
    }
    return clamp(1.0 - 3.0 * ao, 0.0, 1.0);
  }

  vec3 iridescent(vec3 n, vec3 v, float intensity) {
    float fresnel = pow(1.0 - abs(dot(n, v)), 3.0);
    float angle = dot(n, v) * 0.5 + 0.5;
    float hueShift = u_spectralCentroid * 0.5;
    vec3 col;
    col.r = 0.5 + 0.5 * cos(TAU * (angle * 1.2 + 0.0 + hueShift));
    col.g = 0.5 + 0.5 * cos(TAU * (angle * 1.2 + 0.33 + hueShift));
    col.b = 0.5 + 0.5 * cos(TAU * (angle * 1.2 + 0.67 + hueShift));
    return mix(vec3(0.8, 0.82, 0.85), col, fresnel * intensity);
  }

  void main() {
    vec2 uv = (gl_FragCoord.xy - 0.5 * u_resolution) / min(u_resolution.x, u_resolution.y);
    uv = uv / u_zoom + u_center;

    // Camera rotation
    float rotAngle = u_time * u_rotSpeed;
    mat3 rot = rotateY(rotAngle) * rotateX(rotAngle * 0.6 + sin(u_time * 0.15) * 0.4);

    // Camera setup
    vec3 ro = rot * vec3(0.0, 0.0, 4.5);
    vec3 target = vec3(0.0);
    vec3 fwd = normalize(target - ro);
    vec3 right = normalize(cross(vec3(0, 1, 0), fwd));
    vec3 up = cross(fwd, right);
    vec3 rd = normalize(fwd + uv.x * right + uv.y * up);

    float t = raymarch(ro, rd);

    // Deep background
    vec3 color = vec3(0.01, 0.005, 0.02);

    // Subtle background glow centered on knot
    float bgGlow = exp(-length(uv) * 2.0) * 0.03;
    color += vec3(0.1, 0.05, 0.15) * bgGlow * (0.5 + u_rms);

    if (t > 0.0) {
      vec3 p = ro + rd * t;
      vec3 n = calcNormal(p);
      float ao = calcAO(p, n);

      // Two-point lighting
      vec3 lightDir1 = normalize(vec3(1.0, 1.5, 0.8));
      vec3 lightDir2 = normalize(vec3(-0.8, -0.2, -1.0));

      float diff1 = max(dot(n, lightDir1), 0.0);
      float diff2 = max(dot(n, lightDir2), 0.0) * 0.25;

      // Specular
      vec3 halfVec = normalize(lightDir1 - rd);
      float spec = pow(max(dot(n, halfVec), 0.0), 48.0);

      // Iridescent surface color
      vec3 iriColor = iridescent(n, -rd, u_iridescence);

      // Emission based on RMS
      float emissionBoost = 0.8 + u_rms * 1.2;
      vec3 baseLight = vec3(0.95, 0.9, 1.0) * diff1 + vec3(0.3, 0.35, 0.5) * diff2;
      color = iriColor * baseLight * ao * emissionBoost;
      color += spec * vec3(1.0, 0.95, 0.9) * 0.6;

      // Beat pulse: bright flash on surface
      color += iriColor * u_beatPulse * 0.5;

      // Rim light
      float rim = pow(1.0 - max(dot(n, -rd), 0.0), 3.0);
      vec3 rimColor = mix(vec3(0.2, 0.3, 0.8), vec3(0.8, 0.2, 0.5), u_spectralCentroid);
      color += rimColor * rim * 0.3 * (0.5 + u_rms);

      // Depth fog
      float fog = exp(-t * 0.12);
      color *= fog;
    }

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
