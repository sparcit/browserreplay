import "dotenv/config";
import { ExecutionRunLogger, baseLogger } from "./logger";
import { PlaywrightBrowserController } from "./browser";
import { validateConfig, defaultConfig } from "./config";
import { MockAgentClient } from "./agent";
import { LiveAgentClient } from "./live-agent";
import { GeminiAgentClient } from "./gemini-agent";
import { StateExecutionEngine } from "./execution";
import { randomUUID } from "crypto";
import { RunContext } from "./types";

async function main() {
  const args = process.argv.slice(2);
  const useLiveModel = args.includes("--live");
  const useGemini = args.includes("--gemini");
  
  const goal =
    args.filter((arg) => arg !== "--live" && arg !== "--gemini").join(" ") ||
    "Navigate to bbc.com, click on the most widely read news article, and report back a summary";
  
  const runId = `run-${randomUUID()}`;
  const config = validateConfig(defaultConfig);
  
  const logger = new ExecutionRunLogger(runId);
  await logger.init();
  
  const browserController = new PlaywrightBrowserController(config, logger.getRunDir());
  
  // Conditionally load the appropriate client
  let agentClient;
  if (useGemini) {
    agentClient = new GeminiAgentClient();
    baseLogger.info("Using Gemini Agent Client (--gemini)");
  } else if (useLiveModel) {
    agentClient = new LiveAgentClient();
    baseLogger.info("Using LIVE Copilot SDK Agent Client");
  } else {
    agentClient = new MockAgentClient();
    baseLogger.info("Using MOCK Agent Client (Pass --live or --gemini to use real model)");
  }

  const runContext: RunContext = {
    runId,
    goal,
    startedAt: new Date().toISOString(),
    status: "running",
    currentState: "observe",
    stepCount: 0,
    retryCount: 0,
    recoveryCount: 0,
    approvalCount: 0,
    config
  };

  const executionEngine = new StateExecutionEngine(
    browserController,
    agentClient,
    logger,
    runContext
  );

  try {
    await logger.writeRunContext(runContext);
    
    await browserController.init();
    
    // Kick off the state machine loop
    const finalResult = await executionEngine.run(goal);
    
    baseLogger.info({ finalResult }, "Execution loop finished");

    if (useLiveModel && agentClient instanceof LiveAgentClient) {
      const usage = await agentClient.getUsageSummary();
      baseLogger.info(
        {
          totalRequests: usage.totalRequests,
          totalPremiumRequests: usage.totalPremiumRequests,
          totalPremiumRequestsEstimated: usage.totalPremiumRequestsEstimated,
          totalInputTokens: usage.totalInputTokens,
          totalOutputTokens: usage.totalOutputTokens,
          totalCacheReadTokens: usage.totalCacheReadTokens,
          totalCacheWriteTokens: usage.totalCacheWriteTokens,
          byModel: usage.byModel,
        },
        "Copilot usage summary for this run",
      );
    }

  } catch (error) {
    baseLogger.error(error, "Fatal Engine Error");
  } finally {
    baseLogger.info("Cleaning up browser resources");
    
    // Cleanup tracing appropriately based on mode and outcome
    const isFailed = runContext.currentState === "failed";
    await browserController.close(isFailed);
    
    process.exit(isFailed ? 1 : 0);
  }
}

main().catch(console.error);
