import { projectionTransport, refineTransport } from './transport.js';
self.onmessage = (
  event: MessageEvent<{
    id: number;
    source: Float32Array;
    target: Float32Array;
    seed: number;
  }>,
) => {
  const { id, source, target, seed } = event.data;
  try {
    const baseline = projectionTransport(source, target, seed);
    self.postMessage({ id, baseline });
    const result = refineTransport(source, target, baseline);
    self.postMessage({ id, result }, { transfer: [result.indices.buffer] });
  } catch (error) {
    self.postMessage({ id, error: String(error) });
  }
};
