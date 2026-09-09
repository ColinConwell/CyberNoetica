import * as THREE from 'three';
import type { MessageBus } from '@cybernoetica/core';
import type { VisualizerMetadata } from '../types.js';
import { registerVisualizer } from '../registry.js';
import { ModelVisualizer } from '../model-base.js';
const phyllotaxisMetadata: VisualizerMetadata = {
  type: 'phyllotaxis',
  label: 'Phyllotaxis',
  description: 'Fibonacci spiral golden ratio geometry',
  usesPerspective: false,
  params: [
    {
      key: 'fidelity',
      label: 'Preserve golden angle',
      min: 0,
      max: 1,
      step: 1,
      initial: 1,
      category: 'appearance',
    },
    // Appearance
    {
      key: 'pointCount',
      label: 'Point Count',
      min: 200,
      max: 3000,
      step: 100,
      initial: 1500,
      category: 'appearance',
    },
    {
      key: 'spread',
      label: 'Spread',
      min: 0.3,
      max: 2.0,
      step: 0.05,
      initial: 1.0,
      category: 'appearance',
    },
    {
      key: 'pointSize',
      label: 'Point Size',
      min: 0.5,
      max: 4.0,
      step: 0.25,
      initial: 1.5,
      category: 'appearance',
    },
    {
      key: 'colorCycle',
      label: 'Color Cycle',
      min: 0.0,
      max: 1.0,
      step: 0.05,
      initial: 0.3,
      category: 'appearance',
    },
    {
      key: 'rotationSpeed',
      label: 'Rotation',
      min: 0.0,
      max: 0.5,
      step: 0.02,
      initial: 0.08,
      category: 'appearance',
    },
    // Audio mapping
    {
      key: 'spectralToAngle',
      label: 'Spectral -> Angle',
      min: 0.0,
      max: 2.0,
      step: 0.1,
      initial: 1.0,
      category: 'audio-mapping',
      description: 'How strongly spectral centroid deviates the golden angle',
    },
    {
      key: 'rmsToBreath',
      label: 'RMS -> Breath',
      min: 0.0,
      max: 2.0,
      step: 0.1,
      initial: 1.0,
      category: 'audio-mapping',
      description: 'How strongly volume drives radial expansion',
    },
    {
      key: 'bassToSize',
      label: 'Bass -> Size',
      min: 0.0,
      max: 2.0,
      step: 0.1,
      initial: 1.0,
      category: 'audio-mapping',
      description: 'How strongly bass affects point bloom',
    },
    {
      key: 'midToDepth',
      label: 'Mid → Radial Ripple',
      min: 0.0,
      max: 2.0,
      step: 0.1,
      initial: 1.0,
      category: 'audio-mapping',
      description: 'How strongly mids add a radial ripple (2D)',
    },
  ],
  viewport: { pan: false, zoom: true, orbit: false },
  viewStateFields: [
    { key: 'zoom', label: 'Zoom', min: 0.3, max: 4.0, step: 0.05 },
    { key: 'rotation', label: 'Rotation', min: 0, max: 6.283, step: 0.01 },
  ],
};
export class PhyllotaxisVisualizer extends ModelVisualizer {
  private geometry = new THREE.BufferGeometry();
  private material: THREE.ShaderMaterial | null = null;
  private rotation = 0;
  private colorPhase = 0;
  private rotationOverride = false;
  constructor(bus: MessageBus) {
    super(phyllotaxisMetadata, bus);
  }
  protected build(): void {
    const data = new Float32Array(3000 * 3);
    for (let i = 0; i < 3000; i++) data[3 * i] = i;
    this.geometry.setAttribute('position', new THREE.BufferAttribute(data, 3));
    this.material = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      vertexShader: `uniform vec2 resolution;uniform float count;uniform float spread;uniform float angle;uniform float rotation;uniform float zoom;uniform float pointSize;uniform float ripple;uniform float time;varying float ratio;
      void main(){float n=position.x;ratio=n/count;float theta=n*angle+rotation;float radius=.39*sqrt(n/count)*spread+sin(n*.1+time)*ripple;vec2 p=radius*vec2(cos(theta),sin(theta));gl_Position=vec4(p*zoom*2.*min(resolution.x,resolution.y)/resolution,0.,1.);gl_PointSize=pointSize;}`,
      fragmentShader: `uniform float hue;uniform float brightness;varying float ratio;void main(){float r=length(gl_PointCoord-.5)*2.;if(r>1.)discard;vec3 color=.55+.45*cos(6.28318*(hue+ratio+vec3(0.,.33,.67)));gl_FragColor=vec4(color*brightness,exp(-r*r*4.));}`,
      uniforms: {
        resolution: { value: new THREE.Vector2() },
        count: { value: 1500 },
        spread: { value: 1 },
        angle: { value: Math.PI * (3 - Math.sqrt(5)) },
        rotation: { value: 0 },
        zoom: { value: 1 },
        pointSize: { value: 3 },
        ripple: { value: 0 },
        time: { value: 0 },
        hue: { value: 0 },
        brightness: { value: 1 },
      },
    });
    const points = new THREE.Points(this.geometry, this.material);
    points.frustumCulled = false;
    this.root.add(points);
  }
  protected update(dt: number): void {
    const p = this.params,
      a = this.audio;
    this.rotation += dt * p.rotationSpeed;
    this.colorPhase += dt * p.colorCycle * 0.05;
    this.geometry.setDrawRange(0, Math.round(p.pointCount));
    if (!this.material) return;
    const u = this.material.uniforms;
    u.resolution.value.set(this.width, this.height);
    u.count.value = p.pointCount;
    u.spread.value = p.spread * (1 + a.rms * 0.15 * p.rmsToBreath);
    u.zoom.value = this.view.zoom;
    u.angle.value =
      Math.PI * (3 - Math.sqrt(5)) +
      (p.fidelity > 0.5 ? 0 : a.spectralCentroid * 0.003 * p.spectralToAngle);
    u.rotation.value = this.rotationOverride
      ? this.view.rotation
      : this.rotation;
    u.pointSize.value = p.pointSize * 3 * (1 + a.bass * 0.5 * p.bassToSize);
    u.ripple.value = a.mid * 0.004 * p.midToDepth;
    u.time.value = this.time;
    u.hue.value = this.colorPhase;
    u.brightness.value = 0.7 + a.rms;
  }
  override getViewState(): Record<string, number> {
    return {
      zoom: this.view.zoom,
      rotation: this.rotationOverride
        ? (this.view.rotation ?? 0)
        : this.rotation % (Math.PI * 2),
    };
  }
  override setViewState(partial: Record<string, number>): void {
    super.setViewState(partial);
    if (Number.isFinite(partial.rotation)) this.rotationOverride = true;
  }
}
registerVisualizer({
  metadata: phyllotaxisMetadata,
  create: (bus) => new PhyllotaxisVisualizer(bus),
});
