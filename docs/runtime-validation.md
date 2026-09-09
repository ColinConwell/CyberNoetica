# Runtime validation

Use `pnpm test`, `pnpm typecheck`, and `pnpm build`. The build produces the SPA, AudioWorklet, foam worker, WASM assets, and an Express server bundle. The Docker runtime copies those outputs and installs no separate runtime package versions. The build uses the committed pnpm lockfile.

The server's HTTP integration suite exercises ranges (including suffix and unsatisfiable requests), HEAD, missing assets, traversal and symlink escapes, authentication before multipart parsing, upload cleanup, production cookies, and login throttling. Production authentication requires a session secret of at least 32 characters. `TRUST_PROXY_HOPS` must match the deployed reverse-proxy topology; direct deployments should set it to zero.

Rendering measurements distinguish presentation cadence, CPU work, and asynchronous GPU elapsed time. GPU time is unavailable when the browser does not expose `EXT_disjoint_timer_query_webgl2`; no value is guessed. Disjoint samples are discarded. These metrics do not measure electrical power. Power Saver caps update and rendering cadence to 30 Hz while preserving the selected quality mode.

Audio files are network-only in the service worker. Entry-count limits do not bound the bytes occupied by large music files, and authenticated media should not be cached implicitly. The versioned static precache is cleaned on activation. Missing media and asset URLs never fall back to the SPA document.

Foam tessellation runs at most 20 times per second in a dedicated worker, with only one request in flight. Native output includes persistent seed identities and omits repeated edges within each polyhedron. GPU buffer capacity grows geometrically; palette and explode transforms run in vertex shaders between tessellations. Translucent faces use additive rendering for order-independent x-ray appearance, rather than implying physically correct glass transmission.

## Browser QA

Build and serve the opt-in validation entry point locally:

```sh
CYBER_QA=1 pnpm build
CYBER_QA=1 pnpm --filter @cybernoetica/web preview --host 127.0.0.1 --port 4191 --strictPort
```

Open `http://127.0.0.1:4191/validation.html` in the in-app browser and select Run. The page renders every catalog entry at 640 × 360, compiles shaders, exercises parameter extrema and silence, checks finite geometry and visible output, and verifies GPU geometry/texture counts after disposal. It also loads the shipped Voro++ WASM and runs a muted stereo pulse fixture through the actual decoder, AudioWorklet and fallback analyzer. A local QA-only endpoint saves JSON measurements and PNG previews under the system temporary directory; the page displays that path. Neither the QA entry nor this endpoint is included in the normal production server.

The query parameters `types` (comma-separated registry IDs), `repeat` (1–20), and `frames` (45–600) allow focused transition runs. For example, `?types=terrain,hopf,voronoi-epsilon,reaction-beta,caustics-beta,torusknot&repeat=10` exercises 60 switches. Run `pnpm build` again to restore the ordinary production output after QA.

The QA CPU column measures synchronous update/submission work and includes compilation overhead. Use the normal app's Performance panel for sustained CPU/GPU p50/p95 and cadence measurements; these runs do not establish a before/after speedup.

## Recorded validation — September 8, 2026

| Check | Result |
| --- | --- |
| Vitest | 499 passed: core 20, audio 19, renderer 375, web 85 |
| Rust reference analyzer | 3 passed |
| TypeScript and ordinary production build | Passed |
| Actual Docker image | Built successfully; 16 HTTP smoke checks passed |
| In-app browser catalog | 71/71 passed; no shader/GL errors, nonfinite geometry, flat-output warnings or retained geometry/texture objects |
| Shipped native WASM | 3/3 passed: box partition, periodic translation and weighted-cell identity |
| Shipped audio path | Four pulses produced exactly four onsets; opposite-phase stereo retained its energy; worklet/fallback maximum RMS both 0.2121286207049818 |
| Repeated heavy visualizer transitions | 60 switches without render errors, flat-output flags or retained geometry/texture objects |
| Responsive UI | Checked at 390 × 844: no horizontal overflow, search/no-results, visualizer switching, model details, Escape/focus restoration and labelled controls |
| Playback and preferences | Browser-gesture recovery, Soundscape and No Audio transitions, reduced-onset preference and 30 FPS Power Saver checked |

The Docker smoke checks cover authentication, secure session attributes, audio listing, suffix/unsatisfiable ranges, HEAD, missing-asset handling, SPA delivery, delivery of the worklet/foam-worker/WASM artifacts, and exclusion of QA. The automated server suite additionally covers adversarial paths, uploads and throttling.

The catalog run is saved as `results.json` plus 71 previews in the review's `review-evidence/implementation` artifact directory. Test, build, native-build and Docker logs are stored alongside it. The 60-switch and responsive UI results were observed separately; they are not rows in the catalog JSON.

These checks cover this computer's in-app browser. Mobile viewport emulation does not establish real-device performance. Safari/Firefox, live OS capture permission flows, hour-long heap stability, deployed Railway configuration and service-worker upgrades between separately deployed versions still need environment-specific verification. Capture cancellation is covered by automated mocks; the review did not request microphone or screen-capture permissions. Existing production-build warnings about the main chunk size and Browserslist data remain visible in the build log.
