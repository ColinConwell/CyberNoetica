# Developer workbench — 2026-09-15

## Delivered

Development builds now mount a separate, responsive Developer workbench. Open it with the top-left **Developer** button, the Control panel's **Open developer workbench** action, or **Alt + backtick**. Dock and wide layouts, Midnight/Ember/Paper themes, section folding, and keyboard-accessible up/down ordering persist locally. Production retains its existing debug diagnostics; the new workbench and local source endpoints are development-only.

The inspector enumerates the active visualizer's declared appearance, audio-mapping and view controls. Values come from the running visualizer, including edits made elsewhere. Read-only view fields stay read-only. Soundscape's four macro controls and full synthesis editor appear when Soundscape is active. The existing complete Journey editor appears when Journey is active. The normal Sound panel reads live Soundscape values when opened.

Search supports text/key fragments and local concept synonyms, including “brighter,” “slower,” “camera,” “sensitivity,” and “transition.” This is deterministic vocabulary expansion, not an embedding model or arbitrary natural-language reasoning. Searching opens matching nested editors without opening help popovers.

The logbook supports independent Debug/Info/Warning/Error selection, text filtering, freeze/resume, colored levels, and text-only rendering. It uses the existing bounded console buffer and shows the most recent 100 matching entries. Logs are deliberately separate from the automatic handoff payload.

## Record, annotate, hand off

1. Tune the visualizer, Soundscape, or Journey.
2. **Record state** freezes a versioned JSON configuration. It includes visualizer values/view, control bounds/defaults, active Soundscape patch/macros, active Journey definition, presentation preferences, menu preferences, viewport dimensions and measured diagnostic summary.
3. **Pick annotation target** selects a control without moving its slider or activating it. Explicit scoped control IDs take priority, then accessible names, then structural paths. The exported strategy identifies the fallback used. **Annotate canvas** hides the workbench temporarily and records a normalized canvas point plus the active visualizer type. Escape cancels.
4. Write an Issue, Requested edit, or Promote to default annotation. Annotations include their own configuration at the time they are added. They can be edited or removed. Local source lookup can attach a path/line reference.
5. **Export JSON**, **Export handoff**, or **Copy handoff** produces a reviewable configuration/change request. Once recorded, exports preserve that frozen configuration and include the current annotation list. Without a recording, the handoff captures current values. **Restore recorded visual controls** validates every value before applying it to the same model.

The workbench does not overwrite source defaults. The exported Markdown instructs a programming agent to reproduce the case, compare recorded values to the included defaults, make the requested changes and report validation. Payloads do not automatically include credentials, cookies, URL query parameters, audio buffers or arbitrary store contents. Annotation text is user-authored and should be reviewed before sharing.

## Local source navigation

The Vite-only `/__dev` router resolves a requested visualizer through the static manifest, or known Journey/Soundscape/menu editor targets. **Copy path:line** copies the absolute local location. An exact parameter declaration is preferred; otherwise the location points to the declaring module's definition. Shared engine implementation lines are not inferred. **Reveal in Finder** invokes macOS `open -R` with an allowlisted file path and no shell.

Requests must originate from a loopback connection with a local Host header. Cross-origin requests are rejected, and mutations require an Origin header. Arbitrary filesystem paths, symlinks outside the workspace and unknown targets are rejected. Finder launch itself was not exercised in automated tests.

## Menus and help

Visualizer groups and sound-source menus offer **Bubbles**, conventional **Rows**, and creative **Constellation** tiles. Preferences apply across those menus, with workbench controls for bubble spacing, tile columns, and text size. The existing descriptive visualizer list remains available.

Parameter help now uses keyboard/touch-accessible disclosures with Escape dismissal. Relevant response, frequency and scale controls include qualitative SVG schematics. These are explicitly labeled illustrations rather than simulated visualizer previews.

## Research informing the handoff

- Chrome DevTools supports exporting reproducible interaction flows as JSON. This workbench adopts a versioned portable artifact, but captures a configuration rather than claiming to record/replay every browser interaction. [Chrome Recorder](https://developer.chrome.com/docs/devtools/recorder/overview)
- Accessibility snapshots describe visible roles, names and attributes and can complement screenshots. Explicit control contracts and accessible names are preferred here, while structural fallback selectors are identified in the record. [Playwright snapshots](https://playwright.dev/docs/aria-snapshots)
- Performance traces can carry additional execution/source context. The workbench records a compact measurement summary; full Chrome traces remain an external debugging tool. [Chrome trace sharing](https://developer.chrome.com/docs/devtools/performance/save-trace)
- Official documentation confirms the requested `gpt-6-astra` identifier and Responses API support. No OpenAI request was made during the original workbench pass; subsequent live checks are in the AI studio report. [GPT-6 Astra](https://developers.openai.com/api/docs/models/gpt-6-astra)
- Provider interfaces are not interchangeable: OpenRouter documents OpenAI-compatible requests, Claude has its Messages API, Kimi documents the Moonshot endpoint, and Cursor exposes repository-oriented Cloud Agents. [OpenRouter](https://openrouter.ai/docs/quickstart), [Claude](https://platform.claude.com/docs/en/api/overview), [Kimi](https://platform.kimi.ai/docs/api/overview), [Cursor](https://cursor.com/docs/cloud-agent/api/endpoints)

## Validation

- `pnpm test`: **574 tests passed** across core (20), audio (26), renderer (437), and web/server (91).
- `pnpm typecheck`: passed.
- `pnpm build`: passed. Existing large-chunk and stale Browserslist warnings remain.
- `JOURNEY_QA_URL=http://127.0.0.1:5174 pnpm exec playwright test apps/web/e2e/developer-workbench.spec.ts`: **8 cases passed**, Chromium desktop 1280×720 and mobile emulation 390×844.
- Browser cases cover exact recorded parameter values, source lookup, layout switching, annotation identity, non-mutating target selection, normalized canvas points, Soundscape-to-normal-menu synchronization, Journey changes, safe log text and help schematics. Checked meaningful UI, runtime page errors and horizontal overflow; screenshots inspected for overlap and layout. Initial screenshot inspection exposed search opening help popovers, which was fixed.
- Chrome required execution outside the filesystem sandbox. The local Vite process did not reliably invalidate cached modules during edits, even after enabling polling; final checks used a restarted server and verified the current module was served. Generated evidence remains outside the repository.

## Limits and follow-up

- The initially deferred agent integration was completed after the user authorized local provider keys. See the [AI studio report](2026-09-15-ai-studio.md) for chat, tools, procedural creation, BYOK and live validation. The validation below describes the original workbench pass.
- The inspector exposes declared writable controls, not arbitrary private shader uniforms or simulation internals. New editable fields should be added to visualizer metadata so bounds and handoffs remain consistent.
- Recordings reproduce control configurations, not exact GPU state, random particle histories, source audio, animation time, or Journey transport position. Restore currently applies individual visual controls only; Journey and Soundscape definitions are exported for handoff, with their existing import/export editors still available.
- Canvas annotations identify a region and model, not individual GPU primitives. Structural DOM selectors can become stale after layout changes.
- Annotations and the latest recording remain in memory until exported. Menus and workbench layout preferences persist locally. Search synonyms are limited to the included vocabulary.
- This original workbench pass did not include live provider calls, physical-device validation, cross-engine checks, Finder GUI check, deployment, commit or push. Subsequent provider validation is recorded in the AI studio report.
