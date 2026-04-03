import { MessageBus } from '@cybernoetica/core';
import type { AudioFeatures } from '@cybernoetica/core';
import { AudioSource, AudioProcessor, loadWasmAnalyzer } from '@cybernoetica/audio';
import { SceneManager, MandelbrotVisualizer, OrbitalVisualizer, WaveformVisualizer, JuliaVisualizer } from '@cybernoetica/renderer';
import { createUI } from './ui.js';
import type { VisualizerType } from './ui.js';

// ── Audio fallback ──────────────────────────────────────────────────
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
  return {
    fftBins: linear,
    bass: bandAvg(linear, 1, bassEnd),
    mid: bandAvg(linear, bassEnd, midEnd),
    high: bandAvg(linear, midEnd, len),
    spectralCentroid: totalEnergy > 0
      ? Array.from(linear).reduce((sum, v, i) => sum + v * i, 0) / totalEnergy / len : 0,
    spectralFlux: 0,
    rms: totalEnergy / len,
    beatOnset: false,
    beatConfidence: 0,
    degraded: true,
  };
}

function bandAvg(data: Float32Array, from: number, to: number): number {
  if (from >= to) return 0;
  let sum = 0;
  const end = Math.min(to, data.length);
  for (let i = from; i < end; i++) sum += data[i];
  return sum / (end - from);
}

// ── Visualizer interface ────────────────────────────────────────────
interface Visualizer {
  attach(scene: THREE.Scene): void;
  tick(): void;
  setResolution?(w: number, h: number): void;
  /** Set viewport pan offset (for shader visualizers) */
  setPan?(x: number, y: number): void;
  /** Set viewport zoom multiplier (for shader visualizers) */
  setZoom?(z: number): void;
  dispose(): void;
  /** If true, uses a perspective camera instead of orthographic */
  usesPerspective?: boolean;
}

const VISUALIZER_TYPES: VisualizerType[] = ['orbital', 'waveform', 'julia', 'mandelbrot'];

function pickRandom<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

// ── App ─────────────────────────────────────────────────────────────
export async function createApp(container: HTMLElement): Promise<void> {
  const bus = new MessageBus();

  // Scene
  const scene = new SceneManager(
    container.clientWidth || window.innerWidth,
    container.clientHeight || window.innerHeight,
  );
  scene.attach(container);

  // Visualizer management
  let activeViz: Visualizer | null = null;
  let activeVizType: VisualizerType = 'orbital';
  let playing = false;

  const visualizers: Record<VisualizerType, () => Visualizer> = {
    orbital: () => new OrbitalVisualizer(bus),
    waveform: () => new WaveformVisualizer(bus),
    julia: () => new JuliaVisualizer(bus),
    mandelbrot: () => new MandelbrotVisualizer(bus),
  };

  // Per-visualizer appearance control definitions
  interface ParamDef {
    label: string;
    min: number;
    max: number;
    step: number;
    initial: number;
    apply: (viz: Visualizer, value: number) => void;
  }

  const vizParams: Partial<Record<VisualizerType, ParamDef[]>> = {
    orbital: [
      { label: 'Glow', min: 0.3, max: 2.5, step: 0.1, initial: 1.0,
        apply: (v, val) => { (v as any).userParams.glowMultiplier = val; } },
      { label: 'Gravity', min: 0.2, max: 3.0, step: 0.1, initial: 1.0,
        apply: (v, val) => { (v as any).userParams.gravityMultiplier = val; } },
      { label: 'Turbulence', min: 0.0, max: 3.0, step: 0.1, initial: 1.0,
        apply: (v, val) => { (v as any).userParams.noiseMultiplier = val; } },
    ],
    waveform: [
      { label: 'Bass Boost', min: 0.0, max: 1.0, step: 0.05, initial: 0.0,
        apply: (v, val) => {
          const mat = (v as any).material;
          if (mat) mat.uniforms.u_bass.value = Math.max(mat.uniforms.u_bass.value, val);
        } },
      { label: 'Brightness', min: 0.2, max: 2.0, step: 0.1, initial: 1.0,
        apply: (v, val) => {
          const mat = (v as any).material;
          if (mat) mat.uniforms.u_rms.value = Math.max(mat.uniforms.u_rms.value, val * 0.3);
        } },
    ],
    mandelbrot: [
      { label: 'Zoom Speed', min: 0.0002, max: 0.003, step: 0.0001, initial: 0.0008,
        apply: (v, val) => { (v as any).zoomSpeed = val; } },
      { label: 'Rotation', min: 0.0, max: 0.015, step: 0.001, initial: 0.003,
        apply: (v, val) => { (v as any).rotationSpeed = val; (v as any).rotationEnabled = val > 0; } },
    ],
    julia: [
      { label: 'Orbit Speed', min: 0.02, max: 0.5, step: 0.02, initial: 0.15,
        apply: (v, val) => { (v as any).orbitSpeed = val; } },
      { label: 'Orbit Radius', min: 0.01, max: 0.25, step: 0.01, initial: 0.08,
        apply: (v, val) => { (v as any).orbitRadius = val; } },
      { label: 'Morph Speed', min: 2, max: 20, step: 1, initial: 8,
        apply: (v, val) => { (v as any).transitionDuration = val; } },
    ],
  };

  function updateAppearanceControls(type: VisualizerType) {
    const params = vizParams[type];
    if (!params || params.length === 0) {
      ui.setAppearanceRenderer(null);
      return;
    }
    ui.setAppearanceRenderer((container: HTMLElement) => {
      for (const param of params) {
        const row = document.createElement('div');
        Object.assign(row.style, {
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          marginBottom: '10px', fontSize: '12px', color: 'rgba(255,255,255,0.5)',
        });
        const label = document.createElement('span');
        label.textContent = param.label;
        const right = document.createElement('div');
        Object.assign(right.style, { display: 'flex', alignItems: 'center', gap: '8px' });
        const slider = document.createElement('input');
        Object.assign(slider, { type: 'range', min: String(param.min), max: String(param.max), step: String(param.step), value: String(param.initial) });
        Object.assign(slider.style, { width: '90px', accentColor: 'rgba(140, 160, 255, 0.6)' });
        const num = document.createElement('span');
        Object.assign(num.style, { fontSize: '10px', color: 'rgba(255,255,255,0.3)', minWidth: '36px', textAlign: 'right' });
        num.textContent = String(param.initial);
        slider.addEventListener('input', () => {
          const val = Number(slider.value);
          num.textContent = val < 0.01 ? val.toExponential(1) : String(Math.round(val * 1000) / 1000);
          if (activeViz) param.apply(activeViz, val);
        });
        right.append(slider, num);
        row.append(label, right);
        container.appendChild(row);
      }
    });
  }

  function switchVisualizer(type: VisualizerType) {
    if (activeViz) {
      activeViz.dispose();
      while (scene.scene.children.length > 0) scene.scene.remove(scene.scene.children[0]);
    }
    activeVizType = type;
    activeViz = visualizers[type]();
    activeViz.attach(scene.scene);
    activeViz.setResolution?.(scene.width, scene.height);
    // Switch camera and reset viewport
    scene.activeCamera = activeViz.usesPerspective ? scene.perspCamera : scene.camera;
    scene.resetView();
    ui.setActiveVisualizer(type);
    updateAppearanceControls(type);
  }

  // Audio
  const audioSource = new AudioSource();
  await audioSource.init();
  const audioProcessor = new AudioProcessor(bus);
  const wasmAnalyzer = await loadWasmAnalyzer();
  if (wasmAnalyzer) console.log('CyberNoetica: WASM audio analyzer loaded');

  // Auto-play: when a track ends, play the next one
  audioSource.onEnded(() => {
    if (autoPlayEnabled && playing) {
      loadNextTrack();
    }
  });

  // Load sample track list
  let sampleTracks: string[] = [];
  try {
    const res = await fetch('/sample-music/__list');
    sampleTracks = await res.json();
  } catch { /* no samples available */ }

  // Track loading helper
  async function loadTrack(url: string, name: string) {
    try {
      await audioSource.resume();
      const response = await fetch(url);
      const buffer = await response.arrayBuffer();
      const blob = new Blob([buffer], { type: 'audio/mpeg' });
      const file = new File([blob], `${name}.mp3`, { type: 'audio/mpeg' });
      await audioSource.loadFile(file);
      ui.setActiveTrack(name);
    } catch (err) {
      ui.showError(`Failed to load track: ${(err as Error).message}`);
    }
  }

  // Auto-play state
  let autoPlayEnabled = true;
  let shuffleEnabled = true;
  let trackIndex = 0;
  let playedTracks: Set<number> = new Set();

  function loadRandomTrack() {
    if (sampleTracks.length === 0) return;
    const track = pickRandom(sampleTracks);
    const name = track.split('/').pop()?.replace(/\.[^.]+$/, '') || track;
    trackIndex = sampleTracks.indexOf(track);
    loadTrack(`/sample-music/${track}`, name);
  }

  function loadNextTrack() {
    if (sampleTracks.length === 0) return;
    if (shuffleEnabled) {
      // Pick random unplayed track; reset when all played
      if (playedTracks.size >= sampleTracks.length) playedTracks.clear();
      let idx: number;
      do { idx = Math.floor(Math.random() * sampleTracks.length); } while (playedTracks.has(idx) && playedTracks.size < sampleTracks.length);
      playedTracks.add(idx);
      trackIndex = idx;
    } else {
      trackIndex = (trackIndex + 1) % sampleTracks.length;
    }
    const track = sampleTracks[trackIndex];
    const name = track.split('/').pop()?.replace(/\.[^.]+$/, '') || track;
    loadTrack(`/sample-music/${track}`, name);
  }

  // ── UI ──────────────────────────────────────────────────────────
  const ui = createUI();
  ui.setSampleTracks(sampleTracks);

  // Start: pick random viz + random track, begin
  ui.onStart(() => {
    const vizType = pickRandom(VISUALIZER_TYPES);
    switchVisualizer(vizType);
    loadRandomTrack();
    playing = true;
    ui.setPlaying(true);
    scene.start();
  });

  ui.onPause(() => {
    playing = false;
    audioSource.suspend();
    ui.setPlaying(false);
    // Visual continues ticking but we could add collapse here
  });

  ui.onResume(() => {
    playing = true;
    audioSource.resume();
    ui.setPlaying(true);
  });

  ui.onVisualizerChange((type) => {
    switchVisualizer(type);
  });

  ui.onRandomVisualizer(() => {
    const other = VISUALIZER_TYPES.filter(t => t !== activeVizType);
    const type = other.length > 0 ? pickRandom(other) : pickRandom(VISUALIZER_TYPES);
    switchVisualizer(type);
  });

  ui.onTrackSelect((url, name) => loadTrack(url, name));

  ui.onRandomTrack(loadRandomTrack);

  ui.onFileSelect(async (file) => {
    try {
      await audioSource.resume();
      await audioSource.loadFile(file);
      ui.setActiveTrack(file.name.replace(/\.[^.]+$/, ''));
    } catch (err) {
      ui.showError(`Failed to load audio: ${(err as Error).message}`);
    }
  });

  ui.onMicClick(async () => {
    try {
      await audioSource.resume();
      await audioSource.useMicrophone();
      ui.setActiveTrack('Microphone');
    } catch (err) {
      ui.showError(`Microphone access denied: ${(err as Error).message}`);
    }
  });

  ui.onAutoPlayChange((enabled, shuffle) => {
    autoPlayEnabled = enabled;
    shuffleEnabled = shuffle;
  });

  ui.onSystemAudio(async () => {
    try {
      await audioSource.resume();
      await audioSource.useSystemAudio();
      ui.setActiveTrack('System Audio');
    } catch (err) {
      ui.showError(`System audio capture failed: ${(err as Error).message}`);
    }
  });

  // Resize
  window.addEventListener('resize', () => {
    const w = window.innerWidth;
    const h = window.innerHeight;
    scene.resize(w, h);
    activeViz?.setResolution?.(w, h);
  });

  // Render loop (always runs once started)
  let pauseFade = 1.0; // 1.0 = full, fading toward 0 when paused
  scene.onRender(() => {
    if (playing) {
      // Push audio features
      if (wasmAnalyzer) {
        const samples = audioSource.getSamples();
        if (samples) {
          try {
            const f = wasmAnalyzer.analyze(samples);
            audioProcessor.pushFeatures({
              fftBins: new Float32Array(0),
              bass: f.bass, mid: f.mid, high: f.high,
              spectralCentroid: f.spectral_centroid,
              spectralFlux: f.spectral_flux,
              rms: f.rms,
              beatOnset: f.beat_onset,
              beatConfidence: f.beat_confidence,
              degraded: false,
            });
          } catch { /* skip frame */ }
        }
      } else {
        const freqData = audioSource.getFrequencyData();
        if (freqData) audioProcessor.pushFeatures(fallbackFeatures(freqData));
      }
      pauseFade = Math.min(1.0, pauseFade + 0.02); // fade back in
      // Pass viewport pan/zoom to shader visualizers
      const [px, py] = scene.getPan();
      activeViz?.setPan?.(px, py);
      activeViz?.setZoom?.(scene.getUserZoom());
      activeViz?.tick();
    } else {
      // Paused: push silent features to let visualizer fade to baseline
      pauseFade = Math.max(0.0, pauseFade - 0.008); // slow fade out
      audioProcessor.pushFeatures({
        fftBins: new Float32Array(0),
        bass: 0, mid: 0, high: 0,
        spectralCentroid: 0.5, spectralFlux: 0,
        rms: pauseFade * 0.05, // tiny amount to keep minimal glow
        beatOnset: false, beatConfidence: 0, degraded: true,
      });
      const [px2, py2] = scene.getPan();
      activeViz?.setPan?.(px2, py2);
      activeViz?.setZoom?.(scene.getUserZoom());
      activeViz?.tick(); // keep ticking so it can fade smoothly
    }
  });

  // Don't start the render loop yet — wait for Start button
}
