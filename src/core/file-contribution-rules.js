// File contribution is a display-time estimate, not a change to the file ledger.
// Keep settings data-only: never use arbitrary object keys as property accessors.
const EXTENSION_RE = /^[a-z0-9]{1,16}$/;
const PERCENT_FIELDS = Object.freeze(['parsedMin', 'parsedMax', 'metadataMin', 'metadataMax']);
const MAX_EXTENSION_RULES = 64;

function normalizedExtension(value) {
  if (typeof value !== 'string') return '';
  const name = value.trim().replace(/^\./, '').toLowerCase();
  return EXTENSION_RE.test(name) ? name : '';
}

function validContributionPercent(value) {
  return typeof value === 'number' && Number.isFinite(value) &&
    value >= 0 && value <= 100 && Math.abs(Math.round(value * 100) - value * 100) < 1e-8;
}

function parseContributionPercent(value) {
  const text = String(value).trim();
  if (!/^(?:\d{1,3})(?:\.\d{1,2})?$/.test(text)) return null;
  const num = Number(text);
  return validContributionPercent(num) ? num : null;
}

function normalizeContributionRules(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const entries = Object.entries(value);
  if (entries.length > MAX_EXTENSION_RULES) return {};
  const normalized = {};
  for (const [key, rule] of entries) {
    const ext = normalizedExtension(key);
    if (!ext || key !== ext || Object.hasOwn(normalized, ext) || !rule ||
        typeof rule !== 'object' || Array.isArray(rule)) return {};
    const values = {};
    for (const field of PERCENT_FIELDS) {
      if (!validContributionPercent(rule[field])) return {};
      values[field] = rule[field];
    }
    if (values.parsedMin > values.parsedMax ||
        values.metadataMin > values.metadataMax) return {};
    Object.defineProperty(normalized, ext, {value: values, enumerable: true, configurable: true, writable: true});
  }
  return normalized;
}

function contributionForFile(file, settings, kind) {
  const name = String(file?.name || '');
  const match = /\.([a-z0-9]{1,16})$/i.exec(name);
  const ext = match?.[1].toLowerCase() || '';
  const rule = ext && Object.hasOwn(settings.fileContributionByExt || {}, ext)
    ? settings.fileContributionByExt[ext] : null;
  if (kind === 'parsed') {
    return rule ? [rule.parsedMin, rule.parsedMax]
      : [settings.fileOptimisticPct, settings.filePessimisticPct];
  }
  return rule ? [rule.metadataMin, rule.metadataMax]
    : [settings.metadataFileOptimisticPct, settings.metadataFilePessimisticPct];
}

export { PERCENT_FIELDS, MAX_EXTENSION_RULES, normalizedExtension,
  validContributionPercent, parseContributionPercent, normalizeContributionRules,
  contributionForFile };
