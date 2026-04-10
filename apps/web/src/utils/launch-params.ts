import { getDevSettings } from '../settings-loader.js';

export interface LaunchConfig {
  visualizer?: string;
  audioSource?: 'system' | 'mic' | string;
  autoStart: boolean;
  showLog?: 'stream' | 'floating' | 'docked';
  debug?: boolean;
  mute?: boolean;
}

const LOG_MODES = new Set(['stream', 'floating', 'docked']);

/**
 * Build a unified LaunchConfig by merging (in ascending priority):
 *   1. settings.json  launch  block
 *   2. URL search params (?viz=, &audio=, &log=, &autostart, &debug)
 */
export function resolveLaunchConfig(): LaunchConfig {
  const settings = getDevSettings();
  const launch = (settings as any).launch as Record<string, unknown> | undefined;
  const params = new URLSearchParams(window.location.search);

  const vizFromSettings = launch?.visualizer as string | undefined;
  const vizFromUrl = params.get('viz') ?? params.get('visualizer') ?? undefined;
  const visualizer = vizFromUrl ?? vizFromSettings;

  const audioFromSettings = launch?.audio_source as string | undefined;
  const audioFromUrl = params.get('audio') ?? undefined;
  const audioSource = audioFromUrl ?? audioFromSettings;

  const logRaw = params.get('log') ?? (launch?.show_log as string | undefined);
  const showLog = logRaw && LOG_MODES.has(logRaw)
    ? logRaw as LaunchConfig['showLog']
    : undefined;

  const debug = params.has('debug') || (launch?.debug === true) || undefined;
  const mute = params.has('mute') || (launch?.mute === true) || undefined;

  const explicitAutoStart = params.has('autostart')
    || launch?.auto_start === true;

  const autoStart = explicitAutoStart
    || visualizer !== undefined
    || audioSource !== undefined;

  return { visualizer, audioSource, autoStart, showLog, debug, mute };
}

/**
 * Resolve a user-provided audio identifier to an action the app can execute.
 *   - 'system' / 'mic' -> special source types
 *   - anything else    -> matched against the sample track list
 */
export function resolveAudioTarget(
  identifier: string,
  sampleTracks: string[],
): { type: 'system' } | { type: 'mic' } | { type: 'track'; url: string; name: string } | null {
  const lower = identifier.toLowerCase();
  if (lower === 'system') return { type: 'system' };
  if (lower === 'mic' || lower === 'microphone') return { type: 'mic' };

  const match = sampleTracks.find(t => {
    const name = t.split('/').pop()?.replace(/\.[^.]+$/, '') ?? '';
    return t === identifier
      || name.toLowerCase() === lower
      || t.toLowerCase().includes(lower);
  });

  if (match) {
    const name = match.split('/').pop()?.replace(/\.[^.]+$/, '') ?? match;
    return { type: 'track', url: `/sample-music/${match}`, name };
  }

  return null;
}
