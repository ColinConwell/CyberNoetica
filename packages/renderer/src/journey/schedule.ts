import type { JourneyDefinition } from './types.js';
/** Direct segment lookup: seeking never replays the events between two positions. */
export function locateJourney(
  definition: JourneyDefinition,
  seconds: number,
  beats: readonly number[] = [],
  onsets: readonly number[] = [],
): { index: number; offset: number; progress: number } {
  // File clocks can resolve musical waits directly from their compact marker grids.
  if (definition.timing !== 'seconds') {
    const at = Math.max(
      0,
      Math.min(86400, Number.isFinite(seconds) ? seconds : 0),
    );
    let start = 0,
      index = 0;
    for (let segments = 0; segments < 86401; segments++) {
      const stop = definition.stops[index],
        requested = start + stop.hold;
      let transitionAt = requested;
      const markers =
        definition.timing === 'cues'
          ? definition.cues
          : definition.timing === 'beats'
            ? beats
            : onsets;
      const offset = definition.timing === 'beats' ? definition.beatOffset : 0;
      if (markers.length) {
        let lo = 0,
          hi = markers.length;
        while (lo < hi) {
          const mid = (lo + hi) >>> 1;
          if (markers[mid] + offset < requested) lo = mid + 1;
          else hi = mid;
        }
        const next =
          markers[lo] === undefined ? Infinity : markers[lo] + offset;
        transitionAt =
          definition.timing === 'cues'
            ? Number.isFinite(next)
              ? next
              : Math.max(requested, markers[markers.length - 1] + 2)
            : Math.min(next, requested + 2);
      } else if (definition.timing === 'beats') {
        const period = 60 / definition.bpm;
        transitionAt = Math.min(
          requested + 2,
          Math.ceil((requested - offset) / period - 1e-9) * period + offset,
        );
      } else if (definition.timing === 'onset') transitionAt = requested + 2;
      const terminal =
          !definition.loop && index === definition.stops.length - 1,
        end = terminal ? Infinity : transitionAt + stop.transition;
      if (at < end)
        return {
          index,
          offset:
            Math.min(stop.hold, at - start) + Math.max(0, at - transitionAt),
          progress: terminal
            ? 0
            : Math.max(0, (at - transitionAt) / stop.transition),
        };
      start = end;
      index = (index + 1) % definition.stops.length;
    }
  }
  const durations = definition.stops.map(
    (s, i) =>
      s.hold +
      (definition.loop || i < definition.stops.length - 1 ? s.transition : 0),
  );
  const total = durations.reduce((a, b) => a + b, 0);
  let t = definition.loop
    ? Math.max(0, seconds) % total
    : Math.min(Math.max(0, seconds), total - 1e-6);
  for (let i = 0; i < durations.length; i++) {
    if (t < durations[i])
      return {
        index: i,
        offset: t,
        progress: Math.max(
          0,
          (t - definition.stops[i].hold) / definition.stops[i].transition,
        ),
      };
    t -= durations[i];
  }
  return { index: 0, offset: 0, progress: 0 };
}
/** Binary search avoids scanning an entire beat grid every render. */
export function crossedMarker(
  markers: readonly number[],
  position: number,
  delta: number,
  offset = 0,
): boolean {
  let lo = 0,
    hi = markers.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (markers[mid] + offset <= position) lo = mid + 1;
    else hi = mid;
  }
  return (
    lo > 0 && position - (markers[lo - 1] + offset) <= Math.max(0.035, delta)
  );
}
