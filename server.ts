import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import express from 'express';
import type { Request, Response } from 'express';
import { createServer as createViteServer } from 'vite';
import type {
  ActionTrace,
  AgentRun,
  ConsentScopeId,
  LearnedSkill,
  PlannedStep,
  RunMode,
  SkillCorrectionProposal,
} from './src/types/twin.ts';
import { twinStore, sanitizeActionEvent } from './server/store.ts';
import { checkConsent, checkSiteGrant, normalizeOrigin } from './server/permissionBroker.ts';
import {
  chatWithTwin,
  decomposeTraceToSkill,
  planAgentGoal,
  summarizeApprovedDocument,
} from './server/geminiService.ts';
import { browserExecutor } from './server/browserExecutor.ts';
import { buildVerificationLedger, runAutomatedSafetyChecks } from './server/verificationSuite.ts';
import { createZipBuffer } from './server/zipBuilder.ts';

const PORT = Number(process.env.PORT || 3000);
const MAX_TRACE_EVENTS = 120;

let lastChecks = runAutomatedSafetyChecks();

function getOwnerId(req: Request): string | null {
  const headerOwner = req.headers['x-twin-owner'];
  if (typeof headerOwner === 'string' && /^[a-zA-Z0-9_\-:.@]{3,128}$/.test(headerOwner)) {
    return headerOwner;
  }
  const queryOwner = req.query.ownerId;
  if (typeof queryOwner === 'string' && /^[a-zA-Z0-9_\-:.@]{3,128}$/.test(queryOwner)) {
    return queryOwner;
  }
  return null;
}

function getServerOrigin(req: Request): string {
  // Inside local server Playwright, always navigate to loopback port 3000 for internal fixtures
  const host = req.headers.host || `127.0.0.1:${PORT}`;
  if (host.includes('localhost') || host.includes('127.0.0.1')) {
    return `http://${host}`;
  }
  return `http://127.0.0.1:${PORT}`;
}

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '2mb' }));

  // Allow Chrome MV3 extension requests to /api/teach/extension/*
  app.use('/api/teach/extension', (req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-twin-owner');
    if (req.method === 'OPTIONS') {
      res.status(204).end();
      return;
    }
    next();
  });

  app.get('/api/health', (_req, res) => {
    res.json({
      ok: true,
      service: 'twinme-studio',
      geminiConfigured: Boolean(process.env.GEMINI_API_KEY),
      storageMode: 'local-owner-scoped-json',
      firestoreEnabled: false,
      workspaceOAuthEnabled: false,
    });
  });

  app.get('/api/workspace', (req, res) => {
    const ownerId = getOwnerId(req);
    if (!ownerId) return res.status(401).json({ error: 'Missing or invalid x-twin-owner identity header.' });
    const accountType = req.query.accountType === 'google' ? 'google' : 'guest';
    const email = typeof req.query.email === 'string' ? req.query.email : undefined;
    const state = twinStore.getOrCreateOwner(ownerId, accountType, email);
    res.json(state);
  });

  app.post('/api/onboarding', (req, res) => {
    const ownerId = getOwnerId(req);
    if (!ownerId) return res.status(401).json({ error: 'Missing x-twin-owner header.' });
    const { displayName, headline, timezone, primaryGoal, workingConstraints, consents } = req.body as {
      displayName: string;
      headline: string;
      timezone: string;
      primaryGoal: string;
      workingConstraints?: string[];
      consents?: Record<ConsentScopeId, boolean>;
    };
    if (!displayName?.trim()) {
      return res.status(400).json({ error: 'Individual displayName is required.' });
    }
    twinStore.getOrCreateOwner(ownerId);
    twinStore.updateProfile(
      ownerId,
      {
        displayName: displayName.trim(),
        headline: (headline || '').trim(),
        timezone: (timezone || 'UTC').trim(),
        primaryGoal: (primaryGoal || '').trim(),
        workingConstraints: Array.isArray(workingConstraints) ? workingConstraints.filter(Boolean) : [],
        established: true,
      },
      'user_onboarding',
      'Individual established personal digital twin via consent-first onboarding.',
    );

    if (consents) {
      for (const [scope, granted] of Object.entries(consents)) {
        twinStore.setConsent(ownerId, scope as ConsentScopeId, Boolean(granted));
      }
    }

    // Automatically ensure the safe local research fixture can be explicitly granted when requested
    res.json(twinStore.getOwner(ownerId));
  });

  app.patch('/api/profile', (req, res) => {
    const ownerId = getOwnerId(req);
    if (!ownerId) return res.status(401).json({ error: 'Missing x-twin-owner header.' });
    const state = twinStore.getOwner(ownerId);
    if (!state) return res.status(404).json({ error: 'Twin not found.' });

    const { displayName, headline, timezone, primaryGoal, workingConstraints, preferences, note } = req.body;
    const updated = twinStore.updateProfile(
      ownerId,
      {
        ...(displayName !== undefined ? { displayName } : {}),
        ...(headline !== undefined ? { headline } : {}),
        ...(timezone !== undefined ? { timezone } : {}),
        ...(primaryGoal !== undefined ? { primaryGoal } : {}),
        ...(workingConstraints !== undefined ? { workingConstraints } : {}),
        ...(preferences !== undefined ? { preferences } : {}),
      },
      'user_edit',
      note || 'Manual profile/preference update by owner.',
    );
    res.json(updated);
  });

  app.post('/api/consents', (req, res) => {
    const ownerId = getOwnerId(req);
    if (!ownerId) return res.status(401).json({ error: 'Missing x-twin-owner header.' });
    const { scope, granted } = req.body as { scope: ConsentScopeId; granted: boolean };
    const consents = twinStore.setConsent(ownerId, scope, Boolean(granted));
    res.json({ consents });
  });

  app.post('/api/sites', (req, res) => {
    const ownerId = getOwnerId(req);
    if (!ownerId) return res.status(401).json({ error: 'Missing x-twin-owner header.' });
    const { origin, label, teachAllowed, agentAllowed } = req.body as {
      origin: string;
      label: string;
      teachAllowed: boolean;
      agentAllowed: boolean;
    };
    if (!origin?.trim()) return res.status(400).json({ error: 'Origin is required.' });
    const normalized = normalizeOrigin(origin, getServerOrigin(req));
    const siteGrants = twinStore.upsertSiteGrant(ownerId, normalized, label || normalized, Boolean(teachAllowed), Boolean(agentAllowed));
    res.json({ siteGrants });
  });

  app.delete('/api/sites', (req, res) => {
    const ownerId = getOwnerId(req);
    if (!ownerId) return res.status(401).json({ error: 'Missing x-twin-owner header.' });
    const origin = typeof req.query.origin === 'string' ? req.query.origin : req.body?.origin;
    if (!origin) return res.status(400).json({ error: 'Origin is required.' });
    const siteGrants = twinStore.revokeSiteGrant(ownerId, origin);
    res.json({ siteGrants });
  });

  app.post('/api/mode', (req, res) => {
    const ownerId = getOwnerId(req);
    if (!ownerId) return res.status(401).json({ error: 'Missing x-twin-owner header.' });
    const { mode } = req.body as { mode: RunMode };
    if (!['twin', 'shadow', 'supervised_agent', 'paused'].includes(mode)) {
      return res.status(400).json({ error: 'Invalid mode.' });
    }
    const state = twinStore.getOrCreateOwner(ownerId);
    if (mode === 'supervised_agent') {
      const browserConsent = checkConsent(state, 'browser_execution');
      if (!browserConsent.allowed) {
        return res.status(403).json({ error: browserConsent.reason });
      }
    }
    const activeMode = twinStore.setMode(ownerId, mode);
    res.json({ activeMode });
  });

  // Memories (TWIN-003)
  app.post('/api/memories', (req, res) => {
    const ownerId = getOwnerId(req);
    if (!ownerId) return res.status(401).json({ error: 'Missing x-twin-owner header.' });
    const state = twinStore.getOrCreateOwner(ownerId);
    const consent = checkConsent(state, 'memory_persistence');
    if (!consent.allowed) {
      return res.status(403).json({ error: consent.reason });
    }
    const { category, title, content, source, ttlDays } = req.body;
    if (!title?.trim() || !content?.trim()) {
      return res.status(400).json({ error: 'Memory title and content are required.' });
    }
    const entry = twinStore.addMemory(ownerId, {
      category: category === 'episodic' ? 'episodic' : 'semantic',
      title: title.trim(),
      content: content.trim(),
      source: source || 'user_entry',
      ttlDays: ttlDays ? Number(ttlDays) : undefined,
    });
    res.json(entry);
  });

  app.patch('/api/memories/:id', (req, res) => {
    const ownerId = getOwnerId(req);
    if (!ownerId) return res.status(401).json({ error: 'Missing x-twin-owner header.' });
    const updated = twinStore.updateMemory(ownerId, req.params.id, req.body);
    if (!updated) return res.status(404).json({ error: 'Memory not found.' });
    res.json(updated);
  });

  app.delete('/api/memories/:id', (req, res) => {
    const ownerId = getOwnerId(req);
    if (!ownerId) return res.status(401).json({ error: 'Missing x-twin-owner header.' });
    const ok = twinStore.deleteMemory(ownerId, req.params.id);
    if (!ok) return res.status(404).json({ error: 'Memory not found.' });
    res.json({ deleted: true });
  });

  // Grounded Gemini Twin Dialogue (TWIN-004)
  app.post('/api/twin/chat', async (req, res) => {
    const ownerId = getOwnerId(req);
    if (!ownerId) return res.status(401).json({ error: 'Missing x-twin-owner header.' });
    const state = twinStore.getOrCreateOwner(ownerId);
    const { message } = req.body as { message: string };
    if (!message?.trim()) return res.status(400).json({ error: 'Message is required.' });
    try {
      const result = await chatWithTwin(state.profile, state.memories, state.skills, message.trim());
      res.json(result);
    } catch (err) {
      res.status(502).json({ error: err instanceof Error ? err.message : 'Gemini chat failed.' });
    }
  });

  // Teach Mode Sessions (OBS-001 .. OBS-005)
  app.post('/api/teach/sessions', (req, res) => {
    const ownerId = getOwnerId(req);
    if (!ownerId) return res.status(401).json({ error: 'Missing x-twin-owner header.' });
    const state = twinStore.getOrCreateOwner(ownerId);

    const consent = checkConsent(state, 'teach_observation');
    if (!consent.allowed) {
      return res.status(403).json({ error: consent.reason });
    }

    const { site, title, screenshotConsent } = req.body as { site: string; title?: string; screenshotConsent?: boolean };
    const serverOrigin = getServerOrigin(req);
    const siteCheck = checkSiteGrant(state, site, 'teach', serverOrigin);
    if (!siteCheck.allowed) {
      return res.status(403).json({ error: siteCheck.reason });
    }

    const now = new Date();
    const trace: ActionTrace = {
      id: `trace_${crypto.randomBytes(5).toString('hex')}`,
      ownerId,
      sessionId: `sess_${crypto.randomBytes(4).toString('hex')}`,
      site: siteCheck.origin,
      title: (title || 'Research Workflow Demonstration').trim(),
      status: 'recording',
      privacyLabel: 'redacted_safe',
      recordedAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + state.retentionDays * 86400_000).toISOString(),
      screenshotConsent: Boolean(screenshotConsent),
      events: [],
      approved: false,
    };
    twinStore.saveTrace(ownerId, trace);
    twinStore.appendAudit(ownerId, 'trace_capture', 'allowed', `Started explicit Teach session ${trace.id} on ${trace.site}`);
    res.json(trace);
  });

  app.post('/api/teach/sessions/:id/events', (req, res) => {
    const ownerId = getOwnerId(req);
    if (!ownerId) return res.status(401).json({ error: 'Missing x-twin-owner header.' });
    const state = twinStore.getOwner(ownerId);
    const trace = state?.traces.find((t) => t.id === req.params.id);
    if (!trace) return res.status(404).json({ error: 'Trace session not found.' });
    if (trace.status !== 'recording') {
      return res.status(409).json({ error: `Trace session is "${trace.status}", not actively recording.` });
    }
    if (trace.events.length >= MAX_TRACE_EVENTS) {
      return res.status(429).json({ error: `Trace event budget exceeded (max ${MAX_TRACE_EVENTS} events per demonstration).` });
    }

    const { event, isPrivateMode } = req.body as { event: any; isPrivateMode?: boolean };
    const sanitized = sanitizeActionEvent(event, trace.events.length, Boolean(isPrivateMode));
    if (!sanitized) {
      trace.privacyLabel = 'private_mode_blocked';
      twinStore.saveTrace(ownerId, trace);
      return res.status(403).json({ error: 'Private/incognito browsing events are never stored.' });
    }

    trace.events.push(sanitized);
    if (!sanitized.redacted && sanitized.valuePreview) {
      trace.privacyLabel = 'contains_user_input';
    }
    twinStore.saveTrace(ownerId, trace);
    res.json(trace);
  });

  app.patch('/api/teach/sessions/:id', (req, res) => {
    const ownerId = getOwnerId(req);
    if (!ownerId) return res.status(401).json({ error: 'Missing x-twin-owner header.' });
    const state = twinStore.getOwner(ownerId);
    const trace = state?.traces.find((t) => t.id === req.params.id);
    if (!trace) return res.status(404).json({ error: 'Trace session not found.' });

    const { action, eventId, redactedValue } = req.body as {
      action: 'pause' | 'resume' | 'finish' | 'trim_event' | 'redact_event' | 'discard';
      eventId?: string;
      redactedValue?: string;
    };

    if (action === 'discard') {
      twinStore.deleteTrace(ownerId, trace.id);
      return res.json({ discarded: true, id: trace.id });
    }
    if (action === 'pause') trace.status = 'paused';
    if (action === 'resume') trace.status = 'recording';
    if (action === 'finish') trace.status = 'ready_for_review';
    if (action === 'trim_event' && eventId) {
      trace.events = trace.events.filter((e) => e.id !== eventId).map((e, i) => ({ ...e, index: i }));
    }
    if (action === 'redact_event' && eventId) {
      trace.events = trace.events.map((e) =>
        e.id === eventId
          ? { ...e, valuePreview: redactedValue ?? '[USER_REDACTED]', redacted: true, redactionReason: 'Manually redacted by owner' }
          : e,
      );
    }

    twinStore.saveTrace(ownerId, trace);
    res.json(trace);
  });

  app.post('/api/teach/sessions/:id/decompose', async (req, res) => {
    const ownerId = getOwnerId(req);
    if (!ownerId) return res.status(401).json({ error: 'Missing x-twin-owner header.' });
    const state = twinStore.getOwner(ownerId);
    const trace = state?.traces.find((t) => t.id === req.params.id);
    if (!trace) return res.status(404).json({ error: 'Trace session not found.' });
    if (trace.events.length === 0) {
      return res.status(400).json({ error: 'Cannot decompose an empty trace. Demonstrate at least one action first.' });
    }
    try {
      const draft = await decomposeTraceToSkill(trace);
      res.json(draft);
    } catch (err) {
      res.status(502).json({ error: err instanceof Error ? err.message : 'Gemini workflow decomposition failed.' });
    }
  });

  // Chrome MV3 Extension Live Bridge (OBS-001 / OBS-002)
  app.post('/api/teach/extension/start', (req, res) => {
    const ownerId = getOwnerId(req);
    if (!ownerId) return res.status(401).json({ error: 'Missing x-twin-owner header.' });
    const state = twinStore.getOrCreateOwner(ownerId);

    const consent = checkConsent(state, 'teach_observation');
    if (!consent.allowed) {
      return res.status(403).json({ error: 'Enable "Teach Mode Observation" consent in TwinMe Onboarding or Privacy Settings first.' });
    }

    const { site, title, explicitPopupGrant } = req.body as {
      site: string;
      title?: string;
      explicitPopupGrant?: boolean;
    };
    const serverOrigin = getServerOrigin(req);
    const normalized = normalizeOrigin(site, serverOrigin);
    if (!normalized) return res.status(400).json({ error: 'Site origin is required.' });

    // Only allow explicit opt-in from Chrome popup toggle
    if (explicitPopupGrant) {
      twinStore.upsertSiteGrant(ownerId, normalized, `Chrome: ${normalized}`, true, true);
    }

    const updatedState = twinStore.getOrCreateOwner(ownerId);
    const siteCheck = checkSiteGrant(updatedState, normalized, 'teach', serverOrigin);
    if (!siteCheck.allowed) {
      return res.status(403).json({ error: siteCheck.reason });
    }

    const now = new Date();
    const trace: ActionTrace = {
      id: `trace_${crypto.randomBytes(5).toString('hex')}`,
      ownerId,
      sessionId: `chrome_${crypto.randomBytes(4).toString('hex')}`,
      site: siteCheck.origin,
      title: (title || `Chrome Recording (${siteCheck.origin})`).trim(),
      status: 'recording',
      privacyLabel: 'redacted_safe',
      recordedAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + updatedState.retentionDays * 86400_000).toISOString(),
      screenshotConsent: false,
      events: [],
      approved: false,
    };
    twinStore.saveTrace(ownerId, trace);
    twinStore.appendAudit(ownerId, 'trace_capture', 'allowed', `Started Chrome extension Teach session ${trace.id} on ${trace.site}`);
    res.json(trace);
  });

  app.post('/api/teach/extension/ingest', (req, res) => {
    const ownerId = getOwnerId(req);
    if (!ownerId) return res.status(401).json({ error: 'Missing x-twin-owner header.' });
    const state = twinStore.getOwner(ownerId);
    const { traceId, event, isPrivateMode } = req.body as { traceId: string; event: any; isPrivateMode?: boolean };
    const trace = state?.traces.find((t) => t.id === traceId);
    if (!trace) return res.status(404).json({ error: 'Trace session not found.' });
    if (trace.status !== 'recording') {
      return res.status(409).json({ error: `Trace session is "${trace.status}", not actively recording.` });
    }
    if (trace.events.length >= MAX_TRACE_EVENTS) {
      return res.status(429).json({ error: `Trace event budget exceeded (max ${MAX_TRACE_EVENTS}).` });
    }
    const sanitized = sanitizeActionEvent(event, trace.events.length, Boolean(isPrivateMode));
    if (!sanitized) {
      trace.privacyLabel = 'private_mode_blocked';
      twinStore.saveTrace(ownerId, trace);
      return res.status(403).json({ error: 'Private/incognito events are never stored.' });
    }
    trace.events.push(sanitized);
    if (!sanitized.redacted && sanitized.valuePreview) {
      trace.privacyLabel = 'contains_user_input';
    }
    twinStore.saveTrace(ownerId, trace);
    res.json({ ok: true, count: trace.events.length });
  });

  app.post('/api/teach/extension/finish', (req, res) => {
    const ownerId = getOwnerId(req);
    if (!ownerId) return res.status(401).json({ error: 'Missing x-twin-owner header.' });
    const state = twinStore.getOwner(ownerId);
    const { traceId } = req.body as { traceId: string };
    const trace = state?.traces.find((t) => t.id === traceId);
    if (!trace) return res.status(404).json({ error: 'Trace session not found.' });
    trace.status = 'ready_for_review';
    twinStore.saveTrace(ownerId, trace);
    twinStore.appendAudit(ownerId, 'trace_capture', 'info', `Finished Chrome extension trace ${trace.id} (${trace.events.length} events ready for review).`);
    res.json(trace);
  });

  // Skills & Corrections (OBS-006, OBS-007, AGENT-012)
  app.post('/api/skills', (req, res) => {
    const ownerId = getOwnerId(req);
    if (!ownerId) return res.status(401).json({ error: 'Missing x-twin-owner header.' });
    const state = twinStore.getOrCreateOwner(ownerId);

    const { traceId, name, intent, summary, preconditions, inputs, allowedOrigins, steps, expectedOutcomes, uncertaintyFlags } = req.body;
    if (!name?.trim() || !Array.isArray(steps) || steps.length === 0) {
      return res.status(400).json({ error: 'Skill name and at least one step are required.' });
    }

    if (traceId) {
      const trace = state.traces.find((t) => t.id === traceId);
      if (trace) {
        trace.approved = true;
        trace.status = 'approved';
        twinStore.saveTrace(ownerId, trace);
      }
    }

    const now = new Date().toISOString();
    const skill: LearnedSkill = {
      id: `skill_${crypto.randomBytes(5).toString('hex')}`,
      ownerId,
      version: 1,
      name: name.trim(),
      intent: (intent || '').trim(),
      summary: (summary || '').trim(),
      preconditions: Array.isArray(preconditions) ? preconditions : [],
      inputs: inputs || {},
      allowedOrigins: Array.isArray(allowedOrigins) && allowedOrigins.length ? allowedOrigins : [getServerOrigin(req)],
      steps,
      expectedOutcomes: Array.isArray(expectedOutcomes) ? expectedOutcomes : [],
      uncertaintyFlags: Array.isArray(uncertaintyFlags) ? uncertaintyFlags : [],
      sourceTraceIds: traceId ? [traceId] : [],
      verifiedRunsCount: 0,
      createdAt: now,
      updatedAt: now,
      corrections: [],
    };
    twinStore.saveSkill(ownerId, skill);
    twinStore.appendAudit(ownerId, 'skill_approve', 'allowed', `Approved & saved skill ${skill.name} (v1) from trace ${traceId || 'manual'}`);
    if (checkConsent(state, 'memory_persistence').allowed) {
      twinStore.addMemory(ownerId, {
        category: 'episodic',
        title: `Taught skill: ${skill.name}`,
        content: `Demonstrated on ${skill.allowedOrigins.join(', ')}. ${skill.summary || skill.intent} (${skill.steps.length} steps, variables: ${Object.keys(skill.inputs).join(', ') || 'none'}).`,
        source: `teach_skill_${skill.id}`,
      });
    }
    res.json(skill);
  });

  app.post('/api/skills/:id/corrections', (req, res) => {
    const ownerId = getOwnerId(req);
    if (!ownerId) return res.status(401).json({ error: 'Missing x-twin-owner header.' });
    const state = twinStore.getOwner(ownerId);
    const skill = state?.skills.find((s) => s.id === req.params.id);
    if (!skill) return res.status(404).json({ error: 'Skill not found.' });

    const { stepId, reason, updatedStep } = req.body as { stepId: string; reason: string; updatedStep: Partial<PlannedStep> };
    const originalStep = skill.steps.find((s) => s.id === stepId);
    if (!originalStep) return res.status(404).json({ error: 'Step not found in skill.' });

    // Never allow correction to elevate privileges automatically
    const sanitizedAfter: PlannedStep = {
      ...originalStep,
      targetSelector: updatedStep.targetSelector ?? originalStep.targetSelector,
      fallbackText: updatedStep.fallbackText ?? originalStep.fallbackText,
      description: updatedStep.description ?? originalStep.description,
      expectedOutcome: updatedStep.expectedOutcome ?? originalStep.expectedOutcome,
      inputKey: updatedStep.inputKey ?? originalStep.inputKey,
      staticValue: updatedStep.staticValue ?? originalStep.staticValue,
      risk: originalStep.risk,
      requiresApproval: originalStep.requiresApproval,
    };

    const proposal: SkillCorrectionProposal = {
      id: `corr_${crypto.randomBytes(4).toString('hex')}`,
      skillId: skill.id,
      fromVersion: skill.version,
      toVersion: skill.version + 1,
      reason: reason || 'User corrected step selector or expectation.',
      beforeStep: originalStep,
      afterStep: sanitizedAfter,
      status: 'pending',
      createdAt: new Date().toISOString(),
    };

    skill.corrections.unshift(proposal);
    twinStore.saveSkill(ownerId, skill);
    res.json({ skill, proposal });
  });

  app.post('/api/skills/:id/corrections/:corrId/resolve', (req, res) => {
    const ownerId = getOwnerId(req);
    if (!ownerId) return res.status(401).json({ error: 'Missing x-twin-owner header.' });
    const state = twinStore.getOwner(ownerId);
    const skill = state?.skills.find((s) => s.id === req.params.id);
    if (!skill) return res.status(404).json({ error: 'Skill not found.' });
    const proposal = skill.corrections.find((c) => c.id === req.params.corrId);
    if (!proposal) return res.status(404).json({ error: 'Correction proposal not found.' });

    const { decision } = req.body as { decision: 'accept' | 'reject' };
    proposal.status = decision === 'accept' ? 'accepted' : 'rejected';
    proposal.resolvedAt = new Date().toISOString();

    if (decision === 'accept') {
      skill.steps = skill.steps.map((s) => (s.id === proposal.beforeStep.id ? proposal.afterStep : s));
      skill.version += 1;
      skill.updatedAt = new Date().toISOString();
      twinStore.appendAudit(ownerId, 'skill_approve', 'allowed', `Accepted correction ${proposal.id}; skill ${skill.name} bumped to v${skill.version}`);
    } else {
      twinStore.appendAudit(ownerId, 'skill_approve', 'info', `Rejected correction ${proposal.id}; skill ${skill.name} remains v${skill.version}`);
    }

    twinStore.saveSkill(ownerId, skill);
    res.json(skill);
  });

  app.delete('/api/skills/:id', (req, res) => {
    const ownerId = getOwnerId(req);
    if (!ownerId) return res.status(401).json({ error: 'Missing x-twin-owner header.' });
    const ok = twinStore.deleteSkill(ownerId, req.params.id);
    if (!ok) return res.status(404).json({ error: 'Skill not found.' });
    res.json({ deleted: true });
  });

  // Agent Goal Planner & Execution (AGENT-002 .. AGENT-013)
  app.post('/api/agent/plan', async (req, res) => {
    const ownerId = getOwnerId(req);
    if (!ownerId) return res.status(401).json({ error: 'Missing x-twin-owner header.' });
    const state = twinStore.getOrCreateOwner(ownerId);
    const { goal, skillId, inputOverrides } = req.body as {
      goal: string;
      skillId?: string;
      inputOverrides?: Record<string, string>;
    };
    if (!goal?.trim()) return res.status(400).json({ error: 'Goal is required.' });

    const allowedOrigins = state.siteGrants.filter((s) => s.agentAllowed).map((s) => s.origin);
    try {
      const plan = await planAgentGoal(goal.trim(), allowedOrigins, state.skills, skillId, inputOverrides || {});
      res.json(plan);
    } catch (err) {
      res.status(502).json({ error: err instanceof Error ? err.message : 'Goal planner failed.' });
    }
  });

  app.post('/api/agent/runs', async (req, res) => {
    const ownerId = getOwnerId(req);
    if (!ownerId) return res.status(401).json({ error: 'Missing x-twin-owner header.' });
    const state = twinStore.getOrCreateOwner(ownerId);

    const { mode, skillId, goal, targetUrl, inputValues, steps, idempotencyKey } = req.body as {
      mode: RunMode;
      skillId?: string;
      goal: string;
      targetUrl: string;
      inputValues?: Record<string, string>;
      steps: PlannedStep[];
      idempotencyKey?: string;
    };

    const idemKey = idempotencyKey || `idem_${crypto.randomBytes(6).toString('hex')}`;
    const existing = twinStore.findRunByIdempotency(ownerId, idemKey);
    if (existing) {
      return res.json(existing);
    }

    const serverOrigin = getServerOrigin(req);
    if (mode === 'supervised_agent') {
      const browserConsent = checkConsent(state, 'browser_execution');
      if (!browserConsent.allowed) {
        twinStore.appendAudit(ownerId, 'policy_check', 'denied', browserConsent.reason || 'Browser consent missing');
        return res.status(403).json({ error: browserConsent.reason });
      }
    }

    const siteCheck = checkSiteGrant(state, targetUrl || serverOrigin, 'agent', serverOrigin);
    if (!siteCheck.allowed) {
      twinStore.appendAudit(ownerId, 'policy_check', 'denied', siteCheck.reason || 'Site not allowlisted');
      return res.status(403).json({ error: siteCheck.reason });
    }

    const skill = skillId ? state.skills.find((s) => s.id === skillId) : undefined;
    const now = new Date().toISOString();
    const plannedSteps = Array.isArray(steps) && steps.length ? steps : skill?.steps || [];
    if (plannedSteps.length === 0) {
      return res.status(400).json({ error: 'Run requires at least one planned step.' });
    }

    const run: AgentRun = {
      id: `run_${crypto.randomBytes(5).toString('hex')}`,
      ownerId,
      mode,
      skillId: skill?.id,
      skillVersion: skill?.version,
      goal: (goal || skill?.intent || 'Execute skill').trim(),
      targetOrigin: siteCheck.origin,
      inputValues: inputValues || {},
      status: 'pending',
      idempotencyKey: idemKey,
      approvedCapabilities: state.consents.filter((c) => c.granted).map((c) => c.scope),
      plannedSteps,
      steps: plannedSteps.map((s) => ({
        stepId: s.id,
        order: s.order,
        action: s.action,
        description: s.description,
        targetUsed: s.targetSelector,
        status: 'pending',
        observation: 'Queued for execution',
        startedAt: now,
      })),
      budget: {
        maxSteps: 15,
        maxDurationMs: 60_000,
        tokensUsed: 0,
        maxTokens: 20_000,
      },
      createdAt: now,
      updatedAt: now,
    };

    twinStore.saveRun(ownerId, run);
    twinStore.registerIdempotency(ownerId, idemKey, run.id);

    void browserExecutor.startRun(ownerId, run, serverOrigin);
    res.json(run);
  });

  app.get('/api/agent/runs/:id/stream', (req, res) => {
    const ownerId = getOwnerId(req);
    if (!ownerId) return res.status(401).json({ error: 'Missing ownerId.' });
    const state = twinStore.getOwner(ownerId);
    const run = state?.runs.find((r) => r.id === req.params.id);
    if (!run) return res.status(404).json({ error: 'Run not found.' });

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    res.write(`data: ${JSON.stringify(run)}\n\n`);

    const unsubscribe = browserExecutor.subscribe(run.id, (updatedRun) => {
      res.write(`data: ${JSON.stringify(updatedRun)}\n\n`);
    });

    req.on('close', () => {
      unsubscribe();
    });
  });

  app.post('/api/agent/runs/:id/approve', async (req, res) => {
    const ownerId = getOwnerId(req);
    if (!ownerId) return res.status(401).json({ error: 'Missing x-twin-owner header.' });
    const { approvalToken } = req.body as { approvalToken?: string };
    const result = await browserExecutor.resumeAfterApproval(ownerId, req.params.id, approvalToken, getServerOrigin(req));
    if (!result.ok) {
      return res.status(403).json({ error: result.error });
    }
    res.json(result.run);
  });

  app.post('/api/agent/runs/:id/abort', (req, res) => {
    const ownerId = getOwnerId(req);
    if (!ownerId) return res.status(401).json({ error: 'Missing x-twin-owner header.' });
    const { reason } = req.body as { reason?: 'paused' | 'cancelled' };
    const updated = browserExecutor.abortRun(ownerId, req.params.id, reason === 'paused' ? 'paused' : 'cancelled');
    if (!updated) return res.status(404).json({ error: 'Run not found.' });
    res.json(updated);
  });

  // Document summarization tool (INT-005 local approved doc)
  app.post('/api/tools/summarize-doc', async (req, res) => {
    const ownerId = getOwnerId(req);
    if (!ownerId) return res.status(401).json({ error: 'Missing x-twin-owner header.' });
    const { title, text } = req.body as { title: string; text: string };
    if (!text?.trim()) return res.status(400).json({ error: 'Document text is required.' });
    try {
      const result = await summarizeApprovedDocument(title || 'User Document', text);
      twinStore.appendAudit(ownerId, 'run_execute', 'allowed', `Summarized user-provided text document "${title || 'Untitled'}"`);
      res.json(result);
    } catch (err) {
      res.status(502).json({ error: err instanceof Error ? err.message : 'Document summarization failed.' });
    }
  });

  // macOS companion pairing bridge (AGENT-007, AGENT-008)
  app.post('/api/companion/pair', (req, res) => {
    const ownerId = getOwnerId(req);
    if (!ownerId) return res.status(401).json({ error: 'Missing x-twin-owner header.' });
    const { deviceName } = req.body as { deviceName?: string };
    const capabilityToken = `mac_${crypto.randomBytes(16).toString('hex')}`;
    const expiresAt = new Date(Date.now() + 900_000).toISOString();
    const updated = twinStore.updateMacCompanion(ownerId, {
      paired: true,
      deviceName: deviceName?.trim() || 'Local MacBook',
      companionUrl: 'http://127.0.0.1:48720',
      capabilityToken,
      expiresAt,
      lastHeartbeatAt: new Date().toISOString(),
      statusNote: 'Capability token issued (15m TTL). Waiting for live local macOS companion heartbeat on 127.0.0.1:48720.',
    });
    twinStore.appendAudit(ownerId, 'consent_change', 'info', `Issued expiring macOS companion capability token (expires ${expiresAt})`);
    res.json(updated);
  });

  app.post('/api/companion/revoke', (req, res) => {
    const ownerId = getOwnerId(req);
    if (!ownerId) return res.status(401).json({ error: 'Missing x-twin-owner header.' });
    const updated = twinStore.updateMacCompanion(ownerId, {
      paired: false,
      capabilityToken: undefined,
      expiresAt: undefined,
      statusNote: 'Pairing revoked by user.',
    });
    twinStore.appendAudit(ownerId, 'consent_change', 'info', 'Revoked macOS companion capability token.');
    res.json(updated);
  });

  // Artifacts for Chrome MV3 extension & macOS companion
  app.get('/api/artifacts/extension', (_req, res) => {
    const extDir = path.resolve(process.cwd(), 'extension');
    const files = ['manifest.json', 'background.js', 'content.js', 'popup.html', 'popup.js'].map((name) => ({
      name,
      content: fs.readFileSync(path.join(extDir, name), 'utf-8'),
    }));
    res.json({ files });
  });

  app.get('/api/artifacts/extension.zip', (_req, res) => {
    const extDir = path.resolve(process.cwd(), 'extension');
    const entries = ['manifest.json', 'background.js', 'content.js', 'popup.html', 'popup.js'].map((name) => ({
      name: `twinme-extension/${name}`,
      data: fs.readFileSync(path.join(extDir, name)),
    }));
    const zipBuffer = createZipBuffer(entries);
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', 'attachment; filename="twinme-chrome-extension.zip"');
    res.send(zipBuffer);
  });

  app.get('/api/artifacts/macos-companion', (_req, res) => {
    const macDir = path.resolve(process.cwd(), 'macos-companion');
    const files = ['twinme_companion.py', 'README.md'].map((name) => ({
      name,
      content: fs.readFileSync(path.join(macDir, name), 'utf-8'),
    }));
    res.json({ files });
  });

  // Privacy, Export & Hard Deletion (SAFE-003)
  app.post('/api/privacy/retention', (req, res) => {
    const ownerId = getOwnerId(req);
    if (!ownerId) return res.status(401).json({ error: 'Missing x-twin-owner header.' });
    const days = twinStore.setRetentionDays(ownerId, Number(req.body.retentionDays || 30));
    res.json({ retentionDays: days });
  });

  app.delete('/api/teach/traces/:id', (req, res) => {
    const ownerId = getOwnerId(req);
    if (!ownerId) return res.status(401).json({ error: 'Missing x-twin-owner header.' });
    const ok = twinStore.deleteTrace(ownerId, req.params.id);
    if (!ok) return res.status(404).json({ error: 'Trace not found.' });
    res.json({ deleted: true });
  });

  app.get('/api/privacy/export', (req, res) => {
    const ownerId = getOwnerId(req);
    if (!ownerId) return res.status(401).json({ error: 'Missing x-twin-owner header.' });
    const exported = twinStore.exportOwnerData(ownerId);
    if (!exported) return res.status(404).json({ error: 'Twin data not found.' });
    res.json(exported);
  });

  app.delete('/api/privacy/account', (req, res) => {
    const ownerId = getOwnerId(req);
    if (!ownerId) return res.status(401).json({ error: 'Missing x-twin-owner header.' });
    const deleted = twinStore.deleteOwnerAccount(ownerId);
    res.json({ deleted });
  });

  // Verification Ledger & Automated Safety Checks (QA-003)
  app.get('/api/verification/ledger', (_req, res) => {
    res.json({
      checks: lastChecks,
      tickets: buildVerificationLedger(lastChecks),
    });
  });

  app.post('/api/verification/run', (_req, res) => {
    lastChecks = runAutomatedSafetyChecks();
    res.json({
      checks: lastChecks,
      tickets: buildVerificationLedger(lastChecks),
    });
  });

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`TwinMe Studio listening on http://0.0.0.0:${PORT}`);
  });
}

startServer();
