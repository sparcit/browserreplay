import { chromium, Browser, BrowserContext, Page, Locator } from "playwright";
import { 
  BrowserController, 
  NavigateInput, 
  ClickInput, 
  TypeTextInput, 
  ScrollInput, 
  PressKeyInput, 
  ToolResult, 
  Snapshot,
  RuntimeConfig,
  TargetHint
} from "./types";
import path from "path";
import { baseLogger } from "./logger";

export class PlaywrightBrowserController implements BrowserController {
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;
  private page: Page | null = null;
  private config: RuntimeConfig;
  private runDir: string;

  constructor(config: RuntimeConfig, runDir: string) {
    this.config = config;
    this.runDir = runDir;
  }

  private async summarizeMatches(locator: Locator, limit: number = 5): Promise<string[]> {
    const summaries: string[] = [];
    const total = await locator.count();
    const take = Math.min(total, limit);

    for (let i = 0; i < take; i++) {
      const item = locator.nth(i);
      const text = (await item.innerText().catch(() => "")).trim().replace(/\s+/g, " ").slice(0, 90);
      const href = await item.getAttribute("href").catch(() => null);
      const visible = await item.isVisible().catch(() => false);
      const label = text || "<no-text>";
      summaries.push(`${i + 1}. ${label}${href ? ` (href: ${href})` : ""}${visible ? " [visible]" : " [hidden]"}`);
    }

    return summaries;
  }

  async init(): Promise<void> {
    this.browser = await chromium.launch({ headless: false });
    this.context = await this.browser.newContext({
      viewport: { width: 1280, height: 800 },
      deviceScaleFactor: 1,
    });

    if (this.config.traceMode === "all" || this.config.traceMode === "failures") {
      await this.context.tracing.start({ screenshots: true, snapshots: true, sources: true });
    }

    this.page = await this.context.newPage();
  }

  async close(failed: boolean = false): Promise<void> {
    if (this.context) {
      if (this.config.traceMode === "all" || (this.config.traceMode === "failures" && failed)) {
        await this.context.tracing.stop({ path: path.join(this.runDir, "trace.zip") });
      } else {
        await this.context.tracing.stop();
      }
    }
    if (this.page) await this.page.close();
    if (this.context) await this.context.close();
    if (this.browser) await this.browser.close();
  }

  // Locator Resolution and Core Execution
  private resolveLocator(hint: TargetHint): Locator {
    if (!this.page) throw new Error("Browser not initialized");
    
    // 1. role + name (or text if name not supplied)
    if (hint.role) {
      if (hint.name) {
        return this.page.getByRole(hint.role as any, { name: hint.name, exact: false });
      } else if (hint.text) {
        return this.page.getByRole(hint.role as any, { name: hint.text, exact: false });
      }
      return this.page.getByRole(hint.role as any);
    }
    // 2. label
    if (hint.label) {
      return this.page.getByLabel(hint.label);
    }
    // 3. placeholder
    if (hint.placeholder) {
      return this.page.getByPlaceholder(hint.placeholder);
    }
    // 4. text
    if (hint.text) {
      return this.page.getByText(hint.text);
    }
    // 5. testId
    if (hint.testId) {
      return this.page.getByTestId(hint.testId);
    }
    // 6. css
    if (hint.css) {
      return this.page.locator(hint.css);
    }
    // 7. fallbackNumericId (scaffolded fallback, omitted logic here initially)
    
    throw new Error("No valid locator hint provided");
  }

  async navigate(input: NavigateInput): Promise<ToolResult> {
    if (!this.page) throw new Error("Browser not initialized");
    try {
      await this.page.goto(input.url, { timeout: this.config.navigationTimeoutMs, waitUntil: "domcontentloaded" });
      
      let dismissedCookieBanner = false;
      // Auto-dismiss heuristic for common cooking consent overlays to save AI tokens and steps
      try {
        // We use a wildcard search waiting up to 5 seconds for the JS framework to render the injected banner
        const acceptButtons = this.page.locator('button, [role="button"]').filter({ hasText: /accept.*(cookies|additional)/i });
        
        // Use waitFor so we don't instantly skip if the React/Vue frontend takes a second to mount it
        await acceptButtons.first().waitFor({ state: 'visible', timeout: 2000 }).catch(() => {});
        
        if (await acceptButtons.count() > 0) {
          await acceptButtons.first().click({ timeout: 2000, force: true });
          // Wait briefly for modal to disappear and UI to settle
          await this.page.waitForTimeout(1000);
          dismissedCookieBanner = true;
          baseLogger.info("Auto-dismissed cookie consent banner.");
        }
      } catch (e) {
        // Silently swallow errors here so navigation still succeeds even if clicking fails
      }

      return {
        success: true,
        message: dismissedCookieBanner 
          ? `Navigated to ${input.url} and auto-dismissed cookie banner` 
          : `Navigated to ${input.url}`,
        stateHints: [{ kind: "url_changed", value: input.url }]
      };
    } catch (error: any) {
      return { success: false, errorCode: "NAVIGATION_FAILED", message: error.message, stateHints: [] };
    }
  }

  async click(input: ClickInput): Promise<ToolResult> {
    if (!this.page) throw new Error("Browser not initialized");
    try {
      const target = this.resolveLocator(input.target);
      const count = await target.count();
      
      if (count === 0) return { success: false, errorCode: "TARGET_NOT_FOUND", message: "Target not found", stateHints: [] };
      
      try {
        await target.first().click({ timeout: this.config.stepTimeoutMs });
        // Basic post-action stabilization
        await this.page.waitForLoadState("domcontentloaded");
        return { success: true, message: "Clicked successfully", stateHints: [{ kind: "dom_changed" }] };
      } catch (clickError: any) {
        if (clickError.message.includes("intercepts pointer events")) {
           return { 
             success: false, 
             errorCode: "OVERLAY_INTERCEPT", 
             message: "Click was blocked by an overlay or modal. You must dismiss the blocking modal first.", 
             stateHints: [] 
           };
        }
        throw clickError;
      }
    } catch (error: any) {
      return { success: false, errorCode: "UNEXPECTED_ERROR", message: error.message, stateHints: [] };
    }
  }

  async typeText(input: TypeTextInput): Promise<ToolResult> {
    if (!this.page) throw new Error("Browser not initialized");
    try {
      const target = this.resolveLocator(input.target);
      const count = await target.count();
      
      if (count === 0) return { success: false, errorCode: "TARGET_NOT_FOUND", message: "Target not found", stateHints: [] };
      if (count > 1) return { success: false, errorCode: "AMBIGUOUS_TARGET", message: `Found ${count} element matches, expected 1.`, stateHints: [] };
      
      await target.fill(input.text, { timeout: this.config.stepTimeoutMs });
      
      if (input.submit) {
        await target.press("Enter");
        await this.page.waitForLoadState("domcontentloaded");
      }
      
      return { success: true, message: `Text typed successfully${input.submit ? " and submitted" : ""}`, stateHints: [{ kind: "value_reflected" }] };
    } catch (error: any) {
      return { success: false, errorCode: "UNEXPECTED_ERROR", message: error.message, stateHints: [] };
    }
  }

  async scroll(input: ScrollInput): Promise<ToolResult> {
    if (!this.page) throw new Error("Browser not initialized");
    try {
      const amount = input.amount || 500;
      await this.page.evaluate(({ direction, amount }) => {
        window.scrollBy({ top: direction === "down" ? amount : -amount, behavior: "smooth" });
      }, { direction: input.direction, amount });
      
      // small wait for scroll to finish
      await this.page.waitForTimeout(500);

      return { success: true, message: `Scrolled ${input.direction}`, stateHints: [{ kind: "dom_changed" }] };
    } catch (error: any) {
      return { success: false, errorCode: "UNEXPECTED_ERROR", message: error.message, stateHints: [] };
    }
  }

  async pressKey(input: PressKeyInput): Promise<ToolResult> {
    if (!this.page) throw new Error("Browser not initialized");
    try {
      await this.page.keyboard.press(input.key);
      await this.page.waitForLoadState("domcontentloaded");
      return { success: true, message: `Pressed key ${input.key}`, stateHints: [{ kind: "dom_changed" }] };
    } catch (error: any) {
      return { success: false, errorCode: "UNEXPECTED_ERROR", message: error.message, stateHints: [] };
    }
  }

  // Observation implementation
  async captureSnapshot(step: number): Promise<Snapshot> {
    if (!this.page) throw new Error("Browser not initialized");
    
    // Stabilize layout slightly before capturing
    await this.page.waitForLoadState("domcontentloaded");
    
    const url = this.page.url();
    const title = await this.page.title();
    
    // 1. Capture screenshot
    const screenshotPath = path.join(this.runDir, "screenshots", `step-${step}.png`);
    await this.page.screenshot({ path: screenshotPath });

    // 2. Capture ARIA snapshot using Playwright's native ARIA YAML generator
    let ariaYaml = "";
    try {
      ariaYaml = await this.page.locator("body").ariaSnapshot();
    } catch (e: any) {
      ariaYaml = `# ARIA Snapshot failed: ${e.message}`;
    }

    // 3. Extract accessibility and actionable metadata
    const metadataDetails = await this.page.evaluate(() => {
      const interactiveCounts = {
        links: document.querySelectorAll("a").length,
        buttons: document.querySelectorAll("button").length,
        inputs: document.querySelectorAll("input").length,
        selects: document.querySelectorAll("select").length,
        textareas: document.querySelectorAll("textarea").length,
        checkboxes: document.querySelectorAll('input[type="checkbox"]').length,
        radios: document.querySelectorAll('input[type="radio"]').length,
      };

      const visibleForms = Array.from(document.forms).map(function(f) {
        return {
          id: f.id,
          name: f.name,
          fields: f.elements.length,
          submitButtons: f.querySelectorAll('button[type="submit"], input[type="submit"]').length
        };
      });

      const focused = document.activeElement as HTMLElement | null;
      let focusedElement = undefined;
      
      if (focused && focused !== document.body) {
        focusedElement = {
          tagName: focused.tagName.toLowerCase(),
          type: (focused as HTMLInputElement).type,
          name: focused.getAttribute("name") || undefined,
          editable: focused.isContentEditable || ["input", "textarea"].includes(focused.tagName.toLowerCase())
        };
      }

      return {
        interactiveCounts,
        visibleForms,
        dialogOpen: document.querySelectorAll("dialog[open]").length > 0,
        loadingIndicators: [],
        pageHints: [],
        focusedElement
      };
    });

    return {
      step,
      url,
      title,
      ariaYaml,
      screenshotPath,
      focusedElement: metadataDetails.focusedElement,
      metadata: {
        interactiveCounts: metadataDetails.interactiveCounts,
        visibleForms: metadataDetails.visibleForms,
        dialogOpen: metadataDetails.dialogOpen,
        loadingIndicators: metadataDetails.loadingIndicators,
        pageHints: metadataDetails.pageHints
      },
      observedAt: new Date().toISOString()
    };
  }
}
