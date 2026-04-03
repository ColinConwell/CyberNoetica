export type VisualizerType = 'orbital' | 'mandelbrot';

export interface UIControls {
  onFileSelect: (handler: (file: File) => void) => void;
  onTrackSelect: (handler: (url: string, name: string) => void) => void;
  onMicClick: (handler: () => void) => void;
  onVisualizerChange: (handler: (type: VisualizerType) => void) => void;
  onToggleUI: () => void;
  showError: (message: string) => void;
  setVisualizerType: (type: VisualizerType) => void;
}

export function createUI(): UIControls {
  // Hidden file input
  const fileInput = document.createElement('input');
  fileInput.type = 'file';
  fileInput.accept = 'audio/*';
  fileInput.style.display = 'none';
  document.body.appendChild(fileInput);

  // Title
  const title = document.createElement('div');
  title.textContent = 'CYBERNOETICA';
  Object.assign(title.style, {
    position: 'fixed',
    top: '24px',
    left: '50%',
    transform: 'translateX(-50%)',
    color: 'rgba(255, 255, 255, 0.7)',
    fontFamily: 'system-ui, -apple-system, sans-serif',
    fontSize: '13px',
    fontWeight: '300',
    letterSpacing: '0.35em',
    textTransform: 'uppercase',
    pointerEvents: 'none',
    userSelect: 'none',
    zIndex: '100',
  });
  document.body.appendChild(title);

  // Controls bar
  const controls = document.createElement('div');
  Object.assign(controls.style, {
    position: 'fixed',
    bottom: '32px',
    left: '50%',
    transform: 'translateX(-50%)',
    display: 'flex',
    gap: '8px',
    alignItems: 'center',
    padding: '10px 16px',
    background: 'rgba(255, 255, 255, 0.08)',
    backdropFilter: 'blur(12px)',
    WebkitBackdropFilter: 'blur(12px)',
    border: '1px solid rgba(255, 255, 255, 0.15)',
    borderRadius: '40px',
    zIndex: '100',
  });
  document.body.appendChild(controls);

  function makeButton(label: string, active = false): HTMLButtonElement {
    const btn = document.createElement('button');
    btn.textContent = label;
    const baseStyles = {
      padding: '7px 14px',
      color: 'rgba(255, 255, 255, 0.9)',
      border: '1px solid rgba(255, 255, 255, 0.2)',
      borderRadius: '20px',
      fontFamily: 'system-ui, -apple-system, sans-serif',
      fontSize: '11px',
      fontWeight: '400',
      letterSpacing: '0.06em',
      cursor: 'pointer',
      transition: 'all 0.2s',
      background: active ? 'rgba(255, 255, 255, 0.22)' : 'rgba(255, 255, 255, 0.08)',
    };
    Object.assign(btn.style, baseStyles);
    btn.addEventListener('mouseenter', () => {
      btn.style.background = 'rgba(255, 255, 255, 0.25)';
      btn.style.borderColor = 'rgba(255, 255, 255, 0.4)';
    });
    btn.addEventListener('mouseleave', () => {
      btn.style.background = btn.dataset.active === 'true'
        ? 'rgba(255, 255, 255, 0.22)' : 'rgba(255, 255, 255, 0.08)';
      btn.style.borderColor = 'rgba(255, 255, 255, 0.2)';
    });
    btn.dataset.active = String(active);
    return btn;
  }

  function makeDivider(): HTMLElement {
    const d = document.createElement('div');
    Object.assign(d.style, {
      width: '1px', height: '20px',
      background: 'rgba(255, 255, 255, 0.15)',
      margin: '0 4px',
    });
    return d;
  }

  // Visualizer switcher
  const orbitalBtn = makeButton('Orbital', true);
  const mandelbrotBtn = makeButton('Mandelbrot');
  const vizButtons = [orbitalBtn, mandelbrotBtn];

  function setActiveViz(type: VisualizerType) {
    for (const b of vizButtons) {
      const isActive = (type === 'orbital' && b === orbitalBtn) ||
                       (type === 'mandelbrot' && b === mandelbrotBtn);
      b.dataset.active = String(isActive);
      b.style.background = isActive ? 'rgba(255, 255, 255, 0.22)' : 'rgba(255, 255, 255, 0.08)';
    }
  }

  // Audio controls
  const loadBtn = makeButton('Load Audio');
  const sampleBtn = makeButton('Samples');
  const micBtn = makeButton('Mic');

  controls.appendChild(orbitalBtn);
  controls.appendChild(mandelbrotBtn);
  controls.appendChild(makeDivider());
  controls.appendChild(loadBtn);
  controls.appendChild(sampleBtn);
  controls.appendChild(micBtn);

  // Sample music dropdown
  const dropdown = document.createElement('div');
  Object.assign(dropdown.style, {
    position: 'fixed',
    bottom: '90px',
    left: '50%',
    transform: 'translateX(-50%)',
    maxHeight: '300px',
    overflowY: 'auto',
    minWidth: '280px',
    maxWidth: '400px',
    background: 'rgba(10, 10, 20, 0.92)',
    backdropFilter: 'blur(16px)',
    WebkitBackdropFilter: 'blur(16px)',
    border: '1px solid rgba(255, 255, 255, 0.15)',
    borderRadius: '12px',
    padding: '8px 0',
    zIndex: '150',
    display: 'none',
    fontFamily: 'system-ui, -apple-system, sans-serif',
    fontSize: '12px',
  });
  document.body.appendChild(dropdown);

  let dropdownOpen = false;
  let sampleFiles: string[] = [];
  let trackSelectHandler: ((url: string, name: string) => void) | null = null;

  async function loadSampleList() {
    try {
      const res = await fetch('/sample-music/__list');
      sampleFiles = await res.json();
    } catch {
      sampleFiles = [];
    }
  }

  function renderDropdown() {
    dropdown.innerHTML = '';
    if (sampleFiles.length === 0) {
      const empty = document.createElement('div');
      empty.textContent = 'No sample tracks found';
      Object.assign(empty.style, { padding: '12px 16px', color: 'rgba(255,255,255,0.4)' });
      dropdown.appendChild(empty);
      return;
    }
    for (const file of sampleFiles) {
      const item = document.createElement('div');
      const name = file.split('/').pop()?.replace(/\.[^.]+$/, '') || file;
      item.textContent = name;
      Object.assign(item.style, {
        padding: '8px 16px',
        color: 'rgba(255, 255, 255, 0.8)',
        cursor: 'pointer',
        transition: 'background 0.15s',
        whiteSpace: 'nowrap',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
      });
      item.addEventListener('mouseenter', () => {
        item.style.background = 'rgba(255, 255, 255, 0.1)';
      });
      item.addEventListener('mouseleave', () => {
        item.style.background = 'transparent';
      });
      item.addEventListener('click', () => {
        if (trackSelectHandler) trackSelectHandler(`/sample-music/${file}`, name);
        toggleDropdown();
      });
      dropdown.appendChild(item);
    }
  }

  // Eagerly load sample list
  loadSampleList().then(renderDropdown);

  function toggleDropdown() {
    dropdownOpen = !dropdownOpen;
    dropdown.style.display = dropdownOpen ? 'block' : 'none';
    if (dropdownOpen) renderDropdown();
  }

  sampleBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    toggleDropdown();
  });

  // Close dropdown on click outside (mousedown to avoid race with button click)
  document.addEventListener('mousedown', (e) => {
    if (dropdownOpen && !dropdown.contains(e.target as Node) && e.target !== sampleBtn) {
      dropdownOpen = false;
      dropdown.style.display = 'none';
    }
  });

  // Error display
  const errorEl = document.createElement('div');
  Object.assign(errorEl.style, {
    position: 'fixed',
    bottom: '100px',
    left: '50%',
    transform: 'translateX(-50%)',
    padding: '10px 20px',
    background: 'rgba(220, 50, 50, 0.8)',
    backdropFilter: 'blur(8px)',
    WebkitBackdropFilter: 'blur(8px)',
    color: 'white',
    fontFamily: 'system-ui, -apple-system, sans-serif',
    fontSize: '13px',
    borderRadius: '8px',
    display: 'none',
    zIndex: '200',
    maxWidth: '400px',
    textAlign: 'center',
  });
  document.body.appendChild(errorEl);

  let errorTimer: ReturnType<typeof setTimeout> | null = null;
  let fileSelectHandler: ((file: File) => void) | null = null;
  let micClickHandler: (() => void) | null = null;
  let vizChangeHandler: ((type: VisualizerType) => void) | null = null;

  loadBtn.addEventListener('click', () => fileInput.click());

  fileInput.addEventListener('change', () => {
    if (fileInput.files && fileInput.files[0] && fileSelectHandler) {
      fileSelectHandler(fileInput.files[0]);
      fileInput.value = '';
    }
  });

  micBtn.addEventListener('click', () => { if (micClickHandler) micClickHandler(); });

  orbitalBtn.addEventListener('click', () => {
    setActiveViz('orbital');
    if (vizChangeHandler) vizChangeHandler('orbital');
  });
  mandelbrotBtn.addEventListener('click', () => {
    setActiveViz('mandelbrot');
    if (vizChangeHandler) vizChangeHandler('mandelbrot');
  });

  const uiElements = [title, controls, dropdown];

  return {
    onFileSelect(handler) { fileSelectHandler = handler; },
    onTrackSelect(handler) { trackSelectHandler = handler; },
    onMicClick(handler) { micClickHandler = handler; },
    onVisualizerChange(handler) { vizChangeHandler = handler; },
    onToggleUI() {
      const hidden = title.style.display === 'none';
      for (const el of uiElements) el.style.display = hidden ? '' : 'none';
      if (!hidden) { dropdownOpen = false; dropdown.style.display = 'none'; }
    },
    showError(message: string) {
      errorEl.textContent = message;
      errorEl.style.display = 'block';
      if (errorTimer !== null) clearTimeout(errorTimer);
      errorTimer = setTimeout(() => { errorEl.style.display = 'none'; errorTimer = null; }, 5000);
    },
    setVisualizerType: setActiveViz,
  };
}
