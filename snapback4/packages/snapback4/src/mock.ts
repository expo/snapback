// MOCK — labelled as LLP 2000 §4 requires. No server, no store, no
// interpreter, no transport: operations are plain functions over in-memory
// tables, commits settle after a virtual delay, and the link is a switch the
// app flips. Its only job is to let the reference application be written
// against the card before the mechanism exists. Nothing here is measured.

import type { Client, Cursor, Link, Mutation, Observed, Principal, Query, Read, Refusal, Write } from "./contract.ts";

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
  const tables = options.tables;
  let link: Link = options.link ?? "online";
  let viewer = options.viewer;
  let seq = 0;
  let version = 0;
  let lastServer = Date.now();
  const listeners = new Set<() => void>();
  const linkListeners = new Set<(link: Link) => void>();
  const viewerListeners = new Set<(viewer: Principal | null) => void>();
  const writeListeners = new Set<(write: Exclude<Write, { state: "pending" }>) => void>();
  const emitWrite = <T extends Exclude<Write, { state: "pending" }>>(write: T): T => {
    for (const listener of writeListeners) listener(write);
    return write;
  };
  const queue: { id: string; touched: readonly string[]; table: string; resolve: (w: Write) => void }[] = [];
  const delay = options.commitDelayMs ?? 30;
  const bump = () => { version += 1; for (const l of listeners) l(); };
  const isRefusal = (v: unknown): v is Refusal => typeof v === "object" && v !== null && "code" in v && "family" in v;

  const evaluate = <A, R>(op: Query<A, R>, args: A): Read<R> => {
    const fn = options.ops.queries[op.name];
    if (!fn) return { denied: { code: "E_OP", family: "op", message: `unknown query ${op.name}` } };
    if (link === "signed-out") return { denied: { code: "E_AUTH", family: "auth", message: "sign in to read" } };
    const value = fn(tables, args as never, viewer);
    const fresh = link === "online";
    if (isPage(value)) return fresh ? { data: value.data as R, complete: true, fresh, next: value.next } : { data: value.data as R, complete: true, fresh, since: lastServer, next: value.next };
    return fresh ? { data: value as R, complete: true, fresh } : { data: value as R, complete: true, fresh, since: lastServer };
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
    tables,
    async query(op, args) {
      return evaluate(op, args);
    },
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
    async mutate<A, R>(op: Mutation<A, R>, args: A): Promise<Write<R>> {
      const fn = options.ops.mutations[op.name];
      const id = mockId();
      if (!fn) return emitWrite({ state: "failed", id, why: { code: "E_OP", family: "op", message: `unknown mutation ${op.name}` } });
      if (link === "signed-out") return emitWrite({ state: "failed", id, why: { code: "E_AUTH", family: "auth", message: "sign in to write" } });
      const outcome = fn(tables, args as never, viewer, () => id);
      if (isRefusal(outcome)) {
        const failed = { state: "failed", id, why: outcome } as const;
        return emitWrite(failed);
      }
      const table = op.name.split(".")[0] ?? "";
      for (const rowId of outcome) { const row = tables[table]?.get(rowId); if (row) row.pending = true; }
      bump();
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
      });
    },
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
    async close() { listeners.clear(); linkListeners.clear(); viewerListeners.clear(); writeListeners.clear(); },
    setLink(next) {
      link = next;
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
