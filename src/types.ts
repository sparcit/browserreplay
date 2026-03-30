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
