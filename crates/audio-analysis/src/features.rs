use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
pub struct AudioFeatures {
    pub bass: f32,
    pub mid: f32,
    pub high: f32,
    pub spectral_centroid: f32,
    pub spectral_flux: f32,
    pub rms: f32,
    pub beat_onset: bool,
    pub beat_confidence: f32,
    pub degraded: bool,
}
