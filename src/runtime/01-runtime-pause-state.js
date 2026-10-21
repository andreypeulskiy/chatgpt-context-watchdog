import { settings } from './01-runtime-capture-state.js';

// User preference is durable; page availability belongs to this tab only.
// Neither reason mutates the other. Heavy collection uses the effective flag.
let chatAvailable = false;
let syncRunState = null;

function isWatchdogPaused() {
  return settings.watchdogPaused === true || !chatAvailable;
}
function isChatAvailable() { return chatAvailable; }
function setChatAvailable(available) {
  const next = !!available;
  if (next === chatAvailable) return false;
  chatAvailable = next;
  return true;
}
function setRunStateSynchronizer(fn) { syncRunState = fn; }
function requestRunStateSync() { syncRunState?.(); }

export { isWatchdogPaused, isChatAvailable, setChatAvailable,
  setRunStateSynchronizer, requestRunStateSync };
