/**
 * Developer-only contracts documenting the persisted v2 ledger and transient runtime.
 * These declarations are deliberately not bundled into the userscript and do not
 * claim to validate data loaded from untrusted localStorage: decodeLedger() owns
 * runtime validation. Additional fields in current records are handled by decodeLedger().
 */
export type ChatKey = `chat:${string}`;
export type MessageKey = `msg:${string}`;
export type MessageRole = 'user' | 'assistant' | 'other';

export interface MessageRecord {
  role: MessageRole | string;
  tokens: number;
  chars: number;
  fingerprint: string;
}

/** A file record has additional optional metadata depending on its source. */
export interface FileRecord {
  name: string;
  size?: number;
  type?: string;
  /** Optional metadata from a visible, same-message React attachment component. */
  fileId?: string;
  metadataSource?: 'react-props' | string;
  durationSeconds?: number;
  messageId?: string;
  tokens?: number;
  source?: string;
  status?: 'reading' | 'ready' | 'error' | string;
  metadataOnly?: boolean;
  method?: string;
  detail?: string;
  lastSeenAt?: number;
  addedAt?: number;
  [field: string]: unknown;
}

export interface ImageRecord {
  [field: string]: unknown;
}

/** Real persistent schema: DO NOT rename fields or change their meaning casually. */
export interface LedgerV2 {
  chatKey: ChatKey | null;
  messages: Record<MessageKey, MessageRecord>;
  repairHistory: unknown[];
  attachmentLedgerVersion: 2;
  files: Record<string, FileRecord>;
  domImages: Record<string, ImageRecord>;
  updatedAt: number;
}

export interface PendingLocalFile {
  file: File;
  source: string;
  chatKey: ChatKey | null;
  identity: string;
  used: boolean;
  existingMessageIds: Set<string>;
  selectedAt: number;
}

export type RuntimePhase =
  | 'unknown'
  | 'ready'
  | 'generating'
  | 'switching'
  | 'awaiting-uuid'
  | string;

export interface RouteGate {
  beforeIds: Set<string>;
  beforeNodes: WeakMap<Element, string | null>;
  outgoingKnownIds: Set<string> | null;
  gate: null | {
    reason: string;
    visible: number;
    destinationKnown: number;
    outgoingOnly: number;
    outgoingMounted: number;
    shared: number;
  };
}

export interface RuntimeState {
  phase: RuntimePhase;
  work: { initial: boolean; backfill: boolean; completion: boolean };
  route: RouteGate | null;
}

/** Reconciliation can reject conflicts; it is not an atomic cross-tab lock. */
export type SaveState = (draft: LedgerV2) => boolean;

/** Ephemeral DOM identity, never persisted or shared across routes. */
export interface CollectedMessageEntry {
  el: Element;
  index: number;
  role: 'user' | 'assistant' | null;
  id: MessageKey | null;
}

/** DOM collector output. The WeakMap caches identity for this inspection only. */
export interface CollectedMessageSnapshot {
  nodes: Element[];
  identities?: WeakMap<Element, Pick<CollectedMessageEntry, 'role' | 'id'>>;
  rawCount: number;
  noLayout: number;
  collapsed: number;
  ambiguousIds: Set<MessageKey | string>;
}

/** Evidence computed from a single event-local collection, never stored. */
export interface CaptureCompletionContext {
  laterUser: boolean[];
  lastAssistantIndex: number;
}

/** Caller owns saveState() and render; commit helper only mutates draft entries. */
export interface CaptureCommitCounters {
  added: number;
  changed: number;
  unchanged: number;
  user: number;
  assistant: number;
  other: number;
}

/** Read-only presentation snapshot; no live DOM references or mutable route. */
export interface SessionDiagnosticSnapshot {
  readonly phase: RuntimePhase;
  readonly initial: boolean;
  readonly completion: boolean;
  readonly routePending: boolean;
  readonly gate: Readonly<NonNullable<RouteGate['gate']>> | null;
}
