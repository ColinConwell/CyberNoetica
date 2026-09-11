import { describe, it, expect } from 'vitest';
import { resolveAudioTarget } from '../utils/launch-params.js';

describe('resolveAudioTarget', () => {
  const tracks = ['album/Pulse.mp3', 'ambient/Drift.wav'];

  it('maps system and mic', () => {
    expect(resolveAudioTarget('system', tracks)).toEqual({ type: 'system' });
    expect(resolveAudioTarget('mic', tracks)).toEqual({ type: 'mic' });
    expect(resolveAudioTarget('microphone', tracks)).toEqual({ type: 'mic' });
  });

  it('maps soundscape and loop aliases', () => {
    expect(resolveAudioTarget('soundscape', tracks)).toEqual({ type: 'soundscape' });
    expect(resolveAudioTarget('loop', tracks)).toEqual({ type: 'soundscape' });
  });

  it('fuzzy-matches sample tracks', () => {
    expect(resolveAudioTarget('pulse', tracks)).toEqual({
      type: 'track',
      url: '/sample-music/album/Pulse.mp3',
      name: 'Pulse',
    });
  });

  it('returns null for unknown identifiers', () => {
    expect(resolveAudioTarget('not-a-source', tracks)).toBeNull();
  });
});
