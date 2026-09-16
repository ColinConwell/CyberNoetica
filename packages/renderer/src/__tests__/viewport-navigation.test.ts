import { expect, it } from 'vitest';
import { dragMode, wheelZoom } from '../viewport-navigation.js';
const caps = { pan: true, zoom: true, orbit: true };
const event = { button: 1, shiftKey: false, ctrlKey: false, altKey: false };
it('maps middle, Shift-middle, Ctrl-middle and Alt-left without consuming sculpt clicks', () => {
  expect(dragMode(event, caps)).toBe('orbit');
  expect(dragMode({ ...event, shiftKey: true }, caps)).toBe('pan');
  expect(dragMode({ ...event, ctrlKey: true }, caps)).toBe('zoom');
  expect(dragMode({ ...event, button: 0, altKey: true }, caps, true)).toBe(
    'orbit',
  );
  expect(dragMode({ ...event, button: 0 }, caps, true)).toBeNull();
  expect(dragMode({ ...event, button: 2 }, caps)).toBeNull();
  expect(dragMode(event, { ...caps, orbit: false })).toBe('pan');
  expect(
    dragMode({ ...event, shiftKey: true }, { ...caps, pan: false }),
  ).toBeNull();
});
it('normalizes wheel units, preserves small pinch deltas and ignores zero movement', () => {
  expect(wheelZoom(1, 1, 600)).toBe(wheelZoom(16, 0, 600));
  expect(wheelZoom(0.1, 2, 600)).toBe(wheelZoom(60, 0, 600));
  expect(wheelZoom(0, 0, 600)).toBe(0);
  expect(Math.abs(wheelZoom(0.5, 0, 600))).toBeLessThan(
    Math.abs(wheelZoom(10, 0, 600)),
  );
  expect(wheelZoom(1e5, 0, 600)).toBe(-0.5);
});
