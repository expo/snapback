// The local-first tier (LLP 2000.000 §7): a replica of the viewer's
// partitions, a durable outbox of client-minted writes, and the interpreter,
// on the same card as the online tier. Queries run locally and are
// `complete` inside the horizon; `fresh` says the replica has everything the
// server had at the last sync; a predictable mutation renders its rows as
// `pending` before the server confirms them.

import type { Client, Cursor, Link, Mutation, Observed, Principal, Query, Read, Refusal, Write } from "./contract.ts";
import { createClient, mintId } from "./client.ts";
import { assetSource, fetchAsset, uploadAsset } from "./assets.ts";
import { Interpreter, Refused, type LocalRead, type ProgramJson } from "./replica/interpreter.ts";
import { predict, restoreConfirmed } from "./replica/predictions.ts";
import { operationTables } from "./replica/dependencies.ts";
import { Replica, type StreamPage } from "./replica/replica.ts";
import { MemoryStore, openIndexedDb, type Row, type SchemaJson, type Store, type StoreTx } from "./replica/store.ts";
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
  /** The session this device holds, or null once it ended: after `signOut()`,
   * or once the server refused it. Anything that keeps the token (a native
   * image header, a presence lease) takes it from `onSession`/`useSession`
   * and stops when it is null; a token read after sign-out is null. */
  session(): Session | null;
  /** Told when the session ends (null) — sign-out, or the server's refusal. */
  onSession(notify: (session: Session | null) => void): () => void;
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
  /** The device's submission order: the outbox flushes by it. */
  seq?: number;
  op: string;
  args: unknown;
  newIds: string[];
  /** Rows this write predicted, to withdraw on failure: `table/id`. */
  predicted: string[];
  predictable?: boolean;
  now?: number;
  sentSeq?: number;
  observedSeq?: number;
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
  const sessionListeners = new Set<(session: Session | null) => void>();
  const endSession = async () => {
    sessionDead = true;
    delete headers.authorization;
    delete headers["x-snapback-persona"];
    setLink("signed-out");
    await forgetSession(base, sessions);
    for (const listener of sessionListeners) listener(null);
  };
  const refusedSession = async (denied: unknown) => {
    if (!sessionDead && (denied as Refusal | undefined)?.code === "E_AUTH") await endSession();
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
  let closing: Promise<void> | undefined;
  const active = new Set<Promise<unknown>>();
  function track<T>(work: Promise<T>): Promise<T> {
    active.add(work);
    void work.finally(() => active.delete(work)).catch(() => {});
    return work;
  }
  let changesSeq = 0;
  const online = createClient({ url: base, ...(options.persona ? { persona: options.persona } : {}), ...(session ? { session } : {}), fetch: doFetch });
  const aborter = new AbortController();
  let networkTail: Promise<unknown> = Promise.resolve();
  function network<T>(body: () => Promise<T>): Promise<T> {
    const result = networkTail.then(body);
    networkTail = result.catch(() => {});
    return result;
  }
  const linkListeners = new Set<(link: Link) => void>();
  const watches = new Map<string, Watch>();
  const offline = (): Refusal => ({ code: "E_OFFLINE", family: "link", message: "the server is unreachable", retryable: true });
  const unavailable = (): Refusal | null => closed ? { code: "E_CLOSED", family: "client", message: "this client is closed" } : sessionDead ? { code: "E_AUTH", family: "auth", message: "sign in to continue" } : null;

  const setLink = (next: Link) => {
    if (closed || (sessionDead && next !== "signed-out")) return;
    if (link === next) return;
    link = next;
    for (const listener of linkListeners) listener(next);
    if (next === "online") void flush();
    for (const watch of watches.values()) void rerun(watch);
  };

  async function post(path: string, body: unknown): Promise<{ ok: true; json: Record<string, unknown> } | { ok: false }> {
    if (closed || sessionDead) return { ok: false };
    try {
      const response = await doFetch(`${base}${path}`, { method: "POST", headers, body: JSON.stringify(body), signal: aborter.signal });
      if (response.status >= 500) { setLink("offline"); return { ok: false }; }
      const json = (await response.json()) as Record<string, unknown>;
      if (closed) return { ok: false };
      await refusedSession(json.denied ?? json.why);
      if (link !== "online") setLink("online");
      return { ok: true, json };
    } catch {
      setLink("offline");
      return { ok: false };
    }
  }

  const replica = new Replica(store, backend.schema, {
    async sync(from, limit, after, stream) {
      try {
        if (closed || sessionDead) return { denied: unavailable() };
        const { pending, sendRevision } = await store.read(async (tx) => ({
          pending: (await tx.side("outbox").all()).map((entry) => entry.value as Queued).filter((entry) => entry.sentSeq === undefined).sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0) || a.id.localeCompare(b.id)).slice(0, 256).map((entry) => entry.id),
          sendRevision: Number(await tx.getMeta("outbox:sendRevision") ?? 0),
        }));
        const response = await doFetch(`${base}/sync?from=${from}&limit=${limit}${after ? `&after=${encodeURIComponent(after)}` : ""}${stream ? "&stream=1" : ""}${pending.length ? `&pending=${encodeURIComponent(JSON.stringify(pending))}` : ""}`, { headers, signal: aborter.signal });
        if (response.status >= 500) { setLink("offline"); return { denied: offline() }; }
        const page = (await response.json()) as StreamPage & { denied?: Refusal };
        if (closed) return { denied: unavailable() };
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
        if (page.generation !== undefined && page.generation !== backend.generation) {
          // Day two: the server adopted a new generation. Load it, then let
          // the replica re-derive the partition on its next round.
          const next = await loadBackend(doFetch, base, headers, aborter.signal);
          if (closed) return { denied: unavailable() };
          const previous = backend;
          try {
            await store.write(async (tx) => {
              if (closed) throw new Error("client closed during backend adoption");
              await tx.setMeta(BACKEND, next);
              // Existing operations finish with their own index schema;
              // later transactions see the backend and schema together.
              store.setSchema(next.schema);
              backend = next;
              replica.adopt(next.schema, next.generation);
            });
          } catch (error) {
            store.setSchema(previous.schema);
            backend = previous;
            replica.adopt(previous.schema, previous.generation);
            throw error;
          }
          for (const watch of watches.values()) void rerun(watch);
          return { denied: { code: "E_GENERATION", family: "generation", message: "the backend changed; re-deriving the partition", retryable: true } };
        }
        return { ...page, send_revision: sendRevision };
      } catch {
        setLink("offline");
        return { denied: offline() };
      }
    },
  }, backend.generation);
  // Capture pending IDs and apply all pages before a later admitted write
  // may reach the server. Otherwise its commit can appear without a match.
  replica.coordinate = network;

  // Every applied batch re-runs the queries whose tables it touched.
  replica.onChange((touched) => {
    if (replica.isCaughtUp) lastSyncAt = Date.now();
    for (const watch of watches.values()) if (touched.size === 0 || watch.tables.size === 0 || [...watch.tables].some((t) => touched.has(t))) void rerun(watch);
  });

  async function waitForChange(): Promise<void> {
    if (link !== "online") {
      await new Promise((r) => setTimeout(r, 1000));
      if (!closed && !sessionDead) await post("/q/__probe", {});
      return;
    }
    try {
      const response = await doFetch(`${base}/changes?since=${changesSeq}&wait=${options.waitSeconds ?? 25}`, { headers, signal: aborter.signal });
      if (!response.ok) throw new Error(`changes: HTTP ${response.status}`);
      const json = (await response.json()) as { seq: number; tables?: string[]; generation?: number };
      if (json.seq > changesSeq || (json.generation !== undefined && json.generation !== backend.generation)) {
        changesSeq = Math.max(changesSeq, json.seq);
        const touched = new Set(json.tables ?? []);
        for (const watch of watches.values()) if (watch.tables.size === 0 || [...watch.tables].some((t) => touched.has(t)) || json.generation !== backend.generation) void rerun(watch);
      }
    } catch {
      if (closed) return;
      setLink("offline");
      await new Promise((r) => setTimeout(r, 1000));
    }
  }

  function runLocal<R>(op: Query<unknown, R>, args: unknown) { return track(evaluateLocal(op, args)); }

  async function evaluateLocal<R>(op: Query<unknown, R>, args: unknown): Promise<{ read: Read<R>; tables: Set<string> }> {
    const refused = unavailable();
    if (refused) return { read: { denied: refused }, tables: new Set() };
    const program = backend.programs[op.name];
    const selectedBackend = backend;
    if (!program) return { read: { denied: { code: "E_OP", family: "op", message: `unknown query ${op.name}` } }, tables: new Set() };
    if (partitionDenied) return { read: { denied: partitionDenied }, tables: new Set(Object.keys(backend.schema.tables)) };
    const tables = operationTables(program, backend.schema);
    const server = async () => {
      const read = await online.query(op, args);
      if ("denied" in read) await refusedSession(read.denied);
      setLink(online.link());
      return { read, tables };
    };
    const onlineOnly = [...tables].some((t) => !backend.schema.tables[t]?.sync);
    if (onlineOnly && link === "online") return server();
    let interpreter: Interpreter | undefined;
    try {
      const outcome: LocalRead = await store.read((tx) => {
        if (backend !== selectedBackend) throw new Refused({ code: "E_GENERATION", family: "generation", message: "the backend changed before this read ran", retryable: true });
        interpreter = new Interpreter(tx, backend.schema, { viewer: principal, args: args as Record<string, unknown>, now: Date.now(), newIds: [], mint: mintId }, "query");
        return interpreter.run(program);
      });
      const unavailableWhy = unavailable();
      if (unavailableWhy) return { read: { denied: unavailableWhy }, tables };
      if ((!outcome.complete || interpreter?.hasUnknownReads) && link === "online" && !(await queued()).some((e) => e.observedSeq === undefined && (e.predictable ?? e.predicted.length > 0))) return server();
      const fresh = link === "online" && replica.isCaughtUp;
      const read: Read<R> = { data: outcome.data as R, complete: outcome.complete && !onlineOnly, fresh, next: outcome.next as Cursor | null, ...(fresh || !lastSyncAt ? {} : { since: lastSyncAt }) };
      return { read, tables: new Set([...tables, ...outcome.tables]) };
    } catch (error) {
      for (const table of interpreter?.tables ?? []) tables.add(table);
      if (error instanceof Refused) {
        if (onlineOnly || interpreter?.hasUnknownReads) return link === "online" ? server() : { read: { denied: offline() }, tables };
        return { read: { denied: error.refusal }, tables };
      }
      throw error;
    }
  }

  let lastSyncAt = Number(await store.read((tx) => tx.getMeta("syncedAt")) ?? 0);

  function notify(watch: Watch) {
    for (const subscriber of watch.subscribers) subscriber();
  }

  async function rerun(watch: Watch) {
    if (closed) return;
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

  /** The meta key of the outbox's submission counter. */
  const OUTBOX_SEQ = "outbox:seq";

  /** Every queued write in the order it was submitted on this device. */
  async function queued(): Promise<Queued[]> {
    return store.read(async (tx) => (await tx.side("outbox").all()).map((e) => e.value as Queued).sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0) || (a.id < b.id ? -1 : 1)));
  }

  // The submission counter is taken synchronously as each write is
  // admitted — twenty writes in one burst predict concurrently and would
  // otherwise number themselves in the order their predictions finished —
  // and persisted with the entry, so the order survives a restart.
  let submissions = Number((await store.read((tx) => tx.getMeta(OUTBOX_SEQ))) ?? 0);

  async function enqueue(tx: StoreTx, entry: Queued): Promise<void> {
    await tx.setMeta(OUTBOX_SEQ, submissions);
    await tx.side("outbox").put(entry.id, entry);
  }

  let retry: ReturnType<typeof setTimeout> | undefined;
  let retryMs = 250;
  let flushing: Promise<void> | null = null;
  let flushAgain = false;
  function flush(): Promise<void> {
    // A write queued while a flush runs is flushed by the same flush, on
    // its next pass: nothing waits for the next link change.
    if (flushing) {
      flushAgain = true;
      return flushing;
    }
    if (closed || sessionDead) return Promise.resolve();
    if (retry) { clearTimeout(retry); retry = undefined; }
    const run = (async () => {
      try {
        do {
          flushAgain = false;
          await flushOnce();
        } while (flushAgain && link === "online" && !closed);
      } catch { retryFlush(); }
    })();
    flushing = run;
    void run.finally(() => { if (flushing === run) flushing = null; }).catch(() => {});
    return run;
  }

  function retryFlush() {
    if (closed || sessionDead || retry) return;
    retry = setTimeout(() => { retry = undefined; void flush(); }, retryMs);
    (retry as { unref?: () => void }).unref?.();
    retryMs = Math.min(retryMs * 2, 5000);
  }

  async function rebase(tx: StoreTx, apply: () => Promise<void>, acknowledged: Record<string, number> = {}) {
    await restoreConfirmed(tx, backend.schema);
    await apply();
    const watermark = Number(await tx.getMeta("watermark") ?? 0);
    for (const [id, seq] of Object.entries(acknowledged)) {
      if (!Number.isSafeInteger(seq) || seq < 0 || seq > watermark) continue;
      const entry = await tx.side("outbox").get(id) as Queued | undefined;
      if (entry) await tx.side("outbox").put(id, { ...entry, observedSeq: seq });
    }
    const entries = (await tx.side("outbox").all()).map((e) => e.value as Queued).sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0) || a.id.localeCompare(b.id));
    for (const entry of entries) {
      if (entry.sentSeq !== undefined && entry.sentSeq <= watermark) { await tx.side("outbox").delete(entry.id); continue; }
      if (entry.observedSeq !== undefined && entry.observedSeq <= watermark) continue;
      const program = backend.programs[entry.op];
      if (!program || !(entry.predictable ?? entry.predicted.length > 0)) continue;
      try {
        await predict(tx, backend.schema, program, {
          viewer: principal, args: entry.args as Record<string, unknown>, now: entry.now ?? Date.now(), newIds: [...entry.newIds],
          mint: () => { throw new Refused({ code: "E_PREDICT", family: "prediction", message: "replay needs an id that was not fixed before this write was submitted" }); },
        });
      } catch (error) {
        if (!(error instanceof Refused)) throw error;
        // Its POST may already be in flight with the original IDs. Keep the
        // admitted write, but stop rendering a prediction we cannot replay.
        if (error.refusal.code === "E_PREDICT") await tx.side("outbox").put(entry.id, { ...entry, predicted: [], predictable: false });
      }
    }
  }
  replica.reconcile = rebase;

  async function flushOnce() {
    {
      for (const entry of await queued()) {
        if (closed) return;
        if (entry.sentSeq !== undefined) { await replica.syncOnce(); continue; }
        const result = await network(async () => {
          if (closed || sessionDead) return { ok: false as const };
          await store.write(async (tx) => tx.setMeta("outbox:sendRevision", Number(await tx.getMeta("outbox:sendRevision") ?? 0) + 1));
          return post(`/m/${entry.op}`, { id: entry.id, args: entry.args, newIds: entry.newIds });
        });
        if (closed) return;
        if (!result.ok) { retryFlush(); return; }
        const json = result.json;
        const why = (json.why ?? json.denied) as Refusal | undefined;
        if (why?.retryable || (json.state !== "sent" && !why)) { retryFlush(); return; }
        retryMs = 250;
        await store.write((tx) => rebase(tx, async () => {
          if (json.state === "sent") {
            const current = await tx.side("outbox").get(entry.id) as Queued | undefined;
            if (current) await tx.side("outbox").put(entry.id, { ...current, sentSeq: Number(json.seq ?? 0) });
          }
          else await tx.side("outbox").delete(entry.id);
        }));
        settled.get(entry.id)?.(json.state === "sent" ? { state: "sent", id: entry.id, seq: Number(json.seq ?? 0) } : { state: "failed", id: entry.id, why: why ?? offline() });
        settled.delete(entry.id);
        if (json.state === "sent") await replica.syncOnce();
        for (const watch of watches.values()) void rerun(watch);
      }

    }
  }

  const settled = new Map<string, (write: Write) => void>();

  const client = {
    replica,
    async sync() {
      if (!closed && !sessionDead) await replica.syncOnce();
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
      const unavailableWhy = unavailable();
      if (unavailableWhy) return { state: "failed", id, why: unavailableWhy };
      const seq = ++submissions;
      const program = backend.programs[op.name];
      const selectedBackend = backend;
      if (!program) return { state: "failed", id, why: { code: "E_OP", family: "op", message: `unknown mutation ${op.name}` } };
      const newIds: string[] = [];
      const mint = () => { const minted = mintId(); newIds.push(minted); return minted; };
      const now = Date.now();
      const tables = operationTables(program, backend.schema);
      const onlineOnly = [...tables].some((t) => !backend.schema.tables[t]?.sync);
      // Register before admission: a concurrent flush can see the durable
      // entry as soon as the transaction commits.
      const outcome = new Promise<Write>((resolve) => settled.set(id, resolve));
      let refused: Refusal | null = null;
      await track((async () => {
        try {
          await store.write(async (tx) => {
            if (backend !== selectedBackend) throw new Refused({ code: "E_GENERATION", family: "generation", message: "the backend changed before this write was admitted", retryable: true });
            const predicted = onlineOnly ? [] : await predict(tx, backend.schema, program, { viewer: principal, args: args as Record<string, unknown>, now, newIds: [], mint });
            await enqueue(tx, { id, seq, op: op.name, args, now, newIds: [...newIds], predicted, predictable: !onlineOnly });
          });
        } catch (error) {
          if (error instanceof Refused && error.refusal.code === "E_PREDICT") {
            try { await store.write((tx) => enqueue(tx, { id, seq, op: op.name, args, now, newIds: [], predicted: [], predictable: false })); }
            catch (failure) { refused = { code: "E_STORE", family: "store", message: `write ${id} was not admitted: ${String(failure)}` }; }
          } else refused = error instanceof Refused ? error.refusal : { code: "E_STORE", family: "store", message: `write ${id} was not admitted: ${String(error)}` };
        }
      })());
      if (refused) { settled.delete(id); return { state: "failed", id, why: refused }; }
      if (closed) { settled.delete(id); return { state: "pending", id }; }
      for (const watch of watches.values()) void rerun(watch);
      void flush();
      if (link !== "online") return { state: "pending", id };
      let timer: ReturnType<typeof setTimeout> | undefined;
      try { return await Promise.race([outcome, new Promise<Write>((resolve) => { timer = setTimeout(() => resolve({ state: "pending", id }), 4_000); })]); }
      finally { clearTimeout(timer); }
    },
    async upload(bytes: Blob | ArrayBuffer | Uint8Array) {
      const unavailableWhy = unavailable();
      if (unavailableWhy) return { ok: false as const, why: unavailableWhy };
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
    viewer: () => sessionDead ? null : viewer,
    session: () => (sessionDead ? null : session),
    onSession(listener: (session: Session | null) => void) {
      sessionListeners.add(listener);
      return () => sessionListeners.delete(listener);
    },
    async signOut() {
      if (session && !sessionDead) await logout(base, session.token, doFetch);
      if (!sessionDead) await endSession();
      await client.close();
    },
    close() {
      if (closing) return closing;
      closed = true;
      aborter.abort();
      if (retry) clearTimeout(retry);
      watches.clear();
      linkListeners.clear();
      sessionListeners.clear();
      for (const [id, resolve] of settled) resolve({ state: "pending", id });
      closing = (async () => {
        await Promise.allSettled([online.close(), flushing, ...active]);
        await replica.close();
        settled.clear();
      })();
      return closing;
    },
  };
  // First: catch up, then re-apply any predictions still in the outbox.
  await client.sync();
  await reapplyPredictions();
  changesSeq = (await replica.state()).watermark;
  replica.follow(waitForChange);
  void flush();

  async function reapplyPredictions() { await store.write((tx) => rebase(tx, async () => {})); }

  return client;
}

async function loadBackend(doFetch: typeof fetch, base: string, headers: Record<string, string>, signal?: AbortSignal): Promise<Backend> {
  const response = await doFetch(`${base}/schema`, { headers, ...(signal ? { signal } : {}) });
  const json = (await response.json()) as { generation: number; schema: SchemaJson; programs: ProgramJson[] };
  return { generation: json.generation, schema: json.schema, programs: Object.fromEntries(json.programs.map((p) => [p.name, p])) };
}

export type { Row };
