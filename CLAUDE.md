# CLAUDE.md

Project instructions for Claude Code. See AGENTS.md for full documentation.

## Quick Reference

```bash
export PATH="$HOME/.volta/bin:$HOME/.cargo/bin:$PATH"
pnpm install && pnpm dev     # Dev server on :5173
pnpm test                    # 58 Vitest tests across 4 packages
pnpm build                   # Build all packages
```

## Stack

TypeScript + Vite 6 + Three.js + GLSL. pnpm workspaces. Vitest with jsdom. Optional Rust/WASM audio analysis.

## Architecture

- **Message bus** (`packages/core/message-bus.ts`): typed pub/sub, wildcard subscriptions, replay
- **Store** (`packages/core/store.ts`): reactive state with deep merge and selectors
- **Playback state machine** (`apps/web/src/managers/playback-state.ts`): single source of truth for playback (idle/loading/playing/paused/switching-source)
- **Visualizer registry** (`packages/renderer/src/visualizers/registry.ts`): self-registering visualizers with categorized params
- **View state** (`getViewState()` / `setViewState()`): per-visualizer coordinate system with domain-specific field names (e.g., `centerReal`/`centerImaginary` for Mandelbrot, `orbitAngle`/`elevation`/`distance` for Orbital)

## Change Documentation

Add new dated entries to `CHANGELOG.md` for completed changes. For dense updates, write `reports/YYYY-MM-DD-topic.md`, add a dated link and summary to `reports/README.md`, and link the report from the changelog. Follow the full change-documentation rules in `AGENTS.md`.

## Key Conventions

- Visualizers live in versioned folders: `visualizers/{family}/v{NN}-{greek}.ts`
- Parameters use `category: 'appearance' | 'audio-mapping'`
- Audio-mapping params are multipliers (0-2, default 1) on audio-driven computations
- View state fields use `viewStateFields` in metadata + `getViewState()`/`setViewState()` methods
- `settings.json` at repo root provides dev-time overrides (title, theme, track display, launch config) -- these are transient and should NOT be treated as canonical values
- Launch config: URL params (`?viz=`, `&audio=`, `&mute`, `&autostart`) or `settings.json` `launch` block can auto-start with specific visualizer/audio source; `?mute` suppresses speaker output while keeping audio analysis active for visualizers
- Use `.env.local` for local env overrides (gitignored)
- The JUSTFile contains all dev/deploy commands; audio management via `scripts/upload-audio.sh`
- UI z-index, spacing, timing, and dimensions are centralized in `apps/web/src/ui/constants.ts` -- never hardcode inline
- Typed globals via `apps/web/src/globals.ts` -- never use `(window as any)` for `__cybernoetica`
- Theme values are resolved at module load from `styles.ts`; use `glassBackground(opacity)` for custom opacity

## Design Principles

See `guidebook/Design-Principles.md`. Priorities: intuitiveness, modularity, hierarchy, extensibility, verifiability, parsimony.
