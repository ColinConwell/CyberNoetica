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
  private lastMouseX = 0;
  private lastMouseY = 0;

  private viewportCaps: ViewportCapabilities = { pan: true, zoom: true, orbit: false };

  private driftAngle = 0;
  driftEnabled = true;
  driftSpeed = 0.08;

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

    // Viewport interaction: drag to pan, scroll to zoom
    const canvas = this.renderer.domElement;

    canvas.addEventListener('mousedown', (e) => {
      if (e.button === 0) { // left click
        this.dragging = true;
        this.lastMouseX = e.clientX;
        this.lastMouseY = e.clientY;
        canvas.style.cursor = 'grabbing';
      }
    });

    window.addEventListener('mousemove', (e) => {
      if (!this.dragging) return;
      const dx = (e.clientX - this.lastMouseX) / this.width;
      const dy = (e.clientY - this.lastMouseY) / this.height;
      this.lastMouseX = e.clientX;
      this.lastMouseY = e.clientY;

      if (this.viewportCaps.orbit) {
        this.driftAngle += dx * 3.0;
      } else if (this.viewportCaps.pan) {
        this.panX -= dx * 2.0 / this.userZoom;
        this.panY += dy * 2.0 / this.userZoom;
      }
    });

    window.addEventListener('mouseup', () => {
      this.dragging = false;
      canvas.style.cursor = '';
    });

    canvas.addEventListener('wheel', (e) => {
      if (!this.viewportCaps.zoom) return;
      e.preventDefault();
      const zoomDelta = e.deltaY > 0 ? 0.9 : 1.1;
      this.userZoom *= zoomDelta;
      this.userZoom = Math.max(0.2, Math.min(10.0, this.userZoom));
    }, { passive: false });
  }

  setViewportCapabilities(caps: ViewportCapabilities): void {
    this.viewportCaps = caps;
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

      // Auto-drift for perspective camera (orbital visualizer)
      if (this.activeCamera === this.perspCamera && this.driftEnabled && !this.dragging) {
        this.driftAngle += this.driftSpeed / 60;
      }
      if (this.activeCamera === this.perspCamera) {
        const dist = 12;
        this.perspCamera.position.set(
          Math.sin(this.driftAngle) * dist,
          2.0 * Math.sin(this.driftAngle * 0.3), // gentle vertical bob
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
