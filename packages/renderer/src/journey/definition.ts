import { seededRandom } from '../timing.js';
import { JOURNEY_TYPES } from './types.js';
import type {
  GuidanceMapping,
  JourneyDefinition,
  JourneyLayer,
  JourneyStop,
} from './types.js';

export const finite = (
  v: unknown,
  fallback: number,
  min: number,
  max: number,
): number =>
  typeof v === 'number' && Number.isFinite(v)
    ? Math.max(min, Math.min(max, v))
    : fallback;
export function createLayer(type: string, id = 'layer-0'): JourneyLayer {
  return {
    id,
    type,
    params: {},
    view: {},
    weight: 1,
    opacity: 1,
    x: 0,
    y: 0,
    scale: 1,
    rotation: 0,
  };
}
export function createStop(type: string, id = 'stop-0'): JourneyStop {
  return {
    id,
    hold: 16,
    transition: 4,
    composition: 'layers',
    layers: [createLayer(type, `${id}-layer-0`)],
  };
}
export function createJourney(
  seed = 20260913,
  first?: string,
): JourneyDefinition {
  const random = seededRandom(seed);
  const stops: JourneyStop[] = [];
  for (let i = 0; i < 6; i++) {
    const choices = JOURNEY_TYPES.filter(
      (t) =>
        t !== stops[i - 1]?.layers[0].type &&
        (i !== 5 || t !== stops[0]?.layers[0].type),
    );
    const type =
      i === 0 && JOURNEY_TYPES.includes(first as (typeof JOURNEY_TYPES)[number])
        ? first!
        : choices[Math.floor(random() * choices.length)];
    stops.push(createStop(type, `stop-${i}`));
  }
  return {
    version: 1,
    seed,
    style: 'character',
    transport: 'auto',
    transitionLook: {
      path: 'arc',
      rendering: 'traces',
      curvature: 0.35,
      traceLength: 0.12,
    },
    loop: true,
    timing: 'seconds',
    bpm: 96,
    beatOffset: 0,
    cues: [],
    stops,
    guidance: [
      {
        id: 'bass-spread',
        source: 'audio.bass',
        target: 'spread',
        amount: 0.35,
        smoothing: 0.06,
        min: 0,
        max: 1,
        invert: false,
      },
      {
        id: 'mid-swirl',
        source: 'audio.mid',
        target: 'swirl',
        amount: 0.25,
        smoothing: 0.08,
        min: 0,
        max: 1,
        invert: false,
      },
      {
        id: 'level-light',
        source: 'audio.rms',
        target: 'light',
        amount: 0.3,
        smoothing: 0.08,
        min: 0,
        max: 1,
        invert: false,
      },
    ],
  };
}
function numbers(value: unknown): Record<string, number> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value)
      .filter(
        ([k, v]) =>
          !['__proto__', 'constructor', 'prototype'].includes(k) &&
          typeof v === 'number' &&
          Number.isFinite(v),
      )
      .slice(0, 64),
  );
}
/** Strict identity/version validation; bounded numeric data, no executable imports. */
export function parseJourney(value: unknown): JourneyDefinition {
  if (!value || typeof value !== 'object')
    throw new Error('Choose a Journey JSON file.');
  const raw = value as Record<string, unknown>;
  if (
    raw.version !== 1 ||
    !Array.isArray(raw.stops) ||
    raw.stops.length < 1 ||
    raw.stops.length > 32
  )
    throw new Error('Journey requires version 1 and 1–32 stops.');
  const stops = raw.stops.map((s: Record<string, unknown>, i): JourneyStop => {
    if (
      !s ||
      !Array.isArray(s.layers) ||
      !s.layers.length ||
      s.layers.length > 3
    )
      throw new Error('Each stop needs 1–3 contributors.');
    const layers = s.layers.map(
      (l: Record<string, unknown>, j): JourneyLayer => {
        if (
          !l ||
          !JOURNEY_TYPES.includes(l.type as (typeof JOURNEY_TYPES)[number])
        )
          throw new Error(`Unsupported Journey model: ${String(l?.type)}`);
        return {
          ...createLayer(String(l.type), `stop-${i}-layer-${j}`),
          params: numbers(l.params),
          view: numbers(l.view),
          weight: finite(l.weight, 1, 0, 1),
          opacity: finite(l.opacity, 1, 0, 1),
          x: finite(l.x, 0, -2, 2),
          y: finite(l.y, 0, -2, 2),
          scale: finite(l.scale, 1, 0.1, 3),
          rotation: finite(l.rotation, 0, -Math.PI, Math.PI),
        };
      },
    );
    if (!layers.some((l) => l.weight > 0)) layers[0].weight = 1;
    return {
      id: `stop-${i}`,
      layers,
      composition: s.composition === 'blend' ? 'blend' : 'layers',
      hold: finite(s.hold, 16, 0.5, 600),
      transition: finite(s.transition, 4, 0.5, 60),
    };
  });
  const defaults = createJourney();
  const guidance = Array.isArray(raw.guidance)
    ? raw.guidance
        .slice(0, 8)
        .map((g: Record<string, unknown>, i): GuidanceMapping => {
          if (
            !g ||
            typeof g.source !== 'string' ||
            !/^[a-z][\w.-]{0,63}$/i.test(g.source) ||
            !['swirl', 'spread', 'light'].includes(String(g.target))
          )
            throw new Error('Invalid guidance route.');
          return {
            id: `guidance-${i}`,
            source: g.source,
            target: g.target as GuidanceMapping['target'],
            amount: finite(g.amount, 0, -3, 3),
            smoothing: finite(g.smoothing, 0.1, 0, 2),
            min: finite(g.min, 0, -10, 10),
            max: finite(g.max, 1, -10, 10),
            invert: g.invert === true,
          };
        })
    : defaults.guidance;
  const look =
    raw.transitionLook && typeof raw.transitionLook === 'object'
      ? (raw.transitionLook as Record<string, unknown>)
      : {};
  return {
    version: 1,
    transport: ['projection', 'polar', 'identity'].includes(
      String(raw.transport),
    )
      ? (raw.transport as JourneyDefinition['transport'])
      : 'auto',
    transitionLook: {
      path: ['arc', 'vortex'].includes(String(look.path))
        ? (look.path as JourneyDefinition['transitionLook']['path'])
        : 'direct',
      rendering: ['streaks', 'traces'].includes(String(look.rendering))
        ? (look.rendering as JourneyDefinition['transitionLook']['rendering'])
        : 'particles',
      curvature: finite(look.curvature, 0.35, 0, 1.5),
      traceLength: finite(look.traceLength, 0.12, 0.01, 0.4),
    },
    seed: Math.trunc(finite(raw.seed, defaults.seed, 0, 0xffffffff)),
    stops,
    style: raw.style === 'unified' ? 'unified' : 'character',
    loop: raw.loop !== false,
    timing: ['onset', 'beats', 'cues'].includes(String(raw.timing))
      ? (raw.timing as JourneyDefinition['timing'])
      : 'seconds',
    bpm: finite(raw.bpm, 96, 40, 240),
    beatOffset: finite(raw.beatOffset, 0, -10, 10),
    cues: Array.isArray(raw.cues)
      ? [
          ...new Set(
            raw.cues.filter(
              (c): c is number =>
                typeof c === 'number' &&
                Number.isFinite(c) &&
                c >= 0 &&
                c < 86400,
            ),
          ),
        ]
          .sort((a, b) => a - b)
          .slice(0, 512)
      : [],
    guidance,
  };
}
export function normalizedWeights(
  values: number[],
  previous: number[] = [],
): number[] {
  const safe = values.map((v) => Math.max(0, Number.isFinite(v) ? v : 0));
  const sum = safe.reduce((a, b) => a + b, 0);
  if (sum > 0) return safe.map((v) => v / sum);
  if (previous.length === values.length && previous.some((v) => v > 0))
    return normalizedWeights(previous);
  return values.map((_, i) => (i === 0 ? 1 : 0));
}
export const quintic = (p: number): number => {
  const t = Math.max(0, Math.min(1, p));
  return t * t * t * (t * (t * 6 - 15) + 10);
};
export const guidanceEnvelope = (p: number): number =>
  16 * p * p * (1 - p) * (1 - p);

/** An interactive all-zero edit retains the prior valid distribution. Imports use a deterministic default. */
export function retainJourneyWeights(
  next: JourneyDefinition,
  previous: JourneyDefinition,
): JourneyDefinition {
  const value = structuredClone(next);
  for (let i = 0; i < value.stops.length; i++) {
    const layers = value.stops[i].layers,
      old = previous.stops[i]?.layers;
    if (old?.length === layers.length && !layers.some((l) => l.weight > 0))
      layers.forEach((l, j) => (l.weight = old[j].weight));
  }
  return value;
}
