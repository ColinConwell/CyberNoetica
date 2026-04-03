import { describe, it, expect, vi } from 'vitest';
import { AudioProcessor } from '../audio-processor.js';
import { MessageBus } from '@cybernoetica/core';

describe('AudioProcessor', () => {
  it('publishes audio features to the message bus', () => {
    const bus = new MessageBus();
    const callback = vi.fn();
    bus.subscribe('audio:features', callback);
    const processor = new AudioProcessor(bus);
    processor.pushFeatures({
      fftBins: new Float32Array(1024), bass: 0.5, mid: 0.3, high: 0.1,
      spectralCentroid: 0.2, spectralFlux: 0.05, rms: 0.4,
      beatOnset: false, beatConfidence: 0.0, degraded: false,
    });
    expect(callback).toHaveBeenCalledOnce();
    expect(callback).toHaveBeenCalledWith(
      expect.objectContaining({ channel: 'audio:features', payload: expect.objectContaining({ bass: 0.5 }) })
    );
  });

  it('publishes degraded features on fallback', () => {
    const bus = new MessageBus();
    const callback = vi.fn();
    bus.subscribe('audio:features', callback);
    const processor = new AudioProcessor(bus);
    processor.pushFeatures({
      fftBins: new Float32Array(1024), bass: 0.5, mid: 0.3, high: 0.1,
      spectralCentroid: 0.0, spectralFlux: 0.0, rms: 0.4,
      beatOnset: false, beatConfidence: 0.0, degraded: true,
    });
    expect(callback.mock.calls[0][0].payload.degraded).toBe(true);
  });
});
