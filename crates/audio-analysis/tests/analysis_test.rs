use audio_analysis::AudioAnalyzer;

#[test]
fn test_sine_wave_peak_detection() {
    let sample_rate = 44100.0;
    let freq = 440.0;
    let fft_size = 2048;
    let mut analyzer = AudioAnalyzer::new(fft_size, sample_rate);

    let samples: Vec<f32> = (0..fft_size)
        .map(|i| (2.0 * std::f32::consts::PI * freq * i as f32 / sample_rate).sin())
        .collect();

    let features = analyzer.analyze_native(&samples);

    assert!(features.spectral_centroid > 0.01 && features.spectral_centroid < 0.05,
        "spectral centroid {} should be near 0.02", features.spectral_centroid);
    assert!(features.rms > 0.5, "RMS {} should be > 0.5", features.rms);
    assert!(features.bass >= 0.0 && features.bass <= 1.0);
    assert!(features.mid >= 0.0 && features.mid <= 1.0);
    assert!(features.high >= 0.0 && features.high <= 1.0);
    assert!(features.rms >= 0.0 && features.rms <= 1.0);
}

#[test]
fn test_silence_produces_near_zero_features() {
    let mut analyzer = AudioAnalyzer::new(2048, 44100.0);
    let silence = vec![0.0f32; 2048];
    let features = analyzer.analyze_native(&silence);

    assert!(features.rms < 0.01, "RMS of silence should be near 0");
    assert!(features.bass < 0.01);
    assert!(features.mid < 0.01);
    assert!(features.high < 0.01);
}

#[test]
fn test_spectral_flux_changes_on_transient() {
    let mut analyzer = AudioAnalyzer::new(2048, 44100.0);
    let silence = vec![0.0f32; 2048];
    analyzer.analyze_native(&silence);

    let burst: Vec<f32> = (0..2048)
        .map(|i| (2.0 * std::f32::consts::PI * 1000.0 * i as f32 / 44100.0).sin())
        .collect();
    let features = analyzer.analyze_native(&burst);

    assert!(features.spectral_flux > 0.1,
        "spectral flux {} should spike on transient", features.spectral_flux);
}
