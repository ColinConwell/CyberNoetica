import { describe, it, expect, vi } from 'vitest';
import {
  matchesControl,
  recordSession,
  restoreVisualizer,
  validateValues,
  handoffMarkdown,
} from '../developer/session.js';
import type { Recording } from '../developer/session.js';
import type { Visualizer } from '@cybernoetica/renderer';

describe('developer handoffs', () => {
  it('finds explicit controls and local semantic concepts without a service', () => {
    expect(matchesControl('brighter', 'Glow intensity')).toBe(true);
    expect(matchesControl('camera', 'View distance')).toBe(true);
    expect(matchesControl('camera bass', 'View distance')).toBe(false);
  });
  it('rejects unknown, read-only and non-finite values before applying anything', () => {
    const fields = [
      { key: 'gain', min: 0, max: 2 },
      { key: 'phase', min: 0, max: 1, readOnly: true },
    ];
    for (const values of [
      { gain: NaN },
      { gain: 3 },
      { unknown: 1 },
      { phase: 0 },
    ])
      expect(() => validateValues(values, fields)).toThrow();
    expect(validateValues({ gain: 1.2 }, fields)).toEqual({ gain: 1.2 });
    const setUserParam = vi.fn();
    const viz = {
      metadata: { type: 'test', params: fields, viewStateFields: [] },
      setUserParam,
      setViewState: vi.fn(),
    } as unknown as Visualizer;
    const recording = {
      schema: 'cybernoetica.session',
      version: 1,
      visualizer: { type: 'test', params: { gain: 1, unknown: 0 }, view: {} },
    } as unknown as Recording;
    expect(() => restoreVisualizer(recording, viz)).toThrow();
    expect(setUserParam).not.toHaveBeenCalled();
  });
  it('captures allowlisted context without URLs, cookies, logs, or credentials', () => {
    const record = recordSession([]);
    expect(record.schema).toBe('cybernoetica.session');
    expect(record).not.toHaveProperty('url');
    expect(record).not.toHaveProperty('store');
    expect(handoffMarkdown(record)).toContain(
      'does not reproduce audio buffers',
    );
  });
});

it('resolves duplicate parameter labels to a unique scoped contract', async () => {
  const { describeTarget } = await import('../developer/target.js');
  const wrapper = document.createElement('div');
  wrapper.innerHTML =
    '<div data-debug-scope="visual-menu"><div data-control-id="param:gain"><input aria-label="Gain"></div></div><div data-debug-scope="visual"><div data-control-id="param:gain"><input aria-label="Gain"></div></div>';
  document.body.append(wrapper);
  const input = wrapper.querySelectorAll<HTMLInputElement>('input')[1];
  const target = describeTarget(input);
  expect(target.strategy).toBe('control-id');
  expect(document.querySelectorAll(target.selector)).toHaveLength(1);
  expect(document.querySelector(target.selector)?.contains(input)).toBe(true);
  wrapper.remove();
});
