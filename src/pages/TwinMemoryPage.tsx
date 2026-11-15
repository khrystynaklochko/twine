import React, { useState } from 'react';
import { Trash2, Edit3, Check, X, Send } from 'lucide-react';
import { LayoutShell } from '../components/LayoutShell';
import { StateBadge } from '../components/StateBadge';
import { useTwin } from '../context/TwinContext';

interface ChatTurn {
  role: 'user' | 'twin';
  text: string;
  citedMemoryIds?: string[];
  unknownTopics?: string[];
  confidence?: string;
}

export const TwinMemoryPage: React.FC = () => {
  const { workspace, apiFetch, updateProfile, refreshWorkspace } = useTwin();

  const [memTab, setMemTab] = useState<'episodic' | 'semantic'>('semantic');
  const [newTitle, setNewTitle] = useState('');
  const [newContent, setNewContent] = useState('');
  const [newTtl, setNewTtl] = useState(30);
  const [editingGoal, setEditingGoal] = useState(false);
  const [goalDraft, setGoalDraft] = useState('');

  const [chatInput, setChatInput] = useState('');
  const [chatHistory, setChatHistory] = useState<ChatTurn[]>([]);
  const [chatLoading, setChatLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const profile = workspace?.profile;
  const memories = (workspace?.memories || []).filter((m) => m.category === memTab);
  const verifiedRuns = (workspace?.runs || []).filter((r) => r.status === 'verified').length;

  const handleAddMemory = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    try {
      await apiFetch('/api/memories', {
        method: 'POST',
        body: JSON.stringify({
          category: memTab,
          title: newTitle,
          content: newContent,
          source: 'user_direct_entry',
          ttlDays: newTtl,
        }),
      });
      setNewTitle('');
      setNewContent('');
      await refreshWorkspace();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Unable to save memory.');
    }
  };

  const handleToggleReject = async (id: string, rejected: boolean) => {
    await apiFetch(`/api/memories/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ rejected }),
    });
    await refreshWorkspace();
  };

  const handleForgetMemory = async (id: string) => {
    await apiFetch(`/api/memories/${id}`, { method: 'DELETE' });
    await refreshWorkspace();
  };

  const handleSaveGoal = async () => {
    await updateProfile({ primaryGoal: goalDraft, note: 'Updated primary goal in Twin & Memory console.' });
    setEditingGoal(false);
  };

  const handleSendChat = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!chatInput.trim() || chatLoading) return;
    const question = chatInput.trim();
    setChatInput('');
    setChatHistory((prev) => [...prev, { role: 'user', text: question }]);
    setChatLoading(true);
    setErrorMsg(null);
    try {
      const res = await apiFetch<{
        reply: string;
        citedMemoryIds: string[];
        unknownTopics: string[];
        confidence: string;
      }>('/api/twin/chat', {
        method: 'POST',
        body: JSON.stringify({ message: question }),
      });
      setChatHistory((prev) => [
        ...prev,
        {
          role: 'twin',
          text: res.reply,
          citedMemoryIds: res.citedMemoryIds,
          unknownTopics: res.unknownTopics,
          confidence: res.confidence,
        },
      ]);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Twin chat request failed.');
    } finally {
      setChatLoading(false);
    }
  };

  return (
    <LayoutShell title="Personal Twin & Memory">
      <div className="grid gap-6 lg:grid-cols-[1.15fr_0.85fr] items-start">
        {/* Left Column: Self Model + Memory Stores */}
        <div className="space-y-6">
          {/* Self Model & Provenance */}
          <section className="p-6 bg-white border border-slate-200 rounded-lg space-y-4">
            <div className="flex items-center justify-between gap-4">
              <div>
                <h2 className="font-display text-base font-semibold text-slate-900">Persistent Self Model</h2>
                <p className="text-xs font-mono text-slate-500">
                  Version {profile?.version ?? 1} · Updated {profile?.updatedAt ? new Date(profile.updatedAt).toLocaleString() : 'Never'}
                </p>
              </div>
              <StateBadge state={profile?.established ? 'live' : 'permission_required'} detail={profile?.established ? 'Established' : 'Not Onboarded'} />
            </div>

            <div className="space-y-2 text-sm">
              <div className="flex items-start justify-between gap-4 py-2 border-t border-slate-100">
                <div className="space-y-1 flex-1">
                  <p className="text-xs font-medium text-slate-500">Primary Goal</p>
                  {editingGoal ? (
                    <div className="flex gap-2">
                      <input
                        value={goalDraft}
                        onChange={(e) => setGoalDraft(e.target.value)}
                        className="flex-1 px-2.5 py-1.5 border border-slate-300 rounded-md text-sm"
                      />
                      <button type="button" onClick={handleSaveGoal} className="p-1.5 bg-blue-900 text-white rounded-md" aria-label="Save goal">
                        <Check className="w-4 h-4" />
                      </button>
                      <button type="button" onClick={() => setEditingGoal(false)} className="p-1.5 border border-slate-300 rounded-md" aria-label="Cancel">
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                  ) : (
                    <p className="text-slate-900">{profile?.primaryGoal || 'No goal set yet.'}</p>
                  )}
                </div>
                {!editingGoal && (
                  <button
                    type="button"
                    onClick={() => {
                      setGoalDraft(profile?.primaryGoal || '');
                      setEditingGoal(true);
                    }}
                    className="text-xs font-medium text-blue-800 hover:underline inline-flex items-center gap-1"
                  >
                    <Edit3 className="w-3.5 h-3.5" aria-hidden="true" />
                    <span>Edit</span>
                  </button>
                )}
              </div>

              <div className="py-2 border-t border-slate-100">
                <p className="text-xs font-medium text-slate-500 mb-1">Revision Provenance</p>
                <ul className="space-y-1 text-xs text-slate-600 font-mono">
                  {(profile?.history || []).slice(0, 4).map((h) => (
                    <li key={h.version}>
                      v{h.version} · {h.actor} · {h.note} ({new Date(h.timestamp).toLocaleTimeString()})
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </section>

          {/* User-Owned Memory Stores */}
          <section className="p-6 bg-white border border-slate-200 rounded-lg space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="font-display text-base font-semibold text-slate-900">User-Owned Memory</h2>
                <p className="text-xs text-slate-500">Episodic events and semantic preferences stored separately with TTL and permanent delete.</p>
              </div>
              <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-md">
                <button
                  type="button"
                  onClick={() => setMemTab('semantic')}
                  className={`px-3 py-1 text-xs font-medium rounded ${memTab === 'semantic' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600'}`}
                >
                  Semantic Preferences
                </button>
                <button
                  type="button"
                  onClick={() => setMemTab('episodic')}
                  className={`px-3 py-1 text-xs font-medium rounded ${memTab === 'episodic' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600'}`}
                >
                  Episodic Notes
                </button>
              </div>
            </div>

            <form onSubmit={handleAddMemory} className="grid gap-2.5 p-3.5 bg-slate-50 border border-slate-200 rounded-md">
              <div className="flex gap-2">
                <input
                  required
                  value={newTitle}
                  onChange={(e) => setNewTitle(e.target.value)}
                  placeholder={memTab === 'semantic' ? 'Preference title (e.g. Output format)' : 'Observation title'}
                  className="flex-1 px-3 py-1.5 text-sm border border-slate-300 rounded-md bg-white"
                />
                <input
                  type="number"
                  min={1}
                  max={365}
                  value={newTtl}
                  onChange={(e) => setNewTtl(Number(e.target.value))}
                  aria-label="Retention TTL days"
                  className="w-20 px-2.5 py-1.5 text-sm border border-slate-300 rounded-md bg-white font-mono"
                />
              </div>
              <div className="flex gap-2">
                <input
                  required
                  value={newContent}
                  onChange={(e) => setNewContent(e.target.value)}
                  placeholder="Exact preference or note..."
                  className="flex-1 px-3 py-1.5 text-sm border border-slate-300 rounded-md bg-white"
                />
                <button
                  type="submit"
                  className="px-3.5 py-1.5 text-xs font-semibold bg-blue-900 text-white rounded-md hover:bg-blue-800 whitespace-nowrap"
                >
                  Save Memory
                </button>
              </div>
            </form>

            {errorMsg && <p className="text-xs text-red-700 font-medium">{errorMsg}</p>}

            {memories.length === 0 ? (
              <p className="text-sm text-slate-500 py-4 text-center border border-dashed border-slate-200 rounded-md">
                No {memTab} memories saved yet.
              </p>
            ) : (
              <div className="divide-y divide-slate-200 border border-slate-200 rounded-md">
                {memories.map((m) => (
                  <div key={m.id} className="p-3.5 space-y-1.5">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className={`text-sm font-semibold ${m.rejected ? 'line-through text-slate-400' : 'text-slate-900'}`}>
                          {m.title}
                        </p>
                        <p className="text-sm text-slate-700">{m.content}</p>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <button
                          type="button"
                          onClick={() => handleToggleReject(m.id, !m.rejected)}
                          className="text-xs font-medium text-slate-600 hover:text-slate-900 px-2 py-1 border border-slate-200 rounded"
                        >
                          {m.rejected ? 'Restore' : 'Reject'}
                        </button>
                        <button
                          type="button"
                          onClick={() => handleForgetMemory(m.id)}
                          aria-label={`Forget ${m.title}`}
                          className="p-1.5 text-red-700 hover:bg-red-50 border border-red-200 rounded"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                    <p className="text-xs font-mono text-slate-500">
                      {m.id} · source: {m.source} · TTL: {m.ttlDays}d · expires {new Date(m.expiresAt).toLocaleDateString()}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* Capabilities & Limits (TWIN-005) */}
          <section className="p-6 bg-white border border-slate-200 rounded-lg space-y-3">
            <h2 className="font-display text-base font-semibold text-slate-900">Measured Capabilities & Limits</h2>
            <p className="text-xs text-slate-500">Derived strictly from saved skills, verified executions, and active user grants.</p>
            <dl className="grid grid-cols-3 gap-4 pt-2 border-t border-slate-100 text-xs">
              <div>
                <dt className="text-slate-500">Approved Skills</dt>
                <dd className="font-mono text-lg font-bold text-slate-900 tabular-nums">{workspace?.skills.length ?? 0}</dd>
              </div>
              <div>
                <dt className="text-slate-500">Verified Executions</dt>
                <dd className="font-mono text-lg font-bold text-slate-900 tabular-nums">{verifiedRuns}</dd>
              </div>
              <div>
                <dt className="text-slate-500">Approved Sites</dt>
                <dd className="font-mono text-lg font-bold text-slate-900 tabular-nums">{workspace?.siteGrants.length ?? 0}</dd>
              </div>
            </dl>
          </section>
        </div>

        {/* Right Column: Grounded Twin Dialogue (TWIN-004) */}
        <section className="p-6 bg-white border border-slate-200 rounded-lg flex flex-col h-[640px]">
          <div className="pb-4 border-b border-slate-200 space-y-1">
            <div className="flex items-center justify-between gap-2">
              <h2 className="font-display text-base font-semibold text-slate-900">Grounded Twin Dialogue</h2>
              <StateBadge state="live" detail="Gemini 4 Hydrogen" />
            </div>
            <p className="text-xs text-slate-500">
              Ask what your twin knows. Answers cite memory IDs and say unknown when evidence is absent.
            </p>
          </div>

          <div className="flex-1 overflow-y-auto py-4 space-y-4">
            {chatHistory.length === 0 && (
              <div className="text-sm text-slate-500 space-y-2 p-4 bg-slate-50 rounded-md border border-slate-200">
                <p className="font-medium text-slate-700">Try asking:</p>
                <ul className="list-disc pl-5 space-y-1 text-xs">
                  <li>&ldquo;What preferences and constraints do you currently know about me?&rdquo;</li>
                  <li>&ldquo;What is my favorite programming language?&rdquo; (tests honest unknown response)</li>
                </ul>
              </div>
            )}

            {chatHistory.map((turn, idx) => (
              <div
                key={idx}
                className={`p-3.5 rounded-md text-sm space-y-2 ${
                  turn.role === 'user' ? 'bg-slate-900 text-white ml-8' : 'bg-slate-50 border border-slate-200 text-slate-900 mr-4'
                }`}
              >
                <p className="whitespace-pre-wrap leading-relaxed">{turn.text}</p>
                {turn.role === 'twin' && (
                  <div className="pt-2 border-t border-slate-200 text-xs font-mono text-slate-500 space-y-0.5">
                    <p>Confidence: {turn.confidence}</p>
                    <p>Cited Memories: {turn.citedMemoryIds?.length ? turn.citedMemoryIds.join(', ') : 'None'}</p>
                    {turn.unknownTopics?.length ? <p>Unknown: {turn.unknownTopics.join(', ')}</p> : null}
                  </div>
                )}
              </div>
            ))}
          </div>

          <form onSubmit={handleSendChat} className="pt-3 border-t border-slate-200 flex gap-2">
            <input
              value={chatInput}
              onChange={(e) => setChatInput(e.target.value)}
              placeholder="Ask your twin what it knows..."
              className="flex-1 px-3 py-2 text-sm border border-slate-300 rounded-md"
            />
            <button
              type="submit"
              disabled={chatLoading}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-semibold bg-blue-900 text-white rounded-md hover:bg-blue-800 disabled:opacity-50"
            >
              <Send className="w-3.5 h-3.5" aria-hidden="true" />
              <span>{chatLoading ? '...' : 'Ask'}</span>
            </button>
          </form>
        </section>
      </div>
    </LayoutShell>
  );
};
