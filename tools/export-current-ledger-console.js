// INTERNAL read-only helper: paste into Chromium DevTools Console on chatgpt.com.
// Read-only localStorage access; creates a LOCAL browser download only.
// NO fetch/XHR/WebSocket, no POST, no storage modification.
(() => {
  const match = location.pathname.match(/(?:^|\/)c\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?:\/|$)/i);
  if (!match) {
    console.warn('[Watchdog internal audit] Open a chat with a UUID first.');
    return;
  }
  const chatKey = `chat:${match[1].toLowerCase()}`;
  const key = `cgpt-context-watchdog:state:v2:${encodeURIComponent(chatKey)}`;
  const raw = localStorage.getItem(key);
  if (raw == null) {
    console.warn('[Watchdog internal audit] No stored ledger for this chat.');
    return;
  }
  const blob = new Blob([raw], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = 'watchdog-ledger-snapshot.json';
  link.style.display = 'none';
  document.body.appendChild(link);
  try { link.click(); }
  finally {
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  console.info('[Watchdog internal audit] Local snapshot downloaded. It may contain private file names and IDs. Keep it private.');
})();
