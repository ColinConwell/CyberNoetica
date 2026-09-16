import { getGlobals } from '../globals.js';
import {
  listVisualizers,
  getVisualizerDocumentation,
  parseJourney,
} from '@cybernoetica/renderer';
import { validateSoundscapePatch } from '@cybernoetica/audio';
import {
  recordSession,
  restoreVisualizer,
  handoffMarkdown,
  validateValues,
  matchesControl,
} from '../developer/session.js';
import type { Annotation } from '../developer/session.js';
import { getMenuPreferences, setMenuPreferences } from '../ui/menu-layout.js';
import type { MenuPreferences } from '../ui/menu-layout.js';
import { parseRecipe, registerRecipe, creationEntries } from './recipe.js';
import type { Operation } from './protocol.js';
export const MUTATIONS = new Set<Operation>([
  'set_visual_params',
  'set_view',
  'set_soundscape',
  'set_journey',
  'set_menu',
  'create_visualizer',
]);
export interface RuntimeHooks {
  handoff: (markdown: string) => void;
  annotations?: () => Annotation[];
  serverTool: (
    operation: 'source' | 'test',
    payload: unknown,
    signal: AbortSignal,
  ) => Promise<unknown>;
}
export function createStudioRuntime(hooks: RuntimeHooks) {
  let undo: { fingerprint: string; action: () => Promise<void> | void } | null =
    null;
  const globals = () => {
    const g = getGlobals();
    if (!g) throw new Error('App is not ready.');
    return g;
  };
  const snapshot = () => {
    const g = globals(),
      r = recordSession(hooks.annotations?.() ?? []);
    return {
      ...r,
      viewFields: g.vizManager?.getActive()?.metadata.viewStateFields ?? [],
      creations: creationEntries(),
    };
  };
  const fingerprint = () => {
    const r = snapshot();
    return JSON.stringify({
      type: r.visualizer.type,
      params: r.visualizer.params,
      soundscape: r.soundscape,
      journey: r.journey,
      menus: r.menus,
      source: r.environment.source,
    });
  };
  const active = (type: unknown) => {
    const g = globals(),
      viz = g.vizManager?.getActive();
    if (!viz || viz.metadata.type !== type || g.journey?.active)
      throw new Error(
        'The active individual visualizer changed. Inspect again.',
      );
    return viz;
  };
  async function execute(
    operation: Operation,
    p: Record<string, unknown>,
    signal: AbortSignal,
    expected?: string,
  ): Promise<unknown> {
    if (signal.aborted) throw new Error('Stopped.');
    if (MUTATIONS.has(operation) && expected !== fingerprint())
      throw new Error(
        'Configuration changed while the agent was working. Inspect again before applying.',
      );
    const g = globals();
    let undoAction: (() => Promise<void> | void) | undefined;
    if (operation === 'inspect_state') return snapshot();
    if (operation === 'lookup_controls') {
      const query = String(p.query ?? '');
      return listVisualizers()
        .filter((v) =>
          matchesControl(
            query,
            `${v.label} ${v.type} ${v.description} ${v.params.map((p) => `${p.label} ${p.key}`).join(' ')}`,
          ),
        )
        .slice(0, 12)
        .map((v) => ({
          type: v.type,
          label: v.label,
          description: v.description,
          controls: v.params,
          documentation: getVisualizerDocumentation(v.type),
        }));
    }
    if (operation === 'lookup_source')
      return hooks.serverTool('source', p, signal);
    if (operation === 'run_tests') return hooks.serverTool('test', p, signal);
    if (operation === 'record_handoff') {
      if (typeof p.note !== 'string' || p.note.length > 12000)
        throw new Error('Provide a handoff note under 12000 characters.');
      const markdown =
        handoffMarkdown(recordSession(hooks.annotations?.() ?? [])) +
        `\n## Agent handoff\n\n${p.note}\n`;
      hooks.handoff(markdown);
      return {
        recorded: true,
        message:
          'A downloadable handoff is ready in the studio. Source files were not edited.',
      };
    }
    if (operation === 'validate_controls') {
      const viz = g.vizManager?.getActive();
      if (!viz) throw new Error('No active model.');
      const values = viz.getUserParams?.() ?? {};
      const failures = viz.metadata.params
        .filter(
          (p) =>
            !Number.isFinite(values[p.key]) ||
            values[p.key] < p.min ||
            values[p.key] > p.max,
        )
        .map((p) => p.key);
      return {
        passed: !failures.length,
        type: viz.metadata.type,
        checked: viz.metadata.params.length,
        failures,
      };
    }
    if (operation === 'measure_frames') {
      const samples: Array<{ cpuMs: number; gpuMs: number | null }> = [];
      for (let i = 0; i < 10; i++) {
        if (signal.aborted) throw new Error('Stopped.');
        await new Promise<void>((resolve, reject) => {
          const stop = () => {
            clearTimeout(timer);
            reject(new Error('Stopped.'));
          };
          const timer = setTimeout(() => {
            signal.removeEventListener('abort', stop);
            resolve();
          }, 100);
          signal.addEventListener('abort', stop, { once: true });
        });
        samples.push(g.scene.getWorkTiming());
      }
      return {
        durationMs: 1000,
        samples,
        note: 'Measured work samples, not a benchmark or a frame-rate guarantee.',
      };
    }
    if (operation === 'set_visual_params') {
      const viz = active(p.type),
        values = validateValues(p.params, viz.metadata.params),
        before = viz.getUserParams?.() ?? {};
      Object.entries(values).forEach(([k, v]) => viz.setUserParam(k, v));
      undoAction = () => {
        const current = active(p.type);
        Object.entries(before).forEach(([k, v]) => current.setUserParam(k, v));
      };
    } else if (operation === 'set_view') {
      const viz = active(p.type),
        values = validateValues(p.view, viz.metadata.viewStateFields),
        before = viz.getViewState();
      viz.setViewState(values);
      undoAction = () => {
        active(p.type).setViewState(before);
      };
    } else if (operation === 'set_soundscape') {
      const source = g.journey?.source;
      if (source?.sourceType !== 'soundscape')
        throw new Error('Activate Soundscape first.');
      const before = {
        params: source.getSoundscapeParams(),
        patch: source.getSoundscapePatch(),
      };
      const params =
        p.params === undefined
          ? {}
          : validateValues(p.params, [
              { key: 'cycleLength', min: 8, max: 60 },
              { key: 'energy', min: 0, max: 1 },
              { key: 'brightness', min: 0, max: 1 },
              { key: 'beatRate', min: 40, max: 180 },
            ]);
      const patch =
        p.patch === undefined ? null : validateSoundscapePatch(p.patch);
      source.setSoundscapeParams(params);
      if (patch) source.setSoundscapePatch(patch);
      undoAction = () => {
        source.setSoundscapeParams(before.params);
        source.setSoundscapePatch(before.patch);
      };
    } else if (operation === 'set_journey') {
      if (!g.journey?.active) throw new Error('Activate Journey first.');
      if (
        !p.definition ||
        typeof p.definition !== 'object' ||
        (p.definition as { version?: number }).version !== 1 ||
        !Array.isArray((p.definition as { stops?: unknown }).stops)
      )
        throw new Error('Provide a complete version-1 Journey definition.');
      const next = parseJourney(p.definition),
        before = structuredClone(g.journey.definition);
      g.journey.update(next);
      undoAction = () => g.journey!.update(before);
    } else if (operation === 'set_menu') {
      if (
        p.layout !== undefined &&
        !['bubbles', 'rows', 'constellation'].includes(String(p.layout))
      )
        throw new Error('Unknown menu layout.');
      const values = validateValues(
        Object.fromEntries(Object.entries(p).filter(([k]) => k !== 'layout')),
        [
          { key: 'gap', min: 2, max: 24 },
          { key: 'columns', min: 1, max: 4 },
          { key: 'size', min: 10, max: 18 },
        ],
      );
      if (values.columns !== undefined && !Number.isInteger(values.columns))
        throw new Error('Menu columns must be an integer.');
      const before = getMenuPreferences();
      setMenuPreferences({
        ...values,
        ...(p.layout ? { layout: p.layout as MenuPreferences['layout'] } : {}),
      });
      undoAction = () => setMenuPreferences(before);
    } else if (operation === 'create_visualizer') {
      if (!g.selectVisualizer)
        throw new Error('Visualizer selection is not ready.');
      const recipe = parseRecipe(p.recipe),
        before = recordSession([]);
      const created = registerRecipe(recipe);
      if (!(await g.selectVisualizer(created.type)))
        throw new Error('Could not attach the new visualizer.');
      undoAction = async () => {
        if (before.visualizer.type === 'journey') await g.journey?.mode(true);
        else if (
          before.visualizer.type &&
          (await g.selectVisualizer!(before.visualizer.type))
        ) {
          const restored = g.vizManager?.getActive();
          if (restored) restoreVisualizer(before, restored);
        }
      };
    } else throw new Error('Unsupported operation.');
    undo = { fingerprint: fingerprint(), action: undoAction! };
    return { applied: true, operation, state: snapshot() };
  }
  return {
    snapshot,
    fingerprint,
    execute,
    async undo() {
      if (!undo) throw new Error('No live edit to undo.');
      if (fingerprint() !== undo.fingerprint)
        throw new Error(
          'Configuration changed after the last edit; use the recorded handoff instead.',
        );
      await undo.action();
      undo = null;
    },
    hasUndo: () => Boolean(undo),
  };
}
