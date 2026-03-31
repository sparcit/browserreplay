import { describe, it, expect } from 'vitest';
import { validateConfig, defaultConfig } from '../config';

describe('Configuration Validation', () => {
  it('should use default config values when missing', () => {
    const config = validateConfig(defaultConfig);
    expect(config.maxSteps).toBe(25);
    expect(config.traceMode).toBe('failures');
  });

  it('should throw error when maxSteps is negative', () => {
    expect(() => validateConfig({ ...defaultConfig, maxSteps: -1 })).toThrow();
  });
});
