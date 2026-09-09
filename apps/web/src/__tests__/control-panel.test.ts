import { expect, it, vi } from 'vitest';
import { MessageBus } from '@cybernoetica/core';
import { SceneManager } from '@cybernoetica/renderer';
import { createAppStore } from '../store.js';
import { renderControlPanel } from '../ui/panels/control-panel.js';
import { DEFAULT_SETTINGS } from '../ui/styles.js';

it('retains the motion/power controls, labels sliders and updates the stored preference', () => {
  const store = createAppStore(),
    scene = new SceneManager(320, 480),
    setPowerSaver = vi.fn();
  window.__cybernoetica = {
    store,
    scene,
    bus: new MessageBus(),
    powerSaver: false,
    setPowerSaver,
  };
  const panel = document.createElement('div'),
    cleanups: Array<() => void> = [];
  try {
    renderControlPanel(panel, {
      settings: { ...DEFAULT_SETTINGS },
      controlBar: document.createElement('div'),
      onSettingsChange: null,
      onResetFade: () => {},
      onEnergyCleanup: (cleanup) => cleanups.push(cleanup),
      onDebugCleanup: (cleanup) => cleanups.push(cleanup),
    });
    const switches = Array.from(
      panel.querySelectorAll<HTMLElement>('[role="switch"]'),
    );
    const motion = switches.find(
      (toggle) => toggle.getAttribute('aria-label') === 'Reduce motion',
    )!;
    const saver = switches.find(
      (toggle) => toggle.getAttribute('aria-label') === 'Power Saver (30 FPS)',
    )!;
    expect(motion).toBeDefined();
    expect(saver).toBeDefined();
    const before = store.getState().ui.reducedMotion;
    motion.click();
    expect(store.getState().ui.reducedMotion).toBe(!before);
    saver.click();
    expect(setPowerSaver).toHaveBeenCalledWith(true);
    for (const slider of panel.querySelectorAll('input[type="range"]'))
      expect(slider.getAttribute('aria-label')).toBeTruthy();
  } finally {
    for (const cleanup of cleanups) cleanup();
    delete window.__cybernoetica;
    scene.dispose();
    localStorage.clear();
  }
});
