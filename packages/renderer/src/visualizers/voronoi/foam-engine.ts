import { frameDelta, takeAudioFrame, PhaseClock } from '../../timing.js';
import * as THREE from 'three';
import { MessageBus } from '@cybernoetica/core';
import type {
  AudioFeatures,
  BusMessage,
  Unsubscribe,
} from '@cybernoetica/core';
import { EMASmoothing, EventEnvelope } from '../../smoothing.js';
import type {
  ViewStateField,
  Visualizer,
  VisualizerMetadata,
} from '../types.js';
import { VoroWorkerClient } from '../../voro/worker-client.js';
import type { VoroMesh, VoroMode } from '../../voro/backend.js';

export type SeedLayout = 'lissajous' | 'lattice' | 'shell' | 'scatter';

export const FOAM_VIEW_FIELDS: ViewStateField[] = [
  {
    key: 'orbitAngle',
    label: 'Orbit',
    min: -Math.PI,
    max: Math.PI,
    step: 0.02,
  },
  { key: 'elevation', label: 'Elevation', min: -1.2, max: 1.2, step: 0.02 },
  { key: 'distance', label: 'Distance', min: 4, max: 20, step: 0.1 },
];

export const FOAM_VIEWPORT = { pan: false, zoom: true, orbit: true } as const;

export interface FoamLook {
  hueOffset: number;
  faceSat: number;
  faceVal: number;
  edgeTint: [number, number, number];
}

export interface FoamConfig {
  metadata: VisualizerMetadata;
  mode: VoroMode;
  seedLayout: SeedLayout;
  halfExtent?: number;
  defaultParams: Record<string, number>;
  look?: FoamLook;
  orbitAngle?: number;
  elevation?: number;
  distance?: number;
}

const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));

const DEFAULT_LOOK: FoamLook = {
  hueOffset: 0,
  faceSat: 0.45,
  faceVal: 0.88,
  edgeTint: [0.55, 0.7, 1.0],
};

interface Seed {
  phase: number;
  freq: number;
  ampX: number;
  ampY: number;
  ampZ: number;
  phaseY: number;
  phaseZ: number;
  baseX: number;
  baseY: number;
  baseZ: number;
}

function hsv2rgb(h: number, s: number, v: number): [number, number, number] {
  const i = Math.floor(h * 6);
  const f = h * 6 - i;
  const p = v * (1 - s);
  const q = v * (1 - f * s);
  const t = v * (1 - (1 - f) * s);
  switch (i % 6) {
    case 0:
      return [v, t, p];
    case 1:
      return [q, v, p];
    case 2:
      return [p, v, t];
    case 3:
      return [p, q, v];
    case 4:
      return [t, p, v];
    default:
      return [v, p, q];
  }
}

function hash01(n: number): number {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
}

function wrapCoord(v: number, h: number): number {
  const w = h * 2;
  return ((((v + h) % w) + w) % w) - h;
}

/** True when a resolved Voro++ backend still belongs to this foam instance. */
export function foamLoadStillCurrent(
  disposed: boolean,
  startedGen: number,
  currentGen: number,
): boolean {
  return !disposed && startedGen === currentGen;
}

export class VoronoiFoamVisualizer implements Visualizer {
  private deltaSeconds = 1 / 60;
  private phases = new PhaseClock();
  readonly metadata: VisualizerMetadata;

  private unsub: Unsubscribe;
  private latestFeatures: AudioFeatures | null = null;
  private time = 0;
  private disposed = false;

  private userParams: Record<string, number>;
  private readonly halfExtent: number;
  private readonly look: FoamLook;

  private _orbitAngle: number;
  private _elevation: number;
  private _distance: number;

  private smoothers = {
    bass: new EMASmoothing(0.15),
    mid: new EMASmoothing(0.2),
    high: new EMASmoothing(0.25),
    rms: new EMASmoothing(0.2),
    spectralCentroid: new EMASmoothing(0.1),
    beatPulse: new EventEnvelope(),
  };

  private seeds: Seed[] = [];
  private xyz = new Float32Array(0);
  private radii = new Float32Array(0);

  private backend: VoroWorkerClient | null = null;
  private loadGen = 0;
  private skipUntil = 0;
  private meshAge = 1;
  private uploadedMesh: VoroMesh | null = null;
  private baseMesh: VoroMesh | null = null;

  private faceMesh: THREE.Mesh | null = null;
  private edgeLines: THREE.LineSegments | null = null;
  private seedPoints: THREE.Points | null = null;
  private faceMaterial: THREE.ShaderMaterial | null = null;
  private edgeMaterial: THREE.ShaderMaterial | null = null;
  private pointMaterial: THREE.PointsMaterial | null = null;
  private boundary: THREE.Mesh | null = null;
  private periodicImages: THREE.Object3D[] = [];
  private domainBox: THREE.LineSegments | null = null;
  private sceneRef: THREE.Scene | null = null;

  constructor(
    private readonly config: FoamConfig,
    private bus: MessageBus,
  ) {
    this.metadata = config.metadata;
    this.halfExtent = config.halfExtent ?? 2.0;
    this.look = config.look ?? DEFAULT_LOOK;
    this.userParams = { ...config.defaultParams };
    this._orbitAngle = config.orbitAngle ?? 0.4;
    this._elevation = config.elevation ?? 0.35;
    this._distance = config.distance ?? 8;

    this.unsub = bus.subscribe(
      'audio:features',
      (msg: BusMessage<AudioFeatures>) => {
        this.latestFeatures = { ...msg.payload };
      },
    );
    this.smoothers.bass.reset(0);
    this.smoothers.mid.reset(0);
    this.smoothers.high.reset(0);
    this.smoothers.rms.reset(0.1);
    this.smoothers.spectralCentroid.reset(0.5);
    this.smoothers.beatPulse.reset(0);
    this.rebuildSeeds(this.userParams.seedCount ?? 64);
  }

  attach(scene: THREE.Scene): void {
    this.sceneRef = scene;
    this.faceMaterial = new THREE.ShaderMaterial({
      vertexShader: FACE_VERT,
      fragmentShader: FACE_FRAG,
      uniforms: {
        u_opacity: { value: this.userParams.faceOpacity ?? 0.28 },
        u_glow: { value: 1.0 },
        u_beatPulse: { value: 0.0 },
        u_explode: { value: 0 },
        u_hueShift: { value: 0 },
        u_clipRadius: { value: 0 },
        u_meshMix: { value: 1 },
      },
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      vertexColors: true,
    });

    this.edgeMaterial = new THREE.ShaderMaterial({
      vertexShader: EDGE_VERT,
      fragmentShader: EDGE_FRAG,
      uniforms: {
        u_glow: { value: 1.0 },
        u_beatPulse: { value: 0.0 },
        u_explode: { value: 0 },
        u_hueShift: { value: 0 },
        u_clipRadius: { value: 0 },
        u_meshMix: { value: 1 },
      },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      vertexColors: true,
    });

    this.pointMaterial = new THREE.PointsMaterial({
      size: 0.07,
      vertexColors: true,
      transparent: true,
      opacity: 0.9,
      sizeAttenuation: true,
      depthWrite: false,
    });

    const emptyFace = new THREE.BufferGeometry();
    emptyFace.setAttribute(
      'position',
      new THREE.BufferAttribute(new Float32Array(9), 3),
    );
    emptyFace.setAttribute(
      'normal',
      new THREE.BufferAttribute(new Float32Array(9), 3),
    );
    emptyFace.setAttribute(
      'color',
      new THREE.BufferAttribute(new Float32Array(9), 3),
    );
    emptyFace.setAttribute(
      'a_previous',
      new THREE.BufferAttribute(new Float32Array(9), 3),
    );
    emptyFace.setAttribute(
      'a_center',
      new THREE.BufferAttribute(new Float32Array(9), 3),
    );
    emptyFace.setDrawRange(0, 0);
    this.faceMesh = new THREE.Mesh(emptyFace, this.faceMaterial);
    this.faceMesh.frustumCulled = false;
    scene.add(this.faceMesh);

    const emptyEdge = new THREE.BufferGeometry();
    emptyEdge.setAttribute(
      'position',
      new THREE.BufferAttribute(new Float32Array(6), 3),
    );
    emptyEdge.setAttribute(
      'color',
      new THREE.BufferAttribute(new Float32Array(6), 3),
    );
    emptyEdge.setAttribute(
      'a_previous',
      new THREE.BufferAttribute(new Float32Array(6), 3),
    );
    emptyEdge.setAttribute(
      'a_center',
      new THREE.BufferAttribute(new Float32Array(6), 3),
    );
    emptyEdge.setDrawRange(0, 0);
    this.edgeLines = new THREE.LineSegments(emptyEdge, this.edgeMaterial);
    this.edgeLines.frustumCulled = false;
    scene.add(this.edgeLines);

    const seedGeom = new THREE.BufferGeometry();
    seedGeom.setAttribute(
      'position',
      new THREE.BufferAttribute(this.xyz.slice(), 3),
    );
    seedGeom.setAttribute(
      'color',
      new THREE.BufferAttribute(new Float32Array(this.xyz.length), 3),
    );
    this.seedPoints = new THREE.Points(seedGeom, this.pointMaterial);
    this.seedPoints.frustumCulled = false;
    scene.add(this.seedPoints);

    if (this.config.mode === 'periodic') {
      this.domainBox = new THREE.LineSegments(
        new THREE.EdgesGeometry(
          new THREE.BoxGeometry(
            this.halfExtent * 2,
            this.halfExtent * 2,
            this.halfExtent * 2,
          ),
        ),
        new THREE.LineBasicMaterial({
          color: 0x7d9bcd,
          transparent: true,
          opacity: 0.25,
        }),
      );
      scene.add(this.domainBox);
      for (const offset of [
        [1, 0, 0],
        [-1, 0, 0],
        [0, 1, 0],
        [0, -1, 0],
        [0, 0, 1],
        [0, 0, -1],
      ])
        for (const original of [this.faceMesh, this.edgeLines]) {
          const image = original.clone();
          image.position.set(
            offset[0] * 2 * this.halfExtent,
            offset[1] * 2 * this.halfExtent,
            offset[2] * 2 * this.halfExtent,
          );
          image.visible = false;
          image.frustumCulled = false;
          scene.add(image);
          this.periodicImages.push(image);
        }
    }
    if (this.config.mode === 'sphere') {
      const material = new THREE.ShaderMaterial({
        vertexShader: `varying vec3 vPosition;void main(){vPosition=position;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`,
        fragmentShader: `uniform vec3 seeds[128];uniform int count;uniform float radius;uniform float hue;uniform float opacity;varying vec3 vPosition;
        void main(){vec3 p=normalize(vPosition)*radius;float d1=1e20,d2=1e20,id=0.;vec3 s1=vec3(0.),s2=vec3(0.);
          for(int i=0;i<128;i++){if(i>=count)break;float d=dot(p-seeds[i],p-seeds[i]);if(d<d1){d2=d1;s2=s1;d1=d;s1=seeds[i];id=float(i);}else if(d<d2){d2=d;s2=seeds[i];}}
          float distance=(d2-d1)/(2.*max(.001,length(s2-s1)));float edge=1.-smoothstep(0.,max(fwidth(distance),.006),distance);
          vec3 color=.55+.45*cos(6.28318*(hue+fract(sin(id*127.1+311.7)*43758.5453)+vec3(0.,.33,.67)));gl_FragColor=vec4(color*(.3+edge),opacity*(.3+.7*edge));}`,
        uniforms: {
          seeds: {
            value: Array.from({ length: 128 }, () => new THREE.Vector3()),
          },
          count: { value: 0 },
          radius: { value: 1 },
          hue: { value: 0 },
          opacity: { value: 0.2 },
        },
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
      });
      this.boundary = new THREE.Mesh(
        new THREE.SphereGeometry(1, 64, 32),
        material,
      );
      scene.add(this.boundary);
    }
    void this.startBackend();
  }

  private async startBackend(): Promise<void> {
    if (this.disposed || typeof Worker === 'undefined') return;
    this.backend = new VoroWorkerClient(
      {
        halfExtent: this.halfExtent,
        grid: 3,
        mode:
          this.config.mode === 'sphere' && this.userParams.boundaryMode === 1
            ? 'box'
            : this.config.mode,
        sphereRadius: this.userParams.sphereRadius,
      },
      (mesh) => {
        if (!this.disposed) this.baseMesh = mesh;
      },
    );
  }

  private rebuildSeeds(count: number): void {
    const requested = Math.max(16, Math.min(128, Math.round(count)));
    this.backend?.invalidate();
    this.seeds = [];
    const h = this.halfExtent;

    if (this.config.seedLayout === 'lattice') {
      const g = Math.max(3, Math.min(5, Math.round(Math.cbrt(requested))));
      const spacing = (2 * h) / g;
      let i = 0;
      for (let z = 0; z < g; z++) {
        for (let y = 0; y < g; y++) {
          for (let x = 0; x < g; x++) {
            this.seeds.push({
              phase: hash01(i + 1) * Math.PI * 2,
              freq: 0.08 + (i % 5) * 0.02,
              ampX: 0,
              ampY: 0,
              ampZ: 0,
              phaseY: hash01(i + 9) * 6.2,
              phaseZ: hash01(i + 13) * 5.1,
              baseX: -h + (x + 0.5) * spacing,
              baseY: -h + (y + 0.5) * spacing,
              baseZ: -h + (z + 0.5) * spacing,
            });
            i++;
          }
        }
      }
    } else if (this.config.seedLayout === 'shell') {
      const core = Math.max(4, Math.round(requested * 0.18));
      const shell = Math.max(12, requested - core);
      for (let i = 0; i < shell; i++) {
        const y = 1 - (i / Math.max(1, shell - 1)) * 2;
        const r = Math.sqrt(Math.max(0, 1 - y * y));
        const theta = GOLDEN_ANGLE * i;
        this.seeds.push({
          phase: theta,
          freq: 0.1 + (i % 6) * 0.02,
          ampX: 0,
          ampY: 0,
          ampZ: 0,
          phaseY: hash01(i + 3) * 4,
          phaseZ: hash01(i + 7) * 5,
          baseX: Math.cos(theta) * r,
          baseY: y,
          baseZ: Math.sin(theta) * r,
        });
      }
      for (let i = 0; i < core; i++) {
        const t = (i + 0.5) / core;
        this.seeds.push({
          phase: t * Math.PI * 2,
          freq: 0.12 + i * 0.015,
          ampX: 0.35,
          ampY: 0.32,
          ampZ: 0.3,
          phaseY: t * 3.7,
          phaseZ: t * 5.1,
          baseX: 0,
          baseY: 0,
          baseZ: 0,
        });
      }
    } else if (this.config.seedLayout === 'scatter') {
      for (let i = 0; i < requested; i++) {
        this.seeds.push({
          phase: hash01(i + 1) * Math.PI * 2,
          freq: 0.1 + (i % 6) * 0.02,
          ampX: 0,
          ampY: 0,
          ampZ: 0,
          phaseY: hash01(i + 9) * 6.2,
          phaseZ: hash01(i + 13) * 5.1,
          baseX: (hash01(i + 21) * 2 - 1) * h * 0.82,
          baseY: (hash01(i + 37) * 2 - 1) * h * 0.82,
          baseZ: (hash01(i + 53) * 2 - 1) * h * 0.82,
        });
      }
    } else {
      for (let i = 0; i < requested; i++) {
        const t = i / requested;
        this.seeds.push({
          phase: t * Math.PI * 2,
          freq: 0.14 + (i % 7) * 0.028,
          ampX: 0.85 + (i % 5) * 0.12,
          ampY: 0.8 + (i % 4) * 0.14,
          ampZ: 0.78 + (i % 6) * 0.11,
          phaseY: t * 4.13,
          phaseZ: t * 5.71,
          baseX: 0,
          baseY: 0,
          baseZ: 0,
        });
      }
    }

    this.xyz = new Float32Array(this.seeds.length * 3);
    this.radii = new Float32Array(this.seeds.length);
    this.baseMesh = null;
    this.uploadedMesh = null;
  }

  private updateSeeds(
    jitter: number,
    drift: number,
    bass: number,
    mid: number,
  ): void {
    const t = this.phases.advance(
      'seed-drift',
      0.35 + drift * 1.4,
      this.deltaSeconds,
    );
    const h = this.halfExtent;
    const layout = this.config.seedLayout;
    const sphereR = this.userParams.sphereRadius ?? h * 0.9;
    const contrast = this.userParams.radiusContrast ?? 1.0;

    for (let i = 0; i < this.seeds.length; i++) {
      const s = this.seeds[i];
      let x: number, y: number, z: number;

      if (layout === 'lattice') {
        const j = jitter * 0.18;
        x = s.baseX + j * Math.sin(t * 2.1 + s.phase);
        y = s.baseY + j * Math.cos(t * 1.7 + s.phaseY);
        z = s.baseZ + j * Math.sin(t * 2.4 + s.phaseZ);
        x = wrapCoord(x, h);
        y = wrapCoord(y, h);
        z = wrapCoord(z, h);
      } else if (layout === 'scatter') {
        const j = jitter * 0.16;
        x = s.baseX + j * Math.sin(t * 2.1 + s.phase);
        y = s.baseY + j * Math.cos(t * 1.7 + s.phaseY);
        z = s.baseZ + j * Math.sin(t * 2.4 + s.phaseZ);
        const clamp = h * 0.92;
        x = Math.max(-clamp, Math.min(clamp, x));
        y = Math.max(-clamp, Math.min(clamp, y));
        z = Math.max(-clamp, Math.min(clamp, z));
      } else if (layout === 'shell') {
        const breathe = 0.78 + 0.08 * Math.sin(t * s.freq + s.phase);
        const shellR = sphereR * breathe;
        if (s.ampX > 0.01) {
          x = s.ampX * Math.sin(t * s.freq + s.phase);
          y = s.ampY * Math.sin(t * s.freq * 1.2 + s.phaseY);
          z = s.ampZ * Math.sin(t * s.freq * 0.9 + s.phaseZ);
          x += jitter * 0.12 * Math.sin(t * 3.0 + s.phase);
          y += jitter * 0.12 * Math.cos(t * 2.6 + s.phaseY);
          z += jitter * 0.12 * Math.sin(t * 3.4 + s.phaseZ);
        } else {
          x = s.baseX * shellR;
          y = s.baseY * shellR;
          z = s.baseZ * shellR;
          x += jitter * 0.1 * Math.sin(t * 2.8 + s.phase);
          y += jitter * 0.1 * Math.cos(t * 2.2 + s.phaseY);
          z += jitter * 0.1 * Math.sin(t * 3.1 + s.phaseZ);
        }
      } else {
        x = s.ampX * Math.sin(t * s.freq + s.phase);
        y = s.ampY * Math.sin(t * s.freq * 1.31 + s.phaseY);
        z = s.ampZ * Math.sin(t * s.freq * 0.87 + s.phaseZ);
        x += jitter * 0.22 * Math.sin(t * 3.2 + s.phase * 7.0);
        y += jitter * 0.22 * Math.cos(t * 2.7 + s.phaseY);
        z += jitter * 0.22 * Math.sin(t * 3.9 + s.phaseZ);
        const clamp = h * 0.92;
        x = Math.max(-clamp, Math.min(clamp, x));
        y = Math.max(-clamp, Math.min(clamp, y));
        z = Math.max(-clamp, Math.min(clamp, z));
      }

      this.xyz[i * 3] = x;
      this.xyz[i * 3 + 1] = y;
      this.xyz[i * 3 + 2] = z;

      const w = 0.5 + 0.5 * Math.sin(s.phase + t * 0.4 + bass * 1.2);
      const mix = w * bass + (1 - w) * mid;
      this.radii[i] = Math.min(
        this.halfExtent * 0.4,
        0.08 + 0.22 * (0.35 + contrast * mix),
      );
    }
  }

  private tessellate(): void {
    const radius =
      (this.userParams.sphereRadius ?? 1.8) *
      (1 +
        this.smoothers.rms.value * 0.18 * (this.userParams.rmsToRadius ?? 0));
    this.backend?.compute(
      this.xyz,
      this.config.mode === 'radical' ? this.radii : undefined,
      radius,
    );
  }

  private applyMesh(hueShift: number, explode: number, edgeGlow: number): void {
    const mesh = this.baseMesh;
    if (!mesh || !this.faceMesh || !this.edgeLines) return;

    for (const material of [this.faceMaterial, this.edgeMaterial]) {
      if (material) {
        material.uniforms.u_explode.value = explode;
        material.uniforms.u_hueShift.value = hueShift;
      }
    }
    if (mesh === this.uploadedMesh) return;
    const previous = this.uploadedMesh;
    // Interpolate only unchanged connectivity and small, corresponding vertex motion.
    // Topology changes commit atomically, avoiding interpolated inverted cells.
    const compatible =
      previous &&
      previous.vertices.length === mesh.vertices.length &&
      previous.edges.length === mesh.edges.length &&
      previous.indices.length === mesh.indices.length &&
      previous.indices.every((value, i) => value === mesh.indices[i]) &&
      previous.cellIds.every((value, i) => value === mesh.cellIds[i]) &&
      previous.edgeCellIds.length === mesh.edgeCellIds.length &&
      previous.edgeCellIds.every((value, i) => value === mesh.edgeCellIds[i]) &&
      previous.edges.every(
        (value, i) => Math.abs(value - mesh.edges[i]) < 0.08,
      ) &&
      previous.seedIds.length === mesh.seedIds.length &&
      previous.seedIds.every((value, i) => value === mesh.seedIds[i]) &&
      previous.vertices.every(
        (value, i) => Math.abs(value - mesh.vertices[i]) < 0.08,
      );
    this.replaceAttribute(
      this.faceMesh.geometry,
      'a_previous',
      compatible ? previous.vertices : mesh.vertices,
      3,
    );
    this.replaceAttribute(
      this.edgeLines.geometry,
      'a_previous',
      compatible ? previous.edges : mesh.edges,
      3,
    );
    this.meshAge = compatible ? 0 : 1;
    this.uploadedMesh = mesh;
    const nVerts = mesh.vertices.length / 3;
    const pos = mesh.vertices;
    const colors = new Float32Array(pos.length);
    const centers = new Float32Array(pos.length);
    for (let i = 0; i < nVerts; i++) {
      const cid = mesh.cellIds[i];
      const id = mesh.seedIds[cid] ?? cid;
      const h = (hash01(id + 1) + this.look.hueOffset) % 1;
      const [r, g, b] = hsv2rgb(
        h,
        Math.min(1, this.look.faceSat + 0.25 * hash01(id + 17)),
        this.look.faceVal,
      );
      colors.set([r, g, b], i * 3);
      centers.set(mesh.centroids.subarray(cid * 3, cid * 3 + 3), i * 3);
    }
    this.replaceAttribute(this.faceMesh.geometry, 'a_center', centers, 3);
    this.replaceAttribute(this.faceMesh.geometry, 'position', pos, 3);
    this.replaceAttribute(this.faceMesh.geometry, 'normal', mesh.normals, 3);
    this.replaceAttribute(this.faceMesh.geometry, 'color', colors, 3);
    const idx = this.faceMesh.geometry.getIndex();
    if (idx && idx.array.length >= mesh.indices.length) {
      (idx.array as Uint32Array).set(mesh.indices);
      idx.needsUpdate = true;
    } else {
      const indices = new Uint32Array(
        Math.max(
          mesh.indices.length,
          Math.ceil((idx?.array.length ?? 0) * 1.5),
        ),
      );
      indices.set(mesh.indices);
      this.faceMesh.geometry.setIndex(
        new THREE.BufferAttribute(indices, 1).setUsage(THREE.DynamicDrawUsage),
      );
    }
    this.faceMesh.geometry.setDrawRange(0, mesh.indices.length);
    // Faces are not frustum-culled; no per-update bounding sphere is needed.

    const nEdgeVerts = mesh.edges.length / 3;
    const epos = mesh.edges;
    const edgeColors = new Float32Array(epos.length);
    const edgeCenters = new Float32Array(epos.length);
    for (let i = 0; i < nEdgeVerts; i++) {
      edgeColors.set(this.look.edgeTint, i * 3);
      const cid = mesh.edgeCellIds[i];
      edgeCenters.set(mesh.centroids.subarray(cid * 3, cid * 3 + 3), i * 3);
    }
    this.replaceAttribute(this.edgeLines.geometry, 'a_center', edgeCenters, 3);
    this.replaceAttribute(this.edgeLines.geometry, 'position', epos, 3);
    this.replaceAttribute(this.edgeLines.geometry, 'color', edgeColors, 3);
    this.edgeLines.geometry.setDrawRange(0, nEdgeVerts);
    // Edges are not frustum-culled either.
  }

  private replaceAttribute(
    geom: THREE.BufferGeometry,
    name: string,
    data: Float32Array,
    itemSize: number,
  ): void {
    const attr = geom.getAttribute(name) as THREE.BufferAttribute | undefined;
    if (attr && attr.array.length >= data.length) {
      (attr.array as Float32Array).set(data);
      attr.needsUpdate = true;
    } else {
      geom.deleteAttribute(name);
      const capacity =
        Math.ceil(
          Math.max(data.length, (attr?.array.length ?? 0) * 1.5) / itemSize,
        ) * itemSize;
      const buffer = new Float32Array(capacity);
      buffer.set(data);
      geom.setAttribute(
        name,
        new THREE.BufferAttribute(buffer, itemSize).setUsage(
          THREE.DynamicDrawUsage,
        ),
      );
    }
  }

  tick(deltaSeconds = 1 / 60): void {
    this.deltaSeconds = frameDelta(deltaSeconds);
    if (this.disposed) return;
    this.time += this.deltaSeconds;
    this.meshAge += this.deltaSeconds;

    if (this.latestFeatures) {
      const f = takeAudioFrame(this.latestFeatures);
      this.smoothers.bass.update(f.bass, this.deltaSeconds);
      this.smoothers.mid.update(f.mid, this.deltaSeconds);
      this.smoothers.high.update(f.high, this.deltaSeconds);
      this.smoothers.rms.update(f.rms, this.deltaSeconds);
      this.smoothers.spectralCentroid.update(
        f.spectralCentroid,
        this.deltaSeconds,
      );
      this.smoothers.beatPulse.update(
        f.beatOnset ? 1.0 : 0.0,
        this.deltaSeconds,
      );
    } else {
      this.smoothers.beatPulse.update(0.0, this.deltaSeconds);
    }

    const bass = this.smoothers.bass.value;
    const mid = this.smoothers.mid.value;
    const rms = this.smoothers.rms.value;
    const centroid = this.smoothers.spectralCentroid.value;
    const beat = this.smoothers.beatPulse.value;

    const jitter = bass * (this.userParams.bassToJitter ?? 1);
    this.updateSeeds(jitter, this.userParams.driftSpeed ?? 0.25, bass, mid);

    if (this.seedPoints) {
      const posAttr = this.seedPoints.geometry.getAttribute(
        'position',
      ) as THREE.BufferAttribute;
      if (posAttr.array.length !== this.xyz.length) {
        this.seedPoints.geometry.setAttribute(
          'position',
          new THREE.BufferAttribute(this.xyz.slice(), 3),
        );
        this.seedPoints.geometry.setAttribute(
          'color',
          new THREE.BufferAttribute(new Float32Array(this.xyz.length), 3),
        );
      } else {
        (posAttr.array as Float32Array).set(this.xyz);
        posAttr.needsUpdate = true;
      }
      const colAttr = this.seedPoints.geometry.getAttribute(
        'color',
      ) as THREE.BufferAttribute;
      const hueShift =
        this.time * 0.03 +
        mid * 0.25 * (this.userParams.midToHue ?? 1) +
        centroid * 0.2 * (this.userParams.centroidToPalette ?? 1);
      const nSeeds = this.xyz.length / 3;
      for (let i = 0; i < nSeeds; i++) {
        let h = (hash01(i + 3) + hueShift + this.look.hueOffset) % 1;
        if (h < 0) h += 1;
        const [r, g, b] = hsv2rgb(h, 0.65, 0.95);
        colAttr.setXYZ(i, r, g, b);
      }
      colAttr.needsUpdate = true;
    }

    if (this.backend && this.time >= this.skipUntil) {
      this.tessellate();
      this.skipUntil = this.time + 1 / 20;
    }

    const hueShift =
      this.time * 0.03 +
      mid * 0.25 * (this.userParams.midToHue ?? 1) +
      centroid * 0.2 * (this.userParams.centroidToPalette ?? 1);
    const explode =
      (this.userParams.explodeAmount ?? 0.35) *
      (0.15 + beat * 1.4 * (this.userParams.beatToExplode ?? 1));
    const edgeGlow =
      (this.userParams.edgeGlow ?? 1) *
      (0.7 + rms * 0.8 * (this.userParams.rmsToGlow ?? 1));

    this.applyMesh(
      hueShift,
      this.userParams.boundaryMode === 1 ? 0 : explode,
      edgeGlow,
    );
    for (const image of this.periodicImages)
      image.visible = this.userParams.neighborImages === 1;
    const radius =
      (this.userParams.sphereRadius ?? 1.8) *
      (1 + rms * 0.18 * (this.userParams.rmsToRadius ?? 0));
    const curved =
      this.config.mode === 'sphere' && this.userParams.boundaryMode === 1;
    for (const material of [this.faceMaterial, this.edgeMaterial])
      if (material) {
        material.uniforms.u_clipRadius.value = curved ? radius : 0;
        material.uniforms.u_meshMix.value = Math.min(1, this.meshAge / 0.05);
      }
    if (this.boundary) {
      this.boundary.visible = curved;
      this.boundary.scale.setScalar(radius);
      const uniforms = (this.boundary.material as THREE.ShaderMaterial)
        .uniforms;
      uniforms.radius.value = radius;
      uniforms.count.value = this.seeds.length;
      uniforms.hue.value = hueShift;
      uniforms.opacity.value = this.userParams.faceOpacity;
      for (let i = 0; i < this.seeds.length; i++)
        uniforms.seeds.value[i].fromArray(
          this.baseMesh?.inputSeeds ?? this.xyz,
          i * 3,
        );
    }

    if (this.faceMaterial) {
      this.faceMaterial.uniforms.u_opacity.value =
        this.userParams.faceOpacity ?? 0.28;
      this.faceMaterial.uniforms.u_glow.value = 0.75 + rms * 0.5;
      this.faceMaterial.uniforms.u_beatPulse.value = beat;
    }
    if (this.edgeMaterial) {
      this.edgeMaterial.uniforms.u_glow.value = edgeGlow;
      this.edgeMaterial.uniforms.u_beatPulse.value = beat;
    }
  }

  setResolution(_w: number, _h: number): void {}

  setUserParam(key: string, value: number): void {
    if (!(key in this.userParams)) return;
    this.userParams[key] = value;
    if (key === 'seedCount') this.rebuildSeeds(value);
    if (key === 'boundaryMode') {
      this.backend?.dispose();
      this.baseMesh = null;
      this.uploadedMesh = null;
      void this.startBackend();
    }
  }

  getViewState(): Record<string, number> {
    return {
      orbitAngle: this._orbitAngle,
      elevation: this._elevation,
      distance: this._distance,
    };
  }

  setViewState(partial: Record<string, number>): void {
    if ('orbitAngle' in partial) this._orbitAngle = partial.orbitAngle;
    if ('elevation' in partial)
      this._elevation = Math.max(-1.2, Math.min(1.2, partial.elevation));
    if ('distance' in partial)
      this._distance = Math.max(4, Math.min(20, partial.distance));
  }

  dispose(): void {
    this.disposed = true;
    this.loadGen++;
    this.unsub();
    this.backend?.dispose();
    this.backend = null;
    for (const image of this.periodicImages) image.removeFromParent();
    this.periodicImages = [];
    this.domainBox?.removeFromParent();
    this.domainBox?.geometry.dispose();
    (this.domainBox?.material as THREE.Material | undefined)?.dispose();
    this.boundary?.removeFromParent();
    this.boundary?.geometry.dispose();
    (this.boundary?.material as THREE.Material | undefined)?.dispose();
    this.faceMaterial?.dispose();
    this.edgeMaterial?.dispose();
    this.pointMaterial?.dispose();
    this.faceMesh?.geometry.dispose();
    this.edgeLines?.geometry.dispose();
    this.seedPoints?.geometry.dispose();
    if (this.sceneRef) {
      if (this.faceMesh) this.sceneRef.remove(this.faceMesh);
      if (this.edgeLines) this.sceneRef.remove(this.edgeLines);
      if (this.seedPoints) this.sceneRef.remove(this.seedPoints);
    }
    this.faceMesh = null;
    this.edgeLines = null;
    this.seedPoints = null;
    this.sceneRef = null;
  }
}

const FACE_VERT = /* glsl */ `
  attribute vec3 a_center;
  attribute vec3 a_previous;
  uniform float u_meshMix;
  uniform float u_explode;
  uniform float u_hueShift;
  vec3 hueRotate(vec3 c, float hue) {
    vec3 axis = normalize(vec3(1.0)); float angle = hue * 6.28318530718;
    return max(vec3(0.0), c * cos(angle) + cross(axis, c) * sin(angle) + axis * dot(axis, c) * (1.0 - cos(angle)));
  }

  varying vec3 vColor;
  varying vec3 vPosition;
  varying vec3 vNormal;
  varying vec3 vViewDir;

  void main() {
    vPosition=mix(a_previous,position,u_meshMix);
    vColor = hueRotate(color, u_hueShift);
    vNormal = normalize(normalMatrix * normal);
    vec4 mv = modelViewMatrix * vec4(vPosition + a_center * u_explode, 1.0);
    vViewDir = normalize(-mv.xyz);
    gl_Position = projectionMatrix * mv;
  }
`;

const FACE_FRAG = /* glsl */ `
  uniform float u_clipRadius;
  uniform float u_opacity;
  uniform float u_glow;
  uniform float u_beatPulse;

  varying vec3 vColor;
  varying vec3 vPosition;
  varying vec3 vNormal;
  varying vec3 vViewDir;

  void main() {
    if(u_clipRadius>0.0 && length(vPosition)>u_clipRadius)discard;
    vec3 n = normalize(vNormal);
    float ndv = abs(dot(n, normalize(vViewDir)));
    float fresnel = pow(1.0 - ndv, 2.2);
    vec3 col = vColor * (0.18 + 0.55 * ndv) * u_glow;
    col += vColor * fresnel * 0.9;
    col += vec3(0.35, 0.42, 0.6) * u_beatPulse * fresnel;
    col = col / (0.85 + col);
    float alpha = u_opacity * (0.22 + fresnel * 0.75);
    gl_FragColor = vec4(col, alpha);
  }
`;

const EDGE_VERT = /* glsl */ `
  attribute vec3 a_center;
  attribute vec3 a_previous;
  uniform float u_meshMix;
  uniform float u_explode;
  uniform float u_hueShift;
  vec3 hueRotate(vec3 c, float hue) {
    vec3 axis = normalize(vec3(1.0)); float angle = hue * 6.28318530718;
    return max(vec3(0.0), c * cos(angle) + cross(axis, c) * sin(angle) + axis * dot(axis, c) * (1.0 - cos(angle)));
  }

  varying vec3 vColor;
  varying vec3 vPosition;
  varying float vDepth;

  void main() {
    vPosition=mix(a_previous,position,u_meshMix);
    vColor = hueRotate(color, u_hueShift);
    vec4 mv = modelViewMatrix * vec4(vPosition + a_center * u_explode, 1.0);
    vDepth = -mv.z;
    gl_Position = projectionMatrix * mv;
  }
`;

const EDGE_FRAG = /* glsl */ `
  uniform float u_clipRadius;
  uniform float u_glow;
  uniform float u_beatPulse;

  varying vec3 vColor;
  varying vec3 vPosition;
  varying float vDepth;

  void main() {
    if(u_clipRadius>0.0 && length(vPosition)>u_clipRadius)discard;
    float fade = exp(-vDepth * 0.04);
    vec3 col = vColor * u_glow * fade;
    col += vec3(0.45, 0.55, 0.85) * u_beatPulse * 0.35;
    col = col / (0.8 + col);
    gl_FragColor = vec4(col, 0.85 * fade);
  }
`;
