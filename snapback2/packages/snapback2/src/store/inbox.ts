// @ref LLP 1018.004#2-the-inbox — a follower tab's write is a durable row in
// the partition's own database before `run()` resolves; the writer admits rows
// in key order, in the same transaction as the entry each becomes. Rows are
// insert-only from followers; only the writer marks admission or rejection.
import { canonical } from "./canonical.js";
import type { OutboxEntry } from "./range-store.js";

/** Rows of `queued` state per partition; a guard against a runaway follower, not the ledger's capacity. */
export const INBOX_LIMIT = 256;
const ALIAS = /^inbox:([1-9][0-9]*)$/;

export type InboxState = "queued" | "rejected";

export interface InboxRow {
  /** Auto-increment; assigned by the database in commit order, so key order is the device's durable insertion order. */
  key: number;
  kind: "mutation" | "dismiss";
  /** Canonical backend url + carrier namespace + principal: the same identity the writer announces. */
  scope: string;
  principal: string;
  /** The follower's established auth epoch; absent for a dev persona. */
  authEpoch?: number;
  /** Diagnostic only; never an ordering or ownership key. */
  followerId: string;
  op?: string;
  args?: unknown;
  /** Dismiss rows: the ledger intent or `inbox:` alias to dismiss. */
  target?: string;
  state: InboxState;
  /** The ledger intent this row became, once admitted. */
  admitted?: string;
  ids: string[];
  /** A rejection at admission (a `MutationRejected` envelope). */
  response?: unknown;
  createdAt: number;
  updatedAt: number;
}

/** A row before the database assigns its key. */
export type InboxInsert = Omit<InboxRow, "key">;

export interface InboxDelta {
  put?: InboxRow[];
  remove?: number[];
}

export function inboxAlias(key: number): string { return `inbox:${key}`; }

/** The row key an `inbox:` intent alias names, or undefined for a ledger intent. */
export function inboxKeyOf(intent: string): number | undefined {
  const match = ALIAS.exec(intent);
  if (!match) return undefined;
  const key = Number.parseInt(match[1]!, 10);
  return Number.isSafeInteger(key) ? key : undefined;
}

/**
 * Arguments must survive the ledger's JSON representation exactly: a value the
 * database can clone but the ledger cannot persist (a BigInt, a cycle, a Date)
 * is refused before any row exists (LLP 1018.004 §2).
 */
export function jsonArguments(args: unknown): unknown {
  let text: string;
  try { text = JSON.stringify(args); }
  catch (error) { throw new TypeError(`mutation arguments are not JSON-representable: ${error instanceof Error ? error.message : String(error)}`); }
  if (text === undefined) throw new TypeError("mutation arguments are not JSON-representable");
  const parsed: unknown = JSON.parse(text);
  if (canonical(parsed) !== canonical(args)) throw new TypeError("mutation arguments change under JSON representation");
  return parsed;
}

export function isInboxRow(value: unknown): value is InboxRow {
  if (!value || typeof value !== "object") return false;
  const row = value as Partial<InboxRow>;
  return typeof row.key === "number" && Number.isSafeInteger(row.key)
    && (row.kind === "mutation" || row.kind === "dismiss")
    && typeof row.scope === "string" && typeof row.principal === "string"
    && (row.authEpoch === undefined || Number.isSafeInteger(row.authEpoch))
    && typeof row.followerId === "string"
    && (row.kind !== "mutation" || typeof row.op === "string")
    && (row.kind !== "dismiss" || typeof row.target === "string")
    && (row.state === "queued" || row.state === "rejected")
    && (row.admitted === undefined || typeof row.admitted === "string")
    && Array.isArray(row.ids) && row.ids.every((id) => typeof id === "string")
    && typeof row.createdAt === "number" && typeof row.updatedAt === "number";
}

/**
 * An unadmitted or rejected mutation row as a screen reads it: a queued entry
 * with empty ids and empty grant fields, distinguishable by `inbox`, that
 * nothing replays (LLP 1018.004 §1).
 */
export function inboxEntry(row: InboxRow): OutboxEntry {
  return {
    intent: inboxAlias(row.key), grant: "", offset: 0, count: 0, ids: [...row.ids],
    op: row.op ?? "", args: row.args, issuedSeq: 0, state: row.state,
    ...(row.response === undefined ? {} : { response: row.response }),
    createdAt: row.createdAt, updatedAt: row.updatedAt, inbox: row.key,
  };
}

/** Rows a screen lists beside the ledger: mutation rows the writer has not admitted, and rows rejected at admission. */
export function unadmittedRows(rows: readonly InboxRow[]): InboxRow[] {
  return orderInbox(rows.filter((row) => row.kind === "mutation" && row.admitted === undefined));
}

/** Rows in key order: the device's durable insertion order (LLP 1018.004 §2). */
export function orderInbox(rows: readonly InboxRow[]): InboxRow[] {
  return [...rows].sort((left, right) => left.key - right.key);
}

/** The follower's read of a partition's inbox and persisted ledger, on its own connection. */
export interface InboxConnection {
  /** Inserts one row and returns the key the database assigned; refuses at `INBOX_LIMIT` queued rows. */
  insert(row: InboxInsert): Promise<number>;
  rows(): Promise<InboxRow[]>;
  /** Deletes one row this partition rejected at admission; the writer deletes every other row. */
  remove(key: number): Promise<void>;
  /** The persisted ledger entries, as the writer last committed them. */
  ledger(): Promise<Record<string, unknown>>;
  /** True once `versionchange` closed the connection: the partition is being upgraded or deleted. */
  readonly ended: boolean;
  close(): void;
}

export class InboxFull extends Error {
  constructor() {
    super(`this device holds ${INBOX_LIMIT} queued writes for another tab to admit`);
    this.name = "InboxFull";
  }
}
