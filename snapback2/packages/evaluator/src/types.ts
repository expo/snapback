import type { IndexAtom } from './search-key';
export type { IndexAtom, IndexComponent, IndexKeyExpr } from './search-key';
// @ref LLP 1001#10-what-binds-and-how-it-is-checked — argument refinements are certified IR, including inside containers; column Text stays max-only.
export type ArgType =
  | 'Cursor' | 'Id' | 'Principal' | 'Int' | 'Bool' | 'Time' | 'Scalar'
  | { Ref: { table: string } }
  | { Text: { max: number; min?: number; format?: 'handle' | 'url' } }
  | { Bytes: { max: number } } | { Image: { max: number } } | { Video: { max: number } }
  | { Json: { max_bytes: number } } | { Enum: { variants: string[] } }
  | { Decimal: { scale: number } } | { Money: { currency: string; scale: number } }
  | { Optional: ArgType } | { List: { of?: ArgType | null; max: number } };

export type Value =
  | "Null"
  | { Bool: boolean }
  | { Int: number }
  | { String: string }
  | { Id: string }
  | { Bytes: string }
  | { Row: Record<string, Value> }
  | { Array: Value[] }
  | { Map: Record<string, Value> };

export interface Context {
  viewer: string;
  principal_kind: string;
  auth_epoch: number;
  args: Record<string, Value>;
  now: number | null;
  new_ids: string[];
  read_time: number | null;
}

export interface RowRef { table: string; id: string }
export interface ScopeTouch { table: string; index: string; prefix: Value[] }

export interface RowRecord {
  table: string;
  id: string;
  row: Value;
}

export interface ReceiptRange {
  site: string;
  table: string;
  index: string;
  prefix: IndexAtom[];
  order: "Asc" | "Desc";
  take: number;
  after: Value | null;
  before: Value | null;
  gt: Value | null;
  gte: Value | null;
  lt: Value | null;
  lte: Value | null;
  rule_hash: string;
  row_ids: string[];
  stop: "Limit" | "Exhausted";
  absence: boolean;
  halo: RowRef | null;
  n2_suffix: Value[] | null;
  /** Members a later swap evicted from this page (LLP 1012 §5); a page with a hole covers nothing whole. */
  evicted_ids?: string[];
  /** Local carrier metadata: original page endpoint, never a server receipt field. */
  held_suffix?: Value[];
}

export interface Verdict {
  rule_hash: string;
  pinned_inputs_digest: string;
  principal: string;
  auth_epoch: number;
  result: boolean;
}

export interface ClosureReceipt {
  schema_hash?: string | null;
  rows: RowRecord[];
  ranges: ReceiptRange[];
  absences: [string, string, Value[]][];
  verdicts: Verdict[];
}

export interface PreludeStep {
  program: any;
  context: Context;
  expectedState: string;
}

export interface CorpusExpected {
  errorReason?: string;
  localResult: Value | null;
  errorCode: string | null;
  localState: string;
  partialSites: string[];
  canonicalResult: string;
  digest: string;
  rangeStops: Record<string, string[]>;
  evictedRows: number | null;
  next?: string | null;
}

export interface CorpusCase {
  serverOnly?: boolean;
  certificationRewrite?: string;
  corpusVersion: number;
  name: string;
  category: string;
  randomSeed: number | null;
  schema: any;
  program: any;
  certificate: any | null;
  context: Context;
  receipt: ClosureReceipt;
  prelude: PreludeStep[];
  replacementReceipt: ClosureReceipt | null;
  expected: CorpusExpected;
}

export interface ActualResult extends CorpusExpected {}

export interface HydrationResult {
  planState: "ready" | "replay-mismatch";
  servedResult: Value | null;
  actual: ActualResult;
  diagnostic: string | null;
}

export interface TraceRange {
  halo: RowRef | null;
  n2_suffix: Value[] | null;
  site: string;
  table: string;
  index: string;
  /** The IR node's provenance (`Arg`, `Viewer`, `Const`, `Shape`, …): where its prefix came from. */
  provenance?: string;
  prefix: IndexAtom[];
  order: "Asc" | "Desc";
  take: number;
  after: Value | null;
  before: Value | null;
  gt: Value | null;
  gte: Value | null;
  lt: Value | null;
  lte: Value | null;
  rule_hash: string;
  stop: "limit" | "exhausted";
  lastReturnedSuffix: Value[] | null;
}

export interface TraceAbsence {
  site: string;
  table: string;
  index: string;
  key: Value[];
  provenance?: string;
}

// @ref LLP 1012#7-writes-offline — every point read with the digest of the row
// it saw (SHA-256 over the canonical wire row, the form the pool carries) or
// `null` for the absence it relied on; a hidden hit reads as an absence, as the
// server's compare treats it.
export interface TracePoint {
  site: string;
  table: string;
  index: string;
  key: Value[];
  digest: string | null;
  provenance?: string;
}

/** A rule verdict this run derived on a row it could read, keyed as the server keys its rule inputs. */
export interface TraceVerdict {
  rule_hash: string;
  inputs_digest: string;
  result: boolean;
}

export interface Trace {
  rows?: RowRecord[];
  examined?: number;
  steps?: number;
  derived_steps?: number;
  derived_scratch_bytes?: number;
  scope_touches?: ScopeTouch[];
  rule_probes?: number;
  ranges: TraceRange[];
  absences: TraceAbsence[];
  points: TracePoint[];
  merges: Array<{ site: string; deduplicated_union_len: number; last_returned_suffix: Value[] | null }>;
  verdicts: TraceVerdict[];
}

/** One row a mutation left behind: its final image, or `null` when it deleted the row. */
export interface TraceWrite {
  /** Assignment mask for Update; absent for an insert, replace or delete. */
  fields?: string[];
  table: string;
  id: string;
  row: Value | null;
}

export interface Execution {
  result: Value;
  trace: Trace;
  next: string | null;
  writes: TraceWrite[];
  /** Internal page execution identity; never a server continuation. */
  page?: any;
  held?: boolean;
}

export interface LocalExecution {
  state: "fresh" | "predicted" | "partial";
  partialSites: string[];
  execution: Execution;
  /** A predicted mutation's reads outside coverage (ranges evaluated over held rows, unheld absences), judged before its writes. */
  uncoveredSites?: string[];
  /** A partial mutation's `missing-authority` causes: unheld engine-owned aggregate targets versus everything else. */
  authorityMisses?: { maintainTargets: string[]; other: number };
}
