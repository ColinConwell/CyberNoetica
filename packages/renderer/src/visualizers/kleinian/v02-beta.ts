import * as THREE from 'three';
import type { MessageBus } from '@cybernoetica/core';
import { ModelVisualizer, MODEL_PARAMS, MODEL_VIEW_2D } from '../model-base.js';
import { schottkyPoints } from '../../geometry/schottky.js';
import { registerVisualizer } from '../registry.js';
import type { VisualizerMetadata } from '../types.js';
const metadata: VisualizerMetadata = {
  type: 'kleinian-beta',
  label: 'Classical Schottky',
  description:
    'Limit set of two explicit Möbius generators pairing four disjoint circles',
  usesPerspective: false,
  params: [
    {
      key: 'radius',
      label: 'Defining circle radius',
      min: 0.35,
      max: 0.85,
      step: 0.01,
      initial: 0.78,
      category: 'appearance',
      description:
        'Centers at (±1.3,0), (0,±1.3); all circles remain strictly disjoint',
    },
    ...MODEL_PARAMS,
  ],
  viewport: { pan: true, zoom: true, orbit: false },
  viewStateFields: MODEL_VIEW_2D,
};
export class SchottkyVisualizer extends ModelVisualizer {
  private positions = new Float32Array(32768 * 3);
  private geometry = new THREE.BufferGeometry();
  private material: THREE.ShaderMaterial | null = null;
  private elapsed = 1;
  constructor(bus: MessageBus) {
    super(metadata, bus);
  }
  protected build(): void {
    this.geometry.setAttribute(
      'position',
      new THREE.BufferAttribute(this.positions, 3).setUsage(
        THREE.DynamicDrawUsage,
      ),
    );
    this.material = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      vertexShader: `uniform vec2 resolution;uniform vec2 center;uniform float zoom;uniform float phase;void main(){vec2 p=mat2(cos(phase),-sin(phase),sin(phase),cos(phase))*position.xy*.24;gl_Position=vec4((p-center)*zoom*2.*min(resolution.x,resolution.y)/resolution,0.,1.);gl_PointSize=1.6;}`,
      fragmentShader: `uniform float hue;uniform float brightness;void main(){float r=length(gl_PointCoord-.5);if(r>.5)discard;vec3 color=.55+.45*cos(6.28318*(hue+vec3(0.,.33,.67)));gl_FragColor=vec4(color*brightness,.045);}`,
      uniforms: {
        resolution: { value: new THREE.Vector2() },
        center: { value: new THREE.Vector2() },
        zoom: { value: 1 },
        phase: { value: 0 },
        hue: { value: 0 },
        brightness: { value: 1 },
      },
    });
    const points = new THREE.Points(this.geometry, this.material);
    points.frustumCulled = false;
    this.root.add(points);
  }
  protected update(dt: number): void {
    this.elapsed += dt;
    if (this.elapsed > 0.1) {
      this.elapsed %= 0.1;
      schottkyPoints(
        this.positions,
        Math.min(
          0.87,
          this.params.radius +
            this.audio.bass * this.params.bassResponse * 0.02,
        ),
      );
      this.geometry.getAttribute('position').needsUpdate = true;
    }
    if (!this.material) return;
    const u = this.material.uniforms;
    u.resolution.value.set(this.width, this.height);
    u.center.value.set(this.view.centerX, this.view.centerY);
    u.zoom.value = this.view.zoom;
    u.phase.value = this.phase;
    u.hue.value = this.audio.spectralCentroid * this.params.centroidResponse;
    u.brightness.value =
      this.params.brightness * (0.6 + this.audio.rms * this.params.rmsResponse);
  }
}
registerVisualizer({ metadata, create: (bus) => new SchottkyVisualizer(bus) });
