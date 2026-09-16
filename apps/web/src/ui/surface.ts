import { Z_INDEX } from './constants.js';
/** Fixed-position controls share this viewport with the canvas when a dock displaces it. */
export function getAppSurface(): HTMLElement {
  let surface = document.getElementById('app-surface');
  if (!surface) {
    surface = document.createElement('div');
    surface.id = 'app-surface';
    document.body.append(surface);
    const app = document.getElementById('app');
    if (app) surface.append(app);
  }
  return surface;
}

/** Shared launcher group; available before either optional studio mounts. */
export function getStudioControls(): HTMLElement {
  let group = document.getElementById('studio-controls');
  if (!group) {
    group = document.createElement('div');
    group.id = 'studio-controls';
    group.style.zIndex = String(Z_INDEX.developerLauncher);
    group.setAttribute('role', 'group');
    group.setAttribute('aria-label', 'Studio Controls');
    group.dataset.position = 'above';
    const surface = getAppSurface();
    surface.dataset.devLauncher = 'above';
    surface.append(group);
  }
  return group;
}
