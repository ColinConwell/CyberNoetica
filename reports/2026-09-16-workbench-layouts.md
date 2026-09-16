# Developer Workbench layouts — 2026-09-16

## Result

The Developer button defaults to **Above Controls**, centered directly above the bottom control bar. **Developer button position** also offers **In Control Bar** (after Control), Top Left, Top Right, Bottom Left and Bottom Right. All positions retain the same shared glass-button formatting as the main controls. Floating positions follow the app viewport when a workbench dock is open; the integrated button follows the control bar's fade behavior.

**Workbench layout** offers the existing Overlay/Wide Overlay plus **Left Sidebar**, **Right Sidebar**, **Top Panel**, and **Bottom Panel**. The last placement in the user's prose was interpreted as Top Panel, consistent with the subsequent top/bottom requirement. A Dock size slider adjusts the dock's width or height.

Docking changes the actual available app viewport. The canvas, camera/resolution updates, title, standard panels, control bar, keyboard overlay, and logs share that viewport. Closing a dock restores the full view. This uses an explicit `app-surface` containing block and a ResizeObserver on the canvas container. Floating log dragging accounts for the displaced viewport's origin. Bottom-stack measurements use actual wrapped control/keyboard heights, and the above-controls button reserves space beneath ordinary panels.

Top/bottom docks arrange sections in a responsive grid. Each open card scrolls independently. Its bottom-right resize handle adjusts height and snaps width to grid columns; Arrow keys offer the same resize operation. Narrow phone layouts keep cards full-width while retaining adjustable heights. Grid sizes persist with section order, folding, theme, dock placement/size and launcher position.

## Annotation review

| Feedback | Implemented behavior |
| --- | --- |
| Launcher position and matching appearance | Six placement choices; centered above controls by default; shared `glassButton` styles |
| Displacing sidebar and additional docks | Left/right/top/bottom layouts with a resized app viewport and adjustable dock size |
| Control counts and visualizer context | Removed appearance/audio control count; a highlighted visualizer chip sits above a one-sentence panel overview |
| Crowded target and annotation fields | Separate Configuration, Annotation and Share & Handoff groups, consistent spacing, target chip and labeled intent |
| Fixed section indices | Removed numeric prefixes; stable internal section IDs preserve saved ordering |
| Folding actions | Unfold/Fold buttons share one group |
| Reordering actions | Up/Down and drag grip share one group on every section; touch/mouse pointer handling and keyboard arrows supported |
| Source actions | Grouped Locate/Copy/Reveal, introductory sentence, separate readable source/diagnostic blocks |
| Title casing | Developer Workbench and section headings use title case |
| Shared spacing | Parameter rows and labeled fields have consistent gaps/wrapping; normal panels and logs fit the available viewport |

Dragging near the section scroll area's edge scrolls the list. Escape or a cancelled pointer gesture restores the previous order/size. Escape cancels a drag without closing the workbench. Keyboard up/down alternatives remain available in all layouts.

## Validation

- **589 unit tests passed** across the workspace.
- TypeScript checks and production build passed. Existing bundle-size and outdated Browserslist warnings remain.
- **43 distinct Chrome browser cases passed** across desktop 1280×720 and mobile emulation 390×844, including eight new layout cases and 35 existing workbench, Journey, Soundscape and AI studio cases. The new layout cases were rerun after final interaction refinements. The 867×998 annotation-reference viewport was also captured and reviewed.
- Layout tests verify all launcher choices, identical button formatting, persistence, all four dock boundaries, canvas resize, restored full viewport, normal Soundscape controls inside the displaced app, pointer and keyboard reorder/resize, drag cancellation, saved grid layout, grouped annotation/source actions, title casing and absence of horizontal page overflow.
- Browser checks cover page identity, meaningful content, absence of framework overlays, runtime/console errors and screenshots. An overbroad empty-element CSS selector initially hid the annotation textarea; it was narrowed. A resize test was updated to bring the handle into view after enlarging a card, and launcher geometry assertions wait for layout transitions to settle.
- Browser plugin unavailable; used the repository's Playwright/Chrome setup. Final checks used restarted Vite processes because this environment's watcher did not reliably invalidate edited modules.

Key commands:

```sh
pnpm test
pnpm typecheck
pnpm build
JOURNEY_QA_URL=http://127.0.0.1:5174 pnpm exec playwright test
JOURNEY_QA_URL=http://127.0.0.1:5174 pnpm exec playwright test apps/web/e2e/workbench-layout.spec.ts
```

The general browser run deliberately skips paid live-provider checks, production-only checks and duplicate mobile server-tool execution. No API behavior changed in this update.

## Limits

- Very narrow side-by-side layouts necessarily leave a small app viewport; controls wrap and panels scroll. Top/bottom layouts provide wider controls on phones. Grid width resizing becomes full-width stacking at phone sizes.
- Reordering/resizing is supported through pointer events and accessible keyboard alternatives. Physical touch devices, screen-reader sessions and non-Chromium engines were not tested.
- No deployment, commit or push was performed. Screenshots and generated browser evidence remain outside the repository.
