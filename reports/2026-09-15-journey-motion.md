# 2026-09-15 — Journey transport, traces and audio motion

## Result

Journey now separates **point matching**, **flight path** and **transition marks**. Open **Visual → Journey → Transition motion** to experiment. Fresh routes use refined proximity, arcs and particles with traces. Previously saved version-1 routes without the new fields retain direct paths and particles. New fields round-trip through local storage and JSON export/import; generating a route preserves the selected transition options.

| Point matching | Behavior |
| --- | --- |
| Refined proximity | Existing projected assignment plus bounded sparse Sinkhorn refinement, with the existing fallback |
| Projected proximity | Deterministic best of seven projection rankings, without refinement |
| Angular order | Matches angular ranks around each cloud's own centroid |
| Sample order | Retains adapter index order, allowing longer, crossing journeys |

These are bounded bijective approximations or artistic correspondences, not claims of globally optimal transport. Every target receives exactly one source. Matching is fixed during each transition; changing matching during a transition takes effect on subsequent preparation. Internal contributor blending retains its existing refined correspondence.

Direct, arc and vortex paths use endpoint-preserving easing. Arcs bend perpendicular to travel in aspect-correct coordinates; vortex paths rotate around the viewport center and settle at the destination. Particle heads, velocity-aligned streaks and curved traces share the same flight equation. Traces comprise eight GPU ribbon segments per particle, taper behind the head, and fade to zero at both transition endpoints. They reconstruct a short portion of the current path; they are not a framebuffer history of earlier audio or endpoint states. Reduced-motion mode reduces bend and trace extent as well as existing guidance.

Traces add one draw call and a shared-attribute instanced geometry. They require no extra render targets and no accumulating history buffers. Geometry and material disposal are included in the rendering matrix. Presentation/guidance-only edits update without rerunning correspondence preparation.

## Audio changes

All ten Journey-compatible models gain **Audio sensitivity**, from 0 to 8, default 2.5. The same controls apply to their Individual versions. Journey exposes each contributor's audio controls under **Compose → contributor → Audio response**. Changing the contributor model refreshes its controls.

The visual envelope mapping is `g*x / (1 + (g-1)*x)`, where `x` is a clamped linear amplitude and `g` is sensitivity. Zero input remains zero; gain 1 is linear; larger gains lift quiet input while retaining bounded output. Gain zero disables these band/level mappings, but does not disable independent pitch, stereo, centroid or onset mappings. The analyzer, calibrated spectrum/waveform data and onset detection are unchanged.

- Faster attack and gentler release in the shared curve, model and Torus Knot engines. Curve/Torus Knot attack/release factors are 0.30/0.12; model factors are 0.25/0.10, scaled by frame duration. Shared-engine siblings also receive this timing improvement.
- Increased bass deformation in Lissajous, Torus Knot and the icosahedral sphere.
- Added independently adjustable **Bass → Expansion** to Lorenz, Rössler and Chen. It scales the displayed attractor without changing integration coordinates. Existing coefficient/speed mappings remain available and retain their bounds.
- Doubled the ranges of selected continuous movement mappings. Discrete topology switches and calibrated pitch controls retain their original limits.
- Raised new-route bass-spread/mid-swirl guidance defaults from 0.08/0.06 to 0.35/0.25, shortened their smoothing, and widened mapping amounts to ±3 with a final spatial guidance bound of ±1.5. Existing saved guidance values remain intact.

## Motion measurements

Run `pnpm test:motion`; use `MOTION_REPORT=1 pnpm test:motion` for numeric results. Thirteen tests replace “received audio without throwing” as the only evidence with explicit geometric checks.

Each of the ten models runs paired deterministic two-second trajectories: a silent control and a quiet band pulse from 0.5–1.25 seconds (bass 0.16, mid 0.12, high 0.08, RMS 0.12), sampled at 30 Hz. The probes read actual geometry, object transforms and shader deformation evaluators. Per-component centroids and axis spreads produce a geometric difference from the silent trajectory; its temporal derivative measures the rate of shape change. The tests require finite positions, prompt attack, nonzero sound-specific motion, exact silence matching at sensitivity zero, and additional response at maximum sensitivity. Brightness-only RMS modulation is a negative control: it must not count as Lissajous geometry movement. A sphere attack/release test checks 30/60/120 Hz agreement and settling after silence.

| Model | Default / linear sensitivity | Maximum / default sensitivity |
| --- | ---: | ---: |
| Orbital | 1.54× | 1.04× |
| Lissajous | 2.02× | 1.87× |
| Harmonograph | 1.95× | 1.80× |
| Spirograph | 1.99× | 1.83× |
| Rose Curve | 2.02× | 1.91× |
| Lorenz | 1.10× | 1.60× |
| Rössler | 1.78× | 1.38× |
| Chen | 1.88× | 1.60× |
| Torus Knot | 2.06× | 1.94× |
| Icosahedral Sphere | 2.02× | 1.87× |

Ratios compare sensitivity settings **within the new implementation**, not the old release against the new release. Values are mean sound-only differences in geometric summaries, not perceived loudness or optical-flow speed. Absolute world-space magnitudes are not comparable across families. Adaptive curve indices are not treated as persistent material identities. Particle birth/death and chaotic evolution can affect spatial distributions, so arbitrary audio or gains need not yield monotonically increasing motion. The fixture establishes a repeatable regression floor, not complete perceptual qualification.

## Validation

- **560 Vitest tests passed**: core 20, audio 26, renderer 429, web 85. Includes transport determinism/permutations, invalid data, workerless algorithm choice, cancellation, compatibility, bounds, motion response and the existing lifecycle suites.
- **TypeScript and production build passed.** Existing bundle-size and Browserslist-data warnings remain.
- **18 existing desktop/mobile Playwright cases passed**, plus both new Journey cases in the final focused run. Browser plugin/skill was not available; used the repository's regular Playwright workflow with installed Chrome. Chrome required execution outside the shell sandbox.
- **540 Journey rendering cases passed**, covering 90 directed pairs × two presentations × three fixtures with the new default arcs/traces. No shader/GL errors, flat output, endpoint discontinuities or retained geometry/texture objects.
- **72/72 catalog visualizers passed** parameter extrema, finite geometry, visible output and resource cleanup. Native checks passed 3/3; the actual worklet/fallback pulse and opposite-phase stereo fixture passed unchanged.

### UI flow and evidence

Flow: local app → Visual → Journey → change transition motion → expand contributor audio controls → change sensitivity → Next → pause → compare all nine path/mark combinations → reload saved settings.

Environment: `http://127.0.0.1:5173/?viz=lissajous&audio=soundscape&mute`, Chrome, desktop 1280×720 and mobile-emulated 390×844.

| Check | Result |
| --- | --- |
| Page identity and meaningful content | Passed; title supports the app's ligature spelling |
| Framework error overlay | None |
| Console/page errors | None in the new flow |
| Interaction | Angular worker selection, bend, contributor sensitivity and persistence verified |
| Rendered output | All nine path/mark combinations nonblank, GL-error-free and distinct in complete RGB fingerprints at a fixed transition midpoint |
| Layout | No horizontal overflow at either viewport; screenshots inspected |

Screenshots and generated measurements are saved outside the repository under `/tmp/cyber-journey-options-*.png`, `/tmp/cyber-journey-traces-*.png`, `/tmp/cyber-journey-matrix.json` and `/tmp/cyber-catalog-qa.json`. Earlier image-comparison iterations used only the red channel; the final comparison fingerprints all RGB channels and explicitly updates the paused frame before reading it.

Commands: `pnpm test`, `pnpm typecheck`, `pnpm build`, `pnpm exec playwright test`, `pnpm exec playwright test apps/web/e2e/journey-options.spec.ts`, `node scripts/run-journey-qa.mjs --full`, `node scripts/run-catalog-qa.mjs`.

## Remaining scope

The ten geometry-adapted models have quantified sensitivity coverage; the remaining catalog has runtime safety/rendering coverage, not equivalent motion calibration. Physical phones, other browser engines, real-music listening comparisons and sustained production-budget performance with traces remain to be measured. GPU cost depends on particle budget, path and trace length; the catalog/matrix runs are not a performance comparison. This pass is local and has not been deployed.
