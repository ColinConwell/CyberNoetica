# AGENTS.md

## Overview

**Cybernoetica** is a high-aesthetic, GPU-accelerated audio-reactive visualizer and knowledge portal. It delivers 4 visualizer families (each with versioned subvariants) driven by real-time audio analysis, with a glass-morphism control interface and formal playback state management.

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
│           │   └── track-display.ts      # Track name formatting, folder grouping
│           ├── ui/
│           │   ├── index.ts              # createUI() compositor, UIControls
│           │   ├── styles.ts             # Theme system, glass-morphism constants
│           │   ├── components.ts         # el(), glassButton(), toggleSwitch(), etc.
│           │   ├── start-screen.ts       # Start overlay with pulsing button
│           │   ├── control-bar.ts        # 4-button bar (Pause/Visual/Sound/Control)
│           │   ├── fade-manager.ts       # Auto-fade timer, mouse/key re-show
│           │   ├── log-display.ts        # Log capture + 3 display modes
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
│   │           │   ├── v01-alpha.ts      # 5K particle system
│   │           │   └── index.ts
│   │           ├── mandelbrot/
│   │           │   ├── v01-alpha.ts      # Deep fractal zoom
│   │           │   └── index.ts
│   │           ├── julia/
│   │           │   ├── v01-alpha.ts      # Shape-shifting Julia set
│   │           │   └── index.ts
│   │           └── waveform/
│   │               ├── v01-alpha.ts      # Neon soundwaves
│   │               └── index.ts
│   └── audio/                            # @cybernoetica/audio
│       ├── src/
│       │   ├── index.ts
│       │   ├── audio-source.ts           # Web Audio: file, mic, system (with cleanup)
│       │   └── audio-processor.ts        # Publishes AudioFeatures to bus
│       └── wasm/
├── crates/
│   └── audio-analysis/                   # Rust -> WASM via wasm-pack
├── data/
│   └── sample-music/                     # .gitignored audio tracks
├── guidebook/
│   ├── README.md
│   └── Design-Principles.md             # Core design philosophy
├── settings.json                         # Dev overrides (title, theme, track display)
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

**Visualizer system:** Self-registering visualizers organized in versioned folders. Each family (orbital, mandelbrot, julia, waveform) has a folder with `v{NN}-{greek}.ts` files. Parameters are categorized as `'appearance'` or `'audio-mapping'`. The UI groups controls accordingly.

**Settings override system.** `settings.json` at repo root provides dev-time overrides (app title, UI theme, track display format). The `settings-loader.ts` module loads it via fetch with graceful fallback to defaults.

## Development

```bash
export PATH="$HOME/.volta/bin:$HOME/.cargo/bin:$PATH"

pnpm install          # Install all workspace dependencies
pnpm dev              # Start Vite dev server (apps/web, port 5173)
pnpm test             # Run all Vitest suites (79 tests)
pnpm build            # Build all packages
```

### Debug Panel and Logging

In dev mode or with `?debug` URL parameter, the Control panel shows:
- FPS, frame time, playback state
- Live audio feature bars
- Visualizer params and state dump
- Bus message rate
- Log display with level filtering and 3 display modes:
  - **Stream** -- Star Wars-style fading text overlay
  - **Floating** -- draggable modal window
  - **Docked** -- panel locked to bottom/left/right edge

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
- Railway volume at `/data/audio` stores sample music (~458MB, 84 tracks)
- PWA service worker pre-caches JS/CSS/WASM
- Auth gate: email whitelist + universal password, cookie-session based

**Key commands:**
```bash
just deploy              # Deploy to Railway
just deploy-auth "a@b.com,c@d.com" "password"
just upload file.mp3     # Upload audio
just list-tracks         # List deployed tracks
```

**Custom domain:** `app.imbasso.com` (CNAME to Railway).

## Known Issues

- **No integration tests** or visual regression tests yet
- **Waveform vertical positioning** -- bass layer creates visual weight imbalance
- **Knowledge portal** (GOAL.md Purpose 3) is entirely future work
- **Cross-modal inputs** (webcam, wearables, gestures) not yet implemented
