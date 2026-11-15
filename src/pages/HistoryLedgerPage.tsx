import React, { useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { LayoutShell } from '../components/LayoutShell';
import { StateBadge } from '../components/StateBadge';
import { useTwin } from '../context/TwinContext';
import type { TicketRecord } from '../types/twin';

interface VerificationCheck {
  name: string;
  ticketId: string;
  passed: boolean;
  detail: string;
  ranAt: string;
}

export const HistoryLedgerPage: React.FC = () => {
  const { workspace, apiFetch } = useTwin();
  const [tab, setTab] = useState<'runs' | 'audit' | 'ledger'>('runs');
  const [checks, setChecks] = useState<VerificationCheck[]>([]);
  const [tickets, setTickets] = useState<TicketRecord[]>([]);
  const [runningChecks, setRunningChecks] = useState(false);

  const loadLedger = async () => {
    const data = await apiFetch<{ checks: VerificationCheck[]; tickets: TicketRecord[] }>('/api/verification/ledger');
    setChecks(data.checks);
    setTickets(data.tickets);
  };

  useEffect(() => {
    void loadLedger();
  }, []);

  const handleRunSafetySuite = async () => {
    setRunningChecks(true);
    try {
      const data = await apiFetch<{ checks: VerificationCheck[]; tickets: TicketRecord[] }>('/api/verification/run', {
        method: 'POST',
      });
      setChecks(data.checks);
      setTickets(data.tickets);
    } finally {
      setRunningChecks(false);
    }
  };

  return (
    <LayoutShell title="Execution History & Verification Ledger">
      <div className="space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-md">
            <button
              type="button"
              onClick={() => setTab('runs')}
              className={`px-3 py-1.5 text-xs font-medium rounded ${tab === 'runs' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600'}`}
            >
              Agent Runs ({workspace?.runs.length ?? 0})
            </button>
            <button
              type="button"
              onClick={() => setTab('audit')}
              className={`px-3 py-1.5 text-xs font-medium rounded ${tab === 'audit' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600'}`}
            >
              Access Audit Log ({workspace?.auditLogs.length ?? 0})
            </button>
            <button
              type="button"
              onClick={() => setTab('ledger')}
              className={`px-3 py-1.5 text-xs font-medium rounded ${tab === 'ledger' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600'}`}
            >
              Verification Ledger ({tickets.length})
            </button>
          </div>

          <button
            type="button"
            disabled={runningChecks}
            onClick={handleRunSafetySuite}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold bg-blue-900 text-white rounded-md hover:bg-blue-800 disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${runningChecks ? 'animate-spin' : ''}`} aria-hidden="true" />
            <span>{runningChecks ? 'Running Safety Checks...' : 'Run Automated Safety Suite'}</span>
          </button>
        </div>

        {tab === 'runs' && (
          <section className="bg-white border border-slate-200 rounded-lg divide-y divide-slate-200">
            {!workspace?.runs.length ? (
              <p className="p-8 text-sm text-slate-500 text-center">No agent runs recorded yet.</p>
            ) : (
              workspace.runs.map((r) => (
                <div key={r.id} className="p-5 space-y-2 text-sm">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="font-semibold text-slate-900">{r.goal}</p>
                    <StateBadge
                      state={r.status === 'verified' ? 'live' : r.status === 'failed' ? 'error' : r.status === 'awaiting_approval' ? 'permission_required' : 'pending'}
                      detail={r.status}
                    />
                  </div>
                  <p className="text-xs font-mono text-slate-500">
                    {r.id} · mode={r.mode} · origin={r.targetOrigin} · {r.skillId ? `skill=${r.skillId} v${r.skillVersion}` : 'ad-hoc'} · {new Date(r.createdAt).toLocaleString()}
                  </p>
                  {r.outcome && (
                    <p className="text-xs text-slate-700 bg-slate-50 p-2.5 rounded border border-slate-200">
                      <strong>Outcome ({r.outcome.verdict}):</strong> {r.outcome.observed}
                    </p>
                  )}
                </div>
              ))
            )}
          </section>
        )}

        {tab === 'audit' && (
          <section className="bg-white border border-slate-200 rounded-lg overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-slate-700">
                  <th className="p-3 font-semibold">Timestamp</th>
                  <th className="p-3 font-semibold">Event</th>
                  <th className="p-3 font-semibold">Decision</th>
                  <th className="p-3 font-semibold">Detail</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {(workspace?.auditLogs || []).map((log) => (
                  <tr key={log.id} className="hover:bg-slate-50">
                    <td className="p-3 font-mono tabular-nums whitespace-nowrap text-slate-500">
                      {new Date(log.timestamp).toLocaleString()}
                    </td>
                    <td className="p-3 font-mono text-slate-800">{log.eventType}</td>
                    <td className="p-3 font-mono font-semibold text-slate-900">{log.decision}</td>
                    <td className="p-3 text-slate-700">{log.detail}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        )}

        {tab === 'ledger' && (
          <div className="space-y-6">
            <section className="p-5 bg-white border border-slate-200 rounded-lg space-y-3">
              <h2 className="font-display text-sm font-semibold text-slate-900">Automated Safety &amp; Contract Check Results</h2>
              <div className="divide-y divide-slate-200 border border-slate-200 rounded-md text-xs">
                {checks.map((c) => (
                  <div key={c.ticketId} className="p-3 flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <p className="font-semibold text-slate-900">
                        <span className="font-mono mr-2">{c.ticketId}</span>
                        {c.name}
                      </p>
                      <p className="text-slate-600 mt-0.5">{c.detail}</p>
                    </div>
                    <StateBadge state={c.passed ? 'live' : 'error'} detail={c.passed ? 'PASS' : 'FAIL'} />
                  </div>
                ))}
              </div>
            </section>

            <section className="bg-white border border-slate-200 rounded-lg overflow-x-auto">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50 text-slate-700">
                    <th className="p-3 font-semibold">Ticket</th>
                    <th className="p-3 font-semibold">Title</th>
                    <th className="p-3 font-semibold">Status</th>
                    <th className="p-3 font-semibold">Evidence</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {tickets.map((t) => (
                    <tr key={t.id} className="hover:bg-slate-50">
                      <td className="p-3 font-mono font-semibold whitespace-nowrap text-slate-900">{t.id}</td>
                      <td className="p-3 font-medium text-slate-800">{t.title}</td>
                      <td className="p-3 font-mono font-semibold whitespace-nowrap">
                        <span
                          className={
                            t.status === 'VERIFIED'
                              ? 'text-emerald-700'
                              : t.status === 'IMPLEMENTED'
                              ? 'text-blue-800'
                              : t.status === 'PARTIAL'
                              ? 'text-amber-700'
                              : 'text-red-700'
                          }
                        >
                          {t.status}
                        </span>
                      </td>
                      <td className="p-3 text-slate-600">{t.evidence}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          </div>
        )}
      </div>
    </LayoutShell>
  );
};
