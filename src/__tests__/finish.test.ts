import { describe, it, expect, vi, beforeEach } from 'vitest';
import { StateExecutionEngine } from '../execution';
import { RunContext } from '../types';

describe('Finish Action', () => {
  let mockBrowser: any, mockAgent: any, mockLogger: any, context: RunContext;

  beforeEach(() => {
    mockBrowser = { captureSnapshot: vi.fn().mockResolvedValue({ url: 'http://foo' }) };
    mockLogger = { logStep: vi.fn(), writeFinalResult: vi.fn() };
    context = { config: { maxSteps: 3 }, status: 'running', currentState: 'observe' } as any;
  });

  it('declares finished correctly and returns valid payload', async () => {
    mockAgent = {
      decide: vi.fn()
        .mockResolvedValueOnce({ toolCall: { name: 'navigate', input: {} } })
        .mockResolvedValueOnce({ finish: { result: 'Yay!', evidence: [{ kind: 'url', url: 'http://foo' }] } })
    };
    mockBrowser.navigate = vi.fn().mockResolvedValue({ success: true });

    const engine = new StateExecutionEngine(mockBrowser, mockAgent, mockLogger, context);
    const result = await engine.run('Test');

    expect(result.status).toBe('finished');
    expect(result.result).toBe('Yay!');
  });
});

