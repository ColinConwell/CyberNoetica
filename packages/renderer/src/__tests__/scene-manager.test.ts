import { describe, it, expect } from 'vitest';
import { SceneManager } from '../scene-manager.js';

describe('SceneManager', () => {
  it('can be constructed with dimensions', () => {
    const manager = new SceneManager(800, 600);
    expect(manager).toBeDefined();
    expect(manager.width).toBe(800);
    expect(manager.height).toBe(600);
  });

  it('can resize', () => {
    const manager = new SceneManager(800, 600);
    manager.resize(1920, 1080);
    expect(manager.width).toBe(1920);
    expect(manager.height).toBe(1080);
  });
});
