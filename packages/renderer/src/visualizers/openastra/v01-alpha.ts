import * as THREE from 'three';
import type { AudioFeatures, BusMessage, MessageBus, Unsubscribe } from '@cybernoetica/core';
import { EMASmoothing, EventEnvelope } from '../../smoothing.js';
import { frameDelta, seededRandom, takeAudioFrame } from '../../timing.js';
import type { Visualizer, VisualizerMetadata, VisualizerInteractionContext } from '../types.js';
import { registerVisualizer } from '../registry.js';

const STAR_COUNT = 10000;
const TAU = Math.PI * 2;
const WAKE_COUNT = 8;
const metadata: VisualizerMetadata = {
  type: 'openastra',
  label: 'OpenAstra',
  description: 'Luminous spiral galaxy inspired by the GPT-6 Astra star field',
  usesPerspective: true,
  autoOrbit: false,
  interactivity: { description: 'Move through the stars to stir them. Drag to orbit; scroll to zoom. Reset View replays formation.' },
  viewport: { pan: false, zoom: true, orbit: true },
  viewStateFields: [
    { key: 'orbitAngle', label: 'Orbit', min: -Math.PI, max: Math.PI, step: 0.02 },
    { key: 'elevation', label: 'Elevation', min: -1.5, max: 1.5, step: 0.02 },
    { key: 'distance', label: 'Distance', min: 5, max: 24, step: 0.1 },
  ],
  params: [
    { key: 'rotationSpeed', label: 'Source Drift', min: 0, max: 0.2, step: 0.005, initial: 0, category: 'appearance' },
    { key: 'infallSpeed', label: 'Infall Speed', min: 0, max: 2, step: 0.05, initial: 1, category: 'appearance' },
    { key: 'pointerForce', label: 'Pointer Stirring', min: 0, max: 2, step: 0.05, initial: 1, category: 'appearance' },
    { key: 'winding', label: 'Spiral Winding', min: 0.6, max: 1.6, step: 0.05, initial: 1, category: 'appearance' },
    { key: 'spread', label: 'Stellar Scatter', min: 0.2, max: 2, step: 0.05, initial: 0.8, category: 'appearance' },
    { key: 'starSize', label: 'Star Size', min: 0.5, max: 2, step: 0.05, initial: 1, category: 'appearance' },
    { key: 'glow', label: 'Starlight', min: 0.2, max: 2, step: 0.05, initial: 1, category: 'appearance' },
    { key: 'warmth', label: 'Warm Stars', min: 0, max: 1, step: 0.05, initial: 0.25, category: 'appearance' },
    { key: 'bassToBreath', label: 'Bass → Radial Waves', min: 0, max: 2, step: 0.1, initial: 0.7, category: 'audio-mapping' },
    { key: 'midToRotation', label: 'Mids → Infall', min: 0, max: 2, step: 0.1, initial: 0.6, category: 'audio-mapping' },
    { key: 'highToShimmer', label: 'Highs → Turbulence', min: 0, max: 2, step: 0.1, initial: 0.8, category: 'audio-mapping' },
    { key: 'rmsToGlow', label: 'Volume → Starlight', min: 0, max: 2, step: 0.1, initial: 0.8, category: 'audio-mapping' },
    { key: 'onsetToPulse', label: 'Onset → Shockwave', min: 0, max: 2, step: 0.05, initial: 0.65, category: 'audio-mapping' },
  ],
};

/** An original procedural interpretation of the release-page artwork, not an N-body model. */
export class OpenAstraVisualizer implements Visualizer {
  readonly metadata = metadata;
  private params = Object.fromEntries(metadata.params.map(p => [p.key, p.initial]));
  private view = { orbitAngle: 0.2, elevation: 1.08, distance: 10.5 };
  private features: AudioFeatures | null = null;
  private unsub: Unsubscribe;
  private disposed = false;
  private group = new THREE.Group();
  private scene: THREE.Scene | null = null;
  private background = new THREE.Color('#050b10');
  private previousBackground: THREE.Scene['background'] = null;
  private stars: THREE.Points<THREE.BufferGeometry, THREE.ShaderMaterial> | null = null;
  private core: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial> | null = null;
  private bass = new EMASmoothing(0.05);
  private mid = new EMASmoothing(0.04);
  private high = new EMASmoothing(0.1);
  private rms = new EMASmoothing(0.06);
  private onset = new EventEnvelope(0.65);
  private interaction: VisualizerInteractionContext | null = null;
  private ray = new THREE.Raycaster();
  private pointerPlane = new THREE.Plane();
  private cameraNormal = new THREE.Vector3();
  private pointerNdc = new THREE.Vector2();
  private pointerPosition = new THREE.Vector3();
  private previousPointer = new THREE.Vector3();
  private pendingPointer = false;
  private hasPreviousPointer = false;
  private wakeIndex = 0;
  private lastWakeTime = -1;
  private uniforms = {
    u_phase: { value: 0 }, u_time: { value: 0 },
    u_flow: { value: 0 }, u_formation: { value: 0 },
    u_bass: { value: 0 }, u_onsetTime: { value: -100 },
    u_pointerForce: { value: 1 },
    u_wakes: { value: Array.from({ length: WAKE_COUNT }, () => new THREE.Vector4(0, 0, 0, -100)) },
    u_kicks: { value: Array.from({ length: WAKE_COUNT }, () => new THREE.Vector4()) },
    u_winding: { value: 1 }, u_spread: { value: 0.8 },
    u_size: { value: 1 },
    u_glow: { value: 1 }, u_warmth: { value: 0.25 },
    u_shimmer: { value: 0 }, u_pulse: { value: 0 },
    u_pixels: { value: 720 },
  };

  constructor(bus: MessageBus) {
    this.unsub = bus.subscribe('audio:features', (msg: BusMessage<AudioFeatures>) => {
      this.features = { ...msg.payload };
    });
  }

  attach(scene: THREE.Scene): void {
    if (this.disposed || this.stars) return;
    this.scene = scene;
    this.previousBackground = scene.background;
    scene.background = this.background;
    const random = seededRandom(0x41535452);
    const position = new Float32Array(STAR_COUNT * 3);
    const seeds = new Float32Array(STAR_COUNT * 4);
    const birth = new Float32Array(STAR_COUNT * 3);
    const life = new Float32Array(STAR_COUNT);
    for (let i = 0; i < STAR_COUNT; i++) {
      const population = random();
      const field = population < 0.09;
      const nucleus = population > 0.94;
      const radius = field ? 3 + random() * 12
        : nucleus ? Math.pow(random(), 1.8) * 0.65
        : 0.25 + Math.pow(random(), 0.7) * 4.7;
      // Immutable seeds: each star has a birth position and its own transit phase.
      const scatter = (random() + random() + random() - 1.5);
      const theta = field || nucleus ? random() * TAU
        : 3.2 * radius + (random() + random() - 1) * 0.065;
      position.set([radius, theta, (random() + random() - 1) * (field ? 6 : nucleus ? 0.3 : 0.16)], i * 3);
      seeds.set([random(), Math.pow(random(), 9), scatter, field ? 1 : nucleus ? 2 : 0], i * 4);
      const birthAngle = random() * TAU;
      const birthRadius = 1.5 + Math.sqrt(random()) * 6;
      birth.set([Math.cos(birthAngle) * birthRadius, (random() - 0.5) * 4, Math.sin(birthAngle) * birthRadius], i * 3);
      life[i] = random();
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(position, 3));
    geometry.setAttribute('a_seed', new THREE.BufferAttribute(seeds, 4));
    geometry.setAttribute('a_birth', new THREE.BufferAttribute(birth, 3));
    geometry.setAttribute('a_life', new THREE.BufferAttribute(life, 1));
    const material = new THREE.ShaderMaterial({
      uniforms: this.uniforms, vertexShader: STAR_VERTEX, fragmentShader: STAR_FRAGMENT,
      transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
      depthTest: false, toneMapped: false,
    });
    this.stars = new THREE.Points(geometry, material);
    this.stars.frustumCulled = false;
    this.group.add(this.stars);
    // Camera-facing glow has a bounded area, with no bloom render targets or textures.
    this.core = new THREE.Mesh(new THREE.PlaneGeometry(3.4, 3.4), new THREE.ShaderMaterial({
      uniforms: this.uniforms, vertexShader: CORE_VERTEX, fragmentShader: CORE_FRAGMENT,
      transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
      depthTest: false, toneMapped: false,
    }));
    this.core.frustumCulled = false;
    this.group.add(this.core);
    scene.add(this.group);
  }

  tick(deltaSeconds = 1 / 60): void {
    if (this.disposed) return;
    const dt = frameDelta(deltaSeconds);
    const f = this.features ? takeAudioFrame(this.features) : null;
    const bass = this.bass.update(f?.bass ?? 0, dt);
    const mid = this.mid.update(f?.mid ?? 0, dt);
    const high = this.high.update(f?.high ?? 0, dt);
    const rms = this.rms.update(f?.rms ?? 0, dt);
    const pulse = this.onset.update(f?.beatOnset ?? false, dt);
    const p = this.params, u = this.uniforms;
    u.u_time.value += dt;
    u.u_formation.value = THREE.MathUtils.smoothstep(u.u_time.value, 0.25, 6);
    u.u_flow.value += dt * p.infallSpeed * (1 + mid * p.midToRotation * 1.5) / 24;
    u.u_phase.value = (u.u_phase.value + dt * p.rotationSpeed * (1 + mid * p.midToRotation)) % TAU;
    u.u_winding.value = p.winding;
    u.u_spread.value = p.spread;
    u.u_size.value = p.starSize;
    u.u_bass.value = bass * p.bassToBreath;
    u.u_glow.value = p.glow * (1 + rms * p.rmsToGlow * 0.7);
    u.u_warmth.value = p.warmth;
    u.u_shimmer.value = high * p.highToShimmer;
    u.u_pulse.value = pulse * p.onsetToPulse;
    if (f?.beatOnset) u.u_onsetTime.value = u.u_time.value;
    u.u_pointerForce.value = p.pointerForce;
    this.updatePointerWake();
  }

  setInteractionContext(context: VisualizerInteractionContext | null): void {
    if (this.interaction) {
      this.interaction.canvas.removeEventListener('pointermove', this.onPointerMove);
      this.interaction.canvas.removeEventListener('pointerleave', this.onPointerLeave);
      this.interaction.canvas.removeEventListener('pointercancel', this.onPointerLeave);
      this.interaction.canvas.removeEventListener('pointerup', this.onPointerUp);
    }
    this.interaction = this.disposed ? null : context;
    this.onPointerLeave();
    if (this.interaction) {
      this.interaction.canvas.addEventListener('pointermove', this.onPointerMove, { passive: true });
      this.interaction.canvas.addEventListener('pointerleave', this.onPointerLeave);
      this.interaction.canvas.addEventListener('pointercancel', this.onPointerLeave);
      this.interaction.canvas.addEventListener('pointerup', this.onPointerUp);
    }
  }

  private onPointerLeave = (): void => {
    this.pendingPointer = false;
    this.hasPreviousPointer = false;
  };
  private onPointerUp = (event: PointerEvent): void => {
    if (event.pointerType === 'touch') this.onPointerLeave();
  };
  private onPointerMove = (event: PointerEvent): void => {
    if (!this.interaction || event.isPrimary === false) return;
    const rect = this.interaction.canvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    this.pointerNdc.set((event.clientX - rect.left) / rect.width * 2 - 1,
      1 - (event.clientY - rect.top) / rect.height * 2);
    if (Math.abs(this.pointerNdc.x) > 1 || Math.abs(this.pointerNdc.y) > 1) return;
    const camera = this.interaction.getPerspectiveCamera();
    camera.updateMatrixWorld();
    camera.getWorldDirection(this.cameraNormal);
    this.pointerPlane.setFromNormalAndCoplanarPoint(this.cameraNormal, this.group.position);
    this.ray.setFromCamera(this.pointerNdc, camera);
    if (this.ray.ray.intersectPlane(this.pointerPlane, this.pointerPosition))
      this.pendingPointer = true;
  };

  private updatePointerWake(): void {
    const time = this.uniforms.u_time.value;
    if (!this.pendingPointer || time - this.lastWakeTime < 0.05) return;
    const kick = this.uniforms.u_kicks.value[this.wakeIndex];
    const movement = this.hasPreviousPointer ? this.pointerPosition.distanceTo(this.previousPointer) : 0.1;
    this.pendingPointer = false;
    if (movement < 0.005) return;
    const dx = this.hasPreviousPointer ? this.pointerPosition.x - this.previousPointer.x : 0;
    const dy = this.hasPreviousPointer ? this.pointerPosition.y - this.previousPointer.y : 0;
    const dz = this.hasPreviousPointer ? this.pointerPosition.z - this.previousPointer.z : 0;
    const scale = Math.min(1, 0.65 / Math.max(0.001, movement));
    kick.set(dx * scale, dy * scale, dz * scale, Math.min(1, 0.25 + movement));
    this.uniforms.u_wakes.value[this.wakeIndex].set(this.pointerPosition.x, this.pointerPosition.y, this.pointerPosition.z, time);
    this.previousPointer.copy(this.pointerPosition);
    this.hasPreviousPointer = true;
    this.lastWakeTime = time;
    this.wakeIndex = (this.wakeIndex + 1) % WAKE_COUNT;
  }

  setResolution(w: number, h: number): void {
    if (Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0)
      this.uniforms.u_pixels.value = Math.min(w, h);
  }

  setUserParam(key: string, value: number): void {
    const field = metadata.params.find(p => p.key === key);
    if (field && Number.isFinite(value))
      this.params[key] = THREE.MathUtils.clamp(value, field.min, field.max);
  }

  getViewState(): Record<string, number> { return { ...this.view }; }

  setViewState(partial: Record<string, number>): void {
    for (const field of metadata.viewStateFields) {
      const value = partial[field.key];
      if (Number.isFinite(value))
        this.view[field.key as keyof typeof this.view] = THREE.MathUtils.clamp(value, field.min, field.max);
    }
    // Automatic camera drift is disabled for this visualizer.
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.setInteractionContext(null);
    this.unsub();
    this.features = null;
    if (this.scene?.background === this.background)
      this.scene.background = this.previousBackground;
    this.scene = null;
    this.previousBackground = null;
    this.group.removeFromParent();
    this.stars?.geometry.dispose();
    this.stars?.material.dispose();
    this.core?.geometry.dispose();
    this.core?.material.dispose();
    this.group.clear();
    this.stars = null;
    this.core = null;
  }
}

const STAR_VERTEX = `
  attribute vec4 a_seed;
  attribute vec3 a_birth;
  attribute float a_life;
  uniform float u_phase, u_time, u_flow, u_formation, u_winding, u_spread, u_size, u_pixels;
  uniform float u_warmth, u_shimmer, u_bass, u_pulse, u_onsetTime, u_pointerForce;
  uniform vec4 u_wakes[${WAKE_COUNT}], u_kicks[${WAKE_COUNT}];
  varying vec3 v_color;
  varying float v_brightness;
  void main() {
    bool field = a_seed.w > 0.5 && a_seed.w < 1.5;
    bool arm = a_seed.w < 0.5;
    // Faster motion near the core; each phase wraps only while the star is invisible.
    float life = fract(a_life + u_flow * (0.92 + a_seed.x * 0.16));
    float radius = arm ? 0.08 + 5.2 * pow(max(0.0, 1.0 - life), 0.72) : position.x;
    float theta = arm ? (5.28 - radius) * 3.2 * u_winding + u_phase
      : position.y + (field ? 0.0 : u_time * 0.3 / (0.3 + radius));
    float scatter = arm ? a_seed.z * u_spread * 0.3 * (0.2 + radius / 5.2) : 0.0;
    radius = max(0.02, radius + scatter);
    vec3 radial = vec3(cos(theta), 0.0, sin(theta));
    vec3 tangent = vec3(-radial.z, 0.0, radial.x);
    vec3 p = radial * radius + vec3(0.0, position.z * (arm ? u_spread : 1.0), 0.0);
    float gather = smoothstep(0.0, 1.0, (u_time - a_seed.x * 0.7) / 5.3);
    if (!field) {
      // A dispersed birth cloud curls into the stream, with staggered capture times.
      float curl = 1.6 * sin(gather * 3.14159265);
      vec3 birth = vec3(a_birth.x * cos(curl) - a_birth.z * sin(curl), a_birth.y,
        a_birth.x * sin(curl) + a_birth.z * cos(curl));
      p = mix(birth, p, gather);
      float wave = sin(radius * 3.0 - u_time * 4.2 + a_seed.z) * u_bass * 0.22;
      float shockAge = max(0.0, u_time - u_onsetTime);
      float shock = exp(-pow((radius - shockAge * 4.5) / 0.7, 2.0)) * u_pulse;
      p += radial * (wave + shock * 0.8) * gather;
      p += tangent * sin(u_time * 2.8 + a_seed.x * 60.0) * u_shimmer * 0.16;
      p.y += sin(u_time * 3.7 + a_seed.x * 90.0) * u_shimmer * 0.24 + shock * 0.12;
    }
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    vec2 displacement = vec2(0.0);
    float stirred = 0.0;
    for (int i = 0; i < ${WAKE_COUNT}; i++) {
      float age = u_time - u_wakes[i].w;
      if (age < 0.0 || age > 3.5) continue;
      vec3 center = (modelViewMatrix * vec4(u_wakes[i].xyz, 1.0)).xyz;
      vec2 delta = mv.xy - center.xy;
      float influence = exp(-dot(delta, delta) / 1.6) * exp(-age * 1.4);
      vec2 kick = (modelViewMatrix * vec4(u_kicks[i].xyz, 0.0)).xy;
      vec2 outward = delta / max(0.2, length(delta));
      // Damped impulses carry momentum after the pointer leaves, then spring back.
      displacement += (outward * u_kicks[i].w * 0.5 + kick * 1.4)
        * influence * sin(age * 4.5);
      stirred += influence * u_kicks[i].w * abs(sin(age * 4.5));
    }
    displacement *= min(1.0, 1.4 / max(0.001, length(displacement)));
    mv.xy += displacement * u_pointerForce * (field ? 0.25 : 1.0);
    gl_Position = projectionMatrix * mv;
    float ignition = field ? 0.0 : gather * (0.25 + 0.75 * (arm ? life : 1.0));
    float size = (1.8 + 18.0 * a_seed.y) * (0.7 + ignition * 0.6) * u_size * u_pixels / 720.0;
    gl_PointSize = clamp(size * 12.0 / max(2.0, -mv.z), 1.0, 64.0);
    if (mv.z >= -0.1) gl_PointSize = 0.0;
    vec3 cool = mix(vec3(0.35, 0.61, 0.93), vec3(0.92, 0.97, 1.0), a_seed.y);
    vec3 warm = mix(vec3(0.85, 0.38, 0.14), vec3(1.0, 0.88, 0.72), a_seed.y);
    v_color = mix(cool, warm, step(a_seed.x, u_warmth));
    v_color = mix(v_color, vec3(0.94, 0.97, 1.0), ignition * 0.35);
    float recycleFade = arm ? smoothstep(0.0, 0.035, life) * (1.0 - smoothstep(0.96, 1.0, life)) : 1.0;
    v_brightness = (field ? 0.4 : (0.35 + ignition * 0.95)) * mix(1.0, recycleFade, gather);
    v_brightness *= 0.85 + 0.15 * sin(u_time * 0.7 + a_seed.x * 90.0);
    v_brightness *= 1.0 + u_shimmer * (0.3 + 0.3 * sin(u_time * 2.0 + a_seed.x * 70.0));
    v_brightness *= 1.0 + min(0.8, stirred * u_pointerForce * 0.4);
  }
`;
const STAR_FRAGMENT = `
  uniform float u_glow;
  varying vec3 v_color;
  varying float v_brightness;
  void main() {
    vec2 p = gl_PointCoord * 2.0 - 1.0;
    float r2 = dot(p, p);
    if (r2 > 1.0) discard;
    float glow = exp(-r2 * 5.0) * 0.3 + exp(-r2 * 32.0) * 0.9;
    glow *= 1.0 - smoothstep(0.6, 1.0, r2);
    gl_FragColor = vec4(v_color, glow * v_brightness * u_glow);
  }
`;
const CORE_VERTEX = `
  varying vec2 v_uv;
  uniform float u_pulse;
  void main() {
    v_uv = uv;
    vec4 center = modelViewMatrix * vec4(0.0, 0.0, 0.0, 1.0);
    center.xy += position.xy * (1.0 + u_pulse * 0.12);
    gl_Position = projectionMatrix * center;
  }
`;
const CORE_FRAGMENT = `
  varying vec2 v_uv;
  uniform float u_glow, u_pulse, u_formation;
  void main() {
    float r = length(v_uv - 0.5) * 2.0;
    float halo = exp(-r * r * 7.0) * 0.16 + exp(-r * r * 160.0) * 0.6;
    halo *= 1.0 - smoothstep(0.6, 1.0, r);
    gl_FragColor = vec4(0.75, 0.85, 1.0, halo * u_formation * u_glow * (1.0 + u_pulse * 0.35));
  }
`;

registerVisualizer({ metadata, create: bus => new OpenAstraVisualizer(bus) });
