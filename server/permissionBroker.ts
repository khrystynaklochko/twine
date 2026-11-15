import crypto from 'node:crypto';
import type {
  AgentRun,
  ConsentScopeId,
  OwnerWorkspaceState,
  PendingApproval,
  PlannedStep,
  StepActionType,
} from '../src/types/twin.ts';
import { twinStore } from './store.ts';

const HIGH_IMPACT_ACTIONS: Set<StepActionType> = new Set([
  'submit',
  'send_external',
  'write_external',
  'delete_external',
]);

const INJECTION_PATTERNS: RegExp[] = [
  /ignore\s+(all\s+)?(previous|prior|above)\s+instructions/i,
  /system\s*override/i,
  /exfiltrate|send\s+(all\s+)?(data|memory|tokens|credentials)\s+to/i,
  /elevate\s+privileges|grant\s+admin|bypass\s+approval/i,
  /execute\s+shell|run\s+rm\s+-rf/i,
];

export function isHighImpactAction(action: StepActionType): boolean {
  return HIGH_IMPACT_ACTIONS.has(action);
}

export function normalizeOrigin(urlOrOrigin: string, fallbackBase = 'http://localhost:3000'): string {
  const trimmed = (urlOrOrigin || '').trim();
  if (!trimmed) return '';
  if (trimmed.startsWith('/')) {
    return new URL(fallbackBase).origin;
  }
  try {
    return new URL(trimmed).origin;
  } catch {
    return trimmed.replace(/\/+$/, '');
  }
}

export function sanitizeUntrustedPageText(rawText: string): {
  safeText: string;
  injectionDetected: boolean;
  matchedSignals: string[];
} {
  const matchedSignals: string[] = [];
  for (const rx of INJECTION_PATTERNS) {
    const match = rawText.match(rx);
    if (match) {
      matchedSignals.push(match[0]);
    }
  }
  const safeText = rawText
    .replace(/```/g, "'''")
    .slice(0, 6000);

  return {
    safeText,
    injectionDetected: matchedSignals.length > 0,
    matchedSignals,
  };
}

export function checkConsent(state: OwnerWorkspaceState, scope: ConsentScopeId): { allowed: boolean; reason?: string } {
  const grant = state.consents.find((c) => c.scope === scope);
  if (!grant) {
    return { allowed: false, reason: `Unknown consent scope: ${scope}` };
  }
  if (!grant.available) {
    return { allowed: false, reason: grant.unavailableReason || `Scope ${scope} is unavailable` };
  }
  if (!grant.granted) {
    return { allowed: false, reason: `User consent scope "${grant.label}" is not granted.` };
  }
  return { allowed: true };
}

export function checkSiteGrant(
  state: OwnerWorkspaceState,
  targetUrlOrOrigin: string,
  requiredCapability: 'teach' | 'agent',
  serverOrigin = 'http://localhost:3000',
): { allowed: boolean; origin: string; reason?: string } {
  const targetOrigin = normalizeOrigin(targetUrlOrOrigin, serverOrigin);
  const matching = state.siteGrants.find((g) => {
    const grantOrigin = normalizeOrigin(g.origin, serverOrigin);
    return grantOrigin === targetOrigin;
  });

  if (!matching) {
    return {
      allowed: false,
      origin: targetOrigin,
      reason: `Origin ${targetOrigin} is not in your approved site allowlist.`,
    };
  }
  if (requiredCapability === 'teach' && !matching.teachAllowed) {
    return {
      allowed: false,
      origin: targetOrigin,
      reason: `Teach Mode permission is disabled for ${targetOrigin}.`,
    };
  }
  if (requiredCapability === 'agent' && !matching.agentAllowed) {
    return {
      allowed: false,
      origin: targetOrigin,
      reason: `Agent execution permission is disabled for ${targetOrigin}.`,
    };
  }
  return { allowed: true, origin: targetOrigin };
}

export function authorizeActionStep(
  ownerId: string,
  run: AgentRun,
  step: PlannedStep,
  targetUrl: string,
  serverOrigin: string,
): { allowed: boolean; requiresFreshApproval: boolean; reason?: string } {
  const state = twinStore.getOwner(ownerId);
  if (!state) {
    return { allowed: false, requiresFreshApproval: false, reason: 'Twin owner state not found.' };
  }

  if (run.mode === 'paused' || state.activeMode === 'paused') {
    twinStore.appendAudit(ownerId, 'policy_check', 'denied', `Run ${run.id} blocked because mode is paused.`);
    return { allowed: false, requiresFreshApproval: false, reason: 'Execution paused by user.' };
  }

  if (run.mode === 'twin') {
    twinStore.appendAudit(ownerId, 'policy_check', 'denied', `Action step ${step.id} blocked in twin-only mode.`);
    return { allowed: false, requiresFreshApproval: false, reason: 'Twin-only mode cannot execute browser actions.' };
  }

  if (run.mode === 'supervised_agent') {
    const consentCheck = checkConsent(state, 'browser_execution');
    if (!consentCheck.allowed) {
      twinStore.appendAudit(ownerId, 'policy_check', 'denied', consentCheck.reason || 'Browser consent missing');
      return { allowed: false, requiresFreshApproval: false, reason: consentCheck.reason };
    }
  }

  const siteCheck = checkSiteGrant(state, targetUrl, 'agent', serverOrigin);
  if (!siteCheck.allowed) {
    twinStore.appendAudit(ownerId, 'policy_check', 'denied', siteCheck.reason || 'Site grant missing');
    return { allowed: false, requiresFreshApproval: false, reason: siteCheck.reason };
  }

  if (step.requiresApproval || isHighImpactAction(step.action)) {
    return {
      allowed: true,
      requiresFreshApproval: true,
      reason: `High-impact action "${step.action}" requires fresh user approval before proceeding.`,
    };
  }

  return { allowed: true, requiresFreshApproval: false };
}

export function issuePendingApproval(run: AgentRun, step: PlannedStep, targetOrigin: string): PendingApproval {
  return {
    token: `appr_${crypto.randomBytes(16).toString('hex')}`,
    runId: run.id,
    stepId: step.id,
    action: step.action,
    reason: `Approve high-impact action "${step.action}": ${step.description}`,
    targetOrigin,
    expiresAt: new Date(Date.now() + 120_000).toISOString(),
    used: false,
  };
}

export function verifyAndConsumeApprovalToken(
  ownerId: string,
  run: AgentRun,
  submittedToken: string | undefined,
): { valid: boolean; reason?: string } {
  const pending = run.pendingApproval;
  if (!pending) {
    twinStore.appendAudit(ownerId, 'approval_rejected', 'denied', `Run ${run.id} has no pending approval.`);
    return { valid: false, reason: 'No pending approval exists for this run.' };
  }
  if (!submittedToken || typeof submittedToken !== 'string') {
    twinStore.appendAudit(ownerId, 'approval_rejected', 'denied', `Missing approval token for run ${run.id}.`);
    return { valid: false, reason: 'Approval token is required.' };
  }
  if (pending.used) {
    twinStore.appendAudit(ownerId, 'approval_rejected', 'denied', `Attempted reuse of spent approval token on run ${run.id}.`);
    return { valid: false, reason: 'Approval token has already been used.' };
  }
  if (new Date(pending.expiresAt).getTime() < Date.now()) {
    twinStore.appendAudit(ownerId, 'approval_rejected', 'denied', `Expired approval token rejected on run ${run.id}.`);
    return { valid: false, reason: 'Approval token has expired. Request a fresh approval.' };
  }
  if (pending.token !== submittedToken || pending.runId !== run.id) {
    twinStore.appendAudit(ownerId, 'approval_rejected', 'denied', `Forged or mismatched approval token rejected on run ${run.id}.`);
    return { valid: false, reason: 'Invalid or mismatched approval token.' };
  }

  pending.used = true;
  twinStore.appendAudit(ownerId, 'approval_granted', 'allowed', `Verified single-use approval token for step ${pending.stepId} (${pending.action}).`);
  return { valid: true };
}
