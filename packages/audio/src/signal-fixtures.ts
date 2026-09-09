/** Deterministic calibration signals, also used by the renderer probe. */
export function tone(
  hz: number,
  amplitude = 0.25,
  size = 4096,
  sampleRate = 48000,
  phase = 0,
): Float32Array {
  return Float32Array.from(
    { length: size },
    (_, i) => amplitude * Math.sin((2 * Math.PI * hz * i) / sampleRate + phase),
  );
}

export function silence(size = 4096): Float32Array {
  return new Float32Array(size);
}

export function pulseTrainFrame(
  endTime: number,
  sampleRate = 48000,
  size = 4096,
  bpm = 120,
): Float32Array {
  return Float32Array.from({ length: size }, (_, i) => {
    const t = endTime - (size - i) / sampleRate;
    if (t < 0) return 0;
    const phase = t % (60 / bpm);
    return phase < 0.05
      ? 0.3 * Math.exp(-phase * 40) * Math.sin(t * 2 * Math.PI * 180)
      : 0;
  });
}
