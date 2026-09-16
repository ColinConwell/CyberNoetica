# Expressive curves — 2026-09-15

## Why Lissajous still felt static

The previous gain increase made audio-driven motion measurable, but a single completed curve could still read as a colored outline that breathed in place. Centroid and spread measurements alone allow that behavior to pass. This pass adds independent motion inside the shape and visible travel along it.

## Implemented behavior

| Model | Spatial response |
| --- | --- |
| Lissajous | Four default phase-offset echoes weave independently. Mids accelerate phase evolution and separation; treble adds traveling local ripples; onsets briefly twist the curves. Bass changes size and aspect. Luminous heads travel around each echo. |
| Harmonograph | Mids accelerate pendulum evolution; treble changes the second pendulum's relative phase. |
| Spirograph | Mids drive rolling phase, alternating layers counterrotate, and treble changes pen sweep. |
| Rose Curve | Mids drive relative counterrotation; treble changes each layer's radius with an independent phase. |

Lissajous exposes Shape expression (0–2), Echo curves (1–6), Trace travel (0–4), and separate mid, treble and onset mappings. Set expression to 0, echoes to 1 and trace travel to 0 for an unwarped harmonic curve with uniform light. Existing audio sensitivity and mapping controls remain available. The default amplitude leaves more space around the weave in a narrow viewport; extreme amplitude and zoom settings can still intentionally extend beyond the viewport.

The echoes are simultaneous phase variants, not stored history. Periodic modulation preserves closed curves but extends the strict Lissajous equations artistically; model documentation now says so. The other three families retain their pendulum, roulette and rhodonea constructions.

## Individual and Journey rendering

The shared curve renderer still uses one segment batch and one draw call. Layers can now carry stable identities, optional uniform sampling and traveling intensity. Lissajous uses a fixed parameter partition so each Journey sample stays attached as its curve deforms. Echoes and heads are separate components in the transition adapter. Other curve families retain adaptive sampling.

The same updated model geometry feeds Individual and Journey modes. The earlier transport/path/trace controls remain available; this pass improves the models during their dwell and while they participate in a transition.

## Stronger measurement contract

`pnpm test:motion` now includes `curve-dynamics.test.ts` as well as the ten-model motion suite. The new tests compare normalized pairwise distances between 64 samples at several separations along a curve. Translation, rotation and uniform scale leave this signature unchanged, so camera motion or a zoom pulse cannot satisfy the shape-change requirement.

Eight new tests cover:

- The metric's invariance to whole-shape transforms and sensitivity to local bending.
- Independent mid, treble and onset responses exceeding a 0.025 RMS signature difference within 250 ms, with each mapping's zero setting matching the silent baseline.
- A brightness-only negative control.
- Agreement at 30, 60 and 120 Hz.
- Stable Journey revisions, finite live geometry and preserved alpha through rapid deformation.
- Finite extreme settings and closure of every echo and head.

These are deterministic geometry requirements, not perceptual scores. They do not establish that every catalog entry feels exciting, or that real music produces equal motion across genres.

## Validation

- All **568 unit tests** passed: core 20, audio 26, renderer 437, web 85.
- TypeScript checks, QA build and normal production build passed; validation pages are excluded from normal output.
- In-app browser: **540/540 Journey cases** passed (90 directed pairs, two styles, three signals).
- In-app browser: all six shared curve renderer users passed catalog checks: Lissajous, Harmonograph, Spirograph, Rose Curve, Superformula and KdV Collision. Native checks passed 3/3; production audio validation passed; no warning/error console entries were observed in that run.
- The original Lissajous tab was visually inspected with muted Soundscape playback; Echo curves was changed to one and restored to four through the actual Visual panel.

No deployment is part of this pass. Physical devices, other browser engines and performance at maximum expression during long sessions remain unqualified. Existing bundle-size and Browserslist warnings remain.

## Next catalog pass

Apply the same requirement with model-specific metrics: differential velocity and lifetime for particles; trajectory separation and tracer travel for attractors; local curvature and wave propagation for surfaces; bounded parameter paths for fractals. Add true temporal trails where following a point through time improves legibility. These are proposed extensions, not changes included here.
