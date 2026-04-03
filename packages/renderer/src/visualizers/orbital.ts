import * as THREE from 'three';
import { MessageBus } from '@cybernoetica/core';
import type { AudioFeatures, BusMessage, Unsubscribe } from '@cybernoetica/core';
import { EMASmoothing } from '../smoothing.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Maximum number of particles in the system */
const MAX_PARTICLES = 5000;

/** Number of comet attractors */
const NUM_COMETS = 4;

/** Base emission rate (particles per tick) */
const BASE_EMISSION_RATE = 8;

/** Maximum particle lifetime in ticks (~seconds * 60) */
const MAX_LIFETIME = 360;

/** Gravitational constant for attractor pull */
const G = 0.00035;

/** Drag coefficient — gentle slowdown */
const DRAG = 0.997;

/** Spiral inward force */
const SPIRAL_STRENGTH = 0.00004;

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
// Comet orbit patterns
// ---------------------------------------------------------------------------

interface CometOrbit {
  /** Compute (x, y, z) position at time t */
  position(t: number): [number, number, number];
}

/** Elliptical orbit in the XY plane */
function ellipticalOrbit(a: number, b: number, speed: number, phase: number, tilt: number): CometOrbit {
  const cosTilt = Math.cos(tilt);
  const sinTilt = Math.sin(tilt);
  return {
    position(t: number) {
      const angle = t * speed + phase;
      const x = a * Math.cos(angle);
      const yFlat = b * Math.sin(angle);
      const y = yFlat * cosTilt;
      const z = yFlat * sinTilt;
      return [x, y, z];
    },
  };
}

/** Figure-8 (lemniscate) orbit */
function figure8Orbit(scale: number, speed: number, phase: number, tilt: number): CometOrbit {
  const cosTilt = Math.cos(tilt);
  const sinTilt = Math.sin(tilt);
  return {
    position(t: number) {
      const angle = t * speed + phase;
      const denom = 1 + Math.sin(angle) * Math.sin(angle);
      const x = scale * Math.cos(angle) / denom;
      const yFlat = scale * Math.sin(angle) * Math.cos(angle) / denom;
      const y = yFlat * cosTilt;
      const z = yFlat * sinTilt;
      return [x, y, z];
    },
  };
}

/** Spiral orbit — slowly expanding and contracting */
function spiralOrbit(baseRadius: number, speed: number, phase: number, wobble: number): CometOrbit {
  return {
    position(t: number) {
      const angle = t * speed + phase;
      const r = baseRadius + wobble * Math.sin(angle * 0.3);
      const x = r * Math.cos(angle);
      const y = r * Math.sin(angle);
      const z = wobble * 0.4 * Math.sin(angle * 0.7);
      return [x, y, z];
    },
  };
}

// ---------------------------------------------------------------------------
// Shaders
// ---------------------------------------------------------------------------

const PARTICLE_VERTEX_SHADER = /* glsl */ `
  attribute float a_lifetime;
  attribute float a_age;
  attribute float a_size;

  varying float v_life;   // 0 = newborn, 1 = dead
  varying float v_size;

  void main() {
    v_life = clamp(a_age / max(a_lifetime, 1.0), 0.0, 1.0);
    v_size = a_size;

    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    // Size attenuation: larger when close
    gl_PointSize = a_size * (200.0 / -mvPosition.z);
    gl_Position = projectionMatrix * mvPosition;
  }
`;

const PARTICLE_FRAGMENT_SHADER = /* glsl */ `
  precision highp float;

  uniform float u_hueShift;
  uniform float u_glowIntensity;
  uniform float u_time;

  varying float v_life;
  varying float v_size;

  // HSV to RGB conversion
  vec3 hsv2rgb(vec3 c) {
    vec3 p = abs(fract(c.xxx + vec3(1.0, 2.0/3.0, 1.0/3.0)) * 6.0 - 3.0);
    return c.z * mix(vec3(1.0), clamp(p - 1.0, 0.0, 1.0), c.y);
  }

  void main() {
    // Radial distance from point center — soft glow falloff
    vec2 cxy = 2.0 * gl_PointCoord - 1.0;
    float r = dot(cxy, cxy);
    if (r > 1.0) discard;

    // Soft glow: bright core, fading halo
    float glow = exp(-r * 3.0);
    float core = exp(-r * 10.0);
    float intensity = mix(glow, core, 0.3) * u_glowIntensity;

    // Fade in quickly, fade out slowly
    float fadeIn = smoothstep(0.0, 0.05, v_life);
    float fadeOut = 1.0 - smoothstep(0.6, 1.0, v_life);
    float alpha = fadeIn * fadeOut * intensity;

    // Color: deep blues/purples shift to warm golds/oranges via hue
    // Base hue around 0.65 (blue-purple), shifting toward 0.08 (gold-orange)
    float baseHue = mix(0.65, 0.08, u_hueShift);
    // Add slight per-particle variation based on life
    float hue = baseHue + 0.05 * sin(v_life * 6.28 + u_time * 0.5);
    float saturation = mix(0.8, 0.5, v_life); // desaturate as they age
    float value = 1.0;

    vec3 color = hsv2rgb(vec3(fract(hue), saturation, value));

    // Hot white core
    color = mix(color, vec3(1.0), core * 0.6);

    gl_FragColor = vec4(color * alpha, alpha);
  }
`;

// Vertex shader for the vortex core glow mesh
const VORTEX_VERTEX_SHADER = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

// Fragment shader for the vortex core
const VORTEX_FRAGMENT_SHADER = /* glsl */ `
  precision highp float;
  uniform float u_pulse;
  uniform float u_hueShift;
  uniform float u_time;
  varying vec2 vUv;

  vec3 hsv2rgb(vec3 c) {
    vec3 p = abs(fract(c.xxx + vec3(1.0, 2.0/3.0, 1.0/3.0)) * 6.0 - 3.0);
    return c.z * mix(vec3(1.0), clamp(p - 1.0, 0.0, 1.0), c.y);
  }

  void main() {
    vec2 centered = vUv * 2.0 - 1.0;
    float dist = length(centered);

    // Spinning distortion
    float angle = atan(centered.y, centered.x);
    float spiral = sin(angle * 3.0 - u_time * 2.0 + dist * 8.0) * 0.5 + 0.5;

    // Radial glow
    float glow = exp(-dist * 4.0) * u_pulse;
    float ring = exp(-pow(dist - 0.3 * u_pulse, 2.0) * 20.0) * 0.3;

    float intensity = glow + ring * spiral;

    float hue = mix(0.7, 0.1, u_hueShift) + spiral * 0.05;
    vec3 color = hsv2rgb(vec3(fract(hue), 0.6, 1.0));
    color = mix(color, vec3(1.0), glow * 0.5); // white-hot center

    gl_FragColor = vec4(color * intensity, intensity);
  }
`;

// ---------------------------------------------------------------------------
// OrbitalVisualizer
// ---------------------------------------------------------------------------

export class OrbitalVisualizer {
  private unsub: Unsubscribe;
  private latestFeatures: AudioFeatures | null = null;
  private time = 0;

  // Smoothed audio parameters
  private smoothBass = new EMASmoothing(0.18);
  private smoothMid = new EMASmoothing(0.20);
  private smoothHigh = new EMASmoothing(0.15);
  private smoothRms = new EMASmoothing(0.20);
  private smoothCentroid = new EMASmoothing(0.10);
  private smoothFlux = new EMASmoothing(0.15);

  // Particle data arrays
  private positions: Float32Array;
  private velocities: Float32Array;
  private ages: Float32Array;
  private lifetimes: Float32Array;
  private sizes: Float32Array;
  private alive: Uint8Array;
  private activeCount = 0;

  // Three.js objects (created on attach)
  private particleGeometry: THREE.BufferGeometry | null = null;
  private particleMaterial: THREE.ShaderMaterial | null = null;
  private particlePoints: THREE.Points | null = null;
  private vortexMesh: THREE.Mesh | null = null;
  private vortexMaterial: THREE.ShaderMaterial | null = null;
  private cometMeshes: THREE.Mesh[] = [];
  private sceneRef: THREE.Scene | null = null;

  // Comet attractors
  private comets: { orbit: CometOrbit; position: [number, number, number]; mass: number }[];

  // Beat burst state
  private burstCooldown = 0;

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
    this.alive = new Uint8Array(MAX_PARTICLES);

    // Initialize smoothers with idle defaults
    this.smoothBass.reset(IDLE_FEATURES.bass);
    this.smoothMid.reset(IDLE_FEATURES.mid);
    this.smoothHigh.reset(IDLE_FEATURES.high);
    this.smoothRms.reset(IDLE_FEATURES.rms);
    this.smoothCentroid.reset(IDLE_FEATURES.spectralCentroid);
    this.smoothFlux.reset(IDLE_FEATURES.spectralFlux);

    // Define comet orbits — each with a unique pattern
    this.comets = [
      {
        orbit: ellipticalOrbit(3.0, 2.0, 0.6, 0, 0.3),
        position: [0, 0, 0],
        mass: 1.0,
      },
      {
        orbit: figure8Orbit(2.5, 0.45, Math.PI * 0.5, 0.5),
        position: [0, 0, 0],
        mass: 0.8,
      },
      {
        orbit: spiralOrbit(2.2, 0.55, Math.PI, 0.6),
        position: [0, 0, 0],
        mass: 0.9,
      },
      {
        orbit: ellipticalOrbit(1.8, 3.2, 0.4, Math.PI * 1.3, -0.4),
        position: [0, 0, 0],
        mass: 0.7,
      },
    ];

    // Seed initial particles so there's always something visible
    this._seedParticles(120);
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

    // --- Central vortex glow ---
    const vortexGeo = new THREE.PlaneGeometry(3, 3);
    this.vortexMaterial = new THREE.ShaderMaterial({
      vertexShader: VORTEX_VERTEX_SHADER,
      fragmentShader: VORTEX_FRAGMENT_SHADER,
      uniforms: {
        u_pulse: { value: 0.5 },
        u_hueShift: { value: 0.0 },
        u_time: { value: 0.0 },
      },
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      transparent: true,
      side: THREE.DoubleSide,
    });
    this.vortexMesh = new THREE.Mesh(vortexGeo, this.vortexMaterial);
    scene.add(this.vortexMesh);

    // --- Comet emissive spheres ---
    for (let i = 0; i < NUM_COMETS; i++) {
      const geo = new THREE.SphereGeometry(0.06, 8, 8);
      const mat = new THREE.MeshBasicMaterial({
        color: new THREE.Color().setHSL(0.6 + i * 0.1, 0.8, 0.7),
        transparent: true,
        opacity: 0.9,
        blending: THREE.AdditiveBlending,
      });
      const mesh = new THREE.Mesh(geo, mat);
      scene.add(mesh);
      this.cometMeshes.push(mesh);
    }
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
    const flux = this.smoothFlux.update(f.spectralFlux);

    // Derived parameters
    const cometSpeedMultiplier = 0.5 + mid * 2.0;
    const emissionRate = Math.floor(BASE_EMISSION_RATE + bass * 25);
    const spawnVelocityVariance = 0.005 + high * 0.04;
    const glowIntensity = 0.4 + rms * 1.6;
    const hueShift = centroid; // 0 = deep blue, 1 = warm gold
    const vortexPulse = 0.3 + bass * 1.2;

    // Beat burst
    if (this.burstCooldown > 0) this.burstCooldown--;
    const doBurst = f.beatOnset && f.beatConfidence > 0.4 && this.burstCooldown === 0;
    if (doBurst) {
      this.burstCooldown = 6; // cooldown frames
    }

    // Update comet positions
    for (let i = 0; i < this.comets.length; i++) {
      this.comets[i].position = this.comets[i].orbit.position(this.time * cometSpeedMultiplier);
    }

    // Emit new particles from the vortex center
    let toEmit = doBurst ? emissionRate * 4 : emissionRate;
    for (let i = 0; i < MAX_PARTICLES && toEmit > 0; i++) {
      if (!this.alive[i]) {
        this._emitParticle(i, spawnVelocityVariance, doBurst);
        toEmit--;
      }
    }

    // Physics update for all alive particles
    this.activeCount = 0;
    for (let i = 0; i < MAX_PARTICLES; i++) {
      if (!this.alive[i]) continue;

      const idx = i * 3;
      this.ages[i] += 1;

      // Kill old particles
      if (this.ages[i] >= this.lifetimes[i]) {
        this.alive[i] = 0;
        // Move off-screen to avoid rendering stale positions
        this.positions[idx] = 0;
        this.positions[idx + 1] = 0;
        this.positions[idx + 2] = -100;
        continue;
      }

      this.activeCount++;

      // Current position and velocity
      let vx = this.velocities[idx];
      let vy = this.velocities[idx + 1];
      let vz = this.velocities[idx + 2];
      const px = this.positions[idx];
      const py = this.positions[idx + 1];
      const pz = this.positions[idx + 2];

      // Gravitational pull toward each comet attractor
      for (let c = 0; c < this.comets.length; c++) {
        const [cx, cy, cz] = this.comets[c].position;
        const dx = cx - px;
        const dy = cy - py;
        const dz = cz - pz;
        const distSq = dx * dx + dy * dy + dz * dz + 0.01; // softening
        const dist = Math.sqrt(distSq);
        const force = G * this.comets[c].mass / distSq;
        vx += force * dx / dist;
        vy += force * dy / dist;
        vz += force * dz / dist;
      }

      // Spiral force toward center (tangential + inward)
      const toCenterX = -px;
      const toCenterY = -py;
      const centerDist = Math.sqrt(px * px + py * py + 0.001);
      // Tangential component (perpendicular to radial direction)
      const tangX = -toCenterY / centerDist;
      const tangY = toCenterX / centerDist;
      vx += tangX * SPIRAL_STRENGTH * (1 + bass * 3);
      vy += tangY * SPIRAL_STRENGTH * (1 + bass * 3);
      // Slight inward pull
      vx += toCenterX * SPIRAL_STRENGTH * 0.3;
      vy += toCenterY * SPIRAL_STRENGTH * 0.3;

      // Drag
      vx *= DRAG;
      vy *= DRAG;
      vz *= DRAG;

      // Integrate
      this.velocities[idx] = vx;
      this.velocities[idx + 1] = vy;
      this.velocities[idx + 2] = vz;
      this.positions[idx] += vx;
      this.positions[idx + 1] += vy;
      this.positions[idx + 2] += vz;

      // Shimmer: modulate size with high frequency content
      const life = this.ages[i] / this.lifetimes[i];
      const shimmer = 1.0 + high * 0.5 * Math.sin(this.time * 20 + i * 1.7);
      const sizeFade = life < 0.1 ? life / 0.1 : (1.0 - Math.pow(Math.max(0, life - 0.5) * 2, 2));
      this.sizes[i] = Math.max(0.5, (1.5 + flux * 2.0) * shimmer * sizeFade);
    }

    // Update Three.js buffers
    if (this.particleGeometry) {
      (this.particleGeometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
      (this.particleGeometry.attributes.a_age as THREE.BufferAttribute).needsUpdate = true;
      (this.particleGeometry.attributes.a_lifetime as THREE.BufferAttribute).needsUpdate = true;
      (this.particleGeometry.attributes.a_size as THREE.BufferAttribute).needsUpdate = true;
    }

    // Update uniforms
    if (this.particleMaterial) {
      this.particleMaterial.uniforms.u_hueShift.value = hueShift;
      this.particleMaterial.uniforms.u_glowIntensity.value = glowIntensity;
      this.particleMaterial.uniforms.u_time.value = this.time;
    }

    if (this.vortexMaterial) {
      this.vortexMaterial.uniforms.u_pulse.value = vortexPulse;
      this.vortexMaterial.uniforms.u_hueShift.value = hueShift;
      this.vortexMaterial.uniforms.u_time.value = this.time;
    }

    // Update comet mesh positions
    for (let i = 0; i < this.cometMeshes.length && i < this.comets.length; i++) {
      const [x, y, z] = this.comets[i].position;
      this.cometMeshes[i].position.set(x, y, z);
      // Pulse comet brightness with mid
      const mat = this.cometMeshes[i].material as THREE.MeshBasicMaterial;
      mat.opacity = 0.5 + mid * 0.5;
      mat.color.setHSL(
        (0.6 + i * 0.1 + hueShift * 0.3) % 1.0,
        0.7 + high * 0.3,
        0.5 + rms * 0.4,
      );
    }
  }

  setResolution(_width: number, _height: number): void {
    // Particle system is 3D — resolution mostly affects the renderer, not us.
    // Could be used for density scaling in the future.
  }

  getParticleCount(): number {
    return this.activeCount;
  }

  dispose(): void {
    this.unsub();
    this.particleMaterial?.dispose();
    this.particleGeometry?.dispose();
    this.vortexMaterial?.dispose();
    if (this.vortexMesh) this.vortexMesh.geometry.dispose();
    for (const mesh of this.cometMeshes) {
      mesh.geometry.dispose();
      (mesh.material as THREE.Material).dispose();
    }
    // Remove from scene
    if (this.sceneRef) {
      if (this.particlePoints) this.sceneRef.remove(this.particlePoints);
      if (this.vortexMesh) this.sceneRef.remove(this.vortexMesh);
      for (const mesh of this.cometMeshes) this.sceneRef.remove(mesh);
    }
  }

  // -----------------------------------------------------------------------
  // Private helpers
  // -----------------------------------------------------------------------

  /** Seed a number of particles for the initial state so the scene isn't empty */
  private _seedParticles(count: number): void {
    for (let i = 0; i < count && i < MAX_PARTICLES; i++) {
      this._emitParticle(i, 0.015, false);
      // Scatter them in different life stages so they don't all appear at once
      this.ages[i] = Math.random() * this.lifetimes[i] * 0.5;
      // Spread positions out from center
      const angle = Math.random() * Math.PI * 2;
      const radius = 0.5 + Math.random() * 2.5;
      const idx = i * 3;
      this.positions[idx] = Math.cos(angle) * radius;
      this.positions[idx + 1] = Math.sin(angle) * radius;
      this.positions[idx + 2] = (Math.random() - 0.5) * 0.8;
    }
    this.activeCount = count;
  }

  /** Emit a single particle from the vortex center */
  private _emitParticle(i: number, velocityVariance: number, burst: boolean): void {
    const idx = i * 3;

    // Position: near center with slight randomness
    const spawnRadius = burst ? 0.3 : 0.1;
    const angle = Math.random() * Math.PI * 2;
    const r = Math.random() * spawnRadius;
    this.positions[idx] = Math.cos(angle) * r;
    this.positions[idx + 1] = Math.sin(angle) * r;
    this.positions[idx + 2] = (Math.random() - 0.5) * 0.1;

    // Velocity: outward with tangential component + noise
    const speed = (burst ? 0.04 : 0.012) + Math.random() * velocityVariance;
    const outAngle = angle + (Math.random() - 0.5) * 1.0; // some spread
    this.velocities[idx] = Math.cos(outAngle) * speed;
    this.velocities[idx + 1] = Math.sin(outAngle) * speed;
    this.velocities[idx + 2] = (Math.random() - 0.5) * speed * 0.3;

    // Lifetime
    this.lifetimes[i] = MAX_LIFETIME * (0.5 + Math.random() * 0.5);
    this.ages[i] = 0;
    this.sizes[i] = 1.0 + Math.random() * 1.5;
    this.alive[i] = 1;
  }
}
