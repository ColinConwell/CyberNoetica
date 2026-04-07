import { loadDevSettings } from './settings-loader.js';
import { createApp } from './app.js';

const container = document.getElementById('app')!;

loadDevSettings()
  .then(() => createApp(container))
  .catch((err) => {
    console.error('Failed to initialize CyberNoetica:', err);
    container.textContent = `Error: ${err.message}`;
  });
