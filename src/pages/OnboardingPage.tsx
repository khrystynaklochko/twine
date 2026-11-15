import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { LayoutShell } from '../components/LayoutShell';
import { StateBadge } from '../components/StateBadge';
import { useTwin } from '../context/TwinContext';
import type { ConsentScopeId } from '../types/twin';

export const OnboardingPage: React.FC = () => {
  const navigate = useNavigate();
  const { workspace, firebaseUser, signInGoogle, signOutAccount, completeOnboarding, toggleConsent, grantSite, revokeSite } = useTwin();

  const [displayName, setDisplayName] = useState('');
  const [headline, setHeadline] = useState('');
  const [timezone, setTimezone] = useState(Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC');
  const [primaryGoal, setPrimaryGoal] = useState('');
  const [constraintsText, setConstraintsText] = useState('');
  const [consents, setConsents] = useState<Record<ConsentScopeId, boolean>>({
    memory_persistence: true,
    teach_observation: true,
    browser_execution: true,
    desktop_companion: false,
    workspace_read: false,
    workspace_write: false,
  });
  const [newSiteOrigin, setNewSiteOrigin] = useState(window.location.origin);
  const [newSiteLabel, setNewSiteLabel] = useState('TwinMe Local Fixture Archive');
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [errMsg, setErrMsg] = useState<string | null>(null);

  useEffect(() => {
    if (workspace?.profile) {
      if (workspace.profile.displayName) setDisplayName(workspace.profile.displayName);
      if (workspace.profile.headline) setHeadline(workspace.profile.headline);
      if (workspace.profile.timezone) setTimezone(workspace.profile.timezone);
      if (workspace.profile.primaryGoal) setPrimaryGoal(workspace.profile.primaryGoal);
      if (workspace.profile.workingConstraints?.length) {
        setConstraintsText(workspace.profile.workingConstraints.join('\n'));
      }
    }
  }, [workspace?.profile]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setErrMsg(null);
    setFeedback(null);
    try {
      await completeOnboarding({
        displayName,
        headline,
        timezone,
        primaryGoal,
        workingConstraints: constraintsText
          .split('\n')
          .map((s) => s.trim())
          .filter(Boolean),
        consents,
      });
      // Automatically allowlist the current app origin for safe local fixture testing if user enabled teach/browser
      if (consents.teach_observation || consents.browser_execution) {
        await grantSite(window.location.origin, 'TwinMe Safe Research Fixture', consents.teach_observation, consents.browser_execution);
      }
      setFeedback('Individual twin established and consent grants saved.');
      setTimeout(() => navigate('/twin'), 500);
    } catch (err) {
      setErrMsg(err instanceof Error ? err.message : 'Onboarding failed.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <LayoutShell title="Consent-First Onboarding">
      <div className="space-y-8 max-w-4xl">
        {/* Account Choice */}
        <section className="p-6 bg-white border border-slate-200 rounded-lg space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <h2 className="font-display text-lg font-semibold text-slate-900">1. Individual Account Scope</h2>
              <p className="text-sm text-slate-600">
                Use a guest individual workspace immediately with zero external accounts, or sign in with Google to bind your twin ID.
              </p>
            </div>
            <StateBadge state={firebaseUser ? 'live' : 'demo'} detail={firebaseUser ? `Signed in: ${firebaseUser.email}` : 'Guest Individual Session'} />
          </div>

          <div className="flex flex-wrap items-center gap-3">
            {!firebaseUser ? (
              <button
                type="button"
                onClick={() => signInGoogle().catch((e) => setErrMsg(e.message))}
                className="inline-flex items-center gap-2.5 px-4 py-2 text-sm font-medium bg-white border border-slate-300 rounded-md hover:bg-slate-50 text-slate-800"
              >
                <svg className="w-4 h-4" viewBox="0 0 48 48" aria-hidden="true">
                  <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
                  <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
                  <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
                  <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
                </svg>
                <span>Sign in with Google</span>
              </button>
            ) : (
              <button
                type="button"
                onClick={() => signOutAccount()}
                className="px-4 py-2 text-sm font-medium border border-slate-300 rounded-md bg-white hover:bg-slate-50"
              >
                Sign out to Guest Mode
              </button>
            )}
          </div>
        </section>

        {/* Individual Twin Profile + Consent Scopes */}
        <form onSubmit={handleSubmit} className="p-6 bg-white border border-slate-200 rounded-lg space-y-6">
          <div>
            <h2 className="font-display text-lg font-semibold text-slate-900">2. Personal Twin Identity & Goals</h2>
            <p className="text-sm text-slate-600">Belongs strictly to one individual person—never a company, team directory, or CRM.</p>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block space-y-1.5 text-sm">
              <span className="font-medium text-slate-800">Your Name *</span>
              <input
                required
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="e.g. Maya Chen"
                className="w-full px-3 py-2 border border-slate-300 rounded-md bg-white"
              />
            </label>

            <label className="block space-y-1.5 text-sm">
              <span className="font-medium text-slate-800">Personal Focus / Role</span>
              <input
                value={headline}
                onChange={(e) => setHeadline(e.target.value)}
                placeholder="e.g. Independent Researcher"
                className="w-full px-3 py-2 border border-slate-300 rounded-md bg-white"
              />
            </label>

            <label className="block space-y-1.5 text-sm">
              <span className="font-medium text-slate-800">Working Timezone</span>
              <input
                value={timezone}
                onChange={(e) => setTimezone(e.target.value)}
                className="w-full px-3 py-2 border border-slate-300 rounded-md bg-white font-mono text-xs"
              />
            </label>

            <label className="block space-y-1.5 text-sm">
              <span className="font-medium text-slate-800">Primary Goal for Twin</span>
              <input
                value={primaryGoal}
                onChange={(e) => setPrimaryGoal(e.target.value)}
                placeholder="e.g. Automate safe weekly literature scans"
                className="w-full px-3 py-2 border border-slate-300 rounded-md bg-white"
              />
            </label>
          </div>

          <label className="block space-y-1.5 text-sm">
            <span className="font-medium text-slate-800">Personal Working Constraints (one per line)</span>
            <textarea
              rows={3}
              value={constraintsText}
              onChange={(e) => setConstraintsText(e.target.value)}
              placeholder="Never send emails without explicit draft review&#10;Only run browser tasks on allowlisted domains"
              className="w-full px-3 py-2 border border-slate-300 rounded-md bg-white text-sm"
            />
          </label>

          <div className="pt-4 border-t border-slate-200 space-y-3">
            <h3 className="font-display text-base font-semibold text-slate-900">3. Explicit Consent Grants (Withdraw Anytime)</h3>
            <div className="divide-y divide-slate-200 border border-slate-200 rounded-md">
              {(workspace?.consents || []).map((c) => {
                const checked = workspace?.profile.established ? c.granted : consents[c.scope];
                return (
                  <div key={c.scope} className="p-3.5 flex items-start justify-between gap-4">
                    <div className="space-y-0.5">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-slate-900">{c.label}</span>
                        {!c.available && <StateBadge state="disabled" detail="Unavailable" />}
                      </div>
                      <p className="text-xs text-slate-600">{c.unavailableReason || c.description}</p>
                    </div>
                    <input
                      type="checkbox"
                      aria-label={c.label}
                      disabled={!c.available}
                      checked={Boolean(checked)}
                      onChange={(e) => {
                        const val = e.target.checked;
                        setConsents((prev) => ({ ...prev, [c.scope]: val }));
                        if (workspace?.profile.established) {
                          void toggleConsent(c.scope, val);
                        }
                      }}
                      className="mt-1 h-4 w-4 accent-blue-900"
                    />
                  </div>
                );
              })}
            </div>
          </div>

          {errMsg && <p className="text-sm text-red-700 font-medium">{errMsg}</p>}
          {feedback && <p className="text-sm text-emerald-700 font-medium">{feedback}</p>}

          <div className="flex items-center gap-3">
            <button
              type="submit"
              disabled={saving}
              className="px-5 py-2.5 text-sm font-semibold bg-blue-900 text-white rounded-md hover:bg-blue-800 disabled:opacity-50"
            >
              {saving ? 'Saving Twin...' : workspace?.profile.established ? 'Save Onboarding Preferences' : 'Create My Personal Twin'}
            </button>
          </div>
        </form>

        {/* Per-site grants */}
        <section className="p-6 bg-white border border-slate-200 rounded-lg space-y-4">
          <h2 className="font-display text-base font-semibold text-slate-900">4. Approved Website Allowlist</h2>
          <p className="text-sm text-slate-600">
            Neither Teach Mode nor the Playwright Agent can act on a website unless its origin is explicitly granted here.
          </p>

          <div className="flex flex-wrap gap-2">
            <input
              value={newSiteOrigin}
              onChange={(e) => setNewSiteOrigin(e.target.value)}
              placeholder="http://localhost:3000"
              className="flex-1 min-w-[220px] px-3 py-2 text-sm border border-slate-300 rounded-md font-mono"
            />
            <input
              value={newSiteLabel}
              onChange={(e) => setNewSiteLabel(e.target.value)}
              placeholder="Site label"
              className="w-56 px-3 py-2 text-sm border border-slate-300 rounded-md"
            />
            <button
              type="button"
              onClick={() => grantSite(newSiteOrigin, newSiteLabel, true, true)}
              className="px-4 py-2 text-sm font-semibold bg-slate-900 text-white rounded-md hover:bg-slate-800"
            >
              Grant Teach + Agent
            </button>
          </div>

          {workspace?.siteGrants.length ? (
            <div className="divide-y divide-slate-200 border border-slate-200 rounded-md">
              {workspace.siteGrants.map((g) => (
                <div key={g.origin} className="p-3 flex flex-wrap items-center justify-between gap-3 text-sm">
                  <div>
                    <p className="font-medium text-slate-900">{g.label}</p>
                    <p className="text-xs font-mono text-slate-500">
                      {g.origin} · Teach: {g.teachAllowed ? 'Allowed' : 'Off'} · Agent: {g.agentAllowed ? 'Allowed' : 'Off'}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => revokeSite(g.origin)}
                    className="px-3 py-1.5 text-xs font-semibold text-red-700 border border-red-200 rounded-md hover:bg-red-50"
                  >
                    Revoke Site
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-xs text-slate-500">No websites granted yet.</p>
          )}
        </section>
      </div>
    </LayoutShell>
  );
};
