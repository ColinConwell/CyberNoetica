import * as THREE from 'three';

export class SceneManager {
  public width: number;
  public height: number;
  readonly scene: THREE.Scene;
  readonly camera: THREE.OrthographicCamera;
  private renderer: THREE.WebGLRenderer | null = null;
  private animationId: number | null = null;
  private renderCallbacks: Array<(time: number) => void> = [];

  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
    this.scene = new THREE.Scene();
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  }

  attach(container: HTMLElement): void {
    this.renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
    this.renderer.setSize(this.width, this.height);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    container.appendChild(this.renderer.domElement);
  }

  onRender(callback: (time: number) => void): () => void {
    this.renderCallbacks.push(callback);
    return () => { this.renderCallbacks = this.renderCallbacks.filter(cb => cb !== callback); };
  }

  start(): void {
    const loop = (time: number) => {
      this.animationId = requestAnimationFrame(loop);
      for (const cb of this.renderCallbacks) cb(time);
      this.renderer?.render(this.scene, this.camera);
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
  }

  dispose(): void { this.stop(); this.renderer?.dispose(); this.renderer = null; }
}
