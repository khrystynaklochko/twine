import React, { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Play, Pause, Square, ShieldAlert, Check, Wrench, Laptop, FileText } from 'lucide-react';
import { LayoutShell } from '../components/LayoutShell';
import { StateBadge } from '../components/StateBadge';
import { useTwin } from '../context/TwinContext';
import type { AgentRun, PlannedStep, RunMode } from '../types/twin';

export const AgentCockpitPage: React.FC = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const routeState = (location.state || {}) as { skillId?: string; inputValues?: Record<string, string> };

  const { ownerId, workspace, apiFetch, setRunMode, toggleConsent, grantSite, refreshWorkspace } = useTwin();

  const [selectedSkillId, setSelectedSkillId] = useState<string>(routeState.skillId || '');
  const [goal, setGoal] = useState('Search the approved research archive for capability tokens and extract matching results.');
  const [targetPath, setTargetPath] = useState('/fixture/research');
  const [inputValues, setInputValues] = useState<Record<string, string>>(routeState.inputValues || { query: 'capability' });
  const [plannedSteps, setPlannedSteps] = useState<PlannedStep[] | null>(null);
  const [activeRun, setActiveRun] = useState<AgentRun | null>(null);
  const [planning, setPlanning] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Step correction form (OBS-007)
  const [correctStepId, setCorrectStepId] = useState<string | null>(null);
  const [correctedSelector, setCorrectedSelector] = useState('');
  const [correctionReason, setCorrectionReason] = useState('Selector updated after layout observation.');

  // Local doc summarizer (INT-005)
  const [docTitle, setDocTitle] = useState('Weekly Research Notes');
  const [docBody, setDocBody] = useState('');
  const [docSummary, setDocSummary] = useState<{ summary: string; keyPoints: string[] } | null>(null);

  // macOS companion modal/drawer state
  const [showMacInfo, setShowMacInfo] = useState(false);

  const selectedSkill = workspace?.skills.find((s) => s.id === selectedSkillId);
  const activeMode: RunMode = workspace?.activeMode ?? 'twin';
  const browserConsent = workspace?.consents.find((c) => c.scope === 'browser_execution')?.granted;
  const originGranted = workspace?.siteGrants.some((g) => g.origin === window.location.origin && g.agentAllowed);

  useEffect(() => {
    if (selectedSkill && !plannedSteps) {
      setPlannedSteps(selectedSkill.steps);
      setGoal(selectedSkill.intent || selectedSkill.name);
      if (Object.keys(inputValues).length === 0) {
        setInputValues(selectedSkill.inputs);
      }
    }
  }, [selectedSkill]);

  // Connect SSE stream when an activeRun is pending/running/awaiting_approval
  useEffect(() => {
    if (!activeRun) return;
    if (['verified', 'failed', 'cancelled'].includes(activeRun.status)) return;

    const es = new EventSource(`/api/agent/runs/${activeRun.id}/stream?ownerId=${encodeURIComponent(ownerId)}`);
    es.onmessage = (ev) => {
      try {
        const updated = JSON.parse(ev.data) as AgentRun;
        setActiveRun(updated);
        if (['verified', 'failed', 'cancelled'].includes(updated.status)) {
          es.close();
          void refreshWorkspace();
        }
      } catch {
        // ignore parse errors
      }
    };
    es.onerror = () => {
      es.close();
    };
    return () => es.close();
  }, [activeRun?.id, activeRun?.status, ownerId]);

  const handleEnableBrowserAgent = async () => {
    setErrorMsg(null);
    try {
      await toggleConsent('browser_execution', true);
      await grantSite(window.location.origin, 'Safe Research Fixture', true, true);
      await setRunMode('supervised_agent');
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to enable supervised agent.');
    }
  };

  const handlePlanGoal = async () => {
    setPlanning(true);
    setErrorMsg(null);
    try {
      const plan = await apiFetch<{
        inScope: boolean;
        outOfScopeReason?: string;
        selectedSkillId?: string;
        targetUrl: string;
        steps: PlannedStep[];
      }>('/api/agent/plan', {
        method: 'POST',
        body: JSON.stringify({
          goal,
          skillId: selectedSkillId || undefined,
          inputOverrides: inputValues,
        }),
      });
      if (!plan.inScope) {
        setErrorMsg(`Planner blocked out-of-scope request: ${plan.outOfScopeReason}`);
        setPlannedSteps(null);
        return;
      }
      setPlannedSteps(plan.steps);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Planning failed.');
    } finally {
      setPlanning(false);
    }
  };

  const buildDefaultResearchSteps = (includeHighImpactSubmit = false): PlannedStep[] => {
    const steps: PlannedStep[] = [
      {
        id: 'step_nav',
        order: 1,
        action: 'navigate',
        targetSelector: targetPath,
        description: `Navigate to ${targetPath}`,
        expectedOutcome: 'Archive page loads with search controls',
        risk: 'low',
        requiresApproval: false,
      },
      {
        id: 'step_query',
        order: 2,
        action: 'fill',
        targetSelector: '#research-query',
        fallbackText: 'Enter research topic...',
        description: 'Enter search query',
        inputKey: 'query',
        staticValue: inputValues.query || 'capability',
        expectedOutcome: 'Search input contains query',
        risk: 'low',
        requiresApproval: false,
      },
      {
        id: 'step_click',
        order: 3,
        action: 'click',
        targetSelector: '#research-search-btn',
        fallbackText: 'Search Papers',
        description: 'Submit search query',
        expectedOutcome: 'Filtered research papers render',
        risk: 'low',
        requiresApproval: false,
      },
      {
        id: 'step_extract',
        order: 4,
        action: 'extract_text',
        targetSelector: '#research-results',
        description: 'Extract matching research items and verify API status',
        expectedOutcome: 'Structured comparison rows extracted',
        risk: 'low',
        requiresApproval: false,
      },
    ];
    if (includeHighImpactSubmit) {
      steps.push({
        id: 'step_submit',
        order: 5,
        action: 'submit',
        targetSelector: '#research-save-btn',
        fallbackText: 'Save Research Briefing',
        description: 'Commit research briefing (high-impact write)',
        expectedOutcome: 'Briefing save confirmation banner visible',
        risk: 'high_impact',
        requiresApproval: true,
      });
    }
    return steps;
  };

  const handleStartRun = async (runModeOverride?: RunMode, customSteps?: PlannedStep[]) => {
    setErrorMsg(null);
    const modeToUse = runModeOverride || (activeMode === 'twin' ? 'supervised_agent' : activeMode);
    const stepsToUse = customSteps || plannedSteps || selectedSkill?.steps || buildDefaultResearchSteps(false);

    const firstNav = stepsToUse.find((s) => s.action === 'navigate')?.targetSelector;
    const isExternalSkill = Boolean(
      selectedSkill &&
        firstNav &&
        firstNav.startsWith('http') &&
        !firstNav.includes('/fixture/'),
    );

    const normalizedSteps = isExternalSkill
      ? stepsToUse
      : stepsToUse.map((s, idx) =>
          idx === 0 && s.action === 'navigate' && targetPath.startsWith('/fixture')
            ? { ...s, targetSelector: targetPath }
            : s,
        );

    const effectiveTargetUrl = isExternalSkill
      ? firstNav!
      : `${window.location.origin}${targetPath}`;

    try {
      const run = await apiFetch<AgentRun>('/api/agent/runs', {
        method: 'POST',
        body: JSON.stringify({
          mode: modeToUse,
          skillId: selectedSkillId || undefined,
          goal,
          targetUrl: effectiveTargetUrl,
          inputValues,
          steps: normalizedSteps,
        }),
      });
      setActiveRun(run);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Unable to start run.');
    }
  };

  const handleApprovePending = async () => {
    if (!activeRun?.pendingApproval) return;
    setErrorMsg(null);
    try {
      const updated = await apiFetch<AgentRun>(`/api/agent/runs/${activeRun.id}/approve`, {
        method: 'POST',
        body: JSON.stringify({ approvalToken: activeRun.pendingApproval.token }),
      });
      setActiveRun(updated);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Approval rejected.');
    }
  };

  const handleAbortRun = async (reason: 'paused' | 'cancelled') => {
    if (!activeRun) return;
    const updated = await apiFetch<AgentRun>(`/api/agent/runs/${activeRun.id}/abort`, {
      method: 'POST',
      body: JSON.stringify({ reason }),
    });
    setActiveRun(updated);
    await refreshWorkspace();
  };

  const handleSubmitCorrection = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedSkillId || !correctStepId) return;
    setErrorMsg(null);
    try {
      await apiFetch(`/api/skills/${selectedSkillId}/corrections`, {
        method: 'POST',
        body: JSON.stringify({
          stepId: correctStepId,
          reason: correctionReason,
          updatedStep: { targetSelector: correctedSelector },
        }),
      });
      setCorrectStepId(null);
      await refreshWorkspace();
      navigate('/skills');
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Could not propose correction.');
    }
  };

  const handleSummarizeDoc = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    try {
      const res = await apiFetch<{ summary: string; keyPoints: string[] }>('/api/tools/summarize-doc', {
        method: 'POST',
        body: JSON.stringify({ title: docTitle, text: docBody }),
      });
      setDocSummary(res);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Document summarization failed.');
    }
  };

  return (
    <LayoutShell title="Agent Execution Cockpit">
      <div className="space-y-6">
        {/* Mode Switcher Bar (AGENT-001) */}
        <section className="p-5 bg-white border border-slate-200 rounded-lg flex flex-wrap items-center justify-between gap-4">
          <div>
            <h2 className="font-display text-sm font-semibold text-slate-900">Twin-to-Agent State Machine</h2>
            <p className="text-xs text-slate-500">All modes share your personal memory and skills; actions enforce Permission Broker policies.</p>
          </div>

          <div className="flex flex-wrap items-center gap-1 p-1 bg-slate-100 rounded-md">
            {(['twin', 'shadow', 'supervised_agent', 'paused'] as RunMode[]).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setRunMode(m).catch((e) => setErrorMsg(e.message))}
                className={`px-3 py-1.5 text-xs font-medium rounded whitespace-nowrap transition-colors ${
                  activeMode === m ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {m === 'twin'
                  ? 'Twin Only'
                  : m === 'shadow'
                  ? 'Shadow Simulation'
                  : m === 'supervised_agent'
                  ? 'Supervised Agent'
                  : 'Paused'}
              </button>
            ))}
          </div>
        </section>

        {(!browserConsent || !originGranted) && (
          <div className="p-4 bg-blue-50 border border-blue-200 rounded-lg flex flex-wrap items-center justify-between gap-3 text-sm">
            <p className="text-blue-950">
              To run real Playwright browser automation on <span className="font-mono">{window.location.origin}</span>, grant <code>browser_execution</code> and allowlist this origin.
            </p>
            <button
              type="button"
              onClick={handleEnableBrowserAgent}
              className="px-3.5 py-2 text-xs font-semibold bg-blue-900 text-white rounded-md hover:bg-blue-800 whitespace-nowrap"
            >
              Enable Supervised Browser Agent
            </button>
          </div>
        )}

        {errorMsg && (
          <div className="p-3.5 bg-red-50 border border-red-200 rounded-md text-sm text-red-800">
            {errorMsg}
          </div>
        )}

        {/* Main Execution Split */}
        <div className="grid gap-6 lg:grid-cols-[0.95fr_1.05fr] items-start">
          {/* Left: Goal, Skill, Parameters & Launch */}
          <section className="p-6 bg-white border border-slate-200 rounded-lg space-y-4">
            <h2 className="font-display text-base font-semibold text-slate-900">1. Configure Task &amp; Target</h2>

            <label className="block text-xs space-y-1">
              <span className="font-medium text-slate-700">Select Saved Learned Skill (optional)</span>
              <select
                value={selectedSkillId}
                onChange={(e) => {
                  const id = e.target.value;
                  setSelectedSkillId(id);
                  const found = workspace?.skills.find((s) => s.id === id);
                  if (found) {
                    setPlannedSteps(found.steps);
                    setInputValues(found.inputs);
                    setGoal(found.intent || found.name);
                  } else {
                    setPlannedSteps(null);
                  }
                }}
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md bg-white"
              >
                <option value="">-- Custom / Guided Workflow --</option>
                {(workspace?.skills || []).map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name} (v{s.version})
                  </option>
                ))}
              </select>
            </label>

            <label className="block text-xs space-y-1">
              <span className="font-medium text-slate-700">Natural-Language Goal</span>
              <textarea
                rows={2}
                value={goal}
                onChange={(e) => setGoal(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md"
              />
            </label>

            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block text-xs space-y-1">
                <span className="font-medium text-slate-700">Target Fixture Page</span>
                <select
                  value={targetPath}
                  onChange={(e) => setTargetPath(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md bg-white font-mono"
                >
                  <option value="/fixture/research">/fixture/research (Standard)</option>
                  <option value="/fixture/research-v2">/fixture/research-v2 (Layout Drift)</option>
                  <option value="/fixture/adversarial">/fixture/adversarial (Prompt Injection)</option>
                </select>
              </label>

              <label className="block text-xs space-y-1">
                <span className="font-medium text-slate-700">Query Parameter</span>
                <input
                  value={inputValues.query ?? ''}
                  onChange={(e) => setInputValues({ ...inputValues, query: e.target.value })}
                  placeholder="e.g. selector, memory, capability"
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md"
                />
              </label>
            </div>

            <div className="flex flex-wrap gap-2 pt-2">
              <button
                type="button"
                disabled={planning}
                onClick={handlePlanGoal}
                className="px-3.5 py-2 text-xs font-semibold border border-slate-300 rounded-md hover:bg-slate-50"
              >
                {planning ? 'Planning...' : 'Plan with Gemini'}
              </button>
              <button
                type="button"
                onClick={() => handleStartRun('shadow')}
                className="px-3.5 py-2 text-xs font-semibold border border-amber-300 bg-amber-50 text-amber-900 rounded-md hover:bg-amber-100"
              >
                Run Shadow Simulation
              </button>
              <button
                type="button"
                onClick={() => handleStartRun('supervised_agent')}
                className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold bg-blue-900 text-white rounded-md hover:bg-blue-800"
              >
                <Play className="w-3.5 h-3.5" aria-hidden="true" />
                <span>Execute Live Playwright Run</span>
              </button>
              <button
                type="button"
                onClick={() => handleStartRun('supervised_agent', buildDefaultResearchSteps(true))}
                className="px-3.5 py-2 text-xs font-semibold border border-slate-300 rounded-md hover:bg-slate-50"
              >
                Run With High-Impact Save Gate
              </button>
            </div>

            {plannedSteps && (
              <div className="pt-3 border-t border-slate-200 space-y-2">
                <p className="text-xs font-semibold text-slate-700">Planned Action Graph ({plannedSteps.length} steps)</p>
                <ol className="divide-y divide-slate-100 border border-slate-200 rounded-md text-xs">
                  {plannedSteps.map((s) => (
                    <li key={s.id} className="p-2.5 flex items-center justify-between gap-2">
                      <span>
                        <span className="font-mono font-semibold">{s.order}. {s.action}</span>{' '}
                        <span className="text-slate-600">{s.description}</span>
                      </span>
                      <span className="font-mono text-slate-500">{s.requiresApproval ? 'approval_required' : s.risk}</span>
                    </li>
                  ))}
                </ol>
              </div>
            )}
          </section>

          {/* Right: Live Action Cockpit (AGENT-010, AGENT-009, AGENT-011, AGENT-013) */}
          <section className="p-6 bg-white border border-slate-200 rounded-lg space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="font-display text-base font-semibold text-slate-900">2. Live Action Cockpit</h2>
                <p className="text-xs text-slate-500 font-mono">
                  {activeRun ? `${activeRun.id} · mode=${activeRun.mode} · status=${activeRun.status}` : 'Idle — start a shadow or live run'}
                </p>
              </div>
              {activeRun && ['running', 'pending', 'awaiting_approval'].includes(activeRun.status) && (
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => handleAbortRun('paused')}
                    className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold border border-amber-300 bg-amber-50 text-amber-900 rounded"
                  >
                    <Pause className="w-3.5 h-3.5" /> Pause
                  </button>
                  <button
                    type="button"
                    onClick={() => handleAbortRun('cancelled')}
                    className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold bg-red-700 text-white rounded"
                  >
                    <Square className="w-3.5 h-3.5 fill-current" /> Emergency Stop
                  </button>
                </div>
              )}
            </div>

            {/* Fresh Approval Gate (AGENT-009) */}
            {activeRun?.status === 'awaiting_approval' && activeRun.pendingApproval && (
              <div className="p-4 bg-amber-50 border border-amber-300 rounded-lg space-y-3">
                <div className="flex items-start gap-2.5">
                  <ShieldAlert className="w-5 h-5 text-amber-800 shrink-0 mt-0.5" aria-hidden="true" />
                  <div className="space-y-1 text-xs">
                    <p className="font-semibold text-amber-950">Fresh Scoped Approval Required</p>
                    <p className="text-amber-900">{activeRun.pendingApproval.reason}</p>
                    <p className="font-mono text-amber-800">
                      Origin: {activeRun.pendingApproval.targetOrigin} · Token expires: {new Date(activeRun.pendingApproval.expiresAt).toLocaleTimeString()}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={handleApprovePending}
                    className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold bg-emerald-700 text-white rounded hover:bg-emerald-800"
                  >
                    <Check className="w-3.5 h-3.5" /> Approve &amp; Resume
                  </button>
                  <button
                    type="button"
                    onClick={() => handleAbortRun('cancelled')}
                    className="px-3.5 py-1.5 text-xs font-semibold border border-red-300 bg-white text-red-700 rounded hover:bg-red-50"
                  >
                    Deny &amp; Cancel Run
                  </button>
                </div>
              </div>
            )}

            {!activeRun ? (
              <p className="text-sm text-slate-500 py-10 text-center border border-dashed border-slate-200 rounded-md">
                Live step observations, Playwright viewport screenshots, and outcome verification appear here during execution.
              </p>
            ) : (
              <div className="space-y-4">
                <div className="divide-y divide-slate-200 border border-slate-200 rounded-md">
                  {activeRun.steps.map((st) => (
                    <div key={st.stepId} className="p-3.5 space-y-2 text-xs">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-mono font-semibold text-slate-900">
                          {st.order}. {st.action.toUpperCase()} — {st.description}
                        </span>
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-slate-600">{st.status}</span>
                          {selectedSkillId && (
                            <button
                              type="button"
                              onClick={() => {
                                setCorrectStepId(st.stepId);
                                setCorrectedSelector(st.targetUsed);
                              }}
                              className="inline-flex items-center gap-1 text-blue-800 hover:underline"
                            >
                              <Wrench className="w-3 h-3" /> Correct
                            </button>
                          )}
                        </div>
                      </div>
                      <p className="text-slate-700">{st.observation}</p>
                      {st.adaptedFromSelector && (
                        <p className="font-mono text-amber-800">
                          Adapted selector from {st.adaptedFromSelector} → {st.targetUsed}
                        </p>
                      )}
                      {st.error && <p className="text-red-700 font-medium">{st.error}</p>}
                      {st.screenshotDataUrl && (
                        <img
                          src={st.screenshotDataUrl}
                          alt={`Step ${st.order} browser observation`}
                          className="w-full max-h-48 object-cover object-top rounded border border-slate-200"
                        />
                      )}
                    </div>
                  ))}
                </div>

                {/* Step Correction Form (OBS-007) */}
                {correctStepId && (
                  <form onSubmit={handleSubmitCorrection} className="p-4 bg-slate-50 border border-slate-300 rounded-md space-y-2.5 text-xs">
                    <p className="font-semibold text-slate-900">Propose Skill Step Correction (Creates Next Version Diff)</p>
                    <input
                      required
                      value={correctedSelector}
                      onChange={(e) => setCorrectedSelector(e.target.value)}
                      placeholder="Updated CSS selector"
                      className="w-full px-2.5 py-1.5 border border-slate-300 rounded bg-white font-mono"
                    />
                    <input
                      value={correctionReason}
                      onChange={(e) => setCorrectionReason(e.target.value)}
                      placeholder="Reason for correction"
                      className="w-full px-2.5 py-1.5 border border-slate-300 rounded bg-white"
                    />
                    <div className="flex gap-2">
                      <button type="submit" className="px-3 py-1.5 bg-blue-900 text-white font-semibold rounded">
                        Submit Correction Proposal
                      </button>
                      <button type="button" onClick={() => setCorrectStepId(null)} className="px-3 py-1.5 border border-slate-300 bg-white rounded">
                        Cancel
                      </button>
                    </div>
                  </form>
                )}

                {/* Verified Outcome Panel (AGENT-013) */}
                {activeRun.outcome && (
                  <div
                    className={`p-4 rounded-md border text-xs space-y-2 ${
                      activeRun.outcome.verdict === 'confirmed'
                        ? 'bg-emerald-50 border-emerald-200 text-emerald-950'
                        : activeRun.outcome.verdict === 'failed'
                        ? 'bg-red-50 border-red-200 text-red-950'
                        : 'bg-amber-50 border-amber-200 text-amber-950'
                    }`}
                  >
                    <p className="font-semibold uppercase tracking-wide">
                      Outcome Verification: {activeRun.outcome.verdict}
                    </p>
                    <p><strong>Observed:</strong> {activeRun.outcome.observed}</p>
                    <p><strong>Evidence:</strong> {activeRun.outcome.evidenceSummary}</p>

                    {activeRun.outcome.extractedRows && activeRun.outcome.extractedRows.length > 0 && (
                      <div className="overflow-x-auto pt-2">
                        <table className="w-full text-left border-collapse bg-white text-slate-900 border border-slate-200">
                          <thead>
                            <tr className="border-b border-slate-200 bg-slate-50">
                              <th className="p-2 font-semibold">Title</th>
                              <th className="p-2 font-semibold">Category</th>
                              <th className="p-2 font-semibold">Year</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-100">
                            {activeRun.outcome.extractedRows.map((row, idx) => (
                              <tr key={idx}>
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
              </div>
            )}
          </section>
        </div>

        {/* Guided Personal Workflow Examples (INT-005) + macOS Companion Bridge (AGENT-007/008) */}
        <div className="grid gap-6 lg:grid-cols-2">
          <section className="p-6 bg-white border border-slate-200 rounded-lg space-y-4">
            <h2 className="font-display text-base font-semibold text-slate-900">Guided Personal Workflow Examples</h2>
            <div className="divide-y divide-slate-200 border border-slate-200 rounded-md text-xs">
              <div className="p-3.5 flex items-center justify-between gap-3">
                <div>
                  <p className="font-semibold text-slate-900">1. Web Research &amp; Comparison Table</p>
                  <p className="text-slate-600">Live Playwright execution against /fixture/research + structured table extraction.</p>
                </div>
                <StateBadge state="live" />
              </div>
              <div className="p-3.5 space-y-2.5">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="font-semibold text-slate-900">2. Summarize User-Provided Document</p>
                    <p className="text-slate-600">Paste notes below to summarize with Gemini 4 Hydrogen (prompt-injection sanitized).</p>
                  </div>
                  <StateBadge state="live" />
                </div>
                <form onSubmit={handleSummarizeDoc} className="space-y-2">
                  <div className="flex gap-2">
                    <input
                      value={docTitle}
                      onChange={(e) => setDocTitle(e.target.value)}
                      className="w-48 px-2.5 py-1.5 border border-slate-300 rounded text-xs"
                    />
                    <input
                      value={docBody}
                      onChange={(e) => setDocBody(e.target.value)}
                      placeholder="Paste document text to summarize..."
                      className="flex-1 px-2.5 py-1.5 border border-slate-300 rounded text-xs"
                    />
                    <button type="submit" className="inline-flex items-center gap-1 px-3 py-1.5 bg-slate-900 text-white rounded font-semibold">
                      <FileText className="w-3.5 h-3.5" /> Summarize
                    </button>
                  </div>
                </form>
                {docSummary && (
                  <div className="p-3 bg-slate-50 border border-slate-200 rounded space-y-1">
                    <p className="font-medium text-slate-900">{docSummary.summary}</p>
                    <ul className="list-disc pl-4 text-slate-600">
                      {docSummary.keyPoints.map((kp, i) => <li key={i}>{kp}</li>)}
                    </ul>
                  </div>
                )}
              </div>
              <div className="p-3.5 flex items-center justify-between gap-3">
                <div>
                  <p className="font-semibold text-slate-900">3. Google Drive Read &amp; Draft Output</p>
                  <p className="text-slate-500">Disabled — Google Workspace OAuth was not authorized.</p>
                </div>
                <StateBadge state="disabled" detail="OAuth Unlinked" />
              </div>
              <div className="p-3.5 flex items-center justify-between gap-3">
                <div>
                  <p className="font-semibold text-slate-900">4. Gmail Draft &amp; Separate Send Approval</p>
                  <p className="text-slate-500">Disabled — Gmail OAuth scope not authorized.</p>
                </div>
                <StateBadge state="disabled" detail="OAuth Unlinked" />
              </div>
              <div className="p-3.5 flex items-center justify-between gap-3">
                <div>
                  <p className="font-semibold text-slate-900">5. Google Calendar Schedule Proposal</p>
                  <p className="text-slate-500">Disabled — Calendar OAuth scope not authorized.</p>
                </div>
                <StateBadge state="disabled" detail="OAuth Unlinked" />
              </div>
            </div>
          </section>

          <section className="p-6 bg-white border border-slate-200 rounded-lg space-y-4">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <Laptop className="w-4 h-4 text-slate-700" aria-hidden="true" />
                <h2 className="font-display text-base font-semibold text-slate-900">macOS Companion &amp; Local/Cloud Bridge</h2>
              </div>
              <StateBadge
                state={workspace?.macCompanion.paired ? 'pending' : 'disabled'}
                detail={workspace?.macCompanion.paired ? 'Token Issued (Mac Unverified)' : 'Not Paired'}
              />
            </div>
            <p className="text-xs text-slate-600">
              {workspace?.macCompanion.statusNote}
            </p>
            {workspace?.macCompanion.capabilityToken && (
              <div className="p-3 bg-slate-50 border border-slate-200 rounded font-mono text-[11px] space-y-1 break-all">
                <p>Device: {workspace.macCompanion.deviceName}</p>
                <p>Token: {workspace.macCompanion.capabilityToken}</p>
                <p>Expires: {workspace.macCompanion.expiresAt}</p>
              </div>
            )}
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => apiFetch('/api/companion/pair', { method: 'POST', body: JSON.stringify({ deviceName: 'Personal MacBook' }) }).then(() => refreshWorkspace())}
                className="px-3.5 py-2 text-xs font-semibold bg-slate-900 text-white rounded-md"
              >
                Generate 15m Pairing Token
              </button>
              {workspace?.macCompanion.paired && (
                <button
                  type="button"
                  onClick={() => apiFetch('/api/companion/revoke', { method: 'POST' }).then(() => refreshWorkspace())}
                  className="px-3.5 py-2 text-xs font-semibold text-red-700 border border-red-200 rounded-md"
                >
                  Revoke Pairing
                </button>
              )}
              <button
                type="button"
                onClick={() => setShowMacInfo(!showMacInfo)}
                className="px-3.5 py-2 text-xs font-medium border border-slate-300 rounded-md"
              >
                {showMacInfo ? 'Hide macOS Setup' : 'View macOS Companion Docs'}
              </button>
            </div>
            {showMacInfo && (
              <div className="p-3 bg-slate-50 border border-slate-200 rounded text-xs text-slate-700 space-y-1">
                <p className="font-semibold">Local Mac Setup (/macos-companion/twinme_companion.py):</p>
                <p className="font-mono">export TWINME_PAIR_TOKEN=&quot;{workspace?.macCompanion.capabilityToken || '<token>'}&quot;</p>
                <p className="font-mono">python3 macos-companion/twinme_companion.py</p>
                <p>Status remains PARTIAL until executed on physical macOS hardware with Accessibility granted.</p>
              </div>
            )}
          </section>
        </div>
      </div>
    </LayoutShell>
  );
};
