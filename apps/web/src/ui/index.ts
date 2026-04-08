import { el } from './components.js';
import { setButtonActive } from './components.js';
import {
  FONT, GLASS_BG, GLASS_BLUR, GLASS_BORDER,
  TEXT_PRIMARY, TEXT_SECONDARY,
  DEFAULT_SETTINGS,
} from './styles.js';
import type { AppSettings } from './styles.js';
import { createStartScreen } from './start-screen.js';
import { createControlBar } from './control-bar.js';
import { createFadeManager } from './fade-manager.js';
import { renderVisualPanel } from './panels/visual-panel.js';
import { listVisualizers } from '@cybernoetica/renderer';
import { renderSoundPanel } from './panels/sound-panel.js';
import { renderControlPanel } from './panels/control-panel.js';
import { getSetting } from '../settings-loader.js';
import { groupTracksByFolder } from '../utils/track-display.js';
import { installLogInterceptor, createLogDisplay, type LogDisplay, type LogDisplayMode } from './log-display.js';
import { createKeyboardOverlay, getBaseShortcuts, getVisualizerShortcuts, type KeyboardOverlayAPI } from './keyboard-overlay.js';

export type VisualizerType = string;

export type { AppSettings } from './styles.js';

export interface UIControls {
  onStart: (handler: () => void) => void;
  onPause: (handler: () => void) => void;
  onResume: (handler: () => void) => void;
  onVisualizerChange: (handler: (type: string) => void) => void;
  onRandomVisualizer: (handler: () => void) => void;
  onTrackSelect: (handler: (url: string, name: string) => void) => void;
  onRandomTrack: (handler: () => void) => void;
  onFileSelect: (handler: (file: File) => void) => void;
  onFolderSelect: (handler: (files: FileList) => void) => void;
  onMicClick: (handler: () => void) => void;
  onSystemAudio: (handler: () => void) => void;
  onAutoPlayChange: (handler: (enabled: boolean, shuffle: boolean) => void) => void;
  onSettingsChange: (handler: (settings: AppSettings) => void) => void;
  setAppearanceRenderer: (renderer: ((container: HTMLElement) => void) | null) => void;
  setViewStateAccessors: (accessors: {
    getViewState: () => Record<string, number>;
    setViewState: (partial: Record<string, number>) => void;
    onResetView: () => void;
  } | null) => void;
  showError: (message: string) => void;
  setPlaying: (playing: boolean) => void;
  setActiveVisualizer: (type: string) => void;
  setActiveTrack: (name: string) => void;
  setSampleTracks: (tracks: string[]) => void;
  openLogDisplay: (mode: LogDisplayMode) => void;
  closeLogDisplay: () => void;
  setKeyboardOverlayVisible: (visible: boolean) => void;
  updateKeyboardShortcuts: () => void;
  onResetVisualizer: (handler: () => void) => void;
  destroy: () => void;
}

export function createUI(): UIControls {
  installLogInterceptor();

  const settings = { ...DEFAULT_SETTINGS };
  let sampleTracks: string[] = [];
  let activeTrackName = '';
  let isPlaying = false;
  let activePanel: 'visual' | 'sound' | 'control' | null = null;
  let currentVizType = 'orbital';
  let autoPlay = true;
  let shuffleMode = true;
  let trackListExpanded = false;
  const expandedFolders = new Set<string>();
  let foldersInitialized = false;
  let standaloneLogDisplay: LogDisplay | null = null;
  let resetVisualizerHandler: (() => void) | null = null;

  // Handlers
  let pauseHandler: (() => void) | null = null;
  let resumeHandler: (() => void) | null = null;
  let vizChangeHandler: ((type: string) => void) | null = null;
  let randomVizHandler: (() => void) | null = null;
  let trackSelectHandler: ((url: string, name: string) => void) | null = null;
  let randomTrackHandler: (() => void) | null = null;
  let fileSelectHandler: ((file: File) => void) | null = null;
  let micClickHandler: (() => void) | null = null;
  let systemAudioHandler: (() => void) | null = null;
  let folderSelectHandler: ((files: FileList) => void) | null = null;
  let autoPlayHandler: ((enabled: boolean, shuffle: boolean) => void) | null = null;
  let settingsChangeHandler: ((s: AppSettings) => void) | null = null;
  let appearanceRenderer: ((container: HTMLElement) => void) | null = null;
  let viewStateAccessors: {
    getViewState: () => Record<string, number>;
    setViewState: (partial: Record<string, number>) => void;
    onResetView: () => void;
  } | null = null;
  let debugCleanup: (() => void) | null = null;
  let energyCleanup: (() => void) | null = null;

  // Hidden file input
  const fileInput = el('input', { display: 'none' }, { type: 'file', accept: 'audio/*' });
  document.body.appendChild(fileInput);
  fileInput.addEventListener('change', () => {
    if (fileInput.files && fileInput.files[0] && fileSelectHandler) {
      fileSelectHandler(fileInput.files[0]);
      fileInput.value = '';
    }
  });

  // Title
  const appTitle = getSetting('app_title', 'Cybernoetica');
  const title = el('div', {
    position: 'fixed', top: '24px', left: '50%', transform: 'translateX(-50%)',
    color: TEXT_SECONDARY, fontFamily: FONT, fontSize: '17px', fontWeight: '300',
    letterSpacing: '0.3em', textTransform: 'uppercase',
    pointerEvents: 'none', userSelect: 'none', zIndex: '100',
    transition: 'opacity 0.5s ease',
  });
  title.textContent = appTitle;
  document.title = appTitle;
  document.body.appendChild(title);

  // Interactivity hint (below title)
  const interactivityHint = el('div', {
    position: 'fixed', top: '52px', left: '50%', transform: 'translateX(-50%)',
    color: TEXT_SECONDARY, fontFamily: FONT, fontSize: '11px', fontWeight: '300',
    letterSpacing: '0.1em',
    pointerEvents: 'none', userSelect: 'none', zIndex: '100',
    transition: 'opacity 0.6s ease',
    opacity: '0',
  });
  document.body.appendChild(interactivityHint);
  let interactivityHintTimer: ReturnType<typeof setTimeout> | null = null;
  let showInteractivityHints = true;

  function showInteractivityHintText(text: string) {
    if (!showInteractivityHints || !text) {
      interactivityHint.style.opacity = '0';
      return;
    }
    interactivityHint.textContent = text;
    interactivityHint.style.opacity = '0.7';
    if (interactivityHintTimer) clearTimeout(interactivityHintTimer);
    interactivityHintTimer = setTimeout(() => {
      interactivityHint.style.opacity = '0';
    }, 4000);
  }

  document.addEventListener('mousemove', () => {
    if (interactivityHint.textContent && showInteractivityHints) {
      interactivityHint.style.opacity = '0.5';
      if (interactivityHintTimer) clearTimeout(interactivityHintTimer);
      interactivityHintTimer = setTimeout(() => {
        interactivityHint.style.opacity = '0';
      }, 3000);
    }
  });

  // Start screen
  const startScreen = createStartScreen();

  // Control bar
  const cbar = createControlBar();

  // Panel container
  const panelBackdrop = el('div', {
    position: 'fixed', inset: '0', zIndex: '90', display: 'none',
  });
  document.body.appendChild(panelBackdrop);

  const panel = el('div', {
    position: 'fixed', bottom: '100px', left: '50%',
    transform: 'translateX(-50%) translateY(20px)',
    minWidth: '320px', maxWidth: '440px', maxHeight: '55vh', overflowY: 'auto',
    padding: '20px 24px',
    background: GLASS_BG, backdropFilter: GLASS_BLUR, WebkitBackdropFilter: GLASS_BLUR,
    border: `1px solid ${GLASS_BORDER}`, borderRadius: '20px',
    zIndex: '95', display: 'none', opacity: '0',
    transition: 'opacity 0.3s ease, transform 0.3s ease, bottom 0.3s ease',
    fontFamily: FONT, color: TEXT_PRIMARY,
  });
  document.body.appendChild(panel);

  // ── Vertical Layout Coordinator ─────────────────────────────────
  // Stacks bottom-up: fixed log -> keyboard overlay -> control bar -> panel/stream
  const LAYOUT_GAP = 6;
  const KEYBOARD_BAR_HEIGHT = 30;
  const CONTROL_BAR_HEIGHT = 54;

  let fixedLogHeight = 0;
  let keyOverlay: KeyboardOverlayAPI | null = null;

  function updateBottomLayout() {
    let cursor = LAYOUT_GAP;

    if (fixedLogHeight > 0) {
      cursor = fixedLogHeight + LAYOUT_GAP;
    }

    const kbBottom = cursor;
    if (keyOverlay) {
      keyOverlay.element.style.bottom = `${kbBottom}px`;
    }
    const kbVisible = keyOverlay?.isVisible() ?? false;
    cursor = kbVisible ? kbBottom + KEYBOARD_BAR_HEIGHT + LAYOUT_GAP : kbBottom;

    cbar.bar.style.bottom = `${cursor}px`;
    cursor += CONTROL_BAR_HEIGHT + LAYOUT_GAP;

    panel.style.bottom = `${cursor}px`;

    const streamEl = document.querySelector('[data-log-stream]') as HTMLElement | null;
    if (streamEl) streamEl.style.bottom = `${cursor}px`;
  }

  // Error display
  const errorEl = el('div', {
    position: 'fixed', top: '60px', left: '50%', transform: 'translateX(-50%)',
    padding: '10px 20px', background: 'rgba(220, 50, 50, 0.85)',
    backdropFilter: 'blur(8px)', WebkitBackdropFilter: 'blur(8px)',
    color: 'white', fontFamily: FONT, fontSize: '13px', borderRadius: '10px',
    display: 'none', zIndex: '300', maxWidth: '400px', textAlign: 'center',
  });
  document.body.appendChild(errorEl);
  let errorTimer: ReturnType<typeof setTimeout> | null = null;

  // Fade manager
  const fade = createFadeManager({
    controlBar: cbar.bar,
    panel,
    title,
    getActivePanel: () => activePanel,
    getIsPlaying: () => isPlaying,
    getFadeDelay: () => settings.menuFadeDelay,
  });

  // Panel open/close
  function closePanel() {
    activePanel = null;
    setButtonActive(cbar.visualBtn, false);
    setButtonActive(cbar.soundBtn, false);
    setButtonActive(cbar.controlBtn, false);
    panel.style.opacity = '0';
    panel.style.transform = 'translateX(-50%) translateY(20px)';
    panelBackdrop.style.display = 'none';
    if (debugCleanup) { debugCleanup(); debugCleanup = null; }
    if (energyCleanup) { energyCleanup(); energyCleanup = null; }
    setTimeout(() => { if (!activePanel) panel.style.display = 'none'; }, 300);
  }

  function openPanel(type: 'visual' | 'sound' | 'control') {
    if (activePanel === type) { closePanel(); return; }
    activePanel = type;
    setButtonActive(cbar.visualBtn, type === 'visual');
    setButtonActive(cbar.soundBtn, type === 'sound');
    setButtonActive(cbar.controlBtn, type === 'control');
    panel.innerHTML = '';

    if (type === 'visual') {
      const vizMeta = listVisualizers().find(v => v.type === currentVizType);
      renderVisualPanel(panel, {
        currentVizType,
        onRandomViz: randomVizHandler,
        onVizChange: vizChangeHandler,
        onClose: closePanel,
        appearanceRenderer,
        viewStateFields: vizMeta?.viewStateFields ?? [],
        getViewState: viewStateAccessors?.getViewState ?? (() => ({})),
        setViewState: viewStateAccessors?.setViewState ?? (() => {}),
        onResetView: viewStateAccessors?.onResetView ?? (() => {}),
      });
    } else if (type === 'sound') {
      if (!foldersInitialized && sampleTracks.length > 0) {
        for (const folder of groupTracksByFolder(sampleTracks).keys()) {
          if (folder) expandedFolders.add(folder);
        }
        foldersInitialized = true;
      }
      renderSoundPanel(panel, {
        activeTrackName, sampleTracks, autoPlay, shuffleMode, trackListExpanded,
        expandedFolders,
        onRandomTrack: randomTrackHandler,
        onSystemAudio: systemAudioHandler,
        onFileClick: () => fileInput.click(),
        onMicClick: micClickHandler,
        onTrackSelect: trackSelectHandler,
        onAutoPlayChange: autoPlayHandler,
        onToggleTrackList() { trackListExpanded = !trackListExpanded; activePanel = null; openPanel('sound'); },
        onToggleFolder(folder: string) {
          if (expandedFolders.has(folder)) expandedFolders.delete(folder);
          else expandedFolders.add(folder);
          activePanel = null; openPanel('sound');
        },
        onClose: closePanel,
      });
    } else {
      renderControlPanel(panel, {
        settings,
        controlBar: cbar.bar,
        onSettingsChange: settingsChangeHandler,
        onResetFade: () => fade.reset(),
        onDebugCleanup: (fn) => { debugCleanup = fn; },
        onEnergyCleanup: (fn) => { energyCleanup = fn; },
        keyboardOverlayVisible: keyOverlay?.isVisible() ?? true,
        onKeyboardOverlayToggle: (visible) => {
          if (!keyOverlay) return;
          if (visible) keyOverlay.show();
          else keyOverlay.hide();
          updateBottomLayout();
        },
      });
    }

    panelBackdrop.style.display = 'block';
    panel.style.display = 'block';
    requestAnimationFrame(() => {
      panel.style.opacity = '1';
      panel.style.transform = 'translateX(-50%) translateY(0)';
    });
    fade.reset();
  }

  panelBackdrop.addEventListener('mousedown', (e) => {
    if (e.target === panelBackdrop) closePanel();
  });

  // Wire button clicks
  cbar.pauseBtn.addEventListener('click', () => {
    if (isPlaying) { if (pauseHandler) pauseHandler(); }
    else { if (resumeHandler) resumeHandler(); }
  });
  cbar.visualBtn.addEventListener('click', (e) => { e.stopPropagation(); openPanel('visual'); });
  cbar.soundBtn.addEventListener('click', (e) => { e.stopPropagation(); openPanel('sound'); });
  cbar.controlBtn.addEventListener('click', (e) => { e.stopPropagation(); openPanel('control'); });

  // Keyboard: Escape closes panel, 'r' resets visualizer
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && activePanel) closePanel();
    if (e.key === 'r' && !e.metaKey && !e.ctrlKey && !e.altKey && e.target === document.body) {
      if (resetVisualizerHandler) resetVisualizerHandler();
    }
  });

  // Detect fixed log panels appearing/disappearing in the DOM
  function recalcFixedLogHeight() {
    const fixedEl = document.querySelector('[data-log-fixed]') as HTMLElement | null;
    if (fixedEl) {
      fixedLogHeight = parseInt(fixedEl.getAttribute('data-log-fixed-height') ?? '160', 10);
    } else {
      fixedLogHeight = 0;
    }
  }

  const layoutObserver = new MutationObserver(() => {
    recalcFixedLogHeight();
    updateBottomLayout();
  });
  layoutObserver.observe(document.body, { childList: true });

  // Initial layout
  updateBottomLayout();

  // Keyboard shortcut overlay
  keyOverlay = createKeyboardOverlay();
  const isDevMode = typeof import.meta !== 'undefined' && !!(import.meta as any).env?.DEV;
  keyOverlay.setShortcuts([
    ...getBaseShortcuts(isDevMode),
    { key: 'r', label: 'Reset', tooltip: 'Reset current visualizer' },
  ]);
  updateBottomLayout();

  return {
    onStart(h) { startScreen.onStart(h); },
    onPause(h) { pauseHandler = h; },
    onResume(h) { resumeHandler = h; },
    onVisualizerChange(h) { vizChangeHandler = h; },
    onRandomVisualizer(h) { randomVizHandler = h; },
    onTrackSelect(h) { trackSelectHandler = h; },
    onRandomTrack(h) { randomTrackHandler = h; },
    onFileSelect(h) { fileSelectHandler = h; },
    onMicClick(h) { micClickHandler = h; },
    onSystemAudio(h) { systemAudioHandler = h; },
    onFolderSelect(h) { folderSelectHandler = h; },
    onAutoPlayChange(h) { autoPlayHandler = h; },
    onSettingsChange(h) { settingsChangeHandler = h; },
    setAppearanceRenderer(r) { appearanceRenderer = r; },
    setViewStateAccessors(a) { viewStateAccessors = a; },

    showError(message: string) {
      errorEl.textContent = message;
      errorEl.style.display = 'block';
      if (errorTimer) clearTimeout(errorTimer);
      errorTimer = setTimeout(() => { errorEl.style.display = 'none'; }, 5000);
    },

    setPlaying(playing: boolean) {
      isPlaying = playing;
      cbar.pauseBtn.textContent = playing ? 'Pause' : 'Resume';
      if (playing) {
        startScreen.hide();
        cbar.show();
        fade.show();
        fade.reset();
      } else {
        fade.show();
      }
    },

    setActiveVisualizer(type: string) {
      currentVizType = type;
      const vizMeta = listVisualizers().find(v => v.type === type);
      if (vizMeta?.interactivity?.description) {
        showInteractivityHintText(vizMeta.interactivity.description);
      } else {
        interactivityHint.style.opacity = '0';
        interactivityHint.textContent = '';
      }
    },
    setActiveTrack(name: string) { activeTrackName = name; },
    setSampleTracks(tracks: string[]) { sampleTracks = tracks; },

    openLogDisplay(mode: LogDisplayMode) {
      if (standaloneLogDisplay) { standaloneLogDisplay.cleanup(); standaloneLogDisplay = null; }
      standaloneLogDisplay = createLogDisplay(mode, 'all');
      recalcFixedLogHeight();
      updateBottomLayout();
    },

    closeLogDisplay() {
      if (standaloneLogDisplay) { standaloneLogDisplay.cleanup(); standaloneLogDisplay = null; }
      fixedLogHeight = 0;
      updateBottomLayout();
    },

    setKeyboardOverlayVisible(visible: boolean) {
      if (!keyOverlay) return;
      if (visible) keyOverlay.show();
      else keyOverlay.hide();
      updateBottomLayout();
    },

    updateKeyboardShortcuts() {
      if (!keyOverlay) return;
      const vizShortcuts = getVisualizerShortcuts(currentVizType);
      keyOverlay.setShortcuts([
        ...getBaseShortcuts(isDevMode),
        { key: 'r', label: 'Reset', tooltip: 'Reset current visualizer' },
        ...vizShortcuts,
      ]);
    },

    onResetVisualizer(h) { resetVisualizerHandler = h; },

    destroy() {
      fade.destroy();
      keyOverlay?.destroy();
      layoutObserver.disconnect();
      if (errorTimer) clearTimeout(errorTimer);
      if (standaloneLogDisplay) { standaloneLogDisplay.cleanup(); standaloneLogDisplay = null; }
      startScreen.element.remove();
      cbar.bar.remove();
      panel.remove();
      panelBackdrop.remove();
      title.remove();
      interactivityHint.remove();
      errorEl.remove();
      fileInput.remove();
    },
  };
}
