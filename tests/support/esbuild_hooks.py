"""In-memory QA instrumentation for supported, nonminified userscript bundles.

The canonical esbuild IIFE exposes module-local symbols at the shared entry
point. The offline TypeScript/CJS bundle isolates symbols per module, so test
hooks use a narrow, explicit lookup table of module exports. No changes to
src/ or shipped dist/; any unknown envelope fails closed.
"""

# Only symbols already exported by application modules may be exposed to an
# ephemeral, synthetic QA document. These globals never enter product bytes.
_MODULE_SYMBOLS = {
    'src/ui/15-panel-ui-coordinator.js': ('ensureUI',),
    'src/ui/15-panel-dialog-lifecycle.js': ('settlePanelConfirmation',),
    'src/runtime/01-runtime-ui-state.js': ('ui', 'pendingLocalFiles'),
    'src/runtime/01-runtime-capture-state.js': (
        'setLastAudit', 'priorRepairCandidates', 'revisionTargets',
        'completedRevisions', 'lastAudit', 'settings'),
    'src/runtime/01-runtime-ledger-state.js': (
        'pendingFileResults', 'pendingTransientPromotions', 'resetEpoch'),
    'src/runtime/01-runtime-dom-state.js': (
        'dirtyFileTurns', 'setHistoryCache', 'setHistorySummaryCache',
        'historyCache', 'historySummaryCache'),
    'src/runtime/01-runtime-session-state.js': ('hydrationCandidates',),
    'src/attachments/06-attachment-reading.js': ('stageLocalFile',),
    'src/runtime/01-runtime-pause-state.js': ('isWatchdogPaused',),
}


def instrument_bundle(script, hooks, route=None):
    if route is not None:
        opening = '\n(() => {\n'
        assert script.count(opening) == 1, 'Unknown IIFE envelope'
        script = script.replace(opening, '\n(() => {\nconst location = ' + route + ';', 1)

    canonical_marker = '  // src/main.js\n  start();'
    fallback_marker = "  loadModule('src/main.js');"
    if script.count(canonical_marker) == 1:
        assert script.count(fallback_marker) == 0, 'Mixed bundle envelopes'
        return script.replace(canonical_marker,
                              '  // src/main.js\n' + hooks + '\n  start();', 1)

    assert script.count(fallback_marker) == 1, 'Unknown entry point'
    assert script.count('const factories = Object.create(null);') == 1, 'Not an offline CJS bundle'
    assert script.count('function loadModule(id) {') == 1, 'Unknown offline module loader'

    # Fail closed if a required module or export is absent. Generate no remote
    # imports and no permanent production/test globals outside the browser page.
    aliases = []
    seen = set()
    for module, names in _MODULE_SYMBOLS.items():
        assert script.count(f'factories["{module}"] = function') == 1, module
        for name in names:
            assert name not in seen, f'Ambiguous QA symbol: {name}'
            seen.add(name)
            aliases.append(
                '  Object.defineProperty(window, ' + repr(name) + ', '
                '{ configurable:true, get(){ return loadModule(' + repr(module) +
                ')[' + repr(name) + ']; } });')
    # Deliberately evaluate the hook body before application start. Each
    # module-scoped object is retrieved through its exported live property;
    # getters do not freeze mutable state across Reset/Wipe/remount.
    prelude = '\n'.join(aliases) + '\n' + hooks + '\n'
    return script.replace(fallback_marker, prelude + fallback_marker, 1)
