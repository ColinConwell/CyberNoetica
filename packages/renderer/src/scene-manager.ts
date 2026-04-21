import * as THREE from 'three';
import type { ViewportCapabilities } from './visualizers/types.js';

export type CursorMode = 'pan' | 'orbit' | 'sculpt' | 'default';

export type QualityTier = 'performance' | 'balanced' | 'high' | 'ultra';

const QUALITY_PIXEL_RATIO_CAP: Record<QualityTier, number> = {
  performance: 1.0,
  balanced: 1.5,
  high: 2.0,
  ultra: Infinity,
};

export function pixelRatioForTier(tier: QualityTier, deviceRatio: number): number {
  const cap = QUALITY_PIXEL_RATIO_CAP[tier];
  return Math.min(deviceRatio, cap);
}

export type FrameGate = () => boolean;

function buildCursorSvg(opts: { strokeAlpha: number; fillAlpha: number; circleRadius: number; ringAlpha: number }): string {
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
  buildCursorSvg({ strokeAlpha: 0.45, fillAlpha: 0.5, circleRadius: 1, ringAlpha: 0.2 }),
)}") 12 12, crosshair`;

const CURSOR_SVG_ACTIVE = `url("data:image/svg+xml,${encodeURIComponent(
  buildCursorSvg({ strokeAlpha: 0.7, fillAlpha: 0.8, circleRadius: 1.5, ringAlpha: 0.4 }),
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

export type ViewportDragHandler = (dx: number, dy: number) => void;
export type ViewportZoomHandler = (delta: number) => void;
export type ViewportResetHandler = () => void;

export class SceneManager {
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
  private visibilityListener: (() => void) | null = null;

  private dragging = false;
  private lastPointerX = 0;
  private lastPointerY = 0;

  private viewportCaps: ViewportCapabilities = { pan: true, zoom: true, orbit: false };
  private cursorMode: CursorMode = 'default';

  private _onDrag: ViewportDragHandler | null = null;
  private _onZoom: ViewportZoomHandler | null = null;
  private _onReset: ViewportResetHandler | null = null;

  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
    this.scene = new THREE.Scene();
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.perspCamera = new THREE.PerspectiveCamera(60, width / height, 0.1, 100);
    this.perspCamera.position.set(0, 0, 12);
    this.perspCamera.lookAt(0, 0, 0);
    this.activeCamera = this.camera;
  }

  attach(container: HTMLElement): void {
    this.renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
    this.renderer.setSize(this.width, this.height);
    this.renderer.setPixelRatio(pixelRatioForTier(this.qualityTier, window.devicePixelRatio));
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

    // ── Pointer events (unified mouse + touch) ────────────────────
    const onPointerDown = (e: PointerEvent) => {
      if (e.button !== 0 && e.pointerType === 'mouse') return;
      if (!this.viewportCaps.pan && !this.viewportCaps.orbit && !this.viewportCaps.zoom) return;
      this.dragging = true;
      this.lastPointerX = e.clientX;
      this.lastPointerY = e.clientY;
      canvas.style.cursor = getActiveCursor();
      canvas.setPointerCapture(e.pointerId);
      e.preventDefault();
    };

    const onPointerMove = (e: PointerEvent) => {
      if (!this.dragging) return;
      const dx = (e.clientX - this.lastPointerX) / this.width;
      const dy = (e.clientY - this.lastPointerY) / this.height;
      this.lastPointerX = e.clientX;
      this.lastPointerY = e.clientY;

      if (this._onDrag && (this.viewportCaps.pan || this.viewportCaps.orbit)) {
        this._onDrag(dx, dy);
      }
    };

    const onPointerUp = (e: PointerEvent) => {
      if (!this.dragging) return;
      this.dragging = false;
      updateIdleCursor();
      canvas.releasePointerCapture(e.pointerId);
    };

    canvas.addEventListener('pointerdown', onPointerDown);
    canvas.addEventListener('pointermove', onPointerMove);
    canvas.addEventListener('pointerup', onPointerUp);
    canvas.addEventListener('pointercancel', onPointerUp);

    // ── Double-click to reset ─────────────────────────────────────
    canvas.addEventListener('dblclick', (e) => {
      e.preventDefault();
      if (this._onReset) this._onReset();
    });

    // ── Scroll to zoom ────────────────────────────────────────────
    canvas.addEventListener('wheel', (e) => {
      if (!this.viewportCaps.zoom) return;
      e.preventDefault();
      const delta = e.deltaY > 0 ? -0.1 : 0.1;
      if (this._onZoom) this._onZoom(delta);
    }, { passive: false });

    // ── Touch pinch-to-zoom ───────────────────────────────────────
    let lastPinchDist = 0;
    canvas.addEventListener('touchstart', (e) => {
      if (e.touches.length === 2) {
        const t = e.touches;
        lastPinchDist = Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
      }
    }, { passive: true });

    canvas.addEventListener('touchmove', (e) => {
      if (e.touches.length === 2 && this.viewportCaps.zoom) {
        const t = e.touches;
        const dist = Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
        if (lastPinchDist > 0 && this._onZoom) {
          const scale = dist / lastPinchDist;
          this._onZoom(scale - 1.0);
        }
        lastPinchDist = dist;
      }
    }, { passive: true });

    canvas.addEventListener('touchend', () => { lastPinchDist = 0; }, { passive: true });
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

  onViewportDrag(handler: ViewportDragHandler): void { this._onDrag = handler; }
  onViewportZoom(handler: ViewportZoomHandler): void { this._onZoom = handler; }
  onViewportReset(handler: ViewportResetHandler): void { this._onReset = handler; }

  isDragging(): boolean { return this.dragging; }

  setCameraPosition(x: number, y: number, z: number): void {
    this.perspCamera.position.set(x, y, z);
    this.perspCamera.lookAt(0, 0, 0);
  }

  onRender(callback: (time: number) => void): () => void {
    this.renderCallbacks.push(callback);
    return () => { this.renderCallbacks = this.renderCallbacks.filter(cb => cb !== callback); };
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
      for (const cb of this.renderCallbacks) cb(time);
      if (this.frameGate && !this.frameGate()) return;
      this.renderer?.render(this.scene, this.activeCamera);
    };
    this.animationId = requestAnimationFrame(loop);
  }

  stop(): void {
    if (this.animationId !== null) { cancelAnimationFrame(this.animationId); this.animationId = null; }
    if (this.visibilityListener) {
      document.removeEventListener('visibilitychange', this.visibilityListener);
      this.visibilityListener = null;
    }
  }

  private _pause(): void { this.paused = true; }
  private _resume(): void { this.paused = false; }

  isPaused(): boolean { return this.paused; }

  setQualityTier(tier: QualityTier): void {
    this.qualityTier = tier;
    if (this.renderer) {
      const ratio = pixelRatioForTier(tier, window.devicePixelRatio);
      this.renderer.setPixelRatio(ratio);
      this.renderer.setSize(this.width, this.height);
    }
  }

  getQualityTier(): QualityTier { return this.qualityTier; }

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
    return { width: Math.floor(this.width * dpr), height: Math.floor(this.height * dpr) };
  }

  getRendererInfo(): THREE.WebGLInfo | null {
    return this.renderer?.info ?? null;
  }

  getRenderer(): THREE.WebGLRenderer | null {
    return this.renderer;
  }

  dispose(): void { this.stop(); this.renderer?.dispose(); this.renderer = null; }
}
