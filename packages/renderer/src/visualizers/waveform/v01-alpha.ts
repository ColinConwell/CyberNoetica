import { spectrumAt } from '../../audio-mapping.js';
import { frameDelta, takeAudioFrame, PhaseClock } from '../../timing.js';
import * as THREE from 'three';
import { MessageBus } from '@cybernoetica/core';
import type {
  AudioFeatures,
  BusMessage,
  Unsubscribe,
} from '@cybernoetica/core';
import { EMASmoothing, EventEnvelope } from '../../smoothing.js';
import type { Visualizer, VisualizerMetadata } from '../types.js';
import { registerVisualizer } from '../registry.js';

/**
 * Math:
 *   The renderer samples FFT magnitudes over frequency bins from 0 Hz to Nyquist,
 *   then uses those amplitudes to displace and color stacked waveform layers.
 * References:
 *   https://mathworld.wolfram.com/FourierTransform.html
 *   https://mathworld.wolfram.com/NyquistFrequency.html
 */

const NUM_LAYERS = 5;
const FFT_SIZE = 1024;

const waveformMetadata: VisualizerMetadata = {
  type: 'waveform',
  label: 'Waveform',
  description: 'Neon soundwaves flowing through space',
  usesPerspective: false,
  params: [
    {
      key: 'displayMode',
      label: 'Display (0 artistic / 1 scope / 2 spectrum)',
      min: 0,
      max: 2,
      step: 1,
      initial: 2,
      category: 'appearance',
      description:
        'Scope shows signed samples; spectrum uses a fixed linear amplitude scale and a logarithmic 20 Hz–20 kHz axis.',
    },
    // Appearance
    {
      key: 'bassBoost',
      label: 'Bass Boost',
      min: 0.0,
      max: 1.0,
      step: 0.05,
      initial: 0.0,
      category: 'appearance',
    },
    {
      key: 'brightness',
      label: 'Brightness',
      min: 0.2,
      max: 2.0,
      step: 0.1,
      initial: 1.0,
      category: 'appearance',
    },
    // Audio mapping strengths
    {
      key: 'bassToAmplitude',
      label: 'Bass \u2192 Amplitude',
      min: 0.0,
      max: 2.0,
      step: 0.1,
      initial: 1.0,
      category: 'audio-mapping',
      description: 'How strongly bass affects wave amplitude',
    },
    {
      key: 'rmsToGlow',
      label: 'RMS \u2192 Glow',
      min: 0.0,
      max: 2.0,
      step: 0.1,
      initial: 1.0,
      category: 'audio-mapping',
      description: 'How strongly volume affects glow intensity',
    },
  ],
  viewport: { pan: false, zoom: false, orbit: false },
  viewStateFields: [
    {
      key: 'verticalShift',
      label: 'Vertical Shift',
      min: -0.5,
      max: 0.5,
      step: 0.01,
    },
  ],
};

export class WaveformVisualizer implements Visualizer {
  private deltaSeconds = 1 / 60;
  private phases = new PhaseClock();
  readonly metadata = waveformMetadata;

  private unsub: Unsubscribe;
  private latestFeatures: AudioFeatures | null = null;
  private time = 0;

  userParams: Record<string, number> = {
    displayMode: 2,
    bassBoost: 0.0,
    brightness: 1.0,
    bassToAmplitude: 1.0,
    rmsToGlow: 1.0,
  };

  private _verticalShift = 0;

  private smoothers = {
    bass: new EMASmoothing(0.15),
    mid: new EMASmoothing(0.2),
    high: new EMASmoothing(0.25),
    rms: new EMASmoothing(0.2),
    spectralCentroid: new EMASmoothing(0.1),
    beatPulse: new EventEnvelope(),
  };

  private material: THREE.ShaderMaterial | null = null;
  private mesh: THREE.Mesh | null = null;
  private fftData: Float32Array;
  private fftTexture: THREE.DataTexture | null = null;

  constructor(private bus: MessageBus) {
    this.fftData = new Float32Array(FFT_SIZE);

    this.unsub = bus.subscribe(
      'audio:features',
      (msg: BusMessage<AudioFeatures>) => {
        this.latestFeatures = { ...msg.payload };
      },
    );

    this.smoothers.bass.reset(0.0);
    this.smoothers.mid.reset(0.0);
    this.smoothers.high.reset(0.0);
    this.smoothers.rms.reset(0.2);
    this.smoothers.spectralCentroid.reset(0.5);
    this.smoothers.beatPulse.reset(0.0);
  }

  attach(scene: THREE.Scene): void {
    this.fftTexture = new THREE.DataTexture(
      this.fftData,
      FFT_SIZE,
      1,
      THREE.RedFormat,
      THREE.FloatType,
    );
    this.fftTexture.needsUpdate = true;

    this.material = new THREE.ShaderMaterial({
      vertexShader: VERTEX_SHADER,
      fragmentShader: FRAGMENT_SHADER,
      uniforms: {
        u_displayMode: { value: 2 },
        u_time: { value: 0.0 },
        u_resolution: { value: new THREE.Vector2(1920, 1080) },
        u_fftTexture: { value: this.fftTexture },
        u_bass: { value: 0.0 },
        u_mid: { value: 0.0 },
        u_high: { value: 0.0 },
        u_activityRms: { value: 0.2 },
        u_rms: { value: 0.2 },
        u_spectralCentroid: { value: 0.5 },
        u_beatPulse: { value: 0.0 },
        u_verticalShift: { value: 0.0 },
      },
      transparent: true,
    });

    const geometry = new THREE.PlaneGeometry(2, 2);
    this.mesh = new THREE.Mesh(geometry, this.material);
    scene.add(this.mesh);
  }

  tick(deltaSeconds = 1 / 60): void {
    this.deltaSeconds = frameDelta(deltaSeconds);
    this.time += this.deltaSeconds;

    if (this.latestFeatures) {
      const f = takeAudioFrame(this.latestFeatures);
      this.smoothers.bass.update(f.bass, this.deltaSeconds);
      this.smoothers.mid.update(f.mid, this.deltaSeconds);
      this.smoothers.high.update(f.high, this.deltaSeconds);
      this.smoothers.rms.update(f.rms, this.deltaSeconds);
      this.smoothers.spectralCentroid.update(
        f.spectralCentroid,
        this.deltaSeconds,
      );
      this.smoothers.beatPulse.update(
        f.beatOnset ? 1.0 : 0.0,
        this.deltaSeconds,
      );

      const mode = Math.round(this.userParams.displayMode);
      this.fftData.fill(0);
      if (mode === 1 && f.waveform?.length) {
        const samples = f.waveform;
        let mean = 0;
        for (const sample of samples) mean += sample / samples.length;
        const span = Math.min(
          samples.length / 2,
          Math.round((f.sampleRate ?? 48000) * 0.02),
        );
        let start = 0;
        for (let i = 1; i < samples.length - span; i++) {
          if (samples[i - 1] < mean && samples[i] >= mean) {
            start = i;
            break;
          }
        }
        for (let i = 0; i < FFT_SIZE; i++) {
          const index = start + (i / (FFT_SIZE - 1)) * (span - 1);
          const lower = Math.floor(index);
          const fraction = index - lower;
          this.fftData[i] =
            samples[lower] * (1 - fraction) +
            samples[lower + 1] * fraction -
            mean;
        }
      } else if (mode === 2) {
        for (let i = 0; i < FFT_SIZE; i++)
          this.fftData[i] = spectrumAt(f, 20 * 1000 ** (i / (FFT_SIZE - 1)));
      } else {
        this.fftData.set(f.fftBins.subarray(0, FFT_SIZE));
      }
      if (this.fftTexture) {
        this.fftTexture.needsUpdate = true;
      }
    } else {
      // Decay beat pulse when idle
      this.smoothers.beatPulse.update(0.0, this.deltaSeconds);
      this.fftData.fill(0);
      if (this.fftTexture) this.fftTexture.needsUpdate = true;
    }

    if (this.material) {
      this.material.uniforms.u_displayMode.value = Math.round(
        this.userParams.displayMode,
      );
      this.material.uniforms.u_time.value = this.time;
      const bToA = this.userParams.bassToAmplitude;
      const rToG = this.userParams.rmsToGlow;
      this.material.uniforms.u_activityRms.value = this.smoothers.rms.value;
      this.material.uniforms.u_bass.value = Math.min(
        this.smoothers.bass.value * bToA + this.userParams.bassBoost,
        1.0,
      );
      this.material.uniforms.u_mid.value = this.smoothers.mid.value;
      this.material.uniforms.u_high.value = this.smoothers.high.value;
      this.material.uniforms.u_rms.value =
        this.smoothers.rms.value * this.userParams.brightness * rToG;
      this.material.uniforms.u_spectralCentroid.value =
        this.smoothers.spectralCentroid.value;
      this.material.uniforms.u_beatPulse.value = this.smoothers.beatPulse.value;
      this.material.uniforms.u_verticalShift.value = this._verticalShift;
    }
  }

  getLayerCount(): number {
    return NUM_LAYERS;
  }

  setResolution(width: number, height: number): void {
    if (this.material) {
      this.material.uniforms.u_resolution.value.set(width, height);
    }
  }

  setUserParam(key: string, value: number): void {
    if (key in this.userParams) {
      this.userParams[key] = value;
    }
  }

  getViewState(): Record<string, number> {
    return { verticalShift: this._verticalShift };
  }

  setViewState(partial: Record<string, number>): void {
    if ('verticalShift' in partial) {
      this._verticalShift = Math.max(
        -0.5,
        Math.min(0.5, partial.verticalShift),
      );
    }
  }

  dispose(): void {
    this.unsub();
    this.material?.dispose();
    this.mesh?.geometry.dispose();
    this.fftTexture?.dispose();
  }
}

registerVisualizer({
  metadata: waveformMetadata,
  create: (bus) => new WaveformVisualizer(bus),
});

const VERTEX_SHADER = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position, 1.0);
  }
`;

const FRAGMENT_SHADER = /* glsl */ `
  precision highp float;

  uniform float u_displayMode;
  uniform float u_time;
  uniform vec2 u_resolution;
  uniform sampler2D u_fftTexture;
  uniform float u_bass;
  uniform float u_mid;
  uniform float u_high;
  uniform float u_activityRms;
  uniform float u_rms;
  uniform float u_spectralCentroid;
  uniform float u_beatPulse;
  uniform float u_verticalShift;

  varying vec2 vUv;

  // ---- Color utilities ----

  #include <cyber_hsv2rgb>

  // Sample FFT data — x in [0,1] maps across frequency bins
  float sampleFFT(float x) {
    return texture2D(u_fftTexture, vec2(clamp(x, 0.0, 1.0), 0.5)).r;
  }

  // Procedural idle wave when no audio is present
  float idleWave(float x, float layerIndex, float time) {
    float freq1 = 2.0 + layerIndex * 1.3;
    float freq2 = 3.7 - layerIndex * 0.5;
    float speed1 = 0.4 + layerIndex * 0.15;
    float speed2 = 0.25 - layerIndex * 0.03;
    float wave = sin(x * freq1 + time * speed1) * 0.3;
    wave += sin(x * freq2 - time * speed2 + layerIndex * 1.5) * 0.15;
    wave += sin(x * 7.0 + time * 0.6 + layerIndex * 2.7) * 0.05;
    // Gentle breathing modulation
    wave *= 0.6 + 0.4 * sin(time * 0.3 + layerIndex * 0.8);
    return wave;
  }

  // Audio-driven wave from FFT data
  float audioWave(float x, float layerIndex) {
    // Each layer reads from a different frequency range of the FFT
    // Layer 0 = bass (0.0-0.1), Layer 4 = highs (0.4-1.0)
    float freqStart = layerIndex / float(${NUM_LAYERS}) * 0.6;
    float freqEnd = (layerIndex + 1.0) / float(${NUM_LAYERS}) * 0.6 + 0.05;
    float freqPos = mix(freqStart, freqEnd, x);
    return sampleFFT(freqPos);
  }

  void main() {
    vec2 uv = gl_FragCoord.xy / u_resolution;
    float y = uv.y - 0.5 - u_verticalShift;
    float x = uv.x;
    if (u_displayMode > 0.5) {
      float baseline = u_displayMode < 1.5 ? 0.0 : -0.3;
      float measured = sampleFFT(x) * 0.6;
      float distanceToLine = abs(y - baseline - measured);
      float width = max(fwidth(y - measured), 1.0 / u_resolution.y);
      vec3 color = vec3(0.25, 0.7, 1.0) * exp(-distanceToLine / (width * 1.6));
      color += vec3(0.025) * (1.0 - smoothstep(width, width * 2.0, abs(y - baseline)));
      if (u_displayMode > 1.5) {
        float decades = log(20.0) / log(10.0) + x * 3.0;
        float grid = abs(fract(decades + 0.5) - 0.5);
        color += vec3(0.02) * (1.0 - smoothstep(0.0, fwidth(decades) * 1.5, grid));
      }
      gl_FragColor = vec4(color * (0.7 + u_rms), 1.0);
      return;
    }

    // Aspect ratio correction for glow calculations
    float aspect = u_resolution.x / u_resolution.y;

    // Detect if audio is active (rms > small threshold)
    float audioMix = smoothstep(0.02, 0.15, u_activityRms);

    // Hue shift driven by spectral centroid
    float baseHue = u_spectralCentroid * 0.3 + u_time * 0.02;

    // Beat flash: brief brightness boost
    float beatFlash = u_beatPulse * 0.6;

    // Accumulate color from all waveform layers
    vec3 totalColor = vec3(0.0);

    for (int i = 0; i < ${NUM_LAYERS}; i++) {
      float fi = float(i);
      float layerNorm = fi / float(${NUM_LAYERS} - 1); // 0..1

      // --- Layer properties ---
      // Vertical offset: spread layers centered in viewport, tight grouping
      float yOffset = (layerNorm - 0.5) * 0.3 + 0.02;

      // Scroll speed: bass layers slow, high layers fast
      float scrollSpeed = 0.2 + layerNorm * 0.6;
      float scrolledX = x + u_time * scrollSpeed;

      // Layer amplitude driven by frequency band
      float bandAmp = 1.0;
      if (i < 2) {
        bandAmp = mix(0.3, 1.0, u_bass); // bass layers
      } else if (i < 4) {
        bandAmp = mix(0.3, 1.0, u_mid);  // mid layers
      } else {
        bandAmp = mix(0.3, 1.0, u_high);  // high layers
      }

      // Compute wave displacement
      float idleY = idleWave(scrolledX, fi, u_time);
      float audioY = (audioWave(fract(scrolledX * 0.5), fi) - 0.5) * 2.0 * bandAmp;
      float waveY = mix(idleY, audioY * 0.4, audioMix);

      // Overall amplitude scaling: bass makes everything bigger
      float ampScale = 0.08 + u_bass * 0.12;
      waveY *= ampScale * (1.0 + beatFlash * 0.5);

      // Distance from this pixel to the waveform line
      float dist = abs(y - yOffset - waveY);

      // --- Line thickness: bass layers thick, high layers thin ---
      float thickness = mix(0.012, 0.004, layerNorm);

      // --- Glow ---
      // Tight core glow
      float coreGlow = exp(-dist * dist / (thickness * thickness));
      // Wide soft glow
      float softGlow = exp(-dist * dist / (thickness * 8.0 * thickness * 8.0));

      float glow = coreGlow * 0.8 + softGlow * 0.25;
      glow *= (0.6 + u_rms * 0.8 + beatFlash);

      // --- Layer color ---
      // Each layer gets a distinct hue, shifted by spectral centroid
      float hue = baseHue + layerNorm * 0.4 + fi * 0.12;
      hue = fract(hue);
      // Saturation: high for vivid neon
      float sat = 0.7 + 0.3 * (1.0 - layerNorm);
      // Value: brighter at core
      float val = 0.8 + 0.2 * coreGlow;

      vec3 layerColor = hsv2rgb(vec3(hue, sat, val));

      // --- Layer opacity: front layers more opaque (parallax depth) ---
      float opacity = mix(0.35, 0.85, 1.0 - layerNorm);

      totalColor += layerColor * glow * opacity;
    }

    // Subtle vignette
    float vignette = 1.0 - 0.4 * length((uv - 0.5) * vec2(aspect, 1.0));
    totalColor *= vignette;

    // Background: very dark with a hint of deep blue
    vec3 bg = vec3(0.01, 0.01, 0.03);
    // Subtle background pulse on beat
    bg += vec3(0.02, 0.01, 0.04) * beatFlash;

    vec3 finalColor = bg + totalColor;

    // Tone mapping — keep neon pop but avoid blowout
    finalColor = finalColor / (1.0 + finalColor);

    gl_FragColor = vec4(finalColor, 1.0);
  }
`;
