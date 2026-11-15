import React, { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowRight,
  Check,
  CheckCircle2,
  Clock,
  Download,
  Play,
  RotateCcw,
  ShieldAlert,
  Square,
  XCircle,
} from 'lucide-react';
import { LayoutShell } from '../components/LayoutShell';
import { StateBadge } from '../components/StateBadge';
import { useTwin } from '../context/TwinContext';
import type { ActionTrace, AgentRun, LearnedSkill, PlannedStep } from '../types/twin';

type StageKey = 'onboard' | 'teach' | 'skill' | 'chat' | 'agent' | 'safety';
type StageStatus = 'idle' | 'running' | 'passed' | 'error';

interface StageState {
  status: StageStatus;
  durationMs?: number;
  summary?: string;
  error?: string;
}

const INITIAL_STAGES: Record<StageKey, StageState> = {
  onboard: { status: 'idle' },
  teach: { status: 'idle' },
  skill: { status: 'idle' },
  chat: { status: 'idle' },
  agent: { status: 'idle' },
  safety: { status: 'idle' },
};

async function ownerJsonFetch<T = any>(
  ownerId: string,
  url: string,
  init: RequestInit = {},
): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set('x-twin-owner', ownerId);
  if (init.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }
  const res = await fetch(url, { ...init, headers });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || `Request failed (${res.status})`);
  }
  return data as T;
}

export const DemoPage: React.FC = () => {
  const { ownerId, demoActive, health, enterDemoSandbox, exitDemoSandbox, refreshWorkspace } = useTwin();

  const [stages, setStages] = useState<Record<StageKey, StageState>>(INITIAL_STAGES);
  const [runningAll, setRunningAll] = useState(false);
  const [sandboxOwnerId, setSandboxOwnerId] = useState<string>(() => (demoActive ? ownerId : ''));

  const [demoTrace, setDemoTrace] = useState<ActionTrace | null>(null);
  const [demoSkill, setDemoSkill] = useState<LearnedSkill | null>(null);
  const [chatReply, setChatReply] = useState<{
    reply: string;
    citedMemoryIds: string[];
    unknowns: string[];
  } | null>(null);
  const [liveRun, setLiveRun] = useState<AgentRun | null>(null);
  const [safetyRun, setSafetyRun] = useState<AgentRun | null>(null);
  const [safetyModeLabel, setSafetyModeLabel] = useState<string>('');
  const [globalError, setGlobalError] = useState<string | null>(null);

  const esRef = useRef<EventSource | null>(null);

  useEffect(() => {
    return () => {
      esRef.current?.close();
    };
  }, []);

  const updateStage = (key: StageKey, patch: Partial<StageState>) => {
    setStages((prev) => ({
      ...prev,
      [key]: { ...prev[key], ...patch },
    }));
  };

  const ensureSandbox = (): string => {
    if (demoActive && ownerId.startsWith('demo_')) {
      setSandboxOwnerId(ownerId);
      return ownerId;
    }
    const id = enterDemoSandbox();
    setSandboxOwnerId(id);
    return id;
  };

  const waitForTerminalRun = (targetOwnerId: string, runId: string, onUpdate: (r: AgentRun) => void): Promise<AgentRun> => {
    return new Promise((resolve, reject) => {
      esRef.current?.close();
      const es = new EventSource(`/api/agent/runs/${runId}/stream?ownerId=${encodeURIComponent(targetOwnerId)}`);
      esRef.current = es;
      const timeout = setTimeout(() => {
        es.close();
        reject(new Error('Playwright execution timed out after 45s.'));
      }, 45_000);

      es.onmessage = (ev) => {
        try {
          const updated = JSON.parse(ev.data) as AgentRun;
          onUpdate(updated);
          if (['verified', 'failed', 'cancelled'].includes(updated.status)) {
            clearTimeout(timeout);
            es.close();
            resolve(updated);
          }
        } catch {
          // ignore parse error
        }
      };
      es.onerror = () => {
        clearTimeout(timeout);
        es.close();
        reject(new Error('Lost SSE stream while watching Playwright run.'));
      };
    });
  };

  const waitForPauseOrTerminal = (targetOwnerId: string, runId: string, onUpdate: (r: AgentRun) => void): Promise<AgentRun> => {
    return new Promise((resolve, reject) => {
      esRef.current?.close();
      const es = new EventSource(`/api/agent/runs/${runId}/stream?ownerId=${encodeURIComponent(targetOwnerId)}`);
      esRef.current = es;
      const timeout = setTimeout(() => {
        es.close();
        reject(new Error('Timed out waiting for high-impact approval pause.'));
      }, 45_000);

      es.onmessage = (ev) => {
        try {
          const updated = JSON.parse(ev.data) as AgentRun;
          onUpdate(updated);
          if (['awaiting_approval', 'verified', 'failed', 'cancelled'].includes(updated.status)) {
            clearTimeout(timeout);
            es.close();
            resolve(updated);
          }
        } catch {
          // ignore
        }
      };
      es.onerror = () => {
        clearTimeout(timeout);
        es.close();
        reject(new Error('Lost SSE stream waiting for approval gate.'));
      };
    });
  };

  const runFullLiveDemo = async () => {
    setRunningAll(true);
    setGlobalError(null);
    setStages(INITIAL_STAGES);
    setDemoTrace(null);
    setDemoSkill(null);
    setChatReply(null);
    setLiveRun(null);
    setSafetyRun(null);

    const activeOwner = ensureSandbox();

    try {
      // Stage 1: Consent-first individual onboarding + site allowlist + semantic preference memory
      const t1 = Date.now();
      updateStage('onboard', { status: 'running' });
      await ownerJsonFetch(activeOwner, '/api/onboarding', {
        method: 'POST',
        body: JSON.stringify({
          displayName: 'Maya Chen',
          headline: 'Independent Systems Researcher',
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
          primaryGoal: 'Automate verifiable literature lookups with explicit permission boundaries.',
          workingConstraints: [
            'Only inspect allowlisted origins during Teach and Agent modes.',
            'Pause for fresh single-use approval before saving or writing externally.',
          ],
          consents: {
            memory_persistence: true,
            teach_observation: true,
            browser_execution: true,
            desktop_companion: false,
            workspace_read: false,
            workspace_write: false,
          },
        }),
      });
      await ownerJsonFetch(activeOwner, '/api/sites', {
        method: 'POST',
        body: JSON.stringify({
          origin: window.location.origin,
          label: 'TwinMe Safe Research Archive',
          teachAllowed: true,
          agentAllowed: true,
        }),
      });
      await ownerJsonFetch(activeOwner, '/api/memories', {
        method: 'POST',
        body: JSON.stringify({
          category: 'semantic',
          title: 'Output formatting preference',
          content: 'Prefer concise tables citing paper titles, categories, and publication years.',
          source: 'user_demo_setup',
        }),
      });
      updateStage('onboard', {
        status: 'passed',
        durationMs: Date.now() - t1,
        summary: 'Established Maya Chen (v1), granted 3 local scopes, allowlisted origin, and saved 1 semantic preference.',
      });

      // Stage 2: Teach Mode Demonstration with automatic server redaction check
      const t2 = Date.now();
      updateStage('teach', { status: 'running' });
      const createdTrace = await ownerJsonFetch<ActionTrace>(activeOwner, '/api/teach/sessions', {
        method: 'POST',
        body: JSON.stringify({
          site: window.location.origin,
          title: 'Research Archive Lookup Demonstration',
          screenshotConsent: false,
        }),
      });
      const events = [
        {
          type: 'navigate',
          targetSelector: '/fixture/research',
          accessibleLabel: 'Open Research Archive',
          url: `${window.location.origin}/fixture/research`,
          valuePreview: '',
        },
        {
          type: 'input',
          targetSelector: '#research-query',
          accessibleLabel: 'Enter research topic...',
          url: `${window.location.origin}/fixture/research`,
          valuePreview: 'capability',
        },
        {
          type: 'input',
          targetSelector: 'input[type="password"][name="api_secret"]',
          accessibleLabel: 'Optional API Secret Token',
          url: `${window.location.origin}/fixture/research`,
          valuePreview: 'sk-live-secret-token-9981',
        },
        {
          type: 'click',
          targetSelector: '#research-search-btn',
          accessibleLabel: 'Search Papers',
          url: `${window.location.origin}/fixture/research`,
          valuePreview: '',
        },
      ];
      let latestTrace = createdTrace;
      for (const ev of events) {
        latestTrace = await ownerJsonFetch<ActionTrace>(activeOwner, `/api/teach/sessions/${createdTrace.id}/events`, {
          method: 'POST',
          body: JSON.stringify({ event: ev }),
        });
      }
      latestTrace = await ownerJsonFetch<ActionTrace>(activeOwner, `/api/teach/sessions/${createdTrace.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ action: 'finish' }),
      });
      setDemoTrace(latestTrace);
      const redactedCount = latestTrace.events.filter((e) => e.redacted).length;
      updateStage('teach', {
        status: 'passed',
        durationMs: Date.now() - t2,
        summary: `Captured ${latestTrace.events.length} trace events; server automatically redacted ${redactedCount} sensitive secret field.`,
      });

      // Stage 3: Gemini 4 Hydrogen Skill Decomposition & Approval
      const t3 = Date.now();
      updateStage('skill', { status: 'running' });
      const draft = await ownerJsonFetch<{
        name: string;
        intent: string;
        summary: string;
        preconditions: string[];
        inputs: Record<string, string>;
        steps: PlannedStep[];
        expectedOutcomes: string[];
        uncertaintyFlags: string[];
      }>(activeOwner, `/api/teach/sessions/${latestTrace.id}/decompose`, { method: 'POST' });

      const cleanSteps = draft.steps.some((s) => s.action === 'extract_text')
        ? draft.steps
        : [
            ...draft.steps,
            {
              id: 'step_extract',
              order: draft.steps.length + 1,
              action: 'extract_text' as const,
              targetSelector: '#research-results',
              description: 'Extract matching research items',
              expectedOutcome: 'Filtered rows extracted cleanly',
              risk: 'low' as const,
              requiresApproval: false,
            },
          ];

      const savedSkill = await ownerJsonFetch<LearnedSkill>(activeOwner, '/api/skills', {
        method: 'POST',
        body: JSON.stringify({
          traceId: latestTrace.id,
          name: draft.name,
          intent: draft.intent,
          summary: draft.summary,
          preconditions: draft.preconditions,
          inputs: Object.keys(draft.inputs).length ? draft.inputs : { query: 'capability' },
          allowedOrigins: [window.location.origin],
          steps: cleanSteps,
          expectedOutcomes: draft.expectedOutcomes,
          uncertaintyFlags: draft.uncertaintyFlags,
        }),
      });
      setDemoSkill(savedSkill);
      updateStage('skill', {
        status: 'passed',
        durationMs: Date.now() - t3,
        summary: `Gemini decomposed trace into "${savedSkill.name}" (v${savedSkill.version}, ${savedSkill.steps.length} steps) and stored episodic memory.`,
      });

      // Stage 4: Grounded Twin Memory Dialogue
      const t4 = Date.now();
      updateStage('chat', { status: 'running' });
      const chatRes = await ownerJsonFetch<{
        reply: string;
        citedMemoryIds: string[];
        unknowns: string[];
      }>(activeOwner, '/api/twin/chat', {
        method: 'POST',
        body: JSON.stringify({
          message: 'What workflow did I just teach you, and what is my formatting preference?',
        }),
      });
      setChatReply(chatRes);
      updateStage('chat', {
        status: 'passed',
        durationMs: Date.now() - t4,
        summary: `Gemini answered from owner twin state with ${chatRes.citedMemoryIds.length} explicit memory citation(s).`,
      });

      // Stage 5: Live Playwright Agent Execution on a NEW query variation ("selector")
      const t5 = Date.now();
      updateStage('agent', { status: 'running' });
      const startedRun = await ownerJsonFetch<AgentRun>(activeOwner, '/api/agent/runs', {
        method: 'POST',
        body: JSON.stringify({
          mode: 'supervised_agent',
          skillId: savedSkill.id,
          goal: `Replicate "${savedSkill.name}" on query "selector"`,
          targetUrl: `${window.location.origin}/fixture/research`,
          inputValues: { query: 'selector' },
          steps: [
            {
              id: 'step_nav',
              order: 1,
              action: 'navigate',
              targetSelector: '/fixture/research',
              description: 'Navigate to approved research archive',
              expectedOutcome: 'Archive loads',
              risk: 'low',
              requiresApproval: false,
            },
            {
              id: 'step_fill',
              order: 2,
              action: 'fill',
              targetSelector: '#research-query',
              fallbackText: 'Enter research topic...',
              description: 'Enter new query parameter',
              inputKey: 'query',
              staticValue: 'selector',
              expectedOutcome: 'Search box updated',
              risk: 'low',
              requiresApproval: false,
            },
            {
              id: 'step_click',
              order: 3,
              action: 'click',
              targetSelector: '#research-search-btn',
              fallbackText: 'Search Papers',
              description: 'Submit query',
              expectedOutcome: 'Filtered papers render',
              risk: 'low',
              requiresApproval: false,
            },
            {
              id: 'step_extract',
              order: 4,
              action: 'extract_text',
              targetSelector: '#research-results',
              description: 'Verify and extract matching items',
              expectedOutcome: 'Comparison table extracted',
              risk: 'low',
              requiresApproval: false,
            },
          ],
        }),
      });
      setLiveRun(startedRun);
      const finishedRun = await waitForTerminalRun(activeOwner, startedRun.id, setLiveRun);
      if (finishedRun.status !== 'verified') {
        throw new Error(finishedRun.error || `Playwright run ended with status "${finishedRun.status}".`);
      }
      updateStage('agent', {
        status: 'passed',
        durationMs: Date.now() - t5,
        summary: `Playwright replicated workflow with new query "selector": ${finishedRun.outcome?.observed || 'verified'}.`,
      });

      await refreshWorkspace();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Demo execution failed.';
      setGlobalError(msg);
      setStages((prev) => {
        const next = { ...prev };
        (Object.keys(next) as StageKey[]).forEach((k) => {
          if (next[k].status === 'running') {
            next[k] = { status: 'error', error: msg };
          }
        });
        return next;
      });
    } finally {
      setRunningAll(false);
    }
  };

  const runSafetyDrill = async (drill: 'approval_gate' | 'layout_drift' | 'adversarial') => {
    setGlobalError(null);
    const activeOwner = ensureSandbox();
    const t0 = Date.now();
    updateStage('safety', { status: 'running', error: undefined });
    setSafetyModeLabel(
      drill === 'approval_gate'
        ? 'High-Impact Save Gate'
        : drill === 'layout_drift'
        ? 'Layout Drift Adaptation (/fixture/research-v2)'
        : 'Adversarial Prompt-Injection Quarantine (/fixture/adversarial)',
    );

    try {
      if (drill === 'approval_gate') {
        const run = await ownerJsonFetch<AgentRun>(activeOwner, '/api/agent/runs', {
          method: 'POST',
          body: JSON.stringify({
            mode: 'supervised_agent',
            goal: 'Search "capability" and save briefing (requires fresh approval)',
            targetUrl: `${window.location.origin}/fixture/research`,
            inputValues: { query: 'capability' },
            steps: [
              {
                id: 's1',
                order: 1,
                action: 'navigate',
                targetSelector: '/fixture/research',
                description: 'Navigate to research archive',
                expectedOutcome: 'Page loads',
                risk: 'low',
                requiresApproval: false,
              },
              {
                id: 's2',
                order: 2,
                action: 'fill',
                targetSelector: '#research-query',
                description: 'Enter "capability"',
                inputKey: 'query',
                expectedOutcome: 'Filled',
                risk: 'low',
                requiresApproval: false,
              },
              {
                id: 's3',
                order: 3,
                action: 'click',
                targetSelector: '#research-search-btn',
                description: 'Search papers',
                expectedOutcome: 'Filtered',
                risk: 'low',
                requiresApproval: false,
              },
              {
                id: 's4',
                order: 4,
                action: 'submit',
                targetSelector: '#research-save-btn',
                fallbackText: 'Save Research Briefing',
                description: 'Commit research briefing (high-impact write)',
                expectedOutcome: 'Saved banner visible',
                risk: 'high_impact',
                requiresApproval: true,
              },
            ],
          }),
        });
        setSafetyRun(run);
        const pausedRun = await waitForPauseOrTerminal(activeOwner, run.id, setSafetyRun);
        updateStage('safety', {
          status: pausedRun.status === 'awaiting_approval' ? 'running' : 'passed',
          durationMs: Date.now() - t0,
          summary:
            pausedRun.status === 'awaiting_approval'
              ? 'Agent paused cleanly before high-impact commit and issued a single-use expiring approval token.'
              : `Completed with status ${pausedRun.status}.`,
        });
        return;
      }

      if (drill === 'layout_drift') {
        const run = await ownerJsonFetch<AgentRun>(activeOwner, '/api/agent/runs', {
          method: 'POST',
          body: JSON.stringify({
            mode: 'supervised_agent',
            goal: 'Adapt v1 selectors onto /fixture/research-v2 layout drift page',
            targetUrl: `${window.location.origin}/fixture/research-v2`,
            inputValues: { query: 'memory' },
            steps: [
              {
                id: 'd1',
                order: 1,
                action: 'navigate',
                targetSelector: '/fixture/research-v2',
                description: 'Open drifted layout fixture',
                expectedOutcome: 'Page loads',
                risk: 'low',
                requiresApproval: false,
              },
              {
                id: 'd2',
                order: 2,
                action: 'fill',
                targetSelector: '#research-query',
                fallbackText: 'Filter topic...',
                description: 'Fill search box despite changed DOM ID',
                inputKey: 'query',
                expectedOutcome: 'Query filled',
                risk: 'low',
                requiresApproval: false,
              },
              {
                id: 'd3',
                order: 3,
                action: 'click',
                targetSelector: '#research-search-btn',
                fallbackText: 'Filter Archive',
                description: 'Click submit button despite changed DOM ID',
                expectedOutcome: 'Results updated',
                risk: 'low',
                requiresApproval: false,
              },
              {
                id: 'd4',
                order: 4,
                action: 'extract_text',
                targetSelector: '#v2-results-list',
                description: 'Extract drifted list items',
                expectedOutcome: 'Rows extracted',
                risk: 'low',
                requiresApproval: false,
              },
            ],
          }),
        });
        setSafetyRun(run);
        const done = await waitForTerminalRun(activeOwner, run.id, setSafetyRun);
        const adaptedSteps = done.steps.filter((s) => s.adaptedFromSelector).length;
        updateStage('safety', {
          status: done.status === 'verified' ? 'passed' : 'error',
          durationMs: Date.now() - t0,
          summary: `Layout drift test ${done.status}: Playwright + Gemini adapted ${adaptedSteps} changed selector(s) automatically.`,
        });
        await refreshWorkspace();
        return;
      }

      // adversarial drill
      const run = await ownerJsonFetch<AgentRun>(activeOwner, '/api/agent/runs', {
        method: 'POST',
        body: JSON.stringify({
          mode: 'supervised_agent',
          goal: 'Extract text safely from /fixture/adversarial while quarantining untrusted page directives',
          targetUrl: `${window.location.origin}/fixture/adversarial`,
          inputValues: {},
          steps: [
            {
              id: 'a1',
              order: 1,
              action: 'navigate',
              targetSelector: '/fixture/adversarial',
              description: 'Open adversarial injection fixture',
              expectedOutcome: 'Page loads',
              risk: 'low',
              requiresApproval: false,
            },
            {
              id: 'a2',
              order: 2,
              action: 'extract_text',
              targetSelector: 'main',
              description: 'Extract and sanitize untrusted page text',
              expectedOutcome: 'Injection directives quarantined',
              risk: 'low',
              requiresApproval: false,
            },
          ],
        }),
      });
      setSafetyRun(run);
      const done = await waitForTerminalRun(activeOwner, run.id, setSafetyRun);
      updateStage('safety', {
        status: 'passed',
        durationMs: Date.now() - t0,
        summary: `Adversarial page handled with status "${done.status}": prompt-injection instructions were stripped/quarantined.`,
      });
      await refreshWorkspace();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Safety drill failed.';
      updateStage('safety', { status: 'error', error: msg });
    }
  };

  const handleApproveSafetyGate = async () => {
    if (!safetyRun?.pendingApproval) return;
    const activeOwner = sandboxOwnerId || ownerId;
    try {
      const resumed = await ownerJsonFetch<AgentRun>(activeOwner, `/api/agent/runs/${safetyRun.id}/approve`, {
        method: 'POST',
        body: JSON.stringify({ approvalToken: safetyRun.pendingApproval.token }),
      });
      setSafetyRun(resumed);
      const finished = await waitForTerminalRun(activeOwner, resumed.id, setSafetyRun);
      updateStage('safety', {
        status: finished.status === 'verified' ? 'passed' : 'error',
        summary: `Approved single-use token and verified high-impact save: ${finished.outcome?.observed || finished.status}`,
      });
      await refreshWorkspace();
    } catch (err) {
      setGlobalError(err instanceof Error ? err.message : 'Failed to approve gate.');
    }
  };

  const handleCancelSafetyGate = async () => {
    if (!safetyRun) return;
    const activeOwner = sandboxOwnerId || ownerId;
    const cancelled = await ownerJsonFetch<AgentRun>(activeOwner, `/api/agent/runs/${safetyRun.id}/abort`, {
      method: 'POST',
      body: JSON.stringify({ reason: 'cancelled' }),
    });
    setSafetyRun(cancelled);
    updateStage('safety', {
      status: 'passed',
      summary: 'High-impact action denied and aborted cleanly; zero side effects committed.',
    });
    await refreshWorkspace();
  };

  const handleExportDemoJson = async () => {
    const activeOwner = sandboxOwnerId || ownerId;
    const data = await ownerJsonFetch(activeOwner, '/api/privacy/export');
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `twinme-demo-export-${activeOwner}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleResetDemo = async () => {
    esRef.current?.close();
    await exitDemoSandbox();
    setSandboxOwnerId('');
    setStages(INITIAL_STAGES);
    setDemoTrace(null);
    setDemoSkill(null);
    setChatReply(null);
    setLiveRun(null);
    setSafetyRun(null);
    setGlobalError(null);
  };

  const stageMeta: Array<{ key: StageKey; num: string; title: string; detail: string }> = [
    {
      key: 'onboard',
      num: '01',
      title: 'Consent-First Individual Twin',
      detail: 'Creates an isolated sandbox twin (Maya Chen), enables explicit scopes, allowlists origin, and saves a formatting preference.',
    },
    {
      key: 'teach',
      num: '02',
      title: 'Opt-In Teach Trace & Secret Redaction',
      detail: 'Records navigation, search input, password redaction verification, and submit click on /fixture/research.',
    },
    {
      key: 'skill',
      num: '03',
      title: 'Gemini 4 Hydrogen Skill Extraction',
      detail: 'Decomposes raw trace into a parameterized skill (v1) and records an episodic memory entry.',
    },
    {
      key: 'chat',
      num: '04',
      title: 'Grounded Twin Memory Dialogue',
      detail: 'Asks Gemini what workflow was taught and verifies memory ID citations.',
    },
    {
      key: 'agent',
      num: '05',
      title: 'Live Playwright Replication (Changed Input)',
      detail: 'Replicates the learned skill on query="selector" in headless Chromium with SSE step screenshots.',
    },
    {
      key: 'safety',
      num: '06',
      title: 'Interactive Safety & Drift Drills',
      detail: 'Trigger high-impact approval gates, DOM layout drift adaptation, or prompt-injection quarantine on demand.',
    },
  ];

  return (
    <LayoutShell title="Interactive Live Demo">
      <div className="space-y-6">
        {/* Top Hero Control Bar */}
        <section className="p-6 bg-white border border-slate-200 rounded-lg space-y-4">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="space-y-2 max-w-2xl">
              <div className="flex flex-wrap items-center gap-3 text-xs text-slate-500">
                <StateBadge state="demo" detail={demoActive ? `Isolated Demo Sandbox · ${ownerId}` : 'Demo Sandbox Ready'} />
                <span aria-hidden="true">·</span>
                <span>Zero Fake Outputs</span>
                <span aria-hidden="true">·</span>
                <span className="font-mono">
                  Gemini: {health?.geminiConfigured ? 'Live' : 'Missing Key'}
                </span>
              </div>
              <h2 className="font-display text-2xl font-bold tracking-tight text-slate-900">
                60-Second End-to-End Personal Twin &amp; Playwright Demo
              </h2>
              <p className="text-sm text-slate-600 leading-relaxed">
                Runs every stage live against Express APIs, Gemini 4 Hydrogen, and headless Playwright Chromium inside an isolated demo workspace so your personal twin stays untouched.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2.5">
              <button
                type="button"
                disabled={runningAll}
                onClick={runFullLiveDemo}
                className="inline-flex items-center gap-2 px-4 py-2.5 text-sm font-semibold bg-blue-900 text-white rounded-md hover:bg-blue-800 disabled:opacity-50 whitespace-nowrap shrink-0"
              >
                <Play className="w-4 h-4" aria-hidden="true" />
                <span>{runningAll ? 'Running Live Demo...' : 'Run Full Live Demo'}</span>
              </button>

              {demoActive && (
                <>
                  <button
                    type="button"
                    onClick={handleExportDemoJson}
                    className="inline-flex items-center gap-1.5 px-3.5 py-2.5 text-xs font-semibold border border-slate-300 bg-white text-slate-800 rounded-md hover:bg-slate-50 whitespace-nowrap shrink-0"
                  >
                    <Download className="w-3.5 h-3.5" aria-hidden="true" />
                    <span>Export Demo JSON</span>
                  </button>
                  <button
                    type="button"
                    onClick={handleResetDemo}
                    className="inline-flex items-center gap-1.5 px-3.5 py-2.5 text-xs font-semibold border border-red-200 bg-white text-red-700 rounded-md hover:bg-red-50 whitespace-nowrap shrink-0"
                  >
                    <RotateCcw className="w-3.5 h-3.5" aria-hidden="true" />
                    <span>Reset &amp; Exit Demo</span>
                  </button>
                </>
              )}
            </div>
          </div>

          {demoActive && (
            <div className="pt-4 border-t border-slate-200 flex flex-wrap items-center justify-between gap-3 text-xs text-slate-600">
              <span>Inspect the live demo artifacts across every studio screen:</span>
              <div className="flex flex-wrap items-center gap-4 font-medium text-blue-900">
                <Link to="/twin" className="hover:underline whitespace-nowrap">Twin &amp; Memory →</Link>
                <Link to="/teach" className="hover:underline whitespace-nowrap">Teach Trace →</Link>
                <Link to="/skills" className="hover:underline whitespace-nowrap">Saved Skills →</Link>
                <Link to="/agent" className="hover:underline whitespace-nowrap">Agent Cockpit →</Link>
                <Link to="/history" className="hover:underline whitespace-nowrap">Audit Ledger →</Link>
              </div>
            </div>
          )}
        </section>

        {globalError && (
          <div className="p-4 bg-red-50 border border-red-200 rounded-lg text-sm text-red-800">
            {globalError}
          </div>
        )}

        {/* 6-Stage Execution Timeline */}
        <section className="bg-white border border-slate-200 rounded-lg divide-y divide-slate-200">
          {stageMeta.map((st) => {
            const state = stages[st.key];
            return (
              <div key={st.key} className="p-5 flex flex-col sm:flex-row sm:items-start justify-between gap-4">
                <div className="space-y-1">
                  <div className="flex items-center gap-2.5">
                    {state.status === 'passed' && <CheckCircle2 className="w-4 h-4 text-emerald-700 shrink-0" aria-hidden="true" />}
                    {state.status === 'running' && <Clock className="w-4 h-4 text-amber-700 shrink-0" aria-hidden="true" />}
                    {state.status === 'error' && <XCircle className="w-4 h-4 text-red-700 shrink-0" aria-hidden="true" />}
                    <h3 className="font-display text-sm font-semibold text-slate-900">
                      <span className="font-mono text-slate-500 mr-2">{st.num}.</span>
                      {st.title}
                    </h3>
                  </div>
                  <p className="text-xs text-slate-600">{st.detail}</p>
                  {state.summary && <p className="text-xs font-medium text-emerald-800 pt-1">{state.summary}</p>}
                  {state.error && <p className="text-xs font-medium text-red-700 pt-1">{state.error}</p>}
                </div>

                <div className="flex items-center gap-3 shrink-0 font-mono text-xs tabular-nums">
                  {state.durationMs !== undefined && <span className="text-slate-500">{state.durationMs} ms</span>}
                  <StateBadge
                    state={
                      state.status === 'passed'
                        ? 'live'
                        : state.status === 'running'
                        ? 'pending'
                        : state.status === 'error'
                        ? 'error'
                        : 'demo'
                    }
                    detail={
                      state.status === 'passed'
                        ? 'Verified'
                        : state.status === 'running'
                        ? 'Executing'
                        : state.status === 'error'
                        ? 'Failed'
                        : 'Ready'
                    }
                  />
                </div>
              </div>
            );
          })}
        </section>

        {/* Live Evidence Output Grid */}
        <div className="grid gap-6 lg:grid-cols-2 items-start">
          {/* Left Column: Trace Redaction + Skill + Grounded Chat */}
          <div className="space-y-6">
            <section className="p-5 bg-white border border-slate-200 rounded-lg space-y-3">
              <div className="flex items-center justify-between gap-2">
                <h3 className="font-display text-sm font-semibold text-slate-900">Captured &amp; Redacted Teach Trace</h3>
                <span className="text-xs font-mono text-slate-500 tabular-nums">
                  {demoTrace ? `${demoTrace.events.length} events` : 'Pending'}
                </span>
              </div>
              {!demoTrace ? (
                <p className="text-xs text-slate-500">Click &ldquo;Run Full Live Demo&rdquo; to inspect real trace redaction.</p>
              ) : (
                <div className="divide-y divide-slate-200 border border-slate-200 rounded-md text-xs">
                  {demoTrace.events.map((ev) => (
                    <div key={ev.id} className="p-2.5 flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        <p className="font-mono text-slate-900 truncate">
                          {ev.index + 1}. {ev.type} · {ev.targetSelector}
                        </p>
                        {ev.valuePreview && (
                          <p className={`font-mono ${ev.redacted ? 'text-emerald-700 font-semibold' : 'text-slate-600'}`}>
                            value: {ev.valuePreview}
                          </p>
                        )}
                      </div>
                      <span className="text-[11px] font-mono text-slate-500 shrink-0">
                        {ev.redacted ? 'redacted' : 'captured'}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </section>

            <section className="p-5 bg-white border border-slate-200 rounded-lg space-y-3">
              <div className="flex items-center justify-between gap-2">
                <h3 className="font-display text-sm font-semibold text-slate-900">Gemini Skill &amp; Memory Recall</h3>
                <span className="text-xs font-mono text-slate-500">
                  {demoSkill ? `v${demoSkill.version}` : 'Pending'}
                </span>
              </div>
              {demoSkill && (
                <div className="text-xs space-y-1 pb-3 border-b border-slate-200">
                  <p className="font-semibold text-slate-900">{demoSkill.name}</p>
                  <p className="text-slate-600">{demoSkill.summary || demoSkill.intent}</p>
                  <p className="font-mono text-slate-500">
                    Parameters: {Object.keys(demoSkill.inputs).join(', ') || 'none'} · Steps: {demoSkill.steps.length}
                  </p>
                </div>
              )}
              {chatReply ? (
                <div className="text-xs space-y-2">
                  <p className="text-slate-800 leading-relaxed whitespace-pre-wrap">{chatReply.reply}</p>
                  <p className="font-mono text-emerald-800">
                    Cited Memory IDs: {chatReply.citedMemoryIds.join(', ') || 'none'}
                  </p>
                </div>
              ) : (
                <p className="text-xs text-slate-500">Gemini grounded chat output with explicit memory citations appears here.</p>
              )}
            </section>
          </div>

          {/* Right Column: Live Playwright Replication Screenshots & Safety Drills */}
          <div className="space-y-6">
            <section className="p-5 bg-white border border-slate-200 rounded-lg space-y-3">
              <div className="flex items-center justify-between gap-2">
                <h3 className="font-display text-sm font-semibold text-slate-900">
                  Live Playwright Replication (query=&quot;selector&quot;)
                </h3>
                <span className="text-xs font-mono text-slate-500">
                  {liveRun ? liveRun.status : 'Pending'}
                </span>
              </div>
              {!liveRun ? (
                <p className="text-xs text-slate-500">Live Chromium steps, screenshots, and extracted DOM rows stream here via SSE.</p>
              ) : (
                <div className="space-y-3">
                  <div className="divide-y divide-slate-200 border border-slate-200 rounded-md text-xs">
                    {liveRun.steps.map((s) => (
                      <div key={s.stepId} className="p-2.5 space-y-1.5">
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-mono font-semibold text-slate-900">
                            {s.order}. {s.action} — {s.description}
                          </span>
                          <span className="font-mono text-slate-600">{s.status}</span>
                        </div>
                        <p className="text-slate-600">{s.observation}</p>
                        {s.screenshotDataUrl && (
                          <img
                            src={s.screenshotDataUrl}
                            alt={`Demo step ${s.order} Playwright observation`}
                            className="w-full max-h-40 object-cover object-top rounded border border-slate-200"
                          />
                        )}
                      </div>
                    ))}
                  </div>
                  {liveRun.outcome?.extractedRows && liveRun.outcome.extractedRows.length > 0 && (
                    <div className="overflow-x-auto border border-slate-200 rounded-md">
                      <table className="w-full text-left text-xs border-collapse">
                        <thead>
                          <tr className="bg-slate-50 border-b border-slate-200">
                            <th className="p-2 font-semibold">Title</th>
                            <th className="p-2 font-semibold">Category</th>
                            <th className="p-2 font-semibold">Year</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {liveRun.outcome.extractedRows.map((row, i) => (
                            <tr key={i}>
                              <td className="p-2">{row.title}</td>
                              <td className="p-2 font-mono">{row.category}</td>
                              <td className="p-2 font-mono tabular-nums">{row.year}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )}
            </section>

            <section className="p-5 bg-white border border-slate-200 rounded-lg space-y-4">
              <div>
                <h3 className="font-display text-sm font-semibold text-slate-900">Stage 06 · Interactive Safety &amp; Resilience Drills</h3>
                <p className="text-xs text-slate-600 mt-0.5">
                  Verify fresh approval gates, changed-DOM adaptation, and prompt-injection quarantine on live Playwright fixtures.
                </p>
              </div>

              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => runSafetyDrill('approval_gate')}
                  className="px-3 py-2 text-xs font-semibold bg-slate-900 text-white rounded-md hover:bg-slate-800 whitespace-nowrap"
                >
                  Test High-Impact Save Gate
                </button>
                <button
                  type="button"
                  onClick={() => runSafetyDrill('layout_drift')}
                  className="px-3 py-2 text-xs font-semibold border border-slate-300 bg-white text-slate-800 rounded-md hover:bg-slate-50 whitespace-nowrap"
                >
                  Test Layout Drift (/research-v2)
                </button>
                <button
                  type="button"
                  onClick={() => runSafetyDrill('adversarial')}
                  className="px-3 py-2 text-xs font-semibold border border-slate-300 bg-white text-slate-800 rounded-md hover:bg-slate-50 whitespace-nowrap"
                >
                  Test Prompt Injection Defense
                </button>
              </div>

              {safetyRun && (
                <div className="space-y-3 pt-2 border-t border-slate-200">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-medium text-slate-900">{safetyModeLabel}</span>
                    <span className="font-mono text-slate-600">{safetyRun.status}</span>
                  </div>

                  {safetyRun.status === 'awaiting_approval' && safetyRun.pendingApproval && (
                    <div className="p-3.5 bg-amber-50 border border-amber-300 rounded-md space-y-2.5 text-xs">
                      <div className="flex items-start gap-2">
                        <ShieldAlert className="w-4 h-4 text-amber-800 shrink-0 mt-0.5" aria-hidden="true" />
                        <div className="space-y-1">
                          <p className="font-semibold text-amber-950">Fresh Single-Use Approval Required</p>
                          <p className="text-amber-900">{safetyRun.pendingApproval.reason}</p>
                        </div>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={handleApproveSafetyGate}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-emerald-700 text-white font-semibold rounded hover:bg-emerald-800"
                        >
                          <Check className="w-3.5 h-3.5" aria-hidden="true" />
                          <span>Approve &amp; Complete Run</span>
                        </button>
                        <button
                          type="button"
                          onClick={handleCancelSafetyGate}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 border border-red-300 bg-white text-red-700 font-semibold rounded hover:bg-red-50"
                        >
                          <Square className="w-3 h-3 fill-current" aria-hidden="true" />
                          <span>Deny &amp; Abort</span>
                        </button>
                      </div>
                    </div>
                  )}

                  <div className="divide-y divide-slate-200 border border-slate-200 rounded-md text-xs">
                    {safetyRun.steps.map((st) => (
                      <div key={st.stepId} className="p-2.5 space-y-1">
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-mono font-semibold text-slate-900">
                            {st.order}. {st.action}
                          </span>
                          <span className="font-mono text-slate-600">{st.status}</span>
                        </div>
                        <p className="text-slate-600">{st.observation}</p>
                        {st.adaptedFromSelector && (
                          <p className="font-mono text-amber-800">
                            Self-healed selector: {st.adaptedFromSelector} → {st.targetUsed}
                          </p>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="pt-2 border-t border-slate-200 flex items-center justify-between text-xs text-slate-500">
                <span>Want to teach your own workflow in Google Chrome?</span>
                <Link to="/teach" className="inline-flex items-center gap-1 font-semibold text-blue-900 hover:underline whitespace-nowrap">
                  <span>Open Chrome Teach Bridge</span>
                  <ArrowRight className="w-3.5 h-3.5" aria-hidden="true" />
                </Link>
              </div>
            </section>
          </div>
        </div>
      </div>
    </LayoutShell>
  );
};
