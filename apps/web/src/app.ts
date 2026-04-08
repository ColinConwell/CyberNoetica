import { MessageBus } from '@cybernoetica/core';
import { SceneManager, getVisualizerTypes } from '@cybernoetica/renderer';
import { createUI } from './ui/index.js';
import type { VisualizerType } from './ui/index.js';
import { AudioPipeline } from './managers/audio-pipeline.js';
import { TrackManager } from './managers/track-manager.js';
import { VisualizerManager } from './managers/visualizer-manager.js';
import { PlaybackStateMachine } from './managers/playback-state.js';
import { createAppStore } from './store.js';
import { resolveLaunchConfig, resolveAudioTarget } from './utils/launch-params.js';

export async function createApp(container: HTMLElement): Promise<void> {
  const bus = new MessageBus();
  const store = createAppStore();

  (window as any).__cybernoetica = { store, bus, scene };

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
  const playback = new PlaybackStateMachine(bus);

  (window as any).__cybernoetica.playback = playback;
  (window as any).__cybernoetica.vizManager = vizManager;

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

  function renderParamSlider(
    ctr: HTMLElement,
    param: typeof viz extends null ? never : NonNullable<ReturnType<typeof vizManager.getActive>>['metadata']['params'][0],
    viz: NonNullable<ReturnType<typeof vizManager.getActive>>,
  ) {
    const row = document.createElement('div');
    Object.assign(row.style, {
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      marginBottom: '10px', fontSize: '12px', color: 'rgba(255,255,255,0.5)',
    });
    const label = document.createElement('span');
    label.textContent = param.label;
    if (param.description) label.title = param.description;
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
        if (type) vizManager.switchTo(type);
        updateAppearanceControls();
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
        renderParamSlider(ctr, param, viz);
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
          renderParamSlider(ctr, param, viz);
        }
      }
    });
  }

  // UI
  const ui = createUI();
  ui.setSampleTracks(sampleTracks);

  const launchConfig = resolveLaunchConfig();

  function startApp(vizType?: string, audioId?: string) {
    if (vizType && getVisualizerTypes().includes(vizType)) {
      vizManager.switchTo(vizType);
    } else {
      vizManager.switchRandom();
    }
    updateAppearanceControls();
    const activeType = vizManager.getActiveType();
    ui.setActiveVisualizer(activeType as VisualizerType);
    store.setState({ visualizer: { type: activeType, userParams: {} } });

    const audioTarget = audioId
      ? resolveAudioTarget(audioId, sampleTracks)
      : null;

    if (audioTarget?.type === 'system') {
      startSystemAudio();
    } else if (audioTarget?.type === 'mic') {
      startMicrophone();
    } else if (audioTarget?.type === 'track') {
      startWithTrack(audioTarget.url, audioTarget.name);
    } else {
      const track = trackManager.getRandomTrack();
      if (track) startWithTrack(track.url, track.name);
    }

    scene.start();
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
    startApp(launchConfig.visualizer, launchConfig.audioSource);
  } else {
    ui.onStart(() => startApp());
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

  // Render loop
  let pauseFade = 1.0;
  let lastFrameTime = performance.now();
  let frameCount = 0;
  let fps = 0;
  let fpsTimer = performance.now();
  let skipFrame = false;

  (window as any).__cybernoetica.powerSaver = false;
  (window as any).__cybernoetica.setPowerSaver = (enabled: boolean) => {
    (window as any).__cybernoetica.powerSaver = enabled;
  };

  scene.onRender(() => {
    const powerSaver = (window as any).__cybernoetica.powerSaver;
    if (powerSaver) {
      skipFrame = !skipFrame;
      if (skipFrame) return;
    }

    const now = performance.now();
    frameCount++;
    if (now - fpsTimer >= 1000) {
      fps = frameCount;
      frameCount = 0;
      fpsTimer = now;
    }
    const frameTime = now - lastFrameTime;
    lastFrameTime = now;

    if (playback.isPlaying) {
      audio.pushFrame();
      pauseFade = Math.min(1.0, pauseFade + 0.02);
    } else {
      pauseFade = Math.max(0.0, pauseFade - 0.008);
      audio.pushSilent(pauseFade * 0.05);
    }
    vizManager.tick();

    if (frameCount % 6 === 0) {
      (window as any).__cybernoetica_debug = {
        fps, frameTime: Math.round(frameTime * 10) / 10,
        vizType: vizManager.getActiveType(),
        playbackState: playback.state,
      };
    }
  });
}
