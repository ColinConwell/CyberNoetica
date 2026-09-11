import { describe, it, expect, vi } from 'vitest';
import * as THREE from 'three';
import { MessageBus } from '@cybernoetica/core';
import type { AudioFeatures } from '@cybernoetica/core';
import { OpenAstraVisualizer } from '../visualizers/openastra/v01-alpha.js';

function setup() {
  const bus = new MessageBus();
  const scene = new THREE.Scene();
  const viz = new OpenAstraVisualizer(bus);
  viz.attach(scene);
  const group = scene.children[0];
  const stars = group.children[0] as THREE.Points<THREE.BufferGeometry, THREE.ShaderMaterial>;
  return { bus, scene, viz, group, stars, uniforms: stars.material.uniforms };
}
const signal = { bass: 0.8, mid: 0.6, high: 0.7, rms: 0.5, beatOnset: true } as AudioFeatures;

describe('OpenAstra', () => {
  it('keeps reproducible star buffers immutable during animation', () => {
    const a = setup(), b = setup();
    const position = a.stars.geometry.getAttribute('position');
    const snapshot = position.array.slice();
    expect(b.stars.geometry.getAttribute('position').array).toEqual(snapshot);
    a.bus.publish('audio:features', signal);
    for (let i = 0; i < 120; i++) a.viz.tick(1 / 60);
    expect(position.array).toEqual(snapshot);
    expect(a.stars.frustumCulled).toBe(false);
    a.viz.dispose(); b.viz.dispose();
  });

  it('integrates rotation consistently and preserves phase when speed changes', () => {
    const phase = (fps: number) => {
      const { viz, uniforms } = setup();
      viz.setUserParam('rotationSpeed', 0.05);
      for (let i = 0; i < fps * 4; i++) viz.tick(1 / fps);
      const before = uniforms.u_phase.value;
      viz.setUserParam('rotationSpeed', 0.15);
      viz.tick(0);
      expect(uniforms.u_phase.value).toBe(before);
      viz.dispose();
      return before;
    };
    expect(phase(30)).toBeCloseTo(phase(120), 10);
  });

  it('consumes an onset once without changing the bus payload; mappings can be disabled', () => {
    const { viz, bus, uniforms } = setup();
    bus.publish('audio:features', signal);
    viz.tick();
    const peak = uniforms.u_pulse.value;
    viz.tick(0.1);
    expect(uniforms.u_pulse.value).toBeLessThan(peak);
    expect(signal.beatOnset).toBe(true);
    expect(uniforms.u_bass.value).toBeGreaterThan(0);
    expect(uniforms.u_glow.value).toBeGreaterThan(1);
    for (const param of viz.metadata.params.filter(p => p.category === 'audio-mapping'))
      viz.setUserParam(param.key, 0);
    viz.tick();
    expect(uniforms.u_bass.value).toBe(0);
    expect(uniforms.u_glow.value).toBe(1);
    expect(uniforms.u_pulse.value).toBe(0);
    expect(uniforms.u_shimmer.value).toBe(0);
    viz.dispose();
  });

  it('retains manual views and rejects nonfinite inputs', () => {
    const { viz, uniforms } = setup();
    viz.setViewState({ orbitAngle: 0.8, elevation: 0.4, distance: 8 });
    viz.setViewState({ elevation: NaN });
    viz.setUserParam('glow', Infinity);
    viz.setResolution(NaN, 0);
    viz.tick();
    expect(viz.getViewState()).toEqual({ orbitAngle: 0.8, elevation: 0.4, distance: 8 });
    expect(uniforms.u_glow.value).toBe(1);
    expect(uniforms.u_pixels.value).toBe(720);
    expect(viz.metadata.autoOrbit).toBe(false);
    viz.dispose();
  });

  it('forms from a dispersed cloud and advances infall independently of source rotation', () => {
    const run = (fps: number) => {
      const { viz, uniforms } = setup();
      expect(uniforms.u_formation.value).toBe(0);
      for (let i = 0; i < fps * 6; i++) viz.tick(1 / fps);
      expect(uniforms.u_formation.value).toBeCloseTo(1, 10);
      expect(uniforms.u_phase.value).toBe(0);
      const flow = uniforms.u_flow.value;
      expect(flow).toBeGreaterThan(0);
      viz.setUserParam('infallSpeed', 0);
      viz.tick(0.1);
      expect(uniforms.u_flow.value).toBe(flow);
      viz.dispose();
      return flow;
    };
    expect(run(30)).toBeCloseTo(run(120), 10);
  });

  it('accelerates particle transit with mids without rotating the source', () => {
    const silent = setup(), loud = setup();
    loud.bus.publish('audio:features', signal);
    for (let i = 0; i < 120; i++) { silent.viz.tick(); loud.viz.tick(); }
    expect(loud.uniforms.u_flow.value).toBeGreaterThan(silent.uniforms.u_flow.value);
    expect(loud.uniforms.u_phase.value).toBe(0);
    silent.viz.dispose(); loud.viz.dispose();
  });

  it('projects pointer wakes for different camera views, caps impulses and detaches listeners', () => {
    const { viz, uniforms } = setup();
    const canvas = document.createElement('canvas');
    vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue({ left: 0, top: 0, width: 800, height: 600 } as DOMRect);
    const camera = new THREE.PerspectiveCamera(60, 800 / 600, 0.1, 100);
    camera.position.set(4, 7, 8); camera.lookAt(0, 0, 0); camera.updateMatrixWorld();
    const move = (x: number, y: number) => canvas.dispatchEvent(new MouseEvent('pointermove', { clientX: x, clientY: y }));
    viz.setInteractionContext({ canvas, getPerspectiveCamera: () => camera });
    move(400, 300); viz.tick(0.05);
    const wakes = uniforms.u_wakes.value as THREE.Vector4[];
    expect(new THREE.Vector3(wakes[0].x, wakes[0].y, wakes[0].z).length()).toBeLessThan(1e-10);
    camera.position.set(-7, 3, 5); camera.lookAt(0, 0, 0); camera.updateMatrixWorld();
    for (let i = 0; i < 20; i++) { move(50 + i * 30, 200); viz.tick(0.06); }
    expect(wakes).toHaveLength(8);
    for (const kick of uniforms.u_kicks.value as THREE.Vector4[]) {
      expect(new THREE.Vector3(kick.x, kick.y, kick.z).length()).toBeLessThanOrEqual(0.6500001);
      expect(kick.w).toBeLessThanOrEqual(1);
    }
    const timestamps = wakes.map(wake => wake.w);
    canvas.dispatchEvent(new Event('pointerleave'));
    for (let i = 0; i < 40; i++) viz.tick(0.1);
    expect(wakes.map(wake => wake.w)).toEqual(timestamps);
    expect(wakes.every(wake => uniforms.u_time.value - wake.w > 3.5)).toBe(true);
    viz.setInteractionContext(null);
    move(50, 50); viz.tick(0.1);
    expect(wakes.map(wake => wake.w)).toEqual(timestamps);
    viz.dispose();
  });

  it('disposes both GPU objects exactly once and prevents reattachment', () => {
    const { viz, scene, group } = setup();
    const spies = group.children.flatMap(child => {
      const mesh = child as THREE.Mesh<THREE.BufferGeometry, THREE.Material>;
      return [vi.spyOn(mesh.geometry, 'dispose'), vi.spyOn(mesh.material, 'dispose')];
    });
    viz.dispose(); viz.dispose(); viz.attach(scene); viz.tick();
    expect(scene.children).toHaveLength(0);
    expect(scene.background).toBeNull();
    for (const spy of spies) expect(spy).toHaveBeenCalledTimes(1);
  });
});
