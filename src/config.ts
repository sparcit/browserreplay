import { RuntimeConfig } from "./types";

export const defaultConfig: RuntimeConfig = {
  maxSteps: 25,
  stepTimeoutMs: 15000,
  navigationTimeoutMs: 30000,
  maxRetriesPerAction: 2,
  maxRecoveryAttempts: 3,
  traceMode: "failures",
  approvalMode: "sensitive-only",
};

export function validateConfig(config: Partial<RuntimeConfig> = {}): RuntimeConfig {
  const finalConfig = { ...defaultConfig, ...config };

  if (finalConfig.maxSteps <= 0) {
    throw new Error("Invalid config: maxSteps must be greater than 0");
  }
  if (finalConfig.stepTimeoutMs <= 0 || finalConfig.navigationTimeoutMs <= 0) {
    throw new Error("Invalid config: timeouts must be positive integers");
  }
  if (finalConfig.maxRetriesPerAction < 0 || finalConfig.maxRecoveryAttempts < 0) {
    throw new Error("Invalid config: retry counts must be non-negative integers");
  }

  return finalConfig;
}
