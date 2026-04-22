import * as THREE from 'three';
import { MessageBus } from '@cybernoetica/core';
import type { AudioFeatures, BusMessage, Unsubscribe } from '@cybernoetica/core';
import { EMASmoothing } from '../../smoothing.js';
import type { Visualizer, VisualizerMetadata } from '../types.js';
import { registerVisualizer } from '../registry.js';

/**
 * Math note:
 *   This is a stylized particle system, not a direct simulation of a named
 *   dynamical system. Its central pull is implemented as an inverse-square-like
 *   force with damping plus procedural turbulence.
 * Reference: https://scienceworld.wolfram.com/physics/InverseSquareLaw.html
 */

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Maximum number of particles in the system */
const MAX_PARTICLES = 5000;

/** Number of orbiting emitters */
const NUM_EMITTERS = 4;

/** Base emission rate (particles per tick per emitter) */
const BASE_EMISSION_RATE = 2;

/** Maximum particle lifetime in seconds */
const MAX_LIFETIME = 6.0;

/** Base gravitational constant */
const BASE_G = 2.5;

/** Damping factor per frame */
const DAMPING = 0.97;

/** Noise scale for curl-like turbulence */
const NOISE_SCALE = 1.2;

/** Base noise strength */
const BASE_NOISE_STRENGTH = 0.3;

/** Default idle audio features for when no audio is connected */
const IDLE_FEATURES: AudioFeatures = {
  fftBins: new Float32Array(0),
  bass: 0.25,
  mid: 0.3,
  high: 0.15,
  spectralCentroid: 0.4,
  spectralFlux: 0.05,
  rms: 0.2,
  beatOnset: false,
  beatConfidence: 0.0,
  degraded: false,
};

// ---------------------------------------------------------------------------
// Emitter definition
// ---------------------------------------------------------------------------

interface Emitter {
  /** Base orbital radius */
  baseRadius: number;
  /** Orbital speed (radians per second) */
  speed: number;
  /** Phase offset */
  phase: number;
  /** Tilt angle of orbital plane (radians) */
  tilt: number;
  /** Current 3D position */
  position: [number, number, number];
}

function createEmitters(count: number): Emitter[] {
  const emitters: Emitter[] = [];
  for (let i = 0; i < count; i++) {
    const t = i / count;
    emitters.push({
      baseRadius: 2.0 + t * 3.0,
      speed: 0.3 + (1 - t) * 0.5,
      phase: t * Math.PI * 2,
      tilt: (t - 0.5) * Math.PI * 0.6,
      position: [0, 0, 0],
    });
  }
  return emitters;
}

function updateEmitterPosition(
  emitter: Emitter,
  time: number,
  speedMul: number,
  radiusBreath: number,
): void {
  const angle = time * emitter.speed * speedMul + emitter.phase;
  const r = emitter.baseRadius * (1.0 + radiusBreath * 0.3);
  const x = r * Math.cos(angle);
  const yFlat = r * Math.sin(angle);
  const cosTilt = Math.cos(emitter.tilt);
  const sinTilt = Math.sin(emitter.tilt);
  emitter.position[0] = x;
  emitter.position[1] = yFlat * cosTilt;
  emitter.position[2] = yFlat * sinTilt;
}

// ---------------------------------------------------------------------------
// Shaders
// ---------------------------------------------------------------------------

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

    float glow = exp(-r * 6.0);  // tighter falloff
    float core = exp(-r * 16.0);
    float intensity = (glow * 0.6 + core * 0.4) * u_glowIntensity;

    // Fade over lifetime
    float fadeIn = smoothstep(0.0, 0.05, v_life);
    float fadeOut = 1.0 - smoothstep(0.5, 1.0, v_life);
    float alpha = fadeIn * fadeOut * intensity;

    // Color: shift from bright hue to warm ember over lifetime
    float baseHue = mix(0.65, 0.08, u_hueShift);
    float hue = baseHue + v_life * 0.15;  // shift toward warm as particle ages
    float sat = mix(0.8, 0.4, v_life);
    float val = mix(1.0, 0.6, v_life);

    vec3 color = hsv2rgb(vec3(fract(hue), sat, val));
    color = mix(color, vec3(1.0), core * 0.3);  // white hot core

    gl_FragColor = vec4(color * alpha, alpha);
  }
`;

// ---------------------------------------------------------------------------
// Metadata
// ---------------------------------------------------------------------------

const orbitalMetadata: VisualizerMetadata = {
  type: 'orbital',
  label: 'Orbital Alpha',
  description: 'Particle vortex with comet attractors',
  usesPerspective: true,
  params: [
    // Appearance
    { key: 'glowMultiplier', label: 'Glow', min: 0.3, max: 2.5, step: 0.1, initial: 1.0, category: 'appearance' },
    { key: 'gravityMultiplier', label: 'Gravity', min: 0.2, max: 3.0, step: 0.1, initial: 1.0, category: 'appearance' },
    { key: 'noiseMultiplier', label: 'Turbulence', min: 0.0, max: 3.0, step: 0.1, initial: 1.0, category: 'appearance' },
    // Audio mapping strengths
    { key: 'bassToGravity', label: 'Bass \u2192 Gravity', min: 0.0, max: 2.0, step: 0.1, initial: 1.0, category: 'audio-mapping', description: 'How strongly bass affects gravitational pull' },
    { key: 'midToSpeed', label: 'Mid \u2192 Speed', min: 0.0, max: 2.0, step: 0.1, initial: 1.0, category: 'audio-mapping', description: 'How strongly mids affect emitter orbit speed' },
    { key: 'rmsToGlow', label: 'RMS \u2192 Glow', min: 0.0, max: 2.0, step: 0.1, initial: 1.0, category: 'audio-mapping', description: 'How strongly overall volume affects glow intensity' },
  ],
  viewport: { pan: false, zoom: true, orbit: true },
  viewStateFields: [
    { key: 'orbitAngle', label: 'Orbit Angle', min: 0, max: 6.283, step: 0.05 },
    { key: 'elevation', label: 'Elevation', min: -1.5, max: 1.5, step: 0.05 },
    { key: 'distance', label: 'Distance', min: 4, max: 30, step: 0.5 },
  ],
};

// ---------------------------------------------------------------------------
// OrbitalVisualizer
// ---------------------------------------------------------------------------

export class OrbitalVisualizer implements Visualizer {
  readonly metadata = orbitalMetadata;

  /** Backward-compat: SceneManager reads this directly until Phase 3 refactor */
  readonly usesPerspective = true;

  userParams: Record<string, number> = {
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

  // Smoothed audio parameters
  private smoothBass = new EMASmoothing(0.18);
  private smoothMid = new EMASmoothing(0.20);
  private smoothHigh = new EMASmoothing(0.15);
  private smoothRms = new EMASmoothing(0.20);
  private smoothCentroid = new EMASmoothing(0.10);

  // Particle data arrays
  private positions: Float32Array;
  private velocities: Float32Array;
  private ages: Float32Array;
  private lifetimes: Float32Array;
  private sizes: Float32Array;
  private speeds: Float32Array;
  private alive: Uint8Array;
  /** Which emitter spawned this particle (index) */
  private emitterIndex: Uint8Array;
  private activeCount = 0;

  // Three.js objects (created on attach)
  private particleGeometry: THREE.BufferGeometry | null = null;
  private particleMaterial: THREE.ShaderMaterial | null = null;
  private particlePoints: THREE.Points | null = null;
  private sceneRef: THREE.Scene | null = null;

  // Orbiting emitters
  private emitters: Emitter[];

  // Beat burst state
  private burstCooldown = 0;

  // Camera view state (spherical coordinates around origin)
  private _orbitAngle = 0;
  private _elevation = 0;
  private _distance = 12;
  private viewOverrides: Record<string, boolean> = {};

  constructor(private bus: MessageBus) {
    this.unsub = bus.subscribe('audio:features', (msg: BusMessage<AudioFeatures>) => {
      this.latestFeatures = msg.payload;
    });

    // Allocate particle arrays
    this.positions = new Float32Array(MAX_PARTICLES * 3);
    this.velocities = new Float32Array(MAX_PARTICLES * 3);
    this.ages = new Float32Array(MAX_PARTICLES);
    this.lifetimes = new Float32Array(MAX_PARTICLES);
    this.sizes = new Float32Array(MAX_PARTICLES);
    this.speeds = new Float32Array(MAX_PARTICLES);
    this.alive = new Uint8Array(MAX_PARTICLES);
    this.emitterIndex = new Uint8Array(MAX_PARTICLES);

    // Initialize smoothers with idle defaults
    this.smoothBass.reset(IDLE_FEATURES.bass);
    this.smoothMid.reset(IDLE_FEATURES.mid);
    this.smoothHigh.reset(IDLE_FEATURES.high);
    this.smoothRms.reset(IDLE_FEATURES.rms);
    this.smoothCentroid.reset(IDLE_FEATURES.spectralCentroid);

    // Create orbiting emitters
    this.emitters = createEmitters(NUM_EMITTERS);

    // Seed initial particles so there's always something visible
    this._seedParticles(150);
  }

  // -----------------------------------------------------------------------
  // Public API
  // -----------------------------------------------------------------------

  attach(scene: THREE.Scene): void {
    this.sceneRef = scene;

    // --- Particle system ---
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
  }

  tick(): void {
    const dt = 1 / 60;
    this.time += dt;

    // Read audio (use idle features if none yet)
    const f = this.latestFeatures ?? IDLE_FEATURES;

    // Smooth the audio parameters
    const bass = this.smoothBass.update(f.bass);
    const mid = this.smoothMid.update(f.mid);
    const high = this.smoothHigh.update(f.high);
    const rms = this.smoothRms.update(f.rms);
    const centroid = this.smoothCentroid.update(f.spectralCentroid);

    // Derived parameters (incorporating user multipliers + audio mapping strengths)
    const bToG = this.userParams.bassToGravity;
    const mToS = this.userParams.midToSpeed;
    const rToG = this.userParams.rmsToGlow;
    const gravStrength = BASE_G * (0.5 + bass * 1.5 * bToG) * this.userParams.gravityMultiplier;
    const emitterSpeedMul = 0.5 + mid * 2.0 * mToS;
    const radiusBreath = (bass - 0.3) * 2.0 * bToG;
    const noiseStrength = BASE_NOISE_STRENGTH * (0.3 + high * 2.0) * this.userParams.noiseMultiplier;
    const spawnVelocityVariance = 0.2 + high * 1.5;
    const glowIntensity = (0.8 + rms * 1.0 * rToG) * this.userParams.glowMultiplier;
    const hueShift = centroid; // 0 = deep blue, 1 = warm gold
    const emissionRate = Math.floor(BASE_EMISSION_RATE + bass * 6);

    // Beat burst
    if (this.burstCooldown > 0) this.burstCooldown--;
    const doBurst = f.beatOnset && f.beatConfidence > 0.4 && this.burstCooldown === 0;
    if (doBurst) {
      this.burstCooldown = 6;
    }

    // Update emitter positions
    for (let i = 0; i < this.emitters.length; i++) {
      updateEmitterPosition(this.emitters[i], this.time, emitterSpeedMul, radiusBreath);
    }

    // Emit new particles from each emitter
    const burstExtra = doBurst ? 20 : 0;
    for (let e = 0; e < this.emitters.length; e++) {
      let toEmit = emissionRate + burstExtra;
      for (let i = 0; i < MAX_PARTICLES && toEmit > 0; i++) {
        if (!this.alive[i]) {
          this._emitParticle(i, e, spawnVelocityVariance, doBurst);
          toEmit--;
        }
      }
    }

    // Physics update for all alive particles
    this.activeCount = 0;
    const t = this.time;

    for (let i = 0; i < MAX_PARTICLES; i++) {
      if (!this.alive[i]) continue;

      const idx = i * 3;
      this.ages[i] += dt;

      // Kill old particles
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

      // --- Gravity toward center ---
      const distSq = px * px + py * py + pz * pz;
      const dist = Math.sqrt(distSq + 0.01); // softening
      const gravForce = gravStrength / Math.max(distSq, 0.5);
      vx += (-px / dist) * gravForce * dt;
      vy += (-py / dist) * gravForce * dt;
      vz += (-pz / dist) * gravForce * dt;

      // --- Curl-like noise (sine-based approximation) ---
      const ns = NOISE_SCALE;
      const nx = Math.sin(py * ns + t) * Math.cos(pz * ns);
      const ny = Math.sin(pz * ns + t) * Math.cos(px * ns);
      const nz = Math.sin(px * ns + t) * Math.cos(py * ns);
      vx += nx * noiseStrength * dt;
      vy += ny * noiseStrength * dt;
      vz += nz * noiseStrength * dt;

      // --- Emitter attraction (slight pull toward spawning emitter) ---
      const eIdx = this.emitterIndex[i];
      if (eIdx < this.emitters.length) {
        const ep = this.emitters[eIdx].position;
        const edx = ep[0] - px;
        const edy = ep[1] - py;
        const edz = ep[2] - pz;
        const eDist = Math.sqrt(edx * edx + edy * edy + edz * edz + 0.1);
        // Only attract if reasonably close
        if (eDist < 3.0) {
          const ePull = 0.15 / (eDist + 0.5);
          vx += edx / eDist * ePull * dt;
          vy += edy / eDist * ePull * dt;
          vz += edz / eDist * ePull * dt;
        }
      }

      // --- Damping ---
      const damp = Math.pow(DAMPING, dt * 60); // frame-rate independent
      vx *= damp;
      vy *= damp;
      vz *= damp;

      // Store velocity
      this.velocities[idx] = vx;
      this.velocities[idx + 1] = vy;
      this.velocities[idx + 2] = vz;

      // Update position
      this.positions[idx] += vx * dt;
      this.positions[idx + 1] += vy * dt;
      this.positions[idx + 2] += vz * dt;

      // Compute speed for shader
      this.speeds[i] = Math.sqrt(vx * vx + vy * vy + vz * vz);

      // Update size — slight shimmer with high
      const life = this.ages[i] / this.lifetimes[i];
      const shimmer = 1.0 + high * 0.4 * Math.sin(t * 18 + i * 1.3);
      const sizeFade = life < 0.1 ? life / 0.1 : 1.0 - Math.pow(Math.max(0, life - 0.6) * 2.5, 2);
      this.sizes[i] = Math.max(0.5, (1.5 + rms * 1.5) * shimmer * Math.max(0, sizeFade));
    }

    // Update Three.js buffers
    if (this.particleGeometry) {
      (this.particleGeometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
      (this.particleGeometry.attributes.a_age as THREE.BufferAttribute).needsUpdate = true;
      (this.particleGeometry.attributes.a_lifetime as THREE.BufferAttribute).needsUpdate = true;
      (this.particleGeometry.attributes.a_size as THREE.BufferAttribute).needsUpdate = true;
      (this.particleGeometry.attributes.a_speed as THREE.BufferAttribute).needsUpdate = true;
    }

    // Update uniforms
    if (this.particleMaterial) {
      this.particleMaterial.uniforms.u_hueShift.value = hueShift;
      this.particleMaterial.uniforms.u_glowIntensity.value = glowIntensity;
      this.particleMaterial.uniforms.u_time.value = this.time;
    }
  }

  setResolution(_width: number, _height: number): void {
    // Particle system is 3D — resolution mostly affects the renderer, not us.
    // Could be used for density scaling in the future.
  }

  getParticleCount(): number {
    return this.activeCount;
  }

  setUserParam(key: string, value: number): void {
    if (key in this.userParams) {
      this.userParams[key] = value;
    }
  }

  getViewState(): Record<string, number> {
    return {
      orbitAngle: this._orbitAngle,
      elevation: this._elevation,
      distance: this._distance,
    };
  }

  setViewState(partial: Record<string, number>): void {
    if ('orbitAngle' in partial) {
      this._orbitAngle = partial.orbitAngle;
      this.viewOverrides.orbit = true;
    }
    if ('elevation' in partial) {
      this._elevation = Math.max(-1.5, Math.min(1.5, partial.elevation));
      this.viewOverrides.elevation = true;
    }
    if ('distance' in partial) {
      this._distance = Math.max(4, Math.min(30, partial.distance));
    }
  }

  /** Called by VisualizerManager to get camera position for perspective rendering */
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
    }
  }

  // -----------------------------------------------------------------------
  // Private helpers
  // -----------------------------------------------------------------------

  /** Seed particles for the initial state so the scene isn't empty */
  private _seedParticles(count: number): void {
    // Place emitters at their initial positions
    for (let i = 0; i < this.emitters.length; i++) {
      updateEmitterPosition(this.emitters[i], 0, 1.0, 0);
    }

    for (let i = 0; i < count && i < MAX_PARTICLES; i++) {
      const eIdx = i % this.emitters.length;
      this._emitParticle(i, eIdx, 0.5, false);
      // Scatter them in different life stages
      this.ages[i] = Math.random() * this.lifetimes[i] * 0.4;
      // Spread positions out along orbital paths
      const angle = Math.random() * Math.PI * 2;
      const radius = 1.0 + Math.random() * 3.0;
      const tiltAngle = (Math.random() - 0.5) * 0.8;
      const idx = i * 3;
      this.positions[idx] = Math.cos(angle) * radius;
      this.positions[idx + 1] = Math.sin(angle) * radius * Math.cos(tiltAngle);
      this.positions[idx + 2] = Math.sin(angle) * radius * Math.sin(tiltAngle);
      // Give them some tangential velocity for initial orbital motion
      const speed = 0.3 + Math.random() * 0.3;
      this.velocities[idx] = -Math.sin(angle) * speed;
      this.velocities[idx + 1] = Math.cos(angle) * speed * Math.cos(tiltAngle);
      this.velocities[idx + 2] = Math.cos(angle) * speed * Math.sin(tiltAngle);
    }
    this.activeCount = count;
  }

  /** Emit a single particle from a specific emitter */

  private _emitParticle(
    i: number,
    emitterIdx: number,
    velocityVariance: number,
    burst: boolean,
  ): void {
    const idx = i * 3;
    const emitter = this.emitters[emitterIdx];
    const [ex, ey, ez] = emitter.position;

    // Position: at emitter with slight randomness
    const spread = burst ? 0.4 : 0.15;
    this.positions[idx] = ex + (Math.random() - 0.5) * spread;
    this.positions[idx + 1] = ey + (Math.random() - 0.5) * spread;
    this.positions[idx + 2] = ez + (Math.random() - 0.5) * spread;

    // Velocity: tangential to orbit + outward scatter + variance
    // Tangential direction (perpendicular to radial, in the orbital plane)
    const radial = Math.sqrt(ex * ex + ey * ey + ez * ez) + 0.01;
    const baseSpeed = burst ? 0.8 : 0.2;
    const speedNoise = Math.random() * velocityVariance;

    // Build a real 3D tangent so tilted emitters do not collapse back into the XY plane.
    const rx = ex / radial;
    const ry = ey / radial;
    const rz = ez / radial;
    const refX = Math.abs(rz) > 0.9 ? 0 : 0;
    const refY = Math.abs(rz) > 0.9 ? 1 : 0;
    const refZ = Math.abs(rz) > 0.9 ? 0 : 1;
    let tangX = ry * refZ - rz * refY;
    let tangY = rz * refX - rx * refZ;
    let tangZ = rx * refY - ry * refX;
    const tangLen = Math.hypot(tangX, tangY, tangZ) || 1;
    tangX /= tangLen;
    tangY /= tangLen;
    tangZ /= tangLen;

    this.velocities[idx] = tangX * (baseSpeed + speedNoise) + (Math.random() - 0.5) * 0.15;
    this.velocities[idx + 1] = tangY * (baseSpeed + speedNoise) + (Math.random() - 0.5) * 0.15;
    this.velocities[idx + 2] = tangZ * (baseSpeed + speedNoise) + (Math.random() - 0.5) * 0.15;

    // Lifetime (in seconds)
    this.lifetimes[i] = MAX_LIFETIME * (0.4 + Math.random() * 0.6);
    this.ages[i] = 0;
    this.sizes[i] = 1.5 + Math.random() * 2.0;
    this.speeds[i] = baseSpeed + speedNoise;
    this.alive[i] = 1;
    this.emitterIndex[i] = emitterIdx;
  }
}

registerVisualizer({
  metadata: orbitalMetadata,
  create: (bus) => new OrbitalVisualizer(bus),
});
