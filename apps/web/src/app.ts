import { MessageBus } from '@cybernoetica/core';
import { SceneManager } from '@cybernoetica/renderer';
import { createUI } from './ui/index.js';
import type { VisualizerType } from './ui/index.js';
import { AudioPipeline } from './managers/audio-pipeline.js';
import { TrackManager } from './managers/track-manager.js';
import { VisualizerManager } from './managers/visualizer-manager.js';
import { createAppStore } from './store.js';

export async function createApp(container: HTMLElement): Promise<void> {
  const bus = new MessageBus();
  const store = createAppStore();

  // Expose globals for debug panel
  (window as any).__cybernoetica = { store, bus };

  const scene = new SceneManager(
    container.clientWidth || window.innerWidth,
    container.clientHeight || window.innerHeight,
  );
  scene.attach(container);

  const audio = new AudioPipeline(bus);
  await audio.init();
  store.setState({ audio: { wasm: audio.isWasm() } });

  const vizManager = new VisualizerManager(bus, scene);
  const trackManager = new TrackManager(audio.source);
  const sampleTracks = await trackManager.fetchSampleTracks();

  // Restore persisted settings
  const saved = store.getState();
  if (saved.ui.autoPlay !== undefined || saved.ui.shuffle !== undefined) {
    trackManager.setAutoPlay(saved.ui.autoPlay, saved.ui.shuffle);
  }

  let playing = false;

  // Auto-play: when a track ends, play the next
  audio.source.onEnded(() => {
    if (trackManager.isAutoPlayEnabled() && playing) {
      const next = trackManager.getNextTrack();
      if (next) {
        trackManager.loadTrack(next.url)
          .then(() => ui.setActiveTrack(next.name))
          .catch(err => ui.showError(`Failed to load track: ${(err as Error).message}`));
      }
    }
  });

  // Appearance controls: reads params from active visualizer metadata
  function updateAppearanceControls() {
    const viz = vizManager.getActive();
    if (!viz || viz.metadata.params.length === 0) {
      ui.setAppearanceRenderer(null);
      return;
    }
    const params = viz.metadata.params;
    ui.setAppearanceRenderer((ctr: HTMLElement) => {
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
        Object.assign(slider, {
          type: 'range', min: String(param.min), max: String(param.max),
          step: String(param.step), value: String(param.initial),
        });
        Object.assign(slider.style, { width: '90px', accentColor: 'rgba(140, 160, 255, 0.6)' });
        const num = document.createElement('span');
        Object.assign(num.style, { fontSize: '10px', color: 'rgba(255,255,255,0.3)', minWidth: '36px', textAlign: 'right' });
        num.textContent = String(param.initial);
        slider.addEventListener('input', () => {
          const val = Number(slider.value);
          num.textContent = val < 0.01 ? val.toExponential(1) : String(Math.round(val * 1000) / 1000);
          viz.setUserParam(param.key, val);
        });
        right.append(slider, num);
        row.append(label, right);
        ctr.appendChild(row);
      }
    });
  }

  // UI
  const ui = createUI();
  ui.setSampleTracks(sampleTracks);

  ui.onStart(() => {
    const viz = vizManager.switchRandom();
    updateAppearanceControls();
    const type = vizManager.getActiveType();
    ui.setActiveVisualizer(type as VisualizerType);
    store.setState({ visualizer: { type, userParams: {} } });
    const track = trackManager.getRandomTrack();
    if (track) {
      trackManager.loadTrack(track.url)
        .then(() => {
          ui.setActiveTrack(track.name);
          store.setState({ audio: { trackName: track.name, source: 'file' } });
        })
        .catch(err => ui.showError(`Failed to load track: ${(err as Error).message}`));
    }
    playing = true;
    ui.setPlaying(true);
    store.setState({ audio: { playing: true } });
    scene.start();
  });

  ui.onPause(() => {
    playing = false;
    audio.source.suspend();
    ui.setPlaying(false);
    store.setState({ audio: { playing: false } });
  });

  ui.onResume(() => {
    playing = true;
    audio.source.resume();
    ui.setPlaying(true);
    store.setState({ audio: { playing: true } });
  });

  ui.onVisualizerChange((type) => {
    vizManager.switchTo(type);
    updateAppearanceControls();
    ui.setActiveVisualizer(type);
    store.setState({ visualizer: { type, userParams: {} } });
  });

  ui.onRandomVisualizer(() => {
    vizManager.switchRandom(vizManager.getActiveType());
    updateAppearanceControls();
    const type = vizManager.getActiveType();
    ui.setActiveVisualizer(type as VisualizerType);
    store.setState({ visualizer: { type, userParams: {} } });
  });

  ui.onTrackSelect((url, name) => {
    trackManager.loadTrack(url)
      .then(() => ui.setActiveTrack(name))
      .catch(err => ui.showError(`Failed to load track: ${(err as Error).message}`));
  });

  ui.onRandomTrack(() => {
    const track = trackManager.getRandomTrack();
    if (track) {
      trackManager.loadTrack(track.url)
        .then(() => ui.setActiveTrack(track.name))
        .catch(err => ui.showError(`Failed to load track: ${(err as Error).message}`));
    }
  });

  ui.onFileSelect(async (file) => {
    try {
      await audio.source.resume();
      await audio.source.loadFile(file);
      ui.setActiveTrack(file.name.replace(/\.[^.]+$/, ''));
    } catch (err) {
      ui.showError(`Failed to load audio: ${(err as Error).message}`);
    }
  });

  ui.onMicClick(async () => {
    try {
      await audio.source.resume();
      await audio.source.useMicrophone();
      ui.setActiveTrack('Microphone');
    } catch (err) {
      ui.showError(`Microphone access denied: ${(err as Error).message}`);
    }
  });

  ui.onAutoPlayChange((enabled, shuffle) => {
    trackManager.setAutoPlay(enabled, shuffle);
    store.setState({ ui: { autoPlay: enabled, shuffle } });
  });

  ui.onSystemAudio(async () => {
    try {
      await audio.source.resume();
      await audio.source.useSystemAudio();
      ui.setActiveTrack('System Audio');
    } catch (err) {
      ui.showError(`System audio capture failed: ${(err as Error).message}`);
    }
  });

  window.addEventListener('resize', () => {
    const w = window.innerWidth;
    const h = window.innerHeight;
    scene.resize(w, h);
    vizManager.resize(w, h);
  });

  // Render loop with debug info
  let pauseFade = 1.0;
  let lastFrameTime = performance.now();
  let frameCount = 0;
  let fps = 0;
  let fpsTimer = performance.now();

  scene.onRender(() => {
    const now = performance.now();
    frameCount++;
    if (now - fpsTimer >= 1000) {
      fps = frameCount;
      frameCount = 0;
      fpsTimer = now;
    }
    const frameTime = now - lastFrameTime;
    lastFrameTime = now;

    if (playing) {
      audio.pushFrame();
      pauseFade = Math.min(1.0, pauseFade + 0.02);
    } else {
      pauseFade = Math.max(0.0, pauseFade - 0.008);
      audio.pushSilent(pauseFade * 0.05);
    }
    vizManager.tick();

    // Update debug info (sampled — not every frame)
    if (frameCount % 6 === 0) {
      (window as any).__cybernoetica_debug = {
        fps, frameTime: Math.round(frameTime * 10) / 10,
        vizType: vizManager.getActiveType(),
      };
    }
  });
}
