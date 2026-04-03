export const FONT = 'system-ui, -apple-system, sans-serif';
export const GLASS_BG = 'rgba(8, 8, 16, 0.88)';
export const GLASS_BORDER = 'rgba(255, 255, 255, 0.12)';
export const GLASS_BLUR = 'blur(20px)';
export const TEXT_PRIMARY = 'rgba(255, 255, 255, 0.92)';
export const TEXT_SECONDARY = 'rgba(255, 255, 255, 0.5)';
export const TEXT_DIM = 'rgba(255, 255, 255, 0.3)';
export const ACCENT = 'rgba(140, 160, 255, 0.6)';
export const TRANSITION = 'all 0.25s ease';

export interface AppSettings {
  menuFadeDelay: number;
  menuOpacity: number;
}

export const DEFAULT_SETTINGS: AppSettings = {
  menuFadeDelay: 5,
  menuOpacity: 0.95,
};
