import { getSetting } from '../settings-loader.js';

// ---------------------------------------------------------------------------
// Theme Definitions
// ---------------------------------------------------------------------------

export interface ThemeValues {
  font: string;
  glassBg: string;
  glassBorder: string;
  glassBlur: string;
  textPrimary: string;
  textSecondary: string;
  textDim: string;
  accent: string;
  transition: string;
}

const THEMES: Record<string, ThemeValues> = {
  'glass-dark': {
    font: 'system-ui, -apple-system, sans-serif',
    glassBg: 'rgba(8, 8, 16, 0.88)',
    glassBorder: 'rgba(255, 255, 255, 0.12)',
    glassBlur: 'blur(20px)',
    textPrimary: 'rgba(255, 255, 255, 0.92)',
    textSecondary: 'rgba(255, 255, 255, 0.5)',
    textDim: 'rgba(255, 255, 255, 0.3)',
    accent: 'rgba(140, 160, 255, 0.6)',
    transition: 'all 0.25s ease',
  },
  'glass-light': {
    font: 'system-ui, -apple-system, sans-serif',
    glassBg: 'rgba(20, 22, 35, 0.75)',
    glassBorder: 'rgba(255, 255, 255, 0.18)',
    glassBlur: 'blur(24px)',
    textPrimary: 'rgba(255, 255, 255, 0.95)',
    textSecondary: 'rgba(255, 255, 255, 0.6)',
    textDim: 'rgba(255, 255, 255, 0.35)',
    accent: 'rgba(160, 180, 255, 0.7)',
    transition: 'all 0.2s ease',
  },
  'minimal': {
    font: 'system-ui, -apple-system, sans-serif',
    glassBg: 'rgba(0, 0, 0, 0.5)',
    glassBorder: 'rgba(255, 255, 255, 0.06)',
    glassBlur: 'blur(12px)',
    textPrimary: 'rgba(255, 255, 255, 0.85)',
    textSecondary: 'rgba(255, 255, 255, 0.4)',
    textDim: 'rgba(255, 255, 255, 0.2)',
    accent: 'rgba(120, 140, 220, 0.5)',
    transition: 'all 0.15s ease',
  },
};

function getActiveTheme(): ThemeValues {
  const themeName = getSetting('ui_theme', 'glass-dark');
  return THEMES[themeName] || THEMES['glass-dark'];
}

// ---------------------------------------------------------------------------
// Exported constants (backward-compatible, theme-aware)
// ---------------------------------------------------------------------------

export const FONT = 'system-ui, -apple-system, sans-serif';

export function theme(): ThemeValues {
  return getActiveTheme();
}

// Static exports for files that import named constants (backward compat)
export const GLASS_BG = 'rgba(8, 8, 16, 0.88)';
export const GLASS_BORDER = 'rgba(255, 255, 255, 0.12)';
export const GLASS_BLUR = 'blur(20px)';
export const TEXT_PRIMARY = 'rgba(255, 255, 255, 0.92)';
export const TEXT_SECONDARY = 'rgba(255, 255, 255, 0.5)';
export const TEXT_DIM = 'rgba(255, 255, 255, 0.3)';
export const ACCENT = 'rgba(140, 160, 255, 0.6)';
export const TRANSITION = 'all 0.25s ease';

// ---------------------------------------------------------------------------
// App Settings
// ---------------------------------------------------------------------------

export interface AppSettings {
  menuFadeDelay: number;
  menuOpacity: number;
}

export const DEFAULT_SETTINGS: AppSettings = {
  menuFadeDelay: 5,
  menuOpacity: 0.95,
};
