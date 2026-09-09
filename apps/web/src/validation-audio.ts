import { AudioSource, SpectrumAnalyzer } from '@cybernoetica/audio';

/** Exercise the actual shipped worklet, decoder and stereo compatibility tap. */
export async function validateAudio(): Promise<Record<string, unknown>> {
  const source = new AudioSource();
  source.setMuted(true);
  try {
    await source.init();
    await source.resume();
    const sampleRate = 48000,
      frames = sampleRate * 2;
    const bytes = new ArrayBuffer(44 + frames * 4),
      view = new DataView(bytes);
    const text = (offset: number, value: string) => {
      for (let i = 0; i < value.length; i++)
        view.setUint8(offset + i, value.charCodeAt(i));
    };
    text(0, 'RIFF');
    view.setUint32(4, bytes.byteLength - 8, true);
    text(8, 'WAVE');
    text(12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, 2, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * 4, true);
    view.setUint16(32, 4, true);
    view.setUint16(34, 16, true);
    text(36, 'data');
    view.setUint32(40, frames * 4, true);
    for (let i = 0; i < frames; i++) {
      const time = i / sampleRate,
        active = [0.2, 0.65, 1.1, 1.55].some(
          (start) => time >= start && time < start + 0.16,
        );
      const value = active
        ? Math.round(0.3 * Math.sin(2 * Math.PI * 750 * time) * 32767)
        : 0;
      view.setInt16(44 + i * 4, value, true);
      view.setInt16(46 + i * 4, -value, true);
    }
    const onsets = new Set<number>();
    let count = 0,
      maximumRms = 0,
      oppositePhase = false,
      failed = false,
      fallbackRms = 0;
    const fallback = new SpectrumAnalyzer(source.getSampleRate()!);
    const worklet = await source.startAnalysis(
      (features) => {
        count++;
        maximumRms = Math.max(maximumRms, features.rms);
        if (features.beatOnset) onsets.add(features.onsetId!);
        if (features.rms > 0.1 && (features.stereoCorrelation ?? 0) < -0.95)
          oppositePhase = true;
      },
      () => {
        failed = true;
      },
    );
    if (!worklet)
      throw new Error('AudioWorklet unavailable in this test browser');
    await source.loadFile(
      new File([bytes], 'opposite-phase-pulses.wav', { type: 'audio/wav' }),
    );
    await new Promise<void>((resolve, reject) => {
      const timer = setInterval(() => {
        const stereo = source.getStereoSamples();
        if (stereo)
          fallbackRms = Math.max(
            fallbackRms,
            fallback.analyze(stereo[0], source.getCurrentTime(), stereo[1]).rms,
          );
      }, 20);
      const timeout = setTimeout(() => {
        clearInterval(timer);
        reject(new Error('Audio playback timed out'));
      }, 4500);
      source.onEnded(() => {
        clearTimeout(timeout);
        clearInterval(timer);
        resolve();
      });
    });
    if (
      failed ||
      count < 30 ||
      onsets.size !== 4 ||
      maximumRms < 0.18 ||
      !oppositePhase ||
      fallbackRms < 0.18
    )
      throw new Error(
        JSON.stringify({
          failed,
          count,
          onsets: onsets.size,
          maximumRms,
          oppositePhase,
          fallbackRms,
        }),
      );
    return {
      result: 'PASS',
      backend: 'worklet',
      frames: count,
      onsets: onsets.size,
      maximumRms,
      oppositePhase,
      fallbackRms,
    };
  } catch (error) {
    return { result: 'FAIL', error: String(error) };
  } finally {
    source.destroy();
  }
}
