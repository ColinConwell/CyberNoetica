import { TrackFeatureAccumulator } from './track-analysis.js';
let accumulator: TrackFeatureAccumulator | null = null;
self.onmessage = (event: MessageEvent) => {
  const data = event.data;
  try {
    if (data.type === 'start')
      accumulator = new TrackFeatureAccumulator(data.sampleRate, data.duration);
    else if (data.type === 'chunk' && accumulator) {
      accumulator.push(data.left, data.right);
      const result = accumulator.result(data.final);
      self.postMessage(
        { id: data.id, result },
        { transfer: [result.energy.buffer, result.novelty.buffer] },
      );
    }
  } catch (error) {
    self.postMessage({ id: data.id, error: String(error) });
  }
};
