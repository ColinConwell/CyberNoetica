import { dragMode, wheelZoom } from './viewport-navigation.js';
import type { NavigationMode } from './viewport-navigation.js';
import * as THREE from 'three';
import { FrameStatistics } from './frame-statistics.js';
import { GpuTimer } from './gpu-timer.js';
import type { ViewportCapabilities } from './visualizers/types.js';
import { registerShaderChunks } from './shaders/chunks/index.js';

registerShaderChunks();

export type CursorMode = 'pan' | 'orbit' | 'sculpt' | 'default';

export type QualityTier =
  | 'sub-performance'
  | 'performance'
  | 'balanced'
  | 'high'
  | 'ultra';

const QUALITY_PIXEL_RATIO_CAP: Record<QualityTier, number> = {
  'sub-performance': 0.5,
  performance: 1.0,
  balanced: 1.5,
  high: 2.0,
  ultra: Infinity,
};

export function pixelRatioForTier(
  tier: QualityTier,
  deviceRatio: number,
): number {
  const cap = QUALITY_PIXEL_RATIO_CAP[tier];
  return Math.min(deviceRatio, cap);
}

export type FrameGate = () => boolean;

function buildCursorSvg(opts: {
  strokeAlpha: number;
  fillAlpha: number;
  circleRadius: number;
  ringAlpha: number;
}): string {
  const s = opts.strokeAlpha;
  const f = opts.fillAlpha;
  const r = opts.ringAlpha;
  return (
    `<svg xmlns='http://www.w3.org/2000/svg' width='24' height='24'>` +
    `<circle cx='12' cy='12' r='8' stroke='rgba(255,255,255,${r})' stroke-width='0.8' fill='none'/>` +
    `<line x1='12' y1='3' x2='12' y2='9' stroke='rgba(255,255,255,${s})' stroke-width='1'/>` +
    `<line x1='12' y1='15' x2='12' y2='21' stroke='rgba(255,255,255,${s})' stroke-width='1'/>` +
    `<line x1='3' y1='12' x2='9' y2='12' stroke='rgba(255,255,255,${s})' stroke-width='1'/>` +
    `<line x1='15' y1='12' x2='21' y2='12' stroke='rgba(255,255,255,${s})' stroke-width='1'/>` +
    `<circle cx='12' cy='12' r='${opts.circleRadius}' fill='rgba(255,255,255,${f})'/>` +
    `</svg>`
  );
}

const CURSOR_SVG_IDLE = `url("data:image/svg+xml,${encodeURIComponent(
  buildCursorSvg({
    strokeAlpha: 0.45,
    fillAlpha: 0.5,
    circleRadius: 1,
    ringAlpha: 0.2,
  }),
)}") 12 12, crosshair`;

const CURSOR_SVG_ACTIVE = `url("data:image/svg+xml,${encodeURIComponent(
  buildCursorSvg({
    strokeAlpha: 0.7,
    fillAlpha: 0.8,
    circleRadius: 1.5,
    ringAlpha: 0.4,
  }),
)}") 12 12, move`;

const CURSOR_SCULPT_IDLE = `url("data:image/svg+xml,${encodeURIComponent(
  `<svg xmlns='http://www.w3.org/2000/svg' width='24' height='24'>` +
    `<circle cx='12' cy='12' r='8' stroke='rgba(140,160,255,0.4)' stroke-width='1' fill='none'/>` +
    `<line x1='12' y1='6' x2='12' y2='18' stroke='rgba(140,160,255,0.6)' stroke-width='1.5'/>` +
    `<line x1='6' y1='12' x2='18' y2='12' stroke='rgba(140,160,255,0.6)' stroke-width='1.5'/>` +
    `</svg>`,
)}") 12 12, crosshair`;

const CURSOR_SCULPT_ACTIVE = `url("data:image/svg+xml,${encodeURIComponent(
  `<svg xmlns='http://www.w3.org/2000/svg' width='24' height='24'>` +
    `<circle cx='12' cy='12' r='8' stroke='rgba(140,160,255,0.7)' stroke-width='1.5' fill='rgba(140,160,255,0.08)'/>` +
    `<line x1='12' y1='6' x2='12' y2='18' stroke='rgba(140,160,255,0.8)' stroke-width='2'/>` +
    `<line x1='6' y1='12' x2='18' y2='12' stroke='rgba(140,160,255,0.8)' stroke-width='2'/>` +
    `</svg>`,
)}") 12 12, crosshair`;

export type ViewportDragHandler = (
  dx: number,
  dy: number,
  mode?: NavigationMode,
) => void;
export type ViewportZoomHandler = (delta: number) => void;
export type ViewportResetHandler = () => void;
export type ContextRestoredHandler = () => void;

const TEXTURE_KEYS = [
  'map',
  'normalMap',
  'roughnessMap',
  'metalnessMap',
  'emissiveMap',
  'aoMap',
  'bumpMap',
  'displacementMap',
  'alphaMap',
  'envMap',
  'lightMap',
  'specularMap',
  'gradientMap',
] as const;

function disposeTexture(value: unknown): void {
  if (value && typeof value === 'object' && 'isTexture' in value) {
    (value as THREE.Texture).dispose();
  }
}

function disposeMaterial(material: THREE.Material): void {
  const rec = material as THREE.Material & Record<string, unknown>;
  for (const key of TEXTURE_KEYS) disposeTexture(rec[key]);
  if (
    'uniforms' in material &&
    material.uniforms &&
    typeof material.uniforms === 'object'
  ) {
    for (const uniform of Object.values(
      material.uniforms as Record<string, { value?: unknown }>,
    )) {
      disposeTexture(uniform?.value);
    }
  }
  material.dispose();
}

function disposeObject3D(root: THREE.Object3D): void {
  const seenGeom = new Set<THREE.BufferGeometry>();
  const seenMat = new Set<THREE.Material>();
  root.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (mesh.geometry && !seenGeom.has(mesh.geometry)) {
      seenGeom.add(mesh.geometry);
      mesh.geometry.dispose();
    }
    const mat = mesh.material;
    if (Array.isArray(mat)) {
      for (const m of mat) {
        if (m && !seenMat.has(m)) {
          seenMat.add(m);
          disposeMaterial(m);
        }
      }
    } else if (mat && !seenMat.has(mat)) {
      seenMat.add(mat);
      disposeMaterial(mat);
    }
  });
}

export class SceneManager {
  private renderDelegate: ((renderer: THREE.WebGLRenderer) => void) | null =
    null;
  setRenderDelegate(
    delegate: ((renderer: THREE.WebGLRenderer) => void) | null,
  ): void {
    this.renderDelegate = delegate;
  }
  public width: number;
  public height: number;
  readonly scene: THREE.Scene;
  readonly camera: THREE.OrthographicCamera;
  readonly perspCamera: THREE.PerspectiveCamera;
  activeCamera: THREE.Camera;
  private renderer: THREE.WebGLRenderer | null = null;
  private animationId: number | null = null;
  private renderCallbacks: Array<(time: number) => void> = [];
  private frameGate: FrameGate | null = null;
  private qualityTier: QualityTier = 'high';
  private paused = false;
  private gpuTimer: GpuTimer | null = null;
  private cpuMs = 0;
  private cpuStatistics = new FrameStatistics();
  getTimingPercentiles() {
    return {
      cpu: this.cpuStatistics.percentiles(),
      gpu: this.gpuTimer?.statistics.percentiles() ?? null,
    };
  }
  private contextLostHook: (() => void) | null = null;
  onContextLost(callback: (() => void) | null): void {
    this.contextLostHook = callback;
  }
  private reduceFlashes = false;
  setFlashReduction(value: boolean): void {
    this.reduceFlashes = value;
  }
  getWorkTiming(): { cpuMs: number; gpuMs: number | null } {
    return { cpuMs: this.cpuMs, gpuMs: this.gpuTimer?.milliseconds ?? null };
  }
  private visibilityListener: (() => void) | null = null;

  private dragging = false;
  private lastPointerX = 0;
  private lastPointerY = 0;

  private viewportCaps: ViewportCapabilities = {
    pan: true,
    zoom: true,
    orbit: false,
  };
  private cursorMode: CursorMode = 'default';

  private _onDrag: ViewportDragHandler | null = null;
  private _onZoom: ViewportZoomHandler | null = null;
  private _onReset: ViewportResetHandler | null = null;
  private _onContextRestored: ContextRestoredHandler | null = null;

  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
    this.scene = new THREE.Scene();
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.perspCamera = new THREE.PerspectiveCamera(
      60,
      width / height,
      0.1,
      100,
    );
    this.perspCamera.position.set(0, 0, 12);
    this.perspCamera.lookAt(0, 0, 0);
    this.activeCamera = this.camera;
  }

  attach(container: HTMLElement): void {
    this.renderer = new THREE.WebGLRenderer({
      antialias: false,
      powerPreference: 'high-performance',
    });
    this.renderer.info.autoReset = false;
    this.gpuTimer = new GpuTimer(
      this.renderer.getContext() as WebGL2RenderingContext,
    );
    this.renderer.setSize(this.width, this.height);
    this.renderer.setPixelRatio(
      pixelRatioForTier(this.qualityTier, window.devicePixelRatio),
    );
    this.renderer.domElement.style.position = 'fixed';
    this.renderer.domElement.style.inset = '0';
    this.renderer.domElement.style.zIndex = '0';
    container.appendChild(this.renderer.domElement);

    const canvas = this.renderer.domElement;

    const getIdleCursor = (): string => {
      if (this.cursorMode === 'sculpt') return CURSOR_SCULPT_IDLE;
      const canDrag = this.viewportCaps.pan || this.viewportCaps.orbit;
      return canDrag ? CURSOR_SVG_IDLE : '';
    };

    const getActiveCursor = (): string => {
      if (this.cursorMode === 'sculpt') return CURSOR_SCULPT_ACTIVE;
      return CURSOR_SVG_ACTIVE;
    };

    const updateIdleCursor = () => {
      if (this.dragging) return;
      canvas.style.cursor = getIdleCursor();
    };

    // Track each contact separately so pinching never also triggers a one-finger drag.
    let activePointer: number | null = null;
    let mode: NavigationMode | null = null;
    const touches = new Map<number, { x: number; y: number }>();
    const pinch = () => {
      const [a, b] = [...touches.values()];
      return a && b
        ? {
            x: (a.x + b.x) / 2,
            y: (a.y + b.y) / 2,
            distance: Math.hypot(a.x - b.x, a.y - b.y),
          }
        : null;
    };
    canvas.style.touchAction = 'none';
    canvas.tabIndex = 0;
    canvas.setAttribute('aria-label', 'Visualizer Viewport');
    canvas.addEventListener('pointerdown', (e) => {
      canvas.focus({ preventScroll: true });
      if (e.pointerType === 'touch')
        touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (touches.size > 1) {
        activePointer = null;
        this.dragging = true;
        canvas.setPointerCapture(e.pointerId);
        return;
      }
      mode = dragMode(e, this.viewportCaps, this.cursorMode === 'sculpt');
      if (!mode || activePointer !== null) return;
      activePointer = e.pointerId;
      this.dragging = true;
      this.lastPointerX = e.clientX;
      this.lastPointerY = e.clientY;
      canvas.style.cursor = getActiveCursor();
      canvas.setPointerCapture(e.pointerId);
      e.preventDefault();
    });
    canvas.addEventListener('pointermove', (e) => {
      if (touches.has(e.pointerId)) {
        const before = pinch();
        touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
        const after = pinch();
        if (before && after) {
          if (
            this.viewportCaps.zoom &&
            before.distance > 0 &&
            after.distance > 0
          )
            this._onZoom?.(Math.log(after.distance / before.distance));
          if (this.viewportCaps.pan)
            this._onDrag?.(
              (after.x - before.x) / this.width,
              (after.y - before.y) / this.height,
              'pan',
            );
          return;
        }
      }
      if (activePointer !== e.pointerId || !mode) return;
      const dx = (e.clientX - this.lastPointerX) / this.width;
      const dy = (e.clientY - this.lastPointerY) / this.height;
      this.lastPointerX = e.clientX;
      this.lastPointerY = e.clientY;
      if (mode === 'zoom') this._onZoom?.(-dy * 3);
      else this._onDrag?.(dx, dy, mode);
    });
    const end = (e: PointerEvent) => {
      touches.delete(e.pointerId);
      if (activePointer === e.pointerId) activePointer = null;
      this.dragging = activePointer !== null || touches.size > 1;
      if (canvas.hasPointerCapture(e.pointerId))
        canvas.releasePointerCapture(e.pointerId);
      updateIdleCursor();
    };
    canvas.addEventListener('pointerup', end);
    canvas.addEventListener('pointercancel', end);
    canvas.addEventListener('lostpointercapture', end);
    canvas.addEventListener('auxclick', (e) => {
      if (e.button === 1) e.preventDefault();
    });
    canvas.addEventListener('dblclick', (e) => {
      e.preventDefault();
      this._onReset?.();
    });
    canvas.addEventListener(
      'wheel',
      (e) => {
        const caps = this.viewportCaps;
        // Browser trackpad pinch arrives as Ctrl+wheel; use event magnitude, never device guessing.
        if (!e.ctrlKey && (e.shiftKey || e.altKey)) {
          const action = e.shiftKey ? 'pan' : 'orbit';
          if (
            (action === 'pan' && !caps.pan) ||
            (action === 'orbit' && !caps.orbit && !caps.rotate)
          )
            return;
          e.preventDefault();
          const scale =
            e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? this.height : 1;
          this._onDrag?.(
            (e.deltaX * scale) / this.width,
            (e.deltaY * scale) / this.height,
            action,
          );
        } else if (caps.zoom && e.deltaY !== 0) {
          e.preventDefault();
          this._onZoom?.(wheelZoom(e.deltaY, e.deltaMode, this.height));
        }
      },
      { passive: false },
    );

    // ── WebGL Context Loss Handling ───────────────────────────────
    canvas.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
      this.contextLostHook?.();
      this.gpuTimer?.dispose();
      console.warn('CyberNoetica: WebGL context lost. Pausing render loop.');
      this.stop();
    });

    canvas.addEventListener('webglcontextrestored', () => {
      if (this.renderer)
        this.gpuTimer = new GpuTimer(
          this.renderer.getContext() as WebGL2RenderingContext,
        );
      console.info(
        'CyberNoetica: WebGL context restored. Re-initialization required.',
      );
      if (this._onContextRestored) this._onContextRestored();
      else this.start();
    });
  }

  setViewportCapabilities(caps: ViewportCapabilities): void {
    this.viewportCaps = caps;
    this._updateCursor();
  }

  setCursorMode(mode: CursorMode): void {
    this.cursorMode = mode;
    this._updateCursor();
  }

  private _updateCursor(): void {
    if (!this.renderer || this.dragging) return;
    if (this.cursorMode === 'sculpt') {
      this.renderer.domElement.style.cursor = CURSOR_SCULPT_IDLE;
    } else {
      const canDrag = this.viewportCaps.pan || this.viewportCaps.orbit;
      this.renderer.domElement.style.cursor = canDrag ? CURSOR_SVG_IDLE : '';
    }
  }

  onViewportDrag(handler: ViewportDragHandler | null): void {
    this._onDrag = handler;
  }
  onViewportZoom(handler: ViewportZoomHandler | null): void {
    this._onZoom = handler;
  }
  onViewportReset(handler: ViewportResetHandler | null): void {
    this._onReset = handler;
  }
  onContextRestored(handler: ContextRestoredHandler | null): void {
    this._onContextRestored = handler;
  }

  resetPerspectiveCamera(): void {
    this.perspCamera.fov = 60;
    this.perspCamera.near = 0.1;
    this.perspCamera.far = 100;
    this.perspCamera.aspect = this.width / Math.max(this.height, 1);
    this.perspCamera.position.set(0, 0, 12);
    this.perspCamera.up.set(0, 1, 0);
    this.perspCamera.lookAt(0, 0, 0);
    this.perspCamera.updateProjectionMatrix();
  }

  /**
   * Dispose leftover GPU resources and empty the scene graph. Safe when the
   * renderer has not been attached (unit tests).
   */
  clearScene(): void {
    this.cpuStatistics.reset();
    this.gpuTimer?.statistics.reset();
    const children = this.scene.children.slice();
    for (const child of children) {
      disposeObject3D(child);
      this.scene.remove(child);
    }
    if (this.renderer) {
      this.renderer.setRenderTarget(null);
      this.renderer.autoClear = true;
    }
    this.resetPerspectiveCamera();
  }

  isDragging(): boolean {
    return this.dragging;
  }

  setCameraPosition(
    x: number,
    y: number,
    z: number,
    targetX = 0,
    targetY = 0,
    targetZ = 0,
  ): void {
    this.perspCamera.position.set(x + targetX, y + targetY, z + targetZ);
    this.perspCamera.lookAt(targetX, targetY, targetZ);
  }

  onRender(callback: (time: number) => void): () => void {
    this.renderCallbacks.push(callback);
    return () => {
      this.renderCallbacks = this.renderCallbacks.filter(
        (cb) => cb !== callback,
      );
    };
  }

  setFrameGate(gate: FrameGate | null): void {
    this.frameGate = gate;
  }

  start(): void {
    if (this.animationId !== null) return;
    if (this.visibilityListener === null) {
      this.visibilityListener = () => {
        if (document.hidden) this._pause();
        else this._resume();
      };
      document.addEventListener('visibilitychange', this.visibilityListener);
    }
    const loop = (time: number) => {
      this.animationId = requestAnimationFrame(loop);
      if (this.paused) return;
      if (this.frameGate && !this.frameGate()) return;
      const workStart = performance.now();
      this.renderer?.info.reset();
      this.gpuTimer?.begin();
      for (const cb of this.renderCallbacks) cb(time);
      this.scene.traverse((object) => {
        const materials = (object as THREE.Mesh).material;
        for (const material of Array.isArray(materials)
          ? materials
          : materials
            ? [materials]
            : []) {
          const uniforms = (material as THREE.ShaderMaterial).uniforms;
          if (this.reduceFlashes && uniforms?.u_beatPulse)
            uniforms.u_beatPulse.value *= 0.15;
          if (uniforms?.u_workBudget)
            uniforms.u_workBudget.value = {
              'sub-performance': 0.45,
              performance: 0.6,
              balanced: 0.8,
              high: 1,
              ultra: 1,
            }[this.qualityTier];
        }
      });
      if (this.renderer && this.renderDelegate)
        this.renderDelegate(this.renderer);
      else this.renderer?.render(this.scene, this.activeCamera);
      this.gpuTimer?.end();
      this.cpuMs = performance.now() - workStart;
      this.cpuStatistics.add(this.cpuMs);
    };
    this.animationId = requestAnimationFrame(loop);
  }

  stop(): void {
    if (this.animationId !== null) {
      cancelAnimationFrame(this.animationId);
      this.animationId = null;
    }
    if (this.visibilityListener) {
      document.removeEventListener('visibilitychange', this.visibilityListener);
      this.visibilityListener = null;
    }
  }

  private _pause(): void {
    this.paused = true;
  }
  private _resume(): void {
    this.paused = false;
  }

  isPaused(): boolean {
    return this.paused;
  }

  setQualityTier(tier: QualityTier): void {
    this.qualityTier = tier;
    if (this.renderer) {
      const ratio = pixelRatioForTier(tier, window.devicePixelRatio);
      this.renderer.setPixelRatio(ratio);
      this.renderer.setSize(this.width, this.height);
    }
  }

  getQualityTier(): QualityTier {
    return this.qualityTier;
  }

  precompile(): void {
    if (!this.renderer) return;
    this.renderer.compile(this.scene, this.activeCamera);
  }

  getRendererDebugInfo(): { vendor: string; renderer: string } | null {
    if (!this.renderer) return null;
    const gl = this.renderer.getContext();
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    if (!ext) return null;
    return {
      vendor: String(gl.getParameter(ext.UNMASKED_VENDOR_WEBGL) ?? ''),
      renderer: String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) ?? ''),
    };
  }

  resize(width: number, height: number): void {
    this.width = width;
    this.height = height;
    this.renderer?.setSize(width, height);
    this.perspCamera.aspect = width / height;
    this.perspCamera.updateProjectionMatrix();
  }

  getPixelRatio(): number {
    return this.renderer?.getPixelRatio() ?? 1;
  }

  getDrawingBufferSize(): { width: number; height: number } {
    const dpr = this.getPixelRatio();
    return {
      width: Math.floor(this.width * dpr),
      height: Math.floor(this.height * dpr),
    };
  }

  getRendererInfo(): THREE.WebGLInfo | null {
    return this.renderer?.info ?? null;
  }

  getRenderer(): THREE.WebGLRenderer | null {
    return this.renderer;
  }

  getCanvasElement(): HTMLCanvasElement | null {
    return this.renderer?.domElement ?? null;
  }

  dispose(): void {
    this.stop();
    this.gpuTimer?.dispose();
    this.gpuTimer = null;
    this.renderCallbacks = [];
    this.frameGate = null;
    this._onDrag = null;
    this._onZoom = null;
    this._onReset = null;
    this._onContextRestored = null;
    this.clearScene();
    this.renderer?.domElement.remove();
    this.renderer?.dispose();
    this.renderer = null;
  }
}
