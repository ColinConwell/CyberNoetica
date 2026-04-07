import { describe, it, expect } from 'vitest';
import {
  formatTrackName,
  formatFolderName,
  groupTracksByFolder,
  trackFileName,
} from '../utils/track-display.js';

describe('formatTrackName', () => {
  it('raw format returns name as-is (without extension)', () => {
    expect(formatTrackName('Sympoetic-Techno-Jazz-001.mp3', 'raw')).toBe('Sympoetic-Techno-Jazz-001');
  });

  it('hyphen-to-space replaces hyphens and keeps number', () => {
    expect(formatTrackName('Sympoetic-Techno-Jazz-001', 'hyphen-to-space')).toBe('Sympoetic Techno Jazz 001');
  });

  it('parenthetical wraps number in parentheses', () => {
    expect(formatTrackName('Sympoetic-Techno-Jazz-001', 'parenthetical')).toBe('Sympoetic Techno Jazz (001)');
  });

  it('track-number uses "Track N" format with parsed integer', () => {
    expect(formatTrackName('Sympoetic-Techno-Jazz-001', 'track-number')).toBe('Sympoetic Techno Jazz - Track 1');
  });

  it('handles names without trailing numbers', () => {
    expect(formatTrackName('Ambient-Groove', 'track-number')).toBe('Ambient Groove');
    expect(formatTrackName('Ambient-Groove', 'parenthetical')).toBe('Ambient Groove');
  });

  it('handles extensions in the input', () => {
    expect(formatTrackName('Track-042.mp3', 'track-number')).toBe('Track - Track 42');
  });

  it('handles underscores', () => {
    expect(formatTrackName('My_Track_03', 'hyphen-to-space')).toBe('My Track 03');
  });
});

describe('formatFolderName', () => {
  it('replaces hyphens with spaces', () => {
    expect(formatFolderName('Sympoetic-Techno-Jazz')).toBe('Sympoetic Techno Jazz');
  });

  it('replaces underscores with spaces', () => {
    expect(formatFolderName('Sympoetic_Robo_Folk')).toBe('Sympoetic Robo Folk');
  });
});

describe('groupTracksByFolder', () => {
  it('groups tracks by folder prefix', () => {
    const tracks = [
      'FolderA/track1.mp3',
      'FolderA/track2.mp3',
      'FolderB/track1.mp3',
    ];
    const groups = groupTracksByFolder(tracks);
    expect(groups.size).toBe(2);
    expect(groups.get('FolderA')).toEqual(['FolderA/track1.mp3', 'FolderA/track2.mp3']);
    expect(groups.get('FolderB')).toEqual(['FolderB/track1.mp3']);
  });

  it('puts tracks without folders under empty string key', () => {
    const tracks = ['track1.mp3', 'track2.mp3'];
    const groups = groupTracksByFolder(tracks);
    expect(groups.get('')).toEqual(['track1.mp3', 'track2.mp3']);
  });
});

describe('trackFileName', () => {
  it('extracts filename without folder and extension', () => {
    expect(trackFileName('Sympoetic-Techno-Jazz/Track-001.mp3')).toBe('Track-001');
  });

  it('handles paths without folders', () => {
    expect(trackFileName('Track-001.mp3')).toBe('Track-001');
  });
});
