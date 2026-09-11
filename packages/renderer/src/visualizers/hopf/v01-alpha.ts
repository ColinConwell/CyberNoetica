import { SegmentBatch } from '../../geometry/segment-batch.js';
import { frameDelta, takeAudioFrame, PhaseClock } from '../../timing.js';
import * as THREE from 'three';
import { MessageBus } from '@cybernoetica/core';
import type {
  AudioFeatures,
  BusMessage,
  Unsubscribe,
} from '@cybernoetica/core';
import { EMASmoothing, EventEnvelope } from '../../smoothing.js';
import type { Visualizer, VisualizerMetadata } from '../types.js';
import { registerVisualizer } from '../registry.js';

const FIBER_COUNT = 48;
const POINTS_PER_FIBER = 128;
const TOTAL_VERTICES = FIBER_COUNT * POINTS_PER_FIBER;

const hopfMetadata: VisualizerMetadata = {
  type: 'hopf',
  label: 'Hopf Fibration',
  description: 'Topological fiber bundles from S³ to S²',
  usesPerspective: true,
  params: [
    {
      key: 'latitude',
      label: 'Latitude',
      min: -0.9,
      max: 0.9,
      step: 0.05,
      initial: 0.3,
      category: 'appearance',
      description: 'S² latitude of fibers',
    },
    {
      key: 'fiberSpread',
      label: 'Fiber Spread',
      min: 0.1,
      max: 1.0,
      step: 0.05,
      initial: 0.5,
      category: 'appearance',
      description: 'Distribution of fiber latitudes',
    },
    {
      key: 'twistSpeed',
      label: 'Twist Speed',
      min: 0.0,
      max: 2.0,
      step: 0.1,
      initial: 0.5,
      category: 'appearance',
      description: '4D rotation speed',
    },
    {
      key: 'lineWidth',
      label: 'Line Width',
      min: 1.0,
      max: 5.0,
      step: 0.5,
      initial: 2.0,
      category: 'appearance',
      description: 'Fiber line thickness',
    },
    {
      key: 'colorShift',
      label: 'Color Shift',
      min: 0.0,
      max: 1.0,
      step: 0.05,
      initial: 0.3,
      category: 'appearance',
      description: 'Hue cycling speed',
    },
    {
      key: 'bassToLatitude',
      label: 'Bass -> Latitude',
      min: 0.0,
      max: 2.0,
      step: 0.1,
      initial: 1.0,
      category: 'audio-mapping',
      description: 'Bass shifts fiber latitude band',
    },
    {
      key: 'midToTwist',
      label: 'Mid -> Twist',
      min: 0.0,
      max: 2.0,
      step: 0.1,
      initial: 1.0,
      category: 'audio-mapping',
      description: 'Mids drive 4D rotation',
    },
    {
      key: 'highToSpread',
      label: 'High -> Spread',
      min: 0.0,
      max: 2.0,
      step: 0.1,
      initial: 1.0,
      category: 'audio-mapping',
      description: 'Highs expand fiber distribution',
    },
    {
      key: 'rmsToGlow',
      label: 'RMS -> Glow',
      min: 0.0,
      max: 2.0,
      step: 0.1,
      initial: 1.0,
      category: 'audio-mapping',
      description: 'Volume drives brightness',
    },
    {
      key: 'beatToPulse',
      label: 'Beat -> Pulse',
      min: 0.0,
      max: 2.0,
      step: 0.1,
      initial: 1.0,
      category: 'audio-mapping',
      description: 'Beats flash fibers',
    },
  ],
  viewport: { pan: false, zoom: false, orbit: true },
  viewStateFields: [
    {
      key: 'orbitAngle',
      label: 'Orbit',
      min: -Math.PI,
      max: Math.PI,
      step: 0.02,
    },
    { key: 'elevation', label: 'Elevation', min: -1.2, max: 1.2, step: 0.02 },
    { key: 'distance', label: 'Distance', min: 3, max: 15, step: 0.1 },
  ],
};

export class HopfVisualizer implements Visualizer {
  private deltaSeconds = 1 / 60;
  private phases = new PhaseClock();
  readonly metadata = hopfMetadata;

  private unsub: Unsubscribe;
  private latestFeatures: AudioFeatures | null = null;
  private time = 0;
  private twistPhase = 0;

  private userParams: Record<string, number> = {
    latitude: 0.3,
    fiberSpread: 0.5,
    twistSpeed: 0.5,
    lineWidth: 2.0,
    colorShift: 0.3,
    bassToLatitude: 1.0,
    midToTwist: 1.0,
    highToSpread: 1.0,
    rmsToGlow: 1.0,
    beatToPulse: 1.0,
  };

  private _orbitAngle = 0;
  private _elevation = 0.4;
  private _distance = 7;

  private smoothers = {
    bass: new EMASmoothing(0.12),
    mid: new EMASmoothing(0.18),
    high: new EMASmoothing(0.25),
    rms: new EMASmoothing(0.15),
    beatPulse: new EventEnvelope(),
    spectralCentroid: new EMASmoothing(0.08),
  };

  private batch: SegmentBatch | null = null;
  private uniforms = {
    u_latitude: { value: 0.3 },
    u_spread: { value: 0.5 },
    u_twist: { value: 0 },
    u_hue: { value: 0 },
    u_glow: { value: 1 },
    u_beatPulse: { value: 0 },
  };
  constructor(private bus: MessageBus) {
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
    this.smoothers.beatPulse.reset(0);
    this.smoothers.spectralCentroid.reset(0.5);
  }

  attach(scene: THREE.Scene): void {
    this.batch = new SegmentBatch(FIBER_COUNT * POINTS_PER_FIBER);
    const batch = this.batch;
    for (let fiber = 0; fiber < FIBER_COUNT; fiber++)
      for (let point = 0; point < POINTS_PER_FIBER; point++) {
        const offset = (fiber * POINTS_PER_FIBER + point) * 6;
        batch.positions.set(
          [
            fiber / FIBER_COUNT,
            (point / POINTS_PER_FIBER) * 2 * Math.PI,
            0,
            fiber / FIBER_COUNT,
            ((point + 1) / POINTS_PER_FIBER) * 2 * Math.PI,
            0,
          ],
          offset,
        );
      }
    batch.upload(FIBER_COUNT * POINTS_PER_FIBER);
    Object.assign(batch.material.uniforms, this.uniforms);
    batch.material.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, this.uniforms);
      shader.vertexShader = HOPF_VERTEX + shader.vertexShader;
      shader.vertexShader = shader.vertexShader.replace(
        'vec4 start = modelViewMatrix * vec4( instanceStart, 1.0 );',
        `vec4 hs = hopf(instanceStart.xy); vec4 he = hopf(instanceEnd.xy);
         if (min(hs.w, he.w) < .025 || max(length(hs.xyz / max(hs.w,.025)),length(he.xyz / max(he.w,.025))) > 40.0) { gl_Position=vec4(2,2,2,1); return; }
         vec4 start = modelViewMatrix * vec4(2.0 * hs.xyz / hs.w, 1.0);`,
      );
      shader.vertexShader = shader.vertexShader.replace(
        'vec4 end = modelViewMatrix * vec4( instanceEnd, 1.0 );',
        'vec4 end = modelViewMatrix * vec4(2.0 * he.xyz / he.w, 1.0);',
      );
      shader.vertexShader = shader.vertexShader.replace(
        'vColor.xyz = ( position.y < 0.5 ) ? instanceColorStart : instanceColorEnd;',
        'vColor.xyz = (.5+.5*cos(6.2831853*(instanceStart.x+u_hue+vec3(0,.333333,.666667))))*(u_glow+u_beatPulse*.15);',
      );
    };
    batch.material.customProgramCacheKey = () => 'hopf-ribbons-v1';
    scene.add(batch.object);
  }

  tick(deltaSeconds = 1 / 60): void {
    this.deltaSeconds = frameDelta(deltaSeconds);
    this.time += this.deltaSeconds;

    if (this.latestFeatures) {
      const f = takeAudioFrame(this.latestFeatures);
      this.smoothers.bass.update(f.bass, this.deltaSeconds);
      this.smoothers.mid.update(f.mid, this.deltaSeconds);
      this.smoothers.high.update(f.high, this.deltaSeconds);
      this.smoothers.rms.update(f.rms, this.deltaSeconds);
      this.smoothers.beatPulse.update(
        f.beatOnset ? 1.0 : 0.0,
        this.deltaSeconds,
      );
      this.smoothers.spectralCentroid.update(
        f.spectralCentroid,
        this.deltaSeconds,
      );
    } else {
      this.smoothers.beatPulse.update(0.0, this.deltaSeconds);
    }

    const baseLat =
      this.userParams.latitude +
      (this.smoothers.bass.value - 0.3) * 0.4 * this.userParams.bassToLatitude;
    const spread =
      this.userParams.fiberSpread +
      this.smoothers.high.value * 0.3 * this.userParams.highToSpread;
    this.twistPhase +=
      this.userParams.twistSpeed *
      (0.5 + this.smoothers.mid.value * this.userParams.midToTwist) *
      this.deltaSeconds;
    const glowMult =
      0.6 + this.smoothers.rms.value * 0.8 * this.userParams.rmsToGlow;
    const beatFlash =
      this.smoothers.beatPulse.value * this.userParams.beatToPulse;

    this.uniforms.u_latitude.value = baseLat;
    this.uniforms.u_spread.value = spread;
    this.uniforms.u_twist.value = this.twistPhase;
    this.uniforms.u_glow.value = glowMult;
    this.uniforms.u_beatPulse.value = beatFlash;
    this.uniforms.u_hue.value =
      this.phases.advance(
        'color',
        this.userParams.colorShift,
        this.deltaSeconds,
      ) +
      this.smoothers.spectralCentroid.value * 0.3;
    if (this.batch) this.batch.material.linewidth = this.userParams.lineWidth;
  }

  setResolution(w: number, h: number): void {
    this.batch?.setResolution(w, h);
  }

  setUserParam(key: string, value: number): void {
    if (key in this.userParams) this.userParams[key] = value;
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
      this._distance = Math.max(3, Math.min(15, partial.distance));
  }

  dispose(): void {
    this.unsub();
    this.batch?.dispose();
    this.batch = null;
  }
}

registerVisualizer({
  metadata: hopfMetadata,
  create: (bus) => new HopfVisualizer(bus),
});

const HOPF_VERTEX = `
  uniform float u_latitude, u_spread, u_twist, u_hue, u_glow, u_beatPulse;
  vec4 hopf(vec2 parameter) {
    float theta=acos(clamp(u_latitude+(parameter.x-.5)*2.0*u_spread,-.999,.999));
    float phi=parameter.x*6.28318530718;
    vec2 z1=cos(theta*.5)*vec2(cos(parameter.y),sin(parameter.y));
    vec2 z2=sin(theta*.5)*vec2(cos(parameter.y+phi),sin(parameter.y+phi));
    vec2 a=z1*cos(u_twist)-z2*sin(u_twist);
    vec2 b=z1*sin(u_twist)+z2*cos(u_twist);
    return vec4(a,b.x,1.0-b.y);
  }
`;
