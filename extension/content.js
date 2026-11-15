const SENSITIVE_HINT = /password|passwd|secret|token|api[-_]?key|card|cvv|cvc|ssn|pin|auth/i;
const SENSITIVE_VALUE = /(sk-[a-zA-Z0-9]{16,}|AIza[0-9A-Za-z\-_]{20,}|Bearer\s+[A-Za-z0-9\-._~+/]+=*|\b\d{13,19}\b)/;

let isRecordingHere = false;
let bannerEl = null;
let lastHref = window.location.href;
let inputTimers = new WeakMap();

function ensureBanner(active) {
  if (!active) {
    if (bannerEl) {
      bannerEl.remove();
      bannerEl = null;
    }
    return;
  }
  if (bannerEl) return;
  bannerEl = document.createElement('div');
  bannerEl.id = 'twinme-teach-indicator';
  bannerEl.style.cssText =
    'position:fixed;bottom:16px;right:16px;z-index:2147483647;background:#0F172A;color:#F8FAFC;padding:10px 14px;border-radius:8px;font:600 12px/1.3 system-ui,sans-serif;box-shadow:0 8px 24px rgba(15,23,42,0.28);display:flex;align-items:center;gap:10px;border:1px solid #334155;';
  bannerEl.textContent = 'TwinMe Teach Mode Active · ' + window.location.origin;
  document.documentElement.appendChild(bannerEl);
}

function buildSelector(el) {
  if (!el || el.nodeType !== 1) return '';
  if (el.getAttribute('data-testid')) return `[data-testid="${el.getAttribute('data-testid')}"]`;
  if (el.id) return `#${el.id}`;
  if (el.getAttribute('name')) return `${el.tagName.toLowerCase()}[name="${el.getAttribute('name')}"]`;
  const aria = el.getAttribute('aria-label');
  if (aria) return `${el.tagName.toLowerCase()}[aria-label="${aria.replace(/"/g, '')}"]`;
  return el.tagName.toLowerCase();
}

function captureEvent(type, el, rawValue) {
  if (!isRecordingHere) return;
  if (chrome?.extension?.inIncognitoContext) return;

  const isNav = type === 'navigate';
  const inputType = el ? (el.getAttribute?.('type') || '').toLowerCase() : '';
  const hint = el
    ? `${el.name || ''} ${el.id || ''} ${el.getAttribute?.('aria-label') || ''} ${el.placeholder || ''}`
    : '';
  const isSensitive =
    !isNav && (inputType === 'password' || SENSITIVE_HINT.test(hint) || SENSITIVE_VALUE.test(rawValue || ''));

  chrome.runtime.sendMessage({
    kind: 'TWINME_CAPTURED_EVENT',
    event: {
      type,
      targetSelector: isNav ? window.location.href : buildSelector(el),
      accessibleLabel: isNav
        ? document.title || window.location.pathname
        : (el.getAttribute?.('aria-label') || el.textContent || el.placeholder || el.tagName || '').trim().slice(0, 120),
      url: window.location.href,
      valuePreview: isSensitive ? '[REDACTED_SENSITIVE_FIELD]' : String(rawValue || '').slice(0, 160),
      redacted: isSensitive,
      timestamp: new Date().toISOString(),
    },
  });
}

document.addEventListener(
  'click',
  (e) => {
    const el = e.target?.closest?.('button, a, [role="button"], input[type="submit"], input[type="checkbox"], input[type="radio"]') || e.target;
    captureEvent('click', el, '');
  },
  true,
);

document.addEventListener(
  'input',
  (e) => {
    const el = e.target;
    if (!el || !['INPUT', 'TEXTAREA'].includes(el.tagName)) return;
    if (['checkbox', 'radio', 'submit', 'button'].includes((el.type || '').toLowerCase())) return;
    const prev = inputTimers.get(el);
    if (prev) clearTimeout(prev);
    inputTimers.set(
      el,
      setTimeout(() => {
        captureEvent('input', el, el.value || '');
      }, 400),
    );
  },
  true,
);

document.addEventListener(
  'change',
  (e) => {
    const el = e.target;
    if (!el) return;
    if (el.tagName === 'SELECT') {
      captureEvent('select', el, el.value || '');
    }
  },
  true,
);

// Detect SPA client-side navigation in Chrome
setInterval(() => {
  if (isRecordingHere && window.location.href !== lastHref) {
    lastHref = window.location.href;
    captureEvent('navigate', null, lastHref);
  }
}, 500);

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.kind === 'TWINME_RECORDING_STATE') {
    isRecordingHere = Boolean(msg.active && msg.origin === window.location.origin);
    ensureBanner(isRecordingHere);
    if (isRecordingHere && msg.recordInitialNav) {
      lastHref = window.location.href;
      captureEvent('navigate', null, lastHref);
    }
  }
});

chrome.runtime.sendMessage({ kind: 'TWINME_QUERY_STATE', origin: window.location.origin }, (res) => {
  if (res && res.active && res.origin === window.location.origin) {
    isRecordingHere = true;
    ensureBanner(true);
  }
});
