import React from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, CheckCircle2, Circle } from 'lucide-react';
import { LayoutShell } from '../components/LayoutShell';
import { StateBadge } from '../components/StateBadge';
import { TwinAvatar } from '../components/TwinAvatar';
import { useTwin } from '../context/TwinContext';

export const LandingPage: React.FC = () => {
  const { ownerId, workspace, health, loading, error } = useTwin();

  const established = Boolean(workspace?.profile.established);
  const memoriesCount = workspace?.memories.length ?? 0;
  const tracesCount = workspace?.traces.length ?? 0;
  const skillsCount = workspace?.skills.length ?? 0;
  const verifiedRunsCount = workspace?.runs.filter((r) => r.status === 'verified').length ?? 0;

  const stages = [
    {
      step: '01',
      title: 'Establish Individual Twin',
      description: 'Create your single-person twin with explicit consent grants and zero hidden integrations.',
      done: established,
      to: '/onboarding',
      cta: established ? 'Review Onboarding' : 'Start Onboarding',
    },
    {
      step: '02',
      title: 'Teach by Demonstration',
      description: 'Enable Teach Mode on one approved site, perform a short workflow, and inspect redacted events.',
      done: tracesCount > 0,
      to: '/teach',
      cta: 'Open Teach Mode',
    },
    {
      step: '03',
      title: 'Approve Parameterized Skill',
      description: 'Let Gemini extract variables and preconditions from your trace, then approve it as a versioned skill.',
      done: skillsCount > 0,
      to: '/skills',
      cta: 'Review Skills',
    },
    {
      step: '04',
      title: 'Execute in Supervised Agent Mode',
      description: 'Run the skill on a new query in Shadow or Supervised Playwright mode with fresh approval gates.',
      done: verifiedRunsCount > 0,
      to: '/agent',
      cta: 'Open Agent Cockpit',
    },
    {
      step: '05',
      title: 'Verify, Correct & Own Data',
      description: 'Inspect screenshots, correct drifted steps to bump skill versions, or export/delete everything.',
      done: Boolean(workspace?.runs.length),
      to: '/history',
      cta: 'Inspect Runs & Ledger',
    },
  ];

  return (
    <LayoutShell title="Personal Twin Studio">
      <div className="space-y-8">
        {error && (
          <div className="p-4 bg-red-50 border border-red-200 rounded-lg text-sm text-red-800">
            {error}
          </div>
        )}

        {/* Hero / Individual Summary */}
        <section className="p-6 lg:p-8 bg-white border border-slate-200 rounded-lg grid gap-6 lg:grid-cols-[1fr_280px] items-start">
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-3 text-xs text-slate-500">
              <span>Single-Individual Scope</span>
              <span aria-hidden="true">·</span>
              <StateBadge state={loading ? 'pending' : established ? 'live' : 'permission_required'} detail={established ? 'Twin Established' : 'Empty Twin State'} />
            </div>

            <h2 className="font-display text-2xl lg:text-3xl font-bold tracking-tight text-slate-900 max-w-2xl">
              {established
                ? `${workspace?.profile.displayName}'s Personal Twin & Action Studio`
                : 'Establish one personal digital twin you own and control.'}
            </h2>

            <p className="text-sm lg:text-base text-slate-600 max-w-2xl leading-relaxed">
              {established
                ? workspace?.profile.primaryGoal || 'Your personal twin stores user-approved memory, learns only from explicit demonstrations, and executes supervised actions on allowlisted origins.'
                : 'No pre-populated fake memories, runs, or company directories. Start by declaring your identity and consent scopes, then teach your twin one real workflow.'}
            </p>

            <div className="flex flex-wrap items-center gap-3 pt-1">
              <Link
                to={established ? '/teach' : '/onboarding'}
                className="inline-flex items-center gap-2 px-4 py-2.5 text-sm font-semibold bg-blue-900 text-white rounded-md hover:bg-blue-800 transition-colors whitespace-nowrap"
              >
                <span>{established ? 'Teach a New Workflow' : 'Establish Your Twin'}</span>
                <ArrowRight className="w-4 h-4" aria-hidden="true" />
              </Link>
              <Link
                to="/demo"
                className="inline-flex items-center gap-2 px-4 py-2.5 text-sm font-semibold border border-slate-300 bg-white text-slate-800 rounded-md hover:bg-slate-50 transition-colors whitespace-nowrap"
              >
                <span>Run Live 60s Demo</span>
              </Link>
              <Link
                to="/agent"
                className="inline-flex items-center gap-2 px-4 py-2.5 text-sm font-medium text-slate-700 hover:text-slate-900 hover:underline whitespace-nowrap"
              >
                <span>Open Agent Cockpit</span>
              </Link>
            </div>
          </div>

          <div className="p-5 bg-slate-50 border border-slate-200 rounded-lg space-y-4">
            <div className="flex items-center gap-3">
              <TwinAvatar ownerId={ownerId} mode={workspace?.activeMode ?? 'twin'} size={52} />
              <div className="min-w-0">
                <p className="text-xs font-medium text-slate-500">Owner Identity</p>
                <p className="text-sm font-mono font-semibold text-slate-900 truncate">{ownerId}</p>
              </div>
            </div>

            <dl className="grid grid-cols-2 gap-3 pt-3 border-t border-slate-200 text-xs">
              <div>
                <dt className="text-slate-500">Memories</dt>
                <dd className="font-mono text-base font-semibold text-slate-900 tabular-nums">{memoriesCount}</dd>
              </div>
              <div>
                <dt className="text-slate-500">Saved Skills</dt>
                <dd className="font-mono text-base font-semibold text-slate-900 tabular-nums">{skillsCount}</dd>
              </div>
              <div>
                <dt className="text-slate-500">Approved Traces</dt>
                <dd className="font-mono text-base font-semibold text-slate-900 tabular-nums">{tracesCount}</dd>
              </div>
              <div>
                <dt className="text-slate-500">Verified Runs</dt>
                <dd className="font-mono text-base font-semibold text-slate-900 tabular-nums">{verifiedRunsCount}</dd>
              </div>
            </dl>
          </div>
        </section>

        {/* Honest Service Connection Status */}
        <section className="bg-white border border-slate-200 rounded-lg p-6 space-y-4">
          <div className="flex items-center justify-between gap-4">
            <h3 className="font-display text-base font-semibold text-slate-900">Real-State Service Contract</h3>
            <span className="text-xs text-slate-500">Reflects live backend & grant state</span>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 text-sm">
            <div className="p-3.5 border border-slate-200 rounded-md space-y-1">
              <p className="font-medium text-slate-900">Gemini 4 Hydrogen</p>
              <StateBadge state={health?.geminiConfigured ? 'live' : 'error'} detail={health?.geminiConfigured ? 'Live Server SDK' : 'API Key Missing'} />
            </div>
            <div className="p-3.5 border border-slate-200 rounded-md space-y-1">
              <p className="font-medium text-slate-900">Playwright Browser</p>
              <StateBadge state="live" detail="Headless Chromium Ready" />
            </div>
            <div className="p-3.5 border border-slate-200 rounded-md space-y-1">
              <p className="font-medium text-slate-900">Google Workspace</p>
              <StateBadge state="disabled" detail="OAuth Not Enabled" />
            </div>
            <div className="p-3.5 border border-slate-200 rounded-md space-y-1">
              <p className="font-medium text-slate-900">macOS Companion</p>
              <StateBadge
                state={workspace?.macCompanion.paired ? 'pending' : 'disabled'}
                detail={workspace?.macCompanion.paired ? 'Token Issued (Unverified)' : 'Not Paired'}
              />
            </div>
          </div>
        </section>

        {/* 5-Stage Experience Map */}
        <section className="bg-white border border-slate-200 rounded-lg p-6 space-y-5">
          <div>
            <h3 className="font-display text-base font-semibold text-slate-900">Personal Twin-to-Agent Experience Map</h3>
            <p className="text-sm text-slate-600 mt-0.5">Every step connects to live persistence, explicit consent, and verifiable outputs.</p>
          </div>

          <div className="divide-y divide-slate-200">
            {stages.map((s) => (
              <div key={s.step} className="py-4 first:pt-0 last:pb-0 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div className="flex items-start gap-3.5">
                  {s.done ? (
                    <CheckCircle2 className="w-5 h-5 text-emerald-700 shrink-0 mt-0.5" aria-hidden="true" />
                  ) : (
                    <Circle className="w-5 h-5 text-slate-300 shrink-0 mt-0.5" aria-hidden="true" />
                  )}
                  <div>
                    <p className="text-sm font-semibold text-slate-900">
                      <span className="font-mono text-slate-500 mr-2">{s.step}.</span>
                      {s.title}
                    </p>
                    <p className="text-sm text-slate-600 mt-0.5">{s.description}</p>
                  </div>
                </div>
                <Link
                  to={s.to}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold border border-slate-300 rounded-md bg-white text-slate-800 hover:bg-slate-50 whitespace-nowrap shrink-0 self-start sm:self-center"
                >
                  <span>{s.cta}</span>
                  <ArrowRight className="w-3.5 h-3.5" aria-hidden="true" />
                </Link>
              </div>
            ))}
          </div>
        </section>
      </div>
    </LayoutShell>
  );
};
