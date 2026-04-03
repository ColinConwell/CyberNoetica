export type VisualizerType = 'orbital' | 'mandelbrot' | 'waveform' | 'julia';

export interface AppSettings {
  menuFadeDelay: number;   // seconds before menu auto-fades
  menuOpacity: number;     // 0-1, base opacity of control bar
}

const DEFAULT_SETTINGS: AppSettings = {
  menuFadeDelay: 5,
  menuOpacity: 0.95,
};

export interface UIControls {
  onStart: (handler: () => void) => void;
  onPause: (handler: () => void) => void;
  onResume: (handler: () => void) => void;
  onVisualizerChange: (handler: (type: VisualizerType) => void) => void;
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
  showError: (message: string) => void;
  setPlaying: (playing: boolean) => void;
  setActiveVisualizer: (type: VisualizerType) => void;
  setActiveTrack: (name: string) => void;
  setSampleTracks: (tracks: string[]) => void;
  destroy: () => void;
}

// ── Shared style constants ──────────────────────────────────────────
const FONT = 'system-ui, -apple-system, sans-serif';
const GLASS_BG = 'rgba(8, 8, 16, 0.88)';
const GLASS_BORDER = 'rgba(255, 255, 255, 0.12)';
const GLASS_BLUR = 'blur(20px)';
const TEXT_PRIMARY = 'rgba(255, 255, 255, 0.92)';
const TEXT_SECONDARY = 'rgba(255, 255, 255, 0.5)';
const TEXT_DIM = 'rgba(255, 255, 255, 0.3)';
const ACCENT = 'rgba(140, 160, 255, 0.6)';
const TRANSITION = 'all 0.25s ease';

// ── Helper: create styled element ───────────────────────────────────
function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  styles: Partial<CSSStyleDeclaration>,
  attrs?: Record<string, string>,
): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  Object.assign(e.style, styles);
  if (attrs) for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  return e;
}

function glassButton(label: string, opts: { active?: boolean; accent?: boolean; large?: boolean } = {}): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.textContent = label;
  const isActive = opts.active ?? false;
  const isLarge = opts.large ?? false;
  Object.assign(btn.style, {
    padding: isLarge ? '12px 28px' : '7px 16px',
    background: isActive ? 'rgba(255, 255, 255, 0.18)' : 'rgba(255, 255, 255, 0.06)',
    color: TEXT_PRIMARY,
    border: `1px solid ${isActive ? 'rgba(255, 255, 255, 0.3)' : GLASS_BORDER}`,
    borderRadius: '24px',
    fontFamily: FONT,
    fontSize: isLarge ? '14px' : '11.5px',
    fontWeight: isLarge ? '400' : '350',
    letterSpacing: isLarge ? '0.15em' : '0.06em',
    cursor: 'pointer',
    transition: TRANSITION,
    outline: 'none',
    whiteSpace: 'nowrap',
  });
  if (opts.accent) {
    btn.style.background = 'rgba(140, 160, 255, 0.15)';
    btn.style.borderColor = ACCENT;
  }
  btn.addEventListener('mouseenter', () => {
    btn.style.background = opts.accent
      ? 'rgba(140, 160, 255, 0.25)'
      : 'rgba(255, 255, 255, 0.22)';
    btn.style.borderColor = 'rgba(255, 255, 255, 0.35)';
  });
  btn.addEventListener('mouseleave', () => {
    const a = btn.dataset.active === 'true';
    btn.style.background = opts.accent
      ? 'rgba(140, 160, 255, 0.15)'
      : a ? 'rgba(255, 255, 255, 0.18)' : 'rgba(255, 255, 255, 0.06)';
    btn.style.borderColor = a ? 'rgba(255, 255, 255, 0.3)' : GLASS_BORDER;
  });
  btn.dataset.active = String(isActive);
  return btn;
}

function setButtonActive(btn: HTMLButtonElement, active: boolean) {
  btn.dataset.active = String(active);
  btn.style.background = active ? 'rgba(255, 255, 255, 0.18)' : 'rgba(255, 255, 255, 0.06)';
  btn.style.borderColor = active ? 'rgba(255, 255, 255, 0.3)' : GLASS_BORDER;
}

function sectionLabel(text: string): HTMLDivElement {
  const lbl = el('div', {
    fontSize: '10px',
    fontWeight: '500',
    letterSpacing: '0.2em',
    textTransform: 'uppercase',
    color: TEXT_DIM,
    fontFamily: FONT,
    marginBottom: '10px',
  });
  lbl.textContent = text;
  return lbl;
}

// ── Main UI ─────────────────────────────────────────────────────────
export function createUI(): UIControls {
  const settings = { ...DEFAULT_SETTINGS };
  let sampleTracks: string[] = [];
  let activeTrackName = '';
  let isPlaying = false;
  let activePanel: 'visual' | 'sound' | 'control' | null = null;

  // Handlers
  let startHandler: (() => void) | null = null;
  let pauseHandler: (() => void) | null = null;
  let resumeHandler: (() => void) | null = null;
  let vizChangeHandler: ((type: VisualizerType) => void) | null = null;
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

  // Hidden file input
  const fileInput = el('input', { display: 'none' }, { type: 'file', accept: 'audio/*' });
  document.body.appendChild(fileInput);

  // ── Title ────────────────────────────────────────────────────────
  const title = el('div', {
    position: 'fixed',
    top: '24px',
    left: '50%',
    transform: 'translateX(-50%)',
    color: TEXT_SECONDARY,
    fontFamily: FONT,
    fontSize: '13px',
    fontWeight: '300',
    letterSpacing: '0.35em',
    textTransform: 'uppercase',
    pointerEvents: 'none',
    userSelect: 'none',
    zIndex: '100',
    transition: 'opacity 0.5s ease',
  });
  title.textContent = 'Cybernœtica';
  document.body.appendChild(title);

  // ── Start screen (shown initially) ──────────────────────────────
  const startScreen = el('div', {
    position: 'fixed',
    inset: '0',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: '200',
    transition: 'opacity 0.6s ease',
  });
  const startBtn = glassButton('Start', { large: true, accent: true });
  startBtn.style.letterSpacing = '0.25em';
  startBtn.style.textTransform = 'uppercase';
  // Pulse animation
  startBtn.animate([
    { boxShadow: '0 0 20px rgba(140, 160, 255, 0.15)' },
    { boxShadow: '0 0 40px rgba(140, 160, 255, 0.3)' },
    { boxShadow: '0 0 20px rgba(140, 160, 255, 0.15)' },
  ], { duration: 3000, iterations: Infinity });
  startScreen.appendChild(startBtn);
  document.body.appendChild(startScreen);

  // ── Control bar (hidden until Start) ────────────────────────────
  const controlBar = el('div', {
    position: 'fixed',
    bottom: '32px',
    left: '50%',
    transform: 'translateX(-50%)',
    display: 'none',
    gap: '8px',
    alignItems: 'center',
    padding: '10px 16px',
    background: GLASS_BG,
    backdropFilter: GLASS_BLUR,
    WebkitBackdropFilter: GLASS_BLUR,
    border: `1px solid ${GLASS_BORDER}`,
    borderRadius: '40px',
    zIndex: '100',
    transition: 'opacity 0.4s ease',
    opacity: '1',
  });
  document.body.appendChild(controlBar);

  const pauseBtn = glassButton('Pause');
  const visualBtn = glassButton('Visual');
  const soundBtn = glassButton('Sound');
  const controlBtn = glassButton('Control');

  function makeDivider(): HTMLElement {
    return el('div', {
      width: '1px',
      height: '20px',
      background: 'rgba(255, 255, 255, 0.1)',
      margin: '0 2px',
    });
  }

  controlBar.append(pauseBtn, makeDivider(), visualBtn, soundBtn, makeDivider(), controlBtn);

  // ── Slide-up panel container ────────────────────────────────────
  const panelBackdrop = el('div', {
    position: 'fixed',
    inset: '0',
    zIndex: '90',
    display: 'none',
  });
  document.body.appendChild(panelBackdrop);

  const panel = el('div', {
    position: 'fixed',
    bottom: '80px',
    left: '50%',
    transform: 'translateX(-50%) translateY(20px)',
    minWidth: '320px',
    maxWidth: '440px',
    maxHeight: '55vh',
    overflowY: 'auto',
    padding: '20px 24px',
    background: GLASS_BG,
    backdropFilter: GLASS_BLUR,
    WebkitBackdropFilter: GLASS_BLUR,
    border: `1px solid ${GLASS_BORDER}`,
    borderRadius: '20px',
    zIndex: '95',
    display: 'none',
    opacity: '0',
    transition: 'opacity 0.3s ease, transform 0.3s ease',
    fontFamily: FONT,
    color: TEXT_PRIMARY,
  });
  document.body.appendChild(panel);

  function openPanel(type: 'visual' | 'sound' | 'control') {
    if (activePanel === type) { closePanel(); return; }
    activePanel = type;
    setButtonActive(visualBtn, type === 'visual');
    setButtonActive(soundBtn, type === 'sound');
    setButtonActive(controlBtn, type === 'control');
    panel.innerHTML = '';
    if (type === 'visual') renderVisualPanel();
    else if (type === 'sound') renderSoundPanel();
    else renderControlPanel();
    panelBackdrop.style.display = 'block';
    panel.style.display = 'block';
    requestAnimationFrame(() => {
      panel.style.opacity = '1';
      panel.style.transform = 'translateX(-50%) translateY(0)';
    });
    resetFadeTimer();
  }

  function closePanel() {
    activePanel = null;
    setButtonActive(visualBtn, false);
    setButtonActive(soundBtn, false);
    setButtonActive(controlBtn, false);
    panel.style.opacity = '0';
    panel.style.transform = 'translateX(-50%) translateY(20px)';
    panelBackdrop.style.display = 'none';
    setTimeout(() => { if (!activePanel) panel.style.display = 'none'; }, 300);
  }

  panelBackdrop.addEventListener('mousedown', (e) => {
    if (e.target === panelBackdrop) closePanel();
  });

  // ── Visual panel ────────────────────────────────────────────────
  let currentVizType: VisualizerType = 'orbital';

  function renderVisualPanel() {
    panel.innerHTML = '';
    panel.appendChild(sectionLabel('Visualizer'));

    const fateBtn = glassButton('Let Fate Decide', { accent: true });
    fateBtn.style.width = '100%';
    fateBtn.style.marginBottom = '12px';
    fateBtn.addEventListener('click', () => {
      if (randomVizHandler) randomVizHandler();
      closePanel();
    });
    panel.appendChild(fateBtn);

    const vizOptions: { type: VisualizerType; label: string; desc: string }[] = [
      { type: 'orbital', label: 'Orbital', desc: 'Particle vortex with comet attractors' },
      { type: 'waveform', label: 'Waveform', desc: 'Neon soundwaves flowing through space' },
      { type: 'julia', label: 'Julia Set', desc: 'Shape-shifting fractal morphology' },
      { type: 'mandelbrot', label: 'Mandelbrot', desc: 'Deep zoom into infinite fractal edges' },
    ];

    const grid = el('div', {
      display: 'flex',
      gap: '8px',
      justifyContent: 'center',
      flexWrap: 'wrap',
    });
    for (const opt of vizOptions) {
      const btn = glassButton(opt.label, { active: opt.type === currentVizType });
      btn.title = opt.desc; // hover tooltip
      btn.addEventListener('click', () => {
        currentVizType = opt.type;
        if (vizChangeHandler) vizChangeHandler(opt.type);
        closePanel();
      });
      grid.appendChild(btn);
    }
    panel.appendChild(grid);

    // Appearance controls (per-visualizer)
    const spacer = el('div', { height: '16px' });
    panel.appendChild(spacer);
    panel.appendChild(sectionLabel('Appearance'));
    if (appearanceRenderer) {
      appearanceRenderer(panel);
    } else {
      const placeholder = el('div', { color: TEXT_DIM, fontSize: '12px', padding: '4px 0' });
      placeholder.textContent = 'No controls available for this visualizer';
      panel.appendChild(placeholder);
    }
  }

  // ── Sound panel ─────────────────────────────────────────────────
  let autoPlay = true;
  let shuffleMode = true;
  let trackListExpanded = false;

  function renderSoundPanel() {
    panel.innerHTML = '';

    // Now playing
    if (activeTrackName) {
      const nowPlaying = el('div', {
        fontSize: '11px',
        color: TEXT_SECONDARY,
        marginBottom: '14px',
        padding: '8px 12px',
        background: 'rgba(255,255,255,0.04)',
        borderRadius: '8px',
        textAlign: 'center',
      });
      nowPlaying.textContent = `Now playing: ${activeTrackName}`;
      panel.appendChild(nowPlaying);
    }

    // Let Fate Decide
    panel.appendChild(sectionLabel('Music'));
    const fateBtn = glassButton('Let Fate Decide', { accent: true });
    fateBtn.style.width = '100%';
    fateBtn.style.marginBottom = '14px';
    fateBtn.addEventListener('click', () => {
      if (randomTrackHandler) randomTrackHandler();
      closePanel();
    });
    panel.appendChild(fateBtn);

    // Audio sources — centered button group
    panel.appendChild(sectionLabel('Sources'));
    const sourceRow = el('div', {
      display: 'flex', gap: '8px', justifyContent: 'center', flexWrap: 'wrap', marginBottom: '14px',
    });
    const sysBtn = glassButton('System Audio');
    sysBtn.addEventListener('click', () => { if (systemAudioHandler) systemAudioHandler(); closePanel(); });
    const loadBtn = glassButton('Load Local Audio');
    loadBtn.addEventListener('click', () => { fileInput.click(); closePanel(); });
    const micBtnS = glassButton('Microphone');
    micBtnS.addEventListener('click', () => { if (micClickHandler) micClickHandler(); closePanel(); });

    // Sample tracks toggle
    const sampleToggle = glassButton(`Sample Tracks (${sampleTracks.length})`, { active: trackListExpanded });
    sampleToggle.addEventListener('click', () => {
      trackListExpanded = !trackListExpanded;
      renderSoundPanel(); // re-render to show/hide list
    });

    sourceRow.append(sysBtn, loadBtn, micBtnS, sampleToggle);
    panel.appendChild(sourceRow);

    // Collapsible sample track list
    if (trackListExpanded && sampleTracks.length > 0) {
      const trackList = el('div', {
        maxHeight: '180px',
        overflowY: 'auto',
        marginBottom: '14px',
        padding: '4px 0',
        borderTop: `1px solid ${GLASS_BORDER}`,
        borderBottom: `1px solid ${GLASS_BORDER}`,
      });
      for (const file of sampleTracks) {
        const name = file.split('/').pop()?.replace(/\.[^.]+$/, '') || file;
        const item = el('div', {
          padding: '6px 10px',
          fontSize: '11px',
          color: name === activeTrackName ? TEXT_PRIMARY : TEXT_SECONDARY,
          cursor: 'pointer',
          transition: 'background 0.15s',
          borderRadius: '6px',
          background: name === activeTrackName ? 'rgba(140, 160, 255, 0.1)' : 'transparent',
        });
        item.textContent = name;
        item.addEventListener('mouseenter', () => { item.style.background = 'rgba(255,255,255,0.08)'; });
        item.addEventListener('mouseleave', () => {
          item.style.background = name === activeTrackName ? 'rgba(140, 160, 255, 0.1)' : 'transparent';
        });
        item.addEventListener('click', () => {
          if (trackSelectHandler) trackSelectHandler(`/sample-music/${file}`, name);
          closePanel();
        });
        trackList.appendChild(item);
      }
      panel.appendChild(trackList);
    }

    // Auto-play / shuffle controls
    panel.appendChild(sectionLabel('Playback'));
    const playbackRow = el('div', { display: 'flex', gap: '12px', alignItems: 'center', fontSize: '12px', color: TEXT_SECONDARY });

    const autoLabel = el('label', { display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer' });
    const autoCheck = el('input', { accentColor: ACCENT }, { type: 'checkbox' }) as HTMLInputElement;
    autoCheck.checked = autoPlay;
    autoCheck.addEventListener('change', () => {
      autoPlay = autoCheck.checked;
      if (autoPlayHandler) autoPlayHandler(autoPlay, shuffleMode);
    });
    const autoText = el('span', {});
    autoText.textContent = 'Auto-play';
    autoLabel.append(autoCheck, autoText);

    const shuffLabel = el('label', { display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer' });
    const shuffCheck = el('input', { accentColor: ACCENT }, { type: 'checkbox' }) as HTMLInputElement;
    shuffCheck.checked = shuffleMode;
    shuffCheck.addEventListener('change', () => {
      shuffleMode = shuffCheck.checked;
      if (autoPlayHandler) autoPlayHandler(autoPlay, shuffleMode);
    });
    const shuffText = el('span', {});
    shuffText.textContent = 'Shuffle';
    shuffLabel.append(shuffCheck, shuffText);

    playbackRow.append(autoLabel, shuffLabel);
    panel.appendChild(playbackRow);
  }

  // ── Control panel ───────────────────────────────────────────────
  function renderControlPanel() {
    panel.innerHTML = '';
    panel.appendChild(sectionLabel('Interface'));

    // Menu fade delay
    const fadeRow = el('div', {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginBottom: '14px',
      fontSize: '12px',
      color: TEXT_SECONDARY,
    });
    const fadeLabel = el('span', {});
    fadeLabel.textContent = 'Menu fade delay';
    const fadeValue = el('div', { display: 'flex', alignItems: 'center', gap: '8px' });
    const fadeSlider = el('input', {
      width: '100px',
      accentColor: ACCENT,
    }, { type: 'range', min: '2', max: '30', step: '1', value: String(settings.menuFadeDelay) });
    const fadeNum = el('span', { fontSize: '11px', color: TEXT_DIM, minWidth: '28px' });
    fadeNum.textContent = `${settings.menuFadeDelay}s`;
    fadeSlider.addEventListener('input', () => {
      settings.menuFadeDelay = Number((fadeSlider as HTMLInputElement).value);
      fadeNum.textContent = `${settings.menuFadeDelay}s`;
      if (settingsChangeHandler) settingsChangeHandler(settings);
      resetFadeTimer();
    });
    fadeValue.append(fadeSlider, fadeNum);
    fadeRow.append(fadeLabel, fadeValue);
    panel.appendChild(fadeRow);

    // Menu opacity
    const opacRow = el('div', {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginBottom: '14px',
      fontSize: '12px',
      color: TEXT_SECONDARY,
    });
    const opacLabel = el('span', {});
    opacLabel.textContent = 'Menu opacity';
    const opacValue = el('div', { display: 'flex', alignItems: 'center', gap: '8px' });
    const opacSlider = el('input', {
      width: '100px',
      accentColor: ACCENT,
    }, { type: 'range', min: '50', max: '100', step: '5', value: String(Math.round(settings.menuOpacity * 100)) });
    const opacNum = el('span', { fontSize: '11px', color: TEXT_DIM, minWidth: '28px' });
    opacNum.textContent = `${Math.round(settings.menuOpacity * 100)}%`;
    opacSlider.addEventListener('input', () => {
      settings.menuOpacity = Number((opacSlider as HTMLInputElement).value) / 100;
      opacNum.textContent = `${Math.round(settings.menuOpacity * 100)}%`;
      controlBar.style.background = GLASS_BG.replace('0.88', String(settings.menuOpacity * 0.88 / 0.95));
      if (settingsChangeHandler) settingsChangeHandler(settings);
    });
    opacValue.append(opacSlider, opacNum);
    opacRow.append(opacLabel, opacValue);
    panel.appendChild(opacRow);

    // Keyboard shortcuts info
    panel.appendChild(sectionLabel('Keyboard'));
    const shortcuts = el('div', { fontSize: '12px', color: TEXT_DIM, lineHeight: '1.8' });
    shortcuts.innerHTML = `
      <div><span style="color:${TEXT_SECONDARY}">Space</span> — Toggle controls</div>
      <div><span style="color:${TEXT_SECONDARY}">Escape</span> — Close panel</div>
    `;
    panel.appendChild(shortcuts);

    // Advanced placeholder
    const advSpacer = el('div', { height: '12px' });
    panel.appendChild(advSpacer);
    panel.appendChild(sectionLabel('Advanced'));
    const advPlaceholder = el('div', { color: TEXT_DIM, fontSize: '12px', padding: '4px 0' });
    advPlaceholder.textContent = 'Renderer and audio settings coming soon';
    panel.appendChild(advPlaceholder);
  }

  // ── Error display ───────────────────────────────────────────────
  const errorEl = el('div', {
    position: 'fixed',
    top: '60px',
    left: '50%',
    transform: 'translateX(-50%)',
    padding: '10px 20px',
    background: 'rgba(220, 50, 50, 0.85)',
    backdropFilter: 'blur(8px)',
    WebkitBackdropFilter: 'blur(8px)',
    color: 'white',
    fontFamily: FONT,
    fontSize: '13px',
    borderRadius: '10px',
    display: 'none',
    zIndex: '300',
    maxWidth: '400px',
    textAlign: 'center',
  });
  document.body.appendChild(errorEl);
  let errorTimer: ReturnType<typeof setTimeout> | null = null;

  // ── Auto-fade logic ─────────────────────────────────────────────
  let fadeTimer: ReturnType<typeof setTimeout> | null = null;
  let barVisible = true;

  let titleFades = false; // configurable: whether title fades with controls

  function showBar() {
    if (!barVisible) {
      controlBar.style.opacity = '1';
      controlBar.style.pointerEvents = 'auto';
      if (titleFades) title.style.opacity = '1';
      barVisible = true;
    }
    // Only auto-fade when playing (when paused, bar stays visible)
    if (isPlaying) resetFadeTimer();
  }

  function hideBar() {
    if (activePanel) return; // Don't hide if panel is open
    controlBar.style.opacity = '0';
    controlBar.style.pointerEvents = 'none';
    if (titleFades) title.style.opacity = '0';
    barVisible = false;
  }

  function resetFadeTimer() {
    if (fadeTimer) clearTimeout(fadeTimer);
    fadeTimer = setTimeout(hideBar, settings.menuFadeDelay * 1000);
  }

  // Mouse near bottom of screen or any click → show bar
  document.addEventListener('mousemove', (e) => {
    if (e.clientY > window.innerHeight * 0.82) {
      showBar();
    }
  });
  document.addEventListener('click', () => {
    if (!barVisible && controlBar.style.display === 'flex') showBar();
  });

  // Any key → show bar
  document.addEventListener('keydown', (e) => {
    if (controlBar.style.display === 'flex') showBar();
    if (e.key === 'Escape' && activePanel) {
      closePanel();
    }
    if (e.code === 'Space' && e.target === document.body) {
      e.preventDefault();
      if (barVisible && !activePanel) hideBar();
      else showBar();
    }
  });

  // Hovering the bar resets the timer
  controlBar.addEventListener('mouseenter', () => { if (fadeTimer) clearTimeout(fadeTimer); });
  controlBar.addEventListener('mouseleave', resetFadeTimer);
  panel.addEventListener('mouseenter', () => { if (fadeTimer) clearTimeout(fadeTimer); });
  panel.addEventListener('mouseleave', resetFadeTimer);

  // ── Wire up button clicks ──────────────────────────────────────
  startBtn.addEventListener('click', () => {
    if (startHandler) startHandler();
  });

  pauseBtn.addEventListener('click', () => {
    if (isPlaying) {
      if (pauseHandler) pauseHandler();
    } else {
      if (resumeHandler) resumeHandler();
    }
  });

  visualBtn.addEventListener('click', (e) => { e.stopPropagation(); openPanel('visual'); });
  soundBtn.addEventListener('click', (e) => { e.stopPropagation(); openPanel('sound'); });
  controlBtn.addEventListener('click', (e) => { e.stopPropagation(); openPanel('control'); });

  fileInput.addEventListener('change', () => {
    if (fileInput.files && fileInput.files[0] && fileSelectHandler) {
      fileSelectHandler(fileInput.files[0]);
      fileInput.value = '';
    }
  });

  // ── Public interface ───────────────────────────────────────────
  return {
    onStart(h) { startHandler = h; },
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

    showError(message: string) {
      errorEl.textContent = message;
      errorEl.style.display = 'block';
      if (errorTimer) clearTimeout(errorTimer);
      errorTimer = setTimeout(() => { errorEl.style.display = 'none'; }, 5000);
    },

    setPlaying(playing: boolean) {
      isPlaying = playing;
      pauseBtn.textContent = playing ? 'Pause' : 'Resume';
      if (playing) {
        startScreen.style.opacity = '0';
        startScreen.style.pointerEvents = 'none';
        setTimeout(() => { startScreen.style.display = 'none'; }, 600);
        controlBar.style.display = 'flex';
        controlBar.style.opacity = '1';
        barVisible = true;
        resetFadeTimer();
      } else {
        // Paused state: keep bar visible
        if (fadeTimer) clearTimeout(fadeTimer);
        controlBar.style.opacity = '1';
        controlBar.style.pointerEvents = 'auto';
        barVisible = true;
      }
    },

    setActiveVisualizer(type: VisualizerType) {
      currentVizType = type;
    },

    setActiveTrack(name: string) {
      activeTrackName = name;
    },

    setSampleTracks(tracks: string[]) {
      sampleTracks = tracks;
    },

    destroy() {
      if (fadeTimer) clearTimeout(fadeTimer);
      if (errorTimer) clearTimeout(errorTimer);
      startScreen.remove();
      controlBar.remove();
      panel.remove();
      panelBackdrop.remove();
      title.remove();
      errorEl.remove();
      fileInput.remove();
    },
  };
}
