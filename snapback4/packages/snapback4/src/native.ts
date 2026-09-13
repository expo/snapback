// The native tier (LLP 3000 §7, one interpreter hosted two ways): the
// device is the Rust module — the partition in its own SQLite, the stream
// applied, the outbox kept, queries and predictions answered — and this
// client is what remains: the session, the link, the transport, and the
// observation of reads. Every word a screen reads is still the card. The
// module is reached through one JSON call (`NativeCore`), so an Expo
// module, an Exact2 host, or the `snapback4 device` process all fit.

import type { Client, Cursor, Link, Mutation, Observed, Principal, Query, Read, Refusal, Write } from "./contract.ts";
import { createClient, mintId } from "./client.ts";
import { operationTables } from "./replica/dependencies.ts";
import type { ProgramJson } from "./replica/interpreter.ts";
import type { SchemaJson } from "./replica/store.ts";
import { assetSource, fetchAsset, uploadAsset } from "./assets.ts";
import { defaultSessionStore, forgetSession, guest, keepSession, logout, restoreSession, type Session, type SessionStore } from "./auth.ts";

/** One JSON call into the module: `{ op, ... }` in, `{ ok } | { denied }` out. */
export interface NativeCore {
  call(request: Record<string, unknown>): Promise<Record<string, unknown>>;
  close(): Promise<void>;
}

/** How a host opens its device: the store's path, and the backend the
 * server sent (null to open on the one kept from last time). */
export interface NativeOpener {
  open(path: string, backend: Record<string, unknown> | null): Promise<NativeCore>;
}

export interface NativeOptions {
  readonly url: string;
  readonly persona?: string;
  readonly session?: Session;
  readonly guest?: boolean;
  readonly sessionStore?: SessionStore;
  readonly fetch?: typeof fetch;
  /** The host's module, and where its store lives (a directory the host owns). */
  readonly native: NativeOpener;
  readonly dataDir: string;
  readonly waitSeconds?: number;
}

export type NativeClient = Client & {
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

export async function createNativeClient(options: NativeOptions): Promise<NativeClient> {
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
      if (!signedIn.ok) throw new Error(`createNativeClient: ${signedIn.why.code}: ${signedIn.why.message}`);
      session = signedIn.session;
      await keepSession(base, session, sessions);
    }
    if (!session) throw new Error(`createNativeClient: no session for ${base}; pass one from guest(), login() or signup(), or say guest: true`);
    headers.authorization = `Bearer ${session.token}`;
  }
  const viewer: Principal = (options.persona ? `dev:${options.persona}` : session!.principal) as Principal;
  const principal: string = viewer;
  let sessionDead = false;
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

  // The device opens on the backend the server sends, or on the one it
  // kept when the server is unreachable: a device that has synced once
  // starts offline on what it holds.
  const storePath = `${options.dataDir.replace(/\/$/, "")}/snapback4-${encodeURIComponent(`${base}:${viewer}`)}.sqlite`;
  let link: Link = "online";
  let generation = 0;
  let backend: Record<string, unknown> | null = null;
  try {
    backend = await loadBackend(doFetch, base, headers);
  } catch {
    link = "offline";
  }
  const active = new Set<Promise<unknown>>();
  const core = await options.native.open(storePath, backend);
  if (backend) generation = Number(backend.generation ?? 0);
  else {
    const state = await call({ op: "state" });
    generation = Number((state.ok as { generation?: number } | undefined)?.generation ?? 0);
  }
  if (!backend) backend = (await call({ op: "backend" })).ok as Record<string, unknown>;
  const online = createClient({ url: base, ...(options.persona ? { persona: options.persona } : {}), ...(session ? { session } : {}), fetch: doFetch });
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
            backend = await loadBackend(doFetch, base, headers, aborter.signal);
            if (closed) return false;
            const adopted = await call({ op: "adopt", backend });
            if (adopted.denied) return false;
            generation = Number(backend.generation ?? pageGeneration);
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
      if (!closed && (touched.size > 0 || caughtUp)) for (const watch of watches.values()) if (touched.size === 0 || watch.tables.size === 0 || [...watch.tables].some((t) => touched.has(t))) void rerun(watch);
    }
  }

  async function waitForChange(): Promise<void> {
    if (link !== "online") {
      await new Promise((r) => setTimeout(r, 1000));
      if (!closed && !sessionDead) await post("/q/__probe", {});
      return;
    }
    try {
      const response = await doFetch(`${base}/changes?since=${seq}&wait=${options.waitSeconds ?? 25}`, { headers, signal: aborter.signal });
      if (!response.ok) throw new Error(`changes: HTTP ${response.status}`);
      const json = (await response.json()) as { seq: number; tables?: string[]; generation?: number };
      if (json.seq > seq || (json.generation !== undefined && json.generation !== generation)) {
        seq = Math.max(seq, json.seq);
        const touched = new Set(json.tables ?? []);
        for (const watch of watches.values()) if (watch.tables.size === 0 || [...watch.tables].some((t) => touched.has(t)) || json.generation !== generation) void rerun(watch);
      }
    } catch {
      if (closed) return;
      setLink("offline");
      await new Promise((r) => setTimeout(r, 1000));
    }
  }

  let following: Promise<void> | null = null;
  function follow() {
    if (following) return;
    following = (async () => {
      if (caughtUp && !closed) await waitForChange();
      while (!closed) {
        let ok = false;
        try {
          ok = await syncOnce();
        } catch {
          if (closed) break;
        }
        if (closed) break;
        if (!ok) await new Promise((r) => setTimeout(r, 1000));
        else await waitForChange();
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

  async function evaluateLocal<R>(op: Query<unknown, R>, args: unknown): Promise<{ read: Read<R>; tables: Set<string> }> {
    const refused = unavailable();
    if (refused) return { read: { denied: refused }, tables: new Set() };
    const schema = backend?.schema as SchemaJson;
    const program = (backend?.programs as ProgramJson[] | undefined)?.find((p) => p.name === op.name);
    const tables = program && schema ? operationTables(program, schema) : new Set<string>();
    if (partitionDenied) return { read: { denied: partitionDenied }, tables };
    const server = async () => {
      const read = await online.query(op, args);
      if ("denied" in read) await refusedSession(read.denied);
      setLink(online.link());
      return { read, tables };
    };
    const onlineOnly = [...tables].some((t) => !schema.tables[t]?.sync);
    if (onlineOnly && link === "online") return server();
    const answer = await call({ op: "query", name: op.name, viewer: principal, args, now: Date.now() });
    const unavailableWhy = unavailable();
    if (unavailableWhy) return { read: { denied: unavailableWhy }, tables };
    if (answer.denied) return { read: { denied: answer.denied }, tables };
    const outcome = answer.ok as { denied?: Refusal; data?: unknown; complete?: boolean; next?: string | null; tables?: string[]; unknown?: boolean };
    for (const table of outcome.tables ?? []) tables.add(table);
    if (outcome.denied) return onlineOnly || outcome.unknown ? link === "online" ? server() : { read: { denied: offline() }, tables } : { read: { denied: outcome.denied }, tables };
    if (outcome.complete === false && link === "online" && !(await queued()).some((e) => e.observed_seq == null && (e.predictable ?? e.predicted.length > 0))) return server();
    const fresh = link === "online" && caughtUp;
    return { read: { data: outcome.data as R, complete: outcome.complete !== false && !onlineOnly, fresh, next: (outcome.next as Cursor | null | undefined) ?? null, ...(fresh || !lastSyncAt ? {} : { since: lastSyncAt }) }, tables };
  }

  function notify(watch: Watch) {
    for (const subscriber of watch.subscribers) subscriber();
  }

  async function rerun(watch: Watch) {
    if (closed) return;
    if (watch.running) {
      watch.dirty = true;
      return;
    }
    watch.running = true;
    try {
      const { read, tables } = await runLocal(watch.op, watch.args);
      if (closed) return;
      watch.tables = tables;
      watch.snapshot = read;
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
      settle?.(outcome);
      for (const watch of watches.values()) void rerun(watch);
    }
  }

  const client: NativeClient = {
    async query(op, args) {
      return (await runLocal(op, args)).read;
    },
    observe<A, R>(op: Query<A, R>, args: A): Observed<R> {
      const key = `${op.name}:${JSON.stringify(args)}`;
      let watch = watches.get(key);
      if (!watch) {
        watch = { op: op as Query<unknown, unknown>, args, key, tables: new Set(), snapshot: { loading: true }, subscribers: new Set(), running: false, dirty: false };
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
          if (own.subscribers.size === 0) watches.delete(own.key);
        },
      };
    },
    async mutate<A, R>(op: Mutation<A, R>, args: A): Promise<Write> {
      const id = mintId();
      const unavailableWhy = unavailable();
      if (unavailableWhy) return { state: "failed", id, why: unavailableWhy };
      const submission = ++submissions;
      const newIds: string[] = [];
      // The module mints ids for `new` from the ids we pass, so the server
      // applies the same ones; a burst takes them from one ascending clock.
      for (let n = 0; n < 8; n++) newIds.push(mintId());
      const schema = backend?.schema as SchemaJson;
      const program = (backend?.programs as ProgramJson[] | undefined)?.find((p) => p.name === op.name);
      const predictable = Boolean(program && schema && [...operationTables(program, schema)].every((t) => schema.tables[t]?.sync));
      const result = new Promise<Write>((resolve) => settled.set(id, resolve));
      try {
        const admitted = await call({ op: "admit", entry: { id, seq: submission, op: op.name, args, viewer: principal, now: Date.now(), new_ids: newIds, predicted: [], predictable } satisfies Queued });
        if (admitted.denied) { settled.delete(id); return { state: "failed", id, why: admitted.denied }; }
      } catch (error) {
        settled.delete(id);
        return { state: "failed", id, why: { code: "E_STORE", family: "store", message: `write ${id} admission outcome is unknown: ${String(error)}` } };
      }
      if (closed) { settled.delete(id); return { state: "pending", id }; }
      for (const watch of watches.values()) void rerun(watch);
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
      watches.clear();
      linkListeners.clear();
      sessionListeners.clear();
      for (const [id, resolve] of settled) resolve({ state: "pending", id });
      closing = (async () => {
        await Promise.allSettled([following, syncing, flushing, online.close(), ...active]);
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
}

async function loadBackend(doFetch: typeof fetch, base: string, headers: Record<string, string>, signal?: AbortSignal): Promise<Record<string, unknown>> {
  const response = await doFetch(`${base}/schema`, { headers, ...(signal ? { signal } : {}) });
  return (await response.json()) as Record<string, unknown>;
}

/** The module as a process, for Node: `snapback4 device <store> [backend]`,
 * one JSON line each way. The path to the binary is the host's to give. */
export function processCore(binary: string, spawn: (command: string, args: string[]) => { stdin: { write(text: string): unknown }; stdout: { on(event: "data", listener: (chunk: unknown) => void): unknown }; on?(event: "exit" | "error", listener: (...args: unknown[]) => void): unknown; kill(): unknown }, writeFile: (path: string, text: string) => Promise<void>): NativeOpener {
  return {
    async open(path, backend) {
      const args = [ "device", path ];
      if (backend) {
        const file = `${path}.backend.json`;
        await writeFile(file, JSON.stringify(backend));
        args.push(file);
      }
      const child = spawn(binary, args);
      let buffer = "";
      let failure: Error | undefined;
      let closed = false;
      let closing: Promise<void> | undefined;
      const lines: string[] = [];
      const waiting: { resolve: (line: string) => void; reject: (error: Error) => void }[] = [];
      const fail = (error: Error) => {
        failure ??= error;
        for (const waiter of waiting.splice(0)) waiter.reject(failure);
      };
      const exited = new Promise<void>((resolve) => {
        if (!child.on) { resolve(); return; }
        child.on("exit", (code, signal) => { fail(new Error(`native device exited (${signal ?? code})`)); resolve(); });
        child.on("error", (error) => { fail(error instanceof Error ? error : new Error(String(error))); resolve(); });
      });
      child.stdout.on("data", (chunk) => {
        buffer += String(chunk);
        let at: number;
        while ((at = buffer.indexOf("\n")) >= 0) {
          const line = buffer.slice(0, at);
          buffer = buffer.slice(at + 1);
          const waiter = waiting.shift();
          if (waiter) waiter.resolve(line);
          else lines.push(line);
        }
      });
      const next = () => new Promise<string>((resolve, reject) => {
        if (failure) reject(failure);
        else if (lines.length) resolve(lines.shift()!);
        else waiting.push({ resolve, reject });
      });
      try {
        const opened = JSON.parse(await next()) as { ok?: unknown; denied?: Refusal };
        if (opened.denied) throw new Error(`${opened.denied.code}: ${opened.denied.message}`);
      } catch (error) { child.kill(); await exited; throw error; }
      let chain: Promise<unknown> = Promise.resolve();
      return {
        call(request) {
          if (closed || failure) return Promise.reject(failure ?? new Error("native device is closed"));
          const answer = chain.then(async () => {
            const encoded = `${JSON.stringify(request)}\n`;
            const line = next();
            void line.catch(() => {});
            try { child.stdin.write(encoded); }
            catch (error) { fail(error instanceof Error ? error : new Error(String(error))); throw error; }
            return JSON.parse(await line) as Record<string, unknown>;
          });
          chain = answer.catch(() => undefined);
          return answer;
        },
        close() {
          if (closing) return closing;
          closed = true;
          closing = (async () => { await chain; child.kill(); await exited; })();
          return closing;
        },
      };
    },
  };
}
