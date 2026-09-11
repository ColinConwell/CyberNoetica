// ---------------------------------------------------------------------------
// Centralized UI Constants
//
// All z-indexes, layout dimensions, spacing values, and transition timings
// used by the UI layer. Import from here instead of using inline magic numbers.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Z-Index Layers (ascending visual order)
// ---------------------------------------------------------------------------

export const Z_INDEX = {
  keyboardOverlay: 80,
  logStream: 85,
  logFixed: 88,
  panelBackdrop: 90,
  panel: 95,
  controlBar: 100,
  title: 100,
  interactivityHint: 100,
  startScreen: 200,
  logFloat: 200,
  errorToast: 300,
} as const;

// ---------------------------------------------------------------------------
// Layout Dimensions
// ---------------------------------------------------------------------------

export const DIMENSIONS = {
  panelMinWidth: 320,
  panelMaxWidth: 440,
  panelMaxHeight: '55vh',
  panelPadding: 20,

  controlBarPadding: 10,

  fixedLogHeight: 160,
  fixedLogWidth: 440,
  floatLogWidth: 460,
  floatLogMaxHeight: '50vh',
  streamLogWidth: 500,

  errorMaxWidth: 400,

  trackListMaxHeight: 220,
  statePreviewMaxHeight: 140,
} as const;

// ---------------------------------------------------------------------------
// Spacing
// ---------------------------------------------------------------------------

export const SPACING = {
  layoutGap: 6,
  sectionMargin: 14,
  controlGap: 8,
  smallGap: 4,
  panelBorderRadius: 20,
  pillBorderRadius: 24,
  cardBorderRadius: 8,
  barBorderRadius: 40,
} as const;

// ---------------------------------------------------------------------------
// Positions (fixed elements)
// ---------------------------------------------------------------------------

export const POSITIONS = {
  titleTop: 24,
  interactivityHintTop: 52,
  errorTop: 60,
  floatLogTop: 60,
  floatLogRight: 20,
} as const;

// ---------------------------------------------------------------------------
// Transition Timings
// ---------------------------------------------------------------------------

export const TIMING = {
  panelTransition: '0.3s ease',
  fadeTransition: '0.4s ease',
  opacityFast: '0.15s ease',
  opacityMedium: '0.3s ease',
  opacitySlow: '0.5s ease',
  bottomSlide: '0.3s ease',
  startScreenFade: '0.6s ease',
  hintFade: '0.6s ease',
  barWidth: '0.3s ease',
  buttonScale: '0.2s ease',
  toggleSlide: '0.25s ease',

  streamLifetimeMs: 4000,
  streamRemoveMs: 4200,
  streamMaxLines: 6,
  streamReplayCount: 3,
  streamReplayStaggerMs: 200,

  hintShowMs: 4000,
  hintMouseMs: 3000,
} as const;

// ---------------------------------------------------------------------------
// Layout Stack (bottom-up vertical ordering)
//
// These are the estimated minimum heights for layout coordination.
// The LayoutManager (when implemented) will measure actual heights
// via ResizeObserver, but these serve as fallbacks and initial values.
// ---------------------------------------------------------------------------

export const STACK = {
  keyboardBarMinHeight: 30,
  controlBarMinHeight: 54,
} as const;
