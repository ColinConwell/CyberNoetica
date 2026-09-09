import type { MessageBus } from '@cybernoetica/core';
import {
  SceneManager,
  getVisualizerEntry,
  getVisualizerTypes,
  listVisualizers,
  loadVisualizer,
} from '@cybernoetica/renderer';
import type { Visualizer, VisualizerMetadata } from '@cybernoetica/renderer';

const DEFAULT_DRIFT_SPEED = 0.08;
function wrapAngle(angle: number, metadata: VisualizerMetadata): number {
  const field = metadata.viewStateFields.find(
    (field) => field.key === 'orbitAngle',
  );
  const minimum = field?.min ?? -Math.PI,
    period = (field?.max ?? Math.PI) - minimum;
  return ((((angle - minimum) % period) + period) % period) + minimum;
}

export type SwitchHook = (
  type: string,
  phase: 'loading' | 'ready' | 'error',
  detail?: Error,
) => void;

export interface VisualizerManagerOptions {
  resetGovernor?: () => void;
}

export class VisualizerManager {
  private disposed = false;
  private activeViz: Visualizer | null = null;
  private activeType = '';
  private driftEnabled = true;
  private pendingType: string | null = null;
  private switchGen = 0;
  private switchHook: SwitchHook | null = null;
  private resetGovernor: (() => void) | null;

  constructor(
    private bus: MessageBus,
    private scene: SceneManager,
    options: VisualizerManagerOptions = {},
  ) {
    this.resetGovernor = options.resetGovernor ?? null;
    scene.onViewportDrag((dx, dy) => this.handleDrag(dx, dy));
    scene.onViewportZoom((delta) => this.handleZoom(delta));
    scene.onViewportReset(() => this.handleReset());
    scene.onContextRestored(() => {
      const type = this.activeType;
      if (!type) {
        this.scene.start();
        return;
      }
      console.info(
        'VisualizerManager: Re-initializing active visualizer after context restore.',
      );
      void this.switchTo(type).then((viz) => {
        if (viz && !this.disposed) this.scene.start();
      });
    });
  }

  setResetGovernor(fn: (() => void) | null): void {
    this.resetGovernor = fn;
  }

  onSwitch(hook: SwitchHook | null): void {
    this.switchHook = hook;
  }

  async switchTo(type: string): Promise<Visualizer | null> {
    if (this.disposed) return null;
    const gen = ++this.switchGen;
    this.pendingType = type;
    let entry = getVisualizerEntry(type);
    if (!entry) {
      this.switchHook?.(type, 'loading');
      try {
        entry = (await loadVisualizer(type)) ?? undefined;
      } catch (err) {
        if (gen === this.switchGen)
          this.switchHook?.(type, 'error', err as Error);
        return null;
      }
      if (gen !== this.switchGen || this.pendingType !== type) {
        return null;
      }
      if (!entry) {
        this.switchHook?.(
          type,
          'error',
          new Error(`Visualizer not found: ${type}`),
        );
        return null;
      }
    }

    if (gen !== this.switchGen) return null;

    this.teardownActive();
    this.resetGovernor?.();

    try {
      this.activeType = type;
      this.activeViz = entry.create(this.bus);

      const renderer = this.scene.getRenderer();
      if (renderer) {
        this.activeViz.setRenderer?.(renderer);
      }

      const canvas = this.scene.getCanvasElement();
      if (canvas) {
        this.activeViz.setInteractionContext?.({
          canvas,
          getPerspectiveCamera: () => this.scene.perspCamera,
        });
      }

      this.activeViz.attach(this.scene.scene);
      const buf = this.scene.getDrawingBufferSize();
      this.activeViz.setResolution(buf.width, buf.height);

      this.scene.activeCamera = this.activeViz.metadata.usesPerspective
        ? this.scene.perspCamera
        : this.scene.camera;
      this.scene.setViewportCapabilities(this.activeViz.metadata.viewport);
      this.scene.setCursorMode(this.activeViz.getCursorMode?.() ?? 'default');
      this.driftEnabled = true;
      this.applyPerspectiveCamera();

      this.scene.precompile();

      if (gen !== this.switchGen) {
        this.teardownActive();
        return null;
      }

      this.switchHook?.(type, 'ready');
      return this.activeViz;
    } catch (error) {
      this.teardownActive();
      this.activeType = '';
      this.switchHook?.(
        type,
        'error',
        error instanceof Error ? error : new Error(String(error)),
      );
      return null;
    }
  }

  async switchRandom(exclude?: string): Promise<Visualizer | null> {
    const types = getVisualizerTypes();
    const candidates = exclude ? types.filter((t) => t !== exclude) : types;
    const pick = candidates.length > 0 ? candidates : types;
    const type = pick[Math.floor(Math.random() * pick.length)];
    return this.switchTo(type);
  }

  getActive(): Visualizer | null {
    return this.activeViz;
  }
  getActiveType(): string {
    return this.activeType;
  }
  getAvailableTypes(): string[] {
    return getVisualizerTypes();
  }
  getMetadataList(): VisualizerMetadata[] {
    return listVisualizers();
  }

  resize(_w: number, _h: number): void {
    const buf = this.scene.getDrawingBufferSize();
    this.activeViz?.setResolution(buf.width, buf.height);
  }

  tick(deltaSeconds = 1 / 60): void {
    if (!this.activeViz) return;

    if (this.activeViz.metadata.usesPerspective) {
      if (this.driftEnabled && !this.scene.isDragging()) {
        const vs = this.activeViz.getViewState();
        this.activeViz.setViewState({
          orbitAngle: wrapAngle(
            (vs.orbitAngle ?? 0) + DEFAULT_DRIFT_SPEED * deltaSeconds,
            this.activeViz.metadata,
          ),
        });
      }
      this.applyPerspectiveCamera();
    }

    this.activeViz.tick(deltaSeconds);
    this.scene.setCursorMode(this.activeViz.getCursorMode?.() ?? 'default');
  }

  dispose(): void {
    this.disposed = true;
    this.switchGen++;
    this.pendingType = null;
    this.scene.onViewportDrag(null);
    this.scene.onViewportZoom(null);
    this.scene.onViewportReset(null);
    this.scene.onContextRestored(null);
    this.switchHook = null;
    this.teardownActive();
    this.activeType = '';
  }

  private teardownActive(): void {
    if (this.activeViz) {
      this.activeViz.setInteractionContext?.(null);
      this.activeViz.dispose();
      this.activeViz = null;
    }
    this.scene.clearScene();
  }

  private applyPerspectiveCamera(): void {
    if (!this.activeViz?.metadata.usesPerspective) return;
    const vs = this.activeViz.getViewState();
    const dist = vs.distance ?? 12;
    const angle = vs.orbitAngle ?? 0;
    const elev = vs.elevation ?? 0;
    this.scene.setCameraPosition(
      Math.sin(angle) * Math.cos(elev) * dist,
      Math.sin(elev) * dist,
      Math.cos(angle) * Math.cos(elev) * dist,
    );
  }

  private handleDrag(dx: number, dy: number): void {
    if (!this.activeViz) return;
    const meta = this.activeViz.metadata;
    const vs = this.activeViz.getViewState();

    if (meta.viewport.orbit) {
      this.activeViz.setViewState({
        orbitAngle: wrapAngle(
          (vs.orbitAngle ?? 0) + dx * 3.0,
          this.activeViz.metadata,
        ),
        elevation: Math.max(
          -1.5,
          Math.min(1.5, (vs.elevation ?? 0) - dy * 2.0),
        ),
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
      } else if ('panX' in vs && 'panY' in vs) {
        this.activeViz.setViewState({
          panX: vs.panX - dx * scale,
          panY: vs.panY + dy * scale,
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
    if (this.activeType) {
      void this.switchTo(this.activeType);
    }
  }
}
