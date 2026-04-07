import type { MessageBus } from '@cybernoetica/core';
import {
  SceneManager,
  getVisualizerEntry,
  getVisualizerTypes,
  listVisualizers,
} from '@cybernoetica/renderer';
import type { Visualizer, VisualizerMetadata } from '@cybernoetica/renderer';

export class VisualizerManager {
  private activeViz: Visualizer | null = null;
  private activeType = '';

  constructor(
    private bus: MessageBus,
    private scene: SceneManager,
  ) {}

  switchTo(type: string): Visualizer | null {
    if (this.activeViz) {
      this.activeViz.dispose();
      while (this.scene.scene.children.length > 0)
        this.scene.scene.remove(this.scene.scene.children[0]);
    }

    const entry = getVisualizerEntry(type);
    if (!entry) return null;

    this.activeType = type;
    this.activeViz = entry.create(this.bus);
    this.activeViz.attach(this.scene.scene);
    this.activeViz.setResolution(this.scene.width, this.scene.height);

    this.scene.activeCamera = this.activeViz.metadata.usesPerspective
      ? this.scene.perspCamera : this.scene.camera;
    this.scene.resetView();
    this.scene.setViewportCapabilities(this.activeViz.metadata.viewport);
    // Fractal visualizers have their own auto-zoom; boost pan sensitivity accordingly
    const hasFractalZoom = type === 'mandelbrot' || type === 'julia';
    this.scene.setPanSensitivityScale(hasFractalZoom ? 50.0 : 1.0);

    return this.activeViz;
  }

  switchRandom(exclude?: string): Visualizer | null {
    const types = getVisualizerTypes();
    const candidates = exclude ? types.filter(t => t !== exclude) : types;
    const pick = candidates.length > 0 ? candidates : types;
    const type = pick[Math.floor(Math.random() * pick.length)];
    return this.switchTo(type);
  }

  getActive(): Visualizer | null { return this.activeViz; }
  getActiveType(): string { return this.activeType; }
  getAvailableTypes(): string[] { return getVisualizerTypes(); }
  getMetadataList(): VisualizerMetadata[] { return listVisualizers(); }

  resize(w: number, h: number): void {
    this.activeViz?.setResolution(w, h);
  }

  tick(): void {
    const [px, py] = this.scene.getPan();
    this.activeViz?.setPan?.(px, py);
    this.activeViz?.setZoom?.(this.scene.getUserZoom());
    this.activeViz?.tick();
  }
}
