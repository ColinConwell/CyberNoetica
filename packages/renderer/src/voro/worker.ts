import { loadVoroBackend } from './backend.js';
import type { VoroBackend, VoroBackendOptions } from './backend.js';
let backend: VoroBackend | null = null;
self.onmessage = async (
  event: MessageEvent<{
    type: string;
    options?: VoroBackendOptions;
    xyz?: Float32Array;
    radii?: Float32Array;
    sphereRadius?: number;
    id: number;
  }>,
) => {
  const data = event.data;
  try {
    if (data.type === 'init') {
      backend = await loadVoroBackend(data.options);
      if (!backend) throw new Error('Voro++ did not initialize');
      self.postMessage({ type: 'ready' });
    } else if (data.type === 'compute' && backend && data.xyz) {
      if (data.sphereRadius !== undefined)
        backend.setSphereRadius(data.sphereRadius);
      const mesh = backend.compute(data.xyz, data.radii);
      const transfer = mesh
        ? Object.values(mesh)
            .filter((value) => ArrayBuffer.isView(value))
            .map((value) => (value as Float32Array).buffer as ArrayBuffer)
        : [];
      self.postMessage({ type: 'mesh', id: data.id, mesh }, { transfer });
    }
  } catch (error) {
    self.postMessage({ type: 'error', message: String(error) });
  }
};
