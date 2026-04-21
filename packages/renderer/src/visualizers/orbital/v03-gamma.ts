import * as THREE from 'three';
import { MessageBus } from '@cybernoetica/core';
import type { AudioFeatures, BusMessage, Unsubscribe } from '@cybernoetica/core';
import { EMASmoothing } from '../../smoothing.js';
import type { Visualizer, VisualizerMetadata } from '../types.js';
import { registerVisualizer } from '../registry.js';

/**
 * Orbital Gamma -- interactive sculpt mode.
 *
 * Builds on Beta's chaotic particle system and adds user-placeable
 * force fields (attractors / repulsors). Inspired by Cosmic-Conway.
 *
 * When "Sculpt Mode" is enabled (via the UI toggle):
 *   - Click on the canvas to place an attractor at that 3D position
 *   - Shift+click places a repulsor
 *   - Force fields decay over time (configurable lifetime)
 *   - Each field has a visible representation (sphere / rings)
 */

const MAX_PARTICLES = 5000;
const NUM_EMITTERS = 6;
const BASE_EMISSION_RATE = 2;
const MAX_LIFETIME = 7.0;
const BASE_G = 1.8;
const DAMPING = 0.984;
const NOISE_SCALE = 1.0;
const BASE_NOISE_STRENGTH = 0.5;
const MAX_FORCE_FIELDS = 12;

const IDLE_FEATURES: AudioFeatures = {
  fftBins: new Float32Array(0),
  bass: 0.25, mid: 0.3, high: 0.15,
  spectralCentroid: 0.4, spectralFlux: 0.05,
  rms: 0.2, beatOnset: false, beatConfidence: 0.0, degraded: false,
};

interface Emitter {
  baseRadius: number;
  speed: number;
  phase: number;
  tilt: number;
  tiltAxis: number;
  position: [number, number, number];
}

interface ForceField {
  position: THREE.Vector3;
  type: 'attractor' | 'repulsor';
  strength: number;
  age: number;
  lifetime: number;
  mesh: THREE.Object3D;
}

function createEmitters(count: number): Emitter[] {
  const emitters: Emitter[] = [];
  for (let i = 0; i < count; i++) {
    const t = i / count;
    emitters.push({
      baseRadius: 2.0 + Math.random() * 3.5,
      speed: 0.25 + Math.random() * 0.5,
      phase: t * Math.PI * 2 + (Math.random() - 0.5) * 0.6,
      tilt: (Math.random() - 0.5) * Math.PI * 1.0,
      tiltAxis: Math.random() * Math.PI * 2,
      position: [0, 0, 0],
    });
  }
  return emitters;
}

function updateEmitterPosition(
  emitter: Emitter, time: number, speedMul: number, radiusBreath: number,
  perturbation: number,
): void {
  const tiltDrift = Math.sin(time * 0.07 + emitter.phase) * perturbation * 0.25;
  const radiusDrift = Math.sin(time * 0.11 + emitter.phase * 2.3) * perturbation * 0.4;
  const tilt = emitter.tilt + tiltDrift;
  const tiltAxis = emitter.tiltAxis;
  const angle = time * emitter.speed * speedMul + emitter.phase;
  const r = emitter.baseRadius * (1.0 + radiusBreath * 0.3) + radiusDrift;

  const x0 = r * Math.cos(angle);
  const y0 = r * Math.sin(angle);

  const ct = Math.cos(tilt), st = Math.sin(tilt);
  const ca = Math.cos(tiltAxis), sa = Math.sin(tiltAxis);

  emitter.position[0] = x0 * (ca * ca * (1 - ct) + ct) + y0 * (ca * sa * (1 - ct));
  emitter.position[1] = x0 * (ca * sa * (1 - ct)) + y0 * (sa * sa * (1 - ct) + ct);
  emitter.position[2] = x0 * (-sa * st) + y0 * (ca * st);
}

function createAttractorMesh(): THREE.Object3D {
  const group = new THREE.Group();
  const outerGeo = new THREE.SphereGeometry(0.5, 16, 16);
  const outerMat = new THREE.MeshBasicMaterial({
    color: 0x88aaff, transparent: true, opacity: 0.15,
    blending: THREE.AdditiveBlending, depthWrite: false,
  });
  group.add(new THREE.Mesh(outerGeo, outerMat));
  const coreGeo = new THREE.SphereGeometry(0.12, 12, 12);
  const coreMat = new THREE.MeshBasicMaterial({
    color: 0xaaccff, transparent: true, opacity: 0.8,
    blending: THREE.AdditiveBlending, depthWrite: false,
  });
  group.add(new THREE.Mesh(coreGeo, coreMat));
  return group;
}

function createRepulsorMesh(): THREE.Object3D {
  const group = new THREE.Group();
  for (let i = 0; i < 3; i++) {
    const ringGeo = new THREE.RingGeometry(0.35, 0.45, 24);
    const ringMat = new THREE.MeshBasicMaterial({
      color: 0xff6644, side: THREE.DoubleSide, transparent: true, opacity: 0,
      blending: THREE.AdditiveBlending, depthWrite: false,
    });
    group.add(new THREE.Mesh(ringGeo, ringMat));
  }
  const coreGeo = new THREE.SphereGeometry(0.1, 12, 12);
  const coreMat = new THREE.MeshBasicMaterial({
    color: 0xff4422, transparent: true, opacity: 0.8,
    blending: THREE.AdditiveBlending, depthWrite: false,
  });
  group.add(new THREE.Mesh(coreGeo, coreMat));
  return group;
}

function disposeFieldMesh(obj: THREE.Object3D): void {
  obj.traverse((node) => {
    const mesh = node as THREE.Mesh;
    if (mesh.geometry && typeof mesh.geometry.dispose === 'function') {
      mesh.geometry.dispose();
    }
    const mat = mesh.material as THREE.Material | THREE.Material[] | undefined;
    if (Array.isArray(mat)) {
      for (const m of mat) m.dispose?.();
    } else if (mat && typeof mat.dispose === 'function') {
      mat.dispose();
    }
  });
}

const PARTICLE_VERTEX_SHADER = /* glsl */ `
  attribute float a_age;
  attribute float a_lifetime;
  attribute float a_size;
  attribute float a_speed;
  varying float v_life;
  varying float v_speed;
  void main() {
    v_life = a_age / a_lifetime;
    v_speed = a_speed;
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = a_size * (180.0 / -mvPosition.z) * (1.0 - v_life * 0.3);
    gl_Position = projectionMatrix * mvPosition;
  }
`;

const PARTICLE_FRAGMENT_SHADER = /* glsl */ `
  precision highp float;
  uniform float u_hueShift;
  uniform float u_glowIntensity;
  uniform float u_time;
  varying float v_life;
  varying float v_speed;
  vec3 hsv2rgb(vec3 c) {
    vec3 p = abs(fract(c.xxx + vec3(1.0, 2.0/3.0, 1.0/3.0)) * 6.0 - 3.0);
    return c.z * mix(vec3(1.0), clamp(p - 1.0, 0.0, 1.0), c.y);
  }
  void main() {
    vec2 cxy = 2.0 * gl_PointCoord - 1.0;
    float r = dot(cxy, cxy);
    if (r > 1.0) discard;
    float glow = exp(-r * 5.0);
    float core = exp(-r * 14.0);
    float intensity = (glow * 0.65 + core * 0.35) * u_glowIntensity;
    float fadeIn = smoothstep(0.0, 0.06, v_life);
    float fadeOut = 1.0 - smoothstep(0.45, 1.0, v_life);
    float alpha = fadeIn * fadeOut * intensity;
    float baseHue = mix(0.55, 0.12, u_hueShift);
    float hue = baseHue + v_life * 0.2 + v_speed * 0.08;
    float sat = mix(0.85, 0.35, v_life);
    float val = mix(1.0, 0.5, v_life);
    vec3 color = hsv2rgb(vec3(fract(hue), sat, val));
    color = mix(color, vec3(1.0), core * 0.35);
    gl_FragColor = vec4(color * alpha, alpha);
  }
`;

const orbitalGammaMetadata: VisualizerMetadata = {
  type: 'orbital-gamma',
  label: 'Orbital Gamma',
  description: 'Interactive particle sculpting with force fields',
  usesPerspective: true,
  params: [
    { key: 'sculptMode', label: 'Sculpt Mode', min: 0, max: 1, step: 1, initial: 0, category: 'appearance' },
    { key: 'fieldLifetime', label: 'Field Lifetime', min: 3, max: 30, step: 1, initial: 10, category: 'appearance' },
    { key: 'fieldStrength', label: 'Field Strength', min: 0.2, max: 5.0, step: 0.2, initial: 2.0, category: 'appearance' },
    { key: 'glowMultiplier', label: 'Glow', min: 0.3, max: 2.5, step: 0.1, initial: 1.0, category: 'appearance' },
    { key: 'gravityMultiplier', label: 'Gravity', min: 0.1, max: 2.0, step: 0.1, initial: 1.0, category: 'appearance' },
    { key: 'noiseMultiplier', label: 'Turbulence', min: 0.0, max: 4.0, step: 0.1, initial: 1.0, category: 'appearance' },
    { key: 'bassToGravity', label: 'Bass \u2192 Gravity', min: 0.0, max: 2.0, step: 0.1, initial: 1.0, category: 'audio-mapping' },
    { key: 'midToSpeed', label: 'Mid \u2192 Speed', min: 0.0, max: 2.0, step: 0.1, initial: 1.0, category: 'audio-mapping' },
    { key: 'rmsToGlow', label: 'RMS \u2192 Glow', min: 0.0, max: 2.0, step: 0.1, initial: 1.0, category: 'audio-mapping' },
  ],
  viewport: { pan: false, zoom: true, orbit: true },
  viewStateFields: [
    { key: 'orbitAngle', label: 'Orbit Angle', min: 0, max: 6.283, step: 0.05 },
    { key: 'elevation', label: 'Elevation', min: -1.5, max: 1.5, step: 0.05 },
    { key: 'distance', label: 'Distance', min: 4, max: 30, step: 0.5 },
  ],
  interactivity: {
    description: 'Click to place attractors | Right-click for repulsors',
    toggleParam: 'sculptMode',
  },
};

export class OrbitalGammaVisualizer implements Visualizer {
  readonly metadata = orbitalGammaMetadata;
  readonly usesPerspective = true;

  userParams: Record<string, number> = {
    sculptMode: 0,
    fieldLifetime: 10,
    fieldStrength: 2.0,
    glowMultiplier: 1.0,
    gravityMultiplier: 1.0,
    noiseMultiplier: 1.0,
    bassToGravity: 1.0,
    midToSpeed: 1.0,
    rmsToGlow: 1.0,
  };

  private unsub: Unsubscribe;
  private latestFeatures: AudioFeatures | null = null;
  private time = 0;

  private smoothBass = new EMASmoothing(0.18);
  private smoothMid = new EMASmoothing(0.20);
  private smoothHigh = new EMASmoothing(0.15);
  private smoothRms = new EMASmoothing(0.20);
  private smoothCentroid = new EMASmoothing(0.10);

  private positions: Float32Array;
  private velocities: Float32Array;
  private ages: Float32Array;
  private lifetimes: Float32Array;
  private sizes: Float32Array;
  private speeds: Float32Array;
  private alive: Uint8Array;
  private emitterIndex: Uint8Array;
  private activeCount = 0;

  private particleGeometry: THREE.BufferGeometry | null = null;
  private particleMaterial: THREE.ShaderMaterial | null = null;
  private particlePoints: THREE.Points | null = null;
  private sceneRef: THREE.Scene | null = null;
  private emitters: Emitter[];
  private burstCooldown = 0;

  private forceFields: ForceField[] = [];
  private raycaster = new THREE.Raycaster();
  private clickPlane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
  private boundClickHandler: ((e: MouseEvent) => void) | null = null;
  private boundContextHandler: ((e: MouseEvent) => void) | null = null;
  private boundPointerDownHandler: ((e: PointerEvent) => void) | null = null;
  private pointerDownPos: { x: number; y: number } | null = null;
  private sculptHint: HTMLElement | null = null;

  private _orbitAngle = 0;
  private _elevation = 0;
  private _distance = 14;
  private viewOverrides: Record<string, boolean> = {};

  constructor(private bus: MessageBus) {
    this.unsub = bus.subscribe('audio:features', (msg: BusMessage<AudioFeatures>) => {
      this.latestFeatures = msg.payload;
    });

    this.positions = new Float32Array(MAX_PARTICLES * 3);
    this.velocities = new Float32Array(MAX_PARTICLES * 3);
    this.ages = new Float32Array(MAX_PARTICLES);
    this.lifetimes = new Float32Array(MAX_PARTICLES);
    this.sizes = new Float32Array(MAX_PARTICLES);
    this.speeds = new Float32Array(MAX_PARTICLES);
    this.alive = new Uint8Array(MAX_PARTICLES);
    this.emitterIndex = new Uint8Array(MAX_PARTICLES);

    this.smoothBass.reset(IDLE_FEATURES.bass);
    this.smoothMid.reset(IDLE_FEATURES.mid);
    this.smoothHigh.reset(IDLE_FEATURES.high);
    this.smoothRms.reset(IDLE_FEATURES.rms);
    this.smoothCentroid.reset(IDLE_FEATURES.spectralCentroid);

    this.emitters = createEmitters(NUM_EMITTERS);
    this._seedParticles(160);
  }

  attach(scene: THREE.Scene): void {
    this.sceneRef = scene;
    this.particleGeometry = new THREE.BufferGeometry();
    this.particleGeometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    this.particleGeometry.setAttribute('a_age', new THREE.BufferAttribute(this.ages, 1));
    this.particleGeometry.setAttribute('a_lifetime', new THREE.BufferAttribute(this.lifetimes, 1));
    this.particleGeometry.setAttribute('a_size', new THREE.BufferAttribute(this.sizes, 1));
    this.particleGeometry.setAttribute('a_speed', new THREE.BufferAttribute(this.speeds, 1));

    this.particleMaterial = new THREE.ShaderMaterial({
      vertexShader: PARTICLE_VERTEX_SHADER,
      fragmentShader: PARTICLE_FRAGMENT_SHADER,
      uniforms: {
        u_hueShift: { value: 0.0 },
        u_glowIntensity: { value: 1.0 },
        u_time: { value: 0.0 },
      },
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      transparent: true,
    });

    this.particlePoints = new THREE.Points(this.particleGeometry, this.particleMaterial);
    scene.add(this.particlePoints);

    // Attach sculpt interaction handlers
    const canvas = document.querySelector('canvas');
    if (canvas) {
      this.boundPointerDownHandler = (e: PointerEvent) => {
        this.pointerDownPos = { x: e.clientX, y: e.clientY };
      };
      this.boundClickHandler = (e: MouseEvent) => this._handleSculptClick(e, canvas, 'attractor');
      this.boundContextHandler = (e: MouseEvent) => {
        e.preventDefault();
        this._handleSculptClick(e, canvas, 'repulsor');
      };
      canvas.addEventListener('pointerdown', this.boundPointerDownHandler);
      canvas.addEventListener('click', this.boundClickHandler);
      canvas.addEventListener('contextmenu', this.boundContextHandler);
    }

    // Sculpt mode hint overlay
    this.sculptHint = document.createElement('div');
    Object.assign(this.sculptHint.style, {
      position: 'fixed', bottom: '80px', left: '50%', transform: 'translateX(-50%)',
      padding: '6px 16px', borderRadius: '20px',
      background: 'rgba(8, 8, 16, 0.7)', backdropFilter: 'blur(12px)',
      border: '1px solid rgba(255, 255, 255, 0.1)',
      color: 'rgba(255, 255, 255, 0.4)', fontFamily: 'system-ui, sans-serif',
      fontSize: '10px', letterSpacing: '0.08em', pointerEvents: 'none',
      zIndex: '80', opacity: '0', transition: 'opacity 0.3s ease',
      whiteSpace: 'nowrap',
    });
    this.sculptHint.textContent = 'Click to place attractor \u00B7 Right-click for repulsor';
    document.body.appendChild(this.sculptHint);
  }

  tick(): void {
    const dt = 1 / 60;
    this.time += dt;

    // Update sculpt hint visibility
    if (this.sculptHint) {
      this.sculptHint.style.opacity = this.userParams.sculptMode >= 0.5 ? '1' : '0';
    }

    const f = this.latestFeatures ?? IDLE_FEATURES;
    const bass = this.smoothBass.update(f.bass);
    const mid = this.smoothMid.update(f.mid);
    const high = this.smoothHigh.update(f.high);
    const rms = this.smoothRms.update(f.rms);
    const centroid = this.smoothCentroid.update(f.spectralCentroid);

    const bToG = this.userParams.bassToGravity;
    const mToS = this.userParams.midToSpeed;
    const rToG = this.userParams.rmsToGlow;
    const gravStrength = BASE_G * (0.4 + bass * 1.2 * bToG) * this.userParams.gravityMultiplier;
    const emitterSpeedMul = 0.4 + mid * 1.8 * mToS;
    const radiusBreath = (bass - 0.3) * 2.5 * bToG;
    const noiseStrength = BASE_NOISE_STRENGTH * (0.5 + high * 2.5) * this.userParams.noiseMultiplier;
    const spawnVelocityVariance = 0.3 + high * 1.5;
    const glowIntensity = (0.75 + rms * 1.0 * rToG) * this.userParams.glowMultiplier;
    const hueShift = centroid;
    const emissionRate = Math.floor(BASE_EMISSION_RATE + bass * 5);

    if (this.burstCooldown > 0) this.burstCooldown--;
    const doBurst = f.beatOnset && f.beatConfidence > 0.35 && this.burstCooldown === 0;
    if (doBurst) this.burstCooldown = 5;

    for (let i = 0; i < this.emitters.length; i++) {
      updateEmitterPosition(this.emitters[i], this.time, emitterSpeedMul, radiusBreath, 1.0);
    }

    const burstExtra = doBurst ? 15 : 0;
    for (let e = 0; e < this.emitters.length; e++) {
      let toEmit = emissionRate + burstExtra;
      for (let i = 0; i < MAX_PARTICLES && toEmit > 0; i++) {
        if (!this.alive[i]) {
          this._emitParticle(i, e, spawnVelocityVariance, doBurst);
          toEmit--;
        }
      }
    }

    // Update force fields
    this._tickForceFields(dt);

    this.activeCount = 0;
    const t = this.time;
    const fieldStrength = this.userParams.fieldStrength;

    for (let i = 0; i < MAX_PARTICLES; i++) {
      if (!this.alive[i]) continue;

      const idx = i * 3;
      this.ages[i] += dt;

      if (this.ages[i] >= this.lifetimes[i]) {
        this.alive[i] = 0;
        this.positions[idx] = 0;
        this.positions[idx + 1] = 0;
        this.positions[idx + 2] = -100;
        this.speeds[i] = 0;
        continue;
      }

      this.activeCount++;

      let vx = this.velocities[idx];
      let vy = this.velocities[idx + 1];
      let vz = this.velocities[idx + 2];
      const px = this.positions[idx];
      const py = this.positions[idx + 1];
      const pz = this.positions[idx + 2];

      // Central gravity
      const distSq = px * px + py * py + pz * pz;
      const dist = Math.sqrt(distSq + 0.05);
      const gravForce = gravStrength / Math.max(distSq, 0.8);
      vx += (-px / dist) * gravForce * dt;
      vy += (-py / dist) * gravForce * dt;
      vz += (-pz / dist) * gravForce * dt;

      // Curl noise
      const ns = NOISE_SCALE;
      const nx = Math.sin(py * ns + t * 0.9) * Math.cos(pz * ns * 1.3 + t * 0.3)
               + 0.3 * Math.sin(pz * ns * 2.1 + t * 1.7);
      const ny = Math.sin(pz * ns + t * 0.7) * Math.cos(px * ns * 1.1 + t * 0.5)
               + 0.3 * Math.sin(px * ns * 1.9 + t * 1.3);
      const nz = Math.sin(px * ns + t * 1.1) * Math.cos(py * ns * 0.9 + t * 0.4)
               + 0.3 * Math.sin(py * ns * 2.3 + t * 1.1);
      vx += nx * noiseStrength * dt;
      vy += ny * noiseStrength * dt;
      vz += nz * noiseStrength * dt;

      // Emitter attraction
      const eIdx = this.emitterIndex[i];
      if (eIdx < this.emitters.length) {
        const ep = this.emitters[eIdx].position;
        const edx = ep[0] - px, edy = ep[1] - py, edz = ep[2] - pz;
        const eDist = Math.sqrt(edx * edx + edy * edy + edz * edz + 0.1);
        if (eDist < 5.0) {
          const ePull = 0.08 / (eDist + 0.8);
          vx += edx / eDist * ePull * dt;
          vy += edy / eDist * ePull * dt;
          vz += edz / eDist * ePull * dt;
        }
      }

      // Force fields (attractors / repulsors)
      for (const ff of this.forceFields) {
        const lifeRatio = 1.0 - ff.age / ff.lifetime;
        if (lifeRatio <= 0) continue;
        const fPos = ff.position;
        const fdx = fPos.x - px, fdy = fPos.y - py, fdz = fPos.z - pz;
        const fDistSq = fdx * fdx + fdy * fdy + fdz * fdz;
        if (fDistSq > 400 || fDistSq < 0.1) continue;
        const fDist = Math.sqrt(fDistSq);
        const strength = (fieldStrength * ff.strength * lifeRatio * 60.0) / fDistSq;
        const sign = ff.type === 'attractor' ? 1 : -1;
        vx += sign * (fdx / fDist) * strength * dt;
        vy += sign * (fdy / fDist) * strength * dt;
        vz += sign * (fdz / fDist) * strength * dt;
      }

      const damp = Math.pow(DAMPING, dt * 60);
      vx *= damp; vy *= damp; vz *= damp;

      this.velocities[idx] = vx;
      this.velocities[idx + 1] = vy;
      this.velocities[idx + 2] = vz;

      this.positions[idx] += vx * dt;
      this.positions[idx + 1] += vy * dt;
      this.positions[idx + 2] += vz * dt;

      this.speeds[i] = Math.sqrt(vx * vx + vy * vy + vz * vz);

      const life = this.ages[i] / this.lifetimes[i];
      const shimmer = 1.0 + high * 0.5 * Math.sin(t * 15 + i * 1.7);
      const sizeFade = life < 0.1 ? life / 0.1 : 1.0 - Math.pow(Math.max(0, life - 0.55) * 2.2, 2);
      this.sizes[i] = Math.max(0.4, (1.4 + rms * 1.6) * shimmer * Math.max(0, sizeFade));
    }

    if (this.particleGeometry) {
      (this.particleGeometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
      (this.particleGeometry.attributes.a_age as THREE.BufferAttribute).needsUpdate = true;
      (this.particleGeometry.attributes.a_lifetime as THREE.BufferAttribute).needsUpdate = true;
      (this.particleGeometry.attributes.a_size as THREE.BufferAttribute).needsUpdate = true;
      (this.particleGeometry.attributes.a_speed as THREE.BufferAttribute).needsUpdate = true;
    }

    if (this.particleMaterial) {
      this.particleMaterial.uniforms.u_hueShift.value = hueShift;
      this.particleMaterial.uniforms.u_glowIntensity.value = glowIntensity;
      this.particleMaterial.uniforms.u_time.value = this.time;
    }
  }

  setResolution(_width: number, _height: number): void {}

  setUserParam(key: string, value: number): void {
    if (key in this.userParams) this.userParams[key] = value;
  }

  getViewState(): Record<string, number> {
    return { orbitAngle: this._orbitAngle, elevation: this._elevation, distance: this._distance };
  }

  setViewState(partial: Record<string, number>): void {
    if ('orbitAngle' in partial) { this._orbitAngle = partial.orbitAngle; this.viewOverrides.orbit = true; }
    if ('elevation' in partial) { this._elevation = Math.max(-1.5, Math.min(1.5, partial.elevation)); }
    if ('distance' in partial) { this._distance = Math.max(4, Math.min(30, partial.distance)); }
  }

  getCameraPosition(): { x: number; y: number; z: number } {
    return {
      x: Math.sin(this._orbitAngle) * this._distance,
      y: this._elevation * this._distance * 0.3,
      z: Math.cos(this._orbitAngle) * this._distance,
    };
  }

  dispose(): void {
    this.unsub();
    this.particleMaterial?.dispose();
    this.particleGeometry?.dispose();
    if (this.sceneRef) {
      if (this.particlePoints) this.sceneRef.remove(this.particlePoints);
      for (const ff of this.forceFields) {
        this.sceneRef.remove(ff.mesh);
        disposeFieldMesh(ff.mesh);
      }
    }
    this.forceFields = [];
    const canvas = document.querySelector('canvas');
    if (canvas) {
      if (this.boundClickHandler) canvas.removeEventListener('click', this.boundClickHandler);
      if (this.boundContextHandler) canvas.removeEventListener('contextmenu', this.boundContextHandler);
      if (this.boundPointerDownHandler) canvas.removeEventListener('pointerdown', this.boundPointerDownHandler);
    }
    if (this.sculptHint) {
      this.sculptHint.remove();
      this.sculptHint = null;
    }
  }

  // --- Force field management ---

  private _handleSculptClick(e: MouseEvent, canvas: HTMLCanvasElement, fieldType: 'attractor' | 'repulsor'): void {
    if (this.userParams.sculptMode < 0.5) return;
    if (e.target !== canvas) return;

    // Suppress placement if the pointer moved (was a drag, not a click)
    if (this.pointerDownPos) {
      const dx = e.clientX - this.pointerDownPos.x;
      const dy = e.clientY - this.pointerDownPos.y;
      if (dx * dx + dy * dy > 25) return;
    }

    const rect = canvas.getBoundingClientRect();
    const mouse = new THREE.Vector2(
      ((e.clientX - rect.left) / rect.width) * 2 - 1,
      -((e.clientY - rect.top) / rect.height) * 2 + 1,
    );

    const globals = (window as any).__cybernoetica;
    const perspCamera = globals?.scene?.perspCamera as THREE.PerspectiveCamera | undefined;
    if (!perspCamera) return;

    this.raycaster.setFromCamera(mouse, perspCamera);
    const cameraDir = new THREE.Vector3();
    perspCamera.getWorldDirection(cameraDir);
    this.clickPlane.normal.copy(cameraDir);
    this.clickPlane.constant = 0;

    const intersection = new THREE.Vector3();
    if (!this.raycaster.ray.intersectPlane(this.clickPlane, intersection)) return;

    this._addForceField(intersection, fieldType);
  }

  private _addForceField(position: THREE.Vector3, type: 'attractor' | 'repulsor'): void {
    if (!this.sceneRef) return;

    // Evict oldest if at capacity
    if (this.forceFields.length >= MAX_FORCE_FIELDS) {
      const oldest = this.forceFields.shift()!;
      this.sceneRef.remove(oldest.mesh);
      disposeFieldMesh(oldest.mesh);
    }

    const mesh = type === 'attractor' ? createAttractorMesh() : createRepulsorMesh();
    mesh.position.copy(position);
    this.sceneRef.add(mesh);

    this.forceFields.push({
      position: position.clone(),
      type,
      strength: 1.0,
      age: 0,
      lifetime: this.userParams.fieldLifetime,
      mesh,
    });
  }

  private _tickForceFields(dt: number): void {
    for (let i = this.forceFields.length - 1; i >= 0; i--) {
      const ff = this.forceFields[i];
      ff.age += dt;

      if (ff.age >= ff.lifetime) {
        if (this.sceneRef) this.sceneRef.remove(ff.mesh);
        disposeFieldMesh(ff.mesh);
        this.forceFields.splice(i, 1);
        continue;
      }

      const lifeRatio = 1.0 - ff.age / ff.lifetime;
      const fadeIn = Math.min(1.0, ff.age / 0.5);
      const fadeOut = lifeRatio;
      const opacity = fadeIn * fadeOut;

      if (ff.type === 'attractor') {
        const pulse = 1 + Math.sin(this.time * 5) * 0.1;
        ff.mesh.scale.setScalar(pulse * opacity);
        ff.mesh.children.forEach(child => {
          const mat = (child as THREE.Mesh).material as THREE.MeshBasicMaterial;
          if (mat) mat.opacity = opacity * (child === ff.mesh.children[0] ? 0.15 : 0.8);
        });
      } else {
        ff.mesh.children.forEach((child, j) => {
          if (j === 3) {
            child.scale.setScalar(opacity);
            return;
          }
          const phase = (this.time * 0.8 + j * 0.33) % 1;
          const scale = (0.3 + phase * 3.0) * opacity;
          child.scale.setScalar(scale);
          const mat = (child as THREE.Mesh).material as THREE.MeshBasicMaterial;
          if (mat) mat.opacity = Math.sin(phase * Math.PI) * 0.4 * opacity;
        });
      }
    }
  }

  // --- Particle helpers ---

  private _seedParticles(count: number): void {
    for (let i = 0; i < this.emitters.length; i++) {
      updateEmitterPosition(this.emitters[i], 0, 1.0, 0, 0);
    }
    for (let i = 0; i < count && i < MAX_PARTICLES; i++) {
      const eIdx = i % this.emitters.length;
      this._emitParticle(i, eIdx, 0.5, false);
      this.ages[i] = Math.random() * this.lifetimes[i] * 0.4;
      const angle = Math.random() * Math.PI * 2;
      const phi = (Math.random() - 0.5) * Math.PI;
      const radius = 1.5 + Math.random() * 3.5;
      const idx = i * 3;
      this.positions[idx] = Math.cos(angle) * Math.cos(phi) * radius;
      this.positions[idx + 1] = Math.sin(phi) * radius;
      this.positions[idx + 2] = Math.sin(angle) * Math.cos(phi) * radius;
      const speed = 0.2 + Math.random() * 0.4;
      this.velocities[idx] = -Math.sin(angle) * speed;
      this.velocities[idx + 1] = (Math.random() - 0.5) * speed * 0.5;
      this.velocities[idx + 2] = Math.cos(angle) * speed;
    }
    this.activeCount = count;
  }

  private _emitParticle(i: number, emitterIdx: number, velocityVariance: number, burst: boolean): void {
    const idx = i * 3;
    const emitter = this.emitters[emitterIdx];
    const [ex, ey, ez] = emitter.position;

    const spread = burst ? 0.5 : 0.2;
    this.positions[idx] = ex + (Math.random() - 0.5) * spread;
    this.positions[idx + 1] = ey + (Math.random() - 0.5) * spread;
    this.positions[idx + 2] = ez + (Math.random() - 0.5) * spread;

    const radial = Math.sqrt(ex * ex + ey * ey + ez * ez) + 0.01;
    const rx = ex / radial, ry = ey / radial, rz = ez / radial;
    let ux = 0, uy = 1, uz = 0;
    if (Math.abs(ry) > 0.9) { ux = 1; uy = 0; uz = 0; }
    const tangX = ry * uz - rz * uy;
    const tangY = rz * ux - rx * uz;
    const tangZ = rx * uy - ry * ux;
    const tangLen = Math.sqrt(tangX * tangX + tangY * tangY + tangZ * tangZ) + 0.001;

    const baseSpeed = burst ? 0.7 : 0.25;
    const speedNoise = Math.random() * velocityVariance;
    const s = (baseSpeed + speedNoise) / tangLen;

    this.velocities[idx] = tangX * s + (Math.random() - 0.5) * 0.2;
    this.velocities[idx + 1] = tangY * s + (Math.random() - 0.5) * 0.2;
    this.velocities[idx + 2] = tangZ * s + (Math.random() - 0.5) * 0.2;

    this.lifetimes[i] = MAX_LIFETIME * (0.35 + Math.random() * 0.65);
    this.ages[i] = 0;
    this.sizes[i] = 1.4 + Math.random() * 2.0;
    this.speeds[i] = baseSpeed + speedNoise;
    this.alive[i] = 1;
    this.emitterIndex[i] = emitterIdx;
  }
}

registerVisualizer({
  metadata: orbitalGammaMetadata,
  create: (bus) => new OrbitalGammaVisualizer(bus),
});
