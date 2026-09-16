import { initialTransport, refineTransport } from './transport.js';
import type { TransportAlgorithm } from './types.js';
self.onmessage = (
  event: MessageEvent<{
    id: number;
    source: Float32Array;
    target: Float32Array;
    seed: number;
    algorithm?: TransportAlgorithm;
  }>,
) => {
  const { id, source, target, seed, algorithm = 'auto' } = event.data;
  try {
    const baseline = initialTransport(source, target, seed, algorithm);
    self.postMessage({ id, baseline });
    const result =
      algorithm === 'auto'
        ? refineTransport(source, target, baseline)
        : baseline;
    self.postMessage({ id, result }, { transfer: [result.indices.buffer] });
  } catch (error) {
    self.postMessage({ id, error: String(error) });
  }
};
