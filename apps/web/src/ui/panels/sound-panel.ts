import {
  el,
  glassButton,
  sectionLabel,
  toggleSwitch,
  paramSlider,
} from '../components.js';
import {
  GLASS_BORDER,
  TEXT_PRIMARY,
  TEXT_SECONDARY,
  TEXT_DIM,
} from '../styles.js';
import {
  formatTrackName,
  formatFolderName,
  groupTracksByFolder,
  trackFileName,
} from '../../utils/track-display.js';
import { getSetting } from '../../settings-loader.js';
import type { TrackDisplayFormat } from '../../utils/track-display.js';
import type { AudioSourceType } from '@cybernoetica/audio';
import type { SoundscapeParams } from '@cybernoetica/audio';

export interface SoundPanelOpts {
  analysisGain: number;
  onAnalysisGainChange: (gain: number) => void;
  activeTrackName: string;
  sampleTracks: string[];
  autoPlay: boolean;
  shuffleMode: boolean;
  trackListExpanded: boolean;
  expandedFolders: Set<string>;
  activeSource: AudioSourceType | 'file' | 'none';
  soundscapeParams: SoundscapeParams;
  onRandomTrack: (() => void) | null;
  onNoAudio: (() => void) | null;
  onSystemAudio: (() => void) | null;
  onFileClick: () => void;
  onMicClick: (() => void) | null;
  onSoundscapeLoop: (() => void) | null;
  onSoundscapeParamsChange:
    | ((partial: Partial<SoundscapeParams>) => void)
    | null;
  onTrackSelect: ((url: string, name: string) => void) | null;
  onAutoPlayChange: ((enabled: boolean, shuffle: boolean) => void) | null;
  onToggleTrackList: () => void;
  onToggleFolder: (folder: string) => void;
  onClose: () => void;
}

export function renderSoundPanel(
  panel: HTMLElement,
  opts: SoundPanelOpts,
): void {
  panel.innerHTML = '';

  const trackSettings = getSetting('track_display', {
    format: 'track-number' as const,
    show_folder_name: true,
  });
  const displayFormat: TrackDisplayFormat =
    trackSettings.format ?? 'track-number';
  const showFolders = trackSettings.show_folder_name !== false;
  const loopActive = opts.activeSource === 'soundscape';

  if (opts.activeTrackName) {
    const nowPlaying = el('div', {
      fontSize: '11px',
      color: TEXT_SECONDARY,
      marginBottom: '14px',
      padding: '8px 12px',
      background: 'rgba(255,255,255,0.04)',
      borderRadius: '8px',
      textAlign: 'center',
    });
    nowPlaying.textContent = `Now playing: ${opts.activeTrackName}`;
    panel.appendChild(nowPlaying);
  }

  panel.appendChild(sectionLabel('Music'));
  const fateBtn = glassButton('Let Fate Decide', { accent: true });
  fateBtn.style.width = '100%';
  fateBtn.style.marginBottom = '14px';
  fateBtn.addEventListener('click', () => {
    if (opts.onRandomTrack) opts.onRandomTrack();
    opts.onClose();
  });
  panel.appendChild(fateBtn);

  panel.appendChild(sectionLabel('Sources'));
  const sourceRow = el('div', {
    display: 'flex',
    gap: '8px',
    justifyContent: 'center',
    flexWrap: 'wrap',
    marginBottom: '14px',
  });

  const noneBtn = glassButton('No audio', {
    active: opts.activeSource === 'none',
  });
  noneBtn.addEventListener('click', () => opts.onNoAudio?.());
  const sysBtn = glassButton('System Audio', {
    active: opts.activeSource === 'system',
  });
  sysBtn.addEventListener('click', () => {
    if (opts.onSystemAudio) opts.onSystemAudio();
    opts.onClose();
  });

  const loadBtn = glassButton('Load Local Audio');
  loadBtn.addEventListener('click', () => {
    opts.onFileClick();
    opts.onClose();
  });

  const micBtn = glassButton('Microphone', {
    active: opts.activeSource === 'mic',
  });
  micBtn.addEventListener('click', () => {
    if (opts.onMicClick) opts.onMicClick();
    opts.onClose();
  });

  const loopBtn = glassButton('Soundscape Loop', { active: loopActive });
  loopBtn.addEventListener('click', () => {
    if (opts.onSoundscapeLoop) opts.onSoundscapeLoop();
  });

  const sampleToggle = glassButton(
    `Sample Tracks (${opts.sampleTracks.length})`,
    { active: opts.trackListExpanded },
  );
  sampleToggle.addEventListener('click', () => opts.onToggleTrackList());

  sourceRow.append(sysBtn, loadBtn, micBtn, loopBtn, noneBtn, sampleToggle);
  panel.appendChild(sourceRow);

  panel.appendChild(
    paramSlider({
      key: 'analysisGain',
      label: 'Analysis gain',
      min: 0.25,
      max: 4,
      step: 0.05,
      initial: opts.analysisGain,
      description:
        'Sensitivity of visual responses; speaker volume stays the same. Affects absolute level, not relative band balance.',
      onChange: (_key, value) => opts.onAnalysisGainChange(value),
    }),
  );

  if (loopActive) {
    panel.appendChild(sectionLabel('Loop'));
    panel.appendChild(
      paramSlider({
        key: 'cycleLength',
        label: 'Cycle',
        description: 'Seconds to traverse the full soundscape',
        min: 8,
        max: 60,
        step: 1,
        initial: opts.soundscapeParams.cycleLength,
        onChange: (_key, val) =>
          opts.onSoundscapeParamsChange?.({ cycleLength: val }),
      }),
    );
    panel.appendChild(
      paramSlider({
        key: 'energy',
        label: 'Energy',
        description: 'Overall loudness of the probe',
        min: 0,
        max: 1,
        step: 0.05,
        initial: opts.soundscapeParams.energy,
        onChange: (_key, val) =>
          opts.onSoundscapeParamsChange?.({ energy: val }),
      }),
    );
    panel.appendChild(
      paramSlider({
        key: 'brightness',
        label: 'Brightness',
        description: 'Tilt toward high frequencies',
        min: 0,
        max: 1,
        step: 0.05,
        initial: opts.soundscapeParams.brightness,
        onChange: (_key, val) =>
          opts.onSoundscapeParamsChange?.({ brightness: val }),
      }),
    );
    panel.appendChild(
      paramSlider({
        key: 'beatRate',
        label: 'Beat Rate',
        description: 'Click tempo in BPM',
        min: 40,
        max: 180,
        step: 1,
        initial: opts.soundscapeParams.beatRate,
        onChange: (_key, val) =>
          opts.onSoundscapeParamsChange?.({ beatRate: val }),
      }),
    );
  }

  if (opts.trackListExpanded && opts.sampleTracks.length > 0) {
    const trackList = el('div', {
      maxHeight: '220px',
      overflowY: 'auto',
      marginBottom: '14px',
      padding: '4px 0',
      borderTop: `1px solid ${GLASS_BORDER}`,
      borderBottom: `1px solid ${GLASS_BORDER}`,
    });

    const groups = groupTracksByFolder(opts.sampleTracks);

    for (const [folder, tracks] of groups) {
      const isFolder = showFolders && folder;
      const isFolderExpanded = !isFolder || opts.expandedFolders.has(folder);

      if (isFolder) {
        const chevron = isFolderExpanded ? '\u25BE' : '\u25B8';
        const folderHeader = el('button', {
          fontSize: '10px',
          fontWeight: '500',
          letterSpacing: '0.12em',
          textTransform: 'uppercase',
          color: TEXT_DIM,
          padding: '8px 10px 4px',
          marginTop: '4px',
          cursor: 'pointer',
          transition: 'color 0.2s, background 0.15s',
          borderRadius: '6px',
          display: 'flex',
          alignItems: 'center',
          gap: '6px',
          userSelect: 'none',
        });
        folderHeader.setAttribute('type', 'button');
        folderHeader.setAttribute('aria-expanded', String(isFolderExpanded));
        const chevronEl = el('span', {
          display: 'inline-block',
          transition: 'transform 0.2s ease',
          fontSize: '9px',
          width: '10px',
        });
        chevronEl.textContent = chevron;
        const nameEl = el('span', {});
        nameEl.textContent = `${formatFolderName(folder)} (${tracks.length})`;
        folderHeader.append(chevronEl, nameEl);

        folderHeader.addEventListener('mouseenter', () => {
          folderHeader.style.color = TEXT_SECONDARY;
          folderHeader.style.background = 'rgba(255,255,255,0.04)';
        });
        folderHeader.addEventListener('mouseleave', () => {
          folderHeader.style.color = TEXT_DIM;
          folderHeader.style.background = 'transparent';
        });
        folderHeader.addEventListener('click', () =>
          opts.onToggleFolder(folder),
        );
        trackList.appendChild(folderHeader);
      }

      if (isFolderExpanded) {
        for (const file of tracks) {
          const rawName = trackFileName(file);
          const displayName = formatTrackName(rawName, displayFormat);
          const isActive =
            rawName === opts.activeTrackName ||
            displayName === opts.activeTrackName;
          const item = el('button', {
            width: '100%',
            display: 'block',
            textAlign: 'left',
            border: 'none',
            padding: '6px 10px',
            paddingLeft: isFolder ? '20px' : '10px',
            fontSize: '11px',
            color: isActive ? TEXT_PRIMARY : TEXT_SECONDARY,
            cursor: 'pointer',
            transition: 'background 0.15s',
            borderRadius: '6px',
            background: isActive ? 'rgba(140, 160, 255, 0.1)' : 'transparent',
          });
          item.setAttribute('type', 'button');
          item.setAttribute('aria-pressed', String(isActive));
          item.textContent = displayName;
          item.addEventListener('mouseenter', () => {
            item.style.background = 'rgba(255,255,255,0.08)';
          });
          item.addEventListener('mouseleave', () => {
            item.style.background = isActive
              ? 'rgba(140, 160, 255, 0.1)'
              : 'transparent';
          });
          item.addEventListener('click', () => {
            if (opts.onTrackSelect)
              opts.onTrackSelect(`/sample-music/${file}`, displayName);
            opts.onClose();
          });
          trackList.appendChild(item);
        }
      }
    }
    panel.appendChild(trackList);
  }

  panel.appendChild(sectionLabel('Playback'));
  const playbackRow = el('div', {
    display: 'flex',
    gap: '12px',
    alignItems: 'center',
    fontSize: '12px',
    color: TEXT_SECONDARY,
  });

  let autoPlay = opts.autoPlay;
  let shuffleMode = opts.shuffleMode;

  const autoToggle = toggleSwitch({
    checked: autoPlay,
    label: 'Auto-play',
    onChange(checked) {
      autoPlay = checked;
      if (opts.onAutoPlayChange) opts.onAutoPlayChange(autoPlay, shuffleMode);
    },
  });

  const shuffToggle = toggleSwitch({
    checked: shuffleMode,
    label: 'Shuffle',
    onChange(checked) {
      shuffleMode = checked;
      if (opts.onAutoPlayChange) opts.onAutoPlayChange(autoPlay, shuffleMode);
    },
  });

  playbackRow.append(autoToggle, shuffToggle);
  panel.appendChild(playbackRow);
}
