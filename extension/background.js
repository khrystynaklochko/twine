const state = {
  active: false,
  allowedOrigin: null,
  traceId: null,
  studioUrl: 'http://localhost:3000',
  ownerId: '',
  events: [],
};

async function loadConfig() {
  const stored = await chrome.storage.local.get(['studioUrl', 'ownerId']);
  if (stored.studioUrl) state.studioUrl = stored.studioUrl.replace(/\/+$/, '');
  if (stored.ownerId) state.ownerId = stored.ownerId.trim();
}

async function postToStudio(path, body) {
  await loadConfig();
  if (!state.studioUrl || !state.ownerId) {
    return { ok: false, error: 'Configure TwinMe Studio URL and Owner ID in the extension popup first.' };
  }
  const res = await fetch(`${state.studioUrl}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-twin-owner': state.ownerId,
    },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    return { ok: false, error: data.error || `HTTP ${res.status}` };
  }
  return { ok: true, data };
}

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (!state.active || tab.incognito) return;
  if (changeInfo.status === 'complete' && tab.url && tab.url.startsWith(state.allowedOrigin || '__none__')) {
    chrome.tabs.sendMessage(tabId, {
      kind: 'TWINME_RECORDING_STATE',
      active: true,
      origin: state.allowedOrigin,
      recordInitialNav: false,
    }).catch(() => {});
  }
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (sender.tab?.incognito) {
    sendResponse({ active: false, blocked: 'Incognito mode is never recorded.' });
    return true;
  }

  if (msg.kind === 'TWINME_START') {
    (async () => {
      const startRes = await postToStudio('/api/teach/extension/start', {
        site: msg.origin,
        title: msg.title || `Chrome Recording (${new URL(msg.origin).hostname})`,
        explicitPopupGrant: true,
      });
      if (!startRes.ok) {
        sendResponse({ ok: false, error: startRes.error });
        return;
      }
      state.active = true;
      state.allowedOrigin = msg.origin;
      state.traceId = startRes.data.id;
      state.events = [];

      const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tabs[0]?.id) {
        chrome.tabs.sendMessage(tabs[0].id, {
          kind: 'TWINME_RECORDING_STATE',
          active: true,
          origin: msg.origin,
          recordInitialNav: true,
        }).catch(() => {});
      }
      sendResponse({ ok: true, traceId: state.traceId });
    })();
    return true;
  }

  if (msg.kind === 'TWINME_STOP') {
    (async () => {
      state.active = false;
      const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tabs[0]?.id) {
        chrome.tabs.sendMessage(tabs[0].id, { kind: 'TWINME_RECORDING_STATE', active: false, origin: null }).catch(() => {});
      }
      if (state.traceId) {
        await postToStudio('/api/teach/extension/finish', { traceId: state.traceId });
      }
      sendResponse({ ok: true, traceId: state.traceId, events: state.events });
    })();
    return true;
  }

  if (msg.kind === 'TWINME_QUERY_STATE') {
    sendResponse({
      active: state.active && state.allowedOrigin === msg.origin,
      origin: state.allowedOrigin,
      traceId: state.traceId,
      count: state.events.length,
    });
    return true;
  }

  if (msg.kind === 'TWINME_CAPTURED_EVENT') {
    if (state.active && sender.tab?.url?.startsWith(state.allowedOrigin || '__none__')) {
      state.events.push(msg.event);
      if (state.traceId) {
        void postToStudio('/api/teach/extension/ingest', {
          traceId: state.traceId,
          event: msg.event,
          isPrivateMode: Boolean(sender.tab?.incognito),
        });
      }
    }
    sendResponse({ ok: true });
    return true;
  }
});
