import * as THREE from 'three';
import type { MessageBus } from '@cybernoetica/core';
import { ModelVisualizer, MODEL_PARAMS, MODEL_VIEW_2D } from '../model-base.js';
import { registerVisualizer } from '../registry.js';
import type { VisualizerMetadata } from '../types.js';
const metadata: VisualizerMetadata = {
  type: 'caustics-beta',
  label: 'Refracted Caustics',
  description: 'Forward deposition of refracted light onto a receiver plane',
  usesPerspective: false,
  params: [
    {
      key: 'depth',
      label: 'Receiver depth',
      min: 0.5,
      max: 3,
      step: 0.05,
      initial: 1.8,
      category: 'appearance',
    },
    {
      key: 'waveHeight',
      label: 'Wave height',
      min: 0.01,
      max: 0.15,
      step: 0.005,
      initial: 0.07,
      category: 'appearance',
    },
    ...MODEL_PARAMS,
  ],
  viewport: { pan: true, zoom: true, orbit: false },
  viewStateFields: MODEL_VIEW_2D,
};
const GRID = 192,
  SIZE = 384;
export class RefractedCausticsVisualizer extends ModelVisualizer {
  private renderer: THREE.WebGLRenderer | null = null;
  private receiver = new THREE.WebGLRenderTarget(SIZE, SIZE, {
    type: THREE.HalfFloatType,
    depthBuffer: false,
    stencilBuffer: false,
  });
  private photons = new THREE.Scene();
  private camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private photonMaterial: THREE.ShaderMaterial | null = null;
  private display: THREE.ShaderMaterial | null = null;
  constructor(bus: MessageBus) {
    super(metadata, bus);
  }
  setRenderer(renderer: THREE.WebGLRenderer): void {
    if (
      !renderer.extensions.has('EXT_color_buffer_float') &&
      !renderer.extensions.has('EXT_color_buffer_half_float')
    )
      throw new Error(
        'Refracted Caustics needs floating-point render targets; choose Caustics on this device',
      );
    this.renderer = renderer;
  }
  protected build(): void {
    const data = new Float32Array(GRID * GRID * 3);
    for (let y = 0; y < GRID; y++)
      for (let x = 0; x < GRID; x++)
        data.set(
          [((x + 0.5) / GRID - 0.5) * 4, ((y + 0.5) / GRID - 0.5) * 4, 0],
          (y * GRID + x) * 3,
        );
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(data, 3));
    this.photonMaterial = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      vertexShader: `uniform float phase;uniform float amplitude;uniform float depth;varying float energy;
   void main(){vec2 p=position.xy;float a=3.*p.x+phase,b=4.*p.y-phase*.7,c=2.*(p.x+p.y)+phase*.4;
    float h=amplitude*(sin(a)+.65*sin(b)+.4*sin(c));
    vec2 gradient=amplitude*vec2(3.*cos(a)+.8*cos(c),2.6*cos(b)+.8*cos(c));
    vec3 normal=normalize(vec3(-gradient,1.)),ray=refract(vec3(0.,0.,-1.),normal,1./1.333);
    vec2 q=p+ray.xy*(-depth-h)/ray.z;float cosine=normal.z;float f0=pow((1.-1.333)/(1.+1.333),2.);energy=1.-(f0+(1.-f0)*pow(1.-cosine,5.));
    gl_Position=vec4(q/2.,0.,1.);gl_PointSize=3.;}`,
      fragmentShader: `varying float energy;void main(){// 4 receiver pixels per photon, distributed over a 3×3 kernel.
     gl_FragColor=vec4(vec3(energy*4./9.),1.);}`,
      uniforms: {
        phase: { value: 0 },
        amplitude: { value: 0.07 },
        depth: { value: 1.8 },
      },
    });
    const points = new THREE.Points(geometry, this.photonMaterial);
    points.frustumCulled = false;
    this.photons.add(points);
    this.display = new THREE.ShaderMaterial({
      vertexShader: `varying vec2 vUv;void main(){vUv=uv;gl_Position=vec4(position,1.);}`,
      fragmentShader: `uniform sampler2D lightMap;uniform vec2 resolution;uniform vec2 center;uniform float zoom;uniform float exposure;uniform float hue;varying vec2 vUv;
    void main(){vec2 st=(vUv-.5)*resolution/min(resolution.x,resolution.y)/zoom+center+.5;float light=texture2D(lightMap,st).r;
    if(any(lessThan(st,vec2(0.)))||any(greaterThan(st,vec2(1.))))light=0.;vec3 tint=mix(vec3(.1,.5,.8),vec3(.7,.9,1.),hue);gl_FragColor=vec4(tint*(1.-exp(-light*exposure)),1.);}`,
      uniforms: {
        lightMap: { value: this.receiver.texture },
        resolution: { value: new THREE.Vector2() },
        center: { value: new THREE.Vector2() },
        zoom: { value: 1 },
        exposure: { value: 1 },
        hue: { value: 0 },
      },
    });
    this.root.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.display));
  }
  protected update(_dt: number): void {
    if (!this.renderer || !this.photonMaterial || !this.display) return;
    const p = this.params,
      a = this.audio,
      u = this.photonMaterial.uniforms;
    u.phase.value = this.phase * 4;
    u.amplitude.value = p.waveHeight * (1 + a.bass * p.bassResponse * 0.2);
    u.depth.value = p.depth;
    const renderer = this.renderer,
      target = renderer.getRenderTarget(),
      clear = renderer.getClearColor(new THREE.Color()),
      alpha = renderer.getClearAlpha(),
      auto = renderer.autoClear;
    try {
      renderer.setRenderTarget(this.receiver);
      renderer.setClearColor(0, 0);
      renderer.autoClear = true;
      renderer.render(this.photons, this.camera);
    } finally {
      renderer.setRenderTarget(target);
      renderer.setClearColor(clear, alpha);
      renderer.autoClear = auto;
    }
    const d = this.display.uniforms;
    d.resolution.value.set(this.width, this.height);
    d.center.value.set(this.view.centerX, this.view.centerY);
    d.zoom.value = this.view.zoom;
    d.exposure.value = p.brightness * (0.5 + a.rms * p.rmsResponse);
    d.hue.value = a.spectralCentroid * p.centroidResponse;
  }
  override dispose(): void {
    for (const object of this.photons.children)
      (object as THREE.Points).geometry.dispose();
    this.photonMaterial?.dispose();
    this.receiver.dispose();
    super.dispose();
  }
}
registerVisualizer({
  metadata,
  create: (bus) => new RefractedCausticsVisualizer(bus),
});
