import type { ViewportCapabilities } from './visualizers/types.js';
export type NavigationMode = 'pan' | 'orbit' | 'zoom';
/** Blender-style middle-button navigation, with Alt-left emulation. */
export function dragMode(
  e: Pick<PointerEvent, 'button' | 'altKey' | 'shiftKey' | 'ctrlKey'>,
  caps: ViewportCapabilities,
  sculpt = false,
): NavigationMode | null {
  if (e.button !== 0 && e.button !== 1) return null;
  if (sculpt && e.button === 0 && !e.altKey) return null;
  if (e.ctrlKey && (e.button === 1 || e.altKey))
    return caps.zoom ? 'zoom' : null;
  if (e.shiftKey) return caps.pan ? 'pan' : null;
  return caps.orbit || (e.altKey && caps.rotate)
    ? 'orbit'
    : caps.pan
      ? 'pan'
      : null;
}
/** Convert pixels, lines, or pages to a bounded logarithmic zoom delta. */
export function wheelZoom(delta: number, mode: number, height: number): number {
  if (delta === 0) return 0;
  const pixels = delta * (mode === 1 ? 16 : mode === 2 ? height : 1);
  return Math.max(-0.5, Math.min(0.5, -pixels * 0.002));
}
