import { GoogleGenAI, Type, FunctionDeclaration, Tool } from "@google/genai";
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

export class GeminiAgentClient implements AgentClient {
  private ai: GoogleGenAI;
  private model: string;
  private tools: Tool[];

  constructor(model: string = process.env.GEMINI_MODEL || "gemini-2.5-flash") {
    if (!process.env.GEMINI_API_KEY) {
      throw new Error("GEMINI_API_KEY environment variable is required to use GeminiAgentClient.");
    }
    this.ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
    this.model = model;
    this.tools = [this.getTools()];
  }

  private getTools(): Tool {
    const navigate: FunctionDeclaration = {
      name: "navigate",
      description: "Navigate the browser to a URL",
      parameters: {
        type: Type.OBJECT,
        properties: {
          url: { type: Type.STRING },
        },
        required: ["url"],
      },
    };

    const click: FunctionDeclaration = {
      name: "click",
      description: "Click a target element",
      parameters: {
        type: Type.OBJECT,
        properties: {
          target: {
            type: Type.OBJECT,
            properties: {
              role: { type: Type.STRING },
              name: { type: Type.STRING },
              label: { type: Type.STRING },
              placeholder: { type: Type.STRING },
              text: { type: Type.STRING },
              testId: { type: Type.STRING },
              css: { type: Type.STRING },
              fallbackNumericId: { type: Type.INTEGER },
            },
          },
        },
        required: ["target"],
      },
    };

    const typeText: FunctionDeclaration = {
      name: "typeText",
      description: "Type text into a target field",
      parameters: {
        type: Type.OBJECT,
        properties: {
          target: {
            type: Type.OBJECT,
            properties: {
              role: { type: Type.STRING },
              name: { type: Type.STRING },
              label: { type: Type.STRING },
              placeholder: { type: Type.STRING },
              text: { type: Type.STRING },
              testId: { type: Type.STRING },
              css: { type: Type.STRING },
              fallbackNumericId: { type: Type.INTEGER },
            },
          },
          text: { type: Type.STRING },
          submit: { type: Type.BOOLEAN },
        },
        required: ["target", "text"],
      },
    };

    const scroll: FunctionDeclaration = {
      name: "scroll",
      description: "Scroll page",
      parameters: {
        type: Type.OBJECT,
        properties: {
          direction: { type: Type.STRING, description: "Enum: 'up' or 'down'" },
          amount: { type: Type.NUMBER },
        },
        required: ["direction"],
      },
    };

    const pressKey: FunctionDeclaration = {
      name: "pressKey",
      description: "Press keyboard key",
      parameters: {
        type: Type.OBJECT,
        properties: {
          key: { type: Type.STRING },
        },
        required: ["key"],
      },
    };

    const requestHumanApproval: FunctionDeclaration = {
      name: "requestHumanApproval",
      description: "Request human approval before sensitive action",
      parameters: {
        type: Type.OBJECT,
        properties: {
          reason: { type: Type.STRING },
          actionSummary: { type: Type.STRING },
        },
        required: ["reason", "actionSummary"],
      },
    };

    const finish: FunctionDeclaration = {
      name: "finish",
      description: "Finish execution and provide evidence",
      parameters: {
        type: Type.OBJECT,
        properties: {
          result: { type: Type.STRING },
          evidence: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                kind: {
                  type: Type.STRING,
                  description: "Enum: 'url', 'visible_text', 'screenshot', 'extracted_value', 'confirmation_banner', 'modal_state'",
                },
                description: { type: Type.STRING },
                url: { type: Type.STRING },
                visibleText: { type: Type.STRING },
                screenshotPath: { type: Type.STRING },
                extractedValue: { type: Type.STRING },
              },
              required: ["kind", "description"],
            },
          },
        },
        required: ["result", "evidence"],
      },
    };

    return {
      functionDeclarations: [
        navigate,
        click,
        typeText,
        scroll,
        pressKey,
        requestHumanApproval,
        finish,
      ],
    };
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
      `Step ${h.step}: ${(h as any).actionName || (h as any).action || 'N/A'} -> ${h.status}` +
      `${h.errorCode ? ` (Error: ${h.errorCode})` : ''}` +
      `${(h as any).message ? ` | ${(h as any).message!.slice(0, 220)}` : ''}`
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

Accessibility Tree:
${truncatedAria}
`;
  }

  async decide(params: {
    goal: string;
    runContext: RunContext;
    recentHistory: StepEvent[];
    snapshot: Snapshot;
  }): Promise<AgentDecision> {
    baseLogger.info("GeminiAgentClient: Requesting Gemini API completion...");

    const systemPrompt = this.buildSystemPrompt(params.runContext);
    const historyPrompt = this.buildHistoryPrompt(params.recentHistory);
    const snapshotPrompt = this.buildSnapshotPrompt(params.snapshot);

    const fullPrompt = `${historyPrompt}\n\n${snapshotPrompt}\n\nReturn exactly one tool call now.`;

    try {
      const response = await this.ai.models.generateContent({
        model: this.model,
        contents: fullPrompt,
        config: {
          systemInstruction: systemPrompt,
          tools: this.tools,
          temperature: 0.1,
        }
      });

      const functionCall = response.functionCalls?.[0];
      const thoughtSummary = response.text || "";

      if (functionCall) {
        const name = functionCall.name as ToolName;
        const args = functionCall.args;
        
        if (name === "finish") {
          return {
            thoughtSummary: thoughtSummary || "Decided to finish run based on tool invocation.",
            finish: args as unknown as FinishInput,
          };
        }

        return {
          thoughtSummary: thoughtSummary || `Decided to execute: ${name}`,
          toolCall: {
            name,
            input: args as unknown as ToolInputMap[ToolName],
          },
        };
      }

      throw new Error("Gemini did not invoke any tool.");
    } catch (e: any) {
      baseLogger.error({ err: e.message }, "Gemini API Engine Error");
      throw e;
    }
  }
}
