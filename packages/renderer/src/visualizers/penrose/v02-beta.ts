import * as THREE from 'three';
import type { MessageBus } from '@cybernoetica/core';
import { ModelVisualizer, MODEL_PARAMS, MODEL_VIEW_2D } from '../model-base.js';
import { penroseTriangles } from '../../geometry/penrose.js';
import { registerVisualizer } from '../registry.js';
import type { VisualizerMetadata } from '../types.js';
const metadata: VisualizerMetadata = {
  type: 'penrose-beta',
  label: 'Penrose Inflation',
  description:
    'Oriented Robinson-triangle substitution with shared matching edges',
  usesPerspective: false,
  params: [
    {
      key: 'depth',
      label: 'Subdivisions',
      min: 1,
      max: 7,
      step: 1,
      initial: 5,
      category: 'appearance',
    },
    ...MODEL_PARAMS,
  ],
  viewport: { pan: true, zoom: true, orbit: false },
  viewStateFields: MODEL_VIEW_2D,
};
export class PenroseInflationVisualizer extends ModelVisualizer {
  private geometry = new THREE.BufferGeometry();
  private material: THREE.ShaderMaterial | null = null;
  private depth = -1;
  constructor(bus: MessageBus) {
    super(metadata, bus);
  }
  protected build(): void {
    this.material = new THREE.ShaderMaterial({
      side: THREE.DoubleSide,
      vertexShader: `attribute vec3 barycentric;attribute float tileType;uniform vec2 resolution;uniform vec2 center;uniform float zoom;uniform float phase;varying vec3 bary;varying float kind;
      void main(){bary=barycentric;kind=tileType;vec2 p=mat2(cos(phase),-sin(phase),sin(phase),cos(phase))*position.xy*.5;gl_Position=vec4((p-center)*zoom*2.*min(resolution.x,resolution.y)/resolution,0.,1.);}`,
      fragmentShader: `uniform float hue;uniform float brightness;varying vec3 bary;varying float kind;void main(){vec3 edge=smoothstep(vec3(0.),fwidth(bary)*1.2,bary);float fill=min(edge.x,min(edge.y,edge.z));vec3 color=.55+.45*cos(6.28318*(hue+kind*.22+vec3(0.,.33,.67)));gl_FragColor=vec4(color*mix(.12,.7,fill)*brightness,1.);}`,
      uniforms: {
        resolution: { value: new THREE.Vector2() },
        center: { value: new THREE.Vector2() },
        zoom: { value: 1 },
        phase: { value: 0 },
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
      const triangles = penroseTriangles(depth),
        positions = new Float32Array(triangles.length * 9),
        bary = new Float32Array(positions.length),
        types = new Float32Array(triangles.length * 3);
      triangles.forEach((t, i) => {
        positions.set(
          [t.a[0], t.a[1], 0, t.b[0], t.b[1], 0, t.c[0], t.c[1], 0],
          i * 9,
        );
        bary.set([1, 0, 0, 0, 1, 0, 0, 0, 1], i * 9);
        types.set([t.type, t.type, t.type], i * 3);
      });
      this.geometry.dispose();
      this.geometry.setAttribute(
        'position',
        new THREE.BufferAttribute(positions, 3),
      );
      this.geometry.setAttribute(
        'barycentric',
        new THREE.BufferAttribute(bary, 3),
      );
      this.geometry.setAttribute(
        'tileType',
        new THREE.BufferAttribute(types, 1),
      );
      this.depth = depth;
    }
    if (!this.material) return;
    const u = this.material.uniforms;
    u.resolution.value.set(this.width, this.height);
    u.center.value.set(this.view.centerX, this.view.centerY);
    u.zoom.value =
      this.view.zoom * (1 + this.audio.bass * this.params.bassResponse * 0.06);
    u.phase.value = this.phase;
    u.hue.value = this.audio.spectralCentroid * this.params.centroidResponse;
    u.brightness.value =
      this.params.brightness * (0.6 + this.audio.rms * this.params.rmsResponse);
  }
}
registerVisualizer({
  metadata,
  create: (bus) => new PenroseInflationVisualizer(bus),
});
