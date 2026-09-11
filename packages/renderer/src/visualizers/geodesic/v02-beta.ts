import * as THREE from 'three';
import type { MessageBus } from '@cybernoetica/core';
import { ModelVisualizer, MODEL_PARAMS, MODEL_VIEW_3D } from '../model-base.js';
import { registerVisualizer } from '../registry.js';
import type { VisualizerMetadata } from '../types.js';
const metadata: VisualizerMetadata = {
  type: 'geodesic-beta',
  label: 'Icosahedral Sphere',
  description: 'Subdivided icosahedron with actual triangle edges',
  usesPerspective: true,
  params: [
    {
      key: 'detail',
      label: 'Subdivision frequency',
      min: 0,
      max: 6,
      step: 1,
      initial: 3,
      category: 'appearance',
    },
    ...MODEL_PARAMS,
  ],
  viewport: { pan: false, zoom: true, orbit: true },
  viewStateFields: MODEL_VIEW_3D,
};
export class IcosahedralVisualizer extends ModelVisualizer {
  private mesh: THREE.Mesh | null = null;
  private detail = -1;
  private material: THREE.ShaderMaterial | null = null;
  constructor(bus: MessageBus) {
    super(metadata, bus);
  }
  protected build(): void {
    this.material = new THREE.ShaderMaterial({
      vertexShader: `attribute vec3 barycentric;varying vec3 bary;varying vec3 n;void main(){bary=barycentric;n=normalize(normalMatrix*normal);gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`,
      fragmentShader: `uniform float hue;uniform float brightness;varying vec3 bary;varying vec3 n;void main(){vec3 edge=smoothstep(vec3(0.),fwidth(bary)*1.5,bary);float fill=min(edge.x,min(edge.y,edge.z));float light=.25+.75*max(0.,dot(normalize(n),normalize(vec3(1.,1.,2.))));vec3 color=.6+.4*cos(6.28318*(hue+vec3(0.,.33,.67)));gl_FragColor=vec4(mix(color*.12, color*light,fill)*brightness,1.);}`,
      uniforms: { hue: { value: 0 }, brightness: { value: 1 } },
    });
    this.mesh = new THREE.Mesh(new THREE.BufferGeometry(), this.material);
    this.root.add(this.mesh);
  }
  protected update(_dt: number): void {
    if (!this.mesh || !this.material) return;
    const detail = Math.round(this.params.detail);
    if (detail !== this.detail) {
      this.mesh.geometry.dispose();
      const geometry = new THREE.IcosahedronGeometry(1.7, detail),
        bary = new Float32Array(geometry.getAttribute('position').count * 3);
      for (let i = 0; i < bary.length; i += 9)
        bary.set([1, 0, 0, 0, 1, 0, 0, 0, 1], i);
      geometry.setAttribute('barycentric', new THREE.BufferAttribute(bary, 3));
      this.mesh.geometry = geometry;
      this.detail = detail;
    }
    this.mesh.scale.setScalar(
      1 + this.audio.bass * this.params.bassResponse * 0.08,
    );
    this.mesh.rotation.z = this.phase * 0.2;
    this.material.uniforms.hue.value =
      this.audio.spectralCentroid * this.params.centroidResponse;
    this.material.uniforms.brightness.value =
      this.params.brightness * (0.7 + this.audio.rms * this.params.rmsResponse);
  }
}
registerVisualizer({
  metadata,
  create: (bus) => new IcosahedralVisualizer(bus),
});
