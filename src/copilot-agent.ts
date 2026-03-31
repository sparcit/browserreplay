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
import { CopilotClient, approveAll, defineTool } from "@github/copilot-sdk";

export interface LiveUsageSummary {
  totalRequests: number;
  totalPremiumRequestsEstimated: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCacheReadTokens: number;
  totalCacheWriteTokens: number;
  totalPremiumRequests?: number;
  byModel: Record<
    string,
    {
      requests: number;
      premiumRequestsEstimated: number;
      inputTokens: number;
      outputTokens: number;
      cacheReadTokens: number;
      cacheWriteTokens: number;
    }
  >;
}

export class CopilotAgentClient implements AgentClient {
  private client: CopilotClient;
  private session: Awaited<ReturnType<CopilotClient["createSession"]>> | null = null;
  private model: string;
  private hasExplicitToken: boolean;
  private capturedToolCall: { name: ToolName; input: unknown } | null = null;
  private capturedFinish: FinishInput | null = null;
  private usageSummary: LiveUsageSummary = {
    totalRequests: 0,
    totalPremiumRequestsEstimated: 0,
    totalInputTokens: 0,
    totalOutputTokens: 0,
    totalCacheReadTokens: 0,
    totalCacheWriteTokens: 0,
    byModel: {},
  };

  constructor(model: string = process.env.COPILOT_MODEL || "gpt-5.3-codex") {
    const token =
      process.env.COPILOT_GITHUB_TOKEN ||
      process.env.GH_TOKEN ||
      process.env.GITHUB_TOKEN;
    this.hasExplicitToken = Boolean(token);

    const clientOptions = token
      ? {
          githubToken: token,
          useLoggedInUser: false,
          logLevel: "error" as const,
        }
      : {
          useLoggedInUser: true,
          logLevel: "error" as const,
        };

    this.client = new CopilotClient(clientOptions);
    this.model = model;
  }

  private async ensureSession(): Promise<void> {
    if (this.session) {
      return;
    }

    await this.client.start();

    // Helpful auth preflight so failures are actionable.
    if (!this.hasExplicitToken) {
      const authStatus = await this.client.getAuthStatus();
      if (!authStatus.authenticated) {
        throw new Error(
          "Copilot SDK is not authenticated. Run `npx @github/copilot login` or set one of COPILOT_GITHUB_TOKEN / GH_TOKEN / GITHUB_TOKEN.",
        );
      }
    }

    const makeTool = <TName extends ToolName>(name: TName, description: string, parameters: Record<string, unknown>) =>
      defineTool(name, {
        description,
        parameters,
        skipPermission: true,
        handler: (args: ToolInputMap[TName]) => {
          this.capturedToolCall = { name, input: args };
          return "tool call captured";
        },
      });

    const navigate = makeTool("navigate", "Navigate the browser to a URL", {
      type: "object",
      properties: { url: { type: "string" } },
      required: ["url"],
      additionalProperties: false,
    });

    const click = makeTool("click", "Click a target element", {
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
            fallbackNumericId: { type: "number" },
          },
          additionalProperties: false,
        },
      },
      required: ["target"],
      additionalProperties: false,
    });

    const typeText = makeTool("typeText", "Type text into a target field", {
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
            fallbackNumericId: { type: "number" },
          },
          additionalProperties: false,
        },
        text: { type: "string" },
        submit: { type: "boolean" },
      },
      required: ["target", "text"],
      additionalProperties: false,
    });

    const scroll = makeTool("scroll", "Scroll page", {
      type: "object",
      properties: {
        direction: { type: "string", enum: ["up", "down"] },
        amount: { type: "number" },
      },
      required: ["direction"],
      additionalProperties: false,
    });

    const pressKey = makeTool("pressKey", "Press keyboard key", {
      type: "object",
      properties: { key: { type: "string" } },
      required: ["key"],
      additionalProperties: false,
    });

    const requestHumanApproval = makeTool("requestHumanApproval", "Request human approval before sensitive action", {
      type: "object",
      properties: {
        reason: { type: "string" },
        actionSummary: { type: "string" },
      },
      required: ["reason", "actionSummary"],
      additionalProperties: false,
    });

    const finish = defineTool("finish", {
      description: "Finish execution and provide evidence",
      parameters: {
        type: "object",
        properties: {
          result: { type: "string" },
          evidence: {
            type: "array",
            items: {
              type: "object",
              properties: {
                kind: {
                  type: "string",
                  enum: ["url", "visible_text", "screenshot", "extracted_value", "confirmation_banner", "modal_state"],
                },
                description: { type: "string" },
                url: { type: "string" },
                visibleText: { type: "string" },
                screenshotPath: { type: "string" },
                extractedValue: { type: "string" },
              },
              required: ["kind", "description"],
              additionalProperties: false,
            },
          },
        },
        required: ["result", "evidence"],
        additionalProperties: false,
      },
      skipPermission: true,
      handler: (args: FinishInput) => {
        this.capturedFinish = args;
        return "finish captured";
      },
    });

    this.session = await this.client.createSession({
      model: this.model,
      onPermissionRequest: approveAll,
      tools: [navigate, click, typeText, scroll, pressKey, requestHumanApproval, finish],
      availableTools: ["navigate", "click", "typeText", "scroll", "pressKey", "requestHumanApproval", "finish"],
      systemMessage: {
        mode: "append",
        content: [
          "You are BrowserReplay Agent.",
          "Call exactly one tool per turn.",
          "Never call multiple tools in one response.",
          "Do not call finish until at least one successful browser action has been executed.",
          "If the page is about:blank or no action has run, choose a tool call instead of finish.",
          "Use accessibility-first target hints: role+name, label, placeholder, text, testId.",
          "Call finish only when evidence supports completion.",
        ].join("\n"),
      },
      streaming: false,
    });

    this.session.on("assistant.usage", (event) => {
      const usage = (event as { data?: Record<string, unknown> }).data || {};
      const model = String(usage.model || "unknown");
      const inputTokens = Number(usage.inputTokens || 0);
      const outputTokens = Number(usage.outputTokens || 0);
      const cacheReadTokens = Number(usage.cacheReadTokens || 0);
      const cacheWriteTokens = Number(usage.cacheWriteTokens || 0);
      const cost = Number(usage.cost || 0);

      this.usageSummary.totalRequests += 1;
      this.usageSummary.totalPremiumRequestsEstimated += cost;
      this.usageSummary.totalInputTokens += inputTokens;
      this.usageSummary.totalOutputTokens += outputTokens;
      this.usageSummary.totalCacheReadTokens += cacheReadTokens;
      this.usageSummary.totalCacheWriteTokens += cacheWriteTokens;

      if (!this.usageSummary.byModel[model]) {
        this.usageSummary.byModel[model] = {
          requests: 0,
          premiumRequestsEstimated: 0,
          inputTokens: 0,
          outputTokens: 0,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
        };
      }

      const modelUsage = this.usageSummary.byModel[model];
      modelUsage.requests += 1;
      modelUsage.premiumRequestsEstimated += cost;
      modelUsage.inputTokens += inputTokens;
      modelUsage.outputTokens += outputTokens;
      modelUsage.cacheReadTokens += cacheReadTokens;
      modelUsage.cacheWriteTokens += cacheWriteTokens;
    });

    this.session.on("session.shutdown", (event) => {
      const shutdownData = (event as { data?: Record<string, unknown> }).data || {};
      const totalPremiumRequests = shutdownData.totalPremiumRequests;
      if (typeof totalPremiumRequests === "number") {
        this.usageSummary.totalPremiumRequests = totalPremiumRequests;
      }
    });
  }

  async getUsageSummary(): Promise<LiveUsageSummary> {
    if (!this.session) {
      return JSON.parse(JSON.stringify(this.usageSummary));
    }

    const events = await this.session.getMessages();
    const computed: LiveUsageSummary = {
      totalRequests: 0,
      totalPremiumRequestsEstimated: 0,
      totalInputTokens: 0,
      totalOutputTokens: 0,
      totalCacheReadTokens: 0,
      totalCacheWriteTokens: 0,
      byModel: {},
    };

    for (const event of events) {
      if (event.type === "assistant.usage") {
        const usage = event.data as {
          model?: string;
          inputTokens?: number;
          outputTokens?: number;
          cacheReadTokens?: number;
          cacheWriteTokens?: number;
        };
        const model = usage.model || "unknown";
        const inputTokens = usage.inputTokens || 0;
        const outputTokens = usage.outputTokens || 0;
        const cacheReadTokens = usage.cacheReadTokens || 0;
        const cacheWriteTokens = usage.cacheWriteTokens || 0;
        const cost = Number((event.data as { cost?: number }).cost || 0);

        computed.totalRequests += 1;
        computed.totalPremiumRequestsEstimated += cost;
        computed.totalInputTokens += inputTokens;
        computed.totalOutputTokens += outputTokens;
        computed.totalCacheReadTokens += cacheReadTokens;
        computed.totalCacheWriteTokens += cacheWriteTokens;

        if (!computed.byModel[model]) {
          computed.byModel[model] = {
            requests: 0,
            premiumRequestsEstimated: 0,
            inputTokens: 0,
            outputTokens: 0,
            cacheReadTokens: 0,
            cacheWriteTokens: 0,
          };
        }

        const modelUsage = computed.byModel[model];
        modelUsage.requests += 1;
        modelUsage.premiumRequestsEstimated += cost;
        modelUsage.inputTokens += inputTokens;
        modelUsage.outputTokens += outputTokens;
        modelUsage.cacheReadTokens += cacheReadTokens;
        modelUsage.cacheWriteTokens += cacheWriteTokens;
      }

      if (event.type === "session.shutdown") {
        computed.totalPremiumRequests = event.data.totalPremiumRequests;
      }
    }

    // Fallback to in-memory counters if message history had no usage events.
    if (computed.totalRequests === 0 && this.usageSummary.totalRequests > 0) {
      return JSON.parse(JSON.stringify(this.usageSummary));
    }

    return computed;
  }

  private buildSystemPrompt(context: RunContext): string {
    return `You are a strict, accessibility-first BrowserReplay Agent.
Your goal is: "${context.goal}"

RULES:
1. You must interact with the browser strictly using the provided tools.
2. Prefer using role + name, label, placeholder, or testId for locating elements. DO NOT use generic CSS paths unless necessary.
3. Every step you MUST return exactly ONE tool call using the function calling interface.
4. Ensure your tool strings are clean and EXACTLY match the required schema.
5. If you reach the exact conclusion and have the required evidence, call the 'finish' tool.
6. If a requested action is highly sensitive (e.g. submitting a payment, deleting an account), call 'requestHumanApproval' first.
7. If a tool fails with AMBIGUOUS_TARGET, do NOT repeat the same selector. Use the candidate hints from recent history to pick a more specific target or navigate directly.

Context Constraints:
- Max allowed steps: ${context.config.maxSteps}
- Current step count: ${context.stepCount}
`;
  }

  private buildHistoryPrompt(history: StepEvent[]): string {
    if (history.length === 0) return "History: None (first step).";

    const recent = history.slice(-12);
    const compactHistory = recent.map(h => 
      `Step ${h.step}: ${(h as { actionName?: string; action?: string }).actionName || (h as { action?: string }).action || 'N/A'} -> ${h.status}` +
      `${h.errorCode ? ` (Error: ${h.errorCode})` : ''}` +
      `${(h as { message?: string }).message ? ` | ${(h as { message?: string }).message!.slice(0, 220)}` : ''}`
    ).join("\n");

    return "Recent Action History:\n" + compactHistory;
  }

  private buildSnapshotPrompt(snapshot: Snapshot): string {
    const truncatedAria = snapshot.ariaYaml.length > 12000
      ? `${snapshot.ariaYaml.slice(0, 12000)}\n...<truncated>`
      : snapshot.ariaYaml;

    return `Current Page Snapshot (Step ${snapshot.step}):
URL: ${snapshot.url}
Title: ${snapshot.title}

Interactive Metadata:
- Links: ${snapshot.metadata.interactiveCounts.links}
- Buttons: ${snapshot.metadata.interactiveCounts.buttons}
- Inputs: ${snapshot.metadata.interactiveCounts.inputs}
- Selects: ${snapshot.metadata.interactiveCounts.selects}
- Visible Forms: ${snapshot.metadata.visibleForms.length}
- Dialog Open: ${snapshot.metadata.dialogOpen}

Focused Element:
${snapshot.focusedElement ? JSON.stringify(snapshot.focusedElement) : 'None'}

ARIA Snapshot:
${truncatedAria}
`;
  }

  private parseAssistantText(event: Awaited<ReturnType<NonNullable<typeof this.session>["sendAndWait"]>>): string {
    if (!event) {
      return "";
    }
    const maybeData = (event as { data?: { content?: string } }).data;
    return maybeData?.content ?? "";
  }

  async decide(params: {
    goal: string;
    runContext: RunContext;
    recentHistory: StepEvent[];
    snapshot: Snapshot;
  }): Promise<AgentDecision> {
    baseLogger.info("CopilotAgentClient: Requesting Copilot SDK completion...");

    await this.ensureSession();

    const systemPrompt = this.buildSystemPrompt(params.runContext);
    const historyPrompt = this.buildHistoryPrompt(params.recentHistory);
    const snapshotPrompt = this.buildSnapshotPrompt(params.snapshot);

    const fullPrompt = `${systemPrompt}\n\n${historyPrompt}\n\n${snapshotPrompt}\n\nReturn exactly one tool call now.`;

    try {
      this.capturedToolCall = null;
      this.capturedFinish = null;

      const assistantEvent = await this.session!.sendAndWait(
        {
          prompt: fullPrompt,
          mode: "immediate",
        },
        180000,
      );

      const assistantText = this.parseAssistantText(assistantEvent);

      if (this.capturedFinish) {
        return {
          thoughtSummary: assistantText || "Decided to finish run based on Copilot tool invocation.",
          finish: this.capturedFinish,
        };
      }

      if (this.capturedToolCall) {
        return {
          thoughtSummary: assistantText || `Decided to execute: ${this.capturedToolCall.name}`,
          toolCall: {
            name: this.capturedToolCall.name,
            input: this.capturedToolCall.input as ToolInputMap[ToolName],
          },
        };
      }

      throw new Error("Copilot session did not invoke any tool.");

    } catch (e: any) {
      baseLogger.error({ err: e.message }, "Live Copilot SDK Engine Error");
      throw e;
    }
  }
}
