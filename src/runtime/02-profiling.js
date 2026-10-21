import { perf } from './01-runtime-capture-state.js';

  // Opt-in RAM-only instrumentation. Disabled by default to keep the hot path light.
  function resetPerformance() {
    perf.mutationBatches = perf.mutations = 0;
    perf.queuedEvents = perf.processedEvents = perf.noChangeScans = 0;
    perf.duplicateTextMutations = 0;
    perf.timings = Object.create(null);
  }
  function perfStart() {
    return perf.enabled ? performance.now() : null;
  }
  function perfEnd(key, started) {
    if (started === null) return;
    const ms = performance.now() - started;
    const timing = perf.timings[key] || (perf.timings[key] = { count: 0, total: 0, max: 0 });
    timing.count++;
    timing.total += ms;
    timing.max = Math.max(timing.max, ms);
    // Bounded, opt-in recent-sample window. Does not persist measurements or
    // allocate while profiling is disabled. p95 complements avg/max for spikes.
    const recent = timing.recent || (timing.recent = []);
    if (recent.length === 64) recent.shift();
    recent.push(ms);
  }
  function measuredStorageRead(key) {
    if (!perf.enabled) return localStorage.getItem(key);
    const started = performance.now();
    try { return localStorage.getItem(key); }
    finally { perfEnd('storageRead', started); }
  }

  const collectorState = {
    name: 'none', visible: 0, raw: 0,
    collapsed: 0, ambiguous: 0, noLayout: 0
  };

export { resetPerformance, perfStart, perfEnd, measuredStorageRead, collectorState };
