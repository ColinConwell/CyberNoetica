import { loadDevSettings } from './settings-loader.js';
import { createApp } from './app.js';
import { Z_INDEX } from './ui/constants.js';

const container = document.getElementById('app')!;

loadDevSettings()
  .then(() => createApp(container))
  .catch((err) => {
    console.error('Failed to initialize CyberNoetica:', err);
    container.textContent = `Error: ${err.message}`;
  });

// A stale open tab can request a lazy chunk removed by a deployment. Give the
// user an explicit recovery action without an automatic reload loop.
window.addEventListener('vite:preloadError', (event) => {
  event.preventDefault();
  if (document.getElementById('release-recovery')) return;
  const prompt = document.createElement('button');
  prompt.id = 'release-recovery';
  prompt.type = 'button';
  prompt.textContent = 'A new version is available. Reload to continue.';
  Object.assign(prompt.style, {
    position: 'fixed',
    top: '20px',
    left: '50%',
    transform: 'translateX(-50%)',
    zIndex: String(Z_INDEX.errorToast),
    padding: '16px',
    background: '#18233d',
    color: '#fff',
    border: '1px solid #9abaff',
    borderRadius: '12px',
  });
  prompt.addEventListener('click', () => location.reload());
  document.body.appendChild(prompt);
  prompt.focus();
});
