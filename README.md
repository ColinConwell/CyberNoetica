# Cybernœtica

GPU-accelerated audio visualization with 72 selectable models, simulations and artistic patterns. The Visual panel includes searchable controls and model explanations. The knowledge portal remains future work.

## Hosted versions

- [Stable production](https://cybernoetica.app) follows the reviewed `main` branch.
- [Latest preview](https://demo.cybernoetica.app) follows `latest`, including changes that have not yet been reviewed for production.

Merging `latest` into `main` triggers Railway to build and deploy production. Opening or approving the PR alone does not deploy it. Review the preview first and verify production health and sample audio after merging. Both services use the root Dockerfile and `/api/health` deployment check. Preview has no sample-audio volume; use Soundscape Loop or a local file. Production retains its existing `/data/audio` volume.

`app.imbasso.com` and `app.imbasso.art` are retired. Deployment and audio-upload helpers default to `https://cybernoetica.app`; set `DEPLOY_HOST` explicitly to target another host. See the [release setup report](reports/2026-09-11-production-preview.md) for service mappings and validation.

## Run locally

```sh
pnpm install --frozen-lockfile
pnpm dev
```

Use Node.js 20+ and pnpm 10.33.0. Open http://localhost:5173 and select Start. With no sample tracks, the visuals can still run; select Soundscape Loop in Sound for generated audio. Microphone and system capture feed analysis without playing the captured signal back through the speakers.

Example: `http://localhost:5173/?viz=lissajous&audio=soundscape&mute`.

## Models and sound

The catalog spans fractals, closed curves, membranes, particle systems, Voronoi foam, chaotic flows and optical patterns. New faithful variants include Gray–Scott, Conway Life, Descartes Packing, Penrose Inflation, Icosahedral Sphere, Classical Schottky, KdV Collision, Dipole Field Lines and Refracted Caustics. The original artistic variants remain available.

A shared AudioWorklet analyzes stereo audio with a 4096-sample Hann FFT and 512-sample hop. The complete main-thread fallback uses the same DSP. Absolute level, spectral balance, pitch, stereo phase and onsets have distinct meanings; see [the audio contract](docs/audio-features.md). Analysis gain changes visual sensitivity independently of speaker volume.

## Development and validation

```sh
pnpm test
pnpm typecheck
pnpm build
```

[The changelog](CHANGELOG.md) records the formulation, mapping and optimization changes for every original visualizer. [Runtime validation](docs/runtime-validation.md) describes numerical tests, the in-app browser QA page and deployment checks.

Voro++ foam uses the committed WASM and a dedicated worker. Rebuild it with `just wasm-voro`. Rust is needed only for the optional reference analyzer in `crates/audio-analysis`; production audio does not depend on generated Rust WASM.

## Architecture

- `apps/web`: Vite SPA, UI, playback/source coordination and bundled Express production server.
- `packages/core`: typed message bus, state store and feature contract.
- `packages/audio`: audio capture, stereo DSP, AudioWorklet and signal fixtures.
- `packages/renderer`: Three.js lifecycle, GPU timing, adaptive quality, model geometry and lazy visualizer catalog.
- `native/voro-wasm`: Voro++ wrapper with persistent input seed identities.
- `docs`: model contracts and verification workflow.

The Docker image builds against the frozen workspace lockfile and includes the real worklet, workers and WASM. Configure a strong session secret when enabling the production auth gate. Audio is served with native byte-range support and is intentionally not cached by the service worker.
