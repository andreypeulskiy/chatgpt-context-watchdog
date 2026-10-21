  // Local file data stays transient until its card belongs to a sent user UUID.
  const pendingLocalFiles = [];
  let activePanelView = 'context';
  let outsidePanelHandlerBound = false;
  // UI-only, session-scoped: a pin never enters settings or state:v2.
  let panelPinned = false;
  let ui = null;
  let observer = null;
  // Registered once by application startup; rendering must not import Settings.
  let ensureUiInitialized = null;

  function setUiInitializer(initializer) { ensureUiInitialized = initializer; }
  function ensureUiReady() {
    if (!ensureUiInitialized) throw new Error('Watchdog UI has not been initialized');
    return ensureUiInitialized();
  }

  // Live mutable binding: write access from a different ES module.
  function setActivePanelView(value) { return (activePanelView = value); }

  // Live mutable binding: write access from a different ES module.
  function setUi(value) { return (ui = value); }

  // Live mutable binding: write access from a different ES module.
  function setPanelPinned(value) { return (panelPinned = value); }

  // Live mutable binding: write access from a different ES module.
  function setOutsidePanelHandlerBound(value) { return (outsidePanelHandlerBound = value); }

  // Live mutable binding: write access from a different ES module.
  function setObserver(value) { return (observer = value); }

export { pendingLocalFiles, activePanelView, outsidePanelHandlerBound, panelPinned, ui, observer, setActivePanelView, setUi, setPanelPinned, setOutsidePanelHandlerBound, setObserver, setUiInitializer, ensureUiReady };
