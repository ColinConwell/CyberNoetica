import { MessageBus } from '@cybernoetica/core';
import { SceneManager, getVisualizerTypes } from '@cybernoetica/renderer';
import { createUI } from './ui/index.js';
import type { VisualizerType } from './ui/index.js';
import type { LogDisplayMode } from './ui/log-display.js';
import { paramSlider } from './ui/components.js';
import { AudioPipeline } from './managers/audio-pipeline.js';
import { TrackManager } from './managers/track-manager.js';
import { VisualizerManager } from './managers/visualizer-manager.js';
import { PlaybackStateMachine } from './managers/playback-state.js';
import { QualityManager } from './managers/quality-manager.js';
import { createAppStore } from './store.js';
import type { QualityMode } from './store.js';
import { resolveLaunchConfig, resolveAudioTarget } from './utils/launch-params.js';
import type { CyberNoeticaGlobals } from './globals.js';
import './globals.js';

export async function createApp(container: HTMLElement): Promise<void> {
  const bus = new MessageBus();
  const store = createAppStore();

  const scene = new SceneManager(
    container.clientWidth || window.innerWidth,
    container.clientHeight || window.innerHeight,
  );
  scene.attach(container);

  window.__cybernoetica = { store, bus, scene, powerSaver: false, setPowerSaver: () => {} } as CyberNoeticaGlobals;

  const audio = new AudioPipeline(bus);
  await audio.init();
  store.setState({ audio: { wasm: audio.isWasm() } });

  const vizManager = new VisualizerManager(bus, scene);
  const trackManager = new TrackManager(audio.source);
  const sampleTracks = await trackManager.fetchSampleTracks();
  const playback = new PlaybackStateMachine(bus);

  // Quality tier + adaptive governor. Owns pixel-ratio and frame cadence.
  const quality = new QualityManager({
    bus,
    applyTier: (tier) => {
      scene.setQualityTier(tier);
      vizManager.resize(window.innerWidth, window.innerHeight);
    },
    getDebugInfo: () => scene.getRendererDebugInfo(),
  });
  quality.initialize();
  const savedQuality = store.getState().ui.quality ?? 'auto';
  quality.setMode(savedQuality);

  const QUALITY_CYCLE: QualityMode[] = ['auto', 'sub-performance', 'performance', 'balanced', 'high', 'ultra'];
  window.__cybernoetica!.playback = playback;
  window.__cybernoetica!.vizManager = vizManager;
  window.__cybernoetica!.quality = {
    getMode: () => quality.getMode(),
    getTier: () => quality.getTier(),
    setMode: (mode) => {
      quality.setMode(mode);
      store.setState({ ui: { quality: mode } });
    },
    cycle: () => {
      const current = quality.getMode();
      const idx = QUALITY_CYCLE.indexOf(current);
      const next = QUALITY_CYCLE[(idx + 1) % QUALITY_CYCLE.length];
      quality.setMode(next);
      store.setState({ ui: { quality: next } });
    },
  };

  window.addEventListener('keydown', (e) => {
    if (e.key === 'q' || e.key === 'Q') {
      if (e.target instanceof HTMLElement) {
        const tag = e.target.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || e.target.isContentEditable) return;
      }
      window.__cybernoetica!.quality!.cycle();
    }
  });

  const saved = store.getState();
  if (saved.ui.autoPlay !== undefined || saved.ui.shuffle !== undefined) {
    trackManager.setAutoPlay(saved.ui.autoPlay, saved.ui.shuffle);
  }

  // Sync playback state machine -> store
  playback.onChange((newState) => {
    store.setState({
      audio: { playing: newState === 'playing' },
    });
  });

  // Auto-play: when a track ends, play the next (only if currently playing)
  audio.source.onEnded(() => {
    if (trackManager.isAutoPlayEnabled() && playback.isPlaying) {
      const next = trackManager.getNextTrack();
      if (next) {
        loadAndPlayTrack(next.url, next.name);
      }
    }
  });

  // Centralized track loading with state machine integration
  async function loadAndPlayTrack(url: string, name: string): Promise<void> {
    if (!playback.canDispatch('SELECT_TRACK') && !playback.canDispatch('NEXT_TRACK')) {
      if (playback.canDispatch('START')) {
        playback.dispatch({ type: 'START' });
      } else {
        return;
      }
    } else {
      playback.dispatch({ type: 'SELECT_TRACK' });
    }

    try {
      const loaded = await trackManager.loadTrack(url);
      if (!loaded) return; // superseded by a newer request
      playback.dispatch({ type: 'LOADED' });
      ui.setActiveTrack(name);
      ui.setPlaying(true);
      store.setState({ audio: { trackName: name, source: 'file' } });
    } catch (err) {
      playback.dispatch({ type: 'ERROR', error: (err as Error).message });
      ui.showError(`Failed to load track: ${(err as Error).message}`);
    }
  }

  function renderParamSliderRow(
    ctr: HTMLElement,
    param: { key: string; label: string; description?: string; min: number; max: number; step: number; initial: number },
    viz: { setUserParam(key: string, value: number): void },
  ) {
    ctr.appendChild(paramSlider({
      ...param,
      onChange: (key, val) => viz.setUserParam(key, val),
    }));
  }

  function updateAppearanceControls() {
    const viz = vizManager.getActive();
    if (!viz) {
      ui.setAppearanceRenderer(null);
      ui.setViewStateAccessors(null);
      return;
    }

    ui.setViewStateAccessors({
      getViewState: () => viz.getViewState(),
      setViewState: (partial) => viz.setViewState(partial),
      onResetView: () => {
        const type = vizManager.getActiveType();
        if (type) {
          void vizManager.switchTo(type).then(() => updateAppearanceControls());
        } else {
          updateAppearanceControls();
        }
      },
    });

    if (viz.metadata.params.length === 0) {
      ui.setAppearanceRenderer(null);
      return;
    }
    const params = viz.metadata.params;
    const appearanceParams = params.filter(p => (p.category ?? 'appearance') === 'appearance');
    const audioParams = params.filter(p => p.category === 'audio-mapping');

    ui.setAppearanceRenderer((ctr: HTMLElement) => {
      for (const param of appearanceParams) {
        renderParamSliderRow(ctr, param, viz);
      }

      if (audioParams.length > 0) {
        const divider = document.createElement('div');
        Object.assign(divider.style, { height: '16px' });
        ctr.appendChild(divider);

        const sectionEl = document.createElement('div');
        Object.assign(sectionEl.style, {
          fontSize: '10px', fontWeight: '500', letterSpacing: '0.2em',
          textTransform: 'uppercase', color: 'rgba(255,255,255,0.3)',
          fontFamily: 'system-ui, -apple-system, sans-serif',
          marginBottom: '10px',
        });
        sectionEl.textContent = 'Audio Response';
        ctr.appendChild(sectionEl);

        for (const param of audioParams) {
          renderParamSliderRow(ctr, param, viz);
        }
      }
    });
  }

  // UI
  const ui = createUI();
  ui.setSampleTracks(sampleTracks);

  const launchConfig = resolveLaunchConfig();

  if (launchConfig.mute) {
    audio.source.setMuted(true);
  }

  if (launchConfig.debug) {
    window.__cybernoetica_debug_enabled = true;
  }

  if (launchConfig.showLog) {
    const logModeMap: Record<string, LogDisplayMode> = {
      stream: 'stream',
      floating: 'floating',
      docked: 'fixed',
    };
    ui.openLogDisplay(logModeMap[launchConfig.showLog] ?? 'stream');
  }

  async function startApp(vizType?: string, audioId?: string) {
    // Start rAF early so the loading indicator (if any) renders. switchTo
    // is async now because the selected visualizer may not yet be loaded.
    scene.start();

    if (vizType && getVisualizerTypes().includes(vizType)) {
      await vizManager.switchTo(vizType);
    } else {
      await vizManager.switchRandom();
    }
    updateAppearanceControls();
    const activeType = vizManager.getActiveType();
    ui.setActiveVisualizer(activeType as VisualizerType);
    store.setState({ visualizer: { type: activeType, userParams: {} } });

    const audioTarget = audioId
      ? resolveAudioTarget(audioId, sampleTracks)
      : null;

    if (audioTarget?.type === 'system') {
      void startSystemAudio();
    } else if (audioTarget?.type === 'mic') {
      void startMicrophone();
    } else if (audioTarget?.type === 'track') {
      startWithTrack(audioTarget.url, audioTarget.name);
    } else {
      const track = trackManager.getRandomTrack();
      if (track) startWithTrack(track.url, track.name);
    }
  }

  function startWithTrack(url: string, name: string) {
    playback.dispatch({ type: 'START' });
    trackManager.loadTrack(url)
      .then((loaded) => {
        if (!loaded) return;
        playback.dispatch({ type: 'LOADED' });
        ui.setActiveTrack(name);
        ui.setPlaying(true);
        store.setState({ audio: { trackName: name, source: 'file' } });
      })
      .catch(err => {
        playback.dispatch({ type: 'ERROR', error: (err as Error).message });
        ui.showError(`Failed to load track: ${(err as Error).message}`);
      });
  }

  async function startSystemAudio() {
    try {
      playback.dispatch({ type: 'START' });
      await audio.source.resume();
      await audio.source.useSystemAudio();
      playback.dispatch({ type: 'LOADED' });
      ui.setActiveTrack('System Audio');
      ui.setPlaying(true);
      store.setState({ audio: { trackName: 'System Audio', source: 'system' } });
    } catch (err) {
      playback.dispatch({ type: 'ERROR', error: (err as Error).message });
      ui.showError(`System audio capture failed: ${(err as Error).message}`);
    }
  }

  async function startMicrophone() {
    try {
      playback.dispatch({ type: 'START' });
      await audio.source.resume();
      await audio.source.useMicrophone();
      playback.dispatch({ type: 'LOADED' });
      ui.setActiveTrack('Microphone');
      ui.setPlaying(true);
      store.setState({ audio: { trackName: 'Microphone', source: 'mic' } });
    } catch (err) {
      playback.dispatch({ type: 'ERROR', error: (err as Error).message });
      ui.showError(`Microphone access denied: ${(err as Error).message}`);
    }
  }

  if (launchConfig.autoStart) {
    void startApp(launchConfig.visualizer, launchConfig.audioSource);
  } else {
    ui.onStart(() => { void startApp(); });
  }

  ui.onPause(() => {
    if (!playback.canDispatch('PAUSE')) return;
    playback.dispatch({ type: 'PAUSE' });
    audio.source.suspend();
    ui.setPlaying(false);
  });

  ui.onResume(() => {
    if (!playback.canDispatch('RESUME')) return;
    playback.dispatch({ type: 'RESUME' });
    audio.source.resume();
    ui.setPlaying(true);
  });

  ui.onVisualizerChange((type) => {
    void vizManager.switchTo(type).then(() => {
      updateAppearanceControls();
      ui.setActiveVisualizer(type);
      ui.updateKeyboardShortcuts();
      store.setState({ visualizer: { type, userParams: {} } });
    });
  });

  ui.onRandomVisualizer(() => {
    void vizManager.switchRandom(vizManager.getActiveType()).then(() => {
      updateAppearanceControls();
      const type = vizManager.getActiveType();
      ui.setActiveVisualizer(type as VisualizerType);
      ui.updateKeyboardShortcuts();
      store.setState({ visualizer: { type, userParams: {} } });
    });
  });

  ui.onResetVisualizer(() => {
    const type = vizManager.getActiveType();
    if (type) {
      void vizManager.switchTo(type).then(() => updateAppearanceControls());
    }
  });

  ui.onTrackSelect((url, name) => {
    loadAndPlayTrack(url, name);
  });

  ui.onRandomTrack(() => {
    const track = trackManager.getRandomTrack();
    if (track) loadAndPlayTrack(track.url, track.name);
  });

  ui.onFileSelect(async (file) => {
    try {
      const wasPlaying = playback.isPlaying || playback.isPaused;
      if (wasPlaying) {
        playback.dispatch({ type: 'SWITCH_SOURCE', source: 'file' });
      } else if (playback.canDispatch('START')) {
        playback.dispatch({ type: 'START' });
      }
      await audio.source.resume();
      await audio.source.loadFile(file);
      if (wasPlaying) {
        playback.dispatch({ type: 'SOURCE_READY' });
      } else {
        playback.dispatch({ type: 'LOADED' });
      }
      const name = file.name.replace(/\.[^.]+$/, '');
      ui.setActiveTrack(name);
      ui.setPlaying(true);
      store.setState({ audio: { trackName: name, source: 'file' } });
    } catch (err) {
      playback.dispatch({ type: 'ERROR', error: (err as Error).message });
      ui.showError(`Failed to load audio: ${(err as Error).message}`);
    }
  });

  ui.onMicClick(async () => {
    try {
      const canSwitch = playback.canDispatch('SWITCH_SOURCE');
      if (canSwitch) {
        playback.dispatch({ type: 'SWITCH_SOURCE', source: 'mic' });
      } else if (playback.canDispatch('START')) {
        playback.dispatch({ type: 'START' });
      }
      await audio.source.resume();
      await audio.source.useMicrophone();
      if (canSwitch) {
        playback.dispatch({ type: 'SOURCE_READY' });
      } else {
        playback.dispatch({ type: 'LOADED' });
      }
      ui.setActiveTrack('Microphone');
      ui.setPlaying(true);
      store.setState({ audio: { trackName: 'Microphone', source: 'mic' } });
    } catch (err) {
      playback.dispatch({ type: 'ERROR', error: (err as Error).message });
      ui.showError(`Microphone access denied: ${(err as Error).message}`);
    }
  });

  ui.onAutoPlayChange((enabled, shuffle) => {
    trackManager.setAutoPlay(enabled, shuffle);
    store.setState({ ui: { autoPlay: enabled, shuffle } });
  });

  ui.onSystemAudio(async () => {
    try {
      const canSwitch = playback.canDispatch('SWITCH_SOURCE');
      if (canSwitch) {
        playback.dispatch({ type: 'SWITCH_SOURCE', source: 'system' });
      } else if (playback.canDispatch('START')) {
        playback.dispatch({ type: 'START' });
      }
      await audio.source.resume();
      await audio.source.useSystemAudio();
      if (canSwitch) {
        playback.dispatch({ type: 'SOURCE_READY' });
      } else {
        playback.dispatch({ type: 'LOADED' });
      }
      ui.setActiveTrack('System Audio');
      ui.setPlaying(true);
      store.setState({ audio: { trackName: 'System Audio', source: 'system' } });
    } catch (err) {
      playback.dispatch({ type: 'ERROR', error: (err as Error).message });
      ui.showError(`System audio capture failed: ${(err as Error).message}`);
    }
  });

  window.addEventListener('resize', () => {
    const w = window.innerWidth;
    const h = window.innerHeight;
    scene.resize(w, h);
    vizManager.resize(w, h);
  });

  // Render loop. Frame cadence is owned by QualityManager — it decides when to
  // skip frames (60 Hz cap, auto governor stepping). The gate below short-circuits
  // both the JS tick and the GPU render in sync, which the old `powerSaver` knob
  // failed to do (it skipped tick but still re-rendered every rAF).
  let pauseFade = 1.0;
  let lastRenderMs = performance.now();
  let frameCount = 0;
  let fps = 0;
  let fpsTimer = performance.now();
  let shouldRenderThisFrame = false;

  // Legacy compat — powerSaver now just toggles between auto and performance tier.
  window.__cybernoetica!.powerSaver = false;
  window.__cybernoetica!.setPowerSaver = (enabled: boolean) => {
    window.__cybernoetica!.powerSaver = enabled;
    quality.setMode(enabled ? 'performance' : 'auto');
  };

  scene.setFrameGate(() => shouldRenderThisFrame);

  scene.onRender(() => {
    const now = performance.now();
    shouldRenderThisFrame = quality.tick(now);
    if (!shouldRenderThisFrame) return;

    frameCount++;
    if (now - fpsTimer >= 1000) {
      fps = frameCount;
      frameCount = 0;
      fpsTimer = now;
    }
    const frameTime = now - lastRenderMs;
    lastRenderMs = now;

    if (playback.isPlaying) {
      audio.pushFrame();
      pauseFade = Math.min(1.0, pauseFade + 0.02);
    } else {
      pauseFade = Math.max(0.0, pauseFade - 0.008);
      audio.pushSilent(pauseFade * 0.05);
    }
    vizManager.tick();

    if (frameCount % 6 === 0) {
      const snap = quality.getDebugSnapshot();
      window.__cybernoetica_debug = {
        fps, frameTime: Math.round(frameTime * 10) / 10,
        vizType: vizManager.getActiveType(),
        playbackState: playback.state,
        qualityTier: snap.tier,
        qualityMode: snap.mode,
      };
    }
  });
}
