# AGENTS.md

## Overview

**Cybernoetica** is a high-aesthetic, GPU-accelerated audio-reactive visualizer and knowledge portal. It currently delivers 4 visualizer modes driven by real-time audio analysis, with a glass-morphism control interface.

## Directory Structure

```
CyberNoetica/
├── apps/
│   └── web/                          # Vite SPA entry point (port 5173)
│       └── src/
│           ├── main.ts               # Bootstrap
│           ├── app.ts                # Thin coordinator (~185 lines):
│           │                         #   wires bus, store, managers, UI
│           ├── store.ts              # AppState + createAppStore()
│           │                         #   localStorage persistence
│           ├── managers/
│           │   ├── audio-pipeline.ts  # WASM/JS audio analysis, feature push
│           │   ├── track-manager.ts   # Track loading, auto-play, shuffle
│           │   └── visualizer-manager.ts  # Switching, camera, viewport delegation
│           └── ui/
│               ├── index.ts          # createUI() compositor, UIControls
│               ├── styles.ts         # Glass-morphism constants, AppSettings
│               ├── components.ts     # el(), glassButton(), sectionLabel()
│               ├── start-screen.ts   # Start overlay with pulsing button
│               ├── control-bar.ts    # 4-button bar (Pause/Visual/Sound/Control)
│               ├── fade-manager.ts   # Auto-fade timer, mouse/key re-show
│               └── panels/
│                   ├── visual-panel.ts   # Visualizer picker (reads from registry)
│                   │                     #   + appearance controls
│                   ├── sound-panel.ts    # Sources, track list, auto-play/shuffle
│                   ├── control-panel.ts  # Settings, keyboard shortcuts
│                   └── debug-panel.ts    # Dev-mode panel: FPS, audio features,
│                                         #   visualizer params, state dump, bus monitor
├── packages/
│   ├── core/                         # @cybernoetica/core
│   │   └── src/
│   │       ├── index.ts
│   │       ├── message-bus.ts        # Typed pub/sub with wildcards + replay
│   │       ├── store.ts              # Generic reactive Store<T> with
│   │       │                         #   deep merge, select(), serialize/deserialize
│   │       └── types.ts              # AudioFeatures, ChannelMap, shared types
│   ├── renderer/                     # @cybernoetica/renderer
│   │   └── src/
│   │       ├── index.ts
│   │       ├── scene-manager.ts      # Three.js lifecycle, dual camera (ortho + persp),
│   │       │                         #   viewport drag/zoom based on ViewportCapabilities
│   │       ├── smoothing.ts          # EMA smoothing for audio-reactive params
│   │       └── visualizers/
│   │           ├── types.ts          # Visualizer interface, VisualizerMetadata,
│   │           │                     #   VisualizerParam, ViewportCapabilities
│   │           ├── registry.ts       # VisualizerEntry, registerVisualizer(),
│   │           │                     #   getVisualizerEntry(), listVisualizers()
│   │           ├── index.ts          # Side-effect imports trigger registration,
│   │           │                     #   barrel re-exports
│   │           ├── orbital.ts        # 5K particle system, self-registering
│   │           ├── waveform.ts       # Neon waveforms, userParams multiplier fix
│   │           ├── julia.ts          # Julia set morph, self-registering
│   │           └── mandelbrot.ts     # Deep zoom, self-registering
│   └── audio/                        # @cybernoetica/audio
│       ├── src/
│       │   ├── index.ts              # Exports + loadWasmAnalyzer() helper
│       │   ├── audio-source.ts       # Web Audio capture: file, mic, system audio
│       │   └── audio-processor.ts    # Publishes AudioFeatures to bus
│       └── wasm/                     # wasm-pack output (built from crates/)
├── crates/
│   └── audio-analysis/               # Rust crate -> WASM via wasm-pack
│       ├── Cargo.toml
│       ├── src/
│       │   ├── lib.rs                # AudioAnalyzer: FFT, bands, spectral features,
│       │   │                         #   beat detection
│       │   └── features.rs           # Serializable AudioFeatures struct
│       └── tests/
│           └── analysis_test.rs      # 3 tests: sine wave, silence, transient
├── data/
│   └── sample-music/                 # .gitignored audio tracks for demos/testing
│       └── Sympoetic-Techno-Jazz/    # 84 .mp3 sample tracks
├── docs/
│   └── superpowers/
│       ├── specs/                    # Architecture design spec
│       └── plans/                    # Implementation plans
├── guidebook/
│   ├── README.md
│   └── Design-Principles.md         # Core design philosophy (READ THIS)
├── package.json                      # Root workspace scripts
├── pnpm-workspace.yaml
├── pnpm-lock.yaml
├── tsconfig.base.json
├── JUSTFile                          # Development commands (just <cmd>)
├── TODO.md                           # Next-session task list
└── .claude/
    ├── launch.json                   # Dev server config for preview
    └── start-dev.sh                  # Dev server startup script
```

## Tech Stack

| Layer            | Technology                                           |
|------------------|------------------------------------------------------|
| Languages        | TypeScript (ES modules), Rust (edition 2021)         |
| Runtime          | Node >= 20 (via Volta at ~/.volta)                   |
| Package manager  | pnpm workspaces                                      |
| Bundler          | Vite 6.x                                             |
| 3D rendering     | Three.js (r175+), GLSL shaders                       |
| Testing          | Vitest (jsdom for renderer tests)                    |
| Rust / WASM      | Cargo, wasm-bindgen, rustfft; built via wasm-pack    |
| Planned          | Tauri desktop shell, WebGPU path, Python sidecar     |

## Architecture

**Message-bus-centric.** `MessageBus` (in `packages/core`) is the connective tissue: components publish and subscribe to typed channels (`audio:features`, `audio:error`). Wildcard subscriptions (`audio:*`) and last-message replay are supported.

**Centralized state.** `Store<T>` (in `packages/core`) provides reactive state management with deep merge, selector-based subscriptions, and JSON serialization. The web app uses it as `AppState` with localStorage persistence for user preferences.

**Data flow:**
1. `AudioSource` captures audio (file, microphone, or system audio via getDisplayMedia)
2. `AudioPipeline` extracts features (via Rust/WASM FFT or JS fallback) and publishes them via `AudioProcessor` on `audio:features`
3. Visualizers subscribe to audio features and modulate their parameters (shader uniforms, particle physics, etc.)
4. `SceneManager` drives the Three.js render loop with dual camera support and capability-based viewport interaction

**Visualizer system:** Self-registering visualizers. Each implements the `Visualizer` interface and exports a `VisualizerMetadata` describing its type, params, and viewport capabilities. A central `registry` auto-discovers them. Adding a new visualizer means creating one file + one import line in the barrel.

**Manager pattern:** `app.ts` is a thin coordinator (~185 lines) that wires three focused managers:
- `AudioPipeline` — WASM/fallback analysis, frame pushing
- `TrackManager` — sample track list, auto-play queue, shuffle
- `VisualizerManager` — switching, camera mode, viewport delegation

**UI system:** Modular structure under `apps/web/src/ui/`. Start screen -> 4-button control bar -> slide-up panels. Auto-fades after configurable delay, reappears on mouse/key. Visual panel reads visualizer options from the registry. Debug panel (dev mode) shows FPS, audio features, state dump, bus activity.

## Development

```bash
# Prerequisites: Volta (node/pnpm), Rust toolchain (~/.cargo/bin)
export PATH="$HOME/.volta/bin:$HOME/.cargo/bin:$PATH"

pnpm install          # Install all workspace dependencies
pnpm dev              # Start Vite dev server (apps/web, port 5173)
pnpm test             # Run all Vitest suites (26 tests)
pnpm build            # Build all packages
```

### Building WASM (optional -- JS fallback works without it)

```bash
export PATH="$HOME/.cargo/bin:$PATH"
cd crates/audio-analysis
wasm-pack build --target web --out-dir ../../packages/audio/wasm
```

### Sample Music

The Vite dev server serves audio files from `data/sample-music/` via a custom plugin. The `/__list` endpoint returns a JSON array of available tracks.

### Debug Panel

In dev mode (Vite dev server) or with `?debug` URL parameter, the Control panel shows a debug section with FPS, live audio feature bars, visualizer params, full state JSON dump, and bus message rate.

## Design Principles

See `guidebook/Design-Principles.md` for the full philosophy. Key points:

- **Intuitiveness** -- Human-readable code with meaningful internal structure
- **Modularity** -- Fluid manipulation, reuse, or replacement of components
- **Hierarchy** -- Progressive complexity; curricular exposure for users and devs
- **Extensibility** -- Clear hooks, plugin points, and abstraction layers
- **Verifiability** -- Extensive programmatic and manual testing at all levels
- **Parsimony** -- Maximal performance with minimal complexity

## Adding a New Visualizer

1. Create `packages/renderer/src/visualizers/my-viz.ts`
2. Define a `VisualizerMetadata` with type, label, description, params, viewport capabilities
3. Implement the `Visualizer` interface (attach, tick, setResolution, dispose, setUserParam)
4. Call `registerVisualizer({ metadata, create: (bus) => new MyViz(bus) })` at module scope
5. Add `import './my-viz.js'` to `packages/renderer/src/visualizers/index.ts`

The UI, control panels, and appearance sliders automatically pick up the new visualizer from the registry.

## Known Issues

- **No integration tests** or visual regression tests yet
- **Waveform vertical positioning** -- bass layer creates visual weight imbalance
- **Orbital brightness** -- needs testing in full-size window with real audio
- **Knowledge portal** (GOAL.md Purpose 3) is entirely future work
- **Cross-modal inputs** (webcam, wearables, gestures) not yet implemented
