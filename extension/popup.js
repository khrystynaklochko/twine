let currentOrigin = null;
let active = false;
let lastEvents = [];

const studioInput = document.getElementById('studio-url');
const ownerInput = document.getElementById('owner-id');
const statusEl = document.getElementById('status');
const toggleBtn = document.getElementById('toggle-btn');

chrome.storage.local.get(['studioUrl', 'ownerId'], (res) => {
  studioInput.value = res.studioUrl || 'http://localhost:3000';
  ownerInput.value = res.ownerId || '';
});

document.getElementById('save-cfg-btn').addEventListener('click', () => {
  const studioUrl = studioInput.value.trim().replace(/\/+$/, '');
  const ownerId = ownerInput.value.trim();
  chrome.storage.local.set({ studioUrl, ownerId }, () => {
    statusEl.textContent = 'Connection saved. Ready to record on this site.';
  });
});

chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
  const tab = tabs[0];
  if (!tab?.url || tab.incognito || tab.url.startsWith('chrome://')) {
    document.getElementById('site-label').textContent = 'Unavailable in private or chrome:// tabs.';
    toggleBtn.disabled = true;
    return;
  }
  currentOrigin = new URL(tab.url).origin;
  document.getElementById('site-label').textContent = 'Current Site: ' + currentOrigin;
  chrome.runtime.sendMessage({ kind: 'TWINME_QUERY_STATE', origin: currentOrigin }, (res) => {
    active = Boolean(res?.active);
    updateUi(res?.count || 0, res?.traceId);
  });
});

function updateUi(count, traceId) {
  toggleBtn.textContent = active ? 'Stop & Send Trace to Twin' : 'Enable Teach Mode on This Site';
  statusEl.textContent = active
    ? `Recording live (${count} events streamed to ${traceId || 'TwinMe'})`
    : `Idle (${lastEvents.length} events in last session)`;
}

toggleBtn.addEventListener('click', () => {
  if (!currentOrigin) return;
  const studioUrl = studioInput.value.trim().replace(/\/+$/, '');
  const ownerId = ownerInput.value.trim();
  if (!ownerId) {
    statusEl.textContent = 'Paste your Twin Owner ID from /teach first.';
    return;
  }
  chrome.storage.local.set({ studioUrl, ownerId }, () => {
    if (!active) {
      chrome.runtime.sendMessage({ kind: 'TWINME_START', origin: currentOrigin }, (res) => {
        if (!res?.ok) {
          statusEl.textContent = 'Start failed: ' + (res?.error || 'Unknown error');
          return;
        }
        active = true;
        updateUi(0, res.traceId);
      });
    } else {
      chrome.runtime.sendMessage({ kind: 'TWINME_STOP' }, (res) => {
        active = false;
        lastEvents = res?.events || [];
        updateUi(lastEvents.length, res?.traceId);
        statusEl.textContent = `Sent ${lastEvents.length} action(s) to TwinMe (${res?.traceId}). Open /teach to approve & replicate!`;
      });
    }
  });
});

document.getElementById('open-teach-btn').addEventListener('click', () => {
  const studioUrl = (studioInput.value.trim() || 'http://localhost:3000').replace(/\/+$/, '');
  chrome.tabs.create({ url: `${studioUrl}/teach` });
});
