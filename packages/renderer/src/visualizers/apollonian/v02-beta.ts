import * as THREE from 'three';
import type { MessageBus } from '@cybernoetica/core';
import { ModelVisualizer, MODEL_PARAMS, MODEL_VIEW_2D } from '../model-base.js';
import {
  apollonianPacking,
  diskAutomorphismCircle,
} from '../../geometry/packing.js';
import { registerVisualizer } from '../registry.js';
import type { VisualizerMetadata } from '../types.js';
const metadata: VisualizerMetadata = {
  type: 'apollonian-beta',
  label: 'Descartes Packing',
  description: 'Tangent circles from Descartes curvature reflections',
  usesPerspective: false,
  params: [
    {
      key: 'depth',
      label: 'Packing depth',
      min: 2,
      max: 8,
      step: 1,
      initial: 6,
      category: 'appearance',
    },
    ...MODEL_PARAMS,
  ],
  viewport: { pan: true, zoom: true, orbit: false },
  viewStateFields: MODEL_VIEW_2D,
};
export class ApollonianPackingVisualizer extends ModelVisualizer {
  private geometry = new THREE.InstancedBufferGeometry();
  private material: THREE.ShaderMaterial | null = null;
  private circles = apollonianPacking();
  private attributes = new Float32Array(6004 * 3);
  private depth = -1;
  constructor(bus: MessageBus) {
    super(metadata, bus);
  }
  protected build(): void {
    const quad = new THREE.PlaneGeometry(2, 2);
    this.geometry.index = quad.index;
    this.geometry.attributes = quad.attributes;
    this.geometry.setAttribute(
      'circle',
      new THREE.InstancedBufferAttribute(this.attributes, 3).setUsage(
        THREE.DynamicDrawUsage,
      ),
    );
    this.material = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      vertexShader: `attribute vec3 circle;uniform vec2 resolution;uniform vec2 center;uniform float zoom;varying vec2 local;varying float size;
      void main(){local=position.xy;size=circle.z;vec2 p=(circle.xy+position.xy*circle.z)*.43;gl_Position=vec4((p-center)*zoom*2.*min(resolution.x,resolution.y)/resolution,0.,1.);}`,
      fragmentShader: `uniform float hue;uniform float brightness;varying vec2 local;varying float size;void main(){float r=length(local),aa=fwidth(r);float line=1.-smoothstep(0.,aa*1.5,abs(r-1.));vec3 color=.55+.45*cos(6.28318*(hue+log(size)*.06+vec3(0.,.33,.67)));gl_FragColor=vec4(color*brightness,line);}`,
      uniforms: {
        resolution: { value: new THREE.Vector2() },
        center: { value: new THREE.Vector2() },
        zoom: { value: 1 },
        hue: { value: 0 },
        brightness: { value: 1 },
      },
    });
    const mesh = new THREE.Mesh(this.geometry, this.material);
    mesh.frustumCulled = false;
    this.root.add(mesh);
  }
  protected update(_dt: number): void {
    const depth = Math.round(this.params.depth);
    if (depth !== this.depth) {
      this.circles = apollonianPacking(depth);
      this.depth = depth;
    }
    const a =
      Math.sin(this.phase) * this.audio.bass * this.params.bassResponse * 0.45;
    this.circles.forEach((circle, i) => {
      const c = diskAutomorphismCircle(circle, a);
      this.attributes.set([c.x, c.y, c.r], i * 3);
    });
    this.geometry.instanceCount = this.circles.length;
    this.geometry.getAttribute('circle').needsUpdate = true;
    if (!this.material) return;
    const u = this.material.uniforms;
    u.resolution.value.set(this.width, this.height);
    u.center.value.set(this.view.centerX, this.view.centerY);
    u.zoom.value = this.view.zoom;
    u.hue.value = this.audio.spectralCentroid * this.params.centroidResponse;
    u.brightness.value =
      this.params.brightness * (0.6 + this.audio.rms * this.params.rmsResponse);
  }
}
registerVisualizer({
  metadata,
  create: (bus) => new ApollonianPackingVisualizer(bus),
});
