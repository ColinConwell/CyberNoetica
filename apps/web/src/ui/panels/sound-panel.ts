import { el, glassButton, sectionLabel } from '../components.js';
import { GLASS_BORDER, TEXT_PRIMARY, TEXT_SECONDARY, ACCENT } from '../styles.js';

export interface SoundPanelOpts {
  activeTrackName: string;
  sampleTracks: string[];
  autoPlay: boolean;
  shuffleMode: boolean;
  trackListExpanded: boolean;
  onRandomTrack: (() => void) | null;
  onSystemAudio: (() => void) | null;
  onFileClick: () => void;
  onMicClick: (() => void) | null;
  onTrackSelect: ((url: string, name: string) => void) | null;
  onAutoPlayChange: ((enabled: boolean, shuffle: boolean) => void) | null;
  onToggleTrackList: () => void;
  onClose: () => void;
}

export function renderSoundPanel(panel: HTMLElement, opts: SoundPanelOpts): void {
  panel.innerHTML = '';

  if (opts.activeTrackName) {
    const nowPlaying = el('div', {
      fontSize: '11px', color: TEXT_SECONDARY, marginBottom: '14px',
      padding: '8px 12px', background: 'rgba(255,255,255,0.04)',
      borderRadius: '8px', textAlign: 'center',
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
    display: 'flex', gap: '8px', justifyContent: 'center', flexWrap: 'wrap', marginBottom: '14px',
  });

  const sysBtn = glassButton('System Audio');
  sysBtn.addEventListener('click', () => { if (opts.onSystemAudio) opts.onSystemAudio(); opts.onClose(); });

  const loadBtn = glassButton('Load Local Audio');
  loadBtn.addEventListener('click', () => { opts.onFileClick(); opts.onClose(); });

  const micBtn = glassButton('Microphone');
  micBtn.addEventListener('click', () => { if (opts.onMicClick) opts.onMicClick(); opts.onClose(); });

  const sampleToggle = glassButton(
    `Sample Tracks (${opts.sampleTracks.length})`,
    { active: opts.trackListExpanded },
  );
  sampleToggle.addEventListener('click', () => opts.onToggleTrackList());

  sourceRow.append(sysBtn, loadBtn, micBtn, sampleToggle);
  panel.appendChild(sourceRow);

  if (opts.trackListExpanded && opts.sampleTracks.length > 0) {
    const trackList = el('div', {
      maxHeight: '180px', overflowY: 'auto', marginBottom: '14px',
      padding: '4px 0',
      borderTop: `1px solid ${GLASS_BORDER}`,
      borderBottom: `1px solid ${GLASS_BORDER}`,
    });
    for (const file of opts.sampleTracks) {
      const name = file.split('/').pop()?.replace(/\.[^.]+$/, '') || file;
      const isActive = name === opts.activeTrackName;
      const item = el('div', {
        padding: '6px 10px', fontSize: '11px',
        color: isActive ? TEXT_PRIMARY : TEXT_SECONDARY,
        cursor: 'pointer', transition: 'background 0.15s', borderRadius: '6px',
        background: isActive ? 'rgba(140, 160, 255, 0.1)' : 'transparent',
      });
      item.textContent = name;
      item.addEventListener('mouseenter', () => { item.style.background = 'rgba(255,255,255,0.08)'; });
      item.addEventListener('mouseleave', () => {
        item.style.background = isActive ? 'rgba(140, 160, 255, 0.1)' : 'transparent';
      });
      item.addEventListener('click', () => {
        if (opts.onTrackSelect) opts.onTrackSelect(`/sample-music/${file}`, name);
        opts.onClose();
      });
      trackList.appendChild(item);
    }
    panel.appendChild(trackList);
  }

  panel.appendChild(sectionLabel('Playback'));
  const playbackRow = el('div', {
    display: 'flex', gap: '12px', alignItems: 'center', fontSize: '12px', color: TEXT_SECONDARY,
  });

  let autoPlay = opts.autoPlay;
  let shuffleMode = opts.shuffleMode;

  const autoLabel = el('label', { display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer' });
  const autoCheck = el('input', { accentColor: ACCENT }, { type: 'checkbox' }) as HTMLInputElement;
  autoCheck.checked = autoPlay;
  autoCheck.addEventListener('change', () => {
    autoPlay = autoCheck.checked;
    if (opts.onAutoPlayChange) opts.onAutoPlayChange(autoPlay, shuffleMode);
  });
  const autoText = el('span', {});
  autoText.textContent = 'Auto-play';
  autoLabel.append(autoCheck, autoText);

  const shuffLabel = el('label', { display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer' });
  const shuffCheck = el('input', { accentColor: ACCENT }, { type: 'checkbox' }) as HTMLInputElement;
  shuffCheck.checked = shuffleMode;
  shuffCheck.addEventListener('change', () => {
    shuffleMode = shuffCheck.checked;
    if (opts.onAutoPlayChange) opts.onAutoPlayChange(autoPlay, shuffleMode);
  });
  const shuffText = el('span', {});
  shuffText.textContent = 'Shuffle';
  shuffLabel.append(shuffCheck, shuffText);

  playbackRow.append(autoLabel, shuffLabel);
  panel.appendChild(playbackRow);
}
