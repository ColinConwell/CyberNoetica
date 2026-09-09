import * as THREE from 'three';
import type { MessageBus } from '@cybernoetica/core';
import { ModelVisualizer, MODEL_VIEW_3D } from '../model-base.js';
import type { VisualizerMetadata } from '../types.js';
import { registerVisualizer } from '../registry.js';

/** Explicit height mesh: resolution controls geometric detail, never ray-hit validity. */
const terrainMetadata: VisualizerMetadata = {
  type: 'terrain',
  label: 'Terrain',
  description: 'Audio-reactive 3D terrain landscape',
  usesPerspective: true,
  params: [
    // Appearance
    {
      key: 'ridgeHeight',
      label: 'Ridge Height',
      min: 0.1,
      max: 2.0,
      step: 0.05,
      initial: 0.8,
      category: 'appearance',
      description: 'Height of terrain ridges',
    },
    {
      key: 'noiseScale',
      label: 'Noise Scale',
      min: 1.0,
      max: 8.0,
      step: 0.25,
      initial: 3.0,
      category: 'appearance',
      description: 'Scale of noise patterns',
    },
    {
      key: 'speed',
      label: 'Speed',
      min: 0.1,
      max: 2.0,
      step: 0.05,
      initial: 0.4,
      category: 'appearance',
      description: 'Animation speed',
    },
    {
      key: 'fogDensity',
      label: 'Fog Density',
      min: 0.0,
      max: 1.0,
      step: 0.05,
      initial: 0.5,
      category: 'appearance',
      description: 'Atmospheric fog amount',
    },
    {
      key: 'colorShift',
      label: 'Color Shift',
      min: 0.0,
      max: 1.0,
      step: 0.01,
      initial: 0.3,
      category: 'appearance',
      description: 'Color temperature',
    },
    // Audio mapping
    {
      key: 'bassToHeight',
      label: 'Bass -> Height',
      min: 0.0,
      max: 2.0,
      step: 0.1,
      initial: 1.0,
      category: 'audio-mapping',
      description: 'Bass drives terrain height',
    },
    {
      key: 'midToRipple',
      label: 'Mid -> Ripple',
      min: 0.0,
      max: 2.0,
      step: 0.1,
      initial: 1.0,
      category: 'audio-mapping',
      description: 'Mids create ripple waves',
    },
    {
      key: 'spectralToColor',
      label: 'Spectral -> Color',
      min: 0.0,
      max: 2.0,
      step: 0.1,
      initial: 1.0,
      category: 'audio-mapping',
      description: 'Spectral centroid shifts palette',
    },
    {
      key: 'rmsToGlow',
      label: 'RMS -> Glow',
      min: 0.0,
      max: 2.0,
      step: 0.1,
      initial: 1.0,
      category: 'audio-mapping',
      description: 'Volume drives glow intensity',
    },
    {
      key: 'beatToFlash',
      label: 'Beat -> Flash',
      min: 0.0,
      max: 2.0,
      step: 0.1,
      initial: 1.0,
      category: 'audio-mapping',
      description: 'Beats trigger lightning flashes',
    },
  ],
  viewport: { pan: false, zoom: true, orbit: true },
  viewStateFields: MODEL_VIEW_3D,
};

const UNIFORMS = `uniform float u_speedPhase,u_ridgeHeight,u_noiseScale,u_bass,u_mid,u_high,u_rms,u_spectralCentroid,u_beatPulse;
uniform float u_bassToHeight,u_midToRipple,u_spectralToColor,u_rmsToGlow,u_beatToFlash,u_fogDensity,u_colorShift;`;
const HEIGHT = `  // ── Noise primitives ─────────────────────────────────

  // Hash without sine -- better distribution on GPU
  vec2 hash22(vec2 p) {
    vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973));
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.xx + p3.yz) * p3.zy);
  }

  float hash21(vec2 p) {
    vec3 p3 = fract(vec3(p.xyx) * 0.1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
  }

  // Smooth value noise
  float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f); // smoothstep

    float a = hash21(i);
    float b = hash21(i + vec2(1.0, 0.0));
    float c = hash21(i + vec2(0.0, 1.0));
    float d = hash21(i + vec2(1.0, 1.0));

    return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
  }

  // Fractal Brownian Motion -- 5 octaves
  float fbm(vec2 p) {
    float value = 0.0;
    float amplitude = 0.5;
    float frequency = 1.0;
    for (int i = 0; i < 5; i++) {
      value += amplitude * noise(p * frequency);
      frequency *= 2.0;
      amplitude *= 0.5;
    }
    return value;
  }

  // Ridge noise variant for sharp peaks
  float ridgeNoise(vec2 p) {
    float n = noise(p);
    n = abs(n - 0.5) * 2.0;
    return 1.0 - n * n;
  }

  float ridgeFbm(vec2 p) {
    float value = 0.0;
    float amplitude = 0.5;
    float frequency = 1.0;
    for (int i = 0; i < 5; i++) {
      value += amplitude * ridgeNoise(p * frequency);
      frequency *= 2.1;
      amplitude *= 0.48;
    }
    return value;
  }

  // ── Terrain height ───────────────────────────────────

  float terrainHeight(vec2 p) {
    float t = u_speedPhase;
    vec2 pos = p * u_noiseScale + vec2(0.0, t * 2.0);

    // Base terrain: blend of smooth fbm and ridged fbm
    float smooth_h = fbm(pos * 0.6);
    float ridge_h = ridgeFbm(pos * 0.4);
    float h = mix(smooth_h, ridge_h, 0.6) * u_ridgeHeight;

    // Bass lifts overall terrain height
    h *= (1.0 + u_bass * 0.8 * u_bassToHeight);

    // Mid-frequency ripples -- concentric waves from centre
    float ripple = sin(length(pos) * 4.0 - t * 6.0) * 0.08;
    h += ripple * u_mid * u_midToRipple;

    // High-frequency shimmer
    h += noise(pos * 8.0 + t) * 0.02 * u_high;

    return h;
  }

`;
const PALETTE = `  vec3 terrainColor(float h, float normalY, vec2 p) {
    // Normalised height (0..1 approx)
    float hn = clamp(h / (u_ridgeHeight * 1.5), 0.0, 1.0);

    // Cool palette (blue/teal/green)
    vec3 deep = vec3(0.05, 0.08, 0.18);
    vec3 low  = vec3(0.06, 0.18, 0.35);
    vec3 mid  = vec3(0.08, 0.38, 0.32);
    vec3 high_c = vec3(0.25, 0.55, 0.35);
    vec3 peak = vec3(0.85, 0.90, 0.95);

    // Warm palette (orange/red/gold)
    vec3 deep_w = vec3(0.15, 0.05, 0.08);
    vec3 low_w  = vec3(0.35, 0.12, 0.06);
    vec3 mid_w  = vec3(0.55, 0.30, 0.08);
    vec3 high_w = vec3(0.70, 0.50, 0.15);
    vec3 peak_w = vec3(0.95, 0.85, 0.70);

    // Blend cool/warm based on colorShift + spectral centroid
    float warmth = u_colorShift + (u_spectralCentroid - 0.5) * 0.6 * u_spectralToColor;
    warmth = clamp(warmth, 0.0, 1.0);

    deep   = mix(deep,   deep_w,   warmth);
    low    = mix(low,    low_w,    warmth);
    mid    = mix(mid,    mid_w,    warmth);
    high_c = mix(high_c, high_w, warmth);
    peak   = mix(peak,   peak_w,   warmth);

    // Height-based colour ramp
    vec3 col;
    if (hn < 0.15) {
      col = mix(deep, low, hn / 0.15);
    } else if (hn < 0.35) {
      col = mix(low, mid, (hn - 0.15) / 0.2);
    } else if (hn < 0.6) {
      col = mix(mid, high_c, (hn - 0.35) / 0.25);
    } else {
      col = mix(high_c, peak, (hn - 0.6) / 0.4);
    }

    return col;
  }

`;
export class TerrainVisualizer extends ModelVisualizer {
  private mesh: THREE.Mesh | null = null;
  private material: THREE.ShaderMaterial | null = null;
  private divisions = 96;
  private travel = 0;
  constructor(bus: MessageBus) {
    super(terrainMetadata, bus);
    this.view.distance = 13;
    this.view.elevation = 0.5;
  }
  protected build(): void {
    const uniforms: Record<string, THREE.IUniform> = {
      u_workBudget: { value: 1 },
      u_speedPhase: { value: 0 },
    };
    for (const [key, value] of Object.entries(this.params))
      uniforms[`u_${key}`] = { value };
    for (const key of [
      'bass',
      'mid',
      'high',
      'rms',
      'spectralCentroid',
      'beatPulse',
    ])
      uniforms[`u_${key}`] = { value: 0 };
    this.material = new THREE.ShaderMaterial({
      side: THREE.DoubleSide,
      uniforms,
      vertexShader:
        UNIFORMS +
        HEIGHT +
        `varying vec3 vWorld,vNormal;varying float vDistance;
      void main(){vec2 p=position.xy;float h=terrainHeight(p),eps=.02;
        vec3 normal=normalize(vec3(terrainHeight(p-vec2(eps,0))-terrainHeight(p+vec2(eps,0)),2.*eps,terrainHeight(p-vec2(0,eps))-terrainHeight(p+vec2(0,eps))));
        vWorld=vec3(p.x,h-.5,p.y);vNormal=normal;vec4 view=modelViewMatrix*vec4(vWorld,1.);vDistance=length(view.xyz);gl_Position=projectionMatrix*view;}`,
      fragmentShader:
        UNIFORMS +
        PALETTE +
        `varying vec3 vWorld,vNormal;varying float vDistance;
      void main(){vec3 n=normalize(vNormal),light=normalize(vec3(.4,.7,.3));float h=vWorld.y+.5;
        vec3 color=terrainColor(h,n.y,vWorld.xz)*(.25+.75*max(dot(n,light),0.));
        color+=vec3(.15,.3,.45)*smoothstep(.3,1.,h)*u_rms*u_rmsToGlow;
        color+=vec3(.6,.65,.8)*u_beatPulse*u_beatToFlash*.3;
        float fog=1.-exp(-vDistance*.04*(.3+u_fogDensity*.7));color=mix(color,vec3(.018,.023,.045),fog);
        gl_FragColor=vec4(color/(.8+color),1.);}`,
    });
    this.mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(18, 18, this.divisions, this.divisions),
      this.material,
    );
    this.mesh.frustumCulled = false;
    this.root.add(this.mesh);
  }
  protected update(dt: number): void {
    this.travel += dt * this.params.speed;
    if (!this.material || !this.mesh) return;
    const u = this.material.uniforms;
    for (const [key, value] of Object.entries(this.params))
      if (u[`u_${key}`]) u[`u_${key}`].value = value;
    for (const [key, value] of Object.entries(this.audio))
      if (u[`u_${key}`]) u[`u_${key}`].value = value;
    u.u_beatPulse.value = this.beat;
    u.u_speedPhase.value = this.travel;
    const divisions = Math.max(
      48,
      Math.round(96 * Math.sqrt(u.u_workBudget.value)),
    );
    if (divisions !== this.divisions) {
      this.mesh.geometry.dispose();
      this.mesh.geometry = new THREE.PlaneGeometry(
        18,
        18,
        divisions,
        divisions,
      );
      this.divisions = divisions;
    }
  }
}
registerVisualizer({
  metadata: terrainMetadata,
  create: (bus) => new TerrainVisualizer(bus),
});
