  /** WATCHDOG_CONTRACT: persisted ledger fields; documentation, not input validation.
   * @typedef {Object} WatchdogLedgerV2
   * @property {string|null} chatKey
   * @property {Object<string, {role: string, tokens: number, chars: number, fingerprint: string}>} messages
   * @property {Array<*>} repairHistory
   * @property {number} attachmentLedgerVersion
   * @property {Object<string, *>} files
   * @property {Object<string, *>} domImages
   * @property {number} updatedAt
   */
  /** WATCHDOG_CONTRACT: an isolated DOM message collection with stable identities.
   * @typedef {Object} WatchdogCollectedMessages
   * @property {Element[]} nodes
   * @property {WeakMap<Element, {role: string, id: (string|null)}>} identities
   * @property {number} rawCount
   * @property {number} noLayout
   * @property {number} collapsed
   * @property {Set<string>} ambiguousIds
   */
  const APP = 'cgpt-context-watchdog';
  const SETTINGS_KEY = `${APP}:settings:v1`;
  // Persistent UUID message ledger. Refactoring keeps this schema unchanged.
  const STATE_PREFIX = `${APP}:state:v2:`;
  const HISTORY_KEY = `${APP}:ended-history:v2`;
  const RECOMMENDED_LOCAL_FILE_MIB = 75;
  const MAX_LOCAL_FILE_MIB = 256; // Configurable local plain-text reading limit.
  // Conservative character floor for ChatGPT-generated large-paste documents.
  // This is an inference from a recognized attachment label, not read content.
  // Configurable via Context → Attachment weights; default preserved at 10,000 chars.
  // Structural search units are primary; message-ID markup is a small fallback.
  const DOM_SELECTORS = Object.freeze({
    markdown: '[class*="MarkdownRoot-"]',
    userText: '.whitespace-pre-wrap',
    searchUnit: '[data-chatgpt-search-unit-key]',
    searchMessageIds: '[data-chatgpt-search-message-ids]'
  });
  // A single canonical UUID pattern for routes, DOM IDs and TSV diagnostics.
  const UUID_SOURCE = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
  const UUID_ANYWHERE_RE = new RegExp(UUID_SOURCE, 'gi');
  const UUID_ONLY_RE = new RegExp(`^${UUID_SOURCE}$`, 'i');
  const MESSAGE_KEY_RE = new RegExp(`^msg:(${UUID_SOURCE})$`, 'i');
  const CHAT_PATH_RE = new RegExp(`(?:^|/)c/(${UUID_SOURCE})(?:/|$)`, 'i');

  const HANDOFF_MAX_CHARS = 4000;
  const HANDOFF_PROMPT = `Подготовь PROJECT STATE / HANDOFF для продолжения текущей работы в новом чате.

Это не пересказ переписки. Передай самодостаточное рабочее состояние, достаточное для продолжения без доступа к текущему диалогу.

Структура:
1. Цель и статус — что мы делаем, какой результат нужен, что уже готово и какая версия или вариант приняты.
2. Принятые решения — действующие требования, договорённости, ограничения и важные уточнения пользователя. Отдельно отметь, что нельзя менять без согласования.
3. Точные данные и артефакты — существенные числа, параметры, имена, версии, форматы, пути и ссылки. Укажи, какие файлы потребуется заново проверить на доступность.
4. Проверки и проблемы — что подтверждено тестами, что ещё не проверено, какие варианты отвергнуты и почему.
5. Оставшаяся работа — незавершённые задачи, открытые вопросы и зависимости.
6. Следующий шаг — конкретное действие, с которого следует начать новому чату.

Правила: сохраняй детали, влияющие на результат, но не дублируй информацию и не пересказывай хронологию без необходимости. Не придумывай недостающие факты; неопределённое явно помечай. Не включай лишние личные данные и секреты. Используй язык текущего разговора.

В конце добавь раздел NEXT CHAT INSTRUCTION — короткое готовое первое сообщение для нового чата, которое указывает, что делать дальше и какие ограничения соблюдать.`;

  // One validation contract for UI, stored settings and the composer prompt.
  function isValidHandoffPrompt(value) {
    return typeof value === 'string' && value.trim().length > 0 &&
      value.length <= HANDOFF_MAX_CHARS;
  }

  // Shared Stable/Dev metadata-only controls use one registry for bounds, labels and hints.
  // Ranges and steps are QA proposals, pending final calibration approval.
  const METADATA_SETTING_SPECS = Object.freeze([
    Object.freeze({ key: 'metadataOnlyOptimisticBase', default: 300, min: 50, max: 3000, integer: true, label: 'Optimistic base (tokens)', hint: 'Starting optimistic token allowance before file-size and type adjustments.', field: 'metadataOptBase' }),
    Object.freeze({ key: 'metadataOnlyOptimisticSizeFactor', default: 1200, min: 100, max: 6000, integer: true, label: 'Optimistic size factor', hint: 'Optimistic size contribution per log2(1 + file size in MiB), before file-type weighting.', field: 'metadataOptSize' }),
    Object.freeze({ key: 'metadataOnlyOptimisticMax', default: 10000, min: 1000, max: 30000, integer: true, label: 'Optimistic maximum', hint: 'Upper limit for the optimistic metadata-only token estimate, after file-type weighting.', field: 'metadataOptMax' }),
    Object.freeze({ key: 'metadataOnlyPessimisticBase', default: 2000, min: 200, max: 12000, integer: true, label: 'Pessimistic base (tokens)', hint: 'Starting pessimistic token allowance before file-size and type adjustments.', field: 'metadataPessBase' }),
    Object.freeze({ key: 'metadataOnlyPessimisticSizeFactor', default: 9000, min: 500, max: 30000, integer: true, label: 'Pessimistic size factor', hint: 'Pessimistic size contribution per log2(1 + file size in MiB), before file-type weighting.', field: 'metadataPessSize' }),
    Object.freeze({ key: 'metadataOnlyPessimisticMax', default: 50000, min: 5000, max: 150000, integer: true, label: 'Pessimistic maximum', hint: 'Upper limit for the pessimistic metadata-only token estimate, after file-type weighting.', field: 'metadataPessMax' }),
    Object.freeze({ key: 'metadataOnlyTypeFactorSpreadsheet', default: 1.15, min: 0.25, max: 2, integer: false, label: 'Spreadsheets', hint: 'Scales both estimates for CSV, TSV, XLS, XLSX and ODS files when content is not read.', field: 'metadataSpreadsheet' }),
    Object.freeze({ key: 'metadataOnlyTypeFactorTextCode', default: 1, min: 0.25, max: 2, integer: false, label: 'Text / code', hint: 'Scales both estimates for text and code files when content is not read.', field: 'metadataTextCode' }),
    Object.freeze({ key: 'metadataOnlyTypeFactorPdf', default: 1, min: 0.25, max: 2, integer: false, label: 'PDF', hint: 'Scales both estimates for PDF files when content is not read.', field: 'metadataPdf' }),
    Object.freeze({ key: 'metadataOnlyTypeFactorDocument', default: 0.85, min: 0.25, max: 2, integer: false, label: 'Documents', hint: 'Scales both estimates for DOC, DOCX, ODT and RTF files when content is not read.', field: 'metadataDocument' }),
    Object.freeze({ key: 'metadataOnlyTypeFactorPresentation', default: 0.8, min: 0.25, max: 2, integer: false, label: 'Presentations', hint: 'Scales both estimates for PPT, PPTX and ODP files when content is not read.', field: 'metadataPresentation' }),
    Object.freeze({ key: 'metadataOnlyTypeFactorArchive', default: 0.5, min: 0.25, max: 2, integer: false, label: 'Archives', hint: 'Scales both estimates for ZIP, 7z, RAR, GZ and TAR files when content is not read.', field: 'metadataArchive' }),
    Object.freeze({ key: 'metadataOnlyTypeFactorOther', default: 0.65, min: 0.25, max: 2, integer: false, label: 'Other', hint: 'Scales both estimates for file types outside the other six groups.', field: 'metadataOther' }),
  ]);
  // Build replaces the marker in both variants; metadata settings are shared.
  const IS_DEV_BUILD = '__WATCHDOG_DEV_BUILD__' === 'true';

  const DEFAULTS = {
    conservativeBudget: 80000,
    normalBudget: 120000,
    optimisticBudget: 180000,
    messageOverhead: 8,
    hiddenOptimistic: 4000,
    hiddenPessimistic: 16000,
    averageImageTokens: 2000,
    historicalFileFallbackTokens: 1000,
    localFileParsingLimitMiB: RECOMMENDED_LOCAL_FILE_MIB,
    historyPriorStrength: 4,
    ...Object.fromEntries(METADATA_SETTING_SPECS.map(spec => [spec.key, spec.default])),
    budgetCalibrationBase: null, // pre-calibration anchor; current displayed budgets remain editable
    budgetCalibrationWeight: 0, // weight actually applied at last sample, not live recomputation
    // Single file contribution interval; no time-based file ageing.
    fileOptimisticPct: 25,
    filePessimisticPct: 75,
    imageOptimisticPct: 20,
    imagePessimisticPct: 80,
    pastedMinChars: 10000,
    pastedEnglishCharsPerToken: 4,
    pastedCyrillicCharsPerToken: 2.75,
    // Source-text and code estimators: existing heuristics are retained.
    proseCyrillicCharsPerToken: 2.38,
    proseLatinCharsPerToken: 3.45,
    proseDigitsCharsPerToken: 2.6,
    prosePunctuationCharsPerToken: 1.5,
    proseOtherCharsPerToken: 1,
    proseMinTokensPerWord: 1.45,
    codeCharsPerToken: 2.3,
    handoffPrompt: HANDOFF_PROMPT,
    badgePosition: null,
    viewStyle: 'soft',
    viewTheme: 'chatgpt',
    logoPreference: 'openai',
    watchdogPaused: false
  };

  const IMAGE_EXTS = new Set([
    'png','jpg','jpeg','webp','gif','bmp','avif','heic','heif','tif','tiff'
  ]);

  const TEXT_EXTS = new Set([
    'txt','md','markdown','csv','tsv','json','jsonl','xml','html','htm',
    'js','mjs','cjs','ts','tsx','jsx','py','rb','php','java','kt','kts',
    'c','cc','cpp','cxx','h','hpp','cs','go','rs','swift','scala','sh',
    'bash','zsh','fish','ps1','sql','yaml','yml','toml','ini','cfg','conf',
    'log','tex','r','lua','dart','vue','svelte','css','scss','less'
  ]);

  const DOCUMENT_EXTS = new Set([
    ...TEXT_EXTS,
    'pdf','doc','docx','odt','rtf','xls','xlsx','ods','ppt','pptx','odp',
    'zip','7z','rar','gz','tar'
  ]);

  const FILE_SIZE_UNITS = {
    B: 1,
    KB: 1000,
    MB: 1000 ** 2,
    GB: 1000 ** 3,
    KIB: 1024,
    MIB: 1024 ** 2,
    GIB: 1024 ** 3
  };

export { APP, SETTINGS_KEY, STATE_PREFIX, HISTORY_KEY, RECOMMENDED_LOCAL_FILE_MIB, MAX_LOCAL_FILE_MIB, DOM_SELECTORS, UUID_SOURCE, UUID_ANYWHERE_RE, UUID_ONLY_RE, MESSAGE_KEY_RE, CHAT_PATH_RE, DEFAULTS, METADATA_SETTING_SPECS, IS_DEV_BUILD, IMAGE_EXTS, TEXT_EXTS, DOCUMENT_EXTS, FILE_SIZE_UNITS, HANDOFF_PROMPT, HANDOFF_MAX_CHARS, isValidHandoffPrompt };
