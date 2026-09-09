import * as THREE from 'three';
import type {
  AudioFeatures,
  MessageBus,
  Unsubscribe,
} from '@cybernoetica/core';
import type { Visualizer, VisualizerMetadata } from '../types.js';
import { registerVisualizer } from '../registry.js';
import { frameDelta, takeAudioFrame } from '../../timing.js';
import { EMASmoothing, EventEnvelope } from '../../smoothing.js';
import { TorusLinkCurve } from '../../geometry/torus-link.js';
import { gcd } from '../../geometry/curves.js';

const torusKnotMetadata: VisualizerMetadata = {
  type: 'torusknot',
  label: 'Torus Knot',
  description: 'Complete torus links rendered as shaded tube geometry',
  usesPerspective: true,
  params: [
    {
      key: 'knotP',
      label: 'P (windings)',
      min: 1.0,
      max: 9.0,
      step: 1.0,
      initial: 3.0,
      category: 'appearance',
      description: 'Windings around symmetry axis',
    },
    {
      key: 'knotQ',
      label: 'Q (windings)',
      min: 1.0,
      max: 7.0,
      step: 1.0,
      initial: 2.0,
      category: 'appearance',
      description: 'Windings around torus interior',
    },
    {
      key: 'tubeRadius',
      label: 'Tube Radius',
      min: 0.02,
      max: 0.3,
      step: 0.01,
      initial: 0.14,
      category: 'appearance',
      description: 'Thickness of the knot tube',
    },
    {
      key: 'torusRadius',
      label: 'Torus Radius',
      min: 0.5,
      max: 2.0,
      step: 0.05,
      initial: 1.0,
      category: 'appearance',
      description: 'Major radius of the torus',
    },
    {
      key: 'rotSpeed',
      label: 'Rotation Speed',
      min: 0.0,
      max: 1.0,
      step: 0.05,
      initial: 0.3,
      category: 'appearance',
      description: 'Auto-rotation speed',
    },
    {
      key: 'iridescence',
      label: 'Iridescence',
      min: 0.0,
      max: 2.0,
      step: 0.1,
      initial: 1.2,
      category: 'appearance',
      description: 'Rainbow sheen intensity',
    },
    {
      key: 'bassToRadius',
      label: 'Bass → Radius',
      min: 0.0,
      max: 2.0,
      step: 0.1,
      initial: 1.0,
      category: 'audio-mapping',
      description: 'Bass thickens the tube',
    },
    {
      key: 'midToRotation',
      label: 'Mid → Rotation',
      min: 0.0,
      max: 2.0,
      step: 0.1,
      initial: 1.0,
      category: 'audio-mapping',
      description: 'Mids drive rotation speed',
    },
    {
      key: 'highToIridescence',
      label: 'High → Iridescence',
      min: 0.0,
      max: 2.0,
      step: 0.1,
      initial: 1.0,
      category: 'audio-mapping',
      description: 'Highs drive rainbow coloring',
    },
    {
      key: 'rmsToGlow',
      label: 'RMS → Glow',
      min: 0.0,
      max: 2.0,
      step: 0.1,
      initial: 1.0,
      category: 'audio-mapping',
      description: 'Volume boosts emission',
    },
    {
      key: 'beatToPulse',
      label: 'Beat → Pulse',
      min: 0.0,
      max: 2.0,
      step: 0.1,
      initial: 1.0,
      category: 'audio-mapping',
      description: 'Beats pulse the tube radius',
    },
    {
      key: 'centroidToHue',
      label: 'Centroid → Hue',
      min: 0.0,
      max: 2.0,
      step: 0.1,
      initial: 0.8,
      category: 'audio-mapping',
      description: 'Spectral centroid shifts hue',
    },
  ],
  viewport: { pan: false, zoom: true, orbit: true },
  viewStateFields: [
    {
      key: 'orbitAngle',
      label: 'Orbit angle',
      min: -Math.PI,
      max: Math.PI,
      step: 0.01,
    },
    { key: 'elevation', label: 'Elevation', min: -1.5, max: 1.5, step: 0.01 },
    { key: 'distance', label: 'Distance', min: 4, max: 30, step: 0.1 },
  ],
};
export class TorusKnotVisualizer implements Visualizer {
  readonly metadata = torusKnotMetadata;
  private params = Object.fromEntries(
    this.metadata.params.map((p) => [p.key, p.initial]),
  );
  private view = { orbitAngle: 0, elevation: 0.4, distance: 5 };
  private root = new THREE.Group();
  private material: THREE.ShaderMaterial | null = null;
  private latest: AudioFeatures | null = null;
  private unsub: Unsubscribe;
  private shape = '';
  private phase = 0;
  private smooth = Object.fromEntries(
    ['bass', 'mid', 'high', 'rms', 'spectralCentroid'].map((key) => [
      key,
      new EMASmoothing(0.06),
    ]),
  );
  private pulse = new EventEnvelope();
  constructor(bus: MessageBus) {
    this.unsub = bus.subscribe<AudioFeatures>('audio:features', (msg) => {
      this.latest = { ...msg.payload };
    });
  }
  attach(scene: THREE.Scene): void {
    this.material = new THREE.ShaderMaterial({
      vertexShader: `attribute vec3 center;uniform float radius;uniform float major;varying vec3 vNormal;varying vec3 vPosition;
      void main(){vec3 p=center*major+normal*radius;vec4 mv=modelViewMatrix*vec4(p,1.);vPosition=mv.xyz;vNormal=normalize(normalMatrix*normal);gl_Position=projectionMatrix*mv;}`,
      fragmentShader: `uniform float hue;uniform float sheen;uniform float glow;varying vec3 vNormal;varying vec3 vPosition;
      void main(){vec3 n=normalize(vNormal),v=normalize(-vPosition);float facing=abs(dot(n,v));
        vec3 rainbow=.55+.45*cos(6.2831853*(hue+facing+vec3(0.,.33,.67)));
        vec3 c=mix(vec3(.65,.7,.8),rainbow,clamp(sheen*(1.-facing),0.,1.));
        float light=.2+.8*max(0.,dot(n,normalize(vec3(1.,1.,2.))));gl_FragColor=vec4(c*light*glow,1.);}`,
      uniforms: {
        radius: { value: 0.14 },
        major: { value: 1 },
        hue: { value: 0 },
        sheen: { value: 1 },
        glow: { value: 1 },
      },
      side: THREE.DoubleSide,
    });
    scene.add(this.root);
    this.tick(0);
  }
  private rebuild(): void {
    const p = Math.round(this.params.knotP),
      q = Math.round(this.params.knotQ),
      key = `${p}/${q}`;
    if (key === this.shape || !this.material) return;
    this.shape = key;
    for (const child of [...this.root.children]) {
      (child as THREE.Mesh).geometry.dispose();
      this.root.remove(child);
    }
    const components = gcd(p, q),
      segments = Math.max(128, (96 * Math.max(p, q)) / components);
    for (let j = 0; j < components; j++) {
      const geometry = new THREE.TubeGeometry(
        new TorusLinkCurve(p, q, j),
        segments,
        1,
        10,
        true,
      );
      const positions = geometry.getAttribute('position'),
        normals = geometry.getAttribute('normal'),
        centers = new Float32Array(positions.count * 3);
      for (let i = 0; i < positions.count; i++)
        centers.set(
          [
            positions.getX(i) - normals.getX(i),
            positions.getY(i) - normals.getY(i),
            positions.getZ(i) - normals.getZ(i),
          ],
          i * 3,
        );
      geometry.setAttribute('center', new THREE.BufferAttribute(centers, 3));
      const mesh = new THREE.Mesh(geometry, this.material);
      mesh.frustumCulled = false;
      this.root.add(mesh);
    }
  }
  tick(deltaSeconds = 1 / 60): void {
    const dt = frameDelta(deltaSeconds),
      f = this.latest ? takeAudioFrame(this.latest) : null,
      p = this.params,
      a: Record<string, number> = {};
    for (const key of Object.keys(this.smooth))
      a[key] = this.smooth[key].update(
        (f?.[key as keyof AudioFeatures] as number) ?? 0,
        dt,
      );
    const pulse = this.pulse.update(f?.beatOnset ? 1 : 0, dt);
    this.phase += dt * p.rotSpeed * (1 + a.mid * p.midToRotation);
    this.root.rotation.z = this.phase * 0.3;
    this.rebuild();
    if (!this.material) return;
    const u = this.material.uniforms;
    u.radius.value =
      p.tubeRadius *
      (1 + 0.3 * a.bass * p.bassToRadius + 0.08 * pulse * p.beatToPulse);
    u.major.value = p.torusRadius;
    u.hue.value = a.spectralCentroid * p.centroidToHue;
    u.sheen.value = p.iridescence + a.high * p.highToIridescence;
    u.glow.value = 0.8 + a.rms * p.rmsToGlow;
  }
  setResolution(_w: number, _h: number): void {}
  setUserParam(key: string, value: number): void {
    const field = this.metadata.params.find((p) => p.key === key);
    if (field && Number.isFinite(value))
      this.params[key] = Math.max(field.min, Math.min(field.max, value));
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
    this.root.removeFromParent();
    for (const child of this.root.children)
      (child as THREE.Mesh).geometry.dispose();
    this.material?.dispose();
  }
}
registerVisualizer({
  metadata: torusKnotMetadata,
  create: (bus) => new TorusKnotVisualizer(bus),
});
