import { WRITE_HISTORY_LIMIT } from "./writes.ts";
import { answerIdentity, answerObservation } from "./read-observation.ts";
import type { Client, Mutation, PendingWrite, Read, Write } from "./contract.ts";

/** `saving` has no custody yet; `unknown` means dispatched, outcome unknown.
 * `settling` proves success, not row existence, delivery, or reading. */
export type IntentPhase = "saving" | "queued" | "unknown" | "held" | "settling" | "evicted";
export interface PendingIntent<A = unknown> {
  write: PendingWrite<A>;
  phase: IntentPhase;
  /** Only the terminal success, never a historical mutation result. */
  receipt?: { state: "sent"; id: string; seq: number; replayed: true };
}
/** Intent arguments never become a query row, ordinal, receipt or media handle. */
export type PendingItem<Row, A = unknown> =
  | { kind: "row"; key: string; row: Row }
  | ({ kind: "intent"; key: string } & PendingIntent<A>);
export type MutationArgs<M> = M extends Mutation<infer A, infer _R> ? A : never;
export interface PendingItemsOptions<Row, M extends Mutation<any, any>> {
  writes: readonly M[];
  rows: readonly Row[];
  /** Select this application's resource explicitly; no ID or scope is guessed. */
  scope: (write: PendingWrite<MutationArgs<M>>) => boolean;
  rowKey: (row: Row) => string;
  intentKey: (write: PendingWrite<MutationArgs<M>>) => string;
}
export interface PendingStateOptions<A, Value> {
  scope: (write: PendingWrite<A>) => boolean;
  /** The currently observed value; undefined is allowed for an unavailable row. */
  current: Value;
  /** The authorized read supplying current. Online retirement needs its sequence. */
  read?: Read<unknown>;
  value: (args: A) => Value;
}

// @ref LLP 3000.019#3.3.1 — presentation only; the outbox retains sole custody.
export function pendingItems<Row, M extends Mutation<any, any>>(intents: readonly PendingIntent[], options: PendingItemsOptions<Row, M>): readonly PendingItem<Row, MutationArgs<M>>[] {
  const keys = new Set(options.rows.map(options.rowKey));
  const names = new Set(options.writes.map(op => op.name));
  return [
    ...options.rows.map(row => ({ kind: "row" as const, key: JSON.stringify(["row", options.rowKey(row)]), row })),
    ...intents.filter(intent => intent.phase !== "evicted" && names.has(intent.write.op) && options.scope(intent.write as PendingWrite<MutationArgs<M>>)
      && !keys.has(options.intentKey(intent.write as PendingWrite<MutationArgs<M>>)))
      .map(intent => ({ ...intent, get phase() { return intent.phase; }, kind: "intent" as const, key: JSON.stringify(["intent", intent.write.id]) }) as PendingItem<Row, MutationArgs<M>>),
  ];
}

/** Last matching admitted intent in FIFO order; saving calls do not override
 * an admitted value. Returns its phase alongside the selected presentation. */
export function pendingState<A, R, Value>(intents: readonly PendingIntent[], op: Mutation<A, R>, options: PendingStateOptions<A, Value>): { value: Value; intent: PendingIntent<A> | undefined } {
  let intent: PendingIntent<A> | undefined;
  for (const item of intents) {
    if (item.write.op !== op.name || item.phase === "saving") continue;
    // @ref LLP 3000.019#3.3.1 — an eviction is an ordering barrier, not
    // permission to revive an older value. No payload remains to test scope.
    if (item.phase === "evicted") intent = undefined;
    else if (options.scope(item.write as PendingWrite<A>)) intent = item as PendingIntent<A>;
  }
  return { value: intent ? options.value(intent.write.args) : options.current, intent };
}

export function pendingIntent(write: PendingWrite, saving = false): PendingIntent {
  return { write, phase: saving ? "saving" : write.state === "sent" ? "unknown" : write.state };
}

/** Internal access to the current custody/receipt presentation. A scope token
 * changes synchronously at retirement, before any asynchronous read completes. */
export interface PendingIntentAccess {
  scope(): unknown;
  /** Separate from presentation lifetime: reject reads crossing routine resets. */
  revision?(): unknown;
  retain?(select: (write: PendingWrite) => boolean): () => void;
  read(): Promise<readonly PendingIntent[]>;
}
const access = new WeakMap<Client, PendingIntentAccess>();
export function registerPendingIntents(client: Client, source: PendingIntentAccess): void { access.set(client, source); }
export function pendingIntentAccess(client: Client): PendingIntentAccess {
  return access.get(client) ?? { scope: () => client.viewer(), read: async () => (await client.pendingWrites()).map(write => pendingIntent(write)) };
}
export function guardPendingIntents(client: Client, raw: Client, valid: () => boolean, approve: () => Promise<unknown>): void {
  const source = pendingIntentAccess(raw);
  registerPendingIntents(client, {
    scope: () => valid() ? source.scope() : undefined,
    revision: () => source.revision?.(),
    retain: select => source.retain?.(write => valid() && select(write)) ?? (() => {}),
    async read() {
      const scope = source.scope(), revision = source.revision?.();
      if (!valid() || await approve()) return [];
      const items = await source.read();
      return valid() && scope === source.scope() && revision === source.revision?.() ? items : [];
    },
  });
}

/** Online presentation has no persistence/replay authority. Pending references
 * borrow journal payloads; only terminal copies consume the retention bound.
 * Eviction marks already returned references, never fabricates observation. */
export class OnlineIntentPresentation {
  private entries = new Map<string, { item: PendingIntent; bytes: number }>();
  private pending = new Map<string, PendingWrite>();
  private outstanding = new Set<string>();
  private ordinals = new Map<string, number>();
  // At most one barrier per operation, and only while an older owned entry
  // could otherwise reappear. These writes contain no arguments or receipt.
  private evicted = new Map<string, PendingIntent>();
  private nextOrdinal = 0;
  // Observed/evicted presentations stay retired while custody is outstanding,
  // including failed receipt saves. These markers carry no argument payload.
  private retired = new Set<string>();
  private owners = new Set<(write: PendingWrite) => boolean>();
  private bytes = 0;
  private scope: unknown;
  constructor(private current: () => unknown, private notify: () => void) {}
  private check() {
    const scope = this.current();
    if (scope !== this.scope || scope == null) { this.scope = scope; this.clear(); }
    return scope != null;
  }
  clear() { this.entries.clear(); this.pending.clear(); this.outstanding.clear(); this.ordinals.clear(); this.evicted.clear(); this.retired.clear(); this.nextOrdinal = 0; this.bytes = 0; }
  private owns(write: PendingWrite) {
    return [...this.owners].some(select => { try { return select(write); } catch { return false; } });
  }
  private remove(id: string, evicted = false) {
    const entry = this.entries.get(id);
    if (!entry) return;
    if (evicted) {
      entry.item.phase = "evicted";
      if (this.outstanding.has(id)) this.retired.add(id);
      const { op } = entry.item.write, previous = this.evicted.get(op);
      if (!previous || this.ordinals.get(previous.write.id)! < this.ordinals.get(id)!) {
        this.evicted.set(op, { phase: "evicted", write: { id, op, args: undefined, state: "sent", predicted: [] } });
        if (previous) this.forgetOrdinal(previous.write.id);
      }
    }
    this.bytes -= entry.bytes; this.entries.delete(id);
    this.forgetOrdinal(id);
  }
  private forgetOrdinal(id: string) {
    if (!this.outstanding.has(id) && !this.entries.has(id) && ![...this.evicted.values()].some(item => item.write.id === id)) this.ordinals.delete(id);
  }
  retain = (select: (write: PendingWrite) => boolean) => {
    this.owners.add(select);
    return () => { this.owners.delete(select); this.prune(); };
  };
  private prune() {
    for (const [id, { item }] of this.entries) if (!this.owns(item.write)) this.remove(id);
    for (const [id, write] of this.pending) if (!this.owns(write)) this.pending.delete(id);
    const first = new Map<string, number>();
    for (const write of [...this.pending.values(), ...[...this.entries.values()].map(entry => entry.item.write)]) {
      first.set(write.op, Math.min(first.get(write.op) ?? Infinity, this.ordinals.get(write.id)!));
    }
    for (const [op, item] of this.evicted) if ((first.get(op) ?? Infinity) >= this.ordinals.get(item.write.id)!) {
      this.evicted.delete(op); this.forgetOrdinal(item.write.id);
    }
  }
  admit(id: string) {
    if (!this.check()) return;
    this.outstanding.add(id);
    if (!this.ordinals.has(id)) this.ordinals.set(id, this.nextOrdinal++);
  }
  settled(write: Write, entry = this.pending.get(write.id)) {
    if (!this.check()) return;
    if (write.state === "failed") this.remove(write.id);
    else if (write.state === "sent" && !this.retired.has(write.id) && !this.entries.has(write.id) && entry && this.owns(entry)) {
      if (!this.ordinals.has(write.id)) this.ordinals.set(write.id, this.nextOrdinal++);
      const json = JSON.stringify(entry), bytes = new TextEncoder().encode(json).length;
      // Copy once, only at receipt transition. Backlogs never evict a success.
      if (bytes <= 1024 * 1024) {
        const freeze = (value: any): any => { if (value && typeof value === "object") { Object.values(value).forEach(freeze); Object.freeze(value); } return value; };
        const item: PendingIntent = { write: freeze(JSON.parse(json)), phase: "settling",
          receipt: Object.freeze({ state: "sent", id: write.id, seq: write.seq, replayed: true }) };
        this.entries.set(write.id, { item, bytes }); this.bytes += bytes;
        while (this.entries.size > WRITE_HISTORY_LIMIT || this.bytes > 1024 * 1024) this.remove(this.entries.keys().next().value!, true);
      }
    }
    if (write.state !== "pending") this.pending.delete(write.id);
  }
  // @ref LLP 3000.019#3.3.1 — one admission ordinal survives the receipt
  // transition; peer settlement cannot move newer intent ahead of older custody.
  sync(pending: readonly PendingWrite[], receipts: readonly Write[] = []): readonly PendingIntent[] {
    if (!this.check()) return [];
    const outstanding = this.outstanding = new Set(pending.map(write => write.id));
    for (const write of pending) {
      if (!this.ordinals.has(write.id)) this.ordinals.set(write.id, this.nextOrdinal++);
      if (!this.retired.has(write.id) && !this.entries.has(write.id) && this.owns(write)) this.pending.set(write.id, write);
    }
    // Previous journal references remain available until peer receipts consume
    // them. They are never copied just to keep a still-pending row around.
    for (const receipt of receipts) this.settled(receipt);
    for (const id of this.pending.keys()) if (!outstanding.has(id)) this.pending.delete(id);
    for (const id of this.retired) if (!outstanding.has(id)) this.retired.delete(id);
    this.prune();
    for (const id of this.ordinals.keys()) this.forgetOrdinal(id);
    const terminal = new Set(receipts.filter(write => write.state !== "pending").map(write => write.id));
    return [...this.entries.values()].map(entry => entry.item)
      .concat([...this.evicted.values()])
      .concat(pending.filter(write => !this.entries.has(write.id) && !terminal.has(write.id) && !this.retired.has(write.id)).map(write => pendingIntent(write)))
      .sort((a, b) => this.ordinals.get(a.write.id)! - this.ordinals.get(b.write.id)!);
  }
  release(id: string) {
    this.outstanding.delete(id); this.pending.delete(id); this.retired.delete(id);
    this.forgetOrdinal(id);
  }
  items(): readonly PendingIntent[] {
    if (!this.check()) return [];
    this.prune();
    return [...this.entries.values()].map(entry => entry.item);
  }
  observed(ids: readonly string[]) {
    if (!this.check()) return;
    let changed = false;
    for (const id of ids) if (this.entries.has(id)) { changed = true; if (this.outstanding.has(id)) this.retired.add(id); this.remove(id); this.pending.delete(id); }
    if (changed) this.notify();
  }
}

// Read evidence follows the existing answer identity through freshness/facade
// copies. It is private, scoped to this client lifetime and checked at use time.
const reads = new WeakMap<object, { scope: unknown; seq: number; current(): boolean }>();
export function offerIntentRead(read: Read<unknown>, scope: unknown, seq: number, current: () => boolean) {
  if (!("data" in read) || read.revalidating || !read.fresh) return;
  const identity = answerIdentity(read), owner = answerObservation(read);
  reads.set(identity, { scope, seq, current: () => current() && (!owner || answerIdentity(owner.read(null)) === identity) });
}
export function intentReadSequence(client: Client, read?: Read<unknown>): number | undefined {
  if (!read || !("data" in read) || read.revalidating || !read.fresh) return;
  const evidence = reads.get(answerIdentity(read));
  return evidence && evidence.scope === pendingIntentAccess(client).scope() && evidence.current() ? evidence.seq : undefined;
}
const observers = new WeakMap<Client, (ids: readonly string[]) => void>();
export function registerIntentObserver(client: Client, observed: (ids: readonly string[]) => void) { observers.set(client, observed); }
export function forwardIntentObserver(client: Client, raw: Client, valid: () => boolean) { registerIntentObserver(client, ids => { if (valid()) observers.get(raw)?.(ids); }); }
export function observeIntents(client: Client, ids: readonly string[]) { observers.get(client)?.(ids); }
