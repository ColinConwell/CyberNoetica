import * as THREE from 'three';
import type { ViewportCapabilities } from './visualizers/types.js';

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

  private panX = 0;
  private panY = 0;
  private userZoom = 1.0;
  private dragging = false;
  private lastPointerX = 0;
  private lastPointerY = 0;

  private viewportCaps: ViewportCapabilities = { pan: true, zoom: true, orbit: false };

  private driftAngle = 0;
  driftEnabled = true;
  driftSpeed = 0.08;

  /** Multiplier to scale pan sensitivity for visualizers with their own zoom (e.g. Mandelbrot) */
  private panSensitivityScale = 1.0;

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
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.domElement.style.position = 'fixed';
    this.renderer.domElement.style.inset = '0';
    this.renderer.domElement.style.zIndex = '0';
    container.appendChild(this.renderer.domElement);

    const canvas = this.renderer.domElement;

    // ── Pointer events (unified mouse + touch) ────────────────────
    const onPointerDown = (e: PointerEvent) => {
      if (e.button !== 0 && e.pointerType === 'mouse') return;
      if (!this.viewportCaps.pan && !this.viewportCaps.orbit && !this.viewportCaps.zoom) return;
      this.dragging = true;
      this.lastPointerX = e.clientX;
      this.lastPointerY = e.clientY;
      canvas.style.cursor = 'grabbing';
      canvas.setPointerCapture(e.pointerId);
      e.preventDefault();
    };

    const onPointerMove = (e: PointerEvent) => {
      if (!this.dragging) return;
      const dx = (e.clientX - this.lastPointerX) / this.width;
      const dy = (e.clientY - this.lastPointerY) / this.height;
      this.lastPointerX = e.clientX;
      this.lastPointerY = e.clientY;

      if (this.viewportCaps.orbit) {
        this.driftAngle += dx * 3.0;
      } else if (this.viewportCaps.pan) {
        const scale = 2.0 * this.panSensitivityScale / this.userZoom;
        this.panX -= dx * scale;
        this.panY += dy * scale;
      }
    };

    const onPointerUp = (e: PointerEvent) => {
      if (!this.dragging) return;
      this.dragging = false;
      canvas.style.cursor = '';
      canvas.releasePointerCapture(e.pointerId);
    };

    canvas.addEventListener('pointerdown', onPointerDown);
    canvas.addEventListener('pointermove', onPointerMove);
    canvas.addEventListener('pointerup', onPointerUp);
    canvas.addEventListener('pointercancel', onPointerUp);

    // ── Double-click to reset viewport ────────────────────────────
    canvas.addEventListener('dblclick', (e) => {
      e.preventDefault();
      this.resetView();
    });

    // ── Scroll to zoom ────────────────────────────────────────────
    canvas.addEventListener('wheel', (e) => {
      if (!this.viewportCaps.zoom) return;
      e.preventDefault();
      const zoomDelta = e.deltaY > 0 ? 0.9 : 1.1;
      this.userZoom *= zoomDelta;
      this.userZoom = Math.max(0.1, Math.min(20.0, this.userZoom));
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
        if (lastPinchDist > 0) {
          const scale = dist / lastPinchDist;
          this.userZoom *= scale;
          this.userZoom = Math.max(0.1, Math.min(20.0, this.userZoom));
        }
        lastPinchDist = dist;
      }
    }, { passive: true });

    canvas.addEventListener('touchend', () => { lastPinchDist = 0; }, { passive: true });
  }

  setViewportCapabilities(caps: ViewportCapabilities): void {
    this.viewportCaps = caps;
  }

  setPanSensitivityScale(scale: number): void {
    this.panSensitivityScale = scale;
  }

  getPan(): [number, number] {
    return [this.panX, this.panY];
  }

  getUserZoom(): number {
    return this.userZoom;
  }

  resetView(): void {
    this.panX = 0;
    this.panY = 0;
    this.userZoom = 1.0;
    this.driftAngle = 0;
  }

  onRender(callback: (time: number) => void): () => void {
    this.renderCallbacks.push(callback);
    return () => { this.renderCallbacks = this.renderCallbacks.filter(cb => cb !== callback); };
  }

  start(): void {
    const loop = (time: number) => {
      this.animationId = requestAnimationFrame(loop);

      if (this.activeCamera === this.perspCamera && this.driftEnabled && !this.dragging) {
        this.driftAngle += this.driftSpeed / 60;
      }
      if (this.activeCamera === this.perspCamera) {
        const dist = 12;
        this.perspCamera.position.set(
          Math.sin(this.driftAngle) * dist,
          2.0 * Math.sin(this.driftAngle * 0.3),
          Math.cos(this.driftAngle) * dist,
        );
        this.perspCamera.lookAt(0, 0, 0);
      }

      for (const cb of this.renderCallbacks) cb(time);
      this.renderer?.render(this.scene, this.activeCamera);
    };
    this.animationId = requestAnimationFrame(loop);
  }

  stop(): void {
    if (this.animationId !== null) { cancelAnimationFrame(this.animationId); this.animationId = null; }
  }

  resize(width: number, height: number): void {
    this.width = width;
    this.height = height;
    this.renderer?.setSize(width, height);
    this.perspCamera.aspect = width / height;
    this.perspCamera.updateProjectionMatrix();
  }

  dispose(): void { this.stop(); this.renderer?.dispose(); this.renderer = null; }
}
