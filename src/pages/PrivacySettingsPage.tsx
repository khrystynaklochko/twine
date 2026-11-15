import React, { useState } from 'react';
import { Download, Trash2, AlertTriangle } from 'lucide-react';
import { LayoutShell } from '../components/LayoutShell';
import { StateBadge } from '../components/StateBadge';
import { useTwin } from '../context/TwinContext';

export const PrivacySettingsPage: React.FC = () => {
  const { workspace, apiFetch, toggleConsent, revokeSite, refreshWorkspace } = useTwin();
  const [retentionInput, setRetentionInput] = useState(workspace?.retentionDays ?? 30);
  const [confirmWipe, setConfirmWipe] = useState(false);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);

  const handleSaveRetention = async (e: React.FormEvent) => {
    e.preventDefault();
    await apiFetch('/api/privacy/retention', {
      method: 'POST',
      body: JSON.stringify({ retentionDays: retentionInput }),
    });
    setStatusMsg(`Retention TTL updated to ${retentionInput} days.`);
    await refreshWorkspace();
  };

  const handleExportAll = async () => {
    const data = await apiFetch('/api/privacy/export');
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `twinme-export-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    setStatusMsg('Exported complete user-owned twin archive.');
  };

  const handleDeleteTrace = async (traceId: string) => {
    await apiFetch(`/api/teach/traces/${traceId}`, { method: 'DELETE' });
    await refreshWorkspace();
  };

  const handleWipeAccount = async () => {
    await apiFetch('/api/privacy/account', { method: 'DELETE' });
    setConfirmWipe(false);
    setStatusMsg('All twin records, memories, traces, skills, and logs permanently deleted.');
    await refreshWorkspace();
  };

  return (
    <LayoutShell title="Privacy, Grants & Data Ownership">
      <div className="space-y-6 max-w-4xl">
        {statusMsg && (
          <div className="p-3 bg-emerald-50 border border-emerald-200 rounded text-sm text-emerald-900">
            {statusMsg}
          </div>
        )}

        {/* Google Workspace Status (INT-001) */}
        <section className="p-6 bg-white border border-slate-200 rounded-lg space-y-3">
          <div className="flex items-center justify-between gap-4">
            <div>
              <h2 className="font-display text-base font-semibold text-slate-900">Google Workspace Scoped Integrations</h2>
              <p className="text-sm text-slate-600">
                Drive, Gmail Drafts, and Calendar actions remain unlinked unless you explicitly authorize Workspace OAuth.
              </p>
            </div>
            <StateBadge state="disabled" detail="Not Connected" />
          </div>
          <p className="text-xs text-slate-500">
            Unlinked workspace mode is fully operational for personal twin memory, Teach Mode, and Playwright browser execution.
          </p>
        </section>

        {/* Consent Scopes */}
        <section className="p-6 bg-white border border-slate-200 rounded-lg space-y-3">
          <h2 className="font-display text-base font-semibold text-slate-900">Consent Scopes &amp; Withdrawal</h2>
          <div className="divide-y divide-slate-200 border border-slate-200 rounded-md">
            {(workspace?.consents || []).map((c) => (
              <div key={c.scope} className="p-3.5 flex items-center justify-between gap-4 text-sm">
                <div>
                  <p className="font-medium text-slate-900">{c.label}</p>
                  <p className="text-xs text-slate-500">{c.unavailableReason || c.description}</p>
                </div>
                <button
                  type="button"
                  disabled={!c.available}
                  onClick={() => toggleConsent(c.scope, !c.granted)}
                  className={`px-3 py-1.5 text-xs font-semibold rounded border whitespace-nowrap ${
                    !c.available
                      ? 'bg-slate-100 text-slate-400 border-slate-200 cursor-not-allowed'
                      : c.granted
                      ? 'bg-white text-red-700 border-red-200 hover:bg-red-50'
                      : 'bg-blue-900 text-white border-blue-900 hover:bg-blue-800'
                  }`}
                >
                  {!c.available ? 'Unavailable' : c.granted ? 'Withdraw Grant' : 'Grant Scope'}
                </button>
              </div>
            ))}
          </div>
        </section>

        {/* Site Allowlist */}
        <section className="p-6 bg-white border border-slate-200 rounded-lg space-y-3">
          <h2 className="font-display text-base font-semibold text-slate-900">Per-Site Permissions</h2>
          {workspace?.siteGrants.length ? (
            <div className="divide-y divide-slate-200 border border-slate-200 rounded-md">
              {workspace.siteGrants.map((g) => (
                <div key={g.origin} className="p-3 flex items-center justify-between gap-4 text-xs">
                  <div>
                    <p className="font-semibold text-slate-900">{g.label}</p>
                    <p className="font-mono text-slate-500">{g.origin}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => revokeSite(g.origin)}
                    className="px-3 py-1.5 font-semibold text-red-700 border border-red-200 rounded hover:bg-red-50"
                  >
                    Revoke
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-xs text-slate-500">No sites granted.</p>
          )}
        </section>

        {/* Retention Policy & Selective Trace Deletion */}
        <section className="p-6 bg-white border border-slate-200 rounded-lg space-y-4">
          <h2 className="font-display text-base font-semibold text-slate-900">Retention TTL &amp; Trace Deletion</h2>
          <form onSubmit={handleSaveRetention} className="flex items-center gap-3 text-sm">
            <label className="text-slate-700">Default Memory &amp; Trace TTL (days):</label>
            <input
              type="number"
              min={1}
              max={365}
              value={retentionInput}
              onChange={(e) => setRetentionInput(Number(e.target.value))}
              className="w-24 px-2.5 py-1.5 border border-slate-300 rounded font-mono"
            />
            <button type="submit" className="px-3.5 py-1.5 text-xs font-semibold bg-slate-900 text-white rounded">
              Update TTL
            </button>
          </form>

          <div className="space-y-2">
            <p className="text-xs font-semibold text-slate-700">Stored Action Traces ({workspace?.traces.length ?? 0})</p>
            {workspace?.traces.map((t) => (
              <div key={t.id} className="p-3 border border-slate-200 rounded flex items-center justify-between gap-3 text-xs">
                <div>
                  <p className="font-medium text-slate-900">{t.title}</p>
                  <p className="font-mono text-slate-500">
                    {t.id} · {t.site} · {t.events.length} events · expires {new Date(t.expiresAt).toLocaleDateString()}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => handleDeleteTrace(t.id)}
                  className="inline-flex items-center gap-1 px-2.5 py-1.5 text-red-700 border border-red-200 rounded hover:bg-red-50"
                >
                  <Trash2 className="w-3.5 h-3.5" /> Delete Trace
                </button>
              </div>
            ))}
          </div>
        </section>

        {/* Export & Full Deletion */}
        <section className="p-6 bg-white border border-slate-200 rounded-lg space-y-4">
          <h2 className="font-display text-base font-semibold text-slate-900">Export Owned Data &amp; Account Deletion</h2>
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={handleExportAll}
              className="inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold border border-slate-300 rounded-md hover:bg-slate-50"
            >
              <Download className="w-4 h-4" aria-hidden="true" />
              <span>Export Complete Twin Archive (JSON)</span>
            </button>

            {!confirmWipe ? (
              <button
                type="button"
                onClick={() => setConfirmWipe(true)}
                className="inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold text-red-700 border border-red-300 rounded-md hover:bg-red-50"
              >
                <Trash2 className="w-4 h-4" aria-hidden="true" />
                <span>Delete All Twin Data</span>
              </button>
            ) : (
              <div className="flex items-center gap-2 p-2 bg-red-50 border border-red-300 rounded-md text-xs">
                <AlertTriangle className="w-4 h-4 text-red-700" />
                <span className="font-semibold text-red-900">Permanently delete everything?</span>
                <button
                  type="button"
                  onClick={handleWipeAccount}
                  className="px-3 py-1 bg-red-700 text-white font-semibold rounded"
                >
                  Confirm Wipe
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmWipe(false)}
                  className="px-3 py-1 bg-white border border-slate-300 rounded"
                >
                  Cancel
                </button>
              </div>
            )}
          </div>
        </section>
      </div>
    </LayoutShell>
  );
};
