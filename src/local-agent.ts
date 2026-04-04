import {
  AgentClient,
  AgentDecision,
  RunContext,
  StepEvent,
  Snapshot,
  ToolInputMap,
  ToolName,
  FinishInput,
} from "./types";
import { baseLogger } from "./logger";

export class LocalAgentClient implements AgentClient {
  private model: string;
  private baseUrl: string;
  private resolvedModel: string | null = null;

  constructor(
    model: string = process.env.LOCAL_MODEL || "",
    baseUrl: string = process.env.LOCAL_API_BASE || "http://100.121.6.112:44445/api/v1"
  ) {
    this.model = model;
    this.baseUrl = baseUrl;
  }

  private async resolveModel(): Promise<string> {
    if (this.resolvedModel) {
      return this.resolvedModel;
    }

    try {
      // The models endpoint is generally on /v1/models for OpenAI format 
      // even if the chat endpoint is /api/v1/chat
      const hostUrl = new URL(this.baseUrl).origin;
      const response = await fetch(`${hostUrl}/v1/models`);
      if (response.ok) {
        const data = await response.json() as any;
        const models = data.data || [];
        
        if (models.length > 0) {
          if (this.model) {
            const requested = models.find((m: any) => m.id === this.model);
            if (requested) {
              this.resolvedModel = requested.id;
              return this.resolvedModel;
            }
          }
          const fallbackModel = models[0].id;
          if (this.model) {
            baseLogger.warn(`Requested model '${this.model}' not loaded. Falling back to: ${fallbackModel}`);
          } else {
            baseLogger.info(`Auto-selected available model: ${fallbackModel}`);
          }
          this.resolvedModel = fallbackModel;
          return this.resolvedModel;
        }
      }
    } catch (error) {
      baseLogger.debug(error, "Could not fetch models from LM studio");
    }
    
    this.resolvedModel = this.model || "generic-local-model";
    return this.resolvedModel;
  }

  private getTools() {
    return [
      {
        type: "function",
        function: {
          name: "navigate",
          description: "Navigate the browser to a URL",
          parameters: {
            type: "object",
            properties: {
              url: { type: "string" },
            },
            required: ["url"],
          },
        },
      },
      {
        type: "function",
        function: {
          name: "click",
          description: "Click a target element",
          parameters: {
            type: "object",
            properties: {
              target: {
                type: "object",
                properties: {
                  role: { type: "string" },
                  name: { type: "string" },
                  label: { type: "string" },
                  placeholder: { type: "string" },
                  text: { type: "string" },
                  testId: { type: "string" },
                  css: { type: "string" },
                  fallbackNumericId: { type: "integer" },
                },
              },
            },
            required: ["target"],
          },
        },
      },
      {
        type: "function",
        function: {
          name: "typeText",
          description: "Type text into a target field",
          parameters: {
            type: "object",
            properties: {
              target: {
                type: "object",
                properties: {
                  role: { type: "string" },
                  name: { type: "string" },
                  label: { type: "string" },
                  placeholder: { type: "string" },
                  text: { type: "string" },
                  testId: { type: "string" },
                  css: { type: "string" },
                  fallbackNumericId: { type: "integer" },
                },
              },
              text: { type: "string" },
              submit: { type: "boolean" },
            },
            required: ["target", "text"],
          },
        },
      },
      {
        type: "function",
        function: {
          name: "scroll",
          description: "Scroll page",
          parameters: {
            type: "object",
            properties: {
              direction: { type: "string", description: "Enum: 'up' or 'down'" },
              amount: { type: "number" },
            },
            required: ["direction"],
          },
        },
      },
      {
        type: "function",
        function: {
          name: "pressKey",
          description: "Press a key",
          parameters: {
            type: "object",
            properties: {
              key: { type: "string" },
            },
            required: ["key"],
          },
        },
      },
      {
        type: "function",
        function: {
          name: "requestHumanApproval",
          description: "Ask the human for approval to proceed",
          parameters: {
            type: "object",
            properties: {
              reason: { type: "string" },
              actionSummary: { type: "string" },
            },
            required: ["reason", "actionSummary"],
          },
        },
      },
      {
        type: "function",
        function: {
          name: "finish",
          description: "Complete the run with a result",
          parameters: {
            type: "object",
            properties: {
              result: { type: "string" },
              evidence: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    kind: { type: "string" },
                    description: { type: "string" },
                    url: { type: "string" },
                    visibleText: { type: "string" },
                    screenshotPath: { type: "string" },
                    extractedValue: { type: "string" },
                  },
                },
              },
            },
            required: ["result", "evidence"],
          },
        },
      },
    ];
  }

  private buildSystemPrompt(goal: string, config: RunContext["config"]): string {
    const toolsJson = JSON.stringify(this.getTools(), null, 2);
    
    return `You are a strict, accessibility-first BrowserReplay Agent.
Your Goal: ${goal}
Max Steps: ${config.maxSteps}

Rules:
1. Always base actions on the current snapshot's ARIA tree.
2. Prefer referencing elements by role + name when possible.
3. Fallback to placeholder, text, or label if name is missing.
4. Only use fallbackNumericId if absolutely necessary (numeric IDs are brittle).
5. Only navigate if you are not already on the correct site or if explicitly instructed.
6. Use 'finish' when the goal is complete, extracting requested information into 'result'.
7. Use 'requestHumanApproval' if unsure about a sensitive action (e.g., submitting payment, deleting data).
8. If recent steps failed with an error, adapt your strategy. Do not repeat identical failed actions indefinitely.

You must respond with ONLY a JSON object representing the tool call. Do not include markdown formatting or extra text.
Format: { "tool": "tool_name", "arguments": { ... } }

Available tools:
${toolsJson}`;
  }

  private buildHistoryPrompt(history: StepEvent[]): string {
    const recent = history.slice(-12);
    if (recent.length === 0) return "History: None (first step).";

    return recent
      .map((ev: StepEvent) => {
        const errorPart = ev.error_code ? ` (Error: ${ev.error_code})` : "";
        const msg = (ev.message || "").substring(0, 220);
        return `Step ${ev.step}: ${ev.action_name} -> ${ev.status}${errorPart} | ${msg}`;
      })
      .join("\n");
  }

  private buildSnapshotPrompt(snapshot: Snapshot): string {
    const maxAriaLength = 12000;
    const aria =
      snapshot.ariaYaml.length > maxAriaLength
        ? snapshot.ariaYaml.substring(0, maxAriaLength) + "\n... (truncated)"
        : snapshot.ariaYaml;

    return `Current State:
URL: ${snapshot.url}
Title: ${snapshot.title}
Step: ${snapshot.step}

Element Summary (approx):
Links: ${snapshot.metadata.interactiveCounts.links} | Buttons: ${snapshot.metadata.interactiveCounts.buttons} | Inputs: ${snapshot.metadata.interactiveCounts.inputs} | Selects: ${snapshot.metadata.interactiveCounts.selects}

Accessibility Tree:
${aria}
`;
  }

  async decide({
    goal,
    runContext,
    recentHistory,
    snapshot,
  }: {
    goal: string;
    runContext: RunContext;
    recentHistory: StepEvent[];
    snapshot: Snapshot;
  }): Promise<AgentDecision> {
    const resolvedModel = await this.resolveModel();
    const logger = baseLogger.child({ model: resolvedModel, component: "LocalAgentClient" });

    const systemPrompt = this.buildSystemPrompt(goal, runContext.config);
    const historyPrompt = this.buildHistoryPrompt(recentHistory);
    const snapshotPrompt = this.buildSnapshotPrompt(snapshot);

    const userContent = `${historyPrompt}\n\n${snapshotPrompt}\n\nReturn exactly one tool call now (as raw JSON).`;

    try {
      const response = await fetch(`${this.baseUrl}/chat`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": "Bearer dummy",
        },
        body: JSON.stringify({
          model: resolvedModel,
          system_prompt: systemPrompt,
          input: userContent,
          store: false,
          temperature: 0.1,
        }),
      });

      if (!response.ok) {
        const text = await response.text();
        throw new Error(`LM Studio REST API Error (${response.status}): ${text}`);
      }

      const data = await response.json() as any;
      const outputs = data.output;
      if (!outputs || outputs.length === 0) {
        logger.warn("Model returned empty output. Converting to finish-with-error.");
        return {
          thoughtSummary: "Fallback due to missing tool_calls in LLM response",
          finish: {
            result: `Model failed to return a tool call. No content in output.`,
            evidence: [],
          } as FinishInput,
        };
      }

      const messageOutput = outputs.find((o: any) => o.type === "message" || o.type === "text" || !o.type);
      const content = messageOutput?.content || outputs[0].content;

      if (!content) {
        return {
          thoughtSummary: "Fallback due to missing tool_calls in LLM response",
          finish: {
            result: `Model failed to return a tool call. Empty content.`,
            evidence: [],
          } as FinishInput,
        };
      }

      let parsed: any;
      try {
        let cleanContent = content.trim();
        if (cleanContent.startsWith("\`\`\`json")) cleanContent = cleanContent.slice(7);
        else if (cleanContent.startsWith("\`\`\`")) cleanContent = cleanContent.slice(3);
        if (cleanContent.endsWith("\`\`\`")) cleanContent = cleanContent.slice(0, -3);
        parsed = JSON.parse(cleanContent.trim());
      } catch (e) {
        logger.error({ content }, "Failed to parse tool JSON from model");
        return {
          thoughtSummary: "Fallback due to parse error",
          finish: {
            result: `Invalid JSON returned by model. Output was: ${content}`,
            evidence: [],
          } as FinishInput,
        };
      }

      const name = parsed.tool as ToolName;
      if (name === "finish") {
        return {
          thoughtSummary: "Tool call selected by local LLM via JSON schema",
          finish: parsed.arguments as FinishInput,
        };
      }

      return {
        thoughtSummary: "Tool call selected by local LLM via JSON schema",
        toolCall: {
          name,
          input: parsed.arguments || {},
        },
      };
    } catch (error) {
      logger.error(error, "Local LLM request failed");
      throw error;
    }
  }
}
