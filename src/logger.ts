import pino from "pino";
import { StepEvent, ApprovalCheckpoint, RunContext, FinalRunResult, RunLogger } from "./types";
import fs from "fs/promises";
import path from "path";

// Initialize a base pino logger
export const baseLogger = pino({
  level: process.env.LOG_LEVEL || "info",
  transport: {
    target: "pino-pretty",
    options: {
      colorize: true,
    },
  },
});

export class ExecutionRunLogger implements RunLogger {
  private runDir: string;

  constructor(runId: string) {
    this.runDir = path.join(process.cwd(), "runs", runId);
  }

  async init(): Promise<void> {
    await fs.mkdir(this.runDir, { recursive: true });
    await fs.mkdir(path.join(this.runDir, "screenshots"), { recursive: true });
  }

  async logStep(event: StepEvent): Promise<void> {
    baseLogger.info({ step: event.step, state: event.state, action: event.actionName, status: event.status }, event.message || `Step ${event.step} - ${event.state}`);
    const line = JSON.stringify(event) + "\n";
    await fs.appendFile(path.join(this.runDir, "steps.ndjson"), line);
  }

  async logApproval(checkpoint: ApprovalCheckpoint): Promise<void> {
    baseLogger.info({ checkpoint }, "Approval Checkpoint Requested/Completed");
    const line = JSON.stringify({ type: "approval", ...checkpoint }) + "\n";
    await fs.appendFile(path.join(this.runDir, "steps.ndjson"), line);
  }

  async writeRunContext(context: RunContext): Promise<void> {
    baseLogger.info({ runId: context.runId, goal: context.goal }, "Run Context Started");
    await fs.writeFile(path.join(this.runDir, "run.json"), JSON.stringify(context, null, 2));
  }

  async writeFinalResult(result: FinalRunResult): Promise<void> {
    baseLogger.info({ status: result.status, terminalReason: result.terminalReason }, "Run Finished");
    await fs.writeFile(path.join(this.runDir, "final.json"), JSON.stringify(result, null, 2));
  }

  getScreenshotsDir(): string {
    return path.join(this.runDir, "screenshots");
  }

  getRunDir(): string {
    return this.runDir;
  }
}
