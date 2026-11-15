import fs from 'node:fs';
import { chromium } from 'playwright';
import type { Browser, Page } from 'playwright';
import type {
  AgentRun,
  PlannedStep,
  StepResult,
  VerifiedOutcome,
} from '../src/types/twin.ts';
import { twinStore } from './store.ts';
import {
  authorizeActionStep,
  issuePendingApproval,
  normalizeOrigin,
  sanitizeUntrustedPageText,
  verifyAndConsumeApprovalToken,
} from './permissionBroker.ts';
import { adaptStepOnChangedDom } from './geminiService.ts';

const HEADLESS_SHELL_CANDIDATES = [
  '/ms-playwright/chromium_headless_shell-1247/chrome-headless-shell-linux64/chrome-headless-shell',
  '/ms-playwright/chromium_headless_shell-1247/chrome-headless-shell-linux64/headless_shell',
];

function resolveChromiumExecutable(): string | undefined {
  for (const candidate of HEADLESS_SHELL_CANDIDATES) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }
  return undefined;
}

type RunListener = (run: AgentRun) => void;

class BrowserAgentExecutor {
  private listeners = new Map<string, Set<RunListener>>();
  private activeControllers = new Map<string, AbortController>();

  public subscribe(runId: string, listener: RunListener): () => void {
    if (!this.listeners.has(runId)) {
      this.listeners.set(runId, new Set());
    }
    this.listeners.get(runId)!.add(listener);
    return () => {
      this.listeners.get(runId)?.delete(listener);
    };
  }

  private emit(run: AgentRun) {
    twinStore.saveRun(run.ownerId, run);
    const subs = this.listeners.get(run.id);
    if (subs) {
      for (const fn of subs) {
        try {
          fn(run);
        } catch {
          // ignore listener errors
        }
      }
    }
  }

  public abortRun(ownerId: string, runId: string, reason: 'paused' | 'cancelled'): AgentRun | null {
    const state = twinStore.getOwner(ownerId);
    const run = state?.runs.find((r) => r.id === runId);
    if (!run) return null;

    const controller = this.activeControllers.get(runId);
    if (controller) {
      controller.abort();
      this.activeControllers.delete(runId);
    }

    run.status = reason;
    run.error = reason === 'cancelled' ? 'Emergency stop triggered by user.' : 'Run paused by user.';
    run.updatedAt = new Date().toISOString();
    twinStore.appendAudit(ownerId, 'run_abort', 'info', `Run ${runId} set to ${reason}.`);
    this.emit(run);
    return run;
  }

  public async startRun(ownerId: string, run: AgentRun, serverOrigin: string): Promise<void> {
    if (run.mode === 'shadow') {
      await this.executeShadowSimulation(ownerId, run, serverOrigin);
      return;
    }

    if (run.mode === 'twin' || run.mode === 'paused') {
      run.status = 'failed';
      run.error = `Cannot execute browser actions while mode is "${run.mode}".`;
      run.updatedAt = new Date().toISOString();
      this.emit(run);
      return;
    }

    await this.executePlaywrightRun(ownerId, run, serverOrigin, 0);
  }

  public async resumeAfterApproval(
    ownerId: string,
    runId: string,
    approvalToken: string | undefined,
    serverOrigin: string,
  ): Promise<{ ok: boolean; run?: AgentRun; error?: string }> {
    const state = twinStore.getOwner(ownerId);
    const run = state?.runs.find((r) => r.id === runId);
    if (!run) {
      return { ok: false, error: 'Run not found.' };
    }
    if (run.status !== 'awaiting_approval') {
      return { ok: false, error: `Run is not awaiting approval (current status: ${run.status}).` };
    }

    const check = verifyAndConsumeApprovalToken(ownerId, run, approvalToken);
    if (!check.valid) {
      return { ok: false, error: check.reason };
    }

    const pendingStepId = run.pendingApproval?.stepId;
    const resumeIdx = run.plannedSteps.findIndex((s) => s.id === pendingStepId);
    run.pendingApproval = undefined;
    run.status = 'running';
    run.updatedAt = new Date().toISOString();
    this.emit(run);

    void this.executePlaywrightRun(ownerId, run, serverOrigin, Math.max(0, resumeIdx), true);
    return { ok: true, run };
  }

  private async executeShadowSimulation(ownerId: string, run: AgentRun, serverOrigin: string): Promise<void> {
    run.status = 'running';
    run.updatedAt = new Date().toISOString();
    this.emit(run);

    for (let i = 0; i < run.plannedSteps.length; i++) {
      const step = run.plannedSteps[i];
      const stepRes = run.steps[i];
      const auth = authorizeActionStep(ownerId, run, step, run.targetOrigin, serverOrigin);
      stepRes.startedAt = new Date().toISOString();
      if (!auth.allowed) {
        stepRes.status = 'blocked';
        stepRes.error = auth.reason;
        stepRes.observation = `[SHADOW] Blocked by Permission Broker: ${auth.reason}`;
        stepRes.finishedAt = new Date().toISOString();
        run.status = 'failed';
        run.error = auth.reason;
        run.outcome = {
          verdict: 'failed',
          expected: step.expectedOutcome,
          observed: auth.reason || 'Blocked by policy',
          evidenceSummary: 'Shadow simulation caught policy violation before touching any external system.',
          checkedAt: new Date().toISOString(),
        };
        run.updatedAt = new Date().toISOString();
        this.emit(run);
        return;
      }

      stepRes.status = 'completed';
      stepRes.observation = auth.requiresFreshApproval
        ? `[SHADOW SIMULATION] Would pause for fresh approval before ${step.action} on ${step.targetSelector}. Zero writes performed.`
        : `[SHADOW SIMULATION] Would execute ${step.action} on ${step.targetSelector} with expected outcome: ${step.expectedOutcome}. Zero clicks/writes performed.`;
      stepRes.finishedAt = new Date().toISOString();
      run.updatedAt = new Date().toISOString();
      this.emit(run);
    }

    run.status = 'verified';
    run.outcome = {
      verdict: 'confirmed',
      expected: 'Inspectable shadow plan without touching external systems.',
      observed: `Simulated ${run.plannedSteps.length} steps in shadow mode. Zero external writes or browser clicks occurred.`,
      evidenceSummary: 'Shadow execution verified plan safety and policy constraints.',
      checkedAt: new Date().toISOString(),
    };
    run.updatedAt = new Date().toISOString();
    this.emit(run);
  }

  private async executePlaywrightRun(
    ownerId: string,
    run: AgentRun,
    serverOrigin: string,
    startIndex: number,
    skipApprovalForStartIndex = false,
  ): Promise<void> {
    const controller = new AbortController();
    this.activeControllers.set(run.id, controller);

    const startedAtMs = Date.now();
    let browser: Browser | null = null;

    try {
      const executablePath = resolveChromiumExecutable();
      browser = await chromium.launch({
        headless: true,
        ...(executablePath ? { executablePath } : {}),
        args: ['--no-sandbox', '--disable-setuid-sandbox'],
      });
      const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
      const page = await context.newPage();

      // Ensure Playwright starts on the target page if step 1 is not an explicit navigate step
      if (startIndex === 0 && run.plannedSteps[0]?.action !== 'navigate') {
        const fallbackUrl = run.targetOrigin.includes('localhost') || run.targetOrigin.includes('127.0.0.1') || run.targetOrigin.includes('.run.app')
          ? `${serverOrigin}/fixture/research`
          : run.targetOrigin;
        await page.goto(fallbackUrl, { waitUntil: 'networkidle', timeout: 15_000 }).catch(() => undefined);
      }

      // If resuming mid-run after approval, re-navigate and replay non-consequential setup steps up to startIndex
      if (startIndex > 0) {
        if (run.plannedSteps[0]?.action !== 'navigate') {
          const fallbackUrl = run.targetOrigin.includes('localhost') || run.targetOrigin.includes('127.0.0.1') || run.targetOrigin.includes('.run.app')
            ? `${serverOrigin}/fixture/research`
            : run.targetOrigin;
          await page.goto(fallbackUrl, { waitUntil: 'networkidle', timeout: 15_000 }).catch(() => undefined);
        }
        for (let pre = 0; pre < startIndex; pre++) {
          const prevStep = run.plannedSteps[pre];
          const prevVal = this.resolveStepValue(prevStep, run.inputValues);
          await this.performDomStep(page, prevStep, prevVal, serverOrigin, run, true);
        }
      }

      for (let i = startIndex; i < run.plannedSteps.length; i++) {
        if (controller.signal.aborted) {
          return;
        }
        if (i >= run.budget.maxSteps) {
          throw new Error(`Step budget exceeded (maxSteps=${run.budget.maxSteps}).`);
        }
        if (Date.now() - startedAtMs > run.budget.maxDurationMs) {
          throw new Error(`Duration budget exceeded (${run.budget.maxDurationMs}ms).`);
        }

        const step = run.plannedSteps[i];
        const stepRes = run.steps[i];
        const currentUrl = page.url() === 'about:blank' ? run.targetOrigin : page.url();
        const auth = authorizeActionStep(ownerId, run, step, currentUrl, serverOrigin);

        if (!auth.allowed) {
          stepRes.status = 'blocked';
          stepRes.error = auth.reason;
          stepRes.observation = `Blocked by Permission Broker: ${auth.reason}`;
          stepRes.finishedAt = new Date().toISOString();
          run.status = 'failed';
          run.error = auth.reason;
          run.outcome = {
            verdict: 'failed',
            expected: step.expectedOutcome,
            observed: auth.reason || 'Policy blocked step',
            evidenceSummary: 'Permission Broker denied execution.',
            checkedAt: new Date().toISOString(),
          };
          run.updatedAt = new Date().toISOString();
          this.emit(run);
          return;
        }

        const needsApprovalHere = auth.requiresFreshApproval && !(skipApprovalForStartIndex && i === startIndex);
        if (needsApprovalHere) {
          const targetOrigin = normalizeOrigin(currentUrl, serverOrigin);
          const pending = issuePendingApproval(run, step, targetOrigin);
          run.pendingApproval = pending;
          run.status = 'awaiting_approval';
          stepRes.status = 'awaiting_approval';
          stepRes.observation = `Paused for fresh user approval (${step.action} on ${targetOrigin}).`;
          run.updatedAt = new Date().toISOString();
          this.emit(run);
          return;
        }

        stepRes.status = 'running';
        stepRes.startedAt = new Date().toISOString();
        run.status = 'running';
        run.updatedAt = new Date().toISOString();
        this.emit(run);

        const resolvedValue = this.resolveStepValue(step, run.inputValues);
        const execResult = await this.performDomStep(page, step, resolvedValue, serverOrigin, run, false);

        if (controller.signal.aborted) {
          return;
        }

        const shotBuffer = await page.screenshot({ type: 'png' }).catch(() => null);
        if (shotBuffer) {
          stepRes.screenshotDataUrl = `data:image/png;base64,${shotBuffer.toString('base64')}`;
        }

        stepRes.targetUsed = execResult.selectorUsed;
        stepRes.adaptedFromSelector = execResult.adaptedFrom;
        stepRes.extractedData = execResult.extractedData;
        stepRes.observation = execResult.observation;
        stepRes.finishedAt = new Date().toISOString();

        if (!execResult.success) {
          stepRes.status = 'failed';
          stepRes.error = execResult.error;
          run.status = 'failed';
          run.error = execResult.error;
          run.outcome = {
            verdict: 'failed',
            expected: step.expectedOutcome,
            observed: execResult.observation,
            evidenceSummary: `Step ${step.order} failed: ${execResult.error}`,
            checkedAt: new Date().toISOString(),
          };
          run.updatedAt = new Date().toISOString();
          this.emit(run);
          return;
        }

        stepRes.status = 'completed';
        run.updatedAt = new Date().toISOString();
        this.emit(run);
      }

      // Outcome Verification (AGENT-013): Inspect real observable page state
      const verification = await this.verifyFinalOutcome(page, run);
      run.outcome = verification;
      run.status = verification.verdict === 'failed' ? 'failed' : 'verified';
      if (verification.verdict === 'failed') {
        run.error = verification.observed;
      } else if (run.skillId) {
        const state = twinStore.getOwner(ownerId);
        const skill = state?.skills.find((s) => s.id === run.skillId);
        if (skill) {
          skill.verifiedRunsCount += 1;
          skill.lastRunAt = new Date().toISOString();
          twinStore.saveSkill(ownerId, skill);
        }
      }
      run.updatedAt = new Date().toISOString();
      twinStore.appendAudit(ownerId, 'run_execute', verification.verdict === 'failed' ? 'denied' : 'allowed', `Run ${run.id} completed with verdict=${verification.verdict}`);
      this.emit(run);
    } catch (err) {
      if (controller.signal.aborted) {
        return;
      }
      const message = err instanceof Error ? err.message : String(err);
      run.status = 'failed';
      run.error = message;
      run.outcome = {
        verdict: 'failed',
        expected: run.plannedSteps.map((s) => s.expectedOutcome).join('; '),
        observed: message,
        evidenceSummary: `Execution failed with error: ${message}`,
        checkedAt: new Date().toISOString(),
      };
      run.updatedAt = new Date().toISOString();
      this.emit(run);
    } finally {
      this.activeControllers.delete(run.id);
      if (browser) {
        await browser.close().catch(() => undefined);
      }
    }
  }

  private resolveStepValue(step: PlannedStep, inputValues: Record<string, string>): string {
    if (step.inputKey && inputValues[step.inputKey] !== undefined) {
      return inputValues[step.inputKey];
    }
    return step.staticValue || '';
  }

  private async performDomStep(
    page: Page,
    step: PlannedStep,
    value: string,
    serverOrigin: string,
    run: AgentRun,
    silentReplay: boolean,
  ): Promise<{
    success: boolean;
    selectorUsed: string;
    adaptedFrom?: string;
    observation: string;
    extractedData?: unknown;
    error?: string;
  }> {
    if (step.action === 'navigate') {
      let target = step.targetSelector.startsWith('http')
        ? step.targetSelector
        : `${serverOrigin}${step.targetSelector.startsWith('/') ? step.targetSelector : `/${step.targetSelector}`}`;
      try {
        const parsed = new URL(target);
        if ((parsed.hostname.endsWith('.run.app') || parsed.hostname === 'localhost') && parsed.pathname.startsWith('/fixture')) {
          target = `${serverOrigin}${parsed.pathname}${parsed.search}`;
        }
      } catch {
        // keep target
      }
      await page.goto(target, { waitUntil: 'networkidle', timeout: 15_000 });
      await page.waitForTimeout(250);
      return {
        success: true,
        selectorUsed: target,
        observation: `Navigated to ${page.url()} (title: "${await page.title()}").`,
      };
    }

    let activeSelector = step.targetSelector;
    let adaptedFrom: string | undefined;

    let locator = page.locator(activeSelector).first();
    let count = await locator.count().catch(() => 0);

    // Bounded layout-drift recovery (AGENT-006)
    if (count === 0 && !silentReplay) {
      const candidates = await page.evaluate(() => {
        const els = Array.from(document.querySelectorAll('input, select, button, a, textarea, [data-testid], [role="button"], table, ul'));
        return els.slice(0, 60).map((el) => {
          const tag = el.tagName.toLowerCase();
          const id = el.id ? `#${el.id}` : '';
          const testId = el.getAttribute('data-testid') ? `[data-testid="${el.getAttribute('data-testid')}"]` : '';
          const name = el.getAttribute('name') ? `[name="${el.getAttribute('name')}"]` : '';
          const selector = testId || id || name || `${tag}.${Array.from(el.classList).slice(0, 2).join('.')}`;
          return {
            tag,
            selector: selector.replace(/\.$/, ''),
            text: (el.textContent || '').trim().slice(0, 80),
            placeholder: el.getAttribute('placeholder') || undefined,
            ariaLabel: el.getAttribute('aria-label') || undefined,
            role: el.getAttribute('role') || undefined,
          };
        });
      });

      const bodyText = await page.evaluate(() => document.body?.innerText || '');
      if (process.env.GEMINI_API_KEY) {
        try {
          const adapted = await adaptStepOnChangedDom(step, candidates, bodyText);
          run.budget.tokensUsed += adapted.tokensUsed;
          if (adapted.found && adapted.newSelector) {
            const candidateLoc = page.locator(adapted.newSelector).first();
            if ((await candidateLoc.count().catch(() => 0)) > 0) {
              adaptedFrom = activeSelector;
              activeSelector = adapted.newSelector;
              locator = candidateLoc;
              count = 1;
            }
          }
        } catch {
          // fallback below
        }
      }

      if (count === 0 && step.fallbackText) {
        const textLoc = page.getByText(step.fallbackText, { exact: false }).first();
        if ((await textLoc.count().catch(() => 0)) > 0) {
          adaptedFrom = activeSelector;
          activeSelector = `text=${step.fallbackText}`;
          locator = textLoc;
          count = 1;
        }
      }
    }

    if (count === 0) {
      return {
        success: false,
        selectorUsed: activeSelector,
        observation: `Element not found for selector "${step.targetSelector}".`,
        error: `Target element "${step.targetSelector}" not found after bounded layout recovery.`,
      };
    }

    if (step.action === 'fill') {
      await locator.fill(value, { timeout: 6000 });
      return {
        success: true,
        selectorUsed: activeSelector,
        adaptedFrom,
        observation: `${adaptedFrom ? `[Adapted from ${adaptedFrom}] ` : ''}Filled "${value}" into ${activeSelector}.`,
      };
    }

    if (step.action === 'select') {
      await locator.selectOption(value, { timeout: 6000 });
      return {
        success: true,
        selectorUsed: activeSelector,
        adaptedFrom,
        observation: `${adaptedFrom ? `[Adapted from ${adaptedFrom}] ` : ''}Selected "${value}" in ${activeSelector}.`,
      };
    }

    if (step.action === 'click' || step.action === 'submit') {
      await locator.click({ timeout: 6000 });
      await page.waitForTimeout(300);
      return {
        success: true,
        selectorUsed: activeSelector,
        adaptedFrom,
        observation: `${adaptedFrom ? `[Adapted from ${adaptedFrom}] ` : ''}Clicked ${activeSelector} (${step.action}).`,
      };
    }

    if (step.action === 'extract_text') {
      const rawText = (await locator.innerText({ timeout: 6000 }).catch(() => '')) || '';
      const sanitized = sanitizeUntrustedPageText(rawText);

      // Extract structured comparison rows if present on the page
      const rows = await page.evaluate(() => {
        const itemEls = Array.from(document.querySelectorAll('[data-research-item]'));
        return itemEls.slice(0, 10).map((el) => ({
          title: el.getAttribute('data-title') || (el.querySelector('h3, h4')?.textContent || '').trim(),
          category: el.getAttribute('data-category') || '',
          year: el.getAttribute('data-year') || '',
          summary: (el.querySelector('p')?.textContent || '').trim().slice(0, 180),
        }));
      });

      return {
        success: true,
        selectorUsed: activeSelector,
        adaptedFrom,
        extractedData: { rows, textPreview: sanitized.safeText.slice(0, 500), injectionQuarantined: sanitized.injectionDetected },
        observation:
          (sanitized.injectionDetected
            ? `[Prompt Injection Quarantined: ${sanitized.matchedSignals.join(', ')}] `
            : '') +
          `Extracted ${rows.length} structured item(s) and ${sanitized.safeText.length} chars from ${activeSelector}.`,
      };
    }

    return {
      success: false,
      selectorUsed: activeSelector,
      observation: `Unsupported browser action "${step.action}" blocked.`,
      error: `Action "${step.action}" is not executable without a connected external provider.`,
    };
  }

  private async verifyFinalOutcome(page: Page, run: AgentRun): Promise<VerifiedOutcome> {
    const domState = await page.evaluate(() => {
      const apiStatusEl = document.querySelector('[data-api-status]');
      const apiStatus = apiStatusEl?.getAttribute('data-api-status') || 'ok';
      const apiMessage = apiStatusEl?.textContent?.trim() || '';
      const rows = Array.from(document.querySelectorAll('[data-research-item]')).slice(0, 10).map((el) => ({
        title: el.getAttribute('data-title') || (el.querySelector('h3, h4')?.textContent || '').trim(),
        category: el.getAttribute('data-category') || '',
        year: el.getAttribute('data-year') || '',
      }));
      const savedBanner = document.querySelector('[data-submission-status]')?.textContent?.trim() || '';
      return { apiStatus, apiMessage, rows, savedBanner, url: window.location.href };
    });

    if (domState.apiStatus === 'error') {
      return {
        verdict: 'failed',
        expected: 'All API & UI operations complete cleanly without server/provider error.',
        observed: `Observed error state on page: "${domState.apiMessage || 'Simulated API failure'}" (clicks completed, but outcome verification detected API failure).`,
        evidenceSummary: 'Outcome verification refused to equate button clicks with success because the target page reported an API failure.',
        extractedRows: domState.rows,
        checkedAt: new Date().toISOString(),
      };
    }

    const lastExtracted = [...run.steps].reverse().find((s) => s.extractedData)?.extractedData as
      | { rows?: Array<Record<string, string>> }
      | undefined;

    const extractedRows = lastExtracted?.rows?.length ? lastExtracted.rows : domState.rows;

    return {
      verdict: extractedRows.length > 0 || domState.savedBanner ? 'confirmed' : 'uncertain',
      expected: run.plannedSteps.map((s) => s.expectedOutcome).join(' → '),
      observed:
        domState.savedBanner ||
        `Observed ${extractedRows.length} matching result item(s) at ${domState.url}.`,
      evidenceSummary: `Verified live DOM state at ${domState.url} with ${extractedRows.length} extracted row(s).`,
      extractedRows,
      checkedAt: new Date().toISOString(),
    };
  }
}

export const browserExecutor = new BrowserAgentExecutor();
