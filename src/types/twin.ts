export type RunMode = 'twin' | 'shadow' | 'supervised_agent' | 'paused';

export type RunStatus =
  | 'pending'
  | 'awaiting_approval'
  | 'running'
  | 'paused'
  | 'failed'
  | 'cancelled'
  | 'verified';

export type UIStateTag =
  | 'live'
  | 'pending'
  | 'error'
  | 'permission_required'
  | 'demo'
  | 'disabled';

export type TicketStatus =
  | 'NOT_STARTED'
  | 'IN_PROGRESS'
  | 'PARTIAL'
  | 'BLOCKED'
  | 'IMPLEMENTED'
  | 'VERIFIED';

export type ConsentScopeId =
  | 'memory_persistence'
  | 'teach_observation'
  | 'browser_execution'
  | 'desktop_companion'
  | 'workspace_read'
  | 'workspace_write';

export interface ConsentGrant {
  scope: ConsentScopeId;
  label: string;
  description: string;
  granted: boolean;
  available: boolean;
  unavailableReason?: string;
  updatedAt: string;
}

export interface SiteGrant {
  origin: string;
  label: string;
  teachAllowed: boolean;
  agentAllowed: boolean;
  grantedAt: string;
}

export interface ProfileRevision {
  version: number;
  changedFields: string[];
  actor: 'user_onboarding' | 'user_edit' | 'skill_correction' | 'system_init';
  note: string;
  timestamp: string;
}

export interface TwinProfile {
  ownerId: string;
  accountType: 'guest' | 'google';
  email?: string;
  displayName: string;
  headline: string;
  timezone: string;
  primaryGoal: string;
  workingConstraints: string[];
  preferences: Record<string, string>;
  version: number;
  established: boolean;
  createdAt: string;
  updatedAt: string;
  history: ProfileRevision[];
}

export interface MemoryEntry {
  id: string;
  ownerId: string;
  category: 'episodic' | 'semantic';
  title: string;
  content: string;
  source: string;
  confidence: number;
  ttlDays: number;
  expiresAt: string;
  createdAt: string;
  updatedAt: string;
  rejected: boolean;
}

export interface RedactedAction {
  id: string;
  index: number;
  type: 'navigate' | 'click' | 'input' | 'select' | 'scroll' | 'extract';
  targetSelector: string;
  accessibleLabel: string;
  url: string;
  valuePreview?: string;
  redacted: boolean;
  redactionReason?: string;
  timestamp: string;
}

export interface ActionTrace {
  id: string;
  ownerId: string;
  sessionId: string;
  site: string;
  title: string;
  status: 'recording' | 'paused' | 'ready_for_review' | 'approved' | 'discarded';
  privacyLabel: 'redacted_safe' | 'contains_user_input' | 'private_mode_blocked';
  recordedAt: string;
  expiresAt: string;
  screenshotConsent: boolean;
  events: RedactedAction[];
  approved: boolean;
}

export type StepActionType =
  | 'navigate'
  | 'fill'
  | 'click'
  | 'select'
  | 'extract_text'
  | 'submit'
  | 'send_external'
  | 'write_external'
  | 'delete_external';

export type StepRiskLevel = 'low' | 'medium' | 'high_impact';

export interface PlannedStep {
  id: string;
  order: number;
  action: StepActionType;
  targetSelector: string;
  fallbackText?: string;
  description: string;
  inputKey?: string;
  staticValue?: string;
  expectedOutcome: string;
  risk: StepRiskLevel;
  requiresApproval: boolean;
}

export interface SkillCorrectionProposal {
  id: string;
  skillId: string;
  fromVersion: number;
  toVersion: number;
  reason: string;
  beforeStep: PlannedStep;
  afterStep: PlannedStep;
  status: 'pending' | 'accepted' | 'rejected';
  createdAt: string;
  resolvedAt?: string;
}

export interface LearnedSkill {
  id: string;
  ownerId: string;
  version: number;
  name: string;
  intent: string;
  summary: string;
  preconditions: string[];
  inputs: Record<string, string>;
  allowedOrigins: string[];
  steps: PlannedStep[];
  expectedOutcomes: string[];
  uncertaintyFlags: string[];
  sourceTraceIds: string[];
  verifiedRunsCount: number;
  lastRunAt?: string;
  createdAt: string;
  updatedAt: string;
  corrections: SkillCorrectionProposal[];
}

export interface StepResult {
  stepId: string;
  order: number;
  action: StepActionType;
  description: string;
  targetUsed: string;
  adaptedFromSelector?: string;
  status: 'pending' | 'running' | 'awaiting_approval' | 'completed' | 'failed' | 'skipped' | 'blocked';
  observation: string;
  extractedData?: unknown;
  screenshotDataUrl?: string;
  error?: string;
  startedAt: string;
  finishedAt?: string;
}

export interface VerifiedOutcome {
  verdict: 'confirmed' | 'uncertain' | 'failed';
  expected: string;
  observed: string;
  evidenceSummary: string;
  extractedRows?: Array<Record<string, string>>;
  checkedAt: string;
}

export interface PendingApproval {
  token: string;
  runId: string;
  stepId: string;
  action: StepActionType;
  reason: string;
  targetOrigin: string;
  expiresAt: string;
  used: boolean;
}

export interface AgentRun {
  id: string;
  ownerId: string;
  mode: RunMode;
  skillId?: string;
  skillVersion?: number;
  goal: string;
  targetOrigin: string;
  inputValues: Record<string, string>;
  status: RunStatus;
  idempotencyKey: string;
  approvedCapabilities: string[];
  plannedSteps: PlannedStep[];
  steps: StepResult[];
  pendingApproval?: PendingApproval;
  outcome?: VerifiedOutcome;
  budget: {
    maxSteps: number;
    maxDurationMs: number;
    tokensUsed: number;
    maxTokens: number;
  };
  error?: string;
  createdAt: string;
  updatedAt: string;
}

export interface AuditLogEntry {
  id: string;
  ownerId: string;
  eventType:
    | 'auth'
    | 'consent_change'
    | 'memory_write'
    | 'memory_delete'
    | 'trace_capture'
    | 'trace_delete'
    | 'skill_approve'
    | 'policy_check'
    | 'approval_granted'
    | 'approval_rejected'
    | 'run_execute'
    | 'run_abort'
    | 'data_export'
    | 'account_delete';
  decision: 'allowed' | 'denied' | 'info';
  detail: string;
  timestamp: string;
}

export interface MacCompanionPairing {
  paired: boolean;
  deviceName?: string;
  companionUrl?: string;
  capabilityToken?: string;
  expiresAt?: string;
  allowlistedApps: string[];
  lastHeartbeatAt?: string;
  statusNote: string;
}

export interface OwnerWorkspaceState {
  profile: TwinProfile;
  consents: ConsentGrant[];
  siteGrants: SiteGrant[];
  memories: MemoryEntry[];
  traces: ActionTrace[];
  skills: LearnedSkill[];
  runs: AgentRun[];
  auditLogs: AuditLogEntry[];
  macCompanion: MacCompanionPairing;
  activeMode: RunMode;
  retentionDays: number;
}

export interface TicketRecord {
  id: string;
  group: string;
  title: string;
  status: TicketStatus;
  evidence: string;
  lastCheckedAt: string;
}
