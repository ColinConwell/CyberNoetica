import type { MessageBus } from '@cybernoetica/core';
import type { QualityTier } from '@cybernoetica/renderer';

export type QualityMode = 'auto' | QualityTier;

const TIER_ORDER: QualityTier[] = ['performance', 'balanced', 'high', 'ultra'];

const GOVERNOR_WINDOW = 60;           // frames
const GOVERNOR_STEP_DOWN_MS = 20;     // >20ms avg (below 50 FPS) → step down
const GOVERNOR_STEP_UP_MS = 14;       // <14ms avg (above ~71 FPS) → step up
const GOVERNOR_STEP_DOWN_HOLD_MS = 2000;
const GOVERNOR_STEP_UP_HOLD_MS = 5000;
const GOVERNOR_COOLDOWN_MS = 3000;    // ignore signals right after a change
const TARGET_FRAME_MS = 1000 / 60;    // cap rAF work rate at 60 Hz

export interface QualityManagerOptions {
  bus: MessageBus;
  applyTier: (tier: QualityTier) => void;
  getDebugInfo?: () => { vendor: string; renderer: string } | null;
}

/**
 * Detect a reasonable starting tier from GPU / device signals. Conservative: when
 * uncertain, bias toward balanced rather than high. Apple Silicon and discrete
 * desktop GPUs get high; integrated laptop GPUs and mobile get balanced or
 * performance. The adaptive governor corrects the guess at runtime.
 */
export function detectInitialTier(
  rendererString: string | null,
  opts: { deviceMemory?: number; hwConcurrency?: number; touchOnly?: boolean } = {},
): QualityTier {
  const s = (rendererString ?? '').toLowerCase();

  // Touch-only devices (phones/tablets): performance by default.
  if (opts.touchOnly) return 'performance';

  // Apple Silicon M-series GPUs.
  if (/apple m[0-9]/.test(s)) return 'high';

  // Discrete NVIDIA / AMD with obvious model numbers.
  if (/(rtx|gtx|radeon rx|rx\s?\d{3,}|quadro)/.test(s)) return 'high';

  // Apple pre-Silicon integrated (e.g. "Apple GPU" on older iGPU contexts).
  if (/apple gpu/.test(s)) return 'balanced';

  // Intel HD/UHD/Iris integrated.
  if (/(intel.*(hd|uhd|iris|xe))/.test(s)) return 'balanced';

  // Mobile GPUs.
  if (/(adreno|mali|powervr)/.test(s)) return 'performance';

  // Fall back to device memory / CPU count.
  const mem = opts.deviceMemory ?? 0;
  const cores = opts.hwConcurrency ?? 0;
  if (mem >= 8 && cores >= 8) return 'high';
  if (mem >= 4 || cores >= 4) return 'balanced';
  return 'performance';
}

export class QualityManager {
  private mode: QualityMode = 'auto';
  private currentTier: QualityTier = 'balanced';
  private autoTier: QualityTier = 'balanced';
  private frameTimes: number[] = [];
  private lastFrameAt = 0;
  private slowSinceMs = 0;
  private fastSinceMs = 0;
  private cooldownUntilMs = 0;
  private lastRenderedAt = 0;
  private lastNotifiedTier: QualityTier | null = null;

  constructor(private opts: QualityManagerOptions) {}

  initialize(): void {
    const info = this.opts.getDebugInfo?.() ?? null;
    const touchOnly = typeof window !== 'undefined'
      && 'ontouchstart' in window
      && !window.matchMedia('(hover: hover)').matches;
    this.autoTier = detectInitialTier(info?.renderer ?? null, {
      deviceMemory: (navigator as { deviceMemory?: number }).deviceMemory,
      hwConcurrency: navigator.hardwareConcurrency,
      touchOnly,
    });
    this._applyResolved();
  }

  setMode(mode: QualityMode): void {
    this.mode = mode;
    if (mode !== 'auto') {
      // Manual mode: reset governor state so it doesn't fight user choice.
      this.slowSinceMs = 0;
      this.fastSinceMs = 0;
      this.frameTimes = [];
    }
    this._applyResolved();
  }

  getMode(): QualityMode { return this.mode; }
  getTier(): QualityTier { return this.currentTier; }
  getAutoTier(): QualityTier { return this.autoTier; }

  /**
   * Called once per rAF — decides whether this frame should render, feeds
   * the rolling frame-time window, and adapts the auto tier. Returns true
   * when the caller should proceed with full tick + render.
   */
  tick(now: number): boolean {
    if (this.lastFrameAt === 0) {
      this.lastFrameAt = now;
    }

    // Cap effective frame rate at ~60 Hz. On 120 Hz displays this halves work.
    if (this.lastRenderedAt !== 0 && now - this.lastRenderedAt < TARGET_FRAME_MS - 1) {
      return false;
    }

    const dt = now - this.lastFrameAt;
    this.lastFrameAt = now;
    this.lastRenderedAt = now;

    if (dt > 0 && dt < 500) {
      this.frameTimes.push(dt);
      if (this.frameTimes.length > GOVERNOR_WINDOW) this.frameTimes.shift();
    }

    if (this.mode === 'auto') this._runGovernor(now);
    return true;
  }

  private _runGovernor(now: number): void {
    if (this.frameTimes.length < GOVERNOR_WINDOW) return;
    if (now < this.cooldownUntilMs) return;

    const avg = this.frameTimes.reduce((a, b) => a + b, 0) / this.frameTimes.length;

    if (avg > GOVERNOR_STEP_DOWN_MS) {
      if (this.slowSinceMs === 0) this.slowSinceMs = now;
      this.fastSinceMs = 0;
      if (now - this.slowSinceMs >= GOVERNOR_STEP_DOWN_HOLD_MS) {
        this._stepAutoTier(-1, now);
      }
    } else if (avg < GOVERNOR_STEP_UP_MS) {
      if (this.fastSinceMs === 0) this.fastSinceMs = now;
      this.slowSinceMs = 0;
      if (now - this.fastSinceMs >= GOVERNOR_STEP_UP_HOLD_MS) {
        this._stepAutoTier(+1, now);
      }
    } else {
      this.slowSinceMs = 0;
      this.fastSinceMs = 0;
    }
  }

  private _stepAutoTier(direction: -1 | 1, now: number): void {
    const idx = TIER_ORDER.indexOf(this.autoTier);
    const nextIdx = Math.max(0, Math.min(TIER_ORDER.length - 1, idx + direction));
    if (nextIdx === idx) {
      this.slowSinceMs = 0;
      this.fastSinceMs = 0;
      return;
    }
    // Never auto-step into ultra — opt-in only.
    if (TIER_ORDER[nextIdx] === 'ultra') {
      this.fastSinceMs = 0;
      return;
    }
    this.autoTier = TIER_ORDER[nextIdx];
    this.slowSinceMs = 0;
    this.fastSinceMs = 0;
    this.cooldownUntilMs = now + GOVERNOR_COOLDOWN_MS;
    this.frameTimes = [];
    this._applyResolved();
  }

  private _applyResolved(): void {
    const tier: QualityTier = this.mode === 'auto' ? this.autoTier : this.mode;
    if (tier === this.currentTier) return;
    this.currentTier = tier;
    this.opts.applyTier(tier);
    if (this.lastNotifiedTier !== tier) {
      this.lastNotifiedTier = tier;
      this.opts.bus.publish('quality:changed', { tier, mode: this.mode });
    }
  }

  getDebugSnapshot(): { mode: QualityMode; tier: QualityTier; autoTier: QualityTier; avgFrameMs: number } {
    const n = this.frameTimes.length;
    const avg = n > 0 ? this.frameTimes.reduce((a, b) => a + b, 0) / n : 0;
    return { mode: this.mode, tier: this.currentTier, autoTier: this.autoTier, avgFrameMs: Math.round(avg * 10) / 10 };
  }
}
