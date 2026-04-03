export interface UIControls {
  onFileSelect: (handler: (file: File) => void) => void;
  onMicClick: (handler: () => void) => void;
  onToggleUI: () => void;
  showError: (message: string) => void;
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
    gap: '12px',
    padding: '12px 20px',
    background: 'rgba(255, 255, 255, 0.08)',
    backdropFilter: 'blur(12px)',
    WebkitBackdropFilter: 'blur(12px)',
    border: '1px solid rgba(255, 255, 255, 0.15)',
    borderRadius: '40px',
    zIndex: '100',
  });
  document.body.appendChild(controls);

  function makeButton(label: string): HTMLButtonElement {
    const btn = document.createElement('button');
    btn.textContent = label;
    Object.assign(btn.style, {
      padding: '8px 18px',
      background: 'rgba(255, 255, 255, 0.12)',
      color: 'rgba(255, 255, 255, 0.9)',
      border: '1px solid rgba(255, 255, 255, 0.2)',
      borderRadius: '20px',
      fontFamily: 'system-ui, -apple-system, sans-serif',
      fontSize: '12px',
      fontWeight: '400',
      letterSpacing: '0.08em',
      cursor: 'pointer',
      transition: 'background 0.2s, border-color 0.2s',
    });
    btn.addEventListener('mouseenter', () => {
      btn.style.background = 'rgba(255, 255, 255, 0.22)';
      btn.style.borderColor = 'rgba(255, 255, 255, 0.4)';
    });
    btn.addEventListener('mouseleave', () => {
      btn.style.background = 'rgba(255, 255, 255, 0.12)';
      btn.style.borderColor = 'rgba(255, 255, 255, 0.2)';
    });
    return btn;
  }

  const loadBtn = makeButton('Load Audio');
  const micBtn = makeButton('Use Mic');
  controls.appendChild(loadBtn);
  controls.appendChild(micBtn);

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

  loadBtn.addEventListener('click', () => fileInput.click());

  fileInput.addEventListener('change', () => {
    if (fileInput.files && fileInput.files[0] && fileSelectHandler) {
      fileSelectHandler(fileInput.files[0]);
      fileInput.value = '';
    }
  });

  micBtn.addEventListener('click', () => {
    if (micClickHandler) micClickHandler();
  });

  const uiElements = [title, controls];

  function onToggleUI(): void {
    const hidden = title.style.display === 'none';
    for (const el of uiElements) {
      el.style.display = hidden ? '' : 'none';
    }
  }

  function showError(message: string): void {
    errorEl.textContent = message;
    errorEl.style.display = 'block';
    if (errorTimer !== null) clearTimeout(errorTimer);
    errorTimer = setTimeout(() => {
      errorEl.style.display = 'none';
      errorTimer = null;
    }, 5000);
  }

  return {
    onFileSelect(handler) { fileSelectHandler = handler; },
    onMicClick(handler) { micClickHandler = handler; },
    onToggleUI,
    showError,
  };
}
