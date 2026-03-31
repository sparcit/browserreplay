import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PlaywrightBrowserController } from '../browser';
import { defaultConfig } from '../config';

vi.mock('playwright', () => ({
  chromium: {
    launch: vi.fn().mockResolvedValue({
      newContext: vi.fn().mockResolvedValue({
        tracing: { start: vi.fn(), stop: vi.fn() },
        newPage: vi.fn().mockResolvedValue({
          goto: vi.fn().mockResolvedValue(null),
          close: vi.fn()
        }),
        close: vi.fn()
      }),
      close: vi.fn()
    })
  }
}));

describe('Navigate Tool', () => {
  let browser: PlaywrightBrowserController;

  beforeEach(async () => {
    browser = new PlaywrightBrowserController(defaultConfig, '/tmp');
    await browser.init();
  });

  it('should navigate to valid url successfully', async () => {
    const result = await browser.navigate({ url: 'https://example.com' });
    expect(result.success).toBe(true);
    expect(result.stateHints).toContainEqual({ kind: 'url_changed', value: 'https://example.com' });
  });

  it('should return failure if page goto throws', async () => {
    const pageMock = (browser as any).page;
    pageMock.goto.mockRejectedValueOnce(new Error('Navigation timeout'));

    const result = await browser.navigate({ url: 'https://example.com' });
    expect(result.success).toBe(false);
    expect(result.errorCode).toBe('NAVIGATION_FAILED');
  });
});

