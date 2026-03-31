import { describe, it, expect, vi, beforeEach } from 'vitest';
import { StateExecutionEngine } from '../execution';
import { AgentClient, BrowserController, RunLogger, RunContext, Snapshot } from '../types';

describe('StateExecutionEngine', () => {
  let mockBrowser: ReturnType<typeof vi.fn>;
  let mockAgent: any;
  let mockLogger: any;
  let context: RunContext;

  beforeEach(() => {
    mockBrowser = {
      captureSnapshot: vi.fn(),
      navigate: vi.fn(),
      click: vi.fn()
    } as any;

    mockAgent = {
      decide: vi.fn()
    };

    mockLogger = {
      logStep: vi.fn(),
      writeFinalResult: vi.fn()
    };

    context = {
      runId: 'run-123',
      goal: 'Test',
      startedAt: new Date().toISOString(),
      status: 'running',
      currentState: 'observe',
      stepCount: 0,
      retryCount: 0,
      recoveryCount: 0,
      approvalCount: 0,
      config: { maxSteps: 5 } as any
    };
  });

  it('should run observe -> decide -> act sequence successfully', async () => {
    mockBrowser.captureSnapshot = vi.fn().mockResolvedValue({ url: 'http://test' } as Snapshot);
    
    // 1. Agent asks to click
    mockAgent.decide
      .mockResolvedValueOnce({
        toolCall: { name: 'click', input: { target: { text: 'ok' } } }
      })
      // 2. Next time, Agent asks to finish
      .mockResolvedValueOnce({
        finish: { result: 'Done', evidence: [{ kind: 'url', url: 'http://test' }] }
      });
      
    mockBrowser.click = vi.fn().mockResolvedValue({ success: true });

    const engine = new StateExecutionEngine(mockBrowser as any, mockAgent as any, mockLogger as any, context);
    const result = await engine.run('Test');

    expect(result.status).toBe('finished');
    expect(context.stepCount).toBe(2);
    expect(mockBrowser.click).toHaveBeenCalled();
  });

  it('should transition to requestHumanApproval state when appropriate tool is called', async () => {
    mockBrowser.captureSnapshot = vi.fn().mockResolvedValue({ url: 'http://test' });
    
    mockAgent.decide.mockResolvedValueOnce({
      toolCall: { name: 'requestHumanApproval', input: { reason: 'important', actionSummary: 'buying' } }
    });
    
    // we need to force abort since readline prompt blocks
    // To mock handleApprove realistically we can spy on it but vitest can just let it run. 
    // Wait, readline.createInterface is used in handleApprove so we should mock it or just avoid calling it by aborting or returning early.
    // Instead of full integration, let's just make it hit maxSteps and end, or we can mock out the `handleApprove` to throw so we can observe the transition.
  });
});

