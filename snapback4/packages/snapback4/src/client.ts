// The online tier (LLP 2000.000 §7.4): no store, no interpreter. Reads go
// to the server and are `fresh` when it answered; an observed read re-runs
// when a commit touches its tables; a write is sent with a client-minted id
// and applies at most once, and waits as `pending` while the link is down.
// Every word a screen reads is on the card (contract.ts).

import { changeFeed } from "./changes.ts";
import type { Client, Cursor, Link, Mutation, Observed, Principal, Query, Read, Refusal, Write } from "./contract.ts";
import { logout, type Session } from "./auth.ts";
import { assetSource, fetchAsset, uploadAsset } from "./assets.ts";
import { act } from "./actions.ts";

export interface ClientOptions {
  /** The server, e.g. `http://127.0.0.1:4400`. */
  readonly url: string;
  /** A development persona (loopback only): `alice` acts as `dev:alice`. */
  readonly persona?: string;
  /** A session from `guest()`, `login()` or `signup()` (deployed servers). */
  readonly session?: Session;
  /** A bare bearer token, when the app keeps sessions itself. */
  readonly token?: string;
  readonly fetch?: typeof fetch;
  /** How long a change poll waits at the server, in seconds. */
  readonly waitSeconds?: number;
}

type ReadyRead<T> = Extract<Read<T>, { data: T }>;

interface Watch {
  op: Query<unknown, unknown>;
  args: unknown;
  key: string;
  tables: Set<string>;
  snapshot: Read<unknown>;
  lastServer: ReadyRead<unknown> | null;
  lastServerAt: number;
  subscribers: Set<() => void>;
  inFlight: boolean;
  dirty: boolean;
  expiryTimer: ReturnType<typeof setTimeout> | null;
}

const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

let lastMinted = 0;

/** A time-ordered 128-bit id: 48 bits of milliseconds, 80 bits of entropy,
 * 26 base32 digits. Ids minted by one process strictly increase: two in one
 * millisecond take successive milliseconds, so their order is the order
 * they were minted in, not the order of their entropy. */
export function mintId(now = Date.now()): string {
  now = Math.max(now, lastMinted + 1);
  lastMinted = now;
  const bytes = new Uint8Array(10);
  if (typeof crypto !== "undefined" && crypto.getRandomValues) crypto.getRandomValues(bytes);
  else for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  // 48 bits of milliseconds above 80 bits of entropy: the time leads, so
  // ids sort by the moment they were minted.
  let value = BigInt(now);
  for (const byte of bytes) value = (value << 8n) | BigInt(byte);
  let out = "";
  for (let i = 0; i < 26; i++) {
    out = ALPHABET[Number(value & 31n)] + out;
    value >>= 5n;
  }
  return out;
}

export function createClient(options: ClientOptions): Client {
  const doFetch = options.fetch ?? globalThis.fetch.bind(globalThis);
  const base = options.url.replace(/\/$/, "");
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (options.persona) headers["x-snapback-persona"] = options.persona;
  const token = options.session?.token ?? options.token;
  if (token) headers.authorization = `Bearer ${token}`;
  let viewer: Principal | null = options.persona ? (`dev:${options.persona}` as Principal) : options.session ? (options.session.principal as Principal) : null;
  let credentials = Boolean(viewer || token);
  let link: Link = credentials ? "online" : "signed-out";
  let closed = false;
  const aborter = new AbortController();
  const requests = new Set<Promise<unknown>>();
  let closing: Promise<void> | undefined;
  let seq = 0;
  const linkListeners = new Set<(link: Link) => void>();
  const viewerListeners = new Set<(viewer: Principal | null) => void>();
  const writeListeners = new Set<(write: Exclude<Write, { state: "pending" }>) => void>();
  const emitWrite = <T extends Exclude<Write, { state: "pending" }>>(write: T): T => {
    for (const listener of writeListeners) listener(write);
    return write;
  };
  const watches = new Map<string, Watch>();
  const pending: { id: string; op: Mutation<unknown, unknown>; args: unknown; resolve: (write: Write) => void }[] = [];
  let sending: (typeof pending)[number] | null = null;

  const failUnsentWrites = (why: Refusal) => {
    const unsent = pending.filter((entry) => entry !== sending);
    if (unsent.length === 0) return;
    const retained = sending ? [sending] : [];
    pending.splice(0, pending.length, ...retained);
    for (const entry of unsent) {
      const outcome = { state: "failed", id: entry.id, why } as const;
      entry.resolve(outcome);
      emitWrite(outcome);
    }
  };

  const endCredentials = () => {
    setViewer(null);
    credentials = false;
    delete headers.authorization;
    delete headers["x-snapback-persona"];
    setLink("signed-out");
  };

  const setLink = (next: Link) => {
    if (closed) return;
    if (link === next) return;
    link = next;
    for (const listener of linkListeners) listener(next);
    if (next === "online") {
      void flush();
      for (const watch of watches.values()) void refresh(watch);
    } else if (next === "signed-out") {
      failUnsentWrites(auth());
      for (const watch of watches.values()) {
        watch.lastServer = null;
        watch.snapshot = { denied: auth() };
        notify(watch);
      }
    } else {
      for (const watch of watches.values()) {
        if (watch.lastServer) {
          watch.snapshot = { ...watch.lastServer, fresh: false, since: watch.lastServerAt };
          notify(watch);
        }
      }
    }
  };

  const setViewer = (next: Principal | null) => {
    if (viewer === next) return;
    viewer = next;
    for (const listener of viewerListeners) listener(next);
  };

  const offline = (): Refusal => ({ code: "E_OFFLINE", family: "link", message: "the server is unreachable", retryable: true });
  const auth = (): Refusal => ({ code: "E_AUTH", family: "auth", message: "sign in to continue" });
  const ended = (): Refusal => ({ code: "E_CLOSED", family: "client", message: "this client is closed" });

  function post(path: string, body: unknown) {
    const request = sendPost(path, body);
    requests.add(request);
    void request.finally(() => requests.delete(request)).catch(() => {});
    return request;
  }

  async function sendPost(path: string, body: unknown): Promise<{ ok: true; json: Record<string, unknown> } | { ok: false }> {
    if (closed) return { ok: false };
    let encoded: string;
    try { encoded = JSON.stringify(body); }
    catch { return { ok: true, json: { denied: { code: "E_INPUT", family: "input", message: "request arguments must be JSON-serializable" } } }; }
    try {
      const response = await doFetch(`${base}${path}`, { method: "POST", headers, body: encoded, signal: aborter.signal });
      const json = (await response.json()) as Record<string, unknown>;
      if (closed) return { ok: false };
      if (response.status >= 500) { setLink("offline"); return { ok: false }; }
      if (((json.denied ?? json.why) as Refusal | undefined)?.code === "E_AUTH") {
        endCredentials();
      }
      else if (credentials && typeof json.viewer === "string") setViewer(json.viewer as Principal);
      if (link !== "online" && credentials) setLink("online");
      return { ok: true, json };
    } catch {
      if (credentials) setLink("offline");
      return { ok: false };
    }
  }

  async function runQuery<A, R>(op: Query<A, R>, args: A): Promise<{ read: Read<R>; tables: string[]; seq: number; nextExpiry: number | null }> {
    if (closed) return { read: { denied: ended() }, tables: [], seq, nextExpiry: null };
    if (!credentials || link === "signed-out") return { read: { denied: { code: "E_AUTH", family: "auth", message: "sign in to read" } }, tables: [], seq, nextExpiry: null };
    const result = await post(`/q/${op.name}`, { args });
    if (!credentials) return { read: { denied: auth() }, tables: [], seq, nextExpiry: null };
    if (!result.ok) return { read: { denied: offline() }, tables: [], seq, nextExpiry: null };
    const json = result.json;
    if (json.denied) return { read: { denied: json.denied as Refusal }, tables: (json.tables as string[] | undefined) ?? [], seq, nextExpiry: null };
    const at = Number(json.seq ?? 0);
    const next = (json.next as Cursor | null | undefined) ?? null;
    const nextExpiry = typeof json.nextExpiry === "number" && Number.isFinite(json.nextExpiry) ? json.nextExpiry : null;
    return { read: { data: json.data as R, complete: json.complete !== false, fresh: true, next }, tables: (json.tables as string[] | undefined) ?? [], seq: at, nextExpiry };
  }

  function notify(watch: Watch) {
    for (const subscriber of watch.subscribers) subscriber();
  }

  function scheduleExpiry(watch: Watch, nextExpiry: number | null) {
    if (watch.expiryTimer) clearTimeout(watch.expiryTimer);
    watch.expiryTimer = null;
    if (nextExpiry == null || closed) return;
    const delay = Math.min(Math.max(0, nextExpiry - Date.now()), 2_147_483_647);
    watch.expiryTimer = setTimeout(() => {
      watch.expiryTimer = null;
      if (watches.get(watch.key) === watch) void refresh(watch);
    }, delay);
    (watch.expiryTimer as { unref?: () => void }).unref?.();
  }

  async function refresh(watch: Watch) {
    if (closed) return;
    if (watch.inFlight) {
      watch.dirty = true;
      return;
    }
    watch.inFlight = true;
    try {
      const { read, tables, nextExpiry } = await runQuery(watch.op, watch.args);
      if (closed || watches.get(watch.key) !== watch) return;
      watch.tables = new Set(tables);
      if ("data" in read) {
        watch.lastServer = read;
        watch.lastServerAt = Date.now();
        watch.snapshot = read;
      } else if ("denied" in read && read.denied.code === "E_OFFLINE" && watch.lastServer) {
        watch.snapshot = { ...watch.lastServer, fresh: false, since: watch.lastServerAt };
      } else {
        watch.snapshot = read;
      }
      scheduleExpiry(watch, nextExpiry);
      notify(watch);
    } finally {
      watch.inFlight = false;
      const dirty = watch.dirty;
      watch.dirty = false;
      if (dirty && watches.get(watch.key) === watch) {
        void refresh(watch);
      }
    }
  }

  let polling = false;
  let generation: number | undefined;
  async function probe() {
    try {
      const response = await doFetch(`${base}/probe`, { headers, signal: aborter.signal });
      let json: Record<string, unknown> = {};
      try { json = (await response.json()) as Record<string, unknown>; } catch {}
      if (closed) return;
      if ((json.denied as Refusal | undefined)?.code === "E_AUTH") {
        endCredentials();
      } else if (response.status === 200 && json.ok === true && credentials) setLink("online");
    } catch {}
  }

  const changes = changeFeed(doFetch, base, aborter.signal, () => { if (!closed && credentials) setLink("offline"); }, () => { if (!closed && credentials && link === "offline") void probe(); });

  async function poll() {
    if (polling) return;
    polling = true;
    while (!closed && watches.size > 0) {
      if (link !== "online") {
        await new Promise((r) => setTimeout(r, 1000));
        if (!closed && credentials && link === "offline") await probe();
        continue;
      }
      try {
        const { response, json } = await changes(seq, options.waitSeconds ?? 25, headers);
        if (json.denied?.code === "E_AUTH") {
          endCredentials();
          break;
        }
        if (!response.ok || json.denied) throw new Error(`changes: HTTP ${response.status}`);
        const changedGeneration = generation !== undefined && json.generation !== undefined && generation !== json.generation;
        generation = json.generation;
        if (json.seq > seq || changedGeneration) {
          seq = Math.max(seq, json.seq);
          const touched = new Set(json.tables);
          for (const watch of watches.values()) {
            if (changedGeneration || watch.tables.size === 0 || [...watch.tables].some((t) => touched.has(t))) void refresh(watch);
          }
        }
      } catch {
        if (closed) break;
        if (credentials) setLink("offline");
        await new Promise((r) => setTimeout(r, 1000));
      }
    }
    polling = false;
  }

  async function send(entry: (typeof pending)[number]): Promise<boolean> {
    const result = await post(`/m/${entry.op.name}`, { id: entry.id, args: entry.args });
    if (!result.ok) return false;
    const json = result.json;
    if (((json.why ?? json.denied) as Refusal | undefined)?.retryable) return false;
    if (json.state === "sent") {
      const at = Number(json.seq ?? 0);
      const outcome = { state: "sent", id: entry.id, seq: at, ...(json.replayed === true ? { replayed: true } as const : { result: json.result }) } as const;
      entry.resolve(outcome);
      emitWrite(outcome);
      for (const watch of watches.values()) void refresh(watch);
    } else {
      // A 400 carries `denied` (an input or auth refusal), a judged write
      // carries `why`; neither is the link's fault.
      const why = (json.why ?? json.denied) as Refusal | undefined;
      if (!why) return false; // An unrecognized answer does not settle this id.
      const outcome = { state: "failed", id: entry.id, why } as const;
      entry.resolve(outcome);
      emitWrite(outcome);
    }
    return true;
  }

  let flushing: Promise<void> | null = null;
  let retry: ReturnType<typeof setTimeout> | undefined;
  let retryMs = 250;
  function flush(): Promise<void> {
    if (flushing) return flushing;
    if (retry) { clearTimeout(retry); retry = undefined; }
    const run = async () => {
      while (!closed && pending.length > 0 && link !== "signed-out") {
        const entry = pending[0]!;
        sending = entry;
        let sent: boolean;
        try { sent = await send(entry); }
        finally { sending = null; }
        if (!sent) {
          if (closed || !credentials) return;
          retry = setTimeout(() => { retry = undefined; void flush(); }, retryMs);
          (retry as { unref?: () => void }).unref?.();
          retryMs = Math.min(retryMs * 2, 5000);
          return;
        }
        retryMs = 250;
        pending.shift();
      }
    };
    const result = run();
    flushing = result;
    void result.finally(() => { if (flushing === result) flushing = null; }).catch(() => {});
    return result;
  }

  const client: Client = {
    act(op, args, options) {
      return act(op, args, options, options?.id ?? mintId(), post, () => closed ? ended() : !credentials || link === "signed-out" ? auth() : link !== "online" ? offline() : undefined);
    },
    async query(op, args) {
      return (await runQuery(op, args)).read;
    },
    observe<A, R>(op: Query<A, R>, args: A): Observed<R> {
      const key = `${op.name}:${JSON.stringify(args)}`;
      let watch = watches.get(key);
      if (!watch) {
        watch = { op: op as Query<unknown, unknown>, args, key, tables: new Set(), snapshot: { loading: true }, lastServer: null, lastServerAt: 0, subscribers: new Set(), inFlight: false, dirty: false, expiryTimer: null };
        watches.set(key, watch);
        void refresh(watch);
        void poll();
      }
      const own = watch;
      const mine = new Set<() => void>();
      return {
        getSnapshot: () => own.snapshot as Read<R>,
        subscribe(notifyMe) {
          mine.add(notifyMe);
          own.subscribers.add(notifyMe);
          // A screen that closed this key a moment ago (React unmounts the
          // old component before the new one subscribes) may have removed
          // the watch: put it back, and refresh it.
          if (watches.get(own.key) !== own) {
            watches.set(own.key, own);
            void refresh(own);
            void poll();
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
    async mutate<A, R>(op: Mutation<A, R>, args: A): Promise<Write<R>> {
      const id = mintId();
      if (closed) return emitWrite({ state: "failed", id, why: ended() });
      if (!credentials || link === "signed-out") return emitWrite({ state: "failed", id, why: { code: "E_AUTH", family: "auth", message: "sign in to write" } });
      let settle!: (write: Write) => void;
      const settled = new Promise<Write>((resolve) => { settle = resolve; });
      const entry = { id, op: op as Mutation<unknown, unknown>, args, resolve: settle };
      pending.push(entry);
      const attempt = flush();
      if (link !== "online") return { state: "pending", id };
      return Promise.race([settled, attempt.then((): Write => ({ state: "pending", id }))]) as Promise<Write<R>>;

    },
    async upload(bytes) {
      if (closed) return { ok: false, why: ended() };
      if (!credentials || link === "signed-out") return { ok: false, why: { code: "E_AUTH", family: "auth", message: "sign in to upload" } };
      const uploaded = await uploadAsset(base, headers, doFetch, bytes);
      if (!uploaded.ok && uploaded.why.code === "E_AUTH") endCredentials();
      if (!uploaded.ok && uploaded.why.code === "E_OFFLINE") setLink("offline");
      return uploaded;
    },
    async asset(id) {
      const read = await fetchAsset(base, headers, doFetch, id);
      if ("denied" in read && read.denied.code === "E_AUTH") endCredentials();
      return read;
    },
    assetSource: (id) => assetSource(base, headers, id),
    link: () => link,
    onLink(listener) {
      linkListeners.add(listener);
      return () => linkListeners.delete(listener);
    },
    viewer: () => viewer,
    onViewer(listener) {
      viewerListeners.add(listener);
      return () => viewerListeners.delete(listener);
    },
    onWrite(listener) {
      writeListeners.add(listener);
      return () => writeListeners.delete(listener);
    },
    async signOut() {
      const bearer = headers.authorization?.slice("Bearer ".length);
      endCredentials();
      // Close immediately so outstanding work cannot reuse the credentials.
      const closing = client.close();
      if (bearer) await logout(base, bearer, doFetch);
      await closing;
    },
    close() {
      if (closing) return closing;
      closed = true;
      aborter.abort();
      if (retry) clearTimeout(retry);
      for (const watch of watches.values()) if (watch.expiryTimer) clearTimeout(watch.expiryTimer);
      watches.clear();
      linkListeners.clear();
      viewerListeners.clear();
      for (const entry of pending) {
        const outcome = { state: "failed", id: entry.id, why: { ...ended(), message: `client closed before the outcome of write ${entry.id} was known` } } as const;
        entry.resolve(outcome);
        emitWrite(outcome);
      }
      writeListeners.clear();
      closing = Promise.allSettled([flushing, ...requests]).then(() => { pending.length = 0; });
      return closing;
    },
  };
  return client;
}
