import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GeminiAgentClient } from '../gemini-agent';
import { Type } from '@google/genai';

vi.mock('@google/genai', () => ({
  Type: { OBJECT: 'OBJECT', STRING: 'STRING', BOOLEAN: 'BOOLEAN', NUMBER: 'NUMBER', ARRAY: 'ARRAY', INTEGER: 'INTEGER' },
  GoogleGenAI: class {
    models = {
      generateContent: vi.fn().mockResolvedValue({
        functionCalls: [{
          name: 'navigate',
          args: { url: 'https://test.com' }
        }],
        text: 'Going to test.com'
      })
    }
  }
}));

describe('GeminiAgentClient', () => {
  let agent: GeminiAgentClient;

  beforeEach(() => {
    process.env.GEMINI_API_KEY = 'mock-key';
    agent = new GeminiAgentClient('test-model');
  });

  it('can parse tool calls correctly', async () => {
    const decision = await agent.decide({
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

    expect(decision.toolCall?.name).toBe('navigate');
    expect(decision.toolCall?.input).toEqual({ url: 'https://test.com' });
    expect(decision.thoughtSummary).toBe('Going to test.com');
  });
});

