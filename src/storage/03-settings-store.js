import { DEFAULTS, METADATA_SETTING_SPECS, SETTINGS_KEY, isValidHandoffPrompt } from '../runtime/01-runtime-configuration.js';
import { measuredStorageRead } from '../runtime/02-profiling.js';
import { NUMERIC_SETTING_SPECS } from '../runtime/01-numeric-settings.js';

  // Mathematical settings are loaded through a validated current-version path.
  function loadSettings() {
    try {
      const raw = JSON.parse(measuredStorageRead(SETTINGS_KEY) || '{}');
      const parsed = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
      const number = (key, fallback = DEFAULTS[key]) => {
        const spec = NUMERIC_SETTING_SPECS[key];
        if (!spec) throw new Error('Missing numeric specification: ' + key);
        const source = parsed[key];
        if (source === undefined || source === null || source === '') return fallback;
        const n = Number(source);
        if (!Number.isFinite(n) || n < spec.min || n > spec.max) return fallback;
        return spec.integer ? Math.round(n) : n;
      };
      const normal = number('normalBudget');
      const result = {
        ...DEFAULTS,
        conservativeBudget: number('conservativeBudget',
          Math.max(10000, Math.round(normal * 2 / 3))),
        normalBudget: normal,
        optimisticBudget: number('optimisticBudget',
          Math.min(1e9, Math.round(normal * 1.5))),
        messageOverhead: number('messageOverhead'),
        hiddenOptimistic: number('hiddenOptimistic'),
        hiddenPessimistic: number('hiddenPessimistic'),
        historyPriorStrength: number('historyPriorStrength'),
        budgetCalibrationWeight: number('budgetCalibrationWeight'),
        averageImageTokens: number('averageImageTokens'),
        historicalFileFallbackTokens: number('historicalFileFallbackTokens'),
        localFileParsingLimitMiB: number('localFileParsingLimitMiB'),
        pastedMinChars: number('pastedMinChars'),
        pastedEnglishCharsPerToken: number('pastedEnglishCharsPerToken'),
        pastedCyrillicCharsPerToken: number('pastedCyrillicCharsPerToken'),
        proseCyrillicCharsPerToken: number('proseCyrillicCharsPerToken'),
        proseLatinCharsPerToken: number('proseLatinCharsPerToken'),
        proseDigitsCharsPerToken: number('proseDigitsCharsPerToken'),
        prosePunctuationCharsPerToken: number('prosePunctuationCharsPerToken'),
        proseOtherCharsPerToken: number('proseOtherCharsPerToken'),
        proseMinTokensPerWord: number('proseMinTokensPerWord'),
        codeCharsPerToken: number('codeCharsPerToken'),
        badgePosition: parsed.badgePosition &&
          Number.isFinite(parsed.badgePosition.left) && Number.isFinite(parsed.badgePosition.top)
          ? { left: parsed.badgePosition.left, top: parsed.badgePosition.top } : null,
        handoffPrompt: isValidHandoffPrompt(parsed.handoffPrompt)
          ? parsed.handoffPrompt : DEFAULTS.handoffPrompt,
        viewStyle: ['soft', 'sharp'].includes(parsed.viewStyle) ? parsed.viewStyle : DEFAULTS.viewStyle,
        viewTheme: ['light', 'dark', 'system', 'chatgpt'].includes(parsed.viewTheme)
          ? parsed.viewTheme : DEFAULTS.viewTheme,
        logoPreference: ['openai', 'watchdog'].includes(parsed.logoPreference)
          ? parsed.logoPreference : DEFAULTS.logoPreference,
        watchdogPaused: typeof parsed.watchdogPaused === 'boolean'
          ? parsed.watchdogPaused : false
      };
      // Metadata-only is calibrated only in Dev. Keep settings readable in Stable
      // so switching variants does not silently destroy Dev values.
      for (const spec of METADATA_SETTING_SPECS) {
        // Old persisted values stay intact even if they do not match a new UI step.
        result[spec.key] = number(spec.key);
      }
      if (result.metadataOnlyOptimisticBase > result.metadataOnlyPessimisticBase ||
          result.metadataOnlyOptimisticSizeFactor > result.metadataOnlyPessimisticSizeFactor ||
          result.metadataOnlyOptimisticMax > result.metadataOnlyPessimisticMax) {
        for (const spec of METADATA_SETTING_SPECS) result[spec.key] = DEFAULTS[spec.key];
      }
      const anchor = parsed.budgetCalibrationBase;
      if (anchor && typeof anchor === 'object' && !Array.isArray(anchor)) {
        const c = Number(anchor.conservativeBudget);
        const n = Number(anchor.normalBudget);
        const o = Number(anchor.optimisticBudget);
        if ([c, n, o].every(x => Number.isInteger(x) && x >= 10000 && x <= 1e9) &&
            c <= n && n <= o) {
          result.budgetCalibrationBase = {
            conservativeBudget: c, normalBudget: n, optimisticBudget: o
          };
        }
      }
      for (const key of [
        'fileOptimisticPct', 'filePessimisticPct',
        'imageOptimisticPct', 'imagePessimisticPct'
      ]) result[key] = number(key);

      // Reject inconsistent pairs rather than allowing inverted forecasts.
      if (!(result.conservativeBudget <= result.normalBudget &&
            result.normalBudget <= result.optimisticBudget)) {
        result.conservativeBudget = DEFAULTS.conservativeBudget;
        result.normalBudget = DEFAULTS.normalBudget;
        result.optimisticBudget = DEFAULTS.optimisticBudget;
        // Invalid active budgets must not reuse a stale, valid calibration anchor.
        result.budgetCalibrationBase = null;
        result.budgetCalibrationWeight = 0;
      }
      if (result.hiddenPessimistic < result.hiddenOptimistic) {
        result.hiddenOptimistic = DEFAULTS.hiddenOptimistic;
        result.hiddenPessimistic = DEFAULTS.hiddenPessimistic;
      }
      if (result.fileOptimisticPct > result.filePessimisticPct) {
        result.fileOptimisticPct = DEFAULTS.fileOptimisticPct;
        result.filePessimisticPct = DEFAULTS.filePessimisticPct;
      }
      if (result.imageOptimisticPct > result.imagePessimisticPct) {
        result.imageOptimisticPct = DEFAULTS.imageOptimisticPct;
        result.imagePessimisticPct = DEFAULTS.imagePessimisticPct;
      }
      return result;
    } catch {
      return { ...DEFAULTS };
    }
  }

export { loadSettings };
