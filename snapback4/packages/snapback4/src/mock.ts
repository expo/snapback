import { readyRead } from "./read-existence.ts";
import { settledQuery, terminalQueryRefusal } from "./query-settlement.ts";
import { routeMutations } from "./ephemeral.ts";
import { mockSignals } from "./mock-ephemeral.ts";
// MOCK — labelled as LLP 2000 §4 requires. No server, no store, no
// interpreter, no transport: operations are plain functions over in-memory
// tables, commits settle after a virtual delay, and the link is a switch the
// app flips. Its only job is to let the reference application be written
// against the card before the mechanism exists. Nothing here is measured.

import { ServerClock } from "./clock.ts";
import type { Act, Client, Cursor, Link, Mutation, Observed, Principal, Query, Read, Refusal, Write } from "./contract.ts";
import { mutationWaitSeconds, MutationIds, WriteHistory } from "./writes.ts";
import { pendingChanges } from "./pending-writes.ts";
import type { PendingWrite } from "./contract.ts";

export type Row = Record<string, unknown> & { id: string; pending?: boolean };
export type Tables = Record<string, Map<string, Row>>;

/** A query function may return a page: rows plus the cursor of the next page. */
export type Page<R> = { readonly page: true; readonly data: R; readonly next: Cursor | null };
export function page<R>(data: R, next: Cursor | null): Page<R> {
  return { page: true, data, next };
}
function isPage(value: unknown): value is Page<unknown> {
  return typeof value === "object" && value !== null && (value as { page?: unknown }).page === true;
}

export interface MockOps {
  /** Ephemeral handlers return their result (or a Refusal); use Map.set to renew a row. */
  readonly signals?: Record<string, (tables: Tables, args: never, viewer: Principal | null, mint: () => string) => unknown>;
  readonly actions?: Record<string, (args: never, viewer: Principal | null, id: string) => unknown>;
  readonly queries: Record<string, (tables: Tables, args: never, viewer: Principal | null) => unknown>;
  /** Returns the ids of rows it created or changed, or a Refusal. */
  readonly mutations: Record<string, (tables: Tables, args: never, viewer: Principal | null, mint: () => string) => readonly string[] | Refusal>;
}

export interface MockClient extends Client {
  readonly tables: Tables;
  setLink(link: Link): void;
  /** Settle every write the fake server has admitted. */
  settle(): Promise<void>;
}

export interface MockOptions {
  readonly viewer: Principal | null;
  /** Per-table life in milliseconds, mirroring the Quarry declarations. */
  readonly ephemeral?: Readonly<Record<string, number>>;
  readonly tables: Tables;
  readonly ops: MockOps;
  readonly link?: Link;
  readonly commitDelayMs?: number;
}

let minted = 0;
/** MOCK id: time-ordered and unique per process; the real client mints 128-bit ids. */
export function mockId(): string {
  minted += 1;
  return `m${Date.now().toString(36)}-${minted.toString(36)}`;
}

export function createMockClient(options: MockOptions): MockClient {
  const actions = new Map<string, Promise<Act>>();
  const tables = options.ephemeral ? { ...options.tables } : options.tables;
  let link: Link = options.link ?? "online";
  let viewer = options.viewer;
  let seq = 0;
  let version = 0;
  let closed = false;
  const unavailable = (): Refusal | undefined => link === "signed-out"
    ? { code: "E_AUTH", family: "auth", message: "sign in to read" }
    : closed ? { code: "E_CLOSED", family: "client", message: "this client is closed" } : undefined;
  let lastServer = Date.now();
  const listeners = new Set<() => void>();
  const linkListeners = new Set<(link: Link) => void>();
  const viewerListeners = new Set<(viewer: Principal | null) => void>();
  const history = new WriteHistory();
  const ids = new MutationIds();
  const pending = new Map<string, PendingWrite>();
  const pendingEvents = pendingChanges();
  const writeListeners = new Set<(write: Exclude<Write, { state: "pending" }>) => void>();
  const emitWrite = <T extends Exclude<Write, { state: "pending" }>>(write: T): T => {
    history.remember(write);
    if (ids.knows(write.id)) ids.finish(write.id);
    pending.delete(write.id); pendingEvents.notify();
    for (const listener of writeListeners) listener(write);
    return write;
  };
  const queue: { id: string; touched: readonly string[]; table: string; resolve: (w: Write) => void }[] = [];
  const delay = options.commitDelayMs ?? 30;
  const bump = () => { version += 1; for (const l of listeners) l(); };
  const isRefusal = (v: unknown): v is Refusal => typeof v === "object" && v !== null && "code" in v && "family" in v;

  const signals = mockSignals(options, tables, () => viewer, () => link, mockId, bump);

  const evaluate = <A, R>(op: Query<A, R>, args: A): Read<R> => {
    signals.sweep();
    if (op.ephemeralReads?.length && link !== "online") return { loading: true };
    const fn = options.ops.queries[op.name];
    if (!fn) return { denied: { code: "E_OP", family: "op", message: `unknown query ${op.name}` } };
    if (link === "signed-out") return { denied: { code: "E_AUTH", family: "auth", message: "sign in to read" } };
    const value = fn(tables, args as never, viewer);
    const fresh = link === "online";
    if (isPage(value)) return fresh ? readyRead({ data: value.data as R, complete: true, cut: null, fresh, next: value.next }, queue.length > 0) : readyRead({ data: value.data as R, complete: true, cut: null, fresh, since: lastServer, next: value.next }, queue.length > 0);
    return fresh ? readyRead({ data: value as R, complete: true, cut: null, fresh }, queue.length > 0) : readyRead({ data: value as R, complete: true, cut: null, fresh, since: lastServer }, queue.length > 0);
  };

  function settleOne(entry: (typeof queue)[number]) {
    seq += 1;
    for (const id of entry.touched) {
      const row = tables[entry.table]?.get(id);
      if (row) delete row.pending;
    }
    lastServer = Date.now();
    const outcome = { state: "sent", id: entry.id, seq, result: entry.touched } as const;
    entry.resolve(outcome);
    emitWrite(outcome);
  }

  const client: MockClient = {
    async residency() { return null; },
    now: new ServerClock().issuedDeviceNow,
    async act(op, args, options_) {
      const id = options_?.id ?? mockId();
      if (link !== "online") return { denied: { code: link === "offline" ? "E_OFFLINE" : "E_AUTH", family: link === "offline" ? "link" : "auth", message: "an action needs an online signed-in client", retryable: link === "offline" }, id };
      const key = `${viewer}:${op.name}:${id}`;
      if (actions.has(key)) return actions.get(key)! as Promise<Act<never>>;
      const handler = options.ops.actions?.[op.name];
      if (!handler) return { denied: { code: "E_ACTION_UNKNOWN", family: "action", message: `unknown action ${op.name}` }, id };
      const outcome = (async (): Promise<Act> => {
        try { return { state: "done", id, result: await handler(args as never, viewer, id) }; }
        catch (error) { return { state: "failed", id, why: { code: "E_ACTION_FAILED", family: "action", message: String(error) } }; }
      })();
      actions.set(key, outcome);
      return outcome as Promise<Act<never>>;
    },
    tables,
    query: settledQuery(async (op, args) => {
      const revision = version;
      const read = evaluate(op, args);
      return () => revision !== version ? undefined : "loading" in read && link === "offline"
        ? { denied: { code: "E_OFFLINE", family: "link", message: "the read needs the server", retryable: true } } : read;
    }, () => terminalQueryRefusal({ scope: null, store: null, closed: closed ? unavailable() : null,
      session: link === "signed-out" ? unavailable() : null, changes: null, partition: null, inherited: null })),
    observe<A, R>(op: Query<A, R>, args: A): Observed<R> {
      let seen = -1;
      let snapshot: Read<R> = { loading: true };
      const subs = new Set<() => void>();
      const listener = () => { for (const s of subs) s(); };
      listeners.add(listener);
      return {
        getSnapshot() {
          if (seen !== version) { seen = version; snapshot = evaluate(op, args); }
          return snapshot;
        },
        subscribe(notify) { subs.add(notify); return () => subs.delete(notify); },
        close() { listeners.delete(listener); subs.clear(); },
      };
    },
    mutate: routeMutations(signals.mutate, async function<A, R>(op: Mutation<A, R>, args: A, mutateOptions?: import("./contract.ts").MutateOptions): Promise<Write<R>> {
      const fn = options.ops.mutations[op.name];
      const id = mutateOptions?.id ?? mockId();
      const submit = async (snapshot: unknown): Promise<Write<R>> => {
        if (!fn) return emitWrite({ state: "failed", id, why: { code: "E_OP", family: "op", message: `unknown mutation ${op.name}` } });
        if (link === "signed-out") return emitWrite({ state: "failed", id, why: { code: "E_AUTH", family: "auth", message: "sign in to write" } });
        const outcome = fn(tables, snapshot as never, viewer, () => id);
        if (isRefusal(outcome)) {
          const failed = { state: "failed", id, why: outcome } as const;
          return emitWrite(failed);
        }
        const table = op.name.split(".")[0] ?? "";
        for (const rowId of outcome) { const row = tables[table]?.get(rowId); if (row) row.pending = true; }
        bump();
        history.remember({ state: "pending", id });
        pending.set(id, { id, op: op.name, args: JSON.parse(JSON.stringify(snapshot)),
          state: link === "offline" ? "queued" : "sent", predicted: outcome.map(id => `${table}/${id}`) });
        pendingEvents.notify();
        if (link === "offline") {
          // Durable admission without a server: the write stays pending until the link returns.
          return await new Promise<Write<R>>((resolve) => {
            queue.push({ id, touched: outcome, table, resolve: () => {} });
            resolve({ state: "pending", id });
          });
        }
        return await new Promise<Write<R>>((resolve) => {
          const entry = { id, touched: outcome, table, resolve: resolve as (w: Write) => void };
          setTimeout(() => { settleOne(entry); bump(); }, delay);
          const wait = mutationWaitSeconds(mutateOptions?.waitSeconds);
          if (wait === 0) resolve({ state: "pending", id });
          else if (wait !== undefined) { const timer = setTimeout(() => resolve({ state: "pending", id }), wait * 1_000);
            const finish = entry.resolve; entry.resolve = write => { clearTimeout(timer); finish(write); }; }
        });
      };
      return mutateOptions?.id === undefined ? submit(args)
        : ids.run(id, op.name, args, () => client.write(id), snapshot => submit(snapshot));
    }),
    async write(id) { const receipt = await history.read(id); return link === "signed-out" ? undefined : receipt; },
    async pendingWrites() { return link === "signed-out" ? [] : JSON.parse(JSON.stringify([...pending.values()])); },
    onPendingWrites: pendingEvents.subscribe,
    acquired: false,
    onAcquired: () => () => {},
    async upload(bytes: Blob | ArrayBuffer | Uint8Array) {
      const size = bytes instanceof Blob ? bytes.size : bytes.byteLength;
      return { ok: true as const, asset: { id: mockId(), type: "image/png", bytes: size, width: 1, height: 1, duration: null } };
    },
    async asset(id: string) {
      return { denied: { code: "E_ASSET_UNKNOWN", family: "asset", message: `the mock holds no bytes for ${id}` } };
    },
    assetSource: (id: string) => ({ uri: `mock://assets/${id}`, headers: {} }),
    link: () => link,
    onLink(notify) { linkListeners.add(notify); return () => linkListeners.delete(notify); },
    viewer: () => viewer,
    onViewer(notify) { viewerListeners.add(notify); return () => viewerListeners.delete(notify); },
    onWrite(notify) { writeListeners.add(notify); return () => writeListeners.delete(notify); },
    session: () => null,
    onSession: () => () => {},
    async refreshSession() { return { ok: false, why: { code: "E_AUTH", family: "auth", message: "sign in with a session to refresh it" } }; },
    async logoutAll() { return { ok: false, why: { code: "E_AUTH", family: "auth", message: "sign in to revoke sessions" } }; },
    async signOut() { client.setLink("signed-out"); await client.close(); },
    async close() { closed = true; pending.clear(); pendingEvents.notify(); pendingEvents.clear(); signals.close(); listeners.clear(); linkListeners.clear(); viewerListeners.clear(); writeListeners.clear(); },
    setLink(next) {
      link = next;
      if (next === "online") for (const [id, entry] of pending) pending.set(id, { ...entry, state: "sent" });
      pendingEvents.notify();
      signals.linkChanged();
      for (const l of linkListeners) l(next);
      const nextViewer = next === "signed-out" ? null : options.viewer;
      if (viewer !== nextViewer) {
        viewer = nextViewer;
        for (const listener of viewerListeners) listener(viewer);
      }
      if (next === "online") void client.settle();
      bump();
    },
    async settle() {
      await new Promise((r) => setTimeout(r, delay));
      while (queue.length > 0) { const entry = queue.shift(); if (entry) settleOne(entry); }
      bump();
    },
  };
  return client;
}
