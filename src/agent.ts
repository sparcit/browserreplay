import { AgentClient, AgentDecision, RunContext, StepEvent, Snapshot } from "./types";
import { baseLogger } from "./logger";

export class MockAgentClient implements AgentClient {
  private stepCounter = 0;

  async decide(params: {
    goal: string;
    runContext: RunContext;
    recentHistory: StepEvent[];
    snapshot: Snapshot;
  }): Promise<AgentDecision> {
    baseLogger.info("AgentClient: Analyzing snapshot and history to decide next action...");
    
    this.stepCounter++;

    // Scaffolded simulation of LLM returning structured tool calls
    // In a real implementation, we would construct a prompt with the Snapshot + History
    // and send it via @github/copilot-sdk.

    if (this.stepCounter === 1) {
      return {
        thoughtSummary: "I need to navigate to the target URL first.",
        toolCall: {
          name: "navigate",
          input: { url: "https://example.com" }
        }
      };
    }

    if (this.stepCounter === 2) {
      return {
        thoughtSummary: "I should request human approval before clicking a link, as a test of the HITL system.",
        toolCall: {
          name: "requestHumanApproval",
          input: {
            reason: "About to click a prominent link",
            actionSummary: "Clicking the More Information link"
          }
        }
      };
    }

    if (this.stepCounter === 3) {
       return {
        thoughtSummary: "Wait, the page might be ready. Let me finish the task.",
        finish: {
          result: "Task completed successfully after human approval.",
          evidence: [
            { kind: "screenshot", description: "Final state captured" },
            { kind: "url", description: "Ended on correct URL" }
          ]
        }
      };
    }

    // Default exit if loop goes out of bounds
    return {
      finish: {
        result: "Max steps reached in mock.",
        evidence: []
      }
    };
  }
}
