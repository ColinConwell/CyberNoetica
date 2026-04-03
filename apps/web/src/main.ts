import { createApp } from './app.js';

const container = document.getElementById('app')!;
createApp(container).catch((err) => {
  console.error('Failed to initialize CyberNoetica:', err);
  container.textContent = `Error: ${err.message}`;
});
