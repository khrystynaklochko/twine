import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Check,
  Code,
  Copy,
  Download,
  Eye,
  EyeOff,
  Pause,
  Play,
  RefreshCw,
  Scissors,
  Sparkles,
  Trash2,
} from 'lucide-react';
import { LayoutShell } from '../components/LayoutShell';
import { StateBadge } from '../components/StateBadge';
import { useTwin } from '../context/TwinContext';
import type { ActionTrace, PlannedStep } from '../types/twin';

interface DecomposedDraft {
  name: string;
  intent: string;
  summary: string;
  preconditions: string[];
  inputs: Record<string, string>;
  steps: PlannedStep[];
  expectedOutcomes: string[];
  uncertaintyFlags: string[];
}

function buildSelector(el: Element): string {
  const testId = el.getAttribute('data-testid');
  if (testId) return `[data-testid="${testId}"]`;
  if (el.id) return `#${el.id}`;
  const name = el.getAttribute('name');
  if (name) return `${el.tagName.toLowerCase()}[name="${name}"]`;
  return el.tagName.toLowerCase();
}

export const TeachPage: React.FC = () => {
  const navigate = useNavigate();
  const { ownerId, workspace, apiFetch, grantSite, toggleConsent, refreshWorkspace } = useTwin();

  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const [framePath, setFramePath] = useState('/fixture/research');
  const [activeTrace, setActiveTrace] = useState<ActionTrace | null>(null);
  const [sessionTitle, setSessionTitle] = useState('Research Archive Lookup');
  const [targetOrigin, setTargetOrigin] = useState(window.location.origin);
  const [screenshotConsent, setScreenshotConsent] = useState(false);
  const [decomposed, setDecomposed] = useState<DecomposedDraft | null>(null);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [extFiles, setExtFiles] = useState<Array<{ name: string; content: string }>>([]);
  const [showExt, setShowExt] = useState(false);

  const teachConsent = workspace?.consents.find((c) => c.scope === 'teach_observation')?.granted;
  const siteGranted = workspace?.siteGrants.some((g) => g.origin === targetOrigin && g.teachAllowed);
  const savedTraces = workspace?.traces || [];

  // Poll workspace quietly while Teach page is open so live Chrome extension traces show up right away
  useEffect(() => {
    const timer = setInterval(() => {
      void refreshWorkspace();
    }, 4000);
    return () => clearInterval(timer);
  }, [refreshWorkspace]);

  // Keep activeTrace synced if an incoming Chrome recording receives new events
  useEffect(() => {
    if (!activeTrace) return;
    const latest = savedTraces.find((t) => t.id === activeTrace.id);
    if (latest && (latest.events.length !== activeTrace.events.length || latest.status !== activeTrace.status)) {
      setActiveTrace(latest);
    }
  }, [savedTraces, activeTrace]);

  const handleCopy = async (label: string, text: string) => {
    await navigator.clipboard.writeText(text);
    setCopiedKey(label);
    setTimeout(() => setCopiedKey(null), 1500);
  };

  const handleEnablePrerequisites = async () => {
    setErrorMsg(null);
    try {
      await toggleConsent('teach_observation', true);
      await grantSite(targetOrigin, 'Safe Research Fixture', true, true);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Unable to enable teach permission.');
    }
  };

  const handleStartSession = async () => {
    setErrorMsg(null);
    setDecomposed(null);
    try {
      const trace = await apiFetch<ActionTrace>('/api/teach/sessions', {
        method: 'POST',
        body: JSON.stringify({
          site: targetOrigin,
          title: sessionTitle,
          screenshotConsent,
        }),
      });
      // Record starting navigate event immediately so decomposed skills always start on the page
      const currentHref = iframeRef.current?.contentDocument?.location?.href || `${window.location.origin}${framePath}`;
      const withNav = await apiFetch<ActionTrace>(`/api/teach/sessions/${trace.id}/events`, {
        method: 'POST',
        body: JSON.stringify({
          event: {
            type: 'navigate',
            targetSelector: framePath,
            accessibleLabel: 'Open starting page',
            url: currentHref,
            valuePreview: '',
          },
        }),
      });
      setActiveTrace(withNav);
      await refreshWorkspace();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Could not start Teach session.');
    }
  };

  // Attach real DOM capture listeners to the same-origin fixture iframe ONLY when actively recording
  useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe || !activeTrace || activeTrace.status !== 'recording') return;

    let inputTimer: ReturnType<typeof setTimeout> | null = null;
    let lastInputSig = '';

    const attachListeners = () => {
      const doc = iframe.contentDocument;
      if (!doc) return;

      const sendCapturedEvent = async (
        type: 'click' | 'input' | 'select' | 'navigate',
        el: Element | null,
        valuePreview: string,
      ) => {
        const selector = type === 'navigate' ? doc.location.pathname : el ? buildSelector(el) : '';
        const label =
          type === 'navigate'
            ? doc.title || doc.location.pathname
            : (el?.getAttribute('aria-label') || el?.textContent || el?.getAttribute('placeholder') || el?.tagName || '')
                .trim()
                .slice(0, 120);
        try {
          const updated = await apiFetch<ActionTrace>(`/api/teach/sessions/${activeTrace.id}/events`, {
            method: 'POST',
            body: JSON.stringify({
              event: {
                type,
                targetSelector: selector,
                accessibleLabel: label,
                url: doc.location.href,
                valuePreview,
              },
            }),
          });
          setActiveTrace(updated);
        } catch (err) {
          setErrorMsg(err instanceof Error ? err.message : 'Capture blocked.');
        }
      };

      const onClick = (e: Event) => {
        const target = e.target as Element | null;
        if (!target) return;
        const btnOrLink = target.closest('button, a, [role="button"], input[type="submit"], input[type="checkbox"]') || target;
        const tag = btnOrLink.tagName.toLowerCase();
        if (['button', 'a'].includes(tag) || btnOrLink.getAttribute('type') === 'submit' || btnOrLink.getAttribute('type') === 'checkbox') {
          void sendCapturedEvent('click', btnOrLink, '');
        }
      };

      const onInput = (e: Event) => {
        const target = e.target as HTMLInputElement | null;
        if (!target || !['INPUT', 'TEXTAREA'].includes(target.tagName)) return;
        if (['checkbox', 'radio', 'submit', 'button'].includes((target.type || '').toLowerCase())) return;
        if (inputTimer) clearTimeout(inputTimer);
        const val = target.value || '';
        const sig = `${buildSelector(target)}:${val}`;
        inputTimer = setTimeout(() => {
          if (sig !== lastInputSig) {
            lastInputSig = sig;
            void sendCapturedEvent('input', target, val);
          }
        }, 250);
      };

      const onChange = (e: Event) => {
        const target = e.target as HTMLInputElement | HTMLSelectElement | null;
        if (!target) return;
        if (target.tagName.toLowerCase() === 'select') {
          void sendCapturedEvent('select', target, target.value || '');
        } else if (['INPUT', 'TEXTAREA'].includes(target.tagName) && !['checkbox', 'radio'].includes((target as HTMLInputElement).type)) {
          const val = target.value || '';
          const sig = `${buildSelector(target)}:${val}`;
          if (sig !== lastInputSig) {
            lastInputSig = sig;
            if (inputTimer) clearTimeout(inputTimer);
            void sendCapturedEvent('input', target, val);
          }
        }
      };

      doc.addEventListener('click', onClick, true);
      doc.addEventListener('input', onInput, true);
      doc.addEventListener('change', onChange, true);

      return () => {
        if (inputTimer) clearTimeout(inputTimer);
        doc.removeEventListener('click', onClick, true);
        doc.removeEventListener('input', onInput, true);
        doc.removeEventListener('change', onChange, true);
      };
    };

    let cleanup = attachListeners();
    const onLoad = () => {
      if (cleanup) cleanup();
      cleanup = attachListeners();
    };
    iframe.addEventListener('load', onLoad);
    return () => {
      iframe.removeEventListener('load', onLoad);
      if (cleanup) cleanup();
    };
  }, [activeTrace?.id, activeTrace?.status, apiFetch]);

  const handleTraceAction = async (
    action: 'pause' | 'resume' | 'finish' | 'trim_event' | 'redact_event' | 'discard',
    eventId?: string,
  ) => {
    if (!activeTrace) return;
    setErrorMsg(null);
    try {
      const res = await apiFetch<ActionTrace & { discarded?: boolean }>(`/api/teach/sessions/${activeTrace.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ action, eventId }),
      });
      if (res.discarded) {
        setActiveTrace(null);
        setDecomposed(null);
      } else {
        setActiveTrace(res);
      }
      await refreshWorkspace();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Trace update failed.');
    }
  };

  const handleDecompose = async () => {
    if (!activeTrace) return;
    setLoading(true);
    setErrorMsg(null);
    try {
      const draft = await apiFetch<DecomposedDraft>(`/api/teach/sessions/${activeTrace.id}/decompose`, {
        method: 'POST',
      });
      setDecomposed(draft);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Decomposition failed.');
    } finally {
      setLoading(false);
    }
  };

  const handleApproveSkill = async () => {
    if (!activeTrace || !decomposed) return;
    setLoading(true);
    setErrorMsg(null);
    try {
      await apiFetch('/api/skills', {
        method: 'POST',
        body: JSON.stringify({
          traceId: activeTrace.id,
          name: decomposed.name,
          intent: decomposed.intent,
          summary: decomposed.summary,
          preconditions: decomposed.preconditions,
          inputs: decomposed.inputs,
          allowedOrigins: [activeTrace.site],
          steps: decomposed.steps,
          expectedOutcomes: decomposed.expectedOutcomes,
          uncertaintyFlags: decomposed.uncertaintyFlags,
        }),
      });
      await refreshWorkspace();
      navigate('/skills');
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Could not save skill.');
    } finally {
      setLoading(false);
    }
  };

  const handleToggleExtension = async () => {
    if (!showExt && extFiles.length === 0) {
      const data = await apiFetch<{ files: Array<{ name: string; content: string }> }>('/api/artifacts/extension');
      setExtFiles(data.files);
    }
    setShowExt(!showExt);
  };

  return (
    <LayoutShell title="Teach by Demonstration">
      <div className="space-y-6">
        {/* Explicit Recording Banner */}
        {activeTrace?.status === 'recording' && (
          <div className="p-4 bg-slate-900 text-white rounded-lg flex flex-wrap items-center justify-between gap-4">
            <div className="space-y-0.5">
              <p className="text-sm font-semibold">TEACH RECORDING ACTIVE on {activeTrace.site}</p>
              <p className="text-xs text-slate-300 font-mono">
                Session {activeTrace.sessionId} · {activeTrace.events.length} redacted event(s) captured · Passwords/tokens auto-redacted
              </p>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => handleTraceAction('pause')}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-white text-slate-900 rounded"
              >
                <Pause className="w-3.5 h-3.5" aria-hidden="true" />
                <span>Pause</span>
              </button>
              <button
                type="button"
                onClick={() => handleTraceAction('finish')}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-emerald-600 text-white rounded"
              >
                <Check className="w-3.5 h-3.5" aria-hidden="true" />
                <span>Finish &amp; Review</span>
              </button>
            </div>
          </div>
        )}

        {/* Chrome Browser Extension Bridge + Studio Pairing */}
        <section className="p-6 bg-white border border-slate-200 rounded-lg space-y-4">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="space-y-1 max-w-2xl">
              <h2 className="font-display text-base font-semibold text-slate-900">
                1. Teach From Google Chrome or Built-In Fixture Browser
              </h2>
              <p className="text-sm text-slate-600">
                Load the TwinMe Chrome MV3 extension to record your clicks, typing, and navigation on any website in Google Chrome and stream them live to your Twin, or demonstrate directly in the safe sandbox below.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <a
                href="/api/artifacts/extension.zip"
                download="twinme-chrome-extension.zip"
                className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold bg-slate-900 text-white rounded-md hover:bg-slate-800 whitespace-nowrap"
              >
                <Download className="w-3.5 h-3.5" aria-hidden="true" />
                <span>Download Chrome Extension (.zip)</span>
              </a>
              <button
                type="button"
                onClick={handleToggleExtension}
                className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium border border-slate-300 rounded-md hover:bg-slate-50 whitespace-nowrap"
              >
                <Code className="w-3.5 h-3.5" aria-hidden="true" />
                <span>{showExt ? 'Hide Source' : 'Inspect Source'}</span>
              </button>
            </div>
          </div>

          {/* Pairing Credentials for Chrome Extension */}
          <div className="grid gap-3 md:grid-cols-2 p-3.5 bg-slate-50 border border-slate-200 rounded-md text-xs">
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0">
                <p className="font-medium text-slate-600">TwinMe Studio URL (paste in extension)</p>
                <p className="font-mono text-slate-900 truncate">{window.location.origin}</p>
              </div>
              <button
                type="button"
                onClick={() => handleCopy('url', window.location.origin)}
                className="inline-flex items-center gap-1 px-2.5 py-1.5 border border-slate-300 bg-white rounded hover:bg-slate-100 shrink-0"
              >
                <Copy className="w-3 h-3" />
                <span>{copiedKey === 'url' ? 'Copied' : 'Copy'}</span>
              </button>
            </div>

            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0">
                <p className="font-medium text-slate-600">Your Twin Owner ID (paste in extension)</p>
                <p className="font-mono text-slate-900 truncate">{ownerId}</p>
              </div>
              <button
                type="button"
                onClick={() => handleCopy('owner', ownerId)}
                className="inline-flex items-center gap-1 px-2.5 py-1.5 border border-slate-300 bg-white rounded hover:bg-slate-100 shrink-0"
              >
                <Copy className="w-3 h-3" />
                <span>{copiedKey === 'owner' ? 'Copied' : 'Copy'}</span>
              </button>
            </div>
          </div>

          {(!teachConsent || !siteGranted) && (
            <div className="p-4 bg-blue-50 border border-blue-200 rounded-md flex flex-wrap items-center justify-between gap-3 text-sm">
              <p className="text-blue-950">
                Teach Mode requires explicit consent (<code>teach_observation</code>) and an origin grant for{' '}
                <span className="font-mono">{targetOrigin}</span>.
              </p>
              <button
                type="button"
                onClick={handleEnablePrerequisites}
                className="px-3.5 py-1.5 text-xs font-semibold bg-blue-900 text-white rounded-md hover:bg-blue-800 whitespace-nowrap"
              >
                Grant Teach Permission
              </button>
            </div>
          )}

          <div className="grid gap-3 md:grid-cols-[1fr_1fr_auto] items-end">
            <label className="block space-y-1 text-xs font-medium text-slate-700">
              <span>Workflow Title</span>
              <input
                value={sessionTitle}
                onChange={(e) => setSessionTitle(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md"
              />
            </label>
            <label className="block space-y-1 text-xs font-medium text-slate-700">
              <span>Approved Origin</span>
              <input
                value={targetOrigin}
                onChange={(e) => setTargetOrigin(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md font-mono"
              />
            </label>
            <div className="flex items-center gap-2">
              <StateBadge
                state={teachConsent && siteGranted ? 'live' : 'permission_required'}
                detail={teachConsent && siteGranted ? 'Approved' : 'Grant Needed'}
              />
              <button
                type="button"
                disabled={!teachConsent || !siteGranted || activeTrace?.status === 'recording'}
                onClick={handleStartSession}
                className="px-4 py-2 text-sm font-semibold bg-blue-900 text-white rounded-md hover:bg-blue-800 disabled:opacity-50 whitespace-nowrap"
              >
                Start Teach Recording
              </button>
            </div>
          </div>

          <label className="inline-flex items-center gap-2 text-xs text-slate-600 cursor-pointer">
            <input
              type="checkbox"
              checked={screenshotConsent}
              onChange={(e) => setScreenshotConsent(e.target.checked)}
            />
            <span>Consent to attach viewport screenshots on agent verification runs (optional)</span>
          </label>

          {errorMsg && <p className="text-sm text-red-700 font-medium">{errorMsg}</p>}
        </section>

        {/* Chrome MV3 Extension Source Viewer */}
        {showExt && (
          <section className="p-6 bg-white border border-slate-200 rounded-lg space-y-3">
            <h3 className="font-display text-sm font-semibold text-slate-900">
              Chrome MV3 Extension Setup (chrome://extensions → Developer mode → Load unpacked)
            </h3>
            <p className="text-xs text-slate-600">
              Unzip the downloaded archive, load the folder in Google Chrome, enter your Studio URL and Twin Owner ID in the popup, and click &ldquo;Enable Teach Mode on This Site&rdquo; on any webpage.
            </p>
            <div className="grid gap-3 md:grid-cols-2">
              {extFiles.map((f) => (
                <div key={f.name} className="border border-slate-200 rounded-md overflow-hidden">
                  <div className="px-3 py-1.5 bg-slate-100 text-xs font-mono font-semibold text-slate-800 border-b border-slate-200">
                    {f.name}
                  </div>
                  <pre className="p-3 text-[11px] font-mono text-slate-700 overflow-x-auto max-h-40">{f.content}</pre>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Incoming Chrome / Saved Traces Selector */}
        {savedTraces.length > 0 && (
          <section className="p-4 bg-white border border-slate-200 rounded-lg space-y-2">
            <div className="flex items-center justify-between">
              <p className="text-xs font-semibold text-slate-800">
                Captured Action Traces ({savedTraces.length}) — Select any Chrome or sandbox recording to review &amp; convert to a skill
              </p>
              <button
                type="button"
                onClick={() => refreshWorkspace()}
                className="inline-flex items-center gap-1 text-xs text-blue-800 hover:underline"
              >
                <RefreshCw className="w-3 h-3" /> Sync
              </button>
            </div>
            <div className="flex flex-wrap gap-2">
              {savedTraces.slice(0, 8).map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => {
                    setActiveTrace(t);
                    setDecomposed(null);
                  }}
                  className={`px-3 py-1.5 text-xs rounded-md border text-left ${
                    activeTrace?.id === t.id
                      ? 'bg-slate-900 text-white border-slate-900'
                      : 'bg-slate-50 text-slate-800 border-slate-200 hover:bg-slate-100'
                  }`}
                >
                  <span className="font-semibold">{t.title}</span>{' '}
                  <span className="font-mono opacity-80">({t.events.length} steps · {t.status})</span>
                </button>
              ))}
            </div>
          </section>
        )}

        {/* Split: Live Fixture Viewport + Trace Review */}
        <div className="grid gap-6 lg:grid-cols-[1.2fr_0.8fr] items-start">
          {/* Interactive Safe Fixture Frame */}
          <section className="bg-white border border-slate-200 rounded-lg overflow-hidden">
            <div className="px-4 py-2.5 border-b border-slate-200 flex flex-wrap items-center justify-between gap-2 bg-slate-50 text-xs">
              <span className="font-mono text-slate-700">Live Demonstration Browser: {framePath}</span>
              <div className="flex items-center gap-2">
                {['/fixture/research', '/fixture/research-v2', '/fixture/adversarial'].map((p) => (
                  <button
                    key={p}
                    type="button"
                    onClick={() => setFramePath(p)}
                    className={`px-2 py-1 rounded font-mono ${
                      framePath === p ? 'bg-slate-900 text-white' : 'bg-white border border-slate-200 text-slate-700'
                    }`}
                  >
                    {p.replace('/fixture/', '')}
                  </button>
                ))}
              </div>
            </div>
            <iframe
              ref={iframeRef}
              title="OpenKnowledge Research Archive Demonstration Frame"
              src={framePath}
              className="w-full h-[520px] border-0 bg-white"
            />
          </section>

          {/* Chronological Trace Review & Redaction */}
          <section className="p-5 bg-white border border-slate-200 rounded-lg space-y-4">
            <div className="flex items-center justify-between gap-2">
              <h2 className="font-display text-base font-semibold text-slate-900">2. Trace Review &amp; Redaction</h2>
              {activeTrace && <span className="text-xs font-mono text-slate-500">{activeTrace.status}</span>}
            </div>

            {!activeTrace ? (
              <p className="text-sm text-slate-500 py-8 text-center border border-dashed border-slate-200 rounded-md">
                Click &ldquo;Start Teach Recording&rdquo;, then type a search query (e.g. &ldquo;capability&rdquo;) and click &ldquo;Search Papers&rdquo; in the frame — or stream actions from Google Chrome!
              </p>
            ) : (
              <>
                <div className="flex flex-wrap gap-2">
                  {activeTrace.status === 'paused' && (
                    <button
                      type="button"
                      onClick={() => handleTraceAction('resume')}
                      className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-semibold bg-slate-900 text-white rounded"
                    >
                      <Play className="w-3.5 h-3.5" aria-hidden="true" />
                      <span>Resume</span>
                    </button>
                  )}
                  {activeTrace.status !== 'ready_for_review' && activeTrace.status !== 'approved' && (
                    <button
                      type="button"
                      onClick={() => handleTraceAction('finish')}
                      className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-semibold border border-slate-300 rounded hover:bg-slate-50"
                    >
                      <Check className="w-3.5 h-3.5" aria-hidden="true" />
                      <span>Stop &amp; Review</span>
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => handleTraceAction('discard')}
                    className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-semibold text-red-700 border border-red-200 rounded hover:bg-red-50"
                  >
                    <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                    <span>Discard Trace</span>
                  </button>
                </div>

                <div className="divide-y divide-slate-200 border border-slate-200 rounded-md max-h-72 overflow-y-auto">
                  {activeTrace.events.length === 0 ? (
                    <p className="p-4 text-xs text-slate-500">Waiting for your clicks, typing, or navigation...</p>
                  ) : (
                    activeTrace.events.map((ev) => (
                      <div key={ev.id} className="p-3 text-xs space-y-1">
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-mono font-semibold text-slate-900 break-all">
                            {ev.index + 1}. {ev.type.toUpperCase()} {ev.targetSelector}
                          </span>
                          <div className="flex items-center gap-1.5 shrink-0">
                            <button
                              type="button"
                              onClick={() => handleTraceAction('redact_event', ev.id)}
                              title="Redact input value"
                              className="p-1 text-slate-600 hover:text-slate-900"
                            >
                              {ev.redacted ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                            </button>
                            <button
                              type="button"
                              onClick={() => handleTraceAction('trim_event', ev.id)}
                              title="Trim step"
                              className="p-1 text-red-600 hover:text-red-800"
                            >
                              <Scissors className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>
                        <p className="text-slate-600">
                          Label: {ev.accessibleLabel || '—'}
                          {ev.valuePreview ? ` · Value: "${ev.valuePreview}"` : ''}
                        </p>
                      </div>
                    ))
                  )}
                </div>

                {activeTrace.events.length > 0 && (
                  <button
                    type="button"
                    disabled={loading}
                    onClick={handleDecompose}
                    className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-semibold bg-blue-900 text-white rounded-md hover:bg-blue-800 disabled:opacity-50"
                  >
                    <Sparkles className="w-4 h-4" aria-hidden="true" />
                    <span>{loading ? 'Extracting Skill with Gemini...' : 'Extract Parameterized Skill'}</span>
                  </button>
                )}
              </>
            )}

            {/* Gemini Decomposed Skill Preview */}
            {decomposed && (
              <div className="pt-4 border-t border-slate-200 space-y-3">
                <h3 className="font-display text-sm font-semibold text-slate-900">3. Review &amp; Approve Learned Skill</h3>
                <label className="block text-xs space-y-1">
                  <span className="font-medium text-slate-700">Skill Name</span>
                  <input
                    value={decomposed.name}
                    onChange={(e) => setDecomposed({ ...decomposed, name: e.target.value })}
                    className="w-full px-2.5 py-1.5 border border-slate-300 rounded text-sm"
                  />
                </label>
                <p className="text-xs text-slate-600">{decomposed.summary}</p>
                <div className="text-xs space-y-1">
                  <p className="font-medium text-slate-700">Extracted Input Variables:</p>
                  {Object.keys(decomposed.inputs).length === 0 ? (
                    <p className="text-slate-500 font-mono">None detected</p>
                  ) : (
                    Object.entries(decomposed.inputs).map(([k, v]) => (
                      <p key={k} className="font-mono text-slate-700">
                        {k} = &ldquo;{v}&rdquo;
                      </p>
                    ))
                  )}
                </div>
                <div className="text-xs space-y-1">
                  <p className="font-medium text-slate-700">Steps ({decomposed.steps.length}):</p>
                  <ol className="list-decimal pl-4 space-y-1 text-slate-600">
                    {decomposed.steps.map((s) => (
                      <li key={s.id}>
                        <span className="font-mono">{s.action}</span> {s.targetSelector} — {s.description}
                      </li>
                    ))}
                  </ol>
                </div>
                {decomposed.uncertaintyFlags.length > 0 && (
                  <div className="p-2.5 bg-amber-50 border border-amber-200 rounded text-xs text-amber-900">
                    Uncertainty notes: {decomposed.uncertaintyFlags.join('; ')}
                  </div>
                )}
                <button
                  type="button"
                  disabled={loading}
                  onClick={handleApproveSkill}
                  className="w-full px-4 py-2.5 text-sm font-semibold bg-emerald-700 text-white rounded-md hover:bg-emerald-800 disabled:opacity-50"
                >
                  Approve &amp; Save to Skill Library
                </button>
              </div>
            )}
          </section>
        </div>
      </div>
    </LayoutShell>
  );
};
