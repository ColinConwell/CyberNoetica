import { MessageBus } from '@cybernoetica/core';
import { SceneManager, getVisualizerTypes } from '@cybernoetica/renderer';
import { createUI } from './ui/index.js';
import type { VisualizerType } from './ui/index.js';
import type { LogDisplayMode } from './ui/log-display.js';
import { paramSlider } from './ui/components.js';
import { AudioPipeline } from './managers/audio-pipeline.js';
import { SourceController } from './managers/source-controller.js';
import { TrackManager } from './managers/track-manager.js';
import { VisualizerManager } from './managers/visualizer-manager.js';
import { PlaybackStateMachine } from './managers/playback-state.js';
import { QualityManager } from './managers/quality-manager.js';
import { createAppStore } from './store.js';
import type { QualityMode } from './store.js';
import {
  resolveLaunchConfig,
  resolveAudioTarget,
} from './utils/launch-params.js';
import type { CyberNoeticaGlobals } from './globals.js';
import type { SoundscapeParams } from '@cybernoetica/audio';
import './globals.js';

export async function createApp(container: HTMLElement): Promise<void> {
  let disposed = false;
  let launchGeneration = 0;
  let transportGeneration = 0;
  const listeners = new AbortController();
  const cleanups: Array<() => void> = [];
  window.addEventListener(
    'pagehide',
    (event) => {
      if (event.persisted) return;
      disposed = true;
      launchGeneration++;
      transportGeneration++;
      listeners.abort();
      for (const cleanup of cleanups.reverse()) cleanup();
      delete window.__cybernoetica;
      delete window.__cybernoetica_debug;
    },
    { signal: listeners.signal },
  );
  const bus = new MessageBus();
  const store = createAppStore();

  const scene = new SceneManager(
    container.clientWidth || window.innerWidth,
    container.clientHeight || window.innerHeight,
  );
  scene.attach(container);
  cleanups.push(() => scene.dispose());

  window.__cybernoetica = {
    store,
    bus,
    scene,
    powerSaver: false,
    setPowerSaver: () => {},
  } as CyberNoeticaGlobals;

  const audio = new AudioPipeline(bus);
  cleanups.push(() => audio.destroy());
  bus.subscribe<{ backend: 'worklet' | 'main-thread' }>(
    'audio:backend',
    (message) =>
      store.setState({ audio: { backend: message.payload.backend } }),
  );
  await audio.init();
  if (disposed) return;
  store.setState({ audio: { wasm: false, backend: audio.getBackend() } });

  const vizManager = new VisualizerManager(bus, scene);
  cleanups.push(() => vizManager.dispose());
  const trackManager = new TrackManager(audio.source);
  const sampleTracks = await trackManager.fetchSampleTracks();
  if (disposed) return;
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
  vizManager.setResetGovernor(() => quality.resetGovernor());
  const savedQuality = store.getState().ui.quality ?? 'auto';
  quality.setMode(savedQuality);

  const QUALITY_CYCLE: QualityMode[] = [
    'auto',
    'sub-performance',
    'performance',
    'balanced',
    'high',
    'ultra',
  ];
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

  window.addEventListener(
    'keydown',
    (e) => {
      if (e.key === 'q' || e.key === 'Q') {
        if (e.target instanceof HTMLElement) {
          const tag = e.target.tagName;
          if (
            tag === 'INPUT' ||
            tag === 'TEXTAREA' ||
            e.target.isContentEditable
          )
            return;
        }
        window.__cybernoetica!.quality!.cycle();
      }
    },
    { signal: listeners.signal },
  );

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
    await sourceController.select(name, 'file', () =>
      trackManager.loadTrack(url),
    );
  }

  function renderParamSliderRow(
    ctr: HTMLElement,
    param: {
      key: string;
      label: string;
      description?: string;
      min: number;
      max: number;
      step: number;
      initial: number;
    },
    viz: { setUserParam(key: string, value: number): void },
  ) {
    ctr.appendChild(
      paramSlider({
        ...param,
        onChange: (key, val) => viz.setUserParam(key, val),
      }),
    );
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
    const appearanceParams = params.filter(
      (p) => (p.category ?? 'appearance') === 'appearance',
    );
    const audioParams = params.filter((p) => p.category === 'audio-mapping');

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
          fontSize: '10px',
          fontWeight: '500',
          letterSpacing: '0.2em',
          textTransform: 'uppercase',
          color: 'rgba(255,255,255,0.3)',
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
  cleanups.push(() => ui.destroy());
  vizManager.onSwitch((type, state, error) => {
    if (state !== 'error') return;
    ui.showControls();
    ui.showError(
      `Visualizer ${type} could not load: ${error?.message ?? 'unknown error'}. Choose another visualizer or reload.`,
    );
  });
  ui.setSampleTracks(sampleTracks);
  ui.onAnalysisGainChange((gain) => audio.source.setAnalysisGain(gain));
  const sourceController = new SourceController(
    audio.source,
    playback,
    (name, type) => {
      ui.setActiveTrack(name);
      ui.setPlaying(true);
      ui.setActiveAudioSource(type);
      store.setState({ audio: { trackName: name, source: type } });
      if (type === 'soundscape')
        ui.setSoundscapeParams(audio.source.getSoundscapeParams());
    },
    (message) => {
      ui.showControls();
      ui.setPlaying(false);
      ui.showError(
        `Audio could not start: ${message}. Choose a source in Sound or retry.`,
      );
    },
  );

  cleanups.push(() => sourceController.cancel());
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
    const generation = ++launchGeneration;
    const sourceRevision = sourceController.revision;
    // Start rAF early so the loading indicator (if any) renders. switchTo
    // is async now because the selected visualizer may not yet be loaded.
    scene.start();

    if (vizType && getVisualizerTypes().includes(vizType)) {
      await vizManager.switchTo(vizType);
    } else {
      await vizManager.switchRandom();
    }
    if (disposed || generation !== launchGeneration) return;
    updateAppearanceControls();
    ui.showControls();
    const activeType = vizManager.getActiveType();
    ui.setActiveVisualizer(activeType as VisualizerType);
    store.setState({ visualizer: { type: activeType, userParams: {} } });

    if (sourceController.revision !== sourceRevision) return;
    const audioTarget = audioId
      ? resolveAudioTarget(audioId, sampleTracks)
      : null;

    if (audioTarget?.type === 'system') {
      void startSystemAudio();
    } else if (audioTarget?.type === 'mic') {
      void startMicrophone();
    } else if (audioTarget?.type === 'soundscape') {
      void startSoundscape();
    } else if (audioTarget?.type === 'track') {
      startWithTrack(audioTarget.url, audioTarget.name);
    } else {
      const track = trackManager.getRandomTrack();
      if (track) startWithTrack(track.url, track.name);
      else
        void sourceController.select('No audio', 'none', () =>
          audio.source.useSilence(),
        );
    }
  }

  function startWithTrack(url: string, name: string) {
    void loadAndPlayTrack(url, name);
  }

  function startSystemAudio() {
    return sourceController.select('System Audio', 'system', () =>
      audio.source.useSystemAudio(),
    );
  }

  function startMicrophone() {
    return sourceController.select('Microphone', 'mic', () =>
      audio.source.useMicrophone(),
    );
  }

  function startSoundscape(params?: Partial<SoundscapeParams>) {
    return sourceController.select('Soundscape Loop', 'soundscape', () => {
      audio.source.startSoundscape(
        params ?? audio.source.getSoundscapeParams(),
      );
      return true;
    });
  }

  ui.onStart(() => {
    void startApp(launchConfig.visualizer, launchConfig.audioSource);
  });
  if (launchConfig.autoStart)
    void startApp(launchConfig.visualizer, launchConfig.audioSource);

  ui.onPause(() => {
    if (!playback.canDispatch('PAUSE')) return;
    playback.dispatch({ type: 'PAUSE' });
    const generation = ++transportGeneration;
    void audio.source.suspend().catch((error) => {
      if (disposed || generation !== transportGeneration) return;
      ui.showError(`Audio could not pause: ${String(error)}`);
    });
    ui.setPlaying(false);
  });

  ui.onResume(() => {
    if (playback.isIdle) {
      void startApp(vizManager.getActiveType());
      return;
    }
    if (!playback.canDispatch('RESUME')) return;
    const generation = ++transportGeneration,
      sourceRevision = sourceController.revision;
    void audio.source
      .resume()
      .then(() => {
        if (
          disposed ||
          generation !== transportGeneration ||
          sourceRevision !== sourceController.revision
        )
          return;
        if (playback.canDispatch('RESUME')) {
          playback.dispatch({ type: 'RESUME' });
          ui.setPlaying(true);
        }
      })
      .catch((error) => {
        if (!disposed && generation === transportGeneration)
          ui.showError(`Audio could not resume: ${String(error)}`);
      });
  });

  ui.onVisualizerChange((type) => {
    void vizManager.switchTo(type).then((viz) => {
      if (!viz || disposed) return;
      updateAppearanceControls();
      ui.setActiveVisualizer(type);
      ui.updateKeyboardShortcuts();
      store.setState({ visualizer: { type, userParams: {} } });
    });
  });

  ui.onRandomVisualizer(() => {
    void vizManager.switchRandom(vizManager.getActiveType()).then((viz) => {
      if (!viz || disposed) return;
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

  ui.onFileSelect((file) => {
    void sourceController.select(
      file.name.replace(/\.[^.]+$/, ''),
      'file',
      () => audio.source.loadFile(file),
    );
  });

  ui.onMicClick(() => {
    void startMicrophone();
  });

  ui.onAutoPlayChange((enabled, shuffle) => {
    trackManager.setAutoPlay(enabled, shuffle);
    store.setState({ ui: { autoPlay: enabled, shuffle } });
  });

  ui.onNoAudio(() => {
    void sourceController.select('No audio', 'none', () =>
      audio.source.useSilence(),
    );
  });
  ui.onSystemAudio(() => {
    void startSystemAudio();
  });

  ui.onSoundscapeLoop(() => {
    void startSoundscape();
  });

  ui.onSoundscapeParamsChange((partial) => {
    audio.source.setSoundscapeParams(partial);
    ui.setSoundscapeParams(audio.source.getSoundscapeParams());
  });

  window.addEventListener(
    'resize',
    () => {
      const w = window.innerWidth;
      const h = window.innerHeight;
      scene.resize(w, h);
      vizManager.resize(w, h);
    },
    { signal: listeners.signal },
  );

  // Render loop. Frame cadence is owned by QualityManager — it decides when to
  // skip frames (60 Hz cap, auto governor stepping). The gate below short-circuits
  // both the JS tick and the GPU render in sync, which the old `powerSaver` knob
  // failed to do (it skipped tick but still re-rendered every rAF).
  let pauseFade = 1.0;
  let lastRenderMs = performance.now();
  let frameCount = 0;
  let fps = 0;
  let fpsTimer = performance.now();

  // Power saver caps both simulation updates and draw submission to 30 Hz.
  window.__cybernoetica!.powerSaver = false;
  window.__cybernoetica!.setPowerSaver = (enabled: boolean) => {
    window.__cybernoetica!.powerSaver = enabled;
    quality.setPowerSaver(enabled);
  };

  scene.setFrameGate(() => {
    const timing = scene.getWorkTiming();
    quality.sampleWork(timing.cpuMs, timing.gpuMs);
    return quality.tick(performance.now());
  });

  scene.onRender(() => {
    const now = performance.now();
    const timing = scene.getWorkTiming();

    frameCount++;
    if (now - fpsTimer >= 1000) {
      fps = frameCount;
      frameCount = 0;
      fpsTimer = now;
    }
    const frameTime = now - lastRenderMs;
    lastRenderMs = now;

    const preferences = store.getState().ui;
    if (playback.isPlaying) {
      audio.pushFrame(preferences.reduceFlashes);
      pauseFade = Math.min(1.0, pauseFade + frameTime * 0.0012);
    } else {
      pauseFade = Math.max(0.0, pauseFade - frameTime * 0.00048);
      audio.pushSilent(pauseFade * 0.05);
    }
    scene.setFlashReduction(preferences.reduceFlashes);
    vizManager.tick(
      Math.min(0.1, frameTime / 1000) * (preferences.reducedMotion ? 0.25 : 1),
    );

    if (frameCount % 6 === 0) {
      const snap = quality.getDebugSnapshot();
      window.__cybernoetica_debug = {
        fps,
        frameTime: Math.round(frameTime * 10) / 10,
        cpuMs: timing.cpuMs,
        gpuMs: timing.gpuMs,
        targetFps: quality.getTargetFps(),
        vizType: vizManager.getActiveType(),
        playbackState: playback.state,
        qualityTier: snap.tier,
        qualityMode: snap.mode,
      };
    }
  });
}
