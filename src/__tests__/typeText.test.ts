import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PlaywrightBrowserController } from '../browser';
import { defaultConfig } from '../config';

vi.mock('playwright', () => {
  const makeLocatorMock = (count = 1) => ({
    count: vi.fn().mockResolvedValue(count),
    fill: vi.fn().mockResolvedValue(true),
    press: vi.fn().mockResolvedValue(true)
  });

  return {
    chromium: {
      launch: vi.fn().mockResolvedValue({
        newContext: vi.fn().mockResolvedValue({
          tracing: { start: vi.fn(), stop: vi.fn() },
          newPage: vi.fn().mockResolvedValue({
            getByRole: vi.fn().mockReturnValue(makeLocatorMock(1)),
            getByText: vi.fn().mockReturnValue(makeLocatorMock(2)), // simulate ambiguous target
            waitForLoadState: vi.fn().mockResolvedValue(true),
            close: vi.fn()
          }),
          close: vi.fn()
        }),
        close: vi.fn()
      })
    }
  };
});

describe('typeText Tool', () => {
  let browser: PlaywrightBrowserController;

  beforeEach(async () => {
    browser = new PlaywrightBrowserController(defaultConfig, '/tmp');
    await browser.init();
  });

  it('should type text successfully', async () => {
    const result = await browser.typeText({
      target: { role: 'textbox', name: 'search' },
      text: 'hello world'
    });
    expect(result.success).toBe(true);
    expect(result.stateHints).toContainEqual({ kind: 'value_reflected' });
  });

  it('should format ambiguous target response correctly', async () => {
    const result = await browser.typeText({
      target: { text: 'too many texts' },
      text: 'hello'
    });
    expect(result.success).toBe(false);
    expect(result.errorCode).toBe('AMBIGUOUS_TARGET');
  });

  it('should submit if passing submit: true', async () => {
    const result = await browser.typeText({
      target: { role: 'textbox', name: 'search' },
      text: 'hello',
      submit: true
    });
    expect(result.success).toBe(true);
  });
});

