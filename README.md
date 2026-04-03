# CyberNoetica

Vibe-Phenomenological Visualizer + Knowledge Portal

## Quick Start

```bash
# Prerequisites: Node.js 20+, pnpm, Rust toolchain
pnpm install
pnpm dev
```

Open http://localhost:5173. Load an audio file or enable your microphone to see the Mandelbrot fractal pulse with the music.

## Architecture

See [docs/superpowers/specs/2026-04-02-cybernoetica-architecture-design.md](docs/superpowers/specs/2026-04-02-cybernoetica-architecture-design.md) for the full design spec.

## Development

```bash
pnpm test          # Run all tests
pnpm build         # Build all packages
pnpm dev           # Start Vite dev server
```

### Building WASM (optional -- fallback works without it)

```bash
cd crates/audio-analysis
wasm-pack build --target web --out-dir ../../packages/audio/wasm
```

## Project Structure

- `apps/web/` -- Standalone web app (Vite + TypeScript)
- `packages/core/` -- Message bus, shared types
- `packages/renderer/` -- Three.js scene management, visualizers
- `packages/audio/` -- Web Audio capture + Rust/WASM analysis bridge
- `crates/audio-analysis/` -- Rust audio analysis crate
