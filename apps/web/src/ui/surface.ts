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
