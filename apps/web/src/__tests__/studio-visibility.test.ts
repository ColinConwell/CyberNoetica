import { afterEach, expect, it, vi } from 'vitest';
import { createFadeManager } from '../ui/fade-manager.js';
import { createAppStore } from '../store.js';
afterEach(() => {
  vi.useRealTimers();
  document.body.innerHTML = '';
  localStorage.clear();
});
it('pins both control groups, fades together and reveals near a corner launcher', () => {
  vi.useFakeTimers();
  const controlBar = document.createElement('div'),
    panel = document.createElement('div');
  document.body.append(controlBar, panel);
  let pinned = true;
  const fade = createFadeManager({
    controlBar,
    panel,
    getActivePanel: () => null,
    getIsPlaying: () => true,
    getFadeDelay: () => 2,
    getPinned: () => pinned,
  });
  fade.reset();
  vi.advanceTimersByTime(3000);
  expect(fade.isVisible()).toBe(true);
  pinned = false;
  fade.reset();
  vi.advanceTimersByTime(3000);
  const group = document.getElementById('studio-controls')!;
  expect(controlBar.style.opacity).toBe('0');
  expect(group.style.opacity).toBe('0');
  document.dispatchEvent(
    new MouseEvent('mousemove', { clientX: 10, clientY: 10 }),
  );
  expect(group.style.opacity).toBe('1');
  expect(controlBar.style.opacity).toBe('1');
  const button = document.createElement('button');
  group.append(button);
  button.focus();
  vi.advanceTimersByTime(3000);
  expect(fade.isVisible()).toBe(true);
  fade.destroy();
});
it('persists an explicit visibility preference and rejects malformed stored values', () => {
  expect(createAppStore().getState().ui.controlsVisibility).toBe('always');
  const store = createAppStore();
  store.setState({ ui: { controlsVisibility: 'auto' } });
  expect(createAppStore().getState().ui.controlsVisibility).toBe('auto');
  localStorage.setItem(
    'cybernoetica:state',
    JSON.stringify({ ui: { controlsVisibility: 'bad' } }),
  );
  expect(createAppStore().getState().ui.controlsVisibility).toBe('always');
});
