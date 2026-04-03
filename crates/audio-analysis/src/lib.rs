pub mod features;

use features::AudioFeatures;
use rustfft::{FftPlanner, num_complex::Complex};
use wasm_bindgen::prelude::*;

#[wasm_bindgen]
pub struct AudioAnalyzer {
    fft_size: usize,
    sample_rate: f32,
    planner: FftPlanner<f32>,
    prev_magnitudes: Vec<f32>,
    peak_tracker: PeakTracker,
}

struct PeakTracker {
    peak: f32,
    decay: f32,
}

impl PeakTracker {
    fn new() -> Self {
        Self { peak: 1.0, decay: 0.999 }
    }

    fn track(&mut self, value: f32) -> f32 {
        if value > self.peak {
            self.peak = value;
        } else {
            self.peak *= self.decay;
            if self.peak < 1.0 { self.peak = 1.0; }
        }
        (value / self.peak).min(1.0)
    }
}

#[wasm_bindgen]
impl AudioAnalyzer {
    #[wasm_bindgen(constructor)]
    pub fn new(fft_size: usize, sample_rate: f32) -> Self {
        Self {
            fft_size,
            sample_rate,
            planner: FftPlanner::new(),
            prev_magnitudes: vec![0.0; fft_size / 2],
            peak_tracker: PeakTracker::new(),
        }
    }

    pub fn analyze(&mut self, samples: &[f32]) -> JsValue {
        let features = self.analyze_native(samples);
        serde_wasm_bindgen::to_value(&features).unwrap()
    }
}

impl AudioAnalyzer {
    pub fn analyze_native(&mut self, samples: &[f32]) -> AudioFeatures {
        let n = self.fft_size;
        let fft = self.planner.plan_fft_forward(n);

        let mut buffer: Vec<Complex<f32>> = samples.iter()
            .take(n)
            .enumerate()
            .map(|(i, &s)| {
                let window = 0.5 * (1.0 - (2.0 * std::f32::consts::PI * i as f32 / (n as f32 - 1.0)).cos());
                Complex { re: s * window, im: 0.0 }
            })
            .collect();

        buffer.resize(n, Complex { re: 0.0, im: 0.0 });
        fft.process(&mut buffer);

        let half = n / 2;
        let magnitudes: Vec<f32> = buffer[..half].iter()
            .map(|c| (c.re * c.re + c.im * c.im).sqrt() / half as f32)
            .collect();

        let bin_freq = self.sample_rate / n as f32;
        let bass_end = (250.0 / bin_freq).ceil() as usize;
        let mid_end = (4000.0 / bin_freq).ceil() as usize;

        let bass_energy = band_energy(&magnitudes, 1, bass_end.min(half));
        let mid_energy = band_energy(&magnitudes, bass_end, mid_end.min(half));
        let high_energy = band_energy(&magnitudes, mid_end, half);

        let rms = (samples.iter().take(n).map(|s| s * s).sum::<f32>() / n as f32).sqrt();

        let total_energy: f32 = magnitudes.iter().sum();
        let spectral_centroid = if total_energy > 1e-10 {
            let weighted_sum: f32 = magnitudes.iter().enumerate()
                .map(|(i, &m)| i as f32 * m)
                .sum();
            (weighted_sum / total_energy) / half as f32
        } else {
            0.0
        };

        let spectral_flux = if !self.prev_magnitudes.is_empty() {
            let flux: f32 = magnitudes.iter().zip(self.prev_magnitudes.iter())
                .map(|(&curr, &prev)| {
                    let diff = curr - prev;
                    if diff > 0.0 { diff * diff } else { 0.0 }
                })
                .sum();
            flux.sqrt()
        } else {
            0.0
        };

        let flux_normalized = self.peak_tracker.track(spectral_flux);
        let beat_onset = flux_normalized > 0.5;
        let beat_confidence = flux_normalized;

        let max_band = bass_energy.max(mid_energy).max(high_energy).max(1e-10);
        let bass_norm = (bass_energy / max_band).min(1.0);
        let mid_norm = (mid_energy / max_band).min(1.0);
        let high_norm = (high_energy / max_band).min(1.0);
        let rms_norm = rms.min(1.0);

        self.prev_magnitudes = magnitudes;

        AudioFeatures {
            bass: bass_norm,
            mid: mid_norm,
            high: high_norm,
            spectral_centroid: spectral_centroid.clamp(0.0, 1.0),
            spectral_flux: flux_normalized.clamp(0.0, 1.0),
            rms: rms_norm,
            beat_onset,
            beat_confidence: beat_confidence.clamp(0.0, 1.0),
            degraded: false,
        }
    }
}

fn band_energy(magnitudes: &[f32], from: usize, to: usize) -> f32 {
    if from >= to || from >= magnitudes.len() {
        return 0.0;
    }
    let end = to.min(magnitudes.len());
    magnitudes[from..end].iter().map(|m| m * m).sum::<f32>().sqrt()
}
