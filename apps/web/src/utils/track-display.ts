export type TrackDisplayFormat = 'hyphen-to-space' | 'parenthetical' | 'track-number' | 'raw';

/**
 * Extract the trailing numeric suffix from a track filename.
 * e.g. "Sympoetic-Techno-Jazz-001" -> { base: "Sympoetic-Techno-Jazz", num: "001" }
 */
function splitTrackNumber(name: string): { base: string; num: string | null } {
  const match = name.match(/^(.+?)[- _](\d{1,4})$/);
  if (match) return { base: match[1], num: match[2] };
  return { base: name, num: null };
}

/**
 * Format a track filename according to the given format.
 * Input should be the filename without extension.
 */
export function formatTrackName(filename: string, format: TrackDisplayFormat): string {
  const name = filename.replace(/\.[^.]+$/, '');
  if (format === 'raw') return name;

  const { base, num } = splitTrackNumber(name);
  const readable = base.replace(/[-_]/g, ' ');

  if (!num) return readable;

  const trackNum = parseInt(num, 10);
  switch (format) {
    case 'hyphen-to-space':
      return `${readable} ${num}`;
    case 'parenthetical':
      return `${readable} (${num})`;
    case 'track-number':
      return `${readable} - Track ${trackNum}`;
    default:
      return name;
  }
}

/**
 * Format a folder name for display (hyphen/underscore to space, title case).
 * e.g. "Sympoetic-Techno-Jazz" -> "Sympoetic Techno Jazz"
 */
export function formatFolderName(folderName: string): string {
  return folderName.replace(/[-_]/g, ' ');
}

/**
 * Group a list of track paths by their folder.
 * Input: ["FolderA/track1.mp3", "FolderA/track2.mp3", "FolderB/track1.mp3"]
 * Output: Map { "FolderA" -> ["FolderA/track1.mp3", ...], "FolderB" -> [...] }
 * Tracks without a folder are grouped under "".
 */
export function groupTracksByFolder(tracks: string[]): Map<string, string[]> {
  const groups = new Map<string, string[]>();
  for (const track of tracks) {
    const slashIdx = track.indexOf('/');
    const folder = slashIdx >= 0 ? track.slice(0, slashIdx) : '';
    if (!groups.has(folder)) groups.set(folder, []);
    groups.get(folder)!.push(track);
  }
  return groups;
}

/**
 * Extract just the filename (no folder, no extension) from a track path.
 */
export function trackFileName(trackPath: string): string {
  const name = trackPath.split('/').pop() || trackPath;
  return name.replace(/\.[^.]+$/, '');
}
