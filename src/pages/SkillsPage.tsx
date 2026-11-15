import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Play, Trash2, Check, X } from 'lucide-react';
import { LayoutShell } from '../components/LayoutShell';
import { useTwin } from '../context/TwinContext';

export const SkillsPage: React.FC = () => {
  const navigate = useNavigate();
  const { workspace, apiFetch, refreshWorkspace } = useTwin();
  const [paramDrafts, setParamDrafts] = useState<Record<string, Record<string, string>>>({});
  const [errMsg, setErrMsg] = useState<string | null>(null);

  const skills = workspace?.skills || [];

  const getParams = (skillId: string, defaults: Record<string, string>) => {
    return paramDrafts[skillId] || defaults;
  };

  const setParam = (skillId: string, defaults: Record<string, string>, key: string, value: string) => {
    setParamDrafts((prev) => ({
      ...prev,
      [skillId]: { ...(prev[skillId] || defaults), [key]: value },
    }));
  };

  const handleResolveCorrection = async (skillId: string, corrId: string, decision: 'accept' | 'reject') => {
    setErrMsg(null);
    try {
      await apiFetch(`/api/skills/${skillId}/corrections/${corrId}/resolve`, {
        method: 'POST',
        body: JSON.stringify({ decision }),
      });
      await refreshWorkspace();
    } catch (err) {
      setErrMsg(err instanceof Error ? err.message : 'Failed to resolve correction.');
    }
  };

  const handleDeleteSkill = async (skillId: string) => {
    await apiFetch(`/api/skills/${skillId}`, { method: 'DELETE' });
    await refreshWorkspace();
  };

  const handleLaunchInAgent = (skillId: string, defaults: Record<string, string>) => {
    const params = getParams(skillId, defaults);
    navigate('/agent', { state: { skillId, inputValues: params } });
  };

  return (
    <LayoutShell title="Parameterized Skill Library">
      <div className="space-y-6">
        {errMsg && <div className="p-3 bg-red-50 border border-red-200 rounded text-sm text-red-800">{errMsg}</div>}

        {skills.length === 0 ? (
          <div className="p-10 bg-white border border-slate-200 rounded-lg text-center space-y-3">
            <h2 className="font-display text-lg font-semibold text-slate-900">No Learned Skills Yet</h2>
            <p className="text-sm text-slate-600 max-w-md mx-auto">
              Skills are created strictly from your explicit approved demonstrations in Teach Mode. Nothing is pre-fabricated.
            </p>
            <button
              type="button"
              onClick={() => navigate('/teach')}
              className="px-4 py-2 text-sm font-semibold bg-blue-900 text-white rounded-md hover:bg-blue-800"
            >
              Teach First Skill
            </button>
          </div>
        ) : (
          <div className="space-y-6">
            {skills.map((skill) => {
              const currentParams = getParams(skill.id, skill.inputs);
              return (
                <article key={skill.id} className="p-6 bg-white border border-slate-200 rounded-lg space-y-4">
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div>
                      <p className="text-xs font-mono text-slate-500">
                        {skill.id} · v{skill.version} · {skill.verifiedRunsCount} verified run(s) · Trace: {skill.sourceTraceIds.join(', ') || 'manual'}
                      </p>
                      <h2 className="font-display text-lg font-semibold text-slate-900 mt-1">{skill.name}</h2>
                      <p className="text-sm text-slate-600 mt-0.5">{skill.summary || skill.intent}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => handleLaunchInAgent(skill.id, skill.inputs)}
                        className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold bg-blue-900 text-white rounded-md hover:bg-blue-800"
                      >
                        <Play className="w-3.5 h-3.5" aria-hidden="true" />
                        <span>Run in Agent Cockpit</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDeleteSkill(skill.id)}
                        aria-label={`Delete skill ${skill.name}`}
                        className="p-2 text-red-700 border border-red-200 rounded-md hover:bg-red-50"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>

                  {/* Supply New Task Parameters (OBS-006) */}
                  {Object.keys(skill.inputs).length > 0 && (
                    <div className="p-4 bg-slate-50 border border-slate-200 rounded-md space-y-2.5">
                      <p className="text-xs font-semibold text-slate-700">Supply New Parameters for Next Variation</p>
                      <div className="grid gap-3 sm:grid-cols-2">
                        {Object.entries(skill.inputs).map(([key, defVal]) => (
                          <label key={key} className="block text-xs space-y-1">
                            <span className="font-mono text-slate-600">{key}</span>
                            <input
                              value={currentParams[key] ?? defVal}
                              onChange={(e) => setParam(skill.id, skill.inputs, key, e.target.value)}
                              className="w-full px-2.5 py-1.5 border border-slate-300 rounded bg-white text-sm"
                            />
                          </label>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Steps */}
                  <div className="space-y-1.5">
                    <p className="text-xs font-semibold text-slate-700">Allowed Origins: <span className="font-mono font-normal">{skill.allowedOrigins.join(', ')}</span></p>
                    <ol className="divide-y divide-slate-100 border border-slate-200 rounded-md text-xs">
                      {skill.steps.map((s) => (
                        <li key={s.id} className="p-2.5 flex items-center justify-between gap-3">
                          <span>
                            <span className="font-mono font-semibold text-slate-900">{s.order}. {s.action}</span>{' '}
                            <span className="font-mono text-slate-600">{s.targetSelector}</span> — {s.description}
                          </span>
                          <span className="font-mono text-slate-500 shrink-0">{s.risk}</span>
                        </li>
                      ))}
                    </ol>
                  </div>

                  {/* Pending / Historical Corrections (OBS-007) */}
                  {skill.corrections.length > 0 && (
                    <div className="pt-3 border-t border-slate-200 space-y-2">
                      <h3 className="text-xs font-semibold text-slate-800">Proposed &amp; Historical Step Corrections</h3>
                      {skill.corrections.map((c) => (
                        <div key={c.id} className="p-3 border border-slate-200 rounded-md text-xs space-y-2 bg-slate-50">
                          <div className="flex items-center justify-between">
                            <span className="font-mono font-semibold">
                              v{c.fromVersion} → v{c.toVersion} · {c.status.toUpperCase()}
                            </span>
                            {c.status === 'pending' && (
                              <div className="flex items-center gap-2">
                                <button
                                  type="button"
                                  onClick={() => handleResolveCorrection(skill.id, c.id, 'accept')}
                                  className="inline-flex items-center gap-1 px-2.5 py-1 bg-emerald-700 text-white rounded font-semibold"
                                >
                                  <Check className="w-3 h-3" /> Accept Update
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleResolveCorrection(skill.id, c.id, 'reject')}
                                  className="inline-flex items-center gap-1 px-2.5 py-1 border border-slate-300 bg-white text-slate-700 rounded font-semibold"
                                >
                                  <X className="w-3 h-3" /> Reject
                                </button>
                              </div>
                            )}
                          </div>
                          <p className="text-slate-700">{c.reason}</p>
                          <div className="grid sm:grid-cols-2 gap-2 font-mono text-[11px]">
                            <div className="p-2 bg-red-50 border border-red-200 rounded">
                              <p className="font-semibold text-red-900">Before</p>
                              <p>{c.beforeStep.action} {c.beforeStep.targetSelector}</p>
                            </div>
                            <div className="p-2 bg-emerald-50 border border-emerald-200 rounded">
                              <p className="font-semibold text-emerald-900">After</p>
                              <p>{c.afterStep.action} {c.afterStep.targetSelector}</p>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </article>
              );
            })}
          </div>
        )}
      </div>
    </LayoutShell>
  );
};
