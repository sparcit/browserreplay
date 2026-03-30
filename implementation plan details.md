implementation-plan.md
text
# Phase 1 Implementation Plan: Agentic Navigation MVP

This document defines the implementation-ready engineering spec for BrowserReplay Phase 1.

The Phase 1 MVP delivers a CLI-driven browser agent that:
- Observes web pages using ARIA snapshot + screenshot + page metadata
- Executes a compact, validated browser tool set
- Runs under an explicit state machine with bounded retries
- Supports human approval checkpoints for sensitive actions
- Produces structured logs, screenshots, and trace artifacts for debugging and auditability

## 1. Objective

Build a reliable browser agent MVP that can complete bounded web-navigation tasks with:
- deterministic execution flow
- clear failure modes
- auditable runtime artifacts
- safe handling of sensitive actions

The agent must prioritize resilient, accessibility-aligned page understanding and user-facing locator strategies over broad DOM scraping or brittle positional selectors.

## 2. Scope

### In scope
- Single-user CLI execution
- One active browser context per run
- Accessibility-first observation
- Tool-driven browser actions
- Explicit execution state machine
- Recovery and retry logic
- Human-in-the-loop approval
- Structured logging and debug artifacts
- Validation scenarios and sign-off criteria

### Out of scope
- Multi-tab parallel planning
- Long-running background autonomy
- Persistent learning or memory between runs
- Prompt self-modification
- General-purpose DOM serialization as the primary page abstraction

## 3. Architecture

The runtime is composed of the following components:

1. `BrowserController`
2. `ObservationBuilder`
3. `AgentClient`
4. `ToolDispatcher`
5. `ExecutionEngine`
6. `RunLogger`

### 3.1 BrowserController

Responsible for:
- Launching and closing Playwright browser/context/page
- Applying timeouts and browser-level configuration
- Exposing locator resolution helpers
- Performing deterministic cleanup on finish, abort, or failure

### 3.2 ObservationBuilder

Responsible for:
- Collecting ARIA snapshot
- Capturing screenshot path
- Capturing current URL and title
- Extracting focused element
- Collecting small targeted metadata
- Producing a typed `Snapshot` object

### 3.3 AgentClient

Responsible for:
- Initializing the LLM client
- Preparing prompt payloads
- Enforcing tool-driven behavior
- Parsing model output into structured action requests

### 3.4 ToolDispatcher

Responsible for:
- Validating tool inputs
- Resolving targets into Playwright locators
- Executing actions
- Normalizing success/failure results
- Returning `ToolResult` objects

### 3.5 ExecutionEngine

Responsible for:
- Driving the state machine
- Coordinating observe/decide/act/recover/approve transitions
- Enforcing runtime budgets
- Tracking progress and termination conditions

### 3.6 RunLogger

Responsible for:
- Writing structured logs
- Storing screenshots
- Storing trace artifacts
- Writing final result and evidence payloads
- Recording approval decisions and failure diagnostics

## 4. Runtime Configuration

Default runtime configuration:

```ts
{
  maxSteps: 25,
  stepTimeoutMs: 15000,
  navigationTimeoutMs: 30000,
  maxRetriesPerAction: 2,
  maxRecoveryAttempts: 3,
  traceMode: "failures",
  approvalMode: "sensitive-only"
}
```

### Required config fields
- `maxSteps`
- `stepTimeoutMs`
- `navigationTimeoutMs`
- `maxRetriesPerAction`
- `maxRecoveryAttempts`
- `traceMode`
- `approvalMode`

### Config rules
- `maxSteps` must be greater than 0
- Timeouts must be positive integers
- Retry counts must be non-negative integers
- Invalid config must fail fast at startup

## 5. Observation Contract

Observation is accessibility-first.

Each observation tick must produce a Snapshot with these fields:

- `step`
- `url`
- `title`
- `ariaYaml`
- `screenshotPath`
- `focusedElement`
- `metadata`
- `observedAt`

### 5.1 Primary observation data

- ARIA snapshot, as the primary structured page state
- Screenshot path for human review and debugging
- Current page URL
- Current page title

### 5.2 Targeted metadata

Metadata must remain compact and useful for action selection.

Include:

- Interactive element counts
- Visible forms summary
- Whether a modal/dialog is open
- Loading indicator presence
- Focused element summary
- Page-level hints such as "search results page" or "checkout page" when cheaply detectable

### 5.3 Fallback element strategy

Numeric element IDs may be maintained as a fallback mechanism for ambiguous interactions, but they must not be the primary page abstraction.

6. Tool Contracts
The agent may only act through the approved tool set.

#### 6.1 Tool list

- `navigate`
- `click`
- `typeText`
- `scroll`
- `pressKey`
- `requestHumanApproval`
- `finish`

#### 6.2 Tool input/output rules

- All tool inputs must be schema-validated before execution
- All tool outputs must be normalized
- Dispatcher must never throw raw framework errors into the agent loop
- Dispatcher must return structured `ToolResult`

#### 6.3 Tool definitions

**navigate**

_Input:_

```ts
{ url: string }
```

_Behavior:_

- Validate URL shape
- Navigate page
- Apply readiness checks
- Return resulting state hints and evidence if relevant

**click**

_Input:_

```ts
{ target: TargetHint }
```

_Behavior:_

- Resolve locator from TargetHint
- Require exactly one visible actionable match
- Click target
- Apply post-click readiness checks

**typeText**

_Input:_

```ts
{ target: TargetHint, text: string, submit?: boolean }
```

_Behavior:_

- Resolve target
- Verify field is editable
- Fill or type text
- Verify value reflection
- If submit is true, trigger submit path and verify side effects

**scroll**

_Input:_

```ts
{ direction: "up" | "down", amount?: number }
```

_Behavior:_

- Scroll page
- Verify viewport or content position changed

**pressKey**

_Input:_

```ts
{ key: string }
```

_Behavior:_

- Dispatch keyboard action
- Verify expected effect where possible

**requestHumanApproval**

_Input:_

```ts
{ reason: string, actionSummary: string }
```

_Behavior:_

- Transition execution into approve state
- Persist approval checkpoint
- Wait for user decision

**finish**

_Input:_

```ts
{ result: string, evidence: CompletionEvidence[] }
```

_Behavior:_

- Validate evidence is present
- Mark run as finished
- Persist final result

7. Locator Resolution Policy
Target resolution must prefer resilient, user-facing selectors.

#### 7.1 Resolver order

Resolve targets in this order:

1. role + name
2. label
3. placeholder
4. text
5. testId
6. chained or filtered locator
7. css
8. fallbackNumericId

#### 7.2 Matching rules

- Target must resolve to exactly one visible actionable element
- If zero matches, return `TARGET_NOT_FOUND`
- If multiple matches, return `AMBIGUOUS_TARGET`
- Dispatcher must not guess between multiple matches
- XPath is not allowed in Phase 1

#### 7.3 TargetHint contract

TargetHint may include:

- `role`
- `name`
- `label`
- `placeholder`
- `text`
- `testId`
- `css`
- `fallbackNumericId`

8. Execution State Machine
Execution must run as an explicit state machine.

#### 8.1 States

**Active states:**

- `observe`
- `decide`
- `act`
- `approve`
- `recover`

**Terminal states:**

- `finished`
- `failed`
- `aborted`
- `max_steps_exceeded`

#### 8.2 State transition model

**Primary path:**

```
observe -> decide -> act -> observe
```

**Side paths:**

```
act -> approve -> observe
act -> recover -> observe
act -> recover -> failed
decide -> finished
approve -> aborted
observe -> max_steps_exceeded
```

#### #### 8.3 State semantics

**observe**
- Capture fresh snapshot
- Persist artifacts
- Append compact history entry
- Increment step counter

**decide**
- Send goal, stable run context, compact recent history, and fresh snapshot to the model
- Require model to return either one tool call or finish

**act**
- Validate tool input
- Execute tool
- Capture normalized result
- Determine next state

**approve**
- Display approval payload in CLI
- Wait for user response
- On approve, return result to loop
- On deny, transition to aborted

**recover**
- Re-observe current state
- Attempt bounded retry or re-resolution
- Fail gracefully if recovery budget is exhausted

## 9. Prompt Composition

Prompt payload should be assembled in this order:

1. Stable system instructions
2. Run goal
3. Runtime constraints and budgets
4. Compact recent action history
5. Fresh browser state and snapshot

### Prompt rules

- Keep action history compact
- Prefer short structured summaries over verbose transcripts
- Include only fresh browser state needed for the next action
- Maintain consistent tool schema across the run

## 10. Readiness and Post-Action Verification
Do not use generic networkidle as the default readiness strategy.

#### 10.1 After navigate

Wait for:
- URL change or document readiness
- And expected element presence when known

#### 10.2 After click

Wait for one of:
- DOM mutation
- URL transition
- Modal open/close state change
- Enabled/disabled state change
- Visible confirmation element

#### 10.3 After typeText

Verify:
- Field value reflects input text
- And submit side effects when submit is true

#### 10.4 After scroll

Verify:
- Viewport position changed
- Or content offset changed

11. Recovery Policy
Recovery must be targeted and bounded.

#### 11.1 Retryable failures

Retryable categories:
- Timeout
- Detached/stale element
- Temporary overlay interception
- Navigation race
- Transient loading issues

#### 11.2 Recovery strategy

- Re-observe current page
- Refresh locator resolution
- Retry with capped exponential backoff
- Stop when retry budget is exhausted

#### 11.3 No-progress detection

The engine must detect no-progress loops by comparing recent:
- Actions
- URLs
- Snapshot summaries
- Repeated error codes

If no material change occurs across the configured threshold, terminate with NO_PROGRESS.

12. Human-in-the-Loop Policy
Sensitive actions must require explicit user approval.

#### 12.1 Sensitive actions

Examples include:
- Submitting forms
- Purchases
- Deletes
- Sends
- Account mutations
- Anything flagged by task policy as high-impact

#### 12.2 Approval payload

The CLI approval view must display:
- Reason
- ActionSummary
- Current URL
- Current title
- Latest screenshot path

#### 12.3 Approval outcomes

- Y: continue execution
- N: abort safely and persist reason

All approval checkpoints must be logged as structured events.

13. Evidence and Completion Rules
The run may only finish when evidence is present.

#### 13.1 Evidence requirements

**Navigation tasks:**
- Final URL
- And visible confirmation text or screenshot

**Form submission tasks:**
- Confirmation text, success URL pattern, or extracted confirmation value

**Search/select tasks:**
- Final selected value
- And screenshot or visible text proof

#### 13.2 Invalid completion

Finish() is invalid when:

- Evidence array is empty
- Result is blank
- Evidence does not support the claimed completion state

## 14. Artifacts

Each run must produce artifacts under a per-run directory.

- `run.json`
- `steps.ndjson`
- `final.json`
- `screenshots/`

### Optional/conditional artifacts

- `trace.zip` when trace mode is failures and the run fails
- `trace.zip` for every run when trace mode is all

### Artifact descriptions

- `run.json`: run config, counters, timestamps, terminal state
- `steps.ndjson`: one structured event per transition and tool execution
- `final.json`: final result, evidence, diagnostics
- `screenshots/`: per-step screenshots
- `trace.zip`: Playwright trace artifact

## 15. Logging

All runtime logging must be structured.

Each step event should include:

- `runId`
- `step`
- `state`
- `actionName`
- `status`
- `errorCode`
- `url`
- `timestamp`

Logs should be machine-readable first and human-readable second.

## 16. Validation Scenarios

The following scenarios are required for handoff validation.

**Scenario A**
Simple navigation and click on a uniquely identified control.

**Scenario B**
Multi-step search, filter, and select flow.

**Scenario C**
Sensitive action requiring approval, with both approve and abort paths tested.

**Scenario D**
Ambiguous target that requires fallback resolution.

**Scenario E**
Timeout or stale-element path with recover-or-fail-gracefully behavior.

## 17. Acceptance Criteria

Phase 1 is complete when all of the following are true:

- All validation scenarios pass
- Failed runs produce actionable diagnostics
- Terminal status is always machine-readable
- No orphaned browser processes remain
- Browser context/page cleanup is deterministic
- Approval decisions are logged
- Trace artifacts are available according to configured trace mode

## 18. Build Order

Implementation order:

1. BrowserController
2. ObservationBuilder
3. Locator resolution and ToolDispatcher
4. ExecutionEngine
5. HITL integration
6. Artifact and trace support
7. CLI polish
8. Validation scenarios and sign-off

## 19. Deliverables

Phase 1 deliverables:

- Working CLI entry point
- Typed runtime contracts
- State-machine execution engine
- Browser automation wrapper
- Observation builder
- Normalized tool dispatcher
- Approval flow
- Structured logs and artifacts
- Validation scenarios
- Sign-off checklist

## types.ts

```ts
export type RunStatus =
  | "running"
  | "finished"
  | "failed"
  | "aborted"
  | "max_steps_exceeded";

export type ExecutionState =
  | "observe"
  | "decide"
  | "act"
  | "approve"
  | "recover"
  | "finished"
  | "failed"
  | "aborted"
  | "max_steps_exceeded";

export type TraceMode = "off" | "failures" | "all";
export type ApprovalMode = "never" | "sensitive-only" | "always";

export interface RuntimeConfig {
  maxSteps: number;
  stepTimeoutMs: number;
  navigationTimeoutMs: number;
  maxRetriesPerAction: number;
  maxRecoveryAttempts: number;
  traceMode: TraceMode;
  approvalMode: ApprovalMode;
}

export interface RunContext {
  runId: string;
  goal: string;
  startedAt: string;
  status: RunStatus;
  currentState: ExecutionState;
  stepCount: number;
  retryCount: number;
  recoveryCount: number;
  approvalCount: number;
  config: RuntimeConfig;
  terminalReason?: string;
}

export interface InteractiveCounts {
  links: number;
  buttons: number;
  inputs: number;
  selects: number;
  textareas: number;
  checkboxes: number;
  radios: number;
}

export interface FocusedElementSummary {
  role?: string;
  name?: string;
  tagName?: string;
  type?: string;
  editable?: boolean;
}

export interface VisibleFormSummary {
  id?: string;
  name?: string;
  fields: number;
  submitButtons: number;
}

export interface SnapshotMetadata {
  interactiveCounts: InteractiveCounts;
  visibleForms: VisibleFormSummary[];
  dialogOpen: boolean;
  loadingIndicators: string[];
  pageHints: string[];
}

export interface Snapshot {
  step: number;
  url: string;
  title: string;
  ariaYaml: string;
  screenshotPath: string;
  focusedElement?: FocusedElementSummary;
  metadata: SnapshotMetadata;
  observedAt: string;
}

export interface StateHint {
  kind:
    | "url_changed"
    | "dom_changed"
    | "modal_changed"
    | "value_reflected"
    | "no_progress"
    | "awaiting_approval"
    | "completed"
    | "retryable_error";
  value?: string | number | boolean;
}

export type ErrorCode =
  | "INVALID_INPUT"
  | "INVALID_URL"
  | "TARGET_NOT_FOUND"
  | "AMBIGUOUS_TARGET"
  | "TARGET_NOT_ACTIONABLE"
  | "TIMEOUT"
  | "NAVIGATION_FAILED"
  | "STALE_ELEMENT"
  | "OVERLAY_INTERCEPT"
  | "NO_PROGRESS"
  | "APPROVAL_REQUIRED"
  | "APPROVAL_DENIED"
  | "UNEXPECTED_ERROR";

export type EvidenceKind =
  | "url"
  | "visible_text"
  | "screenshot"
  | "extracted_value"
  | "confirmation_banner"
  | "modal_state";

export interface CompletionEvidence {
  kind: EvidenceKind;
  description: string;
  url?: string;
  visibleText?: string;
  screenshotPath?: string;
  extractedValue?: string;
}

export interface ToolResult {
  success: boolean;
  errorCode?: ErrorCode;
  message: string;
  stateHints: StateHint[];
  evidence?: CompletionEvidence[];
  artifactPaths?: string[];
}

export interface TargetHint {
  role?: string;
  name?: string;
  label?: string;
  placeholder?: string;
  text?: string;
  testId?: string;
  css?: string;
  fallbackNumericId?: number;
}

export interface NavigateInput {
  url: string;
}

export interface ClickInput {
  target: TargetHint;
}

export interface TypeTextInput {
  target: TargetHint;
  text: string;
  submit?: boolean;
}

export interface ScrollInput {
  direction: "up" | "down";
  amount?: number;
}

export interface PressKeyInput {
  key: string;
}

export interface RequestHumanApprovalInput {
  reason: string;
  actionSummary: string;
}

export interface FinishInput {
  result: string;
  evidence: CompletionEvidence[];
}

export type ToolName =
  | "navigate"
  | "click"
  | "typeText"
  | "scroll"
  | "pressKey"
  | "requestHumanApproval"
  | "finish";

export type ToolInputMap = {
  navigate: NavigateInput;
  click: ClickInput;
  typeText: TypeTextInput;
  scroll: ScrollInput;
  pressKey: PressKeyInput;
  requestHumanApproval: RequestHumanApprovalInput;
  finish: FinishInput;
};

export interface ToolCall<TName extends ToolName = ToolName> {
  name: TName;
  input: ToolInputMap[TName];
}

export interface AgentDecision<TName extends ToolName = ToolName> {
  thoughtSummary?: string;
  toolCall?: ToolCall<TName>;
  finish?: FinishInput;
}

export interface ApprovalCheckpoint {
  step: number;
  reason: string;
  actionSummary: string;
  url: string;
  title: string;
  screenshotPath: string;
  requestedAt: string;
  approved?: boolean;
  decidedAt?: string;
}

export interface StepEvent {
  runId: string;
  step: number;
  state: ExecutionState;
  actionName?: ToolName;
  status: "started" | "succeeded" | "failed" | "waiting" | "completed";
  errorCode?: ErrorCode;
  url?: string;
  timestamp: string;
  message?: string;
}

export interface FinalRunResult {
  runId: string;
  status: RunStatus;
  result?: string;
  evidence: CompletionEvidence[];
  terminalReason?: string;
  finishedAt: string;
}

export interface BrowserController {
  init(): Promise<void>;
  close(): Promise<void>;
  navigate(input: NavigateInput): Promise<ToolResult>;
  click(input: ClickInput): Promise<ToolResult>;
  typeText(input: TypeTextInput): Promise<ToolResult>;
  scroll(input: ScrollInput): Promise<ToolResult>;
  pressKey(input: PressKeyInput): Promise<ToolResult>;
  captureSnapshot(step: number): Promise<Snapshot>;
}

export interface AgentClient {
  decide(params: {
    goal: string;
    runContext: RunContext;
    recentHistory: StepEvent[];
    snapshot: Snapshot;
  }): Promise<AgentDecision>;
}

export interface ToolDispatcher {
  execute<TName extends ToolName>(
    toolCall: ToolCall<TName>
  ): Promise<ToolResult>;
}

export interface RunLogger {
  logStep(event: StepEvent): Promise<void>;
  logApproval(checkpoint: ApprovalCheckpoint): Promise<void>;
  writeRunContext(context: RunContext): Promise<void>;
  writeFinalResult(result: FinalRunResult): Promise<void>;
}

export interface ExecutionEngine {
  run(goal: string): Promise<FinalRunResult>;
}

## Notes

This version is intentionally stricter than the earlier plan, especially around target resolution, completion evidence, and terminal artifacts, because those are the areas most likely to determine whether the MVP behaves reliably in practice. It also stays consistent with the current plan’s explicit states, bounded retries, approval checkpoints, and validation scenarios instead of widening scope prematurely.
