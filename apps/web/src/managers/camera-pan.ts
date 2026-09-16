import type { Visualizer } from '@cybernoetica/renderer';
/** Camera translation is part of view state so recordings, agent edits and Reset View agree. */
export function installCameraPan(viz: Visualizer): void {
  if (!viz.metadata.usesPerspective || !viz.metadata.viewport.orbit) return;
  const target: Record<string, number> = { targetX: 0, targetY: 0, targetZ: 0 };
  const get = viz.getViewState.bind(viz),
    set = viz.setViewState.bind(viz);
  Object.defineProperty(viz, 'metadata', {
    configurable: true,
    value: {
      ...viz.metadata,
      viewport: { ...viz.metadata.viewport, pan: true },
      viewStateFields: [
        ...viz.metadata.viewStateFields,
        ...Object.keys(target).map((key) => ({
          key,
          label: `Camera Target ${key.slice(-1)}`,
          min: -100,
          max: 100,
          step: 0.01,
        })),
      ],
    },
  });
  viz.getViewState = () => ({ ...get(), ...target });
  viz.setViewState = (partial) => {
    const rest = { ...partial };
    for (const key of Object.keys(target)) {
      if (Number.isFinite(partial[key]))
        target[key] = Math.max(-100, Math.min(100, partial[key]));
      delete rest[key];
    }
    if (Object.keys(rest).length) set(rest);
  };
}
