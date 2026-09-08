import { decodeHeldProgram, queryClock } from "./held-program.js";
export { decodeHeldProgram } from "./held-program.js";
import { tombstonesFor } from "./tombstones.js";
import { SnapbackRefusal, throwIfAborted, isSnapbackRefusal } from "./client-wire.js";
import { ClockCoverageReset, FullRevalidationRequired } from './store/fact-integrity.js';
import {
  DeliveryEnvelopeDecodeError,
  decodeDeliveryEnvelope,
  prepareClosureReceipt, preparedDeliveryRows, preparedDeliveryRanges,
  expandRows,
  type DeliveryEnvelopeV1,
} from "./offline-protocol.js";
import { OutboxLedger, OutboxRefusal, decodeGrant } from "./store/outbox.js";
import { inboxEntry, jsonArguments, orderInbox, unadmittedRows, type InboxConnection, type InboxInsert, type InboxRow } from "./store/inbox.js";
import { canonical } from "./store/canonical.js";
import {
  canonicalAnswerKey, preparedChanges,
  OfflineStoreFailure,
  type Coverage,
  type CoverageFacts,
  type HeldAnswer,
  type HeldOperation,
  type HeldProgram,
  type OfflineSchema,
  type OutboxEntry,
  type OutboxGrant,
  type RangeStore,
  type RetentionPolicy,
  type RowRef,
  type StoreDelivery,
  type StoreSwap,
  type StoreRefresh,
  type StoreTombstone,
  type WatermarkRecord,
  tailWatermark,
} from "./store/range-store.js";
import { ByteCache } from "./store/byte-cache.js";
import { rowKey } from "./store/row-values.js";
import { Twin, readsConnected, type LocalAnswer, type Prediction } from "./twin.js";
import { carryItemInputs, emptyItemInputs, itemInputs, withItemInputs } from "./query-frame.js";
import { deliveredItemInputs } from "./query-items.js";
import type { DrainContract, Manifest, OfflineClientOptions, OutboxSettlement, RefusalEnvelope } from "./types.js";

/**
 * Ids a certified mutation can mint: the certificate's insert/upsert bounds, which
 * already price every row the program creates. A program without a certificate
 * has no bound, and an offline write against it refuses rather than guessing.
 */
export function certificateMaxNewIds(program: unknown): number | undefined {
  if (!object(program)) return undefined;
  const certificate = program.certificate;
  if (!object(certificate) || !Array.isArray(certificate.write_sites)) return undefined;
  let total = 0;
  for (const site of certificate.write_sites) {
    if (!object(site)) continue;
    if ((site.kind === "Insert" || site.kind === "Upsert") && Number.isSafeInteger(site.max_rows)) {
      total += Number(site.max_rows);
    }
  }
  return total;
}

// The tail chooser lives with the store, which keys the overlay drop by it; the
// settlement tail and the resume's `log` import it from here as before.
export { tailWatermark };

export interface MountedQuery {
  op: string;
  args: unknown;
  drain: boolean;
  refuse?(refusal: RefusalEnvelope): void;
}

export interface ResumeRequestV1 {
  protocol: 1;
  generation: string;
  schemaHash: string;
  authEpoch: number;
  log?: { op: string; args: unknown; watermark: string | null; validator?: string };
  mounted: Array<{ op: string; args: unknown; validator: string }>;
}

export interface ResumeAdjustment {
  cap?: number;
}

export interface AcceptedDelivery<Result> {
  result: {
    state: "complete" | "capped" | "partial" | "denied";
    data?: Result;
    next?: string | null;
    seq: number;
    reason?: string;
    rule?: string;
  };
  envelope?: DeliveryEnvelopeV1;
  refresh?: StoreRefresh;
  /** One authenticated full read, captured under the original request's authority. */
  revalidate?: () => Promise<AcceptedDelivery<Result>>;
}

type ResumeFacts = CoverageFacts;

// @ref LLP 1012#15-diagnostics — a local authority violation (a delivery for
// another principal or auth epoch; a commit with no partition open) has its
// own code: it is never `E_OFFLINE_RESET`, which drops held coverage, so a
// healthy store is refused a delivery and keeps everything. A delivery under
// another generation or schema is not a violation but a rotation: it is not
// held, and the coverage is superseded until the reset path (`commitMany`).
export class OfflineAuthorityError extends Error {
  readonly code = "E_OFFLINE_AUTHORITY";
  constructor(message: string) {
    super(message);
    this.name = "OfflineAuthorityError";
  }
}

function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** The argument the manifest types `Cursor` (or `Optional(Cursor)`), by name order as the server picks it. */
function cursorArgument(args: unknown): string | undefined {
  if (!object(args)) return undefined;
  for (const name of Object.keys(args).sort()) {
    const kind = args[name];
    if (kind === "Cursor" || (object(kind) && kind.Optional === "Cursor")) return name;
  }
  return undefined;
}

/**
 * Walks the envelope's reference form beside its expansion and nulls every `$row`
 * that names a viewed view-once row, so a live frame or a fresh query never
 * re-renders what `answer()` already hides (LLP 1012 §9).
 */
function nullViewed(reference: unknown, expanded: unknown, viewed: Set<string>): unknown {
  if (!object(reference)) {
    return Array.isArray(reference) && Array.isArray(expanded)
      ? expanded.map((item, index) => nullViewed(reference[index], item, viewed))
      : expanded;
  }
  const marker = reference.$row;
  if (object(marker) && Object.keys(reference).length === 1) {
    if (typeof marker.table === "string" && typeof marker.id === "string" && Object.keys(marker).length === 2) {
      return viewed.has(rowKey({ table: marker.table, id: marker.id })) ? null : expanded;
    }
    if (object(marker.$value) && object(expanded)) return nullViewed(marker.$value, expanded, viewed);
  }
  if (!object(expanded)) return expanded;
  return Object.fromEntries(Object.entries(expanded)
    .map(([key, item]) => [key, nullViewed(reference[key], item, viewed)]));
}

// @ref LLP 1012#6-reads-offline — owner-derived returned-page metadata, never a scan/name/cursor heuristic.
export function admitDrain(op: string, contract: DrainContract | undefined): string {
  if (contract && "cursor" in contract && typeof contract.cursor === "string" && contract.cursor.length > 0) return contract.cursor;
  const shape = contract && "reason" in contract ? contract.reason : "metadata-unavailable";
  throw new SnapbackRefusal({ code: "E_OFFLINE_RESUME", family: "offline", guide: "offline",
    reason: "unsupported-log", which: "log", op, shape, site: "client.subscribe.drain",
    message: `operation ${op} cannot drain/resume a log (${shape}); every returned page must ascend after the same cursor with at most 50 rows`,
    rewrite: "use an ascending delivery log (after c first N, N <= 50); subscribe normally at c: null for newest-first data; reconnect if metadata is unavailable; queued writes are kept" });
}

// @ref LLP 1012#15-diagnostics — invalid options are TypeErrors; carrier-thrown errors retain their refusal semantics.
export class InvalidOfflineStoreError extends TypeError {}

export class OfflineRuntime {
  readonly store: RangeStore;
  readonly fenceDays: number;
  readonly maxAssetBytes: number;
  /** Asset bytes beside the rows, under their lease (LLP 1012 §9); lane O4. */
  readonly bytes: ByteCache;
  readonly outbox: OutboxLedger;
  /** The replay currently in flight; the next drain queues behind it. Never rejects. */
  drainTail: Promise<void> = Promise.resolve();
  /**
   * The last drain's outcome, rejection kept: `settled()` awaits this so a
   * non-retryable refusal that stopped the replay reaches the caller instead of
   * resolving with intents still queued (LLP 1012 §7).
   */
  drainOutcome: Promise<OutboxSettlement> = Promise.resolve({ stopped: false, remaining: 0 });
  /** The twin: the certified program over this partition's coverage (LLP 1012 §6, §7). */
  readonly twin: Twin;
  private partition?: string;
  /** The principal whose writer lock this tab is waiting for (a browser follower), and the wait that owns the marker. */
  private followingPrincipal?: string;
  private followingWait?: object;
  // @ref LLP 1018.004#2-the-inbox — a follower's own connection to the partition
  // it waits for, and both roles' last read of the inbox; a follower also keeps
  // the writer's persisted ledger as it last read it.
  private inboxConnection?: InboxConnection;
  private inboxRowsCache: InboxRow[] = [];
  private inboxLedgerCache: Record<string, OutboxEntry> = {};
  private retention: Record<string, RetentionPolicy> = {};
  private cursors: Record<string, string> = {};
  private schema?: OfflineSchema;
  private facts?: ResumeFacts;
  /** Set by a delivery under another generation or schema: held coverage is stale-exact until the reset path (LLP 1012 §8). */
  private superseded?: CoverageFacts;
  private latestSeq = 0;
  private sessionEpoch?: number;
  private pendingGrant?: OutboxGrant;
  private pendingBounds?: Record<string, number>;
  private pendingProgram?: HeldProgram;
  private held?: HeldProgram;
  private drains: Record<string, DrainContract | undefined> = {};
  private resumeQueries: MountedQuery[] = [];
  private tail: Promise<void> = Promise.resolve();
  private readonly inputListeners = new Set<() => void>();
  private readonly stopInputChanges?: () => void;
  /** Fences deliveries already in flight when coverage or principal is replaced. */
  coverageRevision = 0;

  constructor(private readonly options: OfflineClientOptions) {
    this.store = options.store();
    // Check the result once, structurally: custom carriers need no built-in brand.
    if (typeof this.store?.open !== "function") {
      throw new InvalidOfflineStoreError("createClient offline.store must return a RangeStore with open(); for IndexedDB, use offline: { store: indexedDbRangeStore() }. See snapback2 guide offline");
    }
    this.fenceDays = options.fenceDays ?? 7;
    this.maxAssetBytes = options.maxAssetBytes ?? 256 * 1024 * 1024;
    this.bytes = new ByteCache(this.store, { maxAssetBytes: this.maxAssetBytes });
    this.outbox = new OutboxLedger(this.store, {
      now: () => Date.now(),
      fenceMs: this.fenceDays * 24 * 60 * 60 * 1_000,
    });
    this.twin = new Twin({
      program: () => this.held,
      changes: since => this.store[preparedChanges]?.(since) ?? this.store.changes(since),
      principal: () => this.partition,
      now: () => Date.now(),
      seq: () => this.latestSeq,
    });
    this.stopInputChanges = this.store.subscribeInputs(() => {
      for (const listener of [...this.inputListeners]) {
        try { listener(); } catch { /* query observers cannot fail a committed swap */ }
      }
    });
  }

  get principal(): string | undefined { return this.partition; }

  /** Bind a returned owner image to its own receipt after admission into this account. */
  async withQueryItems<T extends object>(op: string, args: unknown, accepted: AcceptedDelivery<unknown>, value: T): Promise<T> {
    const entries = await this.itemEntries();
    if (accepted.envelope) {
      const inputs = deliveredItemInputs(accepted.envelope, (value as { data?: unknown }).data, entries);
      if (!inputs.selection) {
        const held = await this.answer(op, args);
        // Carry a past query observation, never a later concurrent answer into this frame.
        if (held && held.seq <= accepted.envelope.seq) return withItemInputs(value, {
          ...inputs, selection: itemInputs(held)?.selection,
        });
      }
      return withItemInputs(value, inputs);
    }
    // Unchanged carries the held answer's image evidence. A local refresh can
    // subsequently use the newly ordered durable observation of that image.
    return withItemInputs(value, { ...(itemInputs(accepted.result) ?? emptyItemInputs), entries });
  }
  /**
   * A sealed partition exposes neither query data nor its retained intent
   * history. A follower lists the writer's persisted ledger as it last read it
   * plus its partition's unadmitted rows; the writer lists its ledger plus the
   * same rows, so "changes on this device" is the device's on either tab and an
   * admitted row appears once (LLP 1018.004 §2).
   */
  async itemEntries(): Promise<OutboxEntry[]> {
    const rows = unadmittedRows(this.inboxRowsCache).map(inboxEntry);
    if (this.inboxConnection) {
      const ledger = Object.values(this.inboxLedgerCache).filter((entry) => entry && typeof entry === "object" && typeof entry.intent === "string")
        .sort((left, right) => (left.order ?? Number.MAX_SAFE_INTEGER) - (right.order ?? Number.MAX_SAFE_INTEGER) || left.createdAt - right.createdAt);
      return [...ledger, ...rows];
    }
    if (this.partition === undefined) return [];
    try { return [...await this.outbox.entries(), ...rows]; }
    catch (error) {
      if (error instanceof Error && /sealed/.test(error.message)) return [];
      throw error;
    }
  }
  get authEpoch(): number | undefined { return this.sessionEpoch ?? this.facts?.authEpoch; }
  get coordinationScope(): string | undefined { return this.store.coordinationScope; }

  /** The generation of the certified program this partition holds, if any. */
  get programGeneration(): string | undefined { return this.held?.generation; }

  /** A live delivery rotated past the held coverage; only the reset resume may clear it. */
  get resetNeeded(): boolean { return this.superseded !== undefined; }

  get needsDrainMetadata(): boolean { return !!this.held && Object.values(this.held.programs).some(op => op.drain === undefined); }

  /** Observe committed local inputs; each listener schedules and fences its own evaluation. */
  subscribeInputs(listener: () => void): () => void {
    this.inputListeners.add(listener);
    return () => { this.inputListeners.delete(listener); };
  }

  /** The twin's answer for a query, or `undefined` when it cannot run (no program, another generation). */
  async evaluate(op: string, args: unknown): Promise<LocalAnswer | undefined> {
    if (this.partition === undefined) return undefined;
    return this.twin.evaluate(op, args);
  }

  /** The twin's run of a mutation over held rows with the intent's pinned ids. */
  async predict(op: string, args: unknown, ids: string[]): Promise<Prediction> {
    return this.twin.predict(op, args, ids);
  }

  /** The highest server seq this runtime has committed; what a queued intent was issued against. */
  get seq(): number { return this.latestSeq; }

  /** A browser tab whose account another tab is writing: it waits for that partition's lock. */
  get following(): boolean { return this.followingPrincipal !== undefined; }
  /** Whether this carrier can wait for a held writer lock at all (IndexedDB can; SQLite refuses at once). */
  get canFollow(): boolean { return typeof this.store.acquire === "function" && typeof this.store.giveBack === "function"; }

  // @ref LLP 1018.000#8-account-sessions-and-durable-follower-admission — the follower tab
  // waits outside the runtime queue, so its live reads keep flowing; when the
  // writer closes, it opens the partition and inherits the queue left there.
  async follow(principal: string, signal: AbortSignal, wait: object = {}): Promise<void> {
    if (!this.store.acquire) throw new OfflineStoreFailure("E_OFFLINE_LOCK", "this account is open in another client; close it and try again");
    this.followingPrincipal = principal;
    this.followingWait = wait;
    // The inbox route opens before the wait so a reloaded tab shows its device's
    // queued rows from durable state before any network request (LLP 1018.004 §2).
    // A failure here (an older tab holds the database at a lower version, or
    // no IndexedDB) leaves the follower with the hard refusal, not a broken wait.
    if (this.store.inbox && this.followingWait === wait) {
      try {
        const connection = await this.store.inbox(principal);
        if (this.followingWait === wait && !signal.aborted) {
          this.inboxConnection = connection;
          await this.refreshInbox().catch(() => undefined);
        } else connection.close();
      } catch { /* the follower status reports the missing route */ }
    }
    this.outbox.notify();
    try {
      await this.store.acquire(principal, signal);
      if (signal.aborted) {
        // Granted after the wait was withdrawn: give exactly this lock back. A
        // request a newer wait has queued, or a partition an open has since
        // taken, is not touched.
        await this.store.giveBack?.(principal);
        throwIfAborted(signal);
      }
      await this.open(principal);
    } catch (error) {
      this.followed(wait);
      throw error;
    }
    // Still following: the client clears the marker once the inherited partition is reauthenticated and resumed.
  }

  /** The takeover for `wait` finished, or failed: this tab is its writer now, or nothing. A newer wait's marker, even for the same principal, is not touched. */
  followed(wait: object): void {
    if (this.followingWait !== wait) return;
    this.followingPrincipal = undefined;
    this.followingWait = undefined;
    this.closeInbox();
    this.outbox.notify();
  }

  /** A follower holds a live route to the partition's inbox; ends on `versionchange` (LLP 1018.004 §2). */
  get inboxAvailable(): boolean { return this.inboxConnection !== undefined && !this.inboxConnection.ended; }

  private closeInbox(): void {
    this.inboxConnection?.close();
    this.inboxConnection = undefined;
    this.inboxRowsCache = [];
    this.inboxLedgerCache = {};
  }

  private publishInputs(): void {
    for (const listener of [...this.inputListeners]) {
      try { listener(); } catch { /* query observers cannot fail a durable read */ }
    }
  }

  /** A follower's write: durable in the partition's inbox before this resolves; the key names it as `inbox:<key>`. */
  async insertInbox(row: InboxInsert): Promise<number> {
    const connection = this.inboxConnection;
    if (!connection || connection.ended) {
      throw new OfflineStoreFailure("E_OFFLINE_LOCK", "this tab has no route to the account's partition; another tab holds it and this one cannot reach its inbox");
    }
    const key = await connection.insert({ ...row, ...(row.kind === "mutation" ? { args: jsonArguments(row.args) } : {}) });
    await this.refreshInbox().catch(() => undefined);
    return key;
  }

  /**
   * Re-reads the inbox, and for a follower the writer's persisted ledger, and
   * republishes outbox and query-item inputs when either changed. Both roles
   * call it on a nudge or a poll; the writer's admission loop reads for itself.
   */
  async refreshInbox(): Promise<boolean> {
    let rows: InboxRow[] = [], ledger: Record<string, OutboxEntry> = {};
    if (this.inboxConnection && !this.inboxConnection.ended) {
      rows = await this.inboxConnection.rows();
      ledger = (await this.inboxConnection.ledger()) as Record<string, OutboxEntry>;
    } else if (this.partition !== undefined && this.store.inboxRows) {
      rows = await this.store.inboxRows();
    } else return false;
    const changed = canonical(rows) !== canonical(this.inboxRowsCache) || canonical(ledger) !== canonical(this.inboxLedgerCache);
    this.inboxRowsCache = rows;
    this.inboxLedgerCache = ledger;
    if (changed) { this.outbox.notify(); this.publishInputs(); }
    return changed;
  }

  /** Rows the writer has not admitted, plus rows rejected at admission, as a screen lists them. */
  get inboxRows(): InboxRow[] { return this.inboxRowsCache; }

  /** A follower deletes a row its partition rejected at admission; every other row is the writer's to delete. */
  async removeInboxRow(key: number): Promise<void> {
    const connection = this.inboxConnection;
    if (!connection || connection.ended) throw new OfflineStoreFailure("E_OFFLINE_LOCK", "this tab has no route to the account's partition");
    await connection.remove(key);
    await this.refreshInbox().catch(() => undefined);
  }
  /** Queued rows awaiting the writer: what a follower's status counts as remaining. */
  get inboxPending(): number { return this.inboxRowsCache.filter((row) => row.kind === "mutation" && row.state === "queued" && row.admitted === undefined).length; }

  /**
   * The writer's admission loop, in key order. A temporary refusal (no grant,
   * an expired or spent grant, a bound not yet recorded) leaves the row queued
   * and stops the loop behind it; a mismatched identity or an operation the
   * held program does not declare settles the row rejected (LLP 1018.004 §2).
   * Runs against the open partition whether or not the follower marker is
   * still set, so takeover can admit inherited rows before its first resume.
   */
  async admitInbox(check: { scope: string; custody(): void }): Promise<{ admitted: number; stopped?: string }> {
    if (this.partition === undefined || !this.store.inboxRows) return { admitted: 0 };
    const rows = orderInbox(await this.store.inboxRows());
    let admitted = 0, stopped: string | undefined;
    const refusal = (code: string, message: string, rewrite: string) => ({
      state: "rejected" as const, code, family: "offline", message, site: "client.inbox.admit", rewrite, guide: "offline",
    });
    for (const row of rows) {
      if (row.kind === "dismiss") { await this.outbox.consumeDismiss(row); continue; }
      if (row.state !== "queued" || row.admitted !== undefined || row.op === undefined) continue;
      const epochMismatch = row.authEpoch !== undefined && this.authEpoch !== undefined && row.authEpoch !== this.authEpoch;
      if (row.scope !== check.scope || row.principal !== this.partition || epochMismatch) {
        await this.outbox.rejectInbox(row, refusal("E_OFFLINE_FORWARDING_IDENTITY",
          "this write was saved under another account session, backend, or partition", "send it again from the current session"));
        continue;
      }
      if (this.held && (await this.store.outbox.bounds())[row.op] === undefined) {
        await this.outbox.rejectInbox(row, refusal("E_OFFLINE_PROGRAM",
          `${row.op} is not a mutation of the program this device holds`, "send it again once the program declares it"));
        continue;
      }
      try {
        const outcome = await this.outbox.admitInbox(row, check.custody, this.seq, (ids) => this.predict(row.op!, row.args, ids));
        if (outcome.outcome === "admitted") admitted += 1;
      } catch (error) {
        if (error instanceof OutboxRefusal) { stopped = error.code; break; }
        throw error;
      }
    }
    const after = orderInbox(await this.store.inboxRows());
    const changed = admitted > 0 || canonical(after) !== canonical(this.inboxRowsCache);
    this.inboxRowsCache = after;
    if (changed) { this.outbox.notify(); this.publishInputs(); }
    return { admitted, ...(stopped === undefined ? {} : { stopped }) };
  }

  async open(principal: string, authenticated = false): Promise<void> {
    if (this.partition !== principal) this.outbox.resetTrust();
    // The session allowance is dropped before the first await of a partition change:
    // a byte read that lands between the carrier's open and bind() must never hand
    // the previous principal's blob to the incoming partition (grok, O4-web round 2).
    if (this.partition !== undefined && this.partition !== principal) this.bytes.forget();
    await this.serial(async () => {
      if (this.partition !== principal) {
        this.outbox.resetTrust();
        this.facts = undefined;
        this.superseded = undefined;
        this.held = undefined;
        this.drains = {};
        this.drainOutcome = Promise.resolve({ stopped: false, remaining: 0 });
      }
      if (this.partition !== undefined && this.partition !== principal) await this.store.wipe(this.partition);
      if (this.partition !== principal) {
        // Between the old partition's wipe and the new one's open the runtime
        // names no partition: a refused open (a follower) must not leave it on
        // the old principal, where a delivery would meet an authority mismatch.
        this.partition = undefined;
        this.coverageRevision += 1;
        this.facts = this.superseded = this.held = undefined;
        this.latestSeq = 0;
        this.sessionEpoch = undefined;
        this.cursors = {};
        this.schema = undefined;
      }
      await this.store.open(principal);
      if (authenticated) await this.store.unseal();
      this.partition = principal;
      this.bytes.bind(principal);
      await this.loadFacts();
      await this.loadProgram();
      await this.flushGrant();
      await this.flushBounds();
      this.outbox.notify();
    });
  }

  /** Called only after the owner authenticated this exact principal. */
  async reauthenticate(principal: string, authEpoch?: number): Promise<void> {
    // @ref LLP 1012#4-the-range-store — a new session invalidates requests already in
    // flight before custody awaits. The first epoch this partition learns is adopted, not a
    // change: nothing in flight belongs to an older session, and superseding the drain's
    // first page here left every persona app without its first grant (the browser witness).
    const known = this.sessionEpoch ?? this.facts?.authEpoch;
    const changed = authEpoch !== undefined && known !== undefined && authEpoch !== known;
    if (changed) { this.coverageRevision += 1; this.outbox.resetTrust(); }
    await this.serial(async () => {
      if (this.partition !== principal) {
        throw new OfflineAuthorityError(`authenticated principal ${principal} does not match the open offline partition`);
      }
      await this.store.unseal();
      await this.loadFacts();
      if (authEpoch !== undefined) {
        // @ref LLP 1012#4-the-range-store — same-principal leases and unsent
        // intents survive login; the new authenticated epoch revalidates their
        // old validators on resume, without treating old deliveries as current.
        if (this.facts && this.facts.authEpoch !== authEpoch) {
          const facts = { ...this.facts, authEpoch };
          await this.store.commit({ facts });
          this.facts = facts;
        }
        this.sessionEpoch = authEpoch;
      }
      await this.loadProgram();
      await this.flushGrant();
      await this.flushBounds();
      this.outbox.notify();
    });
  }

  /**
   * Records the `grant` a login, guest, or resume response carries. The
   * partition may not be open yet (login opens it next), so the grant waits
   * until the store for this principal is writable. Returns its input.
   */
  noteGrant<T>(value: T): T {
    const grant = decodeGrant(value);
    if (grant) this.pendingGrant = grant;
    return value;
  }

  async adoptPendingGrant(): Promise<void> {
    await this.serial(() => this.flushGrant());
  }

  async queuedIntents(): Promise<OutboxEntry[]> {
    if (this.partition === undefined) return [];
    return this.outbox.queued();
  }

  async seal(): Promise<void> {
    this.outbox.resetTrust();
    if (this.partition === undefined) return;
    await this.serial(async () => {
      this.bytes.forget();
      await this.store.seal();
      this.outbox.notify();
    });
  }

  async wipe(): Promise<void> {
    this.outbox.resetTrust();
    this.closeInbox();
    await this.serial(async () => {
      if (this.partition === undefined) return;
      const partition = this.partition;
      this.coverageRevision += 1;
      this.partition = undefined;
      this.facts = undefined;
      this.superseded = undefined;
      this.held = undefined;
      this.sessionEpoch = undefined;
      this.bytes.bind(undefined);
      await this.store.wipe(partition);
      this.outbox.notify();
    });
  }

  async close(): Promise<void> {
    this.outbox.resetTrust();
    this.closeInbox();
    await this.tail;
    this.outbox.close();
    this.stopInputChanges?.();
    this.inputListeners.clear();
    this.bytes.forget();
    await this.store.close?.();
  }

  manifest(value: Manifest): void {
    const tables = value.tables ?? value.schema?.tables ?? {};
    const retention: Record<string, RetentionPolicy> = {};
    for (const [name, table] of Object.entries(tables)) {
      if (!table || typeof table !== "object") continue;
      const word = (table as { retain?: unknown }).retain;
      if (word === "until-revoked" || word === "delivered-history") retention[name] = word;
    }
    this.retention = retention;
    const cursors: Record<string, string> = {};
    for (const [name, operation] of Object.entries(value.ops ?? {})) {
      const cursor = cursorArgument((operation as { args?: unknown } | undefined)?.args);
      if (cursor !== undefined) cursors[name] = cursor;
    }
    this.cursors = cursors;
    this.drains = Object.fromEntries(Object.entries(value.ops ?? {}).map(([op, entry]) => [op, entry.drain]));
    // A fresh login has no receipt/auth epoch. A parameter-free query (including
    // optional cursor arguments) can earn those facts before a logless resume.
    this.resumeQueries = Object.entries(value.ops ?? {}).flatMap(([op, operation]) => {
      if (operation.kind !== "query" || !object(operation.args)) return [];
      if (!Object.values(operation.args).every((arg) => object(arg) && "Optional" in arg)) return [];
      return [{ op, args: Object.fromEntries(Object.keys(operation.args).map((key) => [key, null])), drain: false }];
    });
    // Manifest tables carry current columns: replace stale schema custody even without a full schema.
    this.schema = (value.schema?.tables ? value.schema : { tables }) as OfflineSchema;
  }

  /**
   * The op's cursor argument as the manifest names it (the server keys the resume tail
   * by that argument's type, never its name); `c`, the recipe's spelling, until the
   * manifest is loaded.
   */
  declaredCursorArg(op: string): string | undefined {
    const ir = this.held?.programs[op]?.ir;
    const contract = this.held?.programs[op]?.drain ?? this.drains[op];
    if (contract && "cursor" in contract) return contract.cursor;
    return this.cursors[op] ?? cursorArgument(object(ir) ? ir.args : undefined);
  }
  cursorArg(op: string): string { return this.declaredCursorArg(op) ?? "c"; }

  /**
   * Records `/api/program`: the schema, the certified program held for the twin
   * keyed by its generation, and each op's write bound — persisted together
   * with the outbox so a cold start with the owner cut evaluates and prices its
   * slices from the certificate, never from a guess (LLP 1012 §7, §8).
   */
  async program(value: unknown, signal?: AbortSignal): Promise<void> {
    throwIfAborted(signal);
    if (!object(value) || !object(value.programs)) return;
    const bounds: Record<string, number> = {};
    for (const [name, program] of Object.entries(value.programs)) {
      const bound = certificateMaxNewIds(program);
      if (bound !== undefined) bounds[name] = bound;
    }
    const held = decodeHeldProgram(value);
    // Always acquire the runtime queue before the ledger, as open() does when
    // adopting a login grant. Cancellation is checked at each queue boundary.
    await this.serial(() => {
      throwIfAborted(signal);
      return this.outbox.write(async () => {
        throwIfAborted(signal);
        // Custody must succeed before a reset can erase the predecessor coverage.
        if (this.partition !== undefined) {
          const swap = { bounds, ...(held ? { programs: { [held.generation]: held } } : {}) };
          try { await this.store.commit(swap); }
          catch (error) { if (!(ClockCoverageReset.is(error))) throw error; await this.resetClock(error, swap); }
          throwIfAborted(signal);
        } else {
          this.pendingBounds = bounds;
          this.pendingProgram = held;
        }
        if (held) this.restoreProgram(held);
        this.outbox.notify();
      });
    });
  }

  async accept<Result>(op: string, args: unknown, raw: unknown, revalidate?: () => Promise<unknown>): Promise<AcceptedDelivery<Result>> {
    const full = revalidate && (async () => {
      let raw: unknown;
      try { raw = await revalidate(); }
      catch (error) {
        if (isSnapbackRefusal(error) && error.retryable && (error.code === 'E_NETWORK' || error.code === 'E_TRANSPORT'))
          throw new FullRevalidationRequired(op, args);
        throw error;
      }
      const accepted = await this.accept<Result>(op, args, raw);
      if (!accepted.envelope) throw new DeliveryEnvelopeDecodeError('$', 'full revalidation requires a delivery envelope');
      return accepted;
    });
    if (object(raw) && raw.state === "unchanged") {
      if (Object.keys(raw).sort().join(",") !== "seq,state,validator"
        || !Number.isSafeInteger(raw.seq) || Number(raw.seq) < 0
        || typeof raw.validator !== "string" || !/^[0-9a-f]{64}$/.test(raw.validator)) {
        throw new DeliveryEnvelopeDecodeError("$", "conditional delivery must be { state, seq, validator }");
      }
      const held = await this.answer<Result>(op, args);
      if (!held || held.validator !== raw.validator) {
        throw new DeliveryEnvelopeDecodeError("$.validator", "does not match the held answer");
      }
      if (held.needsFactProofs) { if (full) return full(); throw new FullRevalidationRequired(op, args); }
      const result = {
        state: held.state,
        ...(held.state === 'denied' || held.data === undefined ? {} : { data: held.data }),
        ...((held.state === 'complete' || held.state === 'capped') && held.next !== undefined ? { next: held.next } : {}),
        seq: raw.seq as number,
        ...(held.reason === undefined ? {} : { reason: held.reason }),
        ...(held.rule === undefined ? {} : { rule: held.rule }),
      } as AcceptedDelivery<Result>["result"];
      return {
        result: carryItemInputs(held, result),
        refresh: { op, args, seq: raw.seq as number, validator: raw.validator, deliveredAt: Date.now() },
        ...(full ? { revalidate: full } : {}),
      };
    }
    if (!object(raw) || raw.protocol === undefined) {
      return { result: raw as AcceptedDelivery<Result>["result"] };
    }
    const envelope = decodeDeliveryEnvelope(raw);
    const result: AcceptedDelivery<Result>["result"] = {
      state: envelope.state,
      ...(envelope.state === "denied" ? {} : { data: await this.expandUnviewed(envelope) as Result }),
      ...(envelope.state === "complete" || envelope.state === "capped" ? { next: envelope.next } : {}),
      seq: envelope.seq,
      ...(envelope.reason === undefined ? {} : { reason: envelope.reason }),
      ...(envelope.rule === undefined ? {} : { rule: envelope.rule }),
    };
    return { result, envelope };
  }

  async commit(op: string, args: unknown, accepted: AcceptedDelivery<unknown>, revision = this.coverageRevision, current?: () => boolean): Promise<boolean> {
    return this.commitMany([{ op, args, accepted }], undefined, undefined, revision, current);
  }

  async commitMany(
    items: Array<{ op: string; args: unknown; accepted: AcceptedDelivery<unknown> }>,
    watermark?: Omit<WatermarkRecord, "generation" | "schemaHash" | "authEpoch" | "updatedAt">,
    outbox?: { put?: OutboxEntry[]; remove?: string[] },
    revision?: number,
    current?: () => boolean,
    resumeSeq?: number,
  ): Promise<boolean> {
    if (items.length === 0 && !watermark && !outbox && resumeSeq === undefined) return false;
    // An outbox write shares the ledger's tail (one critical section for every
    // enqueue, adoption, bound, settlement, and prediction drop), acquired
    // inside the runtime queue just like program and grant adoption.
    const run = async () => {
      if ((current && !current()) || (revision !== undefined && revision !== this.coverageRevision)) return false;
      if (this.partition === undefined) {
        // A follower tab's live deliveries are shown, not held: the writer tab owns the partition.
        if (this.followingPrincipal !== undefined) return false;
        throw new OfflineAuthorityError("an offline partition must be opened before committing a delivery");
      }
      const deliveries: StoreDelivery[] = [];
      const refreshes: StoreRefresh[] = [];
      const tombstones: StoreTombstone[] = [];
      let nextFacts = this.facts;
      let superseded = this.superseded;
      let sawSupersession = false;
      for (const { op, args, accepted } of items) {
        const envelope = accepted.envelope;
        if (envelope && envelope.authority.principal !== this.partition) {
          throw new OfflineAuthorityError(
            `delivery principal ${envelope.authority.principal} does not match open partition ${this.partition}`,
          );
        }
        if (accepted.refresh) {
          refreshes.push(accepted.refresh);
          continue;
        }
        if (envelope) {
          // The first authenticated delivery establishes session authority. A
          // program reset keeps that epoch: the owner's 409 checked it before
          // checking generation. A successor envelope cannot choose a new epoch.
          if (this.sessionEpoch !== undefined && envelope.authority.authEpoch !== this.sessionEpoch) {
            throw new OfflineAuthorityError("delivery auth epoch does not match the authenticated session");
          }
          if (!nextFacts && this.held) nextFacts = {
            generation: this.held.generation, schemaHash: this.held.schemaHash,
            authEpoch: this.sessionEpoch ?? envelope.authority.authEpoch,
          };
          // @ref LLP 1012#8-the-delivery-envelope-the-validator-and-resume — a
          // rotation: the server now runs another generation or schema. The
          // delivery is not held (one generation per partition), the caller
          // still gets the live answer, and the held coverage is marked
          // superseded so the twin serves nothing stale-exact from it; the next
          // resume carries the old facts, is refused `E_OFFLINE_RESET`, and the
          // reset path drops the coverage and re-fetches the program.
          if (nextFacts && (envelope.generation !== nextFacts.generation || envelope.schemaHash !== nextFacts.schemaHash)) {
            superseded = { generation: envelope.generation, schemaHash: envelope.schemaHash, authEpoch: envelope.authority.authEpoch };
            sawSupersession = true;
            continue;
          }
          // Another auth epoch under the same program is a local authority
          // violation: refused, and the coverage kept (LLP 1012 §15).
          if (nextFacts && envelope.authority.authEpoch !== nextFacts.authEpoch) {
            throw new OfflineAuthorityError("delivery auth epoch does not match the open coverage");
          }
          nextFacts = {
            generation: envelope.generation,
            schemaHash: envelope.schemaHash,
            authEpoch: envelope.authority.authEpoch,
          };
        }
        const source = envelope ?? accepted.result;
        // @ref LLP 1001#51-connected — changing live counts can share a durable seq;
        // they establish authority facts but never enter the durable answer cache.
        if (envelope?.connected || readsConnected(this.held?.programs[op])) continue;
        const operation = this.held?.programs[op];
        const checked = envelope && operation && this.held?.schemaHash === envelope.schemaHash;
        let prepared: ReturnType<typeof prepareClosureReceipt> | undefined;
        if (checked) {
          if (operation.planHash !== envelope.planHash) throw new TypeError('delivery operation identity mismatch');
          if (queryClock(operation) !== (envelope.readTime !== undefined)) throw new TypeError('delivery query clock identity mismatch');
          prepared = prepareClosureReceipt(envelope, this.held!.schema, operation.ir);
        }
        deliveries.push({
          ...(prepared ? { [preparedDeliveryRows]: prepared.rows as unknown as StoreDelivery['rows'], [preparedDeliveryRanges]: prepared[preparedDeliveryRanges] } : {}),
          cursorArg: this.cursorArg(op),
          op,
          args,
          state: source.state,
          ...(source.data === undefined ? {} : { data: source.data }),
          ...(source.next === undefined ? {} : { next: source.next }),
          seq: source.seq,
          ...(envelope?.readTime === undefined ? {} : { readTime: envelope.readTime, clockPlanHash: envelope.planHash }),
          ...(envelope?.validator === undefined ? {} : { validator: envelope.validator }),
          // Structural admission retains authoritative bodies/leases; only checked issuing IR grants receipt coverage.
          ...(envelope ? { rows: envelope.rows, receiptEvidence: envelope.receipt } : {}), ...(checked ? { receipt: envelope!.receipt } : {}),
          ...("reason" in source && typeof source.reason === "string" ? { reason: source.reason } : {}),
          ...("rule" in source && typeof source.rule === "string" ? { rule: source.rule } : {}),
          deliveredAt: Date.now(),
        });
        // @ref LLP 1018.003#3-tombstones-are-declared-certified-and-shared — rule 3 fires on the
        // rows the held program's schema declares; no application callback decides eviction.
        for (const row of envelope?.rows ?? [])
          for (const ref of tombstonesFor(this.held?.schema, row)) tombstones.push({ ...ref, seq: envelope!.seq });
      }
      // A settlement may only persist beside a tail actually admitted under
      // this coverage. A successor tail leaves the intent queued for replay.
      const settlement = sawSupersession ? undefined : outbox;
      const watermarkRecord = !sawSupersession && watermark ? {
        ...watermark,
        cursorArg: this.cursorArg(watermark.op),
        ...(nextFacts?.generation === undefined ? {} : { generation: nextFacts.generation }),
        ...(nextFacts?.schemaHash === undefined ? {} : { schemaHash: nextFacts.schemaHash }),
        ...(nextFacts?.authEpoch === undefined ? {} : { authEpoch: nextFacts.authEpoch }),
        updatedAt: Date.now(),
      } : undefined;
      await this.store.commit({
        deliveries,
        refreshes,
        tombstones,
        retention: this.retention,
        schema: this.schema,
        ...(watermarkRecord ? { watermark: watermarkRecord } : {}),
        ...(settlement ? { outbox: settlement } : {}),
        // A resume counts toward overlay retirement only under the coverage it
        // resumed; a successor tail persists nothing but its pending marker.
        ...(resumeSeq === undefined || sawSupersession ? {} : { resumeSeq }),
        ...(nextFacts && nextFacts !== this.facts ? { facts: nextFacts } : {}),
        ...(superseded && superseded !== this.superseded ? { superseded } : {}),
      });
      this.facts = nextFacts;
      this.sessionEpoch ??= nextFacts?.authEpoch;
      this.superseded = superseded;
      for (const item of [...deliveries, ...refreshes]) this.latestSeq = Math.max(this.latestSeq, item.seq);
      // A delivery or unchanged resume can clear a committed entry's predicted flag.
      this.outbox.notify();
      return sawSupersession;
    };
    const attempt = () => this.serial(() => outbox ? this.outbox.write(run) : run());
    for (;;) try { return await attempt(); }
    catch (error) {
      if (ClockCoverageReset.is(error)) return this.serial(async () => {
        if ((current && !current()) || (revision !== undefined && revision !== this.coverageRevision)) return false;
        const envelope = items.find(i => i.accepted.envelope)?.accepted.envelope;
        await this.resetClock(error, { facts: this.facts ?? (envelope && { generation: envelope.generation, schemaHash: envelope.schemaHash, authEpoch: envelope.authority.authEpoch }) }); return true;
      });
      if (!(FullRevalidationRequired.is(error))) throw error;
      // No I/O inside a carrier transaction or runtime queue. The same request
      // acquires proofs once per affected answer, including a multi-query resume.
      const item = items.find(i => canonicalAnswerKey(i.op, i.args) === canonicalAnswerKey(error.op, error.args));
      if (!item?.accepted.revalidate) throw error;
      const revalidate = item.accepted.revalidate; delete item.accepted.revalidate;
      const full = await revalidate(); delete item.accepted.refresh;
      Object.assign(item.accepted, full);
    }
  }

  async answer<Result>(op: string, args: unknown): Promise<HeldAnswer<Result> | undefined> {
    if (readsConnected(this.held?.programs[op])) return undefined;
    // Superseded coverage answers nothing: not served offline, and its validators
    // are never sent, so a conditional `unchanged` cannot carry a stale answer forward.
    if (!this.coverageCurrent()) return undefined;
    const revision = this.coverageRevision;
    const answer = await this.store.answer<Result>(op, args);
    return revision === this.coverageRevision && this.coverageCurrent() ? answer : undefined;
  }

  private coverageCurrent(): boolean {
    return this.partition !== undefined && this.superseded === undefined
      && (!this.facts || !this.held || (this.facts.generation === this.held.generation
        && this.facts.schemaHash === this.held.schemaHash));
  }

  /** The envelope's data with every viewed view-once row read as `null`, on the wire as in the store. */
  private async expandUnviewed(envelope: DeliveryEnvelopeV1): Promise<unknown> {
    const expanded = expandRows(envelope);
    const store = this.store as Partial<{ viewedRows(): Promise<RowRef[]> }>;
    if (this.partition === undefined || typeof store.viewedRows !== "function") return expanded;
    const viewed = new Set((await store.viewedRows()).map(rowKey));
    return viewed.size === 0 ? expanded : nullViewed(envelope.data, expanded, viewed);
  }

  async markWatermark(op: string, args: unknown, watermark: string | null, validator?: string, revision = this.coverageRevision): Promise<void> {
    if (this.partition === undefined) return;
    await this.commitMany([], { op, args, watermark, ...(validator === undefined ? {} : { validator }) }, undefined, revision);
  }

  /** Offline admission uses the held generation; current metadata never certifies stale coverage. */
  drainCursor(op: string): string {
    return admitDrain(op, this.held ? this.held.programs[op]?.drain : this.drains[op]);
  }

  /** A known unsupported old watermark stays refused, but need not block independently permitted write settlement. */
  unsupportedLog(op: string): boolean {
    const contract = this.held?.programs[op]?.drain ?? this.drains[op];
    return contract !== undefined && "reason" in contract;
  }

  async resumeRequest(mounted: MountedQuery[], adjustment: ResumeAdjustment = {}): Promise<ResumeRequestV1 | undefined> {
    if (this.partition === undefined) return undefined;
    if (this.facts && !this.coverageCurrent()) return { protocol: 1, ...this.facts, mounted: [] };
    const coverage = await this.store.coverage();
    const watermark = tailWatermark(coverage.watermarks);
    // Persisted logs go to the owner even if legacy metadata is missing. Fresh
    // drains must first have the owner's returned-page eligibility descriptor.
    for (const query of mounted) if (query.drain && query.op !== watermark?.op) this.drainCursor(query.op);
    if (!this.facts) return undefined;
    const cap = Math.max(0, Math.min(32, Number.isSafeInteger(adjustment.cap) ? adjustment.cap! : 32));
    const candidates = mounted.filter(query => !query.drain);
    const answers = (await Promise.all(candidates.slice(0, cap).map(async query => ({
      query, answer: await this.answer(query.op, query.args),
    })))).filter((item): item is { query: MountedQuery; answer: HeldAnswer & { validator: string } } =>
      typeof item.answer?.validator === "string");
    if (!this.facts) return undefined;
    if (!this.coverageCurrent()) return { protocol: 1, ...this.facts, mounted: [] };
    if (!watermark && answers.length === 0 && (await this.queuedIntents()).length === 0) return undefined;
    return { protocol: 1, ...this.facts,
      ...(watermark ? { log: { op: watermark.op, args: watermark.args, watermark: watermark.watermark,
        ...(watermark.validator === undefined ? {} : { validator: watermark.validator }) } } : {}),
      mounted: answers.map(({ query, answer }) => ({ op: query.op, args: query.args, validator: answer.validator })),
    };
  }

  async resetCoverage(authEpoch?: number, signal?: AbortSignal): Promise<void> {
    // The fence's trust anchor belongs to the coverage being replaced.
    this.outbox.resetTrust();
    if (this.partition !== undefined) await this.serial(async () => {
      throwIfAborted(signal);
      const epoch = authEpoch ?? this.sessionEpoch ?? this.facts?.authEpoch;
      const facts = this.held && epoch !== undefined ? {
        generation: this.held.generation, schemaHash: this.held.schemaHash, authEpoch: epoch,
      } : undefined;
      // Keep a durable pending marker through the entire rebuild, including a
      // crash after program adoption. Facts let a cold restart authenticate its
      // resume even before any fresh query has committed.
      const superseded = facts ?? this.superseded ?? this.facts;
      await this.store.commit({ resetCoverage: true, facts, superseded });
      this.coverageRevision += 1;
      this.facts = facts;
      this.sessionEpoch = epoch;
      this.superseded = superseded;
    });
  }

  /** Clear only the rebuild we completed, never a successor discovered during it. */
  async completeReset(revision: number, signal?: AbortSignal): Promise<boolean> {
    return this.serial(async () => {
      throwIfAborted(signal);
      if (revision !== this.coverageRevision) return false;
      if (!this.superseded) return true;
      if (!this.facts || !this.held || this.facts.generation !== this.held.generation
        || this.facts.schemaHash !== this.held.schemaHash
        || this.superseded.generation !== this.held.generation
        || this.superseded.schemaHash !== this.held.schemaHash) return false;
      await this.store.commit({ superseded: null });
      this.superseded = undefined;
      return true;
    });
  }

  async coverage(): Promise<Coverage | undefined> {
    return this.partition === undefined ? undefined : this.store.coverage();
  }

  /** A real query earns the authority facts; metadata alone never renews trust. */
  async resumeSeed(mounted: MountedQuery[]): Promise<MountedQuery | undefined> {
    if (this.partition === undefined) return undefined;
    const coverage = await this.store.coverage();
    const held = tailWatermark(coverage.watermarks);
    // Prefer the mounted drain, then the recorded log, then the first manifest
    // query with a Cursor and known arguments, then the first all-optional query.
    // An ordinary mounted query must not displace the app's chosen delivery log.
    const log = mounted.find((query) => query.drain);
    if (log) return log;
    if (held) return { op: held.op, args: held.args, drain: true };
    for (const op of Object.keys(this.cursors)) {
      const query = mounted.find((query) => query.op === op) ?? this.resumeQueries.find((query) => query.op === op);
      if (query) return query;
    }
    return this.resumeQueries[0] ?? mounted[0];
  }

  private async flushGrant(): Promise<void> {
    const grant = this.pendingGrant;
    if (!grant || this.partition === undefined) return;
    this.pendingGrant = undefined;
    try {
      await this.outbox.adopt(grant);
    } catch (error) {
      this.pendingGrant = grant;
      throw error;
    }
  }

  private async flushBounds(): Promise<void> {
    const bounds = this.pendingBounds;
    if (!bounds || this.partition === undefined) return;
    const program = this.pendingProgram;
    this.pendingBounds = undefined;
    this.pendingProgram = undefined;
    try {
      // One generation is held at a time: the program replaces its predecessor whole.
      await this.outbox.recordBounds(bounds, program === undefined ? undefined : { [program.generation]: program });
      if (program) this.restoreProgram(program);
    } catch (error) {
      if (ClockCoverageReset.is(error)) {
        await this.outbox.write(() => this.resetClock(error, { bounds, ...(program ? { programs: { [program.generation]: program } } : {}) }));
        if (program) this.restoreProgram(program);
        return;
      }
      this.pendingBounds = bounds;
      this.pendingProgram = program;
      throw error;
    }
  }

  private async loadProgram(): Promise<void> {
    let programs: Record<string, HeldProgram>;
    // Custody like the outbox: sealed with it, read again on unseal.
    try { programs = await this.store.outbox.programs(); } catch { return; }
    const held = Object.values(programs)[0];
    if (held) {
      this.restoreProgram(held);
      if (this.held) try { await this.store.commit({ programs: { [held.generation]: this.held } }); }
      catch (error) { if (!(ClockCoverageReset.is(error))) throw error; await this.resetClock(error); }
    }
  }

  private async resetClock(error: ClockCoverageReset, extra: StoreSwap = {}): Promise<void> {
    const held = extra.programs && Object.values(extra.programs)[0] || this.held;
    const epoch = this.sessionEpoch ?? extra.facts?.authEpoch ?? this.facts?.authEpoch;
    const facts = held && epoch !== undefined ? { generation: held.generation, schemaHash: held.schemaHash, authEpoch: epoch } : extra.facts ?? this.facts;
    const identity = JSON.stringify([this.partition, facts]);
    const superseded = facts ?? this.superseded;
    await this.store.commit({ ...extra, resetCoverage: true, facts, superseded,
      ...(error.exhausted ? { factLimitReset: identity } : {}) });
    this.outbox.resetTrust(); this.coverageRevision++;
    this.facts = facts; this.superseded = superseded;
  }

  private restoreProgram(held: HeldProgram): void {
    this.held = decodeHeldProgram(held);
    if (this.held) this.schema = this.held.schema;
    // Cursor names are derived lazily from this custody by cursorArg(), so
    // opening a store never evaluates an unrelated operation's arguments.
  }

  private async loadFacts(): Promise<void> {
    const coverage = await this.store.coverage();
    this.superseded = coverage.superseded;
    if (coverage.facts) {
      this.facts = coverage.facts;
      this.sessionEpoch ??= coverage.facts.authEpoch;
      return;
    }
    const watermark = tailWatermark(coverage.watermarks);
    if (watermark?.generation && watermark.schemaHash && watermark.authEpoch !== undefined) {
      this.facts = {
        generation: watermark.generation,
        schemaHash: watermark.schemaHash,
        authEpoch: watermark.authEpoch,
      };
    }
  }

  private serial<T>(action: () => Promise<T>): Promise<T> {
    const run = this.tail.then(action);
    this.tail = run.then(() => undefined, () => undefined);
    return run;
  }
}

/**
 * The offline view uses the twin's current local answer. For retained history,
 * a complete/capped/held rerun can reconstruct conservatively purged literals;
 * a denied, partial, or unavailable rerun falls back to the readable retained
 * answer. A maintained sibling delivery leaves its named owner partial until
 * that owner delivers again. Held owner facts (`seq`, the drain watermark and
 * `caughtUp`) stay with reconstructed data: the stored answer is the covered
 * case, not a second mechanism (LLP 1012 §6).
 */
export function offlineView<Result>(held: HeldAnswer<Result> | undefined, local?: LocalAnswer): any {
  const exactHeld = held !== undefined && (held.state === "complete" || held.state === "capped");
  // A retained projection may have had all unproven literal fields purged when
  // one referenced row was revoked. Prefer a complete local rerun when the
  // independently held facts can reconstruct the authored result. A denied or
  // partial rerun still falls back to the retained delivery: hidden history is
  // not made less readable by the current rule.
  const reconstructed = local !== undefined
    && (local.state === "complete" || local.state === "capped" || local.state === "held");
  // A sibling query may deliver an engine-maintained target before this named
  // query's source rows. The store marks this owner's prior answer partial;
  // do not let a global-pool rerun upgrade that mixed generation. A later
  // overlay cannot prove that an earlier remote sibling also arrived; only a
  // new delivery for this named query clears the marker.
  const waitingForCoherentOwner = held?.state === "partial" && held.reason === "maintained-coherence";
  // A delivered scalar zero can have no row or negative receipt for a cold
  // evaluator to reconstruct. Keep that exact owner result when the rerun is
  // merely partial and no newer prediction is visible; store invalidation
  // makes the held owner partial before an actual row/revocation change.
  const cachedScalar = held?.state === "complete" && held.data !== undefined
    && (held.data === null || typeof held.data !== "object");
  const cachedAnswerOnly = cachedScalar && local?.state === "partial" && !(local.predicted?.length);
  const useLocal = local !== undefined && !waitingForCoherentOwner && !cachedAnswerOnly
    && (!held?.retained || reconstructed);
  if (!useLocal) {
    if (!held) return { state: "hydrating", live: false, connection: "offline" };
    const {
      op: _op,
      args: _args,
      receipt: _receipt,
      validator: _validator,
      readTime: _readTime, clockPlanHash: _clockPlanHash, needsFactProofs: _needsFactProofs,
      deliveredAt, data, next,
      ...answer
    } = held;
    return carryItemInputs(held, {
      ...answer,
      ...(held.state !== 'denied' && data !== undefined ? { data } : {}),
      ...(exactHeld && next !== undefined ? { next } : {}),
      live: false,
      connection: "offline",
      stale: { since: deliveredAt },
    });
  }
  const { since, ...answer } = local;
  const facts = held === undefined ? {} : {
    seq: held.seq,
    ...(held.caughtUp === undefined ? {} : { caughtUp: held.caughtUp }),
    ...(held.watermark === undefined ? {} : { watermark: held.watermark }),
  };
  return carryItemInputs(local, {
    ...answer,
    ...facts,
    live: false,
    connection: "offline",
    stale: { since: held?.deliveredAt ?? since ?? Date.now() },
  });
}
