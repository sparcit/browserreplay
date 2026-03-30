import { 
  BrowserController, 
  AgentClient, 
  RunLogger, 
  ExecutionEngine, 
  FinalRunResult,
  RunContext,
  ExecutionState,
  Snapshot,
  AgentDecision,
  ToolResult,
  ToolCall
} from "./types";
import { baseLogger } from "./logger";
import * as readline from "readline/promises";

export class StateExecutionEngine implements ExecutionEngine {
  private browser: BrowserController;
  private agent: AgentClient;
  private logger: RunLogger;
  private context: RunContext;
  
  // Ephemeral state data
  private currentSnapshot?: Snapshot;
  private currentDecision?: AgentDecision;
  private currentToolResult?: ToolResult;
  private successfulActionCount = 0;
  private recentHistory: any[] = [];
  private lastErrorContext?: { toolCall: ToolCall; error: string; attempt: number };

  constructor(
    browser: BrowserController, 
    agent: AgentClient, 
    logger: RunLogger, 
    context: RunContext
  ) {
    this.browser = browser;
    this.agent = agent;
    this.logger = logger;
    this.context = context;
  }

  private isTerminalState(state: ExecutionState): boolean {
    return ["finished", "failed", "aborted", "max_steps_exceeded"].includes(state);
  }

  private validateFinishDecision(): string | null {
    const finish = this.currentDecision?.finish;
    if (!finish) {
      return null;
    }

    if (this.successfulActionCount === 0) {
      return "Invalid finish: no successful tool actions were executed in this run.";
    }

    if (!finish.evidence || finish.evidence.length === 0) {
      return "Invalid finish: evidence is required.";
    }

    if (!finish.result || finish.result.trim().length === 0) {
      return "Invalid finish: result text is required.";
    }

    if (this.currentSnapshot?.url?.startsWith("about:blank")) {
      return "Invalid finish: browser has not navigated away from about:blank.";
    }

    // If the previous browser action failed, force the agent to recover/continue.
    if (this.currentToolResult && !this.currentToolResult.success) {
      return "Invalid finish: previous action failed, so completion cannot be trusted yet.";
    }

    // URL evidence should match what we actually observe now.
    const currentUrl = this.currentSnapshot?.url;
    const urlEvidence = finish.evidence
      .filter((ev) => ev.kind === "url" && typeof ev.url === "string" && ev.url.length > 0)
      .map((ev) => (ev.url || "").replace(/\/$/, ""));

    if (currentUrl && urlEvidence.length > 0) {
      const normalizedCurrent = currentUrl.replace(/\/$/, "");
      const hasCurrentUrlEvidence = urlEvidence.includes(normalizedCurrent);
      if (!hasCurrentUrlEvidence) {
        return `Invalid finish: URL evidence does not match the current observed URL (${currentUrl}).`;
      }
    }

    return null;
  }

  async run(goal: string): Promise<FinalRunResult> {
    baseLogger.info({ goal }, "Execution Engine Started");

    this.context.currentState = "observe";

    while (!this.isTerminalState(this.context.currentState)) {
      if (this.context.stepCount >= this.context.config.maxSteps) {
        this.context.currentState = "max_steps_exceeded";
        this.context.terminalReason = "Exceeded maximum allowed steps.";
        break;
      }

      switch (this.context.currentState) {
        case "observe":
          await this.handleObserve();
          break;
        case "decide":
          await this.handleDecide();
          break;
        case "act":
          await this.handleAct();
          break;
        case "approve":
          await this.handleApprove();
          break;
        case "recover":
          await this.handleRecover();
          break;
      }
    }

    const finalResult: FinalRunResult = {
      runId: this.context.runId,
      status: this.context.currentState as any,
      terminalReason: this.context.terminalReason,
      result: this.currentDecision?.finish?.result,
      evidence: this.currentDecision?.finish?.evidence || [],
      finishedAt: new Date().toISOString()
    };

    await this.logger.writeFinalResult(finalResult);
    return finalResult;
  }

  private async handleObserve() {
    this.context.stepCount++;
    baseLogger.info(`[Step ${this.context.stepCount}] State: OBSERVE`);
    
    try {
      this.currentSnapshot = await this.browser.captureSnapshot(this.context.stepCount);
      
      await this.logger.logStep({
        runId: this.context.runId,
        step: this.context.stepCount,
        state: "observe",
        status: "completed",
        timestamp: new Date().toISOString()
      });

      this.context.currentState = "decide";
      
    } catch (e: any) {
      baseLogger.error(e, "Failed to capture snapshot");
      this.context.terminalReason = `Observation failed: ${e.message}`;
      this.context.currentState = "failed";
    }
  }

  private async handleDecide() {
    baseLogger.info(`[Step ${this.context.stepCount}] State: DECIDE`);
    
    try {
      this.currentDecision = await this.agent.decide({
        goal: this.context.goal,
        runContext: this.context,
        recentHistory: this.recentHistory,
        snapshot: this.currentSnapshot!
      });

      if (this.currentDecision.thoughtSummary) {
        baseLogger.info(`Agent Thought: ${this.currentDecision.thoughtSummary}`);
      }

      await this.logger.logStep({
        runId: this.context.runId,
        step: this.context.stepCount,
        state: "decide",
        status: "completed",
        timestamp: new Date().toISOString()
      });

      if (this.currentDecision.finish) {
        const finishValidationError = this.validateFinishDecision();
        if (finishValidationError) {
          await this.logger.logStep({
            runId: this.context.runId,
            step: this.context.stepCount,
            state: "decide",
            status: "failed",
            message: finishValidationError,
            timestamp: new Date().toISOString()
          });

          // Keep the run alive and force another observe/decide cycle.
          this.recentHistory.push({
            step: this.context.stepCount,
            action: "finish",
            success: false,
            error: finishValidationError,
          });
          baseLogger.warn(finishValidationError);
          this.context.currentState = "observe";
          return;
        }
        this.context.currentState = "finished";
      } else if (this.currentDecision.toolCall) {
        this.context.currentState = "act";
      } else {
        throw new Error("Agent returned neither toolCall nor finish");
      }

    } catch (e: any) {
      baseLogger.error(e, "Agent decision failed");
      this.context.terminalReason = `Agent decision error: ${e.message}`;
      this.context.currentState = "failed";
    }
  }

  private async handleAct() {
    const toolCall = this.currentDecision!.toolCall!;
    baseLogger.info({ toolCall }, `[Step ${this.context.stepCount}] State: ACT`);

    if (toolCall.name === "requestHumanApproval") {
      this.context.currentState = "approve";
      return;
    }

    try {
      // Dispatch cleanly based on tool name
      switch (toolCall.name) {
        case "navigate":
          this.currentToolResult = await this.browser.navigate(toolCall.input as any);
          break;
        case "click":
          this.currentToolResult = await this.browser.click(toolCall.input as any);
          break;
        case "typeText":
          this.currentToolResult = await this.browser.typeText(toolCall.input as any);
          break;
        case "scroll":
          this.currentToolResult = await this.browser.scroll(toolCall.input as any);
          break;
        case "pressKey":
          this.currentToolResult = await this.browser.pressKey(toolCall.input as any);
          break;
        default:
          throw new Error(`Unknown tool tool: ${toolCall.name}`);
      }

      await this.logger.logStep({
        runId: this.context.runId,
        step: this.context.stepCount,
        state: "act",
        actionName: toolCall.name,
        status: this.currentToolResult.success ? "succeeded" : "failed",
        errorCode: this.currentToolResult.errorCode,
        message: this.currentToolResult.message,
        timestamp: new Date().toISOString()
      });

      this.recentHistory.push({
        step: this.context.stepCount,
        action: toolCall.name,
        success: this.currentToolResult.success,
        errorCode: this.currentToolResult.errorCode,
        message: this.currentToolResult.message,
      });

      if (this.currentToolResult.success) {
        this.successfulActionCount++;
        this.context.retryCount = 0;
        // Successful action, loop back to observe
        this.context.currentState = "observe";
      } else {
        // Failed action, transition to recover
        this.lastErrorContext = {
          toolCall: toolCall,
          error: this.currentToolResult.errorCode || "UNKNOWN",
          attempt: this.context.retryCount + 1
        };
        this.context.currentState = "recover";
      }

    } catch (e: any) {
      baseLogger.error(e, "Fatal Error during Act Phase");
      this.context.terminalReason = `Action failed fatally: ${e.message}`;
      this.context.currentState = "failed";
    }
  }

  private async handleApprove() {
    baseLogger.info(`[Step ${this.context.stepCount}] State: APPROVE`);
    const input = this.currentDecision!.toolCall!.input as any;
    
    this.context.approvalCount++;
    const requestedAt = new Date().toISOString();

    console.log("\n=================================");
    console.log(`⚠️ HUMAN APPROVAL REQUIRED`);
    console.log(`Reason: ${input.reason}`);
    console.log(`Action: ${input.actionSummary}`);
    console.log(`URL: ${this.currentSnapshot?.url}`);
    console.log(`Screenshot: ${this.currentSnapshot?.screenshotPath}`);
    console.log("=================================\n");

    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const answer = await rl.question("Approve this action? (y/N): ");
    rl.close();

    const isApproved = answer.toLowerCase().trim() === "y";

    await this.logger.logApproval({
      step: this.context.stepCount,
      reason: input.reason,
      actionSummary: input.actionSummary,
      url: this.currentSnapshot!.url,
      title: this.currentSnapshot!.title,
      screenshotPath: this.currentSnapshot!.screenshotPath,
      requestedAt,
      approved: isApproved,
      decidedAt: new Date().toISOString()
    });

    if (isApproved) {
      baseLogger.info("Action Approved. Resuming execution loop.");
      this.context.currentState = "observe"; 
    } else {
      baseLogger.warn("Action Denied. Aborting run.");
      this.context.terminalReason = "Human-in-the-loop denied the action.";
      this.context.currentState = "aborted";
    }
  }

  private async handleRecover() {
    baseLogger.warn(`[Step ${this.context.stepCount}] State: RECOVER (Attempt ${this.context.retryCount + 1}/${this.context.config.maxRetriesPerAction})`);
    
    this.context.recoveryCount++;

    if (this.context.retryCount >= this.context.config.maxRetriesPerAction) {
      baseLogger.error("Retry budget exhausted. Failing run.");
      this.context.terminalReason = `Retry budget exhausted on error: ${this.lastErrorContext?.error}`;
      this.context.currentState = "failed";
      return;
    }

    // Exponential backoff
    const delay = Math.min(2000 * Math.pow(2, this.context.retryCount), 10000);
    baseLogger.info(`Backing off for ${delay}ms before retrying...`);
    await new Promise(resolve => setTimeout(resolve, delay));
    
    this.context.retryCount++;
    
    // Cycle back to Observe to refresh DOM state and re-decide/re-act
    this.context.currentState = "observe";
  }
}
