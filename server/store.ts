import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import type {
  ActionTrace,
  AgentRun,
  AuditLogEntry,
  ConsentGrant,
  ConsentScopeId,
  LearnedSkill,
  MemoryEntry,
  OwnerWorkspaceState,
  RedactedAction,
  RunMode,
  SiteGrant,
  TwinProfile,
} from '../src/types/twin.ts';

const DATA_DIR = path.resolve(process.cwd(), 'data');
const STORE_PATH = path.join(DATA_DIR, 'twinme-store.json');

interface StoreDatabase {
  owners: Record<string, OwnerWorkspaceState>;
  idempotency: Record<string, { runId: string; ownerId: string; createdAt: string }>;
}

const SENSITIVE_KEY_PATTERN = /password|passwd|secret|token|api[-_]?key|card|cvv|cvc|ssn|pin|auth/i;
const SENSITIVE_VALUE_PATTERN = /(sk-[a-zA-Z0-9]{16,}|AIza[0-9A-Za-z\-_]{20,}|Bearer\s+[A-Za-z0-9\-._~+/]+=*|\b\d{13,19}\b)/g;

export function redactSensitiveText(input: string, fieldHint = ''): { value: string; redacted: boolean; reason?: string } {
  if (!input) return { value: '', redacted: false };
  if (SENSITIVE_KEY_PATTERN.test(fieldHint)) {
    return { value: '[REDACTED_SENSITIVE_FIELD]', redacted: true, reason: `Field hint matched sensitive pattern (${fieldHint})` };
  }
  if (SENSITIVE_VALUE_PATTERN.test(input)) {
    const cleaned = input.replace(SENSITIVE_VALUE_PATTERN, '[REDACTED_CREDENTIAL]');
    return { value: cleaned, redacted: true, reason: 'Credential or card-like pattern detected and redacted' };
  }
  return { value: input, redacted: false };
}

export function sanitizeActionEvent(raw: Partial<RedactedAction>, index: number, isPrivateMode = false): RedactedAction | null {
  if (isPrivateMode) {
    return null;
  }
  const selector = String(raw.targetSelector ?? '').slice(0, 240);
  const label = String(raw.accessibleLabel ?? '').slice(0, 200);
  const url = String(raw.url ?? '').slice(0, 500);
  const hint = `${selector} ${label} ${raw.type ?? ''}`;
  const rawVal = String(raw.valuePreview ?? '');
  const { value, redacted, reason } = redactSensitiveText(rawVal, hint);

  return {
    id: raw.id || `evt_${crypto.randomBytes(5).toString('hex')}`,
    index,
    type: raw.type || 'click',
    targetSelector: selector,
    accessibleLabel: label,
    url,
    valuePreview: value,
    redacted: Boolean(raw.redacted || redacted),
    redactionReason: raw.redactionReason || reason,
    timestamp: raw.timestamp || new Date().toISOString(),
  };
}

function createDefaultConsents(now: string): ConsentGrant[] {
  return [
    {
      scope: 'memory_persistence',
      label: 'Personal Twin Memory',
      description: 'Persist your individual profile, preferences, goals, and episodic notes under your control.',
      granted: false,
      available: true,
      updatedAt: now,
    },
    {
      scope: 'teach_observation',
      label: 'Teach Mode Observation',
      description: 'Capture redacted clicks, labels, and navigation ONLY while Teach Mode is explicitly active on an approved site.',
      granted: false,
      available: true,
      updatedAt: now,
    },
    {
      scope: 'browser_execution',
      label: 'Supervised Browser Agent',
      description: 'Allow Playwright browser execution on explicitly allowlisted origins with per-action risk gating.',
      granted: false,
      available: true,
      updatedAt: now,
    },
    {
      scope: 'desktop_companion',
      label: 'macOS Companion Bridge',
      description: 'Connect a locally paired macOS Accessibility companion with expiring capability tokens.',
      granted: false,
      available: false,
      unavailableReason: 'Requires local macOS companion pairing and real-Mac Accessibility acceptance.',
      updatedAt: now,
    },
    {
      scope: 'workspace_read',
      label: 'Google Workspace (Read)',
      description: 'Read user-selected Google Drive files or Calendar events.',
      granted: false,
      available: false,
      unavailableReason: 'Google Workspace OAuth was not enabled by user.',
      updatedAt: now,
    },
    {
      scope: 'workspace_write',
      label: 'Google Workspace (Draft / Propose)',
      description: 'Create Gmail drafts or propose Calendar events with explicit approval.',
      granted: false,
      available: false,
      unavailableReason: 'Google Workspace OAuth was not enabled by user.',
      updatedAt: now,
    },
  ];
}

function createEmptyOwnerState(ownerId: string, accountType: 'guest' | 'google' = 'guest', email?: string): OwnerWorkspaceState {
  const now = new Date().toISOString();
  const profile: TwinProfile = {
    ownerId,
    accountType,
    email,
    displayName: '',
    headline: '',
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
    primaryGoal: '',
    workingConstraints: [],
    preferences: {},
    version: 1,
    established: false,
    createdAt: now,
    updatedAt: now,
    history: [
      {
        version: 1,
        changedFields: ['initialized'],
        actor: 'system_init',
        note: 'Clean individual twin initialized with zero fabricated memories or runs.',
        timestamp: now,
      },
    ],
  };

  return {
    profile,
    consents: createDefaultConsents(now),
    siteGrants: [],
    memories: [],
    traces: [],
    skills: [],
    runs: [],
    auditLogs: [
      {
        id: `aud_${crypto.randomBytes(5).toString('hex')}`,
        ownerId,
        eventType: 'auth',
        decision: 'info',
        detail: `Initialized personal twin workspace (${accountType}) with empty state.`,
        timestamp: now,
      },
    ],
    macCompanion: {
      paired: false,
      allowlistedApps: ['Notes', 'TextEdit'],
      statusNote: 'Not paired. Download and start the local macOS companion on a real Mac to pair.',
    },
    activeMode: 'twin',
    retentionDays: 30,
  };
}

class TwinStore {
  private db: StoreDatabase;

  constructor() {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    if (fs.existsSync(STORE_PATH)) {
      try {
        const raw = fs.readFileSync(STORE_PATH, 'utf-8');
        this.db = JSON.parse(raw) as StoreDatabase;
      } catch {
        this.db = { owners: {}, idempotency: {} };
      }
    } else {
      this.db = { owners: {}, idempotency: {} };
      this.persist();
    }
  }

  private persist() {
    const tmpPath = `${STORE_PATH}.tmp`;
    fs.writeFileSync(tmpPath, JSON.stringify(this.db, null, 2), 'utf-8');
    fs.renameSync(tmpPath, STORE_PATH);
  }

  private pruneExpired(state: OwnerWorkspaceState) {
    const nowMs = Date.now();
    state.memories = state.memories.filter((m) => new Date(m.expiresAt).getTime() > nowMs);
    state.traces = state.traces.filter((t) => new Date(t.expiresAt).getTime() > nowMs);
  }

  public getOrCreateOwner(ownerId: string, accountType: 'guest' | 'google' = 'guest', email?: string): OwnerWorkspaceState {
    if (!this.db.owners[ownerId]) {
      this.db.owners[ownerId] = createEmptyOwnerState(ownerId, accountType, email);
      this.persist();
    }
    const state = this.db.owners[ownerId];
    this.pruneExpired(state);
    return state;
  }

  public getOwner(ownerId: string): OwnerWorkspaceState | null {
    const state = this.db.owners[ownerId] || null;
    if (state) this.pruneExpired(state);
    return state;
  }

  public appendAudit(ownerId: string, eventType: AuditLogEntry['eventType'], decision: AuditLogEntry['decision'], detail: string) {
    const state = this.getOrCreateOwner(ownerId);
    state.auditLogs.unshift({
      id: `aud_${crypto.randomBytes(5).toString('hex')}`,
      ownerId,
      eventType,
      decision,
      detail,
      timestamp: new Date().toISOString(),
    });
    if (state.auditLogs.length > 250) {
      state.auditLogs = state.auditLogs.slice(0, 250);
    }
    this.persist();
  }

  public updateProfile(
    ownerId: string,
    patch: Partial<Pick<TwinProfile, 'displayName' | 'headline' | 'timezone' | 'primaryGoal' | 'workingConstraints' | 'preferences' | 'established'>>,
    actor: 'user_onboarding' | 'user_edit' | 'skill_correction',
    note: string,
  ): TwinProfile {
    const state = this.getOrCreateOwner(ownerId);
    const now = new Date().toISOString();
    const changedFields = Object.keys(patch);
    const nextVersion = state.profile.version + 1;
    state.profile = {
      ...state.profile,
      ...patch,
      version: nextVersion,
      updatedAt: now,
      history: [
        {
          version: nextVersion,
          changedFields,
          actor,
          note,
          timestamp: now,
        },
        ...state.profile.history,
      ].slice(0, 50),
    };
    this.persist();
    this.appendAudit(ownerId, 'memory_write', 'allowed', `Profile updated to v${nextVersion} (${changedFields.join(', ')})`);
    return state.profile;
  }

  public setConsent(ownerId: string, scope: ConsentScopeId, granted: boolean): ConsentGrant[] {
    const state = this.getOrCreateOwner(ownerId);
    const now = new Date().toISOString();
    state.consents = state.consents.map((c) => {
      if (c.scope !== scope) return c;
      if (!c.available && granted) {
        this.appendAudit(ownerId, 'consent_change', 'denied', `Cannot grant unavailable scope ${scope}: ${c.unavailableReason}`);
        return c;
      }
      return { ...c, granted, updatedAt: now };
    });
    this.persist();
    this.appendAudit(ownerId, 'consent_change', 'info', `Consent scope ${scope} set to ${granted}`);
    return state.consents;
  }

  public upsertSiteGrant(ownerId: string, origin: string, label: string, teachAllowed: boolean, agentAllowed: boolean): SiteGrant[] {
    const state = this.getOrCreateOwner(ownerId);
    const normalized = origin.trim().replace(/\/+$/, '');
    const now = new Date().toISOString();
    const idx = state.siteGrants.findIndex((g) => g.origin === normalized);
    if (idx >= 0) {
      state.siteGrants[idx] = { ...state.siteGrants[idx], label, teachAllowed, agentAllowed, grantedAt: now };
    } else {
      state.siteGrants.push({ origin: normalized, label, teachAllowed, agentAllowed, grantedAt: now });
    }
    this.persist();
    this.appendAudit(ownerId, 'consent_change', 'allowed', `Site grant updated for ${normalized} (teach=${teachAllowed}, agent=${agentAllowed})`);
    return state.siteGrants;
  }

  public revokeSiteGrant(ownerId: string, origin: string): SiteGrant[] {
    const state = this.getOrCreateOwner(ownerId);
    const normalized = origin.trim().replace(/\/+$/, '');
    state.siteGrants = state.siteGrants.filter((g) => g.origin !== normalized);
    this.persist();
    this.appendAudit(ownerId, 'consent_change', 'info', `Revoked site grant for ${normalized}`);
    return state.siteGrants;
  }

  public setMode(ownerId: string, mode: RunMode): RunMode {
    const state = this.getOrCreateOwner(ownerId);
    state.activeMode = mode;
    this.persist();
    this.appendAudit(ownerId, 'policy_check', 'info', `Workspace run mode switched to ${mode}`);
    return mode;
  }

  public addMemory(
    ownerId: string,
    input: { category: 'episodic' | 'semantic'; title: string; content: string; source: string; confidence?: number; ttlDays?: number },
  ): MemoryEntry {
    const state = this.getOrCreateOwner(ownerId);
    const now = new Date();
    const ttlDays = input.ttlDays ?? state.retentionDays ?? 30;
    const expiresAt = new Date(now.getTime() + ttlDays * 86400_000).toISOString();
    const entry: MemoryEntry = {
      id: `mem_${crypto.randomBytes(5).toString('hex')}`,
      ownerId,
      category: input.category,
      title: input.title,
      content: input.content,
      source: input.source,
      confidence: input.confidence ?? 0.9,
      ttlDays,
      expiresAt,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
      rejected: false,
    };
    state.memories.unshift(entry);
    this.persist();
    this.appendAudit(ownerId, 'memory_write', 'allowed', `Added ${input.category} memory ${entry.id}`);
    return entry;
  }

  public updateMemory(ownerId: string, memoryId: string, patch: Partial<Pick<MemoryEntry, 'title' | 'content' | 'rejected' | 'ttlDays'>>): MemoryEntry | null {
    const state = this.getOrCreateOwner(ownerId);
    const mem = state.memories.find((m) => m.id === memoryId && m.ownerId === ownerId);
    if (!mem) return null;
    if (patch.title !== undefined) mem.title = patch.title;
    if (patch.content !== undefined) mem.content = patch.content;
    if (patch.rejected !== undefined) mem.rejected = patch.rejected;
    if (patch.ttlDays !== undefined) {
      mem.ttlDays = patch.ttlDays;
      mem.expiresAt = new Date(Date.now() + patch.ttlDays * 86400_000).toISOString();
    }
    mem.updatedAt = new Date().toISOString();
    this.persist();
    this.appendAudit(ownerId, 'memory_write', 'allowed', `Updated memory ${memoryId}`);
    return mem;
  }

  public deleteMemory(ownerId: string, memoryId: string): boolean {
    const state = this.getOrCreateOwner(ownerId);
    const before = state.memories.length;
    state.memories = state.memories.filter((m) => !(m.id === memoryId && m.ownerId === ownerId));
    const removed = state.memories.length < before;
    if (removed) {
      this.persist();
      this.appendAudit(ownerId, 'memory_delete', 'allowed', `Permanently deleted memory ${memoryId}`);
    }
    return removed;
  }

  public saveTrace(ownerId: string, trace: ActionTrace): ActionTrace {
    const state = this.getOrCreateOwner(ownerId);
    const idx = state.traces.findIndex((t) => t.id === trace.id);
    if (idx >= 0) {
      state.traces[idx] = trace;
    } else {
      state.traces.unshift(trace);
    }
    this.persist();
    return trace;
  }

  public deleteTrace(ownerId: string, traceId: string): boolean {
    const state = this.getOrCreateOwner(ownerId);
    const before = state.traces.length;
    state.traces = state.traces.filter((t) => !(t.id === traceId && t.ownerId === ownerId));
    const removed = state.traces.length < before;
    if (removed) {
      this.persist();
      this.appendAudit(ownerId, 'trace_delete', 'allowed', `Deleted action trace ${traceId}`);
    }
    return removed;
  }

  public saveSkill(ownerId: string, skill: LearnedSkill): LearnedSkill {
    const state = this.getOrCreateOwner(ownerId);
    const idx = state.skills.findIndex((s) => s.id === skill.id);
    if (idx >= 0) {
      state.skills[idx] = skill;
    } else {
      state.skills.unshift(skill);
    }
    this.persist();
    return skill;
  }

  public deleteSkill(ownerId: string, skillId: string): boolean {
    const state = this.getOrCreateOwner(ownerId);
    const before = state.skills.length;
    state.skills = state.skills.filter((s) => !(s.id === skillId && s.ownerId === ownerId));
    const removed = state.skills.length < before;
    if (removed) {
      this.persist();
      this.appendAudit(ownerId, 'skill_approve', 'info', `Deleted skill ${skillId}`);
    }
    return removed;
  }

  public saveRun(ownerId: string, run: AgentRun): AgentRun {
    const state = this.getOrCreateOwner(ownerId);
    const idx = state.runs.findIndex((r) => r.id === run.id);
    if (idx >= 0) {
      state.runs[idx] = run;
    } else {
      state.runs.unshift(run);
    }
    if (state.runs.length > 60) {
      state.runs = state.runs.slice(0, 60);
    }
    this.persist();
    return run;
  }

  public findRunByIdempotency(ownerId: string, idempotencyKey: string): AgentRun | null {
    const entry = this.db.idempotency[`${ownerId}:${idempotencyKey}`];
    if (!entry) return null;
    const state = this.getOwner(ownerId);
    return state?.runs.find((r) => r.id === entry.runId) || null;
  }

  public registerIdempotency(ownerId: string, idempotencyKey: string, runId: string) {
    this.db.idempotency[`${ownerId}:${idempotencyKey}`] = {
      ownerId,
      runId,
      createdAt: new Date().toISOString(),
    };
    this.persist();
  }

  public setRetentionDays(ownerId: string, days: number): number {
    const state = this.getOrCreateOwner(ownerId);
    state.retentionDays = Math.max(1, Math.min(365, Math.round(days)));
    this.persist();
    this.appendAudit(ownerId, 'consent_change', 'info', `Retention TTL updated to ${state.retentionDays} days`);
    return state.retentionDays;
  }

  public updateMacCompanion(ownerId: string, patch: Partial<OwnerWorkspaceState['macCompanion']>) {
    const state = this.getOrCreateOwner(ownerId);
    state.macCompanion = { ...state.macCompanion, ...patch };
    this.persist();
    return state.macCompanion;
  }

  public exportOwnerData(ownerId: string): OwnerWorkspaceState | null {
    const state = this.getOwner(ownerId);
    if (!state) return null;
    this.appendAudit(ownerId, 'data_export', 'allowed', 'Exported complete user-owned twin data archive.');
    return JSON.parse(JSON.stringify(state)) as OwnerWorkspaceState;
  }

  public deleteOwnerAccount(ownerId: string): boolean {
    if (!this.db.owners[ownerId]) return false;
    delete this.db.owners[ownerId];
    for (const key of Object.keys(this.db.idempotency)) {
      if (key.startsWith(`${ownerId}:`)) {
        delete this.db.idempotency[key];
      }
    }
    this.persist();
    return true;
  }
}

export const twinStore = new TwinStore();
