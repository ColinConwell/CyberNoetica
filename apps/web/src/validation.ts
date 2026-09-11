import * as THREE from 'three';
import { validateAudio } from './validation-audio.js';
import { validateVoro } from './validation-voro.js';
import { MessageBus } from '@cybernoetica/core';
import type { AudioFeatures } from '@cybernoetica/core';
import {
  SceneManager,
  VISUALIZER_MANIFEST,
  loadVisualizer,
} from '@cybernoetica/renderer';
import type { Visualizer } from '@cybernoetica/renderer';
import { SpectrumAnalyzer } from '@cybernoetica/audio';
// This entry is built only with CYBER_QA=1. It is not part of normal app startup.
const button = document.querySelector<HTMLButtonElement>('#run')!,
  status = document.querySelector('#status')!,
  body = document.querySelector('#results')!;
const scene = new SceneManager(640, 360);
scene.attach(document.querySelector<HTMLElement>('#canvas')!);
const renderer = scene.getRenderer()!;
renderer.setPixelRatio(1);
Object.assign(renderer.domElement.style, {
  position: 'relative',
  inset: 'auto',
});
const gl = renderer.getContext();
const pixels = new Uint8Array(640 * 360 * 4);
const analyzer = new SpectrumAnalyzer(48000),
  samples = new Float32Array(4096);
for (let i = 0; i < samples.length; i++)
  samples[i] =
    0.18 * Math.sin((2 * Math.PI * 93.75 * i) / 48000) +
    0.12 * Math.sin((2 * Math.PI * 750 * i) / 48000) +
    0.08 * Math.sin((2 * Math.PI * 6000 * i) / 48000);
const bus = new MessageBus();
let running = false,
  stopped = false,
  errors: string[] = [];
renderer.debug.onShaderError = (_gl, _program, vs, fs) => {
  errors.push(`${gl.getShaderInfoLog(vs)} ${gl.getShaderInfoLog(fs)}`);
};
window.addEventListener('error', (event) => errors.push(event.message));
window.addEventListener('unhandledrejection', (event) =>
  errors.push(String(event.reason)),
);
document.querySelector('#stop')!.addEventListener('click', () => {
  stopped = true;
});
const settle = () =>
  new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
button.addEventListener('click', () => {
  if (!running) void run();
});
async function run(): Promise<void> {
  running = true;
  stopped = false;
  button.disabled = true;
  body.replaceChildren();
  status.textContent = 'Checking production audio worklet…';
  const audioCheck = await validateAudio();
  document.body.dataset.audioCheck = JSON.stringify(audioCheck);
  const selected = new URLSearchParams(location.search)
    .get('types')
    ?.split(',');
  const repeats = Math.max(
    1,
    Math.min(
      20,
      Number(new URLSearchParams(location.search).get('repeat')) || 1,
    ),
  );
  const entries = Array.from({ length: repeats }, () =>
    VISUALIZER_MANIFEST.filter(
      (entry) => !selected || selected.includes(entry.type),
    ),
  ).flat();
  status.textContent = 'Checking native partition invariants…';
  const nativeChecks = await validateVoro();
  document.body.dataset.nativeChecks = JSON.stringify(nativeChecks);
  const results: Array<Record<string, unknown>> = [];
  const previews: Array<{ type: string; image: string }> = [];
  const frameCount = Math.max(
    45,
    Math.min(
      600,
      Number(new URLSearchParams(location.search).get('frames')) || 45,
    ),
  );
  for (const entry of entries) {
    if (stopped) break;
    errors = [];
    status.textContent = `Checking ${entry.label} (${results.length + 1}/${entries.length})`;
    let viz: Visualizer | null = null;
    let screenshot = '',
      cpu = 0,
      variance = 0,
      notes = '';
    try {
      const loaded = await loadVisualizer(entry.type);
      if (!loaded) throw new Error('Missing registry entry');
      viz = loaded.create(bus);
      viz.setRenderer?.(renderer);
      viz.setInteractionContext?.({
        canvas: renderer.domElement,
        getPerspectiveCamera: () => scene.perspCamera,
      });
      viz.attach(scene.scene);
      viz.setResolution(640, 360);
      scene.activeCamera = viz.metadata.usesPerspective
        ? scene.perspCamera
        : scene.camera;
      const view = viz.getViewState(),
        distance = view.distance ?? 12,
        angle = view.orbitAngle ?? 0,
        elevation = view.elevation ?? 0;
      scene.setCameraPosition(
        Math.sin(angle) * Math.cos(elevation) * distance,
        Math.sin(elevation) * distance,
        Math.cos(angle) * Math.cos(elevation) * distance,
      );
      // Allow async worker startup, with actual rAF yielding between every frame.
      for (let frame = 0; frame < frameCount; frame++) {
        const features: AudioFeatures = {
          ...analyzer.analyze(samples, frame / 60, samples),
          beatOnset: frame === 12,
          onsetId: frame >= 12 ? 1 : 0,
        };
        bus.publish('audio:features', features);
        const start = performance.now();
        viz.tick(1 / 60);
        renderer.render(scene.scene, scene.activeCamera);
        cpu += performance.now() - start;
        await settle();
      }
      renderer.render(scene.scene, scene.activeCamera);
      gl.readPixels(0, 0, 640, 360, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
      let sum = 0,
        square = 0;
      for (let i = 0; i < pixels.length; i += 4) {
        const l = (pixels[i] + pixels[i + 1] + pixels[i + 2]) / 3;
        sum += l;
        square += l * l;
      }
      variance = square / (640 * 360) - (sum / (640 * 360)) ** 2;
      screenshot = renderer.domElement.toDataURL('image/png');
      for (const value of ['min', 'max'] as const) {
        for (const parameter of viz.metadata.params)
          viz.setUserParam(parameter.key, parameter[value]);
        for (let frame = 0; frame < 3; frame++) {
          viz.tick(1 / 60);
          renderer.render(scene.scene, scene.activeCamera);
          await settle();
        }
      }
      bus.publish('audio:features', {
        fftBins: new Float32Array(2048),
        spectrum: new Float32Array(2048),
        waveform: new Float32Array(4096),
        sampleRate: 48000,
        fftSize: 4096,
        bass: 0,
        mid: 0,
        high: 0,
        rms: 0,
        spectralCentroid: 0,
        spectralFlux: 0,
        beatOnset: false,
        beatConfidence: 0,
        degraded: false,
      });
      viz.tick(1 / 30);
      renderer.render(scene.scene, scene.activeCamera);
      const error = gl.getError();
      if (error !== gl.NO_ERROR) errors.push(`WebGL error ${error}`);
      scene.scene.traverse((object) => {
        const mesh = object as THREE.Mesh;
        if (!mesh.geometry) return;
        for (const attribute of Object.values(mesh.geometry.attributes)) {
          if (!Array.from(attribute.array).every(Number.isFinite))
            errors.push('Nonfinite geometry');
        }
      });
      if (variance < 0.01)
        notes = 'Flat image: inspect default framing or delayed initialization';
    } catch (error) {
      errors.push(String(error));
    } finally {
      viz?.setInteractionContext?.(null);
      viz?.dispose();
      scene.clearScene();
      renderer.render(scene.scene, scene.camera);
      await settle();
    }
    const resources = { ...renderer.info.memory };
    if (resources.geometries > 0 || resources.textures > 0)
      errors.push(`Resources survived disposal: ${JSON.stringify(resources)}`);
    const result = {
      resources,
      type: entry.type,
      result: errors.length ? 'FAIL' : 'PASS',
      cpuMs: +(cpu / frameCount).toFixed(2),
      variance: +variance.toFixed(2),
      errors: [...errors],
      notes,
    };
    results.push(result);
    previews.push({ type: entry.type, image: screenshot });
    const row = document.createElement('tr');
    for (const text of [entry.label, result.result, String(result.cpuMs)]) {
      const cell = document.createElement('td');
      cell.textContent = text;
      row.append(cell);
    }
    const preview = document.createElement('td'),
      img = document.createElement('img');
    img.src = screenshot;
    img.alt = entry.label;
    preview.append(img);
    row.append(preview);
    const detail = document.createElement('td');
    detail.textContent = [notes, ...errors].join('\n');
    row.append(detail);
    body.append(row);
    document.body.dataset.results = JSON.stringify(results);
  }
  status.textContent = `Complete: ${results.length} visualizers, ${results.filter((r) => r.result === 'FAIL').length} failures, ${results.filter((r) => r.notes).length} images to inspect. Native checks: ${nativeChecks.filter((r) => !r.error).length}/${nativeChecks.length}. Audio: ${audioCheck.result}.`;
  const download = document.querySelector<HTMLAnchorElement>('#download')!;
  download.href = URL.createObjectURL(
    new Blob(
      [
        JSON.stringify(
          { date: new Date().toISOString(), audioCheck, nativeChecks, results },
          null,
          2,
        ),
      ],
      { type: 'application/json' },
    ),
  );
  download.download = 'visualizer-validation.json';
  download.hidden = false;
  try {
    const saved = await fetch('/__validation', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        date: new Date().toISOString(),
        audioCheck,
        nativeChecks,
        results,
        previews,
      }),
    });
    if (saved.ok) {
      const output = await saved.json();
      document.body.dataset.evidence = output.directory;
    }
  } catch {
    /* The report is still available through the download link. */
  }
  button.disabled = false;
  running = false;
}
