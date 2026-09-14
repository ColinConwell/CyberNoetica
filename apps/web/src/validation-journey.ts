import { validateSynthesis } from './validation-synthesis.js';
import * as THREE from 'three';
import { MessageBus } from '@cybernoetica/core';
import type { AudioFeatures } from '@cybernoetica/core';
import {
  JourneyVisualizer,
  JOURNEY_TYPES,
  createJourney,
  createStop,
  SceneManager,
} from '@cybernoetica/renderer';
export interface JourneyQAResult {
  source: string;
  target: string;
  style: string;
  fixture: string;
  error: string | null;
  variance: number;
  endpointDifference: number;
  cpuP95: number;
  preparationMs: number;
  solver: string;
  remainingGeometries: number;
  remainingTextures: number;
}
declare global {
  interface Window {
    __journeyQA?: {
      endurance?: typeof endurance;
      benchmark?: typeof benchmark;
      synthesis: typeof validateSynthesis;
      run: (options?: {
        types?: string[];
        frames?: number;
        fixtures?: string[];
        styles?: Array<'character' | 'unified'>;
      }) => Promise<JourneyQAResult[]>;
      results: JourneyQAResult[];
      done: boolean;
    };
  }
}
const scene = new SceneManager(640, 360);
scene.attach(document.querySelector<HTMLElement>('#canvas')!);
const renderer = scene.getRenderer()!;
renderer.setPixelRatio(1);
renderer.setSize(640, 360);
Object.assign(renderer.domElement.style, {
  position: 'relative',
  inset: 'auto',
});
const status = document.querySelector('#status')!;
const bus = new MessageBus();
const pixels = new Uint8Array(640 * 360 * 4);
let shaderError = '';
renderer.debug.onShaderError = (gl, _p, vs, fs) => {
  shaderError = `${gl.getShaderInfoLog(vs)} ${gl.getShaderInfoLog(fs)}`;
};
export function journeyFixture(kind: string, frame: number): AudioFeatures {
  return {
    fftBins: new Float32Array(2048).fill(kind === 'silence' ? 0 : 0.3),
    bass: kind === 'silence' ? 0 : 0.35,
    mid: kind === 'silence' ? 0 : 0.2,
    high: kind === 'silence' ? 0 : 0.15,
    rms: kind === 'silence' ? 0 : 0.2,
    spectralCentroid: 0.3,
    spectralFlux: kind === 'transients' && frame % 30 === 0 ? 0.8 : 0,
    beatOnset: kind === 'transients' && frame % 30 === 0,
    beatConfidence: 1,
    onsetId: Math.floor(frame / 30),
    timestamp: frame / 60,
    degraded: false,
  };
}
async function run(
  options: {
    types?: string[];
    frames?: number;
    fixtures?: string[];
    styles?: Array<'character' | 'unified'>;
  } = {},
): Promise<JourneyQAResult[]> {
  const results: JourneyQAResult[] = [],
    types = options.types ?? [...JOURNEY_TYPES],
    frames = options.frames ?? 40;
  window.__journeyQA!.done = false;
  window.__journeyQA!.results = results;
  for (const source of types)
    for (const target of types) {
      if (source === target) continue;
      for (const style of options.styles ?? ['character', 'unified'])
        for (const fixture of options.fixtures ?? [
          'silence',
          'tones',
          'transients',
        ]) {
          status.textContent = `${results.length + 1}: ${source} → ${target}, ${style}, ${fixture}`;
          const definition = createJourney(12);
          definition.stops = [createStop(source), createStop(target, 'stop-1')];
          definition.style = style;
          definition.loop = false;
          definition.stops[0].transition = 0.5;
          const journey = new JourneyVisualizer(bus, definition, 256);
          journey.setRenderer(renderer);
          journey.setResolution(640, 360);
          shaderError = '';
          const times: number[] = [];
          let error: string | null = null,
            variance = 0,
            endpointDifference = 0;
          try {
            await journey.initialize();
            const deadline = performance.now() + 10000;
            while (
              journey.state.preparationMs === 0 &&
              !journey.state.error &&
              performance.now() < deadline
            ) {
              journey.tick(1 / 60);
              await new Promise((r) => setTimeout(r, 5));
            }
            if (journey.state.error || journey.state.preparationMs === 0)
              throw new Error(journey.state.error ?? 'Preparation timeout');
            // Hold model time fixed and compare each endpoint with its epsilon-neighbor.
            journey.setPaused(true);
            const snapshots: Uint8Array[] = [];
            for (const progress of [0, 0.0001, 0.9999, 1]) {
              journey.state.progress = progress;
              journey.tick(0);
              journey.renderFrame(renderer);
              renderer
                .getContext()
                .readPixels(
                  0,
                  0,
                  640,
                  360,
                  renderer.getContext().RGBA,
                  renderer.getContext().UNSIGNED_BYTE,
                  pixels,
                );
              snapshots.push(pixels.slice());
            }
            for (const [a, b] of [
              [0, 1],
              [2, 3],
            ]) {
              let difference = 0;
              for (let i = 0; i < pixels.length; i++)
                difference += Math.abs(snapshots[a][i] - snapshots[b][i]);
              endpointDifference = Math.max(
                endpointDifference,
                difference / pixels.length,
              );
            }
            if (endpointDifference > 0.2)
              throw new Error(`Endpoint discontinuity: ${endpointDifference}`);
            journey.state.progress = 0;
            journey.setPaused(false);
            journey.nextStop();
            for (let f = 0; f < frames; f++) {
              bus.publish('audio:features', journeyFixture(fixture, f));
              const started = performance.now();
              journey.tick(1 / 60);
              journey.renderFrame(renderer);
              times.push(performance.now() - started);
              if (f === Math.floor(frames / 2)) {
                renderer
                  .getContext()
                  .readPixels(
                    0,
                    0,
                    640,
                    360,
                    renderer.getContext().RGBA,
                    renderer.getContext().UNSIGNED_BYTE,
                    pixels,
                  );
                let sum = 0,
                  square = 0;
                for (let p = 0; p < pixels.length; p += 4) {
                  const v = (pixels[p] + pixels[p + 1] + pixels[p + 2]) / 3;
                  sum += v;
                  square += v * v;
                }
                variance = square / (640 * 360) - (sum / (640 * 360)) ** 2;
              }
              if (f % 10 === 0) await new Promise((r) => setTimeout(r, 0));
            }
            if (shaderError) throw new Error(shaderError);
            if (
              renderer.getContext().getError() !==
              renderer.getContext().NO_ERROR
            )
              throw new Error('WebGL error');
            if (variance < 0.001) throw new Error('Flat transition output');
          } catch (e) {
            error = String(e);
          }
          const preparationMs = journey.state.preparationMs;
          journey.dispose();
          renderer.render(new THREE.Scene(), scene.camera);
          renderer.renderLists.dispose();
          times.sort((a, b) => a - b);
          results.push({
            source,
            target,
            style,
            fixture,
            error,
            variance,
            endpointDifference,
            cpuP95: times[Math.floor(times.length * 0.95)] ?? 0,
            preparationMs,
            solver: journey.state.solver,
            remainingGeometries: renderer.info.memory.geometries,
            remainingTextures: renderer.info.memory.textures,
          });
        }
    }
  status.textContent = JSON.stringify(results, null, 2);
  window.__journeyQA!.done = true;
  return results;
}
window.__journeyQA = {
  synthesis: validateSynthesis,
  run,
  results: [],
  done: false,
};
document.querySelector('#run')!.addEventListener('click', () => void run());

async function endurance(transitions = 100): Promise<Record<string, unknown>> {
  const definition = createJourney(77);
  definition.stops = JOURNEY_TYPES.map((type, i) => ({
    ...createStop(type, `stop-${i}`),
    hold: 0.5,
    transition: 0.5,
  }));
  const journey = new JourneyVisualizer(bus, definition, 1024);
  journey.setRenderer(renderer);
  journey.setResolution(1280, 720);
  renderer.setSize(1280, 720);
  await journey.initialize();
  let completed = 0,
    index = 0,
    maxGeometries = 0,
    maxTextures = 0;
  const started = performance.now();
  try {
    while (completed < transitions && performance.now() - started < 180000) {
      journey.tick(0.1);
      journey.renderFrame(renderer);
      maxGeometries = Math.max(maxGeometries, renderer.info.memory.geometries);
      maxTextures = Math.max(maxTextures, renderer.info.memory.textures);
      if (journey.state.index !== index) {
        index = journey.state.index;
        completed++;
        status.textContent = `Endurance ${completed}/${transitions}`;
      }
      if (journey.state.error) throw new Error(journey.state.error);
      await new Promise((r) => setTimeout(r, 0));
    }
    if (completed !== transitions)
      throw new Error(`Endurance timed out after ${completed} transitions`);
  } finally {
    journey.dispose();
    renderer.render(new THREE.Scene(), scene.camera);
    renderer.renderLists.dispose();
  }
  return {
    completed,
    maxGeometries,
    maxTextures,
    remainingGeometries: renderer.info.memory.geometries,
    remainingTextures: renderer.info.memory.textures,
    elapsedMs: performance.now() - started,
  };
}
async function benchmark(
  samples = 2048,
  style: 'character' | 'unified' = 'character',
): Promise<Record<string, unknown>> {
  renderer.setSize(1280, 720);
  const d = createJourney(22);
  d.style = style;
  d.stops = [
    createStop('lorenz'),
    createStop('torusknot'),
    createStop('orbital'),
  ];
  for (const stop of d.stops) {
    stop.hold = 2;
    stop.transition = 2;
  }
  const j = new JourneyVisualizer(bus, d, samples);
  j.setRenderer(renderer);
  j.setResolution(1280, 720);
  await j.initialize();
  const intervals: number[] = [],
    longTasks: number[] = [];
  let last = 0,
    frames = 0,
    warm = false;
  const observer = new PerformanceObserver((list) => {
    if (warm) for (const e of list.getEntries()) longTasks.push(e.duration);
  });
  observer.observe({ type: 'longtask', buffered: false });
  scene.setRenderDelegate((r) => j.renderFrame(r));
  let remove = () => {};
  await new Promise<void>((resolve) => {
    remove = scene.onRender((time) => {
      if (last && warm) intervals.push(time - last);
      last = time;
      j.tick(1 / 60);
      bus.publish('audio:features', journeyFixture('tones', frames));
      frames++;
      warm = frames > 120;
      if (frames >= 600) resolve();
    });
    scene.start();
  });
  scene.stop();
  remove();
  observer.disconnect();
  scene.setRenderDelegate(null);
  const timing = scene.getTimingPercentiles(),
    gpu = scene.getRendererDebugInfo(),
    resources = { ...renderer.info.memory },
    solverJobs = j.state.solverJobs,
    fallbacks = j.state.fallbacks,
    preparationMs = j.state.preparationMs;
  j.dispose();
  intervals.sort((a, b) => a - b);
  return {
    samples: samples * 2,
    style,
    viewport: [1280, 720],
    gpu,
    timing,
    frameP50: intervals[Math.floor(intervals.length * 0.5)],
    frameP95: intervals[Math.floor(intervals.length * 0.95)],
    missedFrames: intervals.filter((t) => t > 25).length,
    longTasks,
    resources,
    fallbacks,
    solverJobs,
    baselineFrequency: fallbacks / Math.max(1, solverJobs),
    preparationMs,
  };
}
window.__journeyQA!.endurance = endurance;
window.__journeyQA!.benchmark = benchmark;
