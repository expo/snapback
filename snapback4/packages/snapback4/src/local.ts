// The local-first tier (LLP 3000 §7, one implementation): the device is
// the Rust module — the partition in its own store, the stream applied,
// the outbox kept, queries and predictions answered — and this client is
// what remains: the session, the link, the transport, and the observation
// of reads. Every word a screen reads is still the card. The module is
// reached through one JSON call (`DeviceCore`), so the wasm device on the
// web (`snapback4/web`), the Expo module (`snapback4-expo`) and the
// `snapback4 device` process for Node (`snapback4/native`) all fit.

import type { Client, Cursor, Link, Mutation, Observed, Principal, Query, Read, Refusal, Write } from "./contract.ts";
import { mintId } from "./client.ts";
import { operationTables, type BackendJson, type ProgramJson, type SchemaJson } from "./backend.ts";
import { assetSource, fetchAsset, uploadAsset } from "./assets.ts";
import { defaultSessionStore, forgetSession, guest, keepSession, logout, restoreSession, type Session, type SessionStore } from "./auth.ts";

/** One JSON call into the device: `{ op, ... }` in, `{ ok } | { denied }` out. */
export interface DeviceCore {
  call(request: Record<string, unknown>): Promise<Record<string, unknown>>;
  close(): Promise<void>;
}

/** How a host opens its device: a store name the client derives from the
 * server and the viewer (the host decides where that lives), and the
 * backend the server sent — null to open on the one kept from last time. */
export interface DeviceOpener {
  open(name: string, backend: BackendJson | null): Promise<DeviceCore>;
}

export interface LocalOptions {
  readonly url: string;
  readonly persona?: string;
  readonly session?: Session;
  readonly guest?: boolean;
  readonly sessionStore?: SessionStore;
  readonly fetch?: typeof fetch;
  /** The device: `webDevice()` on the web, `nativeDevice` from
   * `snapback4-expo`, `processDevice()` in Node. */
  readonly device: DeviceOpener;
  readonly waitSeconds?: number;
}

export type LocalClient = Client & {
  sync(): Promise<void>;
  session(): Session | null;
  onSession(notify: (session: Session | null) => void): () => void;
  signOut(): Promise<void>;
};

interface Watch {
  op: Query<unknown, unknown>;
  args: unknown;
  key: string;
  tables: Set<string>;
  snapshot: Read<unknown>;
  subscribers: Set<() => void>;
  running: boolean;
  dirty: boolean;
  expiryTimer: ReturnType<typeof setTimeout> | null;
}

interface Queued {
  id: string;
  seq: number;
  op: string;
  args: unknown;
  new_ids: string[];
  predicted: string[];
  predictable?: boolean;
  sent_seq?: number | null;
  observed_seq?: number | null;
  viewer?: string;
  now?: number;
}

const PAGE = 4000;

async function requireSyncProtocol(core: DeviceCore): Promise<void> {
  // A JavaScript update can run inside an older Expo development build.
  // Probe without sending or changing an outbox entry, even when offline.
  const reply = await core.call({ op: "sync_state" });
  const denied = reply?.denied as Refusal | undefined;
  if (denied && typeof denied.code === "string" && denied.code !== "E_OP") throw new Error(`createLocalClient: ${denied.code}: native startup failed: ${denied.message}`);
  const state = reply?.ok as Record<string, unknown> | undefined;
  const uint = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
  if (denied || !state || !uint(state.watermark) || !uint(state.generation) || !uint(state.send_revision) || !Array.isArray(state.pending_ids) || state.pending_ids.length > 256 || !state.pending_ids.every((id) => typeof id === "string" && id.length > 0)) {
    throw new Error("createLocalClient: E_DEVICE_VERSION: the device lacks the sync receipt protocol this client speaks. Update the device to match the client: rebuild the app's native binary for snapback4-expo (reloading JavaScript does not update a native module), or serve the wasm this package version ships.");
  }
}

export async function createLocalClient(options: LocalOptions): Promise<LocalClient> {
  const doFetch = options.fetch ?? globalThis.fetch.bind(globalThis);
  const base = options.url.replace(/\/$/, "");
  const headers: Record<string, string> = { "content-type": "application/json" };
  const sessions = options.sessionStore ?? defaultSessionStore;
  let session: Session | null = null;
  if (options.persona) headers["x-snapback-persona"] = options.persona;
  else {
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
  const sessionListeners = new Set<(session: Session | null) => void>();
  const viewerListeners = new Set<(viewer: Principal | null) => void>();
  const writeListeners = new Set<(write: Exclude<Write, { state: "pending" }>) => void>();
  let setLink!: (next: Link) => void;
  const emitWrite = <T extends Exclude<Write, { state: "pending" }>>(write: T): T => {
    for (const listener of writeListeners) listener(write);
    return write;
  };
  const endSession = async () => {
    sessionDead = true;
    delete headers.authorization;
    delete headers["x-snapback-persona"];
    setLink("signed-out");
    await forgetSession(base, sessions);
    for (const listener of sessionListeners) listener(null);
    for (const listener of viewerListeners) listener(null);
  };
  const refusedSession = async (denied: unknown) => {
    if (!sessionDead && (denied as Refusal | undefined)?.code === "E_AUTH") await endSession();
  };

  // The device opens on the backend the server sends, or on the one it
  // kept when the server is unreachable: a device that has synced once
  // starts offline on what it holds. One store per server and viewer.
  const storeName = `snapback4-${encodeURIComponent(`${base}:${viewer}`)}`;
  let link: Link = "online";
  let generation = 0;
  let backend: BackendJson | null = null;
  try {
    backend = await loadBackend(doFetch, base, headers);
  } catch {
    link = "offline";
  }
  const active = new Set<Promise<unknown>>();
  const core = await options.device.open(storeName, backend);
  try {
  await requireSyncProtocol(core);
  if (backend) generation = Number(backend.generation ?? 0);
  else {
    const state = await call({ op: "state" });
    generation = Number((state.ok as { generation?: number } | undefined)?.generation ?? 0);
  }
  if (!backend) backend = (await call({ op: "backend" })).ok as BackendJson;
  // The app's native module (LLP 3000.005 §9): fetched once per digest and
  // installed on the device, which keeps it; offline, the device answers
  // native reads with the module it kept, or says it has none.
  const installNative = async (signal?: AbortSignal) => {
    const wanted = backend?.native?.digest;
    if (!wanted) return;
    const have = (await call({ op: "state" })).ok as { native?: string | null } | undefined;
    if (have?.native === wanted) return;
    try {
      const response = await doFetch(`${base}/native.wasm`, { headers, ...(signal ? { signal } : {}) });
      if (!response.ok) return;
      const bytes = new Uint8Array(await response.arrayBuffer());
      let hex = "";
      for (const byte of bytes) hex += byte.toString(16).padStart(2, "0");
      await call({ op: "install_native", wasm: hex, digest: wanted });
    } catch {
      // Offline or refused: the device answers with what it kept.
    }
  };
  await installNative();
  let closed = false;
  let closing: Promise<void> | undefined;
  const aborter = new AbortController();
  let networkTail: Promise<unknown> = Promise.resolve();
  function network<T>(body: () => Promise<T>): Promise<T> {
    const result = networkTail.then(body);
    networkTail = result.catch(() => {});
    return result;
  }
  let seq = 0;
  // The submission counter is taken synchronously as each write is admitted
  // — a burst predicts concurrently and would otherwise number itself in
  // the order its predictions finished — and continues from what the
  // module's outbox holds.
  let submissions = Number((await call({ op: "next_submission" })).ok ?? 1) - 1;
  let partitionDenied: Refusal | null = null;
  const linkListeners = new Set<(link: Link) => void>();
  const watches = new Map<string, Watch>();
  const settled = new Map<string, (write: Write) => void>();
  let lastSyncAt = Number((await call({ op: "meta", key: "syncedAt" })).ok ?? 0);
  let caughtUp = false;

  async function call(request: Record<string, unknown>): Promise<{ ok?: unknown; denied?: Refusal }> {
    const work = core.call(request);
    active.add(work);
    try { return (await work) as { ok?: unknown; denied?: Refusal }; }
    finally { active.delete(work); }
  }

  const offline = (): Refusal => ({ code: "E_OFFLINE", family: "link", message: "the server is unreachable", retryable: true });
  const unavailable = (): Refusal | null => closed ? { code: "E_CLOSED", family: "client", message: "this client is closed" } : sessionDead ? { code: "E_AUTH", family: "auth", message: "sign in to continue" } : null;

  setLink = (next: Link) => {
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
      const json = (await response.json()) as Record<string, unknown>;
      if (closed) return { ok: false };
      if (response.status >= 500) { setLink("offline"); return { ok: false }; }
      await refusedSession(json.denied ?? json.why);
      if (link !== "online") setLink("online");
      return { ok: true, json };
    } catch {
      setLink("offline");
      return { ok: false };
    }
  }

  // ----- the stream -----

  let syncing: Promise<boolean> | null = null;
  function syncOnce(): Promise<boolean> {
    if (syncing) return syncing;
    const result = network(syncRound);
    syncing = result;
    void result.finally(() => { if (syncing === result) syncing = null; }).catch(() => {});
    return result;
  }
  async function syncRound(): Promise<boolean> {
    caughtUp = false;
    if (closed || sessionDead) return false;
    const state = (await call({ op: "state" })).ok as { watermark: number; generation: number } | undefined;
    let watermark = state?.watermark ?? 0;
    const touched = new Set<string>();
    let after: string | undefined;
    let catchingUp = false;
    try {
      for (let pages = 0; pages < 100_000; pages++) {
        let page: Record<string, unknown>;
        try {
          const captured = await call({ op: "sync_state" });
          if (captured.denied) return false;
          const { pending_ids: pending, send_revision } = captured.ok as { pending_ids: string[]; send_revision: number };
          const response = await doFetch(`${base}/sync?from=${watermark}&limit=${PAGE}${after ? `&after=${encodeURIComponent(after)}` : ""}${catchingUp ? "&stream=1" : ""}${pending.length ? `&pending=${encodeURIComponent(JSON.stringify(pending))}` : ""}`, { headers, signal: aborter.signal });
          if (response.status >= 500) { setLink("offline"); return false; }
          page = (await response.json()) as Record<string, unknown>;
          page.send_revision = send_revision;
        } catch {
          setLink("offline");
          return false;
        }
        if (closed) return false;
        if (page.denied) {
          await refusedSession(page.denied);
          if (!(page.denied as Refusal).retryable) {
            if (!partitionDenied) console.error(`snapback4: the server refused the partition: ${(page.denied as Refusal).code}: ${(page.denied as Refusal).message}`);
            partitionDenied = page.denied as Refusal;
            for (const watch of watches.values()) void rerun(watch);
          }
          return false;
        }
        if (link !== "online") setLink("online");
        partitionDenied = null;
        const pageGeneration = Number(page.generation ?? generation);
        if (pageGeneration !== generation) {
          // A new generation: adopt the backend the server now serves; the
          // device drops its rows and the next round takes a snapshot.
          try {
            const nextBackend = await loadBackend(doFetch, base, headers, aborter.signal);
            if (closed) return false;
            const adopted = await call({ op: "adopt", backend: nextBackend });
            if (adopted.denied) return false;
            backend = nextBackend;
            await installNative(aborter.signal);
            generation = Number(nextBackend.generation ?? pageGeneration);
          } catch {
            return false;
          }
          watermark = 0; after = undefined; catchingUp = false; continue;
        }
        if (Number(page.watermark) < watermark || (catchingUp && page.snapshot) || (page.snapshot && page.more && !page.next)) return false;
        page.stage_snapshot = !!page.snapshot;
        page.snapshot_catchup = catchingUp;
        const applied = await call({ op: "apply", page, first: !catchingUp && after === undefined });
        if (closed) return false;
        if (applied.denied) return false;
        for (const table of ((applied.ok as { touched?: string[] } | undefined)?.touched ?? [])) touched.add(table);
        if (page.snapshot && page.more && page.next) {
          after = page.next as string;
          continue;
        }
        after = undefined;
        watermark = Number(page.watermark ?? watermark);
        if (page.snapshot) { catchingUp = true; continue; }
        if (!page.more) {
          caughtUp = true;
          break;
        }
      }
      if (!caughtUp) return false;
      lastSyncAt = Date.now();
      await call({ op: "set_meta", key: "syncedAt", value: String(lastSyncAt) });
      return true;
    } finally {
      if (!closed && touched.size > 0) {
        for (const watch of watches.values()) if (watch.tables.size === 0 || [...watch.tables].some((t) => touched.has(t))) void rerun(watch);
      } else if (!closed && caughtUp) {
        for (const watch of watches.values()) {
          if (!("data" in watch.snapshot) || watch.snapshot.fresh) continue;
          const { since: _, ...read } = watch.snapshot;
          watch.snapshot = { ...read, fresh: true };
          notify(watch);
        }
      }
    }
  }

  async function probe(): Promise<void> {
    try {
      const response = await doFetch(`${base}/probe`, { headers, signal: aborter.signal });
      let json: Record<string, unknown> = {};
      try { json = (await response.json()) as Record<string, unknown>; } catch {}
      if (closed) return;
      await refusedSession(json.denied ?? json.why);
      if (response.status === 200 && json.ok === true && !sessionDead) setLink("online");
    } catch {}
  }

  async function waitForChange(): Promise<boolean> {
    if (link !== "online") {
      await new Promise((r) => setTimeout(r, 1000));
      if (!closed && !sessionDead) await probe();
      return false;
    }
    try {
      const response = await doFetch(`${base}/changes?since=${seq}&wait=${options.waitSeconds ?? 25}`, { headers, signal: aborter.signal });
      if (!response.ok) throw new Error(`changes: HTTP ${response.status}`);
      const json = (await response.json()) as { seq: number; tables?: string[]; generation?: number };
      const changed = json.seq > seq || (json.generation !== undefined && json.generation !== generation);
      if (changed) {
        seq = Math.max(seq, json.seq);
      }
      return changed;
    } catch {
      if (closed) return false;
      setLink("offline");
      await new Promise((r) => setTimeout(r, 1000));
      return false;
    }
  }

  let following: Promise<void> | null = null;
  function follow() {
    if (following) return;
    following = (async () => {
      while (!closed) {
        if (caughtUp && !await waitForChange()) continue;
        let ok = false;
        try {
          ok = await syncOnce();
        } catch {
          if (closed) break;
        }
        if (closed) break;
        if (!ok) await new Promise((r) => setTimeout(r, 1000));
      }
    })();
  }

  // ----- reads -----

  function runLocal<R>(op: Query<unknown, R>, args: unknown) {
    const work = evaluateLocal(op, args);
    active.add(work);
    void work.finally(() => active.delete(work)).catch(() => {});
    return work;
  }

  async function evaluateLocal<R>(op: Query<unknown, R>, args: unknown): Promise<{ read: Read<R>; tables: Set<string>; nextExpiry: number | null }> {
    const refused = unavailable();
    if (refused) return { read: { denied: refused }, tables: new Set(), nextExpiry: null };
    const schema = backend!.schema;
    const program = backend!.programs.find((p) => p.name === op.name);
    const tables = program && schema ? operationTables(program, schema) : new Set<string>();
    if (partitionDenied) return { read: { denied: partitionDenied }, tables, nextExpiry: null };
    const server = async () => {
      const result = await post(`/q/${op.name}`, { args });
      if (sessionDead) return { read: { denied: { code: "E_AUTH", family: "auth", message: "sign in to read" } } as Read<R>, tables, nextExpiry: null };
      if (!result.ok) return { read: { denied: offline() } as Read<R>, tables, nextExpiry: null };
      const json = result.json;
      for (const table of (json.tables as string[] | undefined) ?? []) tables.add(table);
      if (json.denied) return { read: { denied: json.denied as Refusal } as Read<R>, tables, nextExpiry: null };
      const next = (json.next as Cursor | null | undefined) ?? null;
      const nextExpiry = typeof json.nextExpiry === "number" && Number.isFinite(json.nextExpiry) ? json.nextExpiry : null;
      return { read: { data: json.data as R, complete: json.complete !== false, fresh: true, next }, tables, nextExpiry };
    };
    const onlineOnly = [...tables].some((t) => !schema.tables[t]?.sync);
    if (onlineOnly && link === "online") return server();
    const answer = await call({ op: "query", name: op.name, viewer: principal, args, now: Date.now() });
    const unavailableWhy = unavailable();
    if (unavailableWhy) return { read: { denied: unavailableWhy }, tables, nextExpiry: null };
    if (answer.denied) return { read: { denied: answer.denied }, tables, nextExpiry: null };
    const outcome = answer.ok as { denied?: Refusal; data?: unknown; complete?: boolean; next?: string | null; tables?: string[]; unknown?: boolean; nextExpiry?: number | null };
    for (const table of outcome.tables ?? []) tables.add(table);
    if (outcome.denied) return onlineOnly || outcome.unknown ? link === "online" ? server() : { read: { denied: offline() }, tables, nextExpiry: null } : { read: { denied: outcome.denied }, tables, nextExpiry: null };
    if (outcome.complete === false && link === "online" && !(await queued()).some((e) => e.observed_seq == null && (e.predictable ?? e.predicted.length > 0))) return server();
    const fresh = link === "online" && caughtUp;
    const nextExpiry = typeof outcome.nextExpiry === "number" && Number.isFinite(outcome.nextExpiry) ? outcome.nextExpiry : null;
    return { read: { data: outcome.data as R, complete: outcome.complete !== false && !onlineOnly, fresh, next: (outcome.next as Cursor | null | undefined) ?? null, ...(fresh || !lastSyncAt ? {} : { since: lastSyncAt }) }, tables, nextExpiry };
  }

  function notify(watch: Watch) {
    for (const subscriber of watch.subscribers) subscriber();
  }

  function predictedTables(predicted: readonly string[]): Set<string> {
    return new Set(predicted.map((row) => row.slice(0, row.lastIndexOf("/"))).filter(Boolean));
  }

  function rerunTables(tables: Set<string>) {
    if (!tables.size) return;
    for (const watch of watches.values()) if (watch.tables.size === 0 || [...watch.tables].some((table) => tables.has(table))) void rerun(watch);
  }

  function scheduleExpiry(watch: Watch, nextExpiry: number | null) {
    if (watch.expiryTimer) clearTimeout(watch.expiryTimer);
    watch.expiryTimer = null;
    if (nextExpiry == null || closed) return;
    const delay = Math.min(Math.max(0, nextExpiry - Date.now()), 2_147_483_647);
    watch.expiryTimer = setTimeout(() => {
      watch.expiryTimer = null;
      if (watches.get(watch.key) === watch) void rerun(watch);
    }, delay);
    (watch.expiryTimer as { unref?: () => void }).unref?.();
  }

  async function rerun(watch: Watch) {
    if (closed) return;
    if (watch.running) {
      watch.dirty = true;
      return;
    }
    watch.running = true;
    try {
      const { read, tables, nextExpiry } = await runLocal(watch.op, watch.args);
      if (closed) return;
      watch.tables = tables;
      watch.snapshot = read;
      scheduleExpiry(watch, nextExpiry);
      notify(watch);
    } finally {
      watch.running = false;
      if (watch.dirty) {
        watch.dirty = false;
        void rerun(watch);
      }
    }
  }

  // ----- the outbox -----

  async function queued(): Promise<Queued[]> {
    const answer = await call({ op: "queued" });
    if (answer.denied) throw new Error(`${answer.denied.code}: ${answer.denied.message}`);
    return (answer.ok as Queued[] | undefined) ?? [];
  }

  let retry: ReturnType<typeof setTimeout> | undefined;
  let retryMs = 250;
  let flushing: Promise<void> | null = null;
  let flushAgain = false;
  function flush(): Promise<void> {
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
    retryMs = Math.min(5000, retryMs * 2);
  }

  async function flushOnce() {
    for (const entry of await queued()) {
      if (closed) return;
      if (entry.sent_seq != null) { await syncOnce(); continue; }
      const result = await network(async () => {
        if (closed || sessionDead) return { ok: false as const };
        const started = await call({ op: "begin_send" });
        if (started.denied) return { ok: false as const };
        return post(`/m/${entry.op}`, { id: entry.id, args: entry.args, newIds: entry.new_ids });
      });
      if (closed) return;
      if (!result.ok) { retryFlush(); return; }
      const json = result.json;
      const why = (json.why ?? json.denied) as Refusal | undefined;
      if (why?.retryable || (json.state !== "sent" && !why)) { retryFlush(); return; }
      const applied = await call({ op: "settle", id: entry.id, ...(json.state === "sent" ? {seq: Number(json.seq ?? 0)} : {}) });
      if (applied.denied) { retryFlush(); return; }
      retryMs = 250;
      const settle = settled.get(entry.id);
      settled.delete(entry.id);
      const outcome: Write = json.state === "sent"
        ? { state: "sent", id: entry.id, seq: Number(json.seq ?? 0) }
        : { state: "failed", id: entry.id, why: (json.why as Refusal | undefined) ?? (json.denied as Refusal | undefined) ?? { code: "E_STORE", family: "store", message: "the server answered without a state", retryable: true } };
      if (outcome.state === "sent") await syncOnce();
      else rerunTables(predictedTables(entry.predicted));
      settle?.(outcome);
      emitWrite(outcome);
    }
  }

  const client: LocalClient = {
    async query(op, args) {
      return (await runLocal(op, args)).read;
    },
    observe<A, R>(op: Query<A, R>, args: A): Observed<R> {
      const key = `${op.name}:${JSON.stringify(args)}`;
      let watch = watches.get(key);
      if (!watch) {
        watch = { op: op as Query<unknown, unknown>, args, key, tables: new Set(), snapshot: { loading: true }, subscribers: new Set(), running: false, dirty: false, expiryTimer: null };
        watches.set(key, watch);
        void rerun(watch);
      }
      const own = watch;
      const mine = new Set<() => void>();
      return {
        getSnapshot: () => own.snapshot as Read<R>,
        subscribe(notifyMe) {
          mine.add(notifyMe);
          own.subscribers.add(notifyMe);
          if (watches.get(own.key) !== own) {
            watches.set(own.key, own);
            void rerun(own);
          }
          return () => {
            mine.delete(notifyMe);
            own.subscribers.delete(notifyMe);
          };
        },
        close() {
          for (const s of mine) own.subscribers.delete(s);
          if (own.subscribers.size === 0) {
            watches.delete(own.key);
            if (own.expiryTimer) clearTimeout(own.expiryTimer);
            own.expiryTimer = null;
          }
        },
      };
    },
    async mutate<A, R>(op: Mutation<A, R>, args: A): Promise<Write> {
      const id = mintId();
      const unavailableWhy = unavailable();
      if (unavailableWhy) return emitWrite({ state: "failed", id, why: unavailableWhy });
      const submission = ++submissions;
      const newIds: string[] = [];
      // The module mints ids for `new` from the ids we pass, so the server
      // applies the same ones; a burst takes them from one ascending clock.
      for (let n = 0; n < 8; n++) newIds.push(mintId());
      const schema = backend!.schema;
      const program = backend!.programs.find((p) => p.name === op.name);
      const predictable = Boolean(program && schema && [...operationTables(program, schema)].every((t) => schema.tables[t]?.sync));
      const result = new Promise<Write>((resolve) => settled.set(id, resolve));
      try {
        const admitted = await call({ op: "admit", entry: { id, seq: submission, op: op.name, args, viewer: principal, now: Date.now(), new_ids: newIds, predicted: [], predictable } satisfies Queued });
        if (admitted.denied) { settled.delete(id); return emitWrite({ state: "failed", id, why: admitted.denied }); }
        rerunTables(predictedTables(((admitted.ok as Queued | undefined)?.predicted) ?? []));
      } catch (error) {
        settled.delete(id);
        return emitWrite({ state: "failed", id, why: { code: "E_STORE", family: "store", message: `write ${id} admission outcome is unknown: ${String(error)}` } });
      }
      if (closed) { settled.delete(id); return { state: "pending", id }; }
      void flush();
      if (link !== "online") return { state: "pending", id };
      let timer: ReturnType<typeof setTimeout> | undefined;
      try { return await Promise.race([result, new Promise<Write>((resolve) => { timer = setTimeout(() => resolve({ state: "pending", id }), 4_000); })]); }
      finally { clearTimeout(timer); }
    },
    async upload(bytes) {
      const unavailableWhy = unavailable();
      if (unavailableWhy) return { ok: false as const, why: unavailableWhy };
      if (link !== "online") return { ok: false as const, why: { code: "E_OFFLINE", family: "link", message: "the server is unreachable; uploads wait for no link", retryable: true } };
      const uploaded = await uploadAsset(base, headers, doFetch, bytes);
      if (!uploaded.ok && uploaded.why.code === "E_OFFLINE") setLink("offline");
      return uploaded;
    },
    asset: (id) => fetchAsset(base, headers, doFetch, id),
    assetSource: (id) => assetSource(base, headers, id),
    link: () => link,
    onLink(listener) {
      linkListeners.add(listener);
      return () => linkListeners.delete(listener);
    },
    viewer: () => sessionDead ? null : viewer,
    onViewer(listener) {
      viewerListeners.add(listener);
      return () => viewerListeners.delete(listener);
    },
    onWrite(listener) {
      writeListeners.add(listener);
      return () => writeListeners.delete(listener);
    },
    session: () => (sessionDead ? null : session),
    onSession(listener) {
      sessionListeners.add(listener);
      return () => sessionListeners.delete(listener);
    },
    async sync() {
      if (!closed && !sessionDead) await syncOnce();
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
      for (const watch of watches.values()) if (watch.expiryTimer) clearTimeout(watch.expiryTimer);
      watches.clear();
      linkListeners.clear();
      sessionListeners.clear();
      viewerListeners.clear();
      writeListeners.clear();
      for (const [id, resolve] of settled) resolve({ state: "pending", id });
      closing = (async () => {
        await Promise.allSettled([following, syncing, flushing, ...active]);
        await core.close();
        settled.clear();
      })();
      return closing;
    },
  };
  if (link === "online") await syncOnce();
  seq = Number(((await call({ op: "state" })).ok as { watermark?: number } | undefined)?.watermark ?? 0);
  follow();
  void flush();
  return client;
  } catch (error) {
    // Opening the device transfers its lifetime to this constructor. Until a
    // client is returned, every later startup failure must release it here.
    try { await core.close(); } catch {}
    throw error;
  }
}

async function loadBackend(doFetch: typeof fetch, base: string, headers: Record<string, string>, signal?: AbortSignal): Promise<BackendJson> {
  const response = await doFetch(`${base}/schema`, { headers, ...(signal ? { signal } : {}) });
  return (await response.json()) as BackendJson;
}
