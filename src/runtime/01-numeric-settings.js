import { DEFAULTS, MAX_LOCAL_FILE_MIB, METADATA_SETTING_SPECS } from './01-runtime-configuration.js';

// Numeric domain is independent of presentation, storage values, and browser input attributes.
// DEFAULTS from source code is the only anchor for step computation.
const NUMERIC_SETTING_SPECS = Object.freeze({
  conservativeBudget: { min: 10000, max: 1e9, integer: true },
  normalBudget: { min: 10000, max: 1e9, integer: true },
  optimisticBudget: { min: 10000, max: 1e9, integer: true },
  messageOverhead: { min: 0, max: 100000, integer: true },
  hiddenOptimistic: { min: 0, max: 1e8, integer: true },
  hiddenPessimistic: { min: 0, max: 1e8, integer: true },
  historyPriorStrength: { min: 1, max: 1e6, integer: true },
  budgetCalibrationWeight: { min: 0, max: 1, integer: false },
  averageImageTokens: { min: 100, max: 1e6, integer: true },
  historicalFileFallbackTokens: { min: 0, max: 1e7, integer: true },
  localFileParsingLimitMiB: { min: 0, max: MAX_LOCAL_FILE_MIB, integer: true },
  fileOptimisticPct: { min: 0, max: 100, integer: true },
  filePessimisticPct: { min: 0, max: 100, integer: true },
  imageOptimisticPct: { min: 0, max: 100, integer: true },
  imagePessimisticPct: { min: 0, max: 100, integer: true },
  pastedMinChars: { min: 0, max: 1e7, integer: true },
  pastedEnglishCharsPerToken: { min: 0.25, max: 20, integer: false },
  pastedCyrillicCharsPerToken: { min: 0.25, max: 20, integer: false },
  proseCyrillicCharsPerToken: { min: 0.25, max: 20, integer: false },
  proseLatinCharsPerToken: { min: 0.25, max: 20, integer: false },
  proseDigitsCharsPerToken: { min: 0.25, max: 20, integer: false },
  prosePunctuationCharsPerToken: { min: 0.25, max: 20, integer: false },
  proseOtherCharsPerToken: { min: 0.25, max: 20, integer: false },
  proseMinTokensPerWord: { min: 0, max: 10, integer: false },
  codeCharsPerToken: { min: 0.25, max: 20, integer: false },
  ...Object.fromEntries(METADATA_SETTING_SPECS.map(spec => [
    spec.key, { min: spec.min, max: spec.max, integer: spec.integer }
  ]))
});

function numericStep(key) {
  const spec = NUMERIC_SETTING_SPECS[key];
  const fallback = DEFAULTS[key];
  if (!spec || !Number.isFinite(fallback)) throw new Error('Unknown numeric setting: ' + key);
  const magnitude = fallback === 0 ? 0 : 10 ** (Math.floor(Math.log10(Math.abs(fallback))) - 2);
  return Number(Math.max(spec.integer ? 1 : 0.01, magnitude).toPrecision(12));
}

// Only for manually edited inputs. Never normalize stored/calibrated values on load.
// Ticks are relative to the source DEFAULTS value, never to the editable input or min.
function normalizeNumericSetting(key, value) {
  const spec = NUMERIC_SETTING_SPECS[key];
  if (!spec || !Number.isFinite(value) || value < spec.min || value > spec.max) return null;
  const step = numericStep(key);
  const base = DEFAULTS[key];
  const lo = Math.ceil((spec.min - base) / step - 1e-9);
  const hi = Math.floor((spec.max - base) / step + 1e-9);
  const ticks = Math.min(hi, Math.max(lo, Math.round((value - base) / step + 1e-10)));
  const digits = (String(step).split('.')[1] || '').length;
  return Number((base + ticks * step).toFixed(digits));
}

export { NUMERIC_SETTING_SPECS, numericStep, normalizeNumericSetting };
