import type { MessageBus } from '@cybernoetica/core';
import {
  SceneManager,
  getVisualizerEntry,
  getVisualizerTypes,
  listVisualizers,
} from '@cybernoetica/renderer';
import type { Visualizer, VisualizerMetadata } from '@cybernoetica/renderer';

const DEFAULT_DRIFT_SPEED = 0.08;

export class VisualizerManager {
  private activeViz: Visualizer | null = null;
  private activeType = '';
  private driftEnabled = true;

  constructor(
    private bus: MessageBus,
    private scene: SceneManager,
  ) {
    scene.onViewportDrag((dx, dy) => this.handleDrag(dx, dy));
    scene.onViewportZoom((delta) => this.handleZoom(delta));
    scene.onViewportReset(() => this.handleReset());
  }

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
    const buf = this.scene.getDrawingBufferSize();
    this.activeViz.setResolution(buf.width, buf.height);

    this.scene.activeCamera = this.activeViz.metadata.usesPerspective
      ? this.scene.perspCamera : this.scene.camera;
    this.scene.setViewportCapabilities(this.activeViz.metadata.viewport);
    this.driftEnabled = true;

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

  resize(_w: number, _h: number): void {
    const buf = this.scene.getDrawingBufferSize();
    this.activeViz?.setResolution(buf.width, buf.height);
  }

  tick(): void {
    if (!this.activeViz) return;

    // For perspective visualizers: apply auto-drift and update camera from view state
    if (this.activeViz.metadata.usesPerspective) {
      if (this.driftEnabled && !this.scene.isDragging()) {
        const vs = this.activeViz.getViewState();
        this.activeViz.setViewState({
          orbitAngle: (vs.orbitAngle ?? 0) + DEFAULT_DRIFT_SPEED / 60,
        });
      }
      const vs = this.activeViz.getViewState();
      const dist = vs.distance ?? 12;
      const angle = vs.orbitAngle ?? 0;
      const elev = vs.elevation ?? 0;
      this.scene.setCameraPosition(
        Math.sin(angle) * dist,
        elev * dist * 0.3,
        Math.cos(angle) * dist,
      );
    }

    this.activeViz.tick();
  }

  // ── Viewport interaction translation ────────────────────────────

  private handleDrag(dx: number, dy: number): void {
    if (!this.activeViz) return;
    const meta = this.activeViz.metadata;
    const vs = this.activeViz.getViewState();

    if (meta.viewport.orbit) {
      this.activeViz.setViewState({
        orbitAngle: (vs.orbitAngle ?? 0) + dx * 3.0,
        elevation: Math.max(-1.5, Math.min(1.5, (vs.elevation ?? 0) - dy * 2.0)),
      });
    } else if (meta.viewport.pan) {
      const zoom = vs.zoom ?? 1;
      const scale = 2.0 / Math.max(zoom, 0.1);

      if ('centerReal' in vs && 'centerImaginary' in vs) {
        this.activeViz.setViewState({
          centerReal: vs.centerReal - dx * scale,
          centerImaginary: vs.centerImaginary + dy * scale,
        });
      } else if ('centerX' in vs && 'centerY' in vs) {
        this.activeViz.setViewState({
          centerX: vs.centerX - dx * scale,
          centerY: vs.centerY + dy * scale,
        });
      } else if ('seedReal' in vs && 'seedImaginary' in vs) {
        this.activeViz.setViewState({
          seedReal: vs.seedReal - dx * scale * 0.5,
          seedImaginary: vs.seedImaginary + dy * scale * 0.5,
        });
      }
    }
  }

  private handleZoom(delta: number): void {
    if (!this.activeViz) return;
    const vs = this.activeViz.getViewState();

    if ('distance' in vs) {
      const newDist = Math.max(4, Math.min(30, vs.distance * (1 - delta)));
      this.activeViz.setViewState({ distance: newDist });
    } else if ('zoom' in vs) {
      const factor = 1 + delta;
      this.activeViz.setViewState({ zoom: vs.zoom * factor });
    }
  }

  private handleReset(): void {
    // Re-create the visualizer to reset all state
    if (this.activeType) {
      this.switchTo(this.activeType);
    }
  }
}
