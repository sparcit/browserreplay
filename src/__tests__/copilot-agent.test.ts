import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CopilotAgentClient } from '../copilot-agent';

// Mock the global process.env inside setup
vi.mock('@github/copilot-sdk', () => {
  return {
    CopilotClient: function() {
      this.start = vi.fn().mockResolvedValue(true);
      this.getAuthStatus = vi.fn().mockResolvedValue({ authenticated: true });
      this.createSession = vi.fn().mockResolvedValue({
        on: vi.fn(),
        prompt: vi.fn().mockResolvedValue({ text: 'mock response' }),
        sendAndWait: vi.fn().mockResolvedValue({
          data: { content: 'test response' }
        }),
        getMessages: vi.fn().mockResolvedValue([{
          type: 'assistant.usage',
          data: {
            model: 'test-model',
            inputTokens: 50,
            outputTokens: 20
          }
        }])
      });
    },
    defineTool: vi.fn().mockReturnValue({}),
    approveAll: vi.fn()
  };
});

describe('CopilotAgentClient', () => {
  let agent: CopilotAgentClient;

  beforeEach(() => {
    process.env.COPILOT_GITHUB_TOKEN = 'mock-token';
    agent = new CopilotAgentClient('test-model');
  });

  it('can format usage stats', async () => {
    // Manually trigger decide to create a session
    try {
      await agent.decide({
        goal: 'test',
        snapshot: { 
          url: 'about:blank', 
          title: '', 
          ariaYaml: '', 
          metadata: { 
            interactiveCounts: { links: 0, buttons: 0, inputs: 0, selects: 0, textareas: 0, checkboxes: 0, radios: 0 },
            visibleForms: [],
            dialogOpen: false,
            loadingIndicators: [],
            pageHints: []
          } as any, 
          step: 1, 
          observedAt: '', 
          screenshotPath: '' 
        },
        recentHistory: [],
        runContext: { config: { maxSteps: 10 }, stepCount: 1 } as any
      });
    } catch {
      // Ignore "Copilot session did not invoke any tool" - we just want usage logic here.
    }

    const usage = await agent.getUsageSummary();
    expect(usage.totalRequests).toBe(1);
    expect(usage.totalInputTokens).toBe(50);
  });
});


