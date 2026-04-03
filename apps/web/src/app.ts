import { MessageBus } from '@cybernoetica/core';
import type { AudioFeatures } from '@cybernoetica/core';
import { AudioSource, AudioProcessor, loadWasmAnalyzer } from '@cybernoetica/audio';
import { SceneManager, MandelbrotVisualizer } from '@cybernoetica/renderer';
import { createUI } from './ui.js';

function fallbackFeatures(freqData: Float32Array): AudioFeatures {
  const len = freqData.length;
  const linear = new Float32Array(len);
  let totalEnergy = 0;
  for (let i = 0; i < len; i++) {
    linear[i] = Math.max(0, (freqData[i] + 100) / 100);
    totalEnergy += linear[i];
  }
  const bassEnd = Math.floor(250 / 21);
  const midEnd = Math.floor(4000 / 21);
  const bass = bandAvg(linear, 1, bassEnd);
  const mid = bandAvg(linear, bassEnd, midEnd);
  const high = bandAvg(linear, midEnd, len);
  const centroid = totalEnergy > 0
    ? Array.from(linear).reduce((sum, v, i) => sum + v * i, 0) / totalEnergy / len : 0;
  return {
    fftBins: linear, bass, mid, high,
    spectralCentroid: centroid, spectralFlux: 0,
    rms: totalEnergy / len, beatOnset: false, beatConfidence: 0, degraded: true,
  };
}

function bandAvg(data: Float32Array, from: number, to: number): number {
  if (from >= to) return 0;
  let sum = 0;
  const end = Math.min(to, data.length);
  for (let i = from; i < end; i++) sum += data[i];
  return sum / (end - from);
}

export async function createApp(container: HTMLElement): Promise<void> {
  // Core bus
  const bus = new MessageBus();

  // Scene
  const scene = new SceneManager(container.clientWidth || window.innerWidth, container.clientHeight || window.innerHeight);
  scene.attach(container);

  // Visualizer
  const mandelbrot = new MandelbrotVisualizer(bus);
  mandelbrot.attach(scene.scene);
  mandelbrot.setResolution(scene.width, scene.height);

  // Audio
  const audioSource = new AudioSource();
  await audioSource.init();
  const audioProcessor = new AudioProcessor(bus);

  // Attempt WASM analyzer load
  const wasmAnalyzer = await loadWasmAnalyzer();
  if (wasmAnalyzer) {
    console.log('CyberNoetica: WASM audio analyzer loaded');
  } else {
    console.log('CyberNoetica: using Web Audio API fallback');
  }

  // UI
  const ui = createUI();

  ui.onFileSelect(async (file: File) => {
    try {
      await audioSource.resume();
      await audioSource.loadFile(file);
    } catch (err) {
      ui.showError(`Failed to load audio file: ${(err as Error).message}`);
    }
  });

  ui.onMicClick(async () => {
    try {
      await audioSource.resume();
      await audioSource.useMicrophone();
    } catch (err) {
      ui.showError(`Microphone access denied: ${(err as Error).message}`);
    }
  });

  // Spacebar toggles UI
  window.addEventListener('keydown', (e: KeyboardEvent) => {
    if (e.code === 'Space' && e.target === document.body) {
      e.preventDefault();
      ui.onToggleUI();
    }
  });

  // Resize handler
  window.addEventListener('resize', () => {
    const w = window.innerWidth;
    const h = window.innerHeight;
    scene.resize(w, h);
    mandelbrot.setResolution(w, h);
  });

  // Render loop: audio extraction + feature push + visualizer tick
  scene.onRender(() => {
    if (wasmAnalyzer) {
      const samples = audioSource.getSamples();
      if (samples) {
        try {
          const features = wasmAnalyzer.analyze(samples);
          audioProcessor.pushFeatures({
            fftBins: new Float32Array(0),
            bass: features.bass,
            mid: features.mid,
            high: features.high,
            spectralCentroid: features.spectral_centroid,
            spectralFlux: features.spectral_flux,
            rms: features.rms,
            beatOnset: features.beat_onset,
            beatConfidence: features.beat_confidence,
            degraded: false,
          });
        } catch {
          // WASM error — no-op this frame
        }
      }
    } else {
      const freqData = audioSource.getFrequencyData();
      if (freqData) {
        audioProcessor.pushFeatures(fallbackFeatures(freqData));
      }
    }

    mandelbrot.tick();
  });

  // Start rendering
  scene.start();
}
