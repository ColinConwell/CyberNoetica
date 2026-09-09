import * as THREE from 'three';
import type {
  AudioFeatures,
  MessageBus,
  Unsubscribe,
} from '@cybernoetica/core';
import { FixedStepClock, frameDelta, takeAudioFrame } from '../../timing.js';
import { EMASmoothing } from '../../smoothing.js';
import type { Visualizer, VisualizerMetadata } from '../types.js';

const VERTEX = `attribute vec3 position; attribute vec2 uv; varying vec2 vUv;
void main(){ vUv=uv; gl_Position=vec4(position,1.0); }`;
const STEP = `precision highp float;
uniform sampler2D u_state; uniform float u_size, u_kind, u_feed, u_kill, u_inject;
uniform vec2 u_seed; varying vec2 vUv;
vec2 sampleAt(vec2 offset){ return texture2D(u_state,fract(vUv+offset/u_size)).rg; }
void main(){
  vec2 center=sampleAt(vec2(0.0)); vec2 result;
  vec2 axial=sampleAt(vec2(-1,0))+sampleAt(vec2(1,0))+sampleAt(vec2(0,-1))+sampleAt(vec2(0,1));
  vec2 diagonal=sampleAt(vec2(-1,-1))+sampleAt(vec2(1,-1))+sampleAt(vec2(-1,1))+sampleAt(vec2(1,1));
  if(u_kind<.5){
    float neighbors=axial.r+diagonal.r;
    float alive=(neighbors>2.5&&neighbors<3.5)||(center.r>.5&&neighbors>1.5&&neighbors<2.5)?1.0:0.0;
    result=vec2(alive,center.g*.95+alive*.05);
  }else{
    vec2 lap=-center+.2*axial+.05*diagonal;
    float reaction=center.r*center.g*center.g;
    result=center+.25*vec2(lap.r-reaction+u_feed*(1.0-center.r),.5*lap.g+reaction-(u_feed+u_kill)*center.g);
  }
  vec2 delta=abs(vUv-u_seed); delta=min(delta,1.0-delta);
  if(u_inject>.5 && length(delta)<(u_kind<.5?2.0/u_size:.022)) result=u_kind<.5?vec2(1,0):vec2(.5,.4);
  gl_FragColor=vec4(clamp(result,0.0,1.0),0,1);
}`;
const DISPLAY = `precision highp float;
uniform sampler2D u_state; uniform vec2 u_resolution,u_center;
uniform float u_zoom,u_kind,u_hue,u_glow; varying vec2 vUv;
void main(){
 vec2 aspect=u_resolution/min(u_resolution.x,u_resolution.y);
 vec2 uv=fract((vUv-.5)*aspect/u_zoom+u_center+.5);
 vec2 state=texture2D(u_state,uv).rg;
 float value=u_kind<.5?state.r*.85+state.g*.15:clamp(state.g*3.0,0.0,1.0);
 vec3 palette=.5+.5*cos(6.2831853*(vec3(0,.33,.67)+u_hue+value*.45));
 gl_FragColor=vec4(vec3(.006,.008,.018)+palette*value*u_glow,1);
}`;

/** Persistent ping-pong state. Rendering never reads the target currently being written. */
export class GridSimulationVisualizer implements Visualizer {
  private renderer: THREE.WebGLRenderer | null = null;
  private targets: THREE.WebGLRenderTarget[] = [];
  private read = 0;
  private initialized = false;
  private clock: FixedStepClock;
  private unsub: Unsubscribe;
  private features: AudioFeatures | null = null;
  private pendingInjection = false;
  private event = 0;
  private generation = 0;
  private simulationScene = new THREE.Scene();
  private camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private geometry = new THREE.PlaneGeometry(2, 2);
  private stepMaterial: THREE.RawShaderMaterial;
  private displayMaterial: THREE.RawShaderMaterial;
  private display: THREE.Mesh;
  private initial: THREE.DataTexture;
  private copyMaterial: THREE.RawShaderMaterial;
  private simulationMesh: THREE.Mesh;
  private parameters: Record<string, number>;
  private feed = new EMASmoothing(0.003);
  private kill = new EMASmoothing(0.003);
  private view = { centerX: 0, centerY: 0, zoom: 1 };
  private readonly size = 192;

  constructor(
    readonly metadata: VisualizerMetadata,
    bus: MessageBus,
    private kind: 'life' | 'reaction',
  ) {
    this.parameters = Object.fromEntries(
      metadata.params.map((param) => [param.key, param.initial]),
    );
    this.clock = new FixedStepClock(kind === 'life' ? 0.1 : 1 / 240, 24);
    this.feed.reset(0.0367);
    this.kill.reset(0.0649);
    this.unsub = bus.subscribe<AudioFeatures>('audio:features', (message) => {
      this.features = { ...message.payload };
    });
    const data = new Float32Array(this.size * this.size * 4);
    for (let y = 0; y < this.size; y++)
      for (let x = 0; x < this.size; x++) {
        const i = (y * this.size + x) * 4;
        const hash = Math.sin((x + 1) * 127.1 + (y + 1) * 311.7) * 43758.5453;
        const patch = Math.hypot(x - this.size * 0.5, y - this.size * 0.5) < 10;
        data[i] =
          kind === 'life'
            ? hash - Math.floor(hash) > 0.8
              ? 1
              : 0
            : patch
              ? 0.5
              : 1;
        data[i + 1] = kind === 'reaction' && patch ? 0.4 : 0;
        data[i + 3] = 1;
      }
    this.initial = new THREE.DataTexture(
      data,
      this.size,
      this.size,
      THREE.RGBAFormat,
      THREE.FloatType,
    );
    this.initial.needsUpdate = true;
    this.stepMaterial = new THREE.RawShaderMaterial({
      vertexShader: VERTEX,
      fragmentShader: STEP,
      depthTest: false,
      depthWrite: false,
      uniforms: {
        u_state: { value: this.initial },
        u_size: { value: this.size },
        u_kind: { value: kind === 'life' ? 0 : 1 },
        u_feed: { value: 0.0367 },
        u_kill: { value: 0.0649 },
        u_inject: { value: 0 },
        u_seed: { value: new THREE.Vector2(0.5, 0.5) },
      },
    });
    this.copyMaterial = new THREE.RawShaderMaterial({
      vertexShader: VERTEX,
      fragmentShader: `precision highp float; uniform sampler2D u_state; varying vec2 vUv; void main(){gl_FragColor=texture2D(u_state,vUv);}`,
      uniforms: { u_state: { value: this.initial } },
      depthTest: false,
      depthWrite: false,
    });
    this.displayMaterial = new THREE.RawShaderMaterial({
      vertexShader: VERTEX,
      fragmentShader: DISPLAY,
      depthTest: false,
      depthWrite: false,
      uniforms: {
        u_state: { value: this.initial },
        u_resolution: { value: new THREE.Vector2(1, 1) },
        u_center: { value: new THREE.Vector2() },
        u_zoom: { value: 1 },
        u_kind: { value: kind === 'life' ? 0 : 1 },
        u_hue: { value: 0 },
        u_glow: { value: 1 },
      },
    });
    this.simulationMesh = new THREE.Mesh(this.geometry, this.stepMaterial);
    this.simulationScene.add(this.simulationMesh);
    this.display = new THREE.Mesh(this.geometry, this.displayMaterial);
  }
  setRenderer(renderer: THREE.WebGLRenderer): void {
    if (
      !renderer.extensions.has('EXT_color_buffer_float') &&
      !renderer.extensions.has('EXT_color_buffer_half_float')
    )
      throw new Error(
        'This simulation needs floating-point render targets; choose the original artistic variant on this device',
      );
    this.renderer = renderer;
  }
  attach(scene: THREE.Scene): void {
    scene.add(this.display);
    for (let i = 0; i < 2; i++)
      this.targets.push(
        new THREE.WebGLRenderTarget(this.size, this.size, {
          type: THREE.HalfFloatType,
          format: THREE.RGBAFormat,
          minFilter: THREE.NearestFilter,
          magFilter: THREE.NearestFilter,
          depthBuffer: false,
          stencilBuffer: false,
        }),
      );
  }
  tick(seconds = 1 / 60): void {
    const dt = frameDelta(seconds);
    const features = this.features ? takeAudioFrame(this.features) : null;
    if (features?.beatOnset && this.parameters.onsetInjection > 0) {
      this.pendingInjection = true;
      this.event++;
    }
    const presets = [
      [0.0367, 0.0649],
      [0.0545, 0.062],
      [0.025, 0.06],
    ];
    const preset =
      presets[Math.round(this.parameters.pattern ?? 0)] ?? presets[0];
    const timbre = features?.bandBalance?.high ?? 0;
    const u = this.stepMaterial.uniforms;
    u.u_feed.value = this.feed.update(
      preset[0] + timbre * 0.002 * (this.parameters.timbreToFeed ?? 0),
      dt,
    );
    u.u_kill.value = this.kill.update(preset[1], dt);
    this.displayMaterial.uniforms.u_hue.value =
      (features?.spectralCentroid ?? 0.3) * 0.25;
    this.displayMaterial.uniforms.u_glow.value =
      0.7 + (features?.rms ?? 0) * this.parameters.rmsToGlow;
    if (!this.renderer || this.targets.length !== 2) return;
    const renderer = this.renderer;
    const previous = renderer.getRenderTarget();
    try {
      if (!this.initialized) {
        this.simulationMesh.material = this.copyMaterial;
        for (const target of this.targets) {
          renderer.setRenderTarget(target);
          renderer.render(this.simulationScene, this.camera);
        }
        this.simulationMesh.material = this.stepMaterial;
        this.initialized = true;
      }
      this.clock.advance(dt * this.parameters.simulationSpeed, () => {
        u.u_state.value = this.targets[this.read].texture;
        u.u_inject.value = this.pendingInjection ? 1 : 0;
        u.u_seed.value.set(
          (this.event * 0.61803398875) % 1,
          (this.event * 0.41421356237) % 1,
        );
        this.pendingInjection = false;
        renderer.setRenderTarget(this.targets[1 - this.read]);
        renderer.render(this.simulationScene, this.camera);
        this.read = 1 - this.read;
        this.generation++;
      });
      this.displayMaterial.uniforms.u_state.value =
        this.targets[this.read].texture;
    } finally {
      renderer.setRenderTarget(previous);
    }
  }
  setResolution(w: number, h: number): void {
    this.displayMaterial.uniforms.u_resolution.value.set(w, h);
  }
  setUserParam(key: string, value: number): void {
    if (key in this.parameters) this.parameters[key] = value;
  }
  getViewState(): Record<string, number> {
    return { ...this.view, generation: this.generation };
  }
  setViewState(partial: Record<string, number>): void {
    for (const key of ['centerX', 'centerY', 'zoom'] as const)
      if (Number.isFinite(partial[key])) this.view[key] = partial[key];
    this.displayMaterial.uniforms.u_center.value.set(
      this.view.centerX,
      this.view.centerY,
    );
    this.displayMaterial.uniforms.u_zoom.value = this.view.zoom;
  }
  dispose(): void {
    this.unsub();
    for (const target of this.targets) target.dispose();
    this.targets = [];
    this.initial.dispose();
    this.geometry.dispose();
    this.stepMaterial.dispose();
    this.displayMaterial.dispose();
    this.copyMaterial.dispose();
    this.display.removeFromParent();
  }
}
