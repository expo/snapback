import { ClosingResponses } from "./closing-responses.ts";
import { deferStart, trackRotation } from "./client-start.ts";
// The online tier (LLP 2000.000 §7.4): no store, no interpreter. Reads go
// to the server and are `fresh` when it answered; an observed read re-runs
// when a commit touches its tables; a write is sent with a client-minted id
// and applies at most once, and waits as `pending` while the link is down.
// Every word a screen reads is on the card (contract.ts).

import { ReadObservation } from "./read-observation.ts";
import { changeFeed } from "./changes.ts";
import { MutationIds, WriteHistory } from "./writes.ts";
import type { Client, Cursor, Link, MutateOptions, Mutation, Observed, Principal, Query, Read, ReadCut, ReadMeter, Refusal, Write } from "./contract.ts";
import { logout, logoutAll as revokeAllSessions, refreshSession as rotateSession, type Session, type SignIn } from "./auth.ts";
import { assetSource, fetchAsset, uploadAsset } from "./assets.ts";
import { act } from "./actions.ts";
import { waitForCaller } from "./request-wait.ts";
import { trackDispatch, type DispatchState } from "./online-dispatch.ts";

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
  /** Terminal store refusal; createApp uses this to reopen the online tier. */
  readonly onStoreChange?: (why: Refusal) => void;
}

interface Watch extends ReadObservation<unknown> {
  op: Query<unknown, unknown>;
  args: unknown;
  key: string;
  tables: Set<string>;
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
  const closingResponses = new ClosingResponses();
  let seq = 0;
  let minimumReadSeq = 0, queryEpoch = 0;
  let storeIdentity: string | undefined;
  const dispatch: DispatchState = {};
  let probed = false;
  let storeRefusal: Refusal | null = null;
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
  let stopRefresh!: (why: Refusal) => void;
  const refreshStopped = new Promise<SignIn>(resolve => {
    stopRefresh = why => resolve({ ok: false, why });
  });
  let refreshTimer: ReturnType<typeof setTimeout> | undefined;
  const refreshBeforeExpiry = 24 * 60 * 60 * 1000;

  const endCredentials = () => {
    if (!credentials) return;
    session = null;
    stopRefresh(auth());
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
    if (closed || storeRefusal || (!credentials && next !== "signed-out")) return;
    if (link === next) return;
    link = next;
    for (const listener of linkListeners) listener(next);
    if (next === "online") {
      void flush();
      for (const watch of watches.values()) void refresh(watch);
    } else if (next === "signed-out") {
      failUnsentWrites(auth());
      for (const watch of watches.values()) watch.publish({ denied: auth() });
      for (const watch of watches.values()) notify(watch);
    } else {
      for (const watch of watches.values()) {
        if ("data" in watch.snapshot) {
          watch.publish({ loading: true });
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

  function stopForStore(code: "E_STORE_REPLACED" | "E_STORE_RESTORE") {
    if (storeRefusal) return;
    storeRefusal = { code, family: "store", site: "client", guide: "sync",
      message: `${code === "E_STORE_REPLACED" ? "the backend store identity changed" : "the backend store sequence regressed"}; outstanding writes may have executed and their outcomes are unknown; this client will not retry them`,
      rewrite: "close this client and create a new client for the current backend; reconcile outstanding writes before submitting new intent" };
    queryEpoch++;
    // Terminal connectivity is observable without discarding the session that
    // createApp may validate on its replacement client.
    link = "signed-out";
    if (retry) { clearTimeout(retry); retry = undefined; }
    if (refreshTimer) clearTimeout(refreshTimer);
    aborter.abort();
    stopRefresh(storeRefusal);
    for (const watch of watches.values()) { watch.reset({ denied: storeRefusal }); scheduleExpiry(watch, null); }
    // Retire every owner, including the request currently awaiting its body.
    // A late receipt must not settle it a second time or schedule another send.
    for (const entry of pending.splice(0)) {
      const outcome = { state: "failed", id: entry.id, why: storeRefusal } as const;
      entry.resolve(outcome);
      emitWrite(outcome);
    }
    for (const watch of watches.values()) notify(watch);
    for (const listener of linkListeners) listener(link);
    options.onStoreChange?.(storeRefusal);
  }

  function observeStore(json: Record<string, unknown>, floorAtDispatch: number, receipt = false): void {
    if (storeRefusal) return;
    const why = (json.denied ?? json.why) as Refusal | undefined;
    if (why?.code === "E_STORE_REPLACED" || why?.code === "E_STORE_RESTORE") { stopForStore(why.code); return; }
    const id = json.store_id;
    if (typeof id !== "string" || !id) return; // Older servers have no identity envelope.
    if (storeIdentity !== undefined && id !== storeIdentity) { stopForStore("E_STORE_REPLACED"); return; }
    storeIdentity = id;
    if (dispatch.store !== id) { dispatch.store = id; dispatch.owner?.observe(id); }
    // Replayed receipts name a historical commit; their head is the current
    // store watermark. A buffered response may predate a later observed write,
    // so restoration compares with the floor at dispatch, not at delivery.
    const head = receipt && json.replayed === true ? json.head : json.head ?? json.seq;
    if (typeof head !== "number" || !Number.isSafeInteger(head) || head < 0) return;
    if (head < floorAtDispatch) { stopForStore("E_STORE_RESTORE"); return; }
    minimumReadSeq = Math.max(minimumReadSeq, head);
  }

  const scheduleRefresh = (retryAfter?: number) => {
    if (refreshTimer) clearTimeout(refreshTimer);
    refreshTimer = undefined;
    if (closed || storeRefusal || !credentials || !session || session.kind === "action") return;
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
    if (closed || storeRefusal) return Promise.resolve({ ok: false, why: storeRefusal ?? ended() });
    if (refreshing) return refreshing;
    const token = headers.authorization?.slice("Bearer ".length);
    if (!credentials || !token || options.persona) return Promise.resolve({ ok: false, why: { code: "E_AUTH", family: "auth", message: "sign in with a session to refresh it" } });
    const expectedPrincipal = viewer;
    credentialRevision += 1;
    const rotation = rotateSession(base, token, doFetch);
    let retired = false;
    const retire = (result: SignIn) => {
      if (retired || (!result.ok && (credentials || !result.why.retryable))) return;
      retired = true;
      // Only sign-out owns old-bearer cleanup after a transport rejection.
      // Store replacement keeps that bearer for createApp's recovery probe.
      void logout(base, result.ok ? result.session.token : token, doFetch);
    };
    // Never abort rotation: the server may already have consumed the old
    // token. Keep reading so a cancelled caller's successor can be revoked.
    void rotation.then(result => { if (storeRefusal || !credentials) retire(result); });
    const work = (async (): Promise<SignIn> => {
      const refreshed = await Promise.race([rotation, refreshStopped]);
      if (storeRefusal) { retire(refreshed); return { ok: false, why: storeRefusal }; }
      // An ordinary close still owns an in-flight rotation's replacement.
      // Sign-out separately ends credentials and cancels adoption.
      if (!credentials) { retire(refreshed); return { ok: false, why: auth() }; }
      credentialRevision += 1;
      if (!refreshed.ok) {
        if (refreshed.why.code === "E_AUTH") endCredentials();
        else if (refreshed.why.retryable) scheduleRefresh(60_000);
        return refreshed;
      }
      if (expectedPrincipal !== null && refreshed.session.principal !== expectedPrincipal) {
        retire(refreshed);
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
    void work.finally(() => { if (refreshing === work) refreshing = null; }).catch(() => {});
    return work;
  }

  // A rotation invalidates the old token. Its late refusal is not a refusal
  // of the replacement: retry at the new revision (writes keep their id).
  async function obsoleteRefusal(why: Refusal | undefined, revision: number): Promise<boolean> {
    if (why?.code !== "E_AUTH") return false;
    if (refreshing) await refreshing;
    if (storeRefusal || closed) return false;
    if (revision !== credentialRevision && credentials && !closed && !storeRefusal) return true;
    if (!closed) endCredentials();
    return false;
  }

  function post(path: string, body: unknown) {
    let arrived = false;
    const request = waitForCaller(sendPost(path, body, 0, known => { arrived = known; }), aborter.signal, () => arrived).then(result => {
      // A terminal store change owns outstanding effect outcomes: preserve its
      // explicit unknown-outcome refusal instead of an ordinary offline retry.
      if (storeRefusal && path.startsWith("/a/")) return { ok: true as const, json: { denied: storeRefusal } };
      return result ?? { ok: false as const };
    });
    requests.add(request);
    void request.finally(() => requests.delete(request)).catch(() => {});
    return request;
  }

  async function sendPost(path: string, body: unknown, attempt = 0, arrived = (_known: boolean) => {}): Promise<{ ok: true; json: Record<string, unknown> } | { ok: false }> {
    if (refreshing) await refreshing;
    if (closed || !credentials || storeRefusal) return { ok: false };
    const revision = credentialRevision;
    const floor = minimumReadSeq;
    let encoded: string;
    if (path.startsWith("/m/") && dispatch.owner) {
      // First dispatch after reopen must establish which store is at this URL.
      // A supplied store_id also fences a replacement after the probe.
      if (!storeIdentity && !probed) await probe();
      if ((!storeIdentity && !probed) || closed || storeRefusal || !credentials) return { ok: false };
      try {
        const known = await dispatch.owner.before((body as { id: string }).id, storeIdentity);
        if (known) return { ok: true, json: known as unknown as Record<string, unknown> };
      } catch { return { ok: false }; }
      if (closed || storeRefusal || !credentials) return { ok: false };
    }
    if ((path.startsWith("/m/") || path.startsWith("/a/")) && storeIdentity) body = { ...(body as object), store_id: storeIdentity };
    try { encoded = JSON.stringify(body); }
    catch { return { ok: true, json: { denied: { code: "E_INPUT", family: "input", message: "request arguments must be JSON-serializable" } } }; }
    try {
      const response = await doFetch(`${base}${path}`, { method: "POST", headers: { ...headers, ...(options.meter && path.startsWith("/q/") ? { "x-snapback-meter": "1" } : {}) }, body: encoded, ...(path.startsWith("/q/") ? { signal: aborter.signal } : {}) });
      const json = (await response.json()) as Record<string, unknown>;
      // Late bodies are consumed without adoption. A parsed effect response
      // already known at close still finishes its local settlement.
      closingResponses.capture(path, body, json, response.status);
      if (closed) return { ok: false };
      arrived(true);
      if (storeRefusal) return { ok: false };
      observeStore(json, floor, path.startsWith("/m/"));
      if (storeRefusal) return { ok: false };
      if (response.status >= 500) { setLink("offline"); return { ok: false }; }
      if (await obsoleteRefusal((json.denied ?? json.why) as Refusal | undefined, revision)) {
        arrived(false);
        if (attempt === 3) return { ok: false };
        await new Promise(resolve => setTimeout(resolve, 25 * 2 ** attempt));
        return sendPost(path, body, attempt + 1, arrived);
      }
      if (storeRefusal || (closed && !path.startsWith("/m/") && !path.startsWith("/a/"))) return { ok: false };
      if (credentials && typeof json.viewer === "string") setViewer(json.viewer as Principal);
      if (link !== "online" && credentials) setLink("online");
      return { ok: true, json };
    } catch {
      if (credentials) setLink("offline");
      return { ok: false };
    }
  }

  async function runQuery<A, R>(op: Query<A, R>, args: A): Promise<{ read: Read<R>; tables: string[]; seq: number; epoch: number; nextExpiry: number | null; transportOffline?: boolean }> {
    const epoch = queryEpoch;
    if (closed || storeRefusal) return { read: { denied: storeRefusal ?? ended() }, tables: [], seq: minimumReadSeq, epoch, nextExpiry: null };
    if (!credentials || link === "signed-out") return { read: { denied: { code: "E_AUTH", family: "auth", message: "sign in to read" } }, tables: [], seq: minimumReadSeq, epoch, nextExpiry: null };
    const result = await post(`/q/${op.name}`, { args });
    if (storeRefusal || closed) return { read: { denied: storeRefusal ?? ended() }, tables: [], seq: minimumReadSeq, epoch: queryEpoch, nextExpiry: null };
    if (!credentials) return { read: { denied: auth() }, tables: [], seq: minimumReadSeq, epoch, nextExpiry: null };
    if (!result.ok) return { read: { denied: offline() }, tables: [], seq: minimumReadSeq, epoch, nextExpiry: null, transportOffline: true };
    const json = result.json;
    if (json.denied) return { read: { denied: json.denied as Refusal }, tables: (json.tables as string[] | undefined) ?? [], seq: Number(json.seq ?? json.head ?? minimumReadSeq), epoch, nextExpiry: null };
    const at = Number(json.seq ?? 0);
    const nextExpiry = typeof json.nextExpiry === "number" && Number.isFinite(json.nextExpiry) ? json.nextExpiry : null;
    if (json.loading || !("data" in json)) return { read: { loading: true }, tables: (json.tables as string[] | undefined) ?? [], seq: Number(json.seq ?? json.head ?? minimumReadSeq), epoch, nextExpiry };
    const next = (json.next as Cursor | null | undefined) ?? null;
    const meter = json.meter ? { meter: json.meter as ReadMeter } : {};
    return { read: { data: json.data as R, complete: json.complete !== false, cut: (json.cut ?? null) as ReadCut, fresh: true, next, ...meter }, tables: (json.tables as string[] | undefined) ?? [], seq: at, epoch, nextExpiry };
  }

  const currentRead = (result: { seq: number; epoch: number }) => result.epoch === queryEpoch && result.seq >= minimumReadSeq;

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
    if (closed || storeRefusal) { watch.reset({ denied: storeRefusal ?? ended() }); notify(watch); return; }
    if (watch.inFlight) {
      watch.dirty = true;
      return;
    }
    watch.inFlight = true;
    let exhausted = false;
    try {
      const result = await watch.fetch(() => runQuery(watch.op, watch.args), () => notify(watch), { accept: currentRead });
      const { tables, nextExpiry, retryExhausted } = result;
      exhausted = retryExhausted === true;
      if (closed || watches.get(watch.key) !== watch) return;
      if (storeRefusal || !currentRead(result)) {
        watch.reset(storeRefusal ? { denied: storeRefusal } : { loading: true });
        scheduleExpiry(watch, null);
        notify(watch);
        return;
      }
      watch.tables = new Set(tables);
      scheduleExpiry(watch, exhausted ? null : nextExpiry);
    } finally {
      watch.inFlight = false;
      const dirty = watch.dirty;
      watch.dirty = false;
      if (dirty && !closed && !storeRefusal && !exhausted && watches.get(watch.key) === watch) {
        void refresh(watch);
      }
    }
  }

  let polling = false;
  let generation: number | undefined;
  let probing: Promise<void> | undefined;
  function probe(): Promise<void> {
    if (probing) return probing;
    const work = probeOnce();
    probing = work;
    void work.finally(() => { if (probing === work) probing = undefined; });
    return work;
  }
  async function probeOnce(attempt = 0) {
    if (refreshing) await refreshing;
    if (closed || !credentials || storeRefusal) return;
    const revision = credentialRevision;
    const floor = minimumReadSeq;
    try {
      const response = await doFetch(`${base}/probe`, { headers: { ...headers }, signal: aborter.signal });
      let json: Record<string, unknown> = {};
      try { json = (await response.json()) as Record<string, unknown>; } catch {}
      if (closed || storeRefusal) return;
      observeStore(json, floor);
      if (storeRefusal) return;
      if (await obsoleteRefusal(json.denied as Refusal | undefined, revision)) {
        if (attempt < 3) { await new Promise(resolve => setTimeout(resolve, 25 * 2 ** attempt)); await probeOnce(attempt + 1); }
        return;
      }
      if (response.status === 200 && json.ok === true && credentials) {
        probed = true;
        setLink("online");
      }
    } catch {}
  }

  const changes = changeFeed(doFetch, base, aborter.signal, () => { if (!closed && credentials) setLink("offline"); }, () => { if (!closed && credentials && link === "offline") void probe(); });

  async function poll() {
    if (polling) return;
    polling = true;
    while (!closed && !storeRefusal && watches.size > 0) {
      if (link !== "online") {
        await new Promise((r) => setTimeout(r, 1000));
        if (!closed && credentials && link === "offline") await probe();
        continue;
      }
      try {
        if (refreshing) await refreshing;
        if (closed || storeRefusal || !credentials) break;
        const revision = credentialRevision;
        const floor = minimumReadSeq;
        const { response, json } = await changes(seq, options.waitSeconds ?? 25, { ...headers }, storeIdentity);
        if (closed || storeRefusal) break;
        observeStore(json as unknown as Record<string, unknown>, floor);
        if (storeRefusal) break;
        if (await obsoleteRefusal(json.denied, revision)) continue;
        if (closed || storeRefusal || !credentials) break;
        if (!response.ok || json.denied) throw new Error(`changes: HTTP ${response.status}`);
        const changedGeneration = generation !== undefined && json.generation !== undefined && generation !== json.generation;
        generation = json.generation;
        minimumReadSeq = Math.max(minimumReadSeq, json.seq);
        if (changedGeneration) queryEpoch++;
        if (json.seq > seq || changedGeneration) {
          seq = Math.max(seq, json.seq);
          const touched = new Set(json.tables);
          if (changedGeneration) for (const watch of watches.values()) watch.reset({ loading: true });
          for (const watch of watches.values()) {
            if (changedGeneration) notify(watch);
            if (changedGeneration || watch.tables.size === 0 || [...watch.tables].some((t) => touched.has(t))) void refresh(watch);
          }
        }
      } catch {
        if (closed || storeRefusal) break;
        if (credentials) setLink("offline");
        await new Promise((r) => setTimeout(r, 1000));
      }
    }
    polling = false;
  }

  async function send(entry: (typeof pending)[number]): Promise<boolean> {
    const result = await post(`/m/${entry.op.name}`, { id: entry.id, args: entry.args });
    if (storeRefusal) return true;
    if (!result.ok) return false;
    const json = result.json;
    if (((json.why ?? json.denied) as Refusal | undefined)?.retryable) return false;
    if (json.state === "sent") {
      const at = Number(json.seq ?? 0);
      minimumReadSeq = Math.max(minimumReadSeq, at);
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
      while (!closed && !storeRefusal && pending.length > 0 && link !== "signed-out") {
        const entry = pending[0]!;
        sending = entry;
        let sent: boolean;
        try { sent = await send(entry); }
        finally { sending = null; }
        if (!sent) {
          if (closed || storeRefusal || !credentials) return;
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
      return act(op, args, options, options?.id ?? mintId(), post, () => storeRefusal ?? (closed ? ended() : !credentials || link === "signed-out" ? auth() : link !== "online" ? offline() : undefined), async id => { if (closed) { await closing; return storeRefusal ? { ok: true, json: { denied: storeRefusal } } : closingResponses.take(id); } });
    },
    async query(op, args) {
      const read = new ReadObservation<unknown>();
      const result = await read.fetch(() => runQuery(op, args), () => {}, { accept: currentRead });
      // A concurrent response or write can retire the accepted result before
      // this continuation runs. Do not start an additional retry round here.
      if (storeRefusal || closed) return { denied: storeRefusal ?? ended() };
      if (!credentials) return { denied: auth() };
      return currentRead(result) ? result.read : { loading: true };
    },
    observe<A, R>(op: Query<A, R>, args: A): Observed<R> {
      const key = `${op.name}:${JSON.stringify(args)}`;
      let watch = watches.get(key);
      if (!watch) {
        watch = Object.assign(new ReadObservation<unknown>(), { op: op as Query<unknown, unknown>, args, key, tables: new Set<string>(), subscribers: new Set<() => void>(), inFlight: false, dirty: false, expiryTimer: null });
        watches.set(key, watch);
        void refresh(watch);
        void poll();
      }
      const own = watch;
      const mine = new Set<() => void>();
      return {
        getSnapshot: () => own.read(storeRefusal ?? (closed ? ended() : !credentials ? auth() : null)) as Read<R>,
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
            if (watches.get(own.key) === own) watches.delete(own.key);
            own.reset({ loading: true });
            if (own.expiryTimer) clearTimeout(own.expiryTimer);
            own.expiryTimer = null;
          }
        },
      };
    },
    async mutate<A, R>(op: Mutation<A, R>, args: A, options?: MutateOptions): Promise<Write<R>> {
      const id = options?.id === undefined ? mintId() : options.id;
      if (closed || !credentials || link === "signed-out" || storeRefusal) {
        const failed = { state: "failed" as const, id, why: storeRefusal ?? (closed ? ended() : auth()) };
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
        const outcome = await Promise.race([settled, attempt.then((): Write => write)]) as Write<R>;
        if (outcome.state === "pending" && closed) { await closing; return closingResponses.write(outcome); }
        return outcome;
      });
    },
    async write(id) { const receipt = await history.read(id); return !closed && credentials ? receipt : undefined; },
    acquired: false,
    onAcquired: () => () => {},
    async upload(bytes) {
      if (storeRefusal || closed) return { ok: false, why: storeRefusal ?? ended() };
      if (refreshing) await refreshing;
      if (storeRefusal || closed) return { ok: false, why: storeRefusal ?? ended() };
      if (!credentials || link === "signed-out") return { ok: false, why: { code: "E_AUTH", family: "auth", message: "sign in to upload" } };
      const requestHeaders = { ...headers };
      const sameSession = () => !refreshing && requestHeaders.authorization === headers.authorization;
      const uploaded = await waitForCaller(uploadAsset(base, requestHeaders, doFetch, bytes,
        () => !storeRefusal && !closed && credentials && sameSession()), aborter.signal);
      // Uploads have no mutation id: an obsolete success cannot be replayed or
      // handed to another session. A stopped retry also returns this refusal.
      if (!uploaded || storeRefusal || closed || !credentials) return { ok: false, why: storeRefusal ?? (closed ? ended() : auth()) };
      if (!sameSession()) return { ok: false, why: { code: "E_AUTH", family: "auth", message: "the session changed during upload; start the upload again" } };
      if (!uploaded.ok && uploaded.why.code === "E_AUTH") endCredentials();
      if (!uploaded.ok && uploaded.why.code === "E_OFFLINE") setLink("offline");
      return uploaded;
    },
    async asset(id) {
      if (storeRefusal || closed) return { denied: storeRefusal ?? ended() };
      if (refreshing) await refreshing;
      if (storeRefusal || closed) return { denied: storeRefusal ?? ended() };
      if (!credentials) return { denied: auth() };
      const revision = credentialRevision;
      const read = await fetchAsset(base, { ...headers }, doFetch, id, undefined, aborter.signal);
      if (storeRefusal || closed || !credentials) {
        if ("url" in read) read.revoke();
        return { denied: storeRefusal ?? (closed ? ended() : auth()) };
      }
      // A successful reply is just as credential-bound as a refusal. Do not
      // publish bytes fetched under a bearer that rotated while it was away.
      if (revision !== credentialRevision) {
        if ("url" in read) read.revoke();
        return client.asset(id);
      }
      if ("denied" in read && await obsoleteRefusal(read.denied, revision)) return client.asset(id);
      if (storeRefusal || closed || !credentials) {
        if ("url" in read) read.revoke();
        return { denied: storeRefusal ?? (closed ? ended() : auth()) };
      }
      return read;
    },
    assetSource: (id) => storeRefusal || closed ? { uri: "", headers: {} } : assetSource(base, headers, id),
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
      if (storeRefusal || closed) return { ok: false, why: storeRefusal ?? ended() };
      if (refreshing) await refreshing;
      if (storeRefusal || closed) return { ok: false, why: storeRefusal ?? ended() };
      const bearer = headers.authorization?.slice("Bearer ".length);
      if (!credentials || !bearer) return { ok: false, why: { code: "E_AUTH", family: "auth", message: "sign in to revoke sessions" } };
      const revision = credentialRevision;
      const revoked = await waitForCaller(revokeAllSessions(base, bearer, doFetch), aborter.signal);
      if (!revoked || storeRefusal || closed) return { ok: false, why: storeRefusal ?? ended() };
      if (revoked.ok) {
        endCredentials();
        await client.close();
      } else {
        if (await obsoleteRefusal(revoked.why, revision)) return client.logoutAll();
        if (storeRefusal || closed) return { ok: false, why: storeRefusal ?? ended() };
        if (!credentials) await client.close();
      }
      return revoked;
    },
    async signOut() {
      const bearer = headers.authorization?.slice("Bearer ".length);
      endCredentials();
      // refreshCurrent owns revocation of any late, unkept successor.
      // Close immediately so outstanding work cannot reuse the credentials.
      const closing = client.close();
      if (bearer) void logout(base, bearer, doFetch);
      await closing;
    },
    close() {
      if (closing) return closing;
      closed = true;
      closingResponses.begin();
      aborter.abort();
      if (retry) clearTimeout(retry);
      if (refreshTimer) clearTimeout(refreshTimer);
      for (const watch of watches.values()) if (watch.expiryTimer) clearTimeout(watch.expiryTimer);
      for (const watch of watches.values()) watch.publish({ denied: storeRefusal ?? ended() });
      for (const watch of watches.values()) notify(watch);
      watches.clear();
      linkListeners.clear();
      viewerListeners.clear();
      for (const entry of pending) {
        // The request already dispatched may have committed. Its send owns
        // settlement; cancellation without a receipt leaves the id pending.
        if (entry === sending) continue;
        const outcome = { state: "pending", id: entry.id } as const;
        entry.resolve(outcome);
        history.remember(outcome);
      }
      writeListeners.clear();
      closing = Promise.allSettled([flushing, refreshing, ...requests]).then(() => { pending.length = 0; sessionListeners.clear(); closingResponses.finish(); });
      return closing;
    },
  };
  trackDispatch(client, dispatch);
  const start = () => {
    if (closed) return;
    if (session && session.kind !== "action" && session.expiresAt - Date.now() <= refreshBeforeExpiry) void refreshCurrent();
    else scheduleRefresh();
  };
  trackRotation(client, () => refreshing);
  if (!deferStart(options, start)) start();
  return client;
}
