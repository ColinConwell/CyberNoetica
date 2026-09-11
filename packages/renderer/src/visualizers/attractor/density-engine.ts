import * as THREE from 'three';
import type {
  AudioFeatures,
  MessageBus,
  Unsubscribe,
} from '@cybernoetica/core';
import { EMASmoothing, EventEnvelope } from '../../smoothing.js';
import { frameDelta, PhaseClock, takeAudioFrame } from '../../timing.js';
import { mapTrajectory } from '../../geometry/maps.js';
import type { MapKind } from '../../geometry/maps.js';
import type { Visualizer, VisualizerMetadata } from '../types.js';
const SIZE = 384;
/** Cached trajectories → bilinear occupancy histogram → time-normalized density → palette. */
export class DensityMapVisualizer implements Visualizer {
  private params: Record<string, number>;
  private view = { zoom: 1, panX: 0, panY: 0 };
  private latest: AudioFeatures | null = null;
  private unsub: Unsubscribe;
  private density = new Float32Array(SIZE * SIZE);
  private histogram = new Float32Array(SIZE * SIZE);
  private pixels = new Uint8Array(SIZE * SIZE);
  private points = new Float32Array(51200);
  private texture = new THREE.DataTexture(
    this.pixels,
    SIZE,
    SIZE,
    THREE.RedFormat,
  );
  private material: THREE.ShaderMaterial | null = null;
  private mesh: THREE.Mesh | null = null;
  private elapsed = 1;
  private phases = new PhaseClock();
  private pulse = new EventEnvelope();
  private smooth = Object.fromEntries(
    ['bass', 'mid', 'rms', 'spectralFlux', 'spectralCentroid'].map((key) => [
      key,
      new EMASmoothing(0.005),
    ]),
  );
  private extent: number;
  constructor(
    readonly metadata: VisualizerMetadata,
    bus: MessageBus,
    private kind: MapKind,
  ) {
    this.params = Object.fromEntries(
      metadata.params.map((p) => [p.key, p.initial]),
    );
    this.extent = kind === 'hopalong' ? 24 : kind === 'ikeda' ? 6 : 3;
    if (kind === 'ikeda') this.view.panX = 0.5;
    this.texture.minFilter = THREE.LinearFilter;
    this.texture.magFilter = THREE.LinearFilter;
    this.unsub = bus.subscribe<AudioFeatures>('audio:features', (msg) => {
      this.latest = { ...msg.payload };
    });
  }
  attach(scene: THREE.Scene): void {
    this.material = new THREE.ShaderMaterial({
      vertexShader: `varying vec2 vUv;void main(){vUv=uv;gl_Position=vec4(position,1.);}`,
      fragmentShader: `uniform sampler2D density;uniform vec2 resolution;uniform vec2 pan;uniform float zoom;uniform float extent;uniform float hue;uniform float brightness;varying vec2 vUv;
      void main(){vec2 p=(vUv-.5)*resolution/min(resolution.x,resolution.y)*2.*extent/zoom+pan;
        vec2 st=p/(2.*extent)+.5;float d=texture2D(density,st).r;
        if(any(lessThan(st,vec2(0.)))||any(greaterThan(st,vec2(1.))))d=0.;
        vec3 color=.55+.45*cos(6.2831853*(vec3(0.,.33,.67)+hue+d*.25));
        gl_FragColor=vec4(vec3(.006,.004,.015)+color*d*brightness,1.);}`,
      uniforms: {
        density: { value: this.texture },
        resolution: { value: new THREE.Vector2(1920, 1080) },
        pan: { value: new THREE.Vector2() },
        zoom: { value: 1 },
        extent: { value: this.extent },
        hue: { value: 0 },
        brightness: { value: 1 },
      },
    });
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.material);
    scene.add(this.mesh);
    this.tick(0);
  }
  tick(deltaSeconds = 1 / 60): void {
    const dt = frameDelta(deltaSeconds);
    this.elapsed += dt;
    const f = this.latest ? takeAudioFrame(this.latest) : null,
      p = this.params;
    const a: Record<string, number> = {};
    for (const key of Object.keys(this.smooth))
      a[key] = this.smooth[key].update(
        (f?.[key as keyof AudioFeatures] as number) ?? 0,
        dt,
      );
    const pulse = this.pulse.update(f?.beatOnset ? 1 : 0, dt),
      phase = this.phases.advance('palette', p.colorSpeed * 0.05, dt);
    if (this.material) {
      const u = this.material.uniforms;
      u.pan.value.set(this.view.panX, this.view.panY);
      u.zoom.value = this.view.zoom;
      u.hue.value =
        (p.hueShift ?? 0) +
        phase +
        a.mid * (p.midToColor ?? 0) * 0.25 +
        a.spectralCentroid * (p.centroidToHue ?? 0) * 0.25;
      u.brightness.value =
        p.brightness *
        (0.65 + a.rms * p.rmsToGlow + pulse * 0.1 * p.beatToJolt);
    }
    if (this.elapsed < 0.1) return;
    const elapsed = Math.min(this.elapsed, 0.25);
    this.elapsed %= 0.1;
    let coefficients: number[];
    if (this.kind === 'ikeda')
      coefficients = [
        Math.min(0.91, p.coupling + a.bass * 0.0025 * p.bassToCoupling),
        p.phaseOffset + a.spectralFlux * 0.025 * p.fluxToPhase,
        p.detuning,
        0,
      ];
    else
      coefficients = [
        p.paramA + a.bass * 0.025 * p.bassToParams,
        p.paramB,
        p.paramC,
        p.paramD ?? 0,
      ];
    const count = mapTrajectory(
      this.kind,
      coefficients,
      this.points.subarray(0, Math.round(p.iterations) * 128),
    );
    this.histogram.fill(0);
    for (let i = 0; i < count; i++) {
      const x = (this.points[2 * i] / (2 * this.extent) + 0.5) * (SIZE - 1),
        y = (this.points[2 * i + 1] / (2 * this.extent) + 0.5) * (SIZE - 1);
      const ix = Math.floor(x),
        iy = Math.floor(y);
      if (ix < 0 || iy < 0 || ix >= SIZE - 1 || iy >= SIZE - 1) continue;
      const fx = x - ix,
        fy = y - iy,
        k = iy * SIZE + ix;
      this.histogram[k] += (1 - fx) * (1 - fy);
      this.histogram[k + 1] += fx * (1 - fy);
      this.histogram[k + SIZE] += (1 - fx) * fy;
      this.histogram[k + SIZE + 1] += fx * fy;
    }
    const retain = Math.exp(-elapsed / p.densityDecay),
      weight = ((1 - retain) * SIZE * SIZE) / Math.max(1, count);
    for (let i = 0; i < this.density.length; i++) {
      this.density[i] = this.density[i] * retain + this.histogram[i] * weight;
      this.pixels[i] = Math.min(255, Math.log1p(this.density[i]) * 65);
    }
    this.texture.needsUpdate = true;
  }
  setResolution(w: number, h: number): void {
    this.material?.uniforms.resolution.value.set(w, h);
  }
  setUserParam(key: string, value: number): void {
    const field = this.metadata.params.find((p) => p.key === key);
    if (field && Number.isFinite(value)) {
      this.params[key] = Math.max(field.min, Math.min(field.max, value));
      this.elapsed = 1;
    }
  }
  getViewState(): Record<string, number> {
    return { ...this.view };
  }
  setViewState(partial: Record<string, number>): void {
    for (const field of this.metadata.viewStateFields) {
      const v = partial[field.key];
      if (Number.isFinite(v))
        this.view[field.key as keyof typeof this.view] = Math.max(
          field.min,
          Math.min(field.max, v),
        );
    }
  }
  dispose(): void {
    this.unsub();
    this.mesh?.removeFromParent();
    this.mesh?.geometry.dispose();
    this.material?.dispose();
    this.texture.dispose();
  }
}
