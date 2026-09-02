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

export interface RowRecord {
  table: string;
  id: string;
  row: Value;
}

export interface ReceiptRange {
  site: string;
  table: string;
  index: string;
  prefix: Value[];
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
  halo: RowRecord | null;
  n2_key: Value[] | null;
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
  localResult: Value | null;
  errorCode: string | null;
  localState: string;
  partialSites: string[];
  canonicalResult: string;
  digest: string;
  rangeStops: Record<string, string[]>;
  evictedRows: number | null;
}

export interface CorpusCase {
  corpusVersion: number;
  name: string;
  category: string;
  randomSeed: number | null;
  schema: any;
  program: any;
  certificate: any;
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
  site: string;
  table: string;
  index: string;
  prefix: Value[];
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
}

export interface TraceAbsence {
  site: string;
  table: string;
  index: string;
  key: Value[];
}

export interface TracePoint {
  site: string;
  table: string;
}

export interface Trace {
  ranges: TraceRange[];
  absences: TraceAbsence[];
  points: TracePoint[];
}

export interface Execution {
  result: Value;
  trace: Trace;
}

export interface LocalExecution {
  state: "fresh" | "predicted" | "partial";
  partialSites: string[];
  execution: Execution;
}
