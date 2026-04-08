# AGENTS.md

## Overview

**Cybernoetica** is a high-aesthetic, GPU-accelerated audio-reactive visualizer and knowledge portal. It delivers 7 visualizer families (some with versioned subvariants) driven by real-time audio analysis, with a glass-morphism control interface, energy monitoring, and formal playback state management.

## Directory Structure

```
CyberNoetica/
├── apps/
│   └── web/                              # Vite SPA entry point (port 5173)
│       ├── server.ts                     # Express production server (Railway)
│       ├── auth-page.html                # Glass-morphism login gate
│       ├── vitest.config.ts              # Vitest config (jsdom)
│       ├── public/
│       │   └── icon.svg                  # PWA icon
│       └── src/
│           ├── main.ts                   # Bootstrap (loads settings, creates app)
│           ├── app.ts                    # Coordinator: wires bus, store, managers, UI
│           ├── store.ts                  # AppState + createAppStore()
│           ├── settings-loader.ts        # Dev settings from settings.json overrides
│           ├── managers/
│           │   ├── audio-pipeline.ts     # WASM/JS audio analysis, feature push
│           │   ├── track-manager.ts      # Track loading (generation counter), auto-play
│           │   ├── visualizer-manager.ts  # Switching, camera, viewport delegation
│           │   └── playback-state.ts     # Formal playback state machine
│           ├── utils/
│           │   ├── track-display.ts      # Track name formatting, folder grouping
│           │   └── launch-params.ts      # URL param + settings.json launch config
│           ├── ui/
│           │   ├── index.ts              # createUI() compositor, UIControls
│           │   ├── styles.ts             # Theme system, glass-morphism constants
│           │   ├── components.ts         # el(), glassButton(), toggleSwitch(), etc.
│           │   ├── start-screen.ts       # Start overlay with pulsing button
│           │   ├── control-bar.ts        # 4-button bar (Pause/Visual/Sound/Control)
│           │   ├── fade-manager.ts       # Auto-fade timer, mouse/key re-show
│           │   ├── keyboard-overlay.ts   # Floating keyboard shortcut bar
│           │   ├── log-display.ts        # Log capture + 3 display modes (Stream/Float/Fixed)
│           │   └── panels/
│           │       ├── visual-panel.ts   # Visualizer picker + categorized controls
│           │       ├── sound-panel.ts    # Sources, hierarchical track list, toggles
│           │       ├── control-panel.ts  # Settings, keyboard shortcuts
│           │       └── debug-panel.ts    # Dev panel: FPS, audio, state, bus, logs
│           └── __tests__/
│               ├── playback-state.test.ts
│               ├── settings-loader.test.ts
│               └── track-display.test.ts
├── packages/
│   ├── core/                             # @cybernoetica/core
│   │   └── src/
│   │       ├── index.ts
│   │       ├── message-bus.ts            # Typed pub/sub with wildcards + replay
│   │       ├── store.ts                  # Generic reactive Store<T>
│   │       ├── types.ts                  # AudioFeatures, ChannelMap, shared types
│   │       └── __tests__/
│   │           ├── message-bus.test.ts
│   │           └── store.test.ts
│   ├── renderer/                         # @cybernoetica/renderer
│   │   └── src/
│   │       ├── index.ts
│   │       ├── scene-manager.ts          # Three.js lifecycle, pointer+touch viewport
│   │       ├── smoothing.ts              # EMA smoothing for audio-reactive params
│   │       ├── __tests__/
│   │       └── visualizers/
│   │           ├── types.ts              # Visualizer interface, param taxonomy
│   │           ├── registry.ts           # VisualizerEntry, registerVisualizer()
│   │           ├── index.ts              # Barrel imports from subfolder barrels
│   │           ├── orbital/
│   │           │   ├── v01-alpha.ts      # 5K particle vortex
│   │           │   ├── v02-beta.ts       # Chaotic drifting orbits (7 emitters, 3D tangents)
│   │           │   ├── v03-gamma.ts      # Interactive sculpt mode (force fields)
│   │           │   └── index.ts
│   │           ├── mandelbrot/
│   │           │   ├── v01-alpha.ts      # Deep fractal zoom
│   │           │   └── index.ts
│   │           ├── julia/
│   │           │   ├── v01-alpha.ts      # Shape-shifting Julia set
│   │           │   └── index.ts
│   │           ├── waveform/
│   │           │   ├── v01-alpha.ts      # Neon soundwaves
│   │           │   └── index.ts
│   │           ├── voronoi/
│   │           │   ├── v01-alpha.ts      # Animated Voronoi cells
│   │           │   └── index.ts
│   │           ├── lissajous/
│   │           │   ├── v01-alpha.ts      # Harmonograph light curves
│   │           │   └── index.ts
│   │           └── kaleidoscope/
│   │               ├── v01-alpha.ts      # Psychedelic mandala symmetry
│   │               └── index.ts
│   └── audio/                            # @cybernoetica/audio
│       ├── src/
│       │   ├── index.ts
│       │   ├── audio-source.ts           # Web Audio: file, mic, system (with cleanup)
│       │   └── audio-processor.ts        # Publishes AudioFeatures to bus
│       └── wasm/
├── crates/
│   └── audio-analysis/                   # Rust -> WASM via wasm-pack
├── scripts/
│   └── upload-audio.sh                   # Audio upload/list/verify for Railway
├── data/
│   └── sample-music/                     # .gitignored audio tracks
├── guidebook/
│   ├── README.md
│   └── Design-Principles.md             # Core design philosophy
├── settings.json                         # Dev + prod overrides (title, theme, launch config)
├── launch.sh                             # Centralized launch script (--viz, --audio, --debug, etc.)
├── CLAUDE.md                             # Claude Code project instructions
├── JUSTFile                              # Development + deployment commands
├── Dockerfile
├── package.json
├── pnpm-workspace.yaml
└── tsconfig.base.json
```

## Tech Stack

| Layer            | Technology                                           |
|------------------|------------------------------------------------------|
| Languages        | TypeScript (ES modules), Rust (edition 2021)         |
| Runtime          | Node >= 20 (via Volta at ~/.volta)                   |
| Package manager  | pnpm workspaces                                      |
| Bundler          | Vite 6.x                                             |
| 3D rendering     | Three.js (r175+), GLSL shaders                       |
| Testing          | Vitest (jsdom for renderer + web app tests)          |
| Rust / WASM      | Cargo, wasm-bindgen, rustfft; built via wasm-pack    |
| Deployment       | Railway (Docker), Express 5 production server        |
| PWA              | vite-plugin-pwa, Workbox service worker               |

## Architecture

**Message-bus-centric.** `MessageBus` (in `packages/core`) is the connective tissue: components publish and subscribe to typed channels (`audio:features`, `playback:state`). Wildcard subscriptions (`audio:*`) and last-message replay are supported.

**Centralized state.** `Store<T>` (in `packages/core`) provides reactive state management with deep merge, selector-based subscriptions, and JSON serialization. The web app uses it as `AppState` with localStorage persistence for user preferences.

**Playback state machine.** `PlaybackStateMachine` (in `managers/playback-state.ts`) is the single source of truth for playback state. It enforces valid transitions (idle -> loading -> playing -> paused, etc.), prevents race conditions, and emits changes via the message bus. The closure variable `playing` has been eliminated; `app.ts` reads `playback.isPlaying` instead.

**Track loading sequencing.** `TrackManager.loadTrack()` uses a generation counter to handle rapid track switching. If a newer load request arrives while a previous one is in flight, the older one returns `false` and is silently discarded.

**Audio source cleanup.** `AudioSource` now calls `stopCurrentSource()` before switching to any new source, properly stopping `MediaStream` tracks (mic/system) and disconnecting nodes. This prevents stream leaks when switching from mic/system audio to file playback.

**Data flow:**
1. `AudioSource` captures audio (file, microphone, or system audio via getDisplayMedia)
2. `AudioPipeline` extracts features (via Rust/WASM FFT or JS fallback) and publishes via `AudioProcessor` on `audio:features`
3. Visualizers subscribe to audio features and modulate their parameters
4. `SceneManager` drives the Three.js render loop with pointer/touch viewport interaction

**Visualizer system:** Self-registering visualizers organized in versioned folders. Each family (orbital, mandelbrot, julia, waveform, voronoi, lissajous, kaleidoscope) has a folder with `v{NN}-{greek}.ts` files. Parameters are categorized as `'appearance'` or `'audio-mapping'`. The UI groups controls accordingly. The orbital family has three versions: alpha (classic), beta (chaotic with drift), and gamma (interactive sculpt mode with user-placeable force fields).

**View state.** Each visualizer exposes a per-family coordinate system via `getViewState()` / `setViewState()`. The coordinates have intuitive, domain-specific names (e.g., Mandelbrot uses `centerReal`/`centerImaginary`/`zoom`/`rotation`; Orbital uses `orbitAngle`/`elevation`/`distance`; Voronoi uses `centerX`/`centerY`/`zoom`). User interactions (drag, scroll, pinch) flow from SceneManager as raw deltas through VisualizerManager, which translates them into the appropriate `setViewState()` calls. The pan handler in VisualizerManager supports multiple field name patterns: `centerReal`/`centerImaginary` (Mandelbrot), `centerX`/`centerY` (Voronoi, Lissajous), and `seedReal`/`seedImaginary` (Julia). The canvas shows a crosshair cursor with surrounding circle on hover when drag is available, with a brighter variant while dragging. SceneManager supports context-sensitive cursor modes (`pan`, `orbit`, `sculpt`, `default`) via `setCursorMode()`, with a dedicated blue crosshair cursor for sculpt mode.

**Settings override system.** `settings.json` at repo root provides overrides (app title, UI theme, track display format, launch config). The `settings-loader.ts` module loads it via fetch with graceful fallback to defaults. In production builds, `settings.json` is emitted to `dist/` via a Vite plugin `generateBundle` hook and also copied in the Dockerfile.

**Energy monitoring.** The Control panel includes a Performance section (always visible, not just debug) showing FPS with target, frame budget (color-coded bar with percentage), power draw (Low/Medium/High with scalar %), GPU name (via `WEBGL_debug_renderer_info`), GPU object counts, CPU thread count (via `hardwareConcurrency`), draw calls, triangles, JS heap memory (Chrome), and a Power Saver toggle that caps the render loop to ~30fps.

**Launch configuration.** The app supports auto-starting with a specific visualizer, audio source, and/or UI settings. Configuration sources (in ascending priority): `settings.json` `launch` block, URL search params (`?viz=`, `&audio=`, `&log=`, `&autostart`). When a visualizer or audio source is specified, the start screen is skipped and playback begins immediately. See "Launch Configuration" section below.

## Development

```bash
export PATH="$HOME/.volta/bin:$HOME/.cargo/bin:$PATH"

pnpm install          # Install all workspace dependencies
pnpm dev              # Start Vite dev server (apps/web, port 5173)
pnpm test             # Run all Vitest suites (95 tests)
pnpm build            # Build all packages
```

### Debug Panel and Logging

In dev mode or with `?debug` URL parameter, the Control panel shows:
- FPS, frame time, playback state
- Live audio feature bars
- Visualizer params and state dump
- Bus message rate
- Log display with level filtering (All/Debug/Info/Warn/Error), styling (Raw/Clean), and 3 placement modes:
  - **Stream** -- Star Wars-style fading text overlay below control bar
  - **Float** -- draggable modal window
  - **Fixed** -- compact container below control panel
- Keyboard shortcut overlay bar below the control bar (toggle-able)

### Settings Override (settings.json)

The `settings.json` file at the repo root provides dev-time overrides. If absent or if a key is missing, defaults apply. Overrides are transient/experimental -- do not update docs or other files based on settings.json values.

```json
{
  "app_title": "Imbasso Cybernoetica",
  "ui_theme": "glass-dark",
  "track_display": {
    "format": "track-number",
    "show_folder_name": true
  }
}
```

Available themes: `glass-dark` (default), `glass-light`, `minimal`.
Track formats: `raw`, `hyphen-to-space`, `parenthetical`, `track-number`.

### Launch Configuration

The app can auto-start with a specific visualizer and/or audio source, skipping the start screen. Configuration can come from `settings.json` or URL params.

**URL params** (highest priority):
- `?viz=mandelbrot` -- start with a specific visualizer type
- `?audio=system` -- use system audio capture
- `?audio=mic` -- use microphone
- `?audio=track-name` -- play a specific sample track (fuzzy match)
- `?log=stream` -- show log display (stream, floating, or docked)
- `?autostart` -- skip start screen (implied when viz or audio is set)
- `?debug` -- enable debug panel

**settings.json** `launch` block:
```json
{
  "launch": {
    "visualizer": "mandelbrot",
    "audio_source": "system",
    "show_log": "stream",
    "auto_start": true
  }
}
```

**JUSTFile shortcut:**
```bash
just launch-with viz=mandelbrot audio=system log=stream
```

### Dev Refresh Button

In dev mode (`import.meta.env.DEV`), a small glass-morphism button appears in the top-right corner showing the platform-appropriate reload shortcut (Cmd+R on macOS, Ctrl+R elsewhere). Clicking it triggers `location.reload()` for a full refresh.

## Adding a New Visualizer

### Creating a new visualizer in an existing family

1. Create `packages/renderer/src/visualizers/{family}/v{NN}-{greek}.ts` (e.g., `orbital/v02-beta.ts`)
2. Define `VisualizerMetadata` with unique `type` (e.g., `'orbital-beta'`), label, description, and categorized params
3. Implement the `Visualizer` interface
4. Call `registerVisualizer(...)` at module scope
5. Add `import './v02-beta.js'` to the family's `index.ts`

### Creating a new visualizer family

1. Create folder `packages/renderer/src/visualizers/{family}/`
2. Create `v01-alpha.ts` with the visualizer implementation
3. Create `index.ts` barrel: `import './v01-alpha.js'; export { MyVisualizer } from './v01-alpha.js';`
4. Add `import './{family}/index.js'` to `packages/renderer/src/visualizers/index.ts`

### Parameter taxonomy

Each `VisualizerParam` has an optional `category` field:
- `'appearance'` (default) -- controls general visual properties (e.g., glow, gravity, zoom speed)
- `'audio-mapping'` -- controls the strength of audio-to-visual mappings (e.g., bass-to-gravity multiplier)

Audio-mapping params act as multipliers on the existing audio-driven computations in `tick()`. The Visual Panel groups these into "Appearance" and "Audio Response" sections.

### View state

Every visualizer must implement `getViewState()` and `setViewState(partial)` and declare `viewStateFields` in its metadata. View state represents *where* the user is looking, with domain-specific coordinate names:

| Family | Fields | Description |
|---|---|---|
| Mandelbrot | `centerReal`, `centerImaginary`, `zoom`, `rotation` | Complex plane coordinates |
| Julia | `seedReal`, `seedImaginary`, `zoom` | c-parameter and magnification |
| Orbital | `orbitAngle`, `elevation`, `distance` | Spherical camera coordinates |
| Waveform | `verticalShift` | Vertical offset of the waveform stack |
| Voronoi | `centerX`, `centerY`, `zoom` | 2D pan + zoom |
| Lissajous | `centerX`, `centerY`, `zoom`, `phase` | 2D pan + zoom (phase is read-only) |
| Kaleidoscope | `zoom`, `rotation` | Zoom + fold rotation |

When a user sets a view state value, the visualizer should pause its autonomous animation for that axis. The UI's "Reset View" button re-creates the visualizer to restore all defaults.

### Interactivity

Visualizers can optionally declare an `interactivity` field in their metadata:

```typescript
interactivity?: {
  description: string;    // Hint text shown below the title
  toggleParam?: string;   // Param key that enables/disables interactivity
};
```

When a visualizer with interactivity is active, a fading hint text appears below the title, and the keyboard overlay shows relevant shortcuts. The cursor mode also changes (e.g., sculpt cursor for orbital gamma's force field placement).

### Versioning scheme

- Files: `v{NN}-{greek}.ts` (e.g., `v01-alpha.ts`, `v02-beta.ts`)
- Registry type: `'{family}'` for v01, `'{family}-{greek}'` for subsequent versions
- Greek sequence: alpha, beta, gamma, delta, epsilon, zeta, eta, theta
- The UI shows greek labels only when a family has multiple registered versions

## Design Principles

See `guidebook/Design-Principles.md` for the full philosophy. Key points:

- **Intuitiveness** -- Human-readable code with meaningful internal structure
- **Modularity** -- Fluid manipulation, reuse, or replacement of components
- **Hierarchy** -- Progressive complexity; curricular exposure for users and devs
- **Extensibility** -- Clear hooks, plugin points, and abstraction layers
- **Verifiability** -- Extensive programmatic and manual testing at all levels
- **Parsimony** -- Maximal performance with minimal complexity

## Deployment (Railway)

The app deploys to Railway as a Dockerized Express server serving the Vite SPA build.

- Single Railway service (`cybernoetica-web`) in the `Demo` environment
- Express 5 server handles static files, audio streaming, auth, and COOP/COEP headers
- Railway volume mounted at `/data/audio` stores sample music (84 tracks)
- `AUDIO_DIR` env var (set in Railway and Dockerfile default) points to the volume mount
- Server logs audio dir path, existence, and track count at startup for diagnostics
- PWA service worker pre-caches JS/CSS/WASM
- Auth gate: email whitelist + universal password, cookie-session based

**Key commands:**
```bash
just deploy              # Deploy to Railway + verify tracks
just deploy-auth "a@b.com,c@d.com" "password"
just upload file.mp3     # Upload a single audio file
just upload-dir dir/     # Upload all audio from a directory
just list-tracks         # List deployed tracks
just verify-tracks       # Check that tracks are available
just reupload-tracks     # Re-upload all local audio (data/sample-music/)
```

**Audio management** is handled by `scripts/upload-audio.sh` (subcommands: `upload`, `upload-dir`, `list`, `verify`). The JUSTFile commands are thin wrappers that pass `DEPLOY_HOST` and `GITHUB_TOKEN`.

**Custom domain:** `app.imbasso.com` (CNAME to Railway -- ensure it points to the current Railway service URL).

## Known Issues

- **No integration tests** or visual regression tests yet
- **Waveform vertical positioning** -- bass layer creates visual weight imbalance
- **Knowledge portal** (GOAL.md Purpose 3) is entirely future work
- **Cross-modal inputs** (webcam, wearables, gestures) not yet implemented
- **Custom domain DNS** -- `app.imbasso.com` CNAME must point to the current Railway service URL (`cybernoetica-web-demo.up.railway.app`); if stale, it routes to an old deployment
- **Railway volume persistence** -- volume data survives redeploys but not volume re-creation; use `just verify-tracks` after deploys and `just reupload-tracks` if empty
