export interface TrackDisplaySettings {
  format?: 'hyphen-to-space' | 'parenthetical' | 'track-number' | 'raw';
  show_folder_name?: boolean;
}

export interface LaunchSettings {
  visualizer?: string;
  audio_source?: string;
  auto_start?: boolean;
  show_log?: 'stream' | 'floating' | 'docked';
  debug?: boolean;
  mute?: boolean;
}

export interface DevSettings {
  app_title?: string;
  track_display?: TrackDisplaySettings;
  ui_theme?: string;
  launch?: LaunchSettings;
}

let _settings: DevSettings = {};
let _loaded = false;

export async function loadDevSettings(): Promise<DevSettings> {
  if (_loaded) return _settings;
  try {
    const res = await fetch('/settings.json');
    if (res.ok) _settings = await res.json();
  } catch { /* no settings file -- use defaults */ }
  _loaded = true;
  return _settings;
}

export function getDevSettings(): DevSettings {
  return _settings;
}

export function getSetting<K extends keyof DevSettings>(
  key: K,
  fallback: NonNullable<DevSettings[K]>,
): NonNullable<DevSettings[K]> {
  return (_settings[key] ?? fallback) as NonNullable<DevSettings[K]>;
}
