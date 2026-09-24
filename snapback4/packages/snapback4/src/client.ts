import { deferStart } from "./client-start.ts";
// The online tier (LLP 2000.000 §7.4): no store, no interpreter. Reads go
// to the server and are `fresh` when it answered; an observed read re-runs
// when a commit touches its tables; a write is sent with a client-minted id
// and applies at most once, and waits as `pending` while the link is down.
// Every word a screen reads is on the card (contract.ts).

import { changeFeed } from "./changes.ts";
import { MutationIds, WriteHistory } from "./writes.ts";
import type { Client, Cursor, Link, MutateOptions, Mutation, Observed, Principal, Query, Read, ReadCut, ReadMeter, Refusal, Write } from "./contract.ts";
import { logout, logoutAll as revokeAllSessions, refreshSession as rotateSession, type Session, type SignIn } from "./auth.ts";
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
  /** Explicitly request engine work; loopback dev includes it by default and serve never returns it. */
  readonly meter?: boolean;
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

let lastMintedAt = -1;
let lastMintedEntropy: Uint8Array | undefined;

function freshEntropy(): Uint8Array {
  const bytes = new Uint8Array(10);
  if (globalThis.crypto?.getRandomValues) globalThis.crypto.getRandomValues(bytes);
  // Not every supported host provides Web Crypto. Keep the existing fallback
  // until clients have an injectable synchronous RNG. This fallback does not
  // meet the secure-entropy requirement; ids must never be capabilities.
  else for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  return bytes;
}

function incrementEntropy(bytes: Uint8Array): void {
  for (let i = bytes.length - 1; i >= 0; i--) {
    if (bytes[i] === 255) continue;
    bytes[i] = bytes[i]! + 1;
    bytes.fill(0, i + 1);
    return;
  }
  throw new Error("mintId: exhausted 80-bit entropy within one millisecond");
}

/** A time-ordered 128-bit id: 48 bits of milliseconds, 80 bits of entropy,
 * 26 base32 digits. Ids minted by one process strictly increase. A burst in
 * one millisecond increments the entropy field, preserving the real time
 * encoded in the id; a clock rollback continues that logical millisecond. */
export function mintId(now = Date.now()): string {
  if (!Number.isSafeInteger(now) || now < 0 || now > 0xffff_ffff_ffff) throw new RangeError("mintId: time must be an integer from 0 through 2^48-1 milliseconds");
  if (now > lastMintedAt) {
    const entropy = freshEntropy();
    lastMintedAt = now;
    lastMintedEntropy = entropy;
  } else {
    incrementEntropy(lastMintedEntropy!);
    now = lastMintedAt;
  }
  const bytes = lastMintedEntropy!;
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
  let session = options.persona ? null : options.session ?? null;
  const token = options.persona ? undefined : session?.token ?? options.token;
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
  const sessionListeners = new Set<(session: Session | null) => void>();
  const viewerListeners = new Set<(viewer: Principal | null) => void>();
  const history = new WriteHistory();
  const mutationIds = new MutationIds();
  const writeListeners = new Set<(write: Exclude<Write, { state: "pending" }>) => void>();
  const emitWrite = <T extends Exclude<Write, { state: "pending" }>>(write: T): T => {
    history.remember(write);
    mutationIds.finish(write.id);
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

  let credentialRevision = 0;
  let refreshing: Promise<SignIn> | null = null;
  let rotatingSession: Promise<SignIn> | null = null;
  let stopRefresh!: () => void;
  const refreshStopped = new Promise<SignIn>(resolve => {
    stopRefresh = () => resolve({ ok: false, why: { code: "E_AUTH", family: "auth", message: "sign in to continue" } });
  });
  let refreshTimer: ReturnType<typeof setTimeout> | undefined;
  const refreshBeforeExpiry = 24 * 60 * 60 * 1000;

  const endCredentials = () => {
    if (!credentials) return;
    session = null;
    stopRefresh();
    credentialRevision += 1;
    if (refreshTimer) clearTimeout(refreshTimer);
    credentials = false;
    delete headers.authorization;
    delete headers["x-snapback-persona"];
    setViewer(null);
    setLink("signed-out");
    for (const listener of [...sessionListeners]) listener(null);
  };

  const setLink = (next: Link) => {
    if (closed || (!credentials && next !== "signed-out")) return;
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

  const scheduleRefresh = (retryAfter?: number) => {
    if (refreshTimer) clearTimeout(refreshTimer);
    refreshTimer = undefined;
    if (closed || !credentials || !session || session.kind === "action") return;
    const untilDue = Math.max(0, session.expiresAt - Date.now() - refreshBeforeExpiry);
    const requested = retryAfter ?? (untilDue === 0 ? 60_000 : untilDue);
    const delay = Math.min(Math.max(1, requested), 2_147_000_000);
    refreshTimer = setTimeout(() => {
      refreshTimer = undefined;
      if (requested > delay) scheduleRefresh();
      else void refreshCurrent().catch(() => scheduleRefresh(60_000));
    }, delay);
    (refreshTimer as { unref?: () => void }).unref?.();
  };

  // @ref LLP 3000#7 — both client tiers keep short-lived sessions and rotate the bearer before expiry.
  function refreshCurrent(): Promise<SignIn> {
    if (closed) return Promise.resolve({ ok: false, why: ended() });
    if (refreshing) return refreshing;
    const token = headers.authorization?.slice("Bearer ".length);
    if (!credentials || !token || options.persona) return Promise.resolve({ ok: false, why: { code: "E_AUTH", family: "auth", message: "sign in with a session to refresh it" } });
    const expectedPrincipal = viewer;
    credentialRevision += 1;
    const rotation = rotateSession(base, token, doFetch);
    rotatingSession = rotation;
    const work = (async (): Promise<SignIn> => {
      const refreshed = await Promise.race([rotation, refreshStopped]);
      // An ordinary close still owns an in-flight rotation's replacement.
      // Sign-out separately ends credentials and cancels adoption.
      if (!credentials) return { ok: false, why: auth() };
      credentialRevision += 1;
      if (!refreshed.ok) {
        if (refreshed.why.code === "E_AUTH") endCredentials();
        else if (refreshed.why.retryable) scheduleRefresh(60_000);
        return refreshed;
      }
      if (expectedPrincipal !== null && refreshed.session.principal !== expectedPrincipal) {
        endCredentials();
        return { ok: false, why: { code: "E_AUTH", family: "auth", message: "a refreshed session changed principal" } };
      }
      session = refreshed.session;
      headers.authorization = `Bearer ${session.token}`;
      setViewer(session.principal as Principal);
      for (const listener of [...sessionListeners]) listener(session);
      if (!closed) {
        setLink("online");
        for (const watch of watches.values()) void refresh(watch);
        scheduleRefresh();
      }
      return refreshed;
    })();
    refreshing = work;
    void work.finally(() => { if (refreshing === work) refreshing = null; if (rotatingSession === rotation) rotatingSession = null; }).catch(() => {});
    return work;
  }

  // A rotation invalidates the old token. Its late refusal is not a refusal
  // of the replacement: retry at the new revision (writes keep their id).
  async function obsoleteRefusal(why: Refusal | undefined, revision: number): Promise<boolean> {
    if (why?.code !== "E_AUTH") return false;
    if (refreshing) await refreshing;
    if (revision !== credentialRevision && credentials && !closed) return true;
    if (!closed) endCredentials();
    return false;
  }

  function post(path: string, body: unknown) {
    const request = sendPost(path, body);
    requests.add(request);
    void request.finally(() => requests.delete(request)).catch(() => {});
    return request;
  }

  async function sendPost(path: string, body: unknown): Promise<{ ok: true; json: Record<string, unknown> } | { ok: false }> {
    if (refreshing) await refreshing;
    if (closed || !credentials) return { ok: false };
    const revision = credentialRevision;
    let encoded: string;
    try { encoded = JSON.stringify(body); }
    catch { return { ok: true, json: { denied: { code: "E_INPUT", family: "input", message: "request arguments must be JSON-serializable" } } }; }
    try {
      const response = await doFetch(`${base}${path}`, { method: "POST", headers: { ...headers, ...(options.meter && path.startsWith("/q/") ? { "x-snapback-meter": "1" } : {}) }, body: encoded, signal: aborter.signal });
      const json = (await response.json()) as Record<string, unknown>;
      if (closed) return { ok: false };
      if (response.status >= 500) { setLink("offline"); return { ok: false }; }
      if (await obsoleteRefusal((json.denied ?? json.why) as Refusal | undefined, revision)) return sendPost(path, body);
      if (credentials && typeof json.viewer === "string") setViewer(json.viewer as Principal);
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
    const meter = json.meter ? { meter: json.meter as ReadMeter } : {};
    return { read: { data: json.data as R, complete: json.complete !== false, cut: (json.cut ?? null) as ReadCut, fresh: true, next, ...meter }, tables: (json.tables as string[] | undefined) ?? [], seq: at, nextExpiry };
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
      if (!credentials) {
        watch.snapshot = { denied: auth() };
        notify(watch);
        return;
      }
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
    if (refreshing) await refreshing;
    if (closed || !credentials) return;
    const revision = credentialRevision;
    try {
      const response = await doFetch(`${base}/probe`, { headers: { ...headers }, signal: aborter.signal });
      let json: Record<string, unknown> = {};
      try { json = (await response.json()) as Record<string, unknown>; } catch {}
      if (closed) return;
      if (await obsoleteRefusal(json.denied as Refusal | undefined, revision)) { await probe(); return; }
      if (response.status === 200 && json.ok === true && credentials) setLink("online");
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
        if (refreshing) await refreshing;
        if (closed || !credentials) break;
        const revision = credentialRevision;
        const { response, json } = await changes(seq, options.waitSeconds ?? 25, { ...headers });
        if (closed) break;
        if (await obsoleteRefusal(json.denied, revision)) continue;
        if (!credentials) break;
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
      const outcome = json.replayed === true
        ? { state: "sent", id: entry.id, seq: at, replayed: true } as const
        : { state: "sent", id: entry.id, seq: at, result: json.result } as const;
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
    async mutate<A, R>(op: Mutation<A, R>, args: A, options?: MutateOptions): Promise<Write<R>> {
      const id = options?.id === undefined ? mintId() : options.id;
      if (closed || !credentials || link === "signed-out") {
        const failed = { state: "failed" as const, id, why: closed ? ended() : { code: "E_AUTH", family: "auth", message: "sign in to write" } };
        return mutationIds.knows(id) ? failed : emitWrite(failed);
      }
      return mutationIds.run<R>(id, op.name, args, () => client.write(id), async (args, write) => {
        let settle!: (write: Write) => void;
        const settled = new Promise<Write>((resolve) => { settle = resolve; });
        const entry = { id, op: op as Mutation<unknown, unknown>, args, resolve: settle };
        pending.push(entry);
        history.remember(write);
        const attempt = flush();
        if (link !== "online") return write;
        return Promise.race([settled, attempt.then((): Write => write)]) as Promise<Write<R>>;
      });
    },
    async write(id) { const receipt = await history.read(id); return !closed && credentials ? receipt : undefined; },
    acquired: false,
    onAcquired: () => () => {},
    async upload(bytes) {
      if (refreshing) await refreshing;
      if (closed) return { ok: false, why: ended() };
      if (!credentials || link === "signed-out") return { ok: false, why: { code: "E_AUTH", family: "auth", message: "sign in to upload" } };
      const revision = credentialRevision;
      const uploaded = await uploadAsset(base, { ...headers }, doFetch, bytes);
      if (!uploaded.ok && await obsoleteRefusal(uploaded.why, revision)) return client.upload(bytes);
      if (!uploaded.ok && uploaded.why.code === "E_OFFLINE") setLink("offline");
      return uploaded;
    },
    async asset(id) {
      if (refreshing) await refreshing;
      if (closed) return { denied: ended() };
      if (!credentials) return { denied: auth() };
      const revision = credentialRevision;
      const read = await fetchAsset(base, { ...headers }, doFetch, id);
      if (closed || !credentials) {
        if ("url" in read) read.revoke();
        return { denied: closed ? ended() : auth() };
      }
      // A successful reply is just as credential-bound as a refusal. Do not
      // publish bytes fetched under a bearer that rotated while it was away.
      if (revision !== credentialRevision) {
        if ("url" in read) read.revoke();
        return client.asset(id);
      }
      if ("denied" in read && await obsoleteRefusal(read.denied, revision)) return client.asset(id);
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
    session: () => session,
    onSession(listener) {
      sessionListeners.add(listener);
      return () => sessionListeners.delete(listener);
    },
    refreshSession: refreshCurrent,
    async logoutAll() {
      if (refreshing) await refreshing;
      if (closed) return { ok: false, why: ended() };
      const bearer = headers.authorization?.slice("Bearer ".length);
      if (!credentials || !bearer) return { ok: false, why: { code: "E_AUTH", family: "auth", message: "sign in to revoke sessions" } };
      const revision = credentialRevision;
      const revoked = await revokeAllSessions(base, bearer, doFetch);
      if (revoked.ok) {
        endCredentials();
        await client.close();
      } else {
        if (await obsoleteRefusal(revoked.why, revision)) return client.logoutAll();
        if (!credentials) await client.close();
      }
      return revoked;
    },
    async signOut() {
      const bearer = headers.authorization?.slice("Bearer ".length);
      const rotation = rotatingSession;
      endCredentials();
      // A committed rotation may still deliver its successor. Revoke it without
      // adopting it or letting a stalled response delay local sign-out.
      if (rotation) void rotation.then(result => {
        if (result.ok && result.session.token !== bearer) return logout(base, result.session.token, doFetch);
      }).catch(() => {});
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
      if (refreshTimer) clearTimeout(refreshTimer);
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
      closing = Promise.allSettled([flushing, refreshing, ...requests]).then(() => { pending.length = 0; sessionListeners.clear(); });
      return closing;
    },
  };
  const start = () => {
    if (closed) return;
    if (session && session.kind !== "action" && session.expiresAt - Date.now() <= refreshBeforeExpiry) void refreshCurrent();
    else scheduleRefresh();
  };
  if (!deferStart(options, start)) start();
  return client;
}
