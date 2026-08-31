import * as THREE from 'three';
import { MessageBus } from '@cybernoetica/core';
import type { AudioFeatures, BusMessage, Unsubscribe } from '@cybernoetica/core';
import { EMASmoothing } from '../../smoothing.js';
import type { ViewStateField, Visualizer, VisualizerMetadata } from '../types.js';
import type { VoroBackend, VoroMesh, VoroMode } from '../../voro/backend.js';

export type SeedLayout = 'lissajous' | 'lattice' | 'shell' | 'scatter';

export const FOAM_VIEW_FIELDS: ViewStateField[] = [
  { key: 'orbitAngle', label: 'Orbit', min: -Math.PI, max: Math.PI, step: 0.02 },
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

const COMPUTE_BUDGET_MS = 10;
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
    case 0: return [v, t, p];
    case 1: return [q, v, p];
    case 2: return [p, v, t];
    case 3: return [p, q, v];
    case 4: return [t, p, v];
    default: return [v, p, q];
  }
}

function hash01(n: number): number {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
}

function wrapCoord(v: number, h: number): number {
  const w = h * 2;
  return ((v + h) % w + w) % w - h;
}

export class VoronoiFoamVisualizer implements Visualizer {
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
    beatPulse: new EMASmoothing(0.4),
  };

  private seeds: Seed[] = [];
  private xyz = new Float32Array(0);
  private radii = new Float32Array(0);

  private backend: VoroBackend | null = null;
  private loadGen = 0;
  private skipUntil = 0;
  private lastSphereR = -1;
  private baseMesh: VoroMesh | null = null;

  private faceMesh: THREE.Mesh | null = null;
  private edgeLines: THREE.LineSegments | null = null;
  private seedPoints: THREE.Points | null = null;
  private faceMaterial: THREE.ShaderMaterial | null = null;
  private edgeMaterial: THREE.ShaderMaterial | null = null;
  private pointMaterial: THREE.PointsMaterial | null = null;
  private faceScratch = new Float32Array(0);
  private faceColorScratch = new Float32Array(0);
  private edgeScratch = new Float32Array(0);
  private edgeColorScratch = new Float32Array(0);

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

    this.unsub = bus.subscribe('audio:features', (msg: BusMessage<AudioFeatures>) => {
      this.latestFeatures = msg.payload;
    });
    this.smoothers.bass.reset(0);
    this.smoothers.mid.reset(0);
    this.smoothers.high.reset(0);
    this.smoothers.rms.reset(0.1);
    this.smoothers.spectralCentroid.reset(0.5);
    this.smoothers.beatPulse.reset(0);
    this.rebuildSeeds(this.userParams.seedCount ?? 64);
  }

  attach(scene: THREE.Scene): void {
    this.faceMaterial = new THREE.ShaderMaterial({
      vertexShader: FACE_VERT,
      fragmentShader: FACE_FRAG,
      uniforms: {
        u_opacity: { value: this.userParams.faceOpacity ?? 0.28 },
        u_glow: { value: 1.0 },
        u_beatPulse: { value: 0.0 },
      },
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      vertexColors: true,
    });

    this.edgeMaterial = new THREE.ShaderMaterial({
      vertexShader: EDGE_VERT,
      fragmentShader: EDGE_FRAG,
      uniforms: {
        u_glow: { value: 1.0 },
        u_beatPulse: { value: 0.0 },
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
    emptyFace.setAttribute('position', new THREE.BufferAttribute(new Float32Array(9), 3));
    emptyFace.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(9), 3));
    emptyFace.setAttribute('color', new THREE.BufferAttribute(new Float32Array(9), 3));
    this.faceMesh = new THREE.Mesh(emptyFace, this.faceMaterial);
    this.faceMesh.frustumCulled = false;
    scene.add(this.faceMesh);

    const emptyEdge = new THREE.BufferGeometry();
    emptyEdge.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
    emptyEdge.setAttribute('color', new THREE.BufferAttribute(new Float32Array(6), 3));
    this.edgeLines = new THREE.LineSegments(emptyEdge, this.edgeMaterial);
    this.edgeLines.frustumCulled = false;
    scene.add(this.edgeLines);

    const seedGeom = new THREE.BufferGeometry();
    seedGeom.setAttribute('position', new THREE.BufferAttribute(this.xyz.slice(), 3));
    seedGeom.setAttribute('color', new THREE.BufferAttribute(new Float32Array(this.xyz.length), 3));
    this.seedPoints = new THREE.Points(seedGeom, this.pointMaterial);
    this.seedPoints.frustumCulled = false;
    scene.add(this.seedPoints);

    void this.startBackend();
  }

  private async startBackend(): Promise<void> {
    const gen = ++this.loadGen;
    const { loadVoroBackend } = await import('../../voro/backend.js');
    if (this.disposed || gen !== this.loadGen) return;
    this.backend = await loadVoroBackend({
      halfExtent: this.halfExtent,
      grid: 3,
      mode: this.config.mode,
      sphereRadius: this.userParams.sphereRadius,
    });
    this.lastSphereR = this.userParams.sphereRadius ?? -1;
  }

  private rebuildSeeds(count: number): void {
    const requested = Math.max(16, Math.min(128, Math.round(count)));
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
              ampX: 0, ampY: 0, ampZ: 0,
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
          ampX: 0, ampY: 0, ampZ: 0,
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
          ampX: 0.35, ampY: 0.32, ampZ: 0.3,
          phaseY: t * 3.7,
          phaseZ: t * 5.1,
          baseX: 0, baseY: 0, baseZ: 0,
        });
      }
    } else if (this.config.seedLayout === 'scatter') {
      for (let i = 0; i < requested; i++) {
        this.seeds.push({
          phase: hash01(i + 1) * Math.PI * 2,
          freq: 0.1 + (i % 6) * 0.02,
          ampX: 0, ampY: 0, ampZ: 0,
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
          baseX: 0, baseY: 0, baseZ: 0,
        });
      }
    }

    this.xyz = new Float32Array(this.seeds.length * 3);
    this.radii = new Float32Array(this.seeds.length);
    this.baseMesh = null;
  }

  private updateSeeds(jitter: number, drift: number, bass: number, mid: number): void {
    const t = this.time * (0.35 + drift * 1.4);
    const h = this.halfExtent;
    const layout = this.config.seedLayout;
    const sphereR = this.userParams.sphereRadius ?? (h * 0.9);
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
      this.radii[i] = 0.08 + 0.22 * (0.35 + contrast * mix);
    }
  }

  private tessellate(): void {
    if (!this.backend) return;
    if (this.config.mode === 'sphere') {
      const rmsMul = this.userParams.rmsToRadius ?? 0;
      const r = (this.userParams.sphereRadius ?? 1.8)
        * (1 + this.smoothers.rms.value * 0.18 * rmsMul);
      if (Math.abs(r - this.lastSphereR) > 0.02) {
        this.backend.setSphereRadius(r);
        this.lastSphereR = r;
      }
    }
    const mesh = this.config.mode === 'radical'
      ? this.backend.compute(this.xyz, this.radii)
      : this.backend.compute(this.xyz);
    if (!mesh || mesh.cellCount === 0 || mesh.vertices.length === 0) return;
    this.baseMesh = mesh;
  }

  private applyMesh(hueShift: number, explode: number, edgeGlow: number): void {
    const mesh = this.baseMesh;
    if (!mesh || !this.faceMesh || !this.edgeLines) return;

    const nVerts = mesh.vertices.length / 3;
    if (this.faceScratch.length !== mesh.vertices.length) {
      this.faceScratch = new Float32Array(mesh.vertices.length);
    }
    const pos = this.faceScratch;
    pos.set(mesh.vertices);
    if (explode > 1e-4) {
      for (let i = 0; i < nVerts; i++) {
        const cid = mesh.cellIds[i];
        const o = i * 3;
        pos[o] += (pos[o] - mesh.centroids[cid * 3]) * explode;
        pos[o + 1] += (pos[o + 1] - mesh.centroids[cid * 3 + 1]) * explode;
        pos[o + 2] += (pos[o + 2] - mesh.centroids[cid * 3 + 2]) * explode;
      }
    }

    if (this.faceColorScratch.length !== mesh.vertices.length) {
      this.faceColorScratch = new Float32Array(mesh.vertices.length);
    }
    const colors = this.faceColorScratch;
    for (let i = 0; i < nVerts; i++) {
      const cid = mesh.cellIds[i];
      let h = (hash01(cid + 1) + hueShift + this.look.hueOffset) % 1;
      if (h < 0) h += 1;
      const sat = this.look.faceSat + 0.25 * hash01(cid + 17);
      const [r, g, b] = hsv2rgb(h, Math.min(1, sat), this.look.faceVal);
      colors[i * 3] = r;
      colors[i * 3 + 1] = g;
      colors[i * 3 + 2] = b;
    }

    this.replaceAttribute(this.faceMesh.geometry, 'position', pos, 3);
    this.replaceAttribute(this.faceMesh.geometry, 'normal', mesh.normals, 3);
    this.replaceAttribute(this.faceMesh.geometry, 'color', colors, 3);
    const idx = this.faceMesh.geometry.getIndex();
    if (idx && idx.array.length === mesh.indices.length) {
      (idx.array as Uint32Array).set(mesh.indices);
      idx.needsUpdate = true;
    } else {
      this.faceMesh.geometry.setIndex(new THREE.BufferAttribute(mesh.indices.slice(), 1));
    }
    this.faceMesh.geometry.computeBoundingSphere();

    const nEdgeVerts = mesh.edges.length / 3;
    if (this.edgeScratch.length !== mesh.edges.length) {
      this.edgeScratch = new Float32Array(mesh.edges.length);
    }
    const epos = this.edgeScratch;
    epos.set(mesh.edges);
    if (explode > 1e-4) {
      for (let i = 0; i < nEdgeVerts; i++) {
        const cid = mesh.edgeCellIds[i];
        const o = i * 3;
        epos[o] += (epos[o] - mesh.centroids[cid * 3]) * explode;
        epos[o + 1] += (epos[o + 1] - mesh.centroids[cid * 3 + 1]) * explode;
        epos[o + 2] += (epos[o + 2] - mesh.centroids[cid * 3 + 2]) * explode;
      }
    }

    if (this.edgeColorScratch.length !== mesh.edges.length) {
      this.edgeColorScratch = new Float32Array(mesh.edges.length);
    }
    const edgeColors = this.edgeColorScratch;
    const glow = 0.55 + 0.45 * edgeGlow;
    const [er, eg, eb] = this.look.edgeTint;
    for (let i = 0; i < nEdgeVerts; i++) {
      edgeColors[i * 3] = er * glow;
      edgeColors[i * 3 + 1] = eg * glow;
      edgeColors[i * 3 + 2] = eb * glow;
    }
    this.replaceAttribute(this.edgeLines.geometry, 'position', epos, 3);
    this.replaceAttribute(this.edgeLines.geometry, 'color', edgeColors, 3);
    this.edgeLines.geometry.computeBoundingSphere();
  }

  private replaceAttribute(
    geom: THREE.BufferGeometry,
    name: string,
    data: Float32Array,
    itemSize: number,
  ): void {
    const attr = geom.getAttribute(name) as THREE.BufferAttribute | undefined;
    if (attr && attr.array.length === data.length) {
      (attr.array as Float32Array).set(data);
      attr.needsUpdate = true;
    } else {
      geom.setAttribute(name, new THREE.BufferAttribute(data.slice(), itemSize));
    }
  }

  tick(): void {
    this.time += 1 / 60;

    if (this.latestFeatures) {
      const f = this.latestFeatures;
      this.smoothers.bass.update(f.bass);
      this.smoothers.mid.update(f.mid);
      this.smoothers.high.update(f.high);
      this.smoothers.rms.update(f.rms);
      this.smoothers.spectralCentroid.update(f.spectralCentroid);
      this.smoothers.beatPulse.update(f.beatOnset ? 1.0 : 0.0);
    } else {
      this.smoothers.beatPulse.update(0.0);
    }

    const bass = this.smoothers.bass.value;
    const mid = this.smoothers.mid.value;
    const rms = this.smoothers.rms.value;
    const centroid = this.smoothers.spectralCentroid.value;
    const beat = this.smoothers.beatPulse.value;

    const jitter = bass * (this.userParams.bassToJitter ?? 1);
    this.updateSeeds(jitter, this.userParams.driftSpeed ?? 0.25, bass, mid);

    if (this.seedPoints) {
      const posAttr = this.seedPoints.geometry.getAttribute('position') as THREE.BufferAttribute;
      if (posAttr.array.length !== this.xyz.length) {
        this.seedPoints.geometry.setAttribute('position', new THREE.BufferAttribute(this.xyz.slice(), 3));
        this.seedPoints.geometry.setAttribute('color', new THREE.BufferAttribute(new Float32Array(this.xyz.length), 3));
      } else {
        (posAttr.array as Float32Array).set(this.xyz);
        posAttr.needsUpdate = true;
      }
      const colAttr = this.seedPoints.geometry.getAttribute('color') as THREE.BufferAttribute;
      const hueShift = this.time * 0.03
        + mid * 0.25 * (this.userParams.midToHue ?? 1)
        + centroid * 0.2 * (this.userParams.centroidToPalette ?? 1);
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
      const t0 = typeof performance !== 'undefined' ? performance.now() : 0;
      this.tessellate();
      const dt = typeof performance !== 'undefined' ? performance.now() - t0 : 0;
      if (dt > COMPUTE_BUDGET_MS) this.skipUntil = this.time + 1 / 30;
    }

    const hueShift = this.time * 0.03
      + mid * 0.25 * (this.userParams.midToHue ?? 1)
      + centroid * 0.2 * (this.userParams.centroidToPalette ?? 1);
    const explode = (this.userParams.explodeAmount ?? 0.35)
      * (0.15 + beat * 1.4 * (this.userParams.beatToExplode ?? 1));
    const edgeGlow = (this.userParams.edgeGlow ?? 1) * (0.7 + rms * 0.8 * (this.userParams.rmsToGlow ?? 1));

    this.applyMesh(hueShift, explode, edgeGlow);

    if (this.faceMaterial) {
      this.faceMaterial.uniforms.u_opacity.value = this.userParams.faceOpacity ?? 0.28;
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
    if ('elevation' in partial) this._elevation = Math.max(-1.2, Math.min(1.2, partial.elevation));
    if ('distance' in partial) this._distance = Math.max(4, Math.min(20, partial.distance));
  }

  dispose(): void {
    this.disposed = true;
    this.loadGen++;
    this.unsub();
    this.backend?.dispose();
    this.backend = null;
    this.faceMaterial?.dispose();
    this.edgeMaterial?.dispose();
    this.pointMaterial?.dispose();
    this.faceMesh?.geometry.dispose();
    this.edgeLines?.geometry.dispose();
    this.seedPoints?.geometry.dispose();
    this.faceMesh = null;
    this.edgeLines = null;
    this.seedPoints = null;
  }
}

const FACE_VERT = /* glsl */ `
  varying vec3 vColor;
  varying vec3 vNormal;
  varying vec3 vViewDir;

  void main() {
    vColor = color;
    vNormal = normalize(normalMatrix * normal);
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vViewDir = normalize(-mv.xyz);
    gl_Position = projectionMatrix * mv;
  }
`;

const FACE_FRAG = /* glsl */ `
  uniform float u_opacity;
  uniform float u_glow;
  uniform float u_beatPulse;

  varying vec3 vColor;
  varying vec3 vNormal;
  varying vec3 vViewDir;

  void main() {
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
  varying vec3 vColor;
  varying float vDepth;

  void main() {
    vColor = color;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vDepth = -mv.z;
    gl_Position = projectionMatrix * mv;
  }
`;

const EDGE_FRAG = /* glsl */ `
  uniform float u_glow;
  uniform float u_beatPulse;

  varying vec3 vColor;
  varying float vDepth;

  void main() {
    float fade = exp(-vDepth * 0.04);
    vec3 col = vColor * u_glow * fade;
    col += vec3(0.45, 0.55, 0.85) * u_beatPulse * 0.35;
    col = col / (0.8 + col);
    gl_FragColor = vec4(col, 0.85 * fade);
  }
`;
