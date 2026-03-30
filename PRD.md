# Product Requirements Document (PRD): BrowserReplay

## 1. Overview and Objective
**Product Name:** BrowserReplay
**Vision:** Provide a seamless, no-code/low-code platform that empowers users to automate browser tasks through two primary modes: **Demonstration** (recording manual steps) and **Agentic Prompts** (AI-driven autonomous execution from natural language). Users can easily edit, parameterize, and replay these workflows on-demand or on a scheduled basis.

**Problem Statement:** Users frequently perform repetitive, predictable tasks in web browsers (data entry, report generation, form submissions), as well as complex goal-oriented tasks (e.g., "find the cheapest product and buy it"). Automating these usually requires programming knowledge (e.g., Playwright, Selenium) or tedious manual effort. 
**Solution:** A dual-mode browser automation platform that features a visual macro recorder for deterministic workflows and an AI agent capable of intelligent web navigation and task completion based on natural language instructions.

---

## 2. Target Audience
*   **QA Engineers & Developers:** Quick end-to-end test generation without writing initial boilerplate code.
*   **Data Entry/Operations Staff:** Automating repetitive form fills and cross-system data transfers.
*   **Marketers & Analysts:** Scraping data or automatically downloading reports on a schedule.

---

## 3. Key Features

### Phase 1: AI-Driven Agentic Navigation (The Core MVP)
The immediate focus is to build the autonomous AI agent capable of executing natural language commands in a headless browser environment.

*   **Natural Language Prompting:** Users can input a goal instruction (e.g., "Go to amazon.co.uk and buy me the cheapest wifi 7 router" or "Show me the cheapest flight from London to New York and book it").
*   **Autonomous Execution:** The agent interprets the query, navigates autonomously, identifies search bars, parses results, and simulates human interactions to achieve the goal without any pre-recorded demo.
*   **Human-in-the-Loop (HITL):** For sensitive or destructive actions (such as finalizing payment or committing a booking), the agent pauses and requests user confirmation.

### Phase 2: Visual Macro Recorder & Workflow Platform
Once the core AI engine is robust, the platform will expand to include a no-code visual recorder, editor, and scheduling system for deterministic, repeatable tasks.

*   **Browser Extension (The Recorder):** Captures manual user actions (navigation, clicks, inputs) to generate a sequence of steps.
*   **Workflow Editor:** A dashboard to view recorded steps, edit CSS selectors, and inject variables/parameters (e.g., pulling from a CSV).
*   **Hybrid Replay Engine:** Execute saved workflows either on-demand or on a scheduled CRON basis, augmenting brittle recorded steps with the Phase 1 AI agent for "Auto-Healing" when selectors change.
*   **Dashboard & Logging:** View execution history, past runs, successes, failures, and access debugging screenshots.

---

## 4. User Flows

### Phase 1 Flows
**Flow 1: Prompt-Driven Agentic Execution**
1. User provides a natural language prompt: "Go to amazon.co.uk, buy me the cheapest wifi 7 router you can find".
2. The AI agent navigates to Amazon, searches for "wifi 7 router", sorts/filters by price, and selects the optimal product.
3. The agent reaches the checkout page and pauses, triggering a "Human-in-the-Loop" notification for the user to confirm the charge.
4. User clicks "Confirm & Pay," and the agent finalizes the purchase.

### Phase 2 Flows
**Flow 2: Creating and parameterizing a Workflow**
1. User clicks the "BrowserReplay" extension icon and starts recording.
2. User performs a workflow (e.g., entering "John Doe" into a CRM) and stops recording.
3. In the Editor, the user modifies the "John Doe" step to accept a variable `${ContactName}` and uploads a CSV dataset.
4. The user schedules the workflow to run daily. The Replay Engine reads the CSV, loops through the dataset, and executes the actions via Playwright.

---

## 5. Technical Architecture

### Phase 1 Architecture (Agentic MVP)
*   **Execution Engine:** Node.js + serverless functions or containerized workers running **Playwright** or **Puppeteer** for browser automation.
*   **AI SDK Integration:** `@github/copilot-sdk` is used to instantiate a `CopilotClient` and manage AI sessions with advanced models (e.g., `gpt-4o` or Claude).
*   **State Capture (Observation):** At each step, Playwright pauses and captures a screenshot plus a cleaned DOM/Accessibility Tree (mapping interactive elements to unique numerical IDs).
*   **Action Execution (ReAct Loop):** 
    *   Playwright's capabilities are exposed to the Copilot agent via `defineTool` (e.g., `click_element(id)`, `type_text(id, text)`, `navigate(url)`).
    *   The state and overarching goal are passed to the SDK session. The LLM invokes tools, seamlessly dispatching commands back to Playwright.
*   **HITL Gateway:** A specific `request_human_approval` tool pauses the loop, saving the session state and awaiting simple CLI or basic UI authorization to proceed.

### Phase 2 Architecture (Workflow Platform Additions)
*   **Recorder (Chrome Extension):** Manifest V3 extension using Content Scripts to capture `click`, `change`, and `keydown` events, creating structured JSON workflows.
*   **Frontend Dashboard:** Next.js (React) + TailwindCSS for the web app, visual editor, and execution histories.
*   **Backend Database:** PostgreSQL (via Supabase or Prisma) to store user accounts, JSON workflows, schedules, and logs.
*   **Job Scheduler:** Cron triggers (e.g., BullMQ, Inngest, or AWS EventBridge) to orchestrate saved workflow replays.

---

## 6. Data Model (Core Entities)
*   **User:** ID, Email, Tier, Settings.
*   **Workflow:** ID, UserID, Name, Description, Steps (JSON array of actions).
*   **Schedule:** ID, WorkflowID, CronExpression, IsActive.
*   **Run Log:** ID, WorkflowID, Status (Success/Fail), ErrorDetails, Timestamp.

---

## 7. Future Enhancements (Post-MVP)
*   **Conditionals & Loops:** "If element X exists, click Y, else click Z."
*   **API Webhooks:** Trigger workflows from external apps (e.g., Zapier/Make integrations).
*   **Export to Code:** Export the recorded workflow directly into Playwright, Puppeteer, or Cypress scripts for developers.
*   **AI Auto-Healing:** If a website updates its UI and a CSS selector breaks, use AI to find the mostly likely new selector based on surrounding context.