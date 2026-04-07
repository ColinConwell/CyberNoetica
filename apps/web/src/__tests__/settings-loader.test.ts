import { describe, it, expect, vi, beforeEach } from 'vitest';

// We need fresh module state per test
let loadDevSettings: typeof import('../settings-loader.js').loadDevSettings;
let getDevSettings: typeof import('../settings-loader.js').getDevSettings;
let getSetting: typeof import('../settings-loader.js').getSetting;

beforeEach(async () => {
  vi.resetModules();
  const mod = await import('../settings-loader.js');
  loadDevSettings = mod.loadDevSettings;
  getDevSettings = mod.getDevSettings;
  getSetting = mod.getSetting;
});

describe('settings-loader', () => {
  it('returns empty settings when fetch fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('not found')));

    const settings = await loadDevSettings();
    expect(settings).toEqual({});
    expect(getDevSettings()).toEqual({});
  });

  it('returns empty settings when fetch returns non-ok', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      json: vi.fn(),
    }));

    const settings = await loadDevSettings();
    expect(settings).toEqual({});
  });

  it('loads settings from a successful fetch', async () => {
    const mockSettings = { app_title: 'Test App', ui_theme: 'minimal' };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue(mockSettings),
    }));

    const settings = await loadDevSettings();
    expect(settings).toEqual(mockSettings);
    expect(getDevSettings()).toEqual(mockSettings);
  });

  it('getSetting returns the value when present', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({ app_title: 'My Title' }),
    }));
    await loadDevSettings();

    expect(getSetting('app_title', 'Default')).toBe('My Title');
  });

  it('getSetting returns fallback when key is missing', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({}),
    }));
    await loadDevSettings();

    expect(getSetting('app_title', 'Cybernoetica')).toBe('Cybernoetica');
  });

  it('getSetting returns fallback when settings not loaded', () => {
    expect(getSetting('app_title', 'Fallback')).toBe('Fallback');
  });
});
