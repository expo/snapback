// The local-first tier (LLP 2000.000 §7): a replica of the viewer's
// partitions, a durable outbox of client-minted writes, and the interpreter,
// on the same card as the online tier. Queries run locally and are
// `complete` inside the horizon; `fresh` says the replica has everything the
// server had at the last sync; a predictable mutation renders its rows as
// `pending` before the server confirms them.

import type { Client, Cursor, Link, Mutation, Observed, Principal, Query, Read, Refusal, Write } from "./contract.ts";
import { mintId } from "./client.ts";
import { assetSource, fetchAsset, uploadAsset } from "./assets.ts";
import { Interpreter, Refused, type LocalRead, type ProgramJson } from "./replica/interpreter.ts";
import { Replica, type StreamPage } from "./replica/replica.ts";
import { MemoryStore, openIndexedDb, type Row, type SchemaJson, type Store } from "./replica/store.ts";
import { defaultSessionStore, forgetSession, guest, keepSession, logout, restoreSession, type Session, type SessionStore } from "./auth.ts";

export interface LocalOptions {
  readonly url: string;
  /** A development persona (loopback only): `alice` acts as `dev:alice`. */
  readonly persona?: string;
  /** A session from `guest()`, `login()` or `signup()`; the client keeps it
   * and restores it on the next start, so an app passes it once. */
  readonly session?: Session;
  /** With no session kept for this server, mint a guest (`use identity guests`). */
  readonly guest?: boolean;
  /** Where the session is kept: `localStorage` by default, memory without one. */
  readonly sessionStore?: SessionStore;
  readonly fetch?: typeof fetch;
  /** `"indexeddb"` on the web (the default when available), `"memory"` for
   * tests, or an opener for another store (`openSqlite` from
   * `snapback4/replica` on Expo and Node). */
  readonly store?: "indexeddb" | "memory" | { open(name: string, schema: SchemaJson): Promise<Store> };
  readonly waitSeconds?: number;
}

export type LocalClient = Client & {
  readonly replica: Replica;
  sync(): Promise<void>;
  /** The session this device holds, or null once the server has refused it. */
  session(): Session | null;
  /** End the session on the server and forget it here; the client closes. */
  signOut(): Promise<void>;
};

/** The meta key under which a device keeps the backend it last loaded. */
const BACKEND = "backend";

interface Backend {
  generation: number;
  schema: SchemaJson;
  programs: Record<string, ProgramJson>;
}

interface Watch {
  op: Query<unknown, unknown>;
  args: unknown;
  key: string;
  tables: Set<string>;
  snapshot: Read<unknown>;
  lastServerAt: number;
  subscribers: Set<() => void>;
  running: boolean;
  dirty: boolean;
}

interface Queued {
  id: string;
  op: string;
  args: unknown;
  newIds: string[];
  /** Rows this write predicted, to withdraw on failure: `table/id`. */
  predicted: string[];
}

export async function createLocalClient(options: LocalOptions): Promise<LocalClient> {
  const doFetch = options.fetch ?? globalThis.fetch.bind(globalThis);
  const base = options.url.replace(/\/$/, "");
  const headers: Record<string, string> = { "content-type": "application/json" };
  const sessions = options.sessionStore ?? defaultSessionStore;
  let session: Session | null = null;
  if (options.persona) headers["x-snapback-persona"] = options.persona;
  else {
    // The device's session: the one passed, else the one kept for this
    // server, else a fresh guest when the app allows one.
    if (options.session) {
      session = options.session;
      await keepSession(base, session, sessions);
    } else session = await restoreSession(base, sessions);
    if (!session && options.guest) {
      const signedIn = await guest(base, doFetch);
      if (!signedIn.ok) throw new Error(`createLocalClient: ${signedIn.why.code}: ${signedIn.why.message}`);
      session = signedIn.session;
      await keepSession(base, session, sessions);
    }
    if (!session) throw new Error(`createLocalClient: no session for ${base}; pass one from guest(), login() or signup(), or say guest: true`);
    headers.authorization = `Bearer ${session.token}`;
  }
  const viewer: Principal = (options.persona ? `dev:${options.persona}` : session!.principal) as Principal;
  const principal: string = viewer;
  let sessionDead = false;
  let partitionDenied: Refusal | null = null;
  const refusedSession = async (denied: unknown) => {
    if (session && !sessionDead && (denied as Refusal | undefined)?.code === "E_AUTH") {
      sessionDead = true;
      await forgetSession(base, sessions);
    }
  };

  // The store opens before the network is asked: a device that starts
  // offline runs on the backend it cached last time, on the rows it holds.
  const storeName = `snapback4:${base}:${viewer}`;
  const useIdb = options.store === "indexeddb" || (options.store === undefined && typeof indexedDB !== "undefined");
  const unknown: SchemaJson = { tables: {} };
  const store: Store = typeof options.store === "object" ? await options.store.open(storeName, unknown) : useIdb ? await openIndexedDb(storeName, unknown) : new MemoryStore(unknown);
  const cached = (await store.read((tx) => tx.getMeta(BACKEND))) as Backend | undefined;
  let link: Link = "online";
  let backend: Backend;
  try {
    backend = await loadBackend(doFetch, base, headers);
    await store.write((tx) => tx.setMeta(BACKEND, backend));
  } catch (error) {
    if (!cached) {
      await store.close();
      throw new Error(`createLocalClient: cannot reach ${base} and this device holds no backend yet: ${(error as Error).message}`);
    }
    backend = cached;
    link = "offline";
  }
  store.setSchema(backend.schema);
  let closed = false;
  let seq = 0;
  const aborter = new AbortController();
  const linkListeners = new Set<(link: Link) => void>();
  const watches = new Map<string, Watch>();
  const offline = (): Refusal => ({ code: "E_OFFLINE", family: "link", message: "the server is unreachable", retryable: true });

  const setLink = (next: Link) => {
    if (link === next) return;
    link = next;
    for (const listener of linkListeners) listener(next);
    if (next === "online") void flush();
    for (const watch of watches.values()) void rerun(watch);
  };

  async function post(path: string, body: unknown): Promise<{ ok: true; json: Record<string, unknown> } | { ok: false }> {
    try {
      const response = await doFetch(`${base}${path}`, { method: "POST", headers, body: JSON.stringify(body) });
      if (response.status >= 500) return { ok: false };
      const json = (await response.json()) as Record<string, unknown>;
      if (link !== "online") setLink("online");
      return { ok: true, json };
    } catch {
      setLink("offline");
      return { ok: false };
    }
  }

  const replica = new Replica(store, backend.schema, {
    async sync(from, limit) {
      try {
        const response = await doFetch(`${base}/sync?from=${from}&limit=${limit}`, { headers });
        if (response.status === 503) return { denied: offline() };
        const page = (await response.json()) as StreamPage & { denied?: Refusal };
        if (page.denied) {
          await refusedSession(page.denied);
          if (!page.denied.retryable) {
            // The server refuses this device's partition (a schema the store
            // cannot serve, a dead session): every read says so, once
            // loudly here, and until the next successful sync.
            if (!partitionDenied) console.error(`snapback4: the server refused the partition: ${page.denied.code}: ${page.denied.message}`);
            partitionDenied = page.denied;
            for (const watch of watches.values()) void rerun(watch);
          }
          return { denied: page.denied };
        }
        partitionDenied = null;
        if (link !== "online") setLink("online");
        if (page.watermark > seq) seq = page.watermark;
        if (page.generation !== undefined && page.generation !== backend.generation) {
          // Day two: the server adopted a new generation. Load it, then let
          // the replica re-derive the partition on its next round.
          const next = await loadBackend(doFetch, base, headers);
          backend.generation = next.generation;
          backend.schema = next.schema;
          backend.programs = next.programs;
          store.setSchema(next.schema);
          await store.write((tx) => tx.setMeta(BACKEND, next));
          replica.adopt(next.schema, next.generation);
          return { denied: { code: "E_GENERATION", family: "generation", message: "the backend changed; re-deriving the partition", retryable: true } };
        }
        return page;
      } catch {
        setLink("offline");
        return { denied: offline() };
      }
    },
  }, backend.generation);

  // Every applied batch re-runs the queries whose tables it touched.
  replica.onChange((touched) => {
    for (const watch of watches.values()) if ([...watch.tables].some((t) => touched.has(t))) void rerun(watch);
  });

  async function waitForChange(): Promise<void> {
    if (link !== "online") {
      await new Promise((r) => setTimeout(r, 1000));
      const probe = await post("/q/__probe", {});
      if (probe.ok) setLink("online");
      return;
    }
    try {
      const response = await doFetch(`${base}/changes?since=${seq}&wait=${options.waitSeconds ?? 25}`, { headers, signal: aborter.signal });
      const json = (await response.json()) as { seq: number };
      if (json.seq > seq) seq = json.seq;
    } catch {
      if (closed) return;
      setLink("offline");
      await new Promise((r) => setTimeout(r, 1000));
    }
  }

  async function runLocal<R>(op: Query<unknown, R>, args: unknown): Promise<{ read: Read<R>; tables: Set<string> }> {
    const program = backend.programs[op.name];
    if (!program) return { read: { denied: { code: "E_OP", family: "op", message: `unknown query ${op.name}` } }, tables: new Set() };
    if (partitionDenied) return { read: { denied: partitionDenied }, tables: new Set(Object.keys(backend.schema.tables)) };
    try {
      const outcome: LocalRead = await store.read((tx) => new Interpreter(tx, backend.schema, { viewer: principal, args: args as Record<string, unknown>, now: Date.now(), newIds: [], mint: mintId }, "query").run(program));
      const read: Read<R> = { data: outcome.data as R, complete: outcome.complete, fresh: link === "online" && replica.isCaughtUp, next: outcome.next as Cursor | null, ...(link === "online" && replica.isCaughtUp ? {} : { since: lastSyncAt }) };
      return { read, tables: outcome.tables };
    } catch (error) {
      if (error instanceof Refused) return { read: { denied: error.refusal }, tables: new Set() };
      throw error;
    }
  }

  let lastSyncAt = Date.now();

  function notify(watch: Watch) {
    for (const subscriber of watch.subscribers) subscriber();
  }

  async function rerun(watch: Watch) {
    if (watch.running) { watch.dirty = true; return; }
    watch.running = true;
    try {
      const { read, tables } = await runLocal(watch.op, watch.args);
      if (closed) return;
      watch.tables = tables;
      watch.snapshot = read;
      notify(watch);
    } finally {
      watch.running = false;
      if (watch.dirty) { watch.dirty = false; void rerun(watch); }
    }
  }

  // ----- the outbox -----

  async function queued(): Promise<Queued[]> {
    return store.read(async (tx) => (await tx.side("outbox").all()).map((e) => e.value as Queued).sort((a, b) => (a.id < b.id ? -1 : 1)));
  }

  let flushing = false;
  let flushAgain = false;
  async function flush() {
    // A write queued while a flush runs is flushed by the same flush, on
    // its next pass: nothing waits for the next link change.
    if (flushing) {
      flushAgain = true;
      return;
    }
    flushing = true;
    try {
      do {
        flushAgain = false;
        await flushOnce();
      } while (flushAgain && link === "online" && !closed);
    } finally {
      flushing = false;
    }
  }

  async function flushOnce() {
    {
      for (const entry of await queued()) {
        if (link !== "online") return;
        const result = await post(`/m/${entry.op}`, { id: entry.id, args: entry.args, newIds: entry.newIds });
        if (!result.ok) return;
        const json = result.json;
        await store.write(async (tx) => {
          await tx.side("outbox").delete(entry.id);
          if (json.state !== "sent") {
            // The prediction is withdrawn: the rows it wrote go, the stream
            // restores anything it replaced.
            for (const key of entry.predicted) {
              const [table, id] = key.split("/") as [string, string];
              const row = await tx.get(table, id);
              if (row && row.pending) await tx.delete(table, id);
            }
          }
        });
        if (json.denied) await refusedSession(json.denied);
        settled.get(entry.id)?.(json.state === "sent" ? { state: "sent", id: entry.id, seq: Number(json.seq ?? 0) } : { state: "failed", id: entry.id, why: (json.why as Refusal | undefined) ?? (json.denied as Refusal | undefined) ?? offline() });
        settled.delete(entry.id);
        if (json.state === "sent" && Number(json.seq) > seq) seq = Number(json.seq);
        if (json.state === "sent") await replica.syncOnce();
        else for (const watch of watches.values()) void rerun(watch);
      }
    }
  }

  const settled = new Map<string, (write: Write) => void>();

  const client = {
    replica,
    async sync() {
      await replica.syncOnce();
      lastSyncAt = Date.now();
    },
    async query<A, R>(op: Query<A, R>, args: A): Promise<Read<R>> {
      return (await runLocal(op as Query<unknown, R>, args)).read;
    },
    observe<A, R>(op: Query<A, R>, args: A): Observed<R> {
      const key = `${op.name}:${JSON.stringify(args)}`;
      let watch = watches.get(key);
      if (!watch) {
        watch = { op: op as Query<unknown, unknown>, args, key, tables: new Set(), snapshot: { loading: true }, lastServerAt: 0, subscribers: new Set(), running: false, dirty: false };
        watches.set(key, watch);
        void rerun(watch);
      }
      const own = watch;
      const mine = new Set<() => void>();
      return {
        getSnapshot: () => own.snapshot as Read<R>,
        subscribe(listener) {
          mine.add(listener);
          own.subscribers.add(listener);
          // A screen that closed this key a moment ago (React unmounts the
          // old component before the new one subscribes) may have removed
          // the watch: put it back, and refresh it, so no subscriber is
          // left on a watch nothing updates.
          if (watches.get(own.key) !== own) {
            watches.set(own.key, own);
            void rerun(own);
          }
          return () => { mine.delete(listener); own.subscribers.delete(listener); };
        },
        close() {
          for (const s of mine) own.subscribers.delete(s);
          if (own.subscribers.size === 0) watches.delete(own.key);
        },
      };
    },
    async mutate<A, R>(op: Mutation<A, R>, args: A): Promise<Write> {
      const id = mintId();
      const program = backend.programs[op.name];
      if (!program) return { state: "failed", id, why: { code: "E_OP", family: "op", message: `unknown mutation ${op.name}` } };
      const newIds: string[] = [];
      const mint = () => { const minted = mintId(); newIds.push(minted); return minted; };
      // Predict: run the mutation over the replica; its rows render as pending.
      let predicted: string[] = [];
      let refused: Refusal | null = null;
      try {
        await store.write(async (tx) => {
          const interpreter = new Interpreter(tx, backend.schema, { viewer: principal, args: args as Record<string, unknown>, now: Date.now(), newIds: [], mint }, "mutation");
          await interpreter.run(program);
          predicted = interpreter.writes.map((w) => `${w.table}/${w.row.id}`);
          await tx.side("outbox").put(id, { id, op: op.name, args, newIds: [...newIds], predicted } satisfies Queued);
        });
      } catch (error) {
        if (!(error instanceof Refused)) throw error;
        if (error.refusal.code === "E_PREDICT") {
          // Not predictable here: queue it without local rows.
          await store.write((tx) => tx.side("outbox").put(id, { id, op: op.name, args, newIds: [], predicted: [] } satisfies Queued));
        } else refused = error.refusal;
      }
      if (refused) return { state: "failed", id, why: refused };
      for (const watch of watches.values()) void rerun(watch);
      const outcome = new Promise<Write>((resolve) => settled.set(id, resolve));
      void flush();
      if (link !== "online") return { state: "pending", id };
      const first = await Promise.race([outcome, new Promise<Write>((resolve) => setTimeout(() => resolve({ state: "pending", id }), 4_000))]);
      return first;
    },
    async upload(bytes: Blob | ArrayBuffer | Uint8Array) {
      // An upload is bytes on the server; there is nothing to queue.
      if (link !== "online") return { ok: false as const, why: { code: "E_OFFLINE", family: "link", message: "the server is unreachable; uploads wait for no link", retryable: true } };
      const uploaded = await uploadAsset(base, headers, doFetch, bytes);
      if (!uploaded.ok && uploaded.why.code === "E_OFFLINE") setLink("offline");
      return uploaded;
    },
    asset: (id: string) => fetchAsset(base, headers, doFetch, id),
    assetSource: (id: string) => assetSource(base, headers, id),
    link: () => link,
    onLink(listener: (link: Link) => void) {
      linkListeners.add(listener);
      return () => linkListeners.delete(listener);
    },
    viewer: () => viewer,
    session: () => (sessionDead ? null : session),
    async signOut() {
      if (session && !sessionDead) await logout(base, session.token, doFetch);
      await forgetSession(base, sessions);
      sessionDead = true;
      await client.close();
    },
    async close() {
      closed = true;
      aborter.abort();
      watches.clear();
      linkListeners.clear();
      await replica.close();
    },
  };
  // First: catch up, then re-apply any predictions still in the outbox.
  await client.sync();
  await reapplyPredictions();
  replica.follow(waitForChange);
  void flush();

  async function reapplyPredictions() {
    for (const entry of await queued()) {
      const program = backend.programs[entry.op];
      if (!program || entry.predicted.length === 0) continue;
      try {
        await store.write(async (tx) => {
          const interpreter = new Interpreter(tx, backend.schema, { viewer: principal, args: entry.args as Record<string, unknown>, now: Date.now(), newIds: [...entry.newIds], mint: mintId }, "mutation");
          await interpreter.run(program);
        });
      } catch {
        // The server will judge it; the rows stay absent until then.
      }
    }
  }

  return client;
}

async function loadBackend(doFetch: typeof fetch, base: string, headers: Record<string, string>): Promise<Backend> {
  const response = await doFetch(`${base}/schema`, { headers });
  const json = (await response.json()) as { generation: number; schema: SchemaJson; programs: ProgramJson[] };
  return { generation: json.generation, schema: json.schema, programs: Object.fromEntries(json.programs.map((p) => [p.name, p])) };
}

export type { Row };
