import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PlaywrightBrowserController } from '../browser';
import { defaultConfig } from '../config';

vi.mock('playwright', () => {
  const makeLocatorMock = (count = 1) => ({
    count: vi.fn().mockResolvedValue(count),
    first: vi.fn().mockReturnValue({ click: vi.fn().mockResolvedValue(true) }),
    nth: vi.fn().mockReturnValue({ click: vi.fn().mockResolvedValue(true) }),
    click: vi.fn().mockResolvedValue(true)
  });

  return {
    chromium: {
      launch: vi.fn().mockResolvedValue({
        newContext: vi.fn().mockResolvedValue({
          tracing: { start: vi.fn(), stop: vi.fn() },
          newPage: vi.fn().mockResolvedValue({
            getByRole: vi.fn().mockReturnValue(makeLocatorMock(1)),
            getByText: vi.fn().mockReturnValue(makeLocatorMock(0)),
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

describe('Click Tool', () => {
  let browser: PlaywrightBrowserController;

  beforeEach(async () => {
    browser = new PlaywrightBrowserController(defaultConfig, '/tmp');
    await browser.init();
  });

  it('should click successfully and await dom load correctly', async () => {
    const result = await browser.click({ target: { role: 'button', name: 'Submit' } });
    expect(result.success).toBe(true);
    expect(result.message).toBe('Clicked successfully');
  });

  it('should fail if no elements are found', async () => {
    const result = await browser.click({ target: { text: 'NonExistent' } });
    expect(result.success).toBe(false);
    expect(result.errorCode).toBe('TARGET_NOT_FOUND');
  });
});

