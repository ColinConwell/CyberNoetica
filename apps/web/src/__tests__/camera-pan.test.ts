import { expect, it } from 'vitest';
import { SceneManager } from '@cybernoetica/renderer';
import { MessageBus } from '@cybernoetica/core';
import { loadVisualizer } from '@cybernoetica/renderer';
import { installCameraPan } from '../managers/camera-pan.js';
it('records/restores camera translation without changing shared metadata or base view fields', async () => {
  const viz = (await loadVisualizer('orbital'))!.create(new MessageBus());
  const original = viz.metadata;
  installCameraPan(viz);
  viz.setViewState({ targetX: 3, targetY: 2, targetZ: -1, distance: 15 });
  expect(viz.getViewState()).toMatchObject({
    targetX: 3,
    targetY: 2,
    targetZ: -1,
    distance: 15,
  });
  expect(original.viewStateFields.some((f) => f.key === 'targetX')).toBe(false);
  expect(viz.metadata.viewport.pan).toBe(true);
  viz.setViewState({ targetX: Infinity, targetY: 500 });
  expect(viz.getViewState()).toMatchObject({ targetX: 3, targetY: 100 });
  const scene = new SceneManager(800, 600);
  scene.setCameraPosition(0, 0, 15, 3, 2, -1);
  expect(scene.perspCamera.position.toArray()).toEqual([3, 2, 14]);
  expect(scene.perspCamera.rotation.y).toBeCloseTo(0);
});
