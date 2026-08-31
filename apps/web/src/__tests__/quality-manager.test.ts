import { describe, it, expect } from 'vitest';
import { detectInitialTier, QualityManager } from '../managers/quality-manager.js';
import { MessageBus } from '@cybernoetica/core';

describe('detectInitialTier', () => {
  it('picks high for Apple Silicon', () => {
    expect(detectInitialTier('Apple M1 Pro')).toBe('high');
    expect(detectInitialTier('Apple M3 Max')).toBe('high');
  });

  it('picks high for discrete NVIDIA GPUs', () => {
    expect(detectInitialTier('NVIDIA GeForce RTX 3070')).toBe('high');
    expect(detectInitialTier('NVIDIA GeForce GTX 1080 Ti')).toBe('high');
  });

  it('picks high for discrete AMD GPUs', () => {
    expect(detectInitialTier('AMD Radeon RX 6800 XT')).toBe('high');
  });

  it('picks balanced for Intel integrated', () => {
    expect(detectInitialTier('Intel(R) HD Graphics 4000')).toBe('balanced');
    expect(detectInitialTier('Intel(R) Iris(R) Xe Graphics')).toBe('balanced');
  });

  it('picks performance for mobile GPUs', () => {
    expect(detectInitialTier('Adreno (TM) 660')).toBe('performance');
    expect(detectInitialTier('Mali-G78 MP10')).toBe('performance');
  });

  it('picks performance when touch-only', () => {
    // Touch-only bypasses renderer-string detection.
    expect(detectInitialTier('Apple M1', { touchOnly: true })).toBe('performance');
  });

  it('uses device memory/cpu as fallback when renderer is unknown', () => {
    expect(detectInitialTier(null, { deviceMemory: 16, hwConcurrency: 12 })).toBe('high');
    expect(detectInitialTier(null, { deviceMemory: 4, hwConcurrency: 4 })).toBe('balanced');
    expect(detectInitialTier(null, { deviceMemory: 2, hwConcurrency: 2 })).toBe('performance');
  });

  it('defaults to performance when no signals are available', () => {
    expect(detectInitialTier(null)).toBe('performance');
    expect(detectInitialTier('')).toBe('performance');
  });

  it('resetGovernor clears the rolling frame window', () => {
    const bus = new MessageBus();
    const quality = new QualityManager({
      bus,
      applyTier: () => {},
    });
    for (let i = 1; i <= 10; i++) quality.tick(i * 20);
    expect(quality.getDebugSnapshot().avgFrameMs).toBeGreaterThan(0);
    quality.resetGovernor();
    expect(quality.getDebugSnapshot().avgFrameMs).toBe(0);
  });
});
