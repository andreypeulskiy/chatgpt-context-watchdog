// Volatile, Watchdog-owned failures only. Never persist raw error messages,
// stack traces, URLs, IDs, excerpts or arbitrary thrown values from the host.
const MAX_RECENT_ERRORS = 15;
const RECORDED_SOURCES = new Set(['Wipe', 'Export IDs', 'UI']);
const ERROR_TYPES = new Set([
  'Error', 'TypeError', 'RangeError', 'ReferenceError', 'SyntaxError',
  'QuotaExceededError', 'NotAllowedError', 'SecurityError',
  'InvalidStateError', 'AbortError', 'NotFoundError'
]);
const ERROR_CONTEXT = Object.freeze({
  Wipe: 'Watchdog data could not be fully cleared',
  'Export IDs': 'Local UUID report could not be exported',
  UI: 'Watchdog interface action could not be completed'
});
const recentErrors = [];
let nextErrorNumber = 0;
let errorRevision = 0;

function recordUiError(source, error) {
  const safeSource = RECORDED_SOURCES.has(source) ? source : 'UI';
  // The name is whitelisted. The message and stack are never retained.
  const name = error && typeof error.name === 'string' ? error.name : '';
  const type = ERROR_TYPES.has(name) ? name : 'UnknownError';
  const entry = Object.freeze({
    id: `E${String(++nextErrorNumber).padStart(2, '0')}`,
    at: Date.now(), source: safeSource, type,
    // A predefined explanation remains useful to copy without retaining any
    // arbitrary exception text that may contain a chat URL or user content.
    description: ERROR_CONTEXT[safeSource]
  });
  recentErrors.push(entry);
  if (recentErrors.length > MAX_RECENT_ERRORS) recentErrors.shift();
  errorRevision++;
  return entry.id;
}

function getRecentUiErrors() { return recentErrors.slice(); }
function getUiErrorRevision() { return errorRevision; }
function clearUiErrors() {
  recentErrors.length = 0;
  // Do not reset nextErrorNumber: previous reference IDs must never point
  // to a different error after a Wipe in the same browser session.
  errorRevision++;
}

export { recordUiError, getRecentUiErrors, getUiErrorRevision, clearUiErrors };
