# Review implementation

Implemented locally September 8, 2026. This ledger records the selected implementation for each recommendation. All 62 original entries remain available; nine additional variants bring the catalog to 71. The pre-existing guidebook deletions are preserved. No changes have been committed or deployed.

## Shared systems

- [x] Complete, consistent audio DSP with fixed-hop worklet analysis, absolute levels, timbre, adaptive onset events, pitch/stereo features, and fixtures.
- [x] Elapsed-time visualizers, time-constant smoothing, continuous integrated phases, and event deduplication.
- [x] Source-level cancellation at every asynchronous commit, fetch abort, cleanup, and playback/startup recovery.
- [x] Auth-before-upload, cleanup, session configuration, throttling, safe paths and HTTP ranges; integration tests.
- [x] Reproducible production dependencies and actual audio analyzer deployment.
- [x] CPU/GPU measurements, adaptive workload budgets, power saver cadence, and deterministic renderer validation.
- [x] Worker-based foam, stable IDs, buffer reuse, and transparency/geometry improvements.
- [x] Metadata agreement, model classification, searchable accessible controls, reduced-motion/flash preferences.
- [x] Bounded offline storage and deployment-version recovery.
- [x] Production browser matrix, responsive interaction, numerical regressions, and endurance checks.

## Visualizers

- [x] [Orbital](packages/renderer/src/visualizers/orbital/v01-alpha.ts): Fixed 120 Hz physics, fractional emission, GPU color/fade, reproducible seeds and bounded forces. The model is classified as a designed simulation.
- [x] [Orbital (β)](packages/renderer/src/visualizers/orbital/v02-beta.ts): Emitter phases are integrated; Slow Orbital Drift is separate from rapid noise/turbulence.
- [x] [Cosmic Sculpt](packages/renderer/src/visualizers/orbital/v03-gamma.ts): Camera-plane ray placement, calibrated radius overlays and force caps; tests cover three camera orientations and suppress synthetic clicks after multi-pointer gestures.
- [x] [Waveform](packages/renderer/src/visualizers/waveform/v01-alpha.ts): Added DC-removed triggered oscilloscope and calibrated log-frequency spectrum modes; preserved the artistic layered mode.
- [x] [Mandelbrot](packages/renderer/src/visualizers/mandelbrot/v01-alpha.ts): Zoom is capped at 1000 for float32 coordinates; iteration count grows with depth and scales with the measured-cost quality budget.
- [x] [Burning Ship](packages/renderer/src/visualizers/mandelbrot/v02-beta.ts): Preserved manual centers across zoom cycles, bounded zoom, repaired escape coloring and added iteration-budget scaling.
- [x] [Julia](packages/renderer/src/visualizers/julia/v01-alpha.ts): Added main-cardioid, period-two bulb and disconnected seed paths; slowed seed motion and corrected default framing.
- [x] [Newton](packages/renderer/src/visualizers/newton/v01-alpha.ts): Uses integer degree with hysteresis, a consistent rotated polynomial, residual convergence and stationary non-root rejection.
- [x] [Lyapunov](packages/renderer/src/visualizers/lyapunov/v01-alpha.ts): Added AB/AAB/ABB/ABBA/event-seeded presets, correct derivative ordering, parameter-domain masking and half/full-window convergence diagnostics.
- [x] [Apollonian](packages/renderer/src/visualizers/apollonian/v01-alpha.ts): Added Descartes Packing: precomputed tangent circles, instanced edges and a tangency-preserving disk Möbius transform. The original inversion artwork remains available.
- [x] [Quaternion Julia](packages/renderer/src/visualizers/quatjulia/v01-alpha.ts): Added independent fourth-coordinate slice, bounded 4D rotation, stable-shape preset and explicit conservative step/hit-tolerance controls.
- [x] [Clifford](packages/renderer/src/visualizers/clifford/v01-alpha.ts): Identified the orbit-trap portrait explicitly; reduced coefficient excursions and fixed circular hue averaging. Strange Attractor provides the density representation.
- [x] [Kleinian](packages/renderer/src/visualizers/kleinian/v01-alpha.ts): Added Classical Schottky with explicit inverse-paired generators, disjoint defining circles and reduced-word sampling; original inversion controls remain artistic.
- [x] [Orbit Trap](packages/renderer/src/visualizers/orbittrap/v01-alpha.ts): Separated dynamics-only and measurement-only modes, exposed trap scale and bounded the Julia seed path.
- [x] [Voronoi](packages/renderer/src/visualizers/voronoi/v01-alpha.ts): Euclidean mode uses true bisector distance and derivative antialiasing; non-Euclidean edge proxies remain identified as alternative metrics.
- [x] [Voronoi (β)](packages/renderer/src/visualizers/voronoi/v02-beta.ts): Tessellation runs in a worker at 20 Hz with one job in flight. Buffers retain capacity; compatible topology interpolates briefly. Native edges are deduplicated within each cell.
- [x] [Voronoi (γ)](packages/renderer/src/visualizers/voronoi/v03-gamma.ts): Added a marked fundamental domain and optional face-neighbor images; shipped-WASM tests verify periodic translation and partition volume.
- [x] [Voronoi (δ)](packages/renderer/src/visualizers/voronoi/v04-delta.ts): Native output preserves input seed IDs through hidden-cell removal/reappearance; bounded radii and controls explicitly identify power weight as radius squared.
- [x] [Voronoi (ε)](packages/renderer/src/visualizers/voronoi/v05-epsilon.ts): Added analytic ball clipping plus a sampled spherical boundary. The cheaper tangent-plane wall remains selectable; curved mode disables explosion.
- [x] [Lissajous](packages/renderer/src/visualizers/lissajous/v01-alpha.ts): Replaced per-pixel segment searches with adaptive thick-line geometry; added confidence-gated pitch ratios and coherent stereo-phase mapping.
- [x] [Kaleidoscope](packages/renderer/src/visualizers/kaleidoscope/v01-alpha.ts): Integer symmetry changes on onsets; persistent inner/middle/outer regions follow the physical bass/mid/high bands.
- [x] [Hyperbolic](packages/renderer/src/visualizers/hyperbolic/v01-alpha.ts): Corrected mirror geometry, conformal edge scaling and valid-pair promotion; effective p and q are visible as read-only view fields.
- [x] [Chladni](packages/renderer/src/visualizers/chladni/v01-alpha.ts): Uses integer fixed-edge square membrane modes, a noncancelling equal-index case, frequency-selective resonance and damping.
- [x] [Chladni (Circular)](packages/renderer/src/visualizers/chladni/v02-beta.ts): Replaced inaccurate Bessel values/roots with cached validated eigenfunctions; physical frequency/Q excitation, damped amplitudes and full-membrane framing.
- [x] [Phyllotaxis](packages/renderer/src/visualizers/phyllotaxis/v01-alpha.ts): Draws every point as a GPU sprite; a fidelity preset preserves the golden angle and radial ripple controls describe their actual geometry.
- [x] [Superformula](packages/renderer/src/visualizers/superformula/v01-alpha.ts): Closed presets constrain angular symmetry/exponents; adaptive line geometry provides portable stroke width without radial-distance artifacts.
- [x] [Quasicrystal](packages/renderer/src/visualizers/quasicrystal/v01-alpha.ts): Preserves the wave direction set, modulates phase/amplitude and suppresses under-sampled high frequencies with derivatives.
- [x] [Domain Warp](packages/renderer/src/visualizers/domainwarp/v01-alpha.ts): Integrated each flow phase; smoothed audio-driven distortion and budgeted noise detail.
- [x] [Domain Warp (Recursive)](packages/renderer/src/visualizers/domainwarp/v02-beta.ts): Reused neighboring fragment derivatives for field shading, removing repeated complete warp evaluations; recursion/octaves follow the quality budget.
- [x] [Truchet](packages/renderer/src/visualizers/truchet/v01-alpha.ts): Deterministic motif hashes, onset-held configuration changes with crossfades, derivative antialiasing and persistent coarse structure.
- [x] [Harmonograph](packages/renderer/src/visualizers/harmonograph/v01-alpha.ts): Finite-age, onset-reexcited damped pendulum curves with rational ratios, rendered as sampled geometry.
- [x] [Moiré](packages/renderer/src/visualizers/moire/v01-alpha.ts): Integer angular stripes remove polar seams; derivative antialiasing and integrated rotation preserve two legible gratings.
- [x] [Plasma](packages/renderer/src/visualizers/plasma/v01-alpha.ts): Bass, mid and high energy weight distinct horizontal, vertical and diagonal components; variable rates use integrated phases.
- [x] [Flow Field](packages/renderer/src/visualizers/flowfield/v01-alpha.ts): Persistent tracers follow a cached analytic divergence-free Fourier field. Color represents calculated vorticity; trails share one batch.
- [x] [Spirograph](packages/renderer/src/visualizers/spirograph/v01-alpha.ts): Added exact epitrochoid/hypotrochoid geometry, integer radii, exact closure periods, adaptive sampling and integrated morph phase.
- [x] [Automata](packages/renderer/src/visualizers/automata/v01-alpha.ts): Added Conway Life with persistent ping-pong state, fixed generation timing and bounded onset seeding. The original stateless artwork remains available.
- [x] [Reaction-Diffusion](packages/renderer/src/visualizers/reaction/v01-alpha.ts): Added persistent GPU Gray–Scott fields with stable diffusion substeps, curated feed/kill presets, slow timbre modulation and localized onset injections.
- [x] [Rose Curve](packages/renderer/src/visualizers/rosecurve/v01-alpha.ts): Signed rational curves, minimal closure periods, topology hysteresis and adaptive thick-line geometry replace the radial-distance proxy.
- [x] [Penrose](packages/renderer/src/visualizers/penrose/v01-alpha.ts): Added Robinson-triangle Penrose inflation with shared matching edges and global transforms. Original pentagrid artwork remains available.
- [x] [Soliton](packages/renderer/src/visualizers/soliton/v01-alpha.ts): Added exact two-soliton Hirota collisions, including phase shifts and the KdV amplitude/width/speed relation; sound selects pulse energy between cycles.
- [x] [Terrain](packages/renderer/src/visualizers/terrain/v01-alpha.ts): Replaced the expensive marcher with an explicit GPU height mesh and quality-dependent subdivision. Vertex heights, central-difference normals and integrated scrolling preserve the landscape mapping.
- [x] [Geodesic](packages/renderer/src/visualizers/geodesic/v01-alpha.ts): Added a subdivided icosahedron with real barycentric triangle edges and a spherical camera; retained the original faceted-sphere artwork.
- [x] [Tunnel](packages/renderer/src/visualizers/tunnel/v01-alpha.ts): Bounded twisted/radius-varying marching steps, bracketed hit refinement and integrated travel phase; spectral wall components remain distinct.
- [x] [Interference](packages/renderer/src/visualizers/interference/v01-alpha.ts): Added a stationary nondispersive mode with temporal frequency tied to wavenumber, 2D far-field spreading and stereo source phase.
- [x] [Metaballs](packages/renderer/src/visualizers/metaballs/v01-alpha.ts): Uses analytic field gradients and circular hue blending. Existing bounded source count keeps evaluation cost predictable.
- [x] [Mandelbulb](packages/renderer/src/visualizers/mandelbulb/v01-alpha.ts): Protected singularities, stable-parameter preset, conservative step/hit controls and separate iteration budget.
- [x] [Magnetic Field](packages/renderer/src/visualizers/magnetic/v01-alpha.ts): Balanced the original alternating poles; added physical vector-dipole field lines integrated with RK4.
- [x] [Gyroid](packages/renderer/src/visualizers/gyroid/v01-alpha.ts): Analytic normals, conservative field-distance bound and bounded deliberate thresholds; accurately described as a nodal surface approximation.
- [x] [Hopf Fibration](packages/renderer/src/visualizers/hopf/v01-alpha.ts): Exact stereographic division away from infinity, explicit pole clipping and GPU-generated ribbon fibers in a single batch.
- [x] [Caustics](packages/renderer/src/visualizers/caustics/v01-alpha.ts): Added normalized forward deposition of Snell-refracted light with Fresnel transmission onto a linear half-float receiver; retained the labeled fast proxy.
- [x] [Ferrofluid](packages/renderer/src/visualizers/ferrofluid/v01-alpha.ts): Corrected optical units and added refractive indices, Snell angles, signed Fresnel amplitudes and film interference phase. Surface spikes remain an artistic free-surface analogy.
- [x] [Aurora](packages/renderer/src/visualizers/aurora/v01-alpha.ts): Coherent directional advection, altitude-inspired emission colors and a single curtain evaluation shared by sky/reflection.
- [x] [Dendrite](packages/renderer/src/visualizers/dendrite/v01-alpha.ts): Finite-age branching with explicit fade/reset cycles; documented as procedural growth.
- [x] [Torus Knot](packages/renderer/src/visualizers/torusknot/v01-alpha.ts): Replaced nested raymarch segment searches with tube geometry; every gcd(p,q) link component is rendered and geometric closure/separation are tested.
- [x] [Strange Attractor](packages/renderer/src/visualizers/attractor/v01-alpha.ts): Cached deterministic Clifford trajectories with transient burn-in and time-normalized occupancy accumulation.
- [x] [Hopalong](packages/renderer/src/visualizers/attractor/v02-beta.ts): Preserved the recurrence, deterministic seeds and explicit burn-in; replaced per-pixel trajectories with cached density.
- [x] [De Jong](packages/renderer/src/visualizers/attractor/v03-gamma.ts): Slow bounded coefficient evolution and persistent density with controlled temporal decay.
- [x] [Ikeda Map](packages/renderer/src/visualizers/attractor/v04-delta.ts): Curated dissipative range, a tested nondegenerate default and cached trajectories; degenerate manual regions are described honestly.
- [x] [Aizawa](packages/renderer/src/visualizers/attractor/v05-epsilon.ts): Shared fixed-step RK4, actual 3D batched trails and a parameter box tested at all 64 corners from the seeded basin.
- [x] [Lorenz](packages/renderer/src/visualizers/lorenz/v01-alpha.ts): Curated butterfly parameter envelope, small bounded drive, fixed RK4 steps, batched ribbons and independent appearance modulation.
- [x] [Rössler](packages/renderer/src/visualizers/lorenz/v02-beta.ts): Curated single-scroll parameter envelope and driven c range; fixed-step integration and batched ribbons.
- [x] [Chen](packages/renderer/src/visualizers/lorenz/v03-gamma.ts): Curated dual-wing coefficient box and bounded drive; corner/basin tests and the shared fixed-step trail renderer.

## Scope choices and limits

The original review presented several alternatives and optional research directions. This implementation takes the zoom-cap alternative instead of arbitrary-precision fractals; explicit height geometry instead of terrain sphere tracing; hardware field derivatives instead of additional recursive-warp render targets; and fixed conservative point/seed caps where an adaptive count would alter topology. Shader iteration/octave budgets and terrain subdivision scale with quality. Foam retains each cell’s separate shared faces because explosion and independent cell appearance require them; repeated edges within a cell are removed. Its additive x-ray faces are not a physical glass model.

A numerically relaxed minimal gyroid, 3D metaballs, diffusion-limited crystal growth, a magnetic free-surface solver, tempo tracking and multiple simultaneous FFT window sizes remain optional extensions. The existing approximations are identified in the UI. CPU/GPU p50/p95 and object counts are measured; JavaScript heap size is shown only when available. Portable allocation-rate and electrical-power measurements are unavailable and are not inferred from heap deltas or frame cadence.

The shared feature contract and sensitivity control are documented in [docs/audio-features.md](docs/audio-features.md). Worklet and fallback use the same DSP and preserve stereo energy. The fallback can skip analysis windows when the main thread stalls. Source monitoring is disabled for microphone/system capture to avoid feedback and duplicated audio.

## Verification

See [docs/runtime-validation.md](docs/runtime-validation.md) for commands, QA entry points and interpretation of measurements. Numerical tests cover equations, geometry, closed curves, parameter basins, calibrated signal fixtures and source races. The QA page exercises the shipped worklet, native WASM, shader compilation, parameter extremes, visible output and GPU-resource disposal. It is excluded from normal production builds.

Final validation passed: 499 Vitest tests, three Rust reference tests, TypeScript checking, the production build, the actual Docker build and 16 container HTTP checks. The in-app browser passed all 71 catalog entries and all three native-WASM checks. A four-pulse stereo fixture produced exactly four onsets with identical worklet/fallback RMS. A separate 60-switch run retained no geometry/texture objects; a 390 × 844 UI check covered search, focus, playback recovery and the 30 FPS power-saving cadence. Catalog measurements, 71 previews and command logs are preserved in the review's `review-evidence/implementation` artifact directory.

In-app browser checks establish behavior on this computer, not all-parameter mathematical proofs, real-device mobile performance, every browser’s capture permissions, hour-long heap stability or deployed Railway configuration. Perceptual mapping quality still benefits from listening sessions across genres and levels.
