# AGENTS.md

## Overview

**CyberNoetica** is a vibe-phenomenological visualizer and knowledge portal.
The current MVP delivers an audio-reactive Mandelbrot fractal visualization
running in the browser, with optional Rust/WASM-accelerated audio analysis.

## Directory Structure

```
CyberNoetica/
├── apps/
│   └── web/                          # Vite SPA entry point (port 5173)
│       └── src/
│           ├── main.ts               # Bootstrap
│           ├── app.ts                # createApp: wires bus, audio, renderer
│           └── ui.ts                 # DOM controls (file input, mic toggle)
├── packages/
│   ├── core/                         # @cybernoetica/core
│   │   └── src/
│   │       ├── index.ts
│   │       ├── message-bus.ts        # Typed pub/sub with wildcards + replay
│   │       └── types.ts              # AudioFeatures, ChannelMap, shared types
│   ├── renderer/                     # @cybernoetica/renderer
│   │   └── src/
│   │       ├── index.ts
│   │       ├── scene-manager.ts      # Three.js scene lifecycle
│   │       ├── smoothing.ts          # EMA smoothing for audio-reactive params
│   │       └── visualizers/
│   │           ├── index.ts
│   │           └── mandelbrot.ts     # Shader-driven Mandelbrot visualizer
│   └── audio/                        # @cybernoetica/audio
│       ├── src/
│       │   ├── index.ts
│       │   ├── audio-source.ts       # Web Audio file + mic capture
│       │   └── audio-processor.ts    # Publishes audio:features to the bus
│       └── wasm/                     # wasm-pack output (built from crates/)
├── crates/
│   └── audio-analysis/               # Rust crate -> WASM via wasm-pack
│       ├── Cargo.toml
│       └── src/
│           ├── lib.rs                # AudioAnalyzer (FFT, bands, beat detection)
│           └── features.rs           # Serializable AudioFeatures struct
├── docs/
│   └── superpowers/
│       ├── specs/                    # Architecture design spec
│       └── plans/                    # Implementation plans
├── guidebook/
│   ├── README.md
│   └── Design-Principles.md         # Core design philosophy
├── package.json                      # Root workspace scripts
├── pnpm-workspace.yaml               # Workspaces: apps/*, packages/*
├── pnpm-lock.yaml
└── tsconfig.base.json                # Shared TS config (ES2022, strict, bundler)
```

## Tech Stack

| Layer            | Technology                                           |
|------------------|------------------------------------------------------|
| Languages        | TypeScript (ES modules), Rust (edition 2021)         |
| Runtime          | Node >= 20                                           |
| Package manager  | pnpm workspaces                                      |
| Bundler          | Vite 6.x                                             |
| 3D rendering     | Three.js                                             |
| Testing          | Vitest (jsdom for renderer tests)                    |
| Rust / WASM      | Cargo, wasm-bindgen, rustfft; built via wasm-pack    |
| Planned          | Tauri desktop shell, WebGPU path, Python sidecar     |

## Architecture

The system is **message-bus-centric**. `MessageBus` (in `packages/core`) is
the central nervous system: components publish and subscribe to typed channels
(e.g. `audio:features`, `audio:error`). Wildcard subscriptions (`audio:*`) and
last-message replay are supported.

**Data flow:**
1. `AudioSource` captures audio (file or microphone via Web Audio API).
2. `AudioProcessor` extracts features (optionally via Rust/WASM FFT) and
   publishes `AudioFeatures` on `audio:features`.
3. `MandelbrotVisualizer` subscribes to audio features and modulates shader
   uniforms (zoom, palette, iteration depth) in response.
4. `SceneManager` drives the Three.js render loop.

If the WASM module fails to load, the system gracefully degrades to a
JS-only Web Audio fallback (implemented in `app.ts`).

Vite is configured with COOP/COEP headers (`same-origin` / `require-corp`) for
cross-origin isolation. `@cybernoetica/audio` is excluded from Vite's
`optimizeDeps` to avoid incorrectly bundling WASM glue code.

## Development

```bash
pnpm install          # Install all workspace dependencies
pnpm dev              # Start Vite dev server (apps/web)
pnpm test             # Run all Vitest suites
pnpm build            # Build all packages
```

### Building WASM (optional)

```bash
cd crates/audio-analysis
wasm-pack build --target web --out-dir ../../packages/audio/wasm
```

## Development Philosophy

Key principles from `guidebook/Design-Principles.md`:

- **Intuitiveness** -- Human-readable code with meaningful internal structure.
- **Modularity** -- Fluid manipulation, reuse, or replacement of components.
- **Hierarchy** -- Progressive complexity; curricular exposure for users and devs.
- **Extensibility** -- Clear hooks, plugin points, and abstraction layers.
- **Verifiability** -- Extensive programmatic and manual testing at all levels.
- **Parsimony** -- Maximal performance with minimal complexity.

## Known Issues and Notes

- **No `lint` scripts in workspace packages.** The root `pnpm lint` command
  (`pnpm -r lint`) will error because individual packages lack lint scripts.
  Either add per-package lint configs or remove the root lint script.
- **No JustFile yet.** A `JustFile` for common dev tasks is planned but not
  yet created.
- **WASM output is checked in.** The `packages/audio/wasm/` directory contains
  pre-built WASM artifacts. These should ideally be built in CI rather than
  committed, but are included for convenience during early development.
- **Planned but not yet implemented:** `apps/desktop/` (Tauri), `packages/math/`,
  `services/python-sidecar/`, `tests/` (integration/e2e). These are documented
  in the architecture spec.
- **`.DS_Store`** is present in the repo root and should be added to `.gitignore`
  (or removed).
