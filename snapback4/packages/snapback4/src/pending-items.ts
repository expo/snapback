import type { Client, Mutation, PendingWrite, Write } from "./contract.ts";

/** `saving` has no custody yet; `unknown` means dispatched, outcome unknown.
 * `settling` proves success, not row existence, delivery, or reading. */
export type IntentPhase = "saving" | "queued" | "unknown" | "held" | "settling";
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
      .map(intent => ({ ...intent, kind: "intent" as const, key: JSON.stringify(["intent", intent.write.id]) }) as PendingItem<Row, MutationArgs<M>>),
  ];
}

/** Last matching admitted intent in FIFO order; saving calls do not override
 * an admitted value. Returns its phase alongside the selected presentation. */
export function pendingState<A, R, Value>(intents: readonly PendingIntent[], op: Mutation<A, R>, options: PendingStateOptions<A, Value>): { value: Value; intent: PendingIntent<A> | undefined } {
  let intent: PendingIntent<A> | undefined;
  for (const item of intents) if (item.write.op === op.name && item.phase !== "saving" && options.scope(item.write as PendingWrite<A>)) intent = item as PendingIntent<A>;
  return { value: intent ? options.value(intent.write.args) : options.current, intent };
}

export function pendingIntent(write: PendingWrite, saving = false): PendingIntent {
  return { write, phase: saving ? "saving" : write.state === "sent" ? "unknown" : write.state };
}

/** Internal access to the current custody/receipt presentation. A scope token
 * changes synchronously at retirement, before any asynchronous read completes. */
export interface PendingIntentAccess {
  scope(): unknown;
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
    async read() {
      const scope = source.scope();
      if (!valid() || await approve()) return [];
      const items = await source.read();
      return valid() && scope === source.scope() ? items : [];
    },
  });
}

/** The online tier has no observed-write log. Keep references to its existing
 * submissions through receipt settlement, without changing dispatch/retirement.
 * This session view has no persistence or replay authority. */
export class OnlineIntentPresentation {
  private successes = new Map<string, PendingIntent>();
  private scope: unknown;
  constructor(private current: () => unknown, private notify: () => void) {}
  private check() { const scope = this.current(); if (scope !== this.scope) { this.scope = scope; this.successes.clear(); } return scope != null; }
  settled(write: Write, entry?: PendingWrite) {
    if (!this.check()) return;
    if (write.state === "failed") this.successes.delete(write.id);
    else if (write.state === "sent" && entry) this.successes.set(write.id, { write: entry, phase: "settling", receipt: { state: "sent", id: write.id, seq: write.seq, replayed: true } });
  }
  items(): readonly PendingIntent[] { return this.check() ? JSON.parse(JSON.stringify([...this.successes.values()])) : []; }
  observed(ids: readonly string[]) {
    if (!this.check()) return;
    let changed = false;
    for (const id of ids) changed = this.successes.delete(id) || changed;
    if (changed) this.notify();
  }
}
const observers = new WeakMap<Client, (ids: readonly string[]) => void>();
export function registerIntentObserver(client: Client, observed: (ids: readonly string[]) => void) { observers.set(client, observed); }
export function forwardIntentObserver(client: Client, raw: Client, valid: () => boolean) { registerIntentObserver(client, ids => { if (valid()) observers.get(raw)?.(ids); }); }
export function observeIntents(client: Client, ids: readonly string[]) { observers.get(client)?.(ids); }
