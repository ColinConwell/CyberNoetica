import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
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

  it('clearScene empties children without a renderer', () => {
    const manager = new SceneManager(800, 600);
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshBasicMaterial({ color: 0xffffff }),
    );
    manager.scene.add(mesh);
    expect(manager.scene.children.length).toBe(1);
    expect(() => manager.clearScene()).not.toThrow();
    expect(manager.scene.children.length).toBe(0);
    expect(manager.perspCamera.position.z).toBe(12);
  });
});
