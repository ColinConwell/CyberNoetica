# Studio Controls and Viewport Navigation — 2026-09-16

## Result

- Developer and **AI Studio** share one Studio Controls group, centered immediately above the main controls by default. The existing placement menu now moves both buttons together: above, inside the main bar, or any corner. Both retain the main buttons’ glass styling. Displacing docks continue to move the whole application viewport.
- **Control → Interface → Control Visibility** offers **Always Visible** and **Hover & Fade**. Development defaults to Always Visible; production defaults to Hover & Fade. Explicit choices persist in localStorage. Hover/focus protects the controls; moving near the bottom edge or the studio group, clicking, or typing reveals both groups. Open workbenches also prevent fading.
- Clicking the canvas transfers focus from previous controls; otherwise retained button focus would prevent fading indefinitely. Keyboard R reset and Space visibility toggling in automatic mode remain available from the focused canvas.
- `AGENTS.md` now records the preference for Title Case in headings, panel names, buttons, tabs, menu items and control labels. Explanatory prose, tooltips and logs use sentence case. AI Studio headings, launchers and entry buttons follow the preference.

## Navigation

The mouse conventions follow Blender’s documented middle-button orbit, Shift-middle pan, Ctrl-middle zoom and wheel zoom ([official navigation manual](https://docs.blender.org/manual/en/4.4/editors/3dview/navigate/navigation.html)). Alt-left provides middle-button emulation. The browser adds explicit modifier-scroll alternatives without guessing whether a wheel event came from a mouse or trackpad.

| Input | Result |
| --- | --- |
| Middle-drag / Alt-left-drag | Orbit in 3D; pan in 2D; Alt-left rotates a supported 2D rotation field |
| Shift-middle / Shift-Alt-left | Pan where supported |
| Ctrl-middle / Ctrl-Alt-left | Dolly or zoom where supported |
| Wheel / trackpad scroll / trackpad pinch | Proportional zoom with normalized wheel units |
| Shift-scroll | Pan |
| Alt-scroll | Orbit or supported 2D rotation |
| Two-finger touch gesture | Simultaneous pinch zoom and centroid pan |
| Double-click / R | Reset view |

Primary-button sculpt placement and right-button repulsors remain separate from navigation. Cancelled touches release gesture state. Zoom respects each visualizer’s declared range. Perspective camera translation is exposed as Camera Target X/Y/Z in view state, so workbench controls, recordings, restoration, and agent view edits share the same values; resetting creates a fresh target at the origin. Existing autonomous 3D drift behavior remains in place.

## QA

Browser plugin not available; used the repository’s Playwright workflow against `http://127.0.0.1:5174/` and the built local Express app at port 4177. Desktop 1280×720 and mobile-sized 390×844; annotation/layout tests also use 867×998. Flow: launch muted Lissajous → inspect grouped controls → change visibility/placement → navigate canvas → restore camera → inspect AI Studio and dock behavior.

| Check | Result |
| --- | --- |
| Page identity, nonblank canvas, framework overlay, console health | Passed |
| Screenshot inspection | Group centered above the bar; mobile wraps controls within the viewport |
| Six placements and four displacing docks | Passed on both viewport sizes |
| Hover/fade, persistent preference, focus recovery | Passed on both sizes |
| 2D pan/rotation, smooth wheel/pinch, 3D orbit/pan/dolly | Passed |
| Real browser touch injection and cancellation | Passed |
| Keyboard camera reset, sculpt placement versus navigation | Passed |
| AI Apply/Undo, stale proposals, recipes, local tools | Passed existing regression cases |
| Production assistant off/BYOK and automatic visibility default | Passed both sizes |

Validation: 594 unit tests passed; repository `pnpm typecheck` and `pnpm build` passed. 23 distinct development browser cases and two production cases passed across the final focused runs. Two live-provider cases and one duplicate mobile server-tool case were intentionally skipped. No provider calls or keys were needed. Whitespace checks passed. Screenshots/traces remain outside the repository under `/tmp` or the configured OS temporary directory.

An additional standalone renderer `tsc --noEmit` check exposes an existing typed-array generic mismatch in `packages/renderer/src/__tests__/grid-models.test.ts:42`; the repository typecheck command and runtime tests pass. Physical trackpads/touch devices, Safari/Firefox, and screen readers still need coverage. Touch/trackpad verification here uses Chromium input injection, not physical hardware. This pass did not rerun the entire visualizer catalog or live provider integrations.
