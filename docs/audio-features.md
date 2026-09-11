# Audio feature contract

The active analyzer is `packages/audio/src/spectrum-analyzer.ts`. Production ships this complete implementation in an AudioWorklet. Browsers without AudioWorklet use the same implementation on the main thread. The Rust crate is retained as a reference implementation, but is not a runtime dependency or a silent substitute with different units.

The worklet analyzes a 4096-sample periodic Hann window every 512 audio samples. At 48 kHz these are an 85.3 ms window, 10.7 ms hop, and 11.72 Hz bin spacing. At 44.1 kHz, window duration and spacing change with the actual context sample rate. The compatibility timer samples the latest AnalyserNode window at approximately this cadence; stalls can skip windows. Both paths preserve stereo energy, including opposite-phase channels. Mono inputs are upmixed to both channels. The Sound panel’s Analysis gain (0.25–4) changes analysis sensitivity without changing speaker volume; RMS and spectra describe the signal after that gain.

| Feature | Units and interpretation |
| --- | --- |
| `rms` | Linear full-scale RMS, averaged across channel powers. A full-scale sine is approximately 0.707. |
| `spectrum[k]` | One-sided linear peak amplitude at `k * sampleRate / fftSize`, with Hann coherent-gain correction. |
| `fftBins[k]` | Display-only logarithmic compression of `spectrum`: −100…0 dBFS mapped to 0…1. Do not sum these values to estimate energy. |
| `bandLevels` | Linear RMS estimated from window-corrected spectral power: bass 20–250 Hz, mid 250–4000 Hz, high 4000–20000 Hz, clipped by Nyquist. |
| `bass`, `mid`, `high` | Absolute visual levels: −60…−6 dBFS mapped to 0…1. All three fall with the source level. |
| `bandBalance` | Relative linear band levels divided by their sum. Timbre, independent of overall gain above the numerical floor. |
| `spectralCentroid` | Linear-amplitude weighted mean frequency divided by Nyquist. |
| `spectralFlux` | Positive amplitude novelty, normalized by current spectral power, clamped 0…1. |
| `beatOnset` | Adaptive transient event, using a rolling median/MAD threshold, 140 ms refractory period and a release gate that rejects falling-RMS offsets. This detects onsets; it does not infer musical meter. |
| `onsetId`, `timestamp`, `sequence` | Event identity, audio-clock seconds at window end, and analysis-frame identity. The pipeline retains an onset until a render consumes it. |
| `pitchHz`, `pitchConfidence` | Periodicity-based monophonic estimate, 50–1500 Hz; polyphonic or noisy inputs need a confidence gate. |
| `stereoCorrelation`, `stereoPhase` | Normalized waveform correlation, and cross-spectrum phase in radians at the dominant bin. Phase has a useful interpretation only for coherent tonal content. |
| `waveform` | Signed left-channel samples. Scope display removes DC; this buffer preserves the original measured samples. |

Sound-to-geometry mappings are design choices unless the visualizer explicitly implements a physical resonance. Keep level, timbre, pitch, phase, and onset controls separate. Discrete topology changes should use hysteresis or onset boundaries. Rates are integrated in seconds, never computed as elapsed time multiplied by a newly changed speed. Onset pulses have an immediate attack and an exponential release, independent of display FPS.

The Control panel's Reduce onset flashes preference suppresses onset events delivered to visualizers while retaining continuous level and timbre features. No Audio continues autonomous animation with silent features. Microphone and system capture are analyzed without speaker monitoring, avoiding feedback or duplicated playback; file and Soundscape output follow the user's mute setting.

Tests include deterministic tones, silence, pulse trains, stereo phase inversion, sample-rate changes, calibrated band power, pitch confidence, event retention, and backend fallback. A 4096-sample FFT cannot resolve adjacent low bass notes perfectly; frequency-selective displays should interpolate bins and expose resonance bandwidth instead of claiming precision finer than the measurement.
