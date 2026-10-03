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
    ...intents.filter(intent => names.has(intent.write.op) && options.scope(intent.write as PendingWrite<MutationArgs<M>>)
      && !keys.has(options.intentKey(intent.write as PendingWrite<MutationArgs<M>>)))
      .map(intent => ({ ...intent, get phase() { return intent.phase; }, kind: "intent" as const, key: JSON.stringify(["intent", intent.write.id]) }) as PendingItem<Row, MutationArgs<M>>),
  ];
}

/** Last matching admitted intent in FIFO order; saving calls do not override
 * an admitted value. Returns its phase alongside the selected presentation. */
export function pendingState<A, R, Value>(intents: readonly PendingIntent[], op: Mutation<A, R>, options: PendingStateOptions<A, Value>): { value: Value; intent: PendingIntent<A> | undefined } {
  let intent: PendingIntent<A> | undefined;
  for (const item of intents) if (item.write.op === op.name && item.phase !== "saving" && item.phase !== "evicted" && options.scope(item.write as PendingWrite<A>)) intent = item as PendingIntent<A>;
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

/** Online presentation has no persistence/replay authority. Only mounted owners
 * retain payloads; terminal and peer-journal references share the receipt bound.
 * Eviction marks already returned references, never fabricates observation. */
export class OnlineIntentPresentation {
  private entries = new Map<string, { item: PendingIntent; bytes: number }>();
  private owners = new Set<(write: PendingWrite) => boolean>();
  private bytes = 0;
  private scope: unknown;
  constructor(private current: () => unknown, private notify: () => void) {}
  private check() {
    const scope = this.current();
    if (scope !== this.scope || scope == null) { this.scope = scope; this.clear(); }
    return scope != null;
  }
  clear() { this.entries.clear(); this.bytes = 0; }
  private owns(write: PendingWrite) {
    return [...this.owners].some(select => { try { return select(write); } catch { return false; } });
  }
  private remove(id: string, evicted = false) {
    const entry = this.entries.get(id);
    if (!entry) return;
    if (evicted) entry.item.phase = "evicted";
    this.bytes -= entry.bytes; this.entries.delete(id);
  }
  retain = (select: (write: PendingWrite) => boolean) => {
    this.owners.add(select);
    return () => { this.owners.delete(select); this.prune(); };
  };
  private prune() { for (const [id, { item }] of this.entries) if (!this.owns(item.write)) this.remove(id); }
  capture(write: PendingWrite) {
    if (!this.check() || !this.owns(write) || this.entries.has(write.id)) return;
    const json = JSON.stringify(write), bytes = new TextEncoder().encode(json).length;
    // A single oversized argument cannot grow the presentation without bound.
    if (bytes > 1024 * 1024) return;
    const freeze = (value: any): any => { if (value && typeof value === "object") { Object.values(value).forEach(freeze); Object.freeze(value); } return value; };
    const item = pendingIntent(freeze(JSON.parse(json)));
    this.entries.set(write.id, { item, bytes }); this.bytes += bytes;
    while (this.entries.size > WRITE_HISTORY_LIMIT || this.bytes > 1024 * 1024) this.remove(this.entries.keys().next().value!, true);
  }
  settled(write: Write, entry?: PendingWrite) {
    if (!this.check()) return;
    if (write.state === "failed") this.remove(write.id);
    else if (write.state === "sent") {
      if (entry) this.capture(entry);
      const stored = this.entries.get(write.id);
      if (stored) {
        stored.item.phase = "settling";
        stored.item.receipt = Object.freeze({ state: "sent", id: write.id, seq: write.seq, replayed: true });
      }
    }
  }
  items(): readonly PendingIntent[] {
    if (!this.check()) return [];
    this.prune();
    return [...this.entries.values()].map(entry => entry.item).filter(item => item.phase === "settling");
  }
  observed(ids: readonly string[]) {
    if (!this.check()) return;
    let changed = false;
    for (const id of ids) { changed = this.entries.has(id) || changed; this.remove(id); }
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
