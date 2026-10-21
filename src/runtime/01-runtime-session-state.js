  // The Stop -> ready event confirms the NEWEST reply. Previously unknown,
  // already finished messages can also be captured when mounted by scrolling.
  // Scanning is event-driven; only bounded, one-shot hydration checks are scheduled.
  // Runtime state is intentionally NOT persisted: it belongs to the mounted
  // DOM, whereas message IDs/metrics belong to the durable ledger.
  // `phase` describes controls/route; `work` describes independent pending jobs.
  const runtime = {
    phase: 'unknown',
    work: { initial: true, backfill: false, completion: false },
    route: null // { beforeIds, beforeNodes: WeakMap, outgoingKnownIds, gate }
  };
  // Runtime-only verification cache for short, temporarily unhydrated DOM.
  const hydrationCandidates = new Map();
  let hydrationCheckTimer = 0; // one-shot; never a polling loop

  // Live mutable binding: write access from a different ES module.
  function setHydrationCheckTimer(value) { return (hydrationCheckTimer = value); }

export { runtime, hydrationCandidates, hydrationCheckTimer, setHydrationCheckTimer };
