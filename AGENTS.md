# AGENTS.md

## Overview

**Cybernœtica** is a high-aesthetic, GPU-accelerated audio-reactive visualizer and knowledge portal. It currently delivers 4 visualizer modes driven by real-time audio analysis, with a glass-morphism control interface.

## Directory Structure

```
CyberNoetica/
├── apps/
│   └── web/                          # Vite SPA entry point (port 5173)
│       └── src/
│           ├── main.ts               # Bootstrap
│           ├── app.ts                # Orchestrator: wires bus, audio, renderer, UI
│           │                         #   - visualizer switching, track loading
│           │                         #   - auto-play/shuffle, pause/resume
│           │                         #   - appearance control param definitions
│           │                         #   - viewport pan/zoom passthrough
│           └── ui.ts                 # Full UI system (~600 lines, needs splitting):
│                                     #   - Start screen, control bar (Pause/Visual/Sound/Control)
│                                     #   - Slide-up panels for each section
│                                     #   - Auto-fade with mouse/key re-show
│                                     #   - Per-visualizer appearance sliders
│                                     #   - Sample track browser, auto-play/shuffle
├── packages/
│   ├── core/                         # @cybernoetica/core
│   │   └── src/
│   │       ├── index.ts
│   │       ├── message-bus.ts        # Typed pub/sub with wildcards + replay
│   │       └── types.ts              # AudioFeatures, ChannelMap, shared types
│   ├── renderer/                     # @cybernoetica/renderer
│   │   └── src/
│   │       ├── index.ts
│   │       ├── scene-manager.ts      # Three.js lifecycle, dual camera (ortho + perspective),
│   │       │                         #   viewport drag/zoom, auto camera drift
│   │       ├── smoothing.ts          # EMA smoothing for audio-reactive params
│   │       └── visualizers/
│   │           ├── index.ts          # Barrel exports for all visualizers
│   │           ├── orbital.ts        # Gravitational particle system (5K particles,
│   │           │                     #   orbiting emitters, curl noise, perspective camera)
│   │           ├── waveform.ts       # Neon layered waveforms (GLSL shader, FFT texture)
│   │           ├── julia.ts          # Julia set morph (c-parameter orbits through
│   │           │                     #   interesting regions, audio-driven)
│   │           └── mandelbrot.ts     # Deep zoom into Mandelbrot boundary regions
│   │                                 #   (zoom cycle in→out, rotation, 8 zoom targets)
│   └── audio/                        # @cybernoetica/audio
│       ├── src/
│       │   ├── index.ts              # Exports + loadWasmAnalyzer() helper
│       │   ├── audio-source.ts       # Web Audio capture: file, mic, system audio
│       │   │                         #   (getDisplayMedia), onEnded callback
│       │   └── audio-processor.ts    # Publishes AudioFeatures to bus
│       └── wasm/                     # wasm-pack output (built from crates/)
├── crates/
│   └── audio-analysis/               # Rust crate → WASM via wasm-pack
│       ├── Cargo.toml
│       ├── src/
│       │   ├── lib.rs                # AudioAnalyzer: FFT, bands, spectral features,
│       │   │                         #   beat detection. analyze() → JsValue,
│       │   │                         #   analyze_native() → AudioFeatures
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

**Data flow:**
1. `AudioSource` captures audio (file, microphone, or system audio via getDisplayMedia)
2. `AudioProcessor` extracts features (via Rust/WASM FFT or JS fallback) and publishes `AudioFeatures` on `audio:features`
3. Visualizers subscribe to audio features and modulate their parameters (shader uniforms, particle physics, etc.)
4. `SceneManager` drives the Three.js render loop with dual camera support (orthographic for shader visualizers, perspective for particle systems)

**Visualizer interface:** Each visualizer implements `attach(scene)`, `tick()`, `setResolution(w,h)`, `dispose()`, and optionally `setPan(x,y)`, `setZoom(z)`, `usesPerspective`.

**UI system:** Start screen → 4-button control bar (Pause/Visual/Sound/Control) → slide-up panels. Auto-fades after configurable delay, reappears on mouse/key.

## Development

```bash
# Prerequisites: Volta (node/pnpm), Rust toolchain (~/.cargo/bin)
export PATH="$HOME/.volta/bin:$HOME/.cargo/bin:$PATH"

pnpm install          # Install all workspace dependencies
pnpm dev              # Start Vite dev server (apps/web, port 5173)
pnpm test             # Run all Vitest suites (26 tests)
pnpm build            # Build all packages
```

### Building WASM (optional — JS fallback works without it)

```bash
export PATH="$HOME/.cargo/bin:$PATH"
cd crates/audio-analysis
wasm-pack build --target web --out-dir ../../packages/audio/wasm
```

### Sample Music

The Vite dev server serves audio files from `data/sample-music/` via a custom plugin. The `/__list` endpoint returns a JSON array of available tracks.

## Design Principles

See `guidebook/Design-Principles.md` for the full philosophy. Key points:

- **Intuitiveness** — Human-readable code with meaningful internal structure
- **Modularity** — Fluid manipulation, reuse, or replacement of components
- **Hierarchy** — Progressive complexity; curricular exposure for users and devs
- **Extensibility** — Clear hooks, plugin points, and abstraction layers
- **Verifiability** — Extensive programmatic and manual testing at all levels
- **Parsimony** — Maximal performance with minimal complexity

## Known Issues

See `TODO.md` for the full list of next-session tasks. Key issues:

- **`ui.ts` is monolithic** (~600 lines) — needs splitting into submodules
- **`app.ts` accumulates responsibilities** — needs decomposition
- **Visualizer controls** have inconsistent effect — `userParams` multiplier pattern works for orbital but needs standardization across all visualizers
- **Viewport drag/zoom** works inconsistently across visualizer types
- **No integration tests** or visual regression tests yet
- **Adding a new visualizer requires editing 4 files** — should be 1 (self-registration)
