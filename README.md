# Cybernœtica

Vibe-Phenomenological Visualizer + Knowledge Portal

## Quick Start

```bash
# Prerequisites: Node.js 20+ (via Volta), pnpm, Rust toolchain
pnpm install
pnpm dev
```

Open http://localhost:5173. Click **Start** — a random visualizer and sample track begin automatically. Use the control bar to switch visualizers, browse tracks, or adjust appearance.

## Visualizers

- **Orbital** — Gravitational particle system with orbiting emitters and curl noise
- **Waveform** — Neon layered soundwaves flowing through space
- **Julia Set** — Shape-shifting fractal that morphs through interesting c-parameter regions
- **Mandelbrot** — Deep zoom into fractal boundary features with camera rotation

## Architecture

Message-bus-centric: all components communicate via typed pub/sub channels. See [AGENTS.md](AGENTS.md) for full architecture details, or [the design spec](docs/superpowers/specs/2026-04-02-cybernoetica-architecture-design.md).

## Development

```bash
pnpm test          # Run all tests (26 across 4 packages)
pnpm build         # Build all packages
pnpm dev           # Start Vite dev server
```

### Building WASM (optional — JS fallback works without it)

```bash
cd crates/audio-analysis
wasm-pack build --target web --out-dir ../../packages/audio/wasm
```

## Project Structure

- `apps/web/` — Vite web app (UI, orchestration)
- `packages/core/` — Message bus, shared types
- `packages/renderer/` — Three.js scene management, 4 visualizers
- `packages/audio/` — Web Audio capture + Rust/WASM analysis bridge
- `crates/audio-analysis/` — Rust FFT + spectral analysis crate
- `data/sample-music/` — Sample tracks for demos
- `guidebook/` — Design principles and documentation
