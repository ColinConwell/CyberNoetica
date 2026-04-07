# CLAUDE.md

Project instructions for Claude Code. See AGENTS.md for full documentation.

## Quick Reference

```bash
export PATH="$HOME/.volta/bin:$HOME/.cargo/bin:$PATH"
pnpm install && pnpm dev     # Dev server on :5173
pnpm test                    # 79 Vitest tests across 4 packages
pnpm build                   # Build all packages
```

## Stack

TypeScript + Vite 6 + Three.js + GLSL. pnpm workspaces. Vitest with jsdom. Optional Rust/WASM audio analysis.

## Architecture

- **Message bus** (`packages/core/message-bus.ts`): typed pub/sub, wildcard subscriptions, replay
- **Store** (`packages/core/store.ts`): reactive state with deep merge and selectors
- **Playback state machine** (`apps/web/src/managers/playback-state.ts`): single source of truth for playback (idle/loading/playing/paused/switching-source)
- **Visualizer registry** (`packages/renderer/src/visualizers/registry.ts`): self-registering visualizers with categorized params

## Key Conventions

- Visualizers live in versioned folders: `visualizers/{family}/v{NN}-{greek}.ts`
- Parameters use `category: 'appearance' | 'audio-mapping'`
- Audio-mapping params are multipliers (0-2, default 1) on audio-driven computations
- `settings.json` at repo root provides dev-time overrides (title, theme, track display) -- these are transient and should NOT be treated as canonical values
- Use `.env.local` for local env overrides (gitignored)
- The JUSTFile contains all dev/deploy commands

## Design Principles

See `guidebook/Design-Principles.md`. Priorities: intuitiveness, modularity, hierarchy, extensibility, verifiability, parsimony.
