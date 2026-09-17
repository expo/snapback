// The local-first tier (LLP 3000 §7, one implementation): the device is
// the Rust module — the partition in its own store, the stream applied,
// the outbox kept, queries and predictions answered — and this client is
// what remains: the session, the link, the transport, and the observation
// of reads. Every word a screen reads is still the card. The module is
// reached through one JSON call (`DeviceCore`), so the wasm device on the
// web (`snapback4/web`), the Expo module (`snapback4-expo`) and the
// `snapback4 device` process for Node (`snapback4/native`) all fit.

import { MutationIds, WriteHistory } from "./writes.ts";
import { changeFeed } from "./changes.ts";
import { exitTransport, type PendingSend } from "./local-exit.ts";
import type { Client, Cursor, Link, MutateOptions, Mutation, Observed, Principal, Query, Read, ReadCut, Refusal, Write } from "./contract.ts";
import { MediaCache, type MediaStorage, type AssetRetention } from "./local-assets.ts";
export type { MediaStorage, AssetRetention } from "./local-assets.ts";
import { mintId } from "./client.ts";
import { operationTables, type BackendJson, type ProgramJson, type SchemaJson } from "./backend.ts";
import { assetSource, fetchAsset, uploadAsset } from "./assets.ts";
import { act } from "./actions.ts";
import {
  defaultSessionStore,
  forgetSession,
  guest,
  keepSession,
  logout,
  logoutAll as revokeAllSessions,
  refreshSession as rotateSession,
  restoreSession,
  type Session,
  type SessionStore,
  type SignIn,
} from "./auth.ts";

/** One JSON call into the device: `{ op, ... }` in, `{ ok } | { denied }` out. */
export interface DeviceCore {
  readonly media?: MediaStorage;
  /** Web recovery may acquire an orphan outbox without a backend change. */
  onOutbox?(listener: () => void): () => void;
  /** Web hosts alone: committed unsent writes at pagehide/hidden, synchronously. */
  onSuspend?(flush: (entries: readonly PendingSend[], beginSend: () => boolean) => void): () => void;
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
   * `snapback4-expo`, `processDevice({ dir })` in Node. */
  readonly device: DeviceOpener;
  readonly waitSeconds?: number;
  /** Ordinary viewed media only; default is no retained bytes. */
  readonly assets?: AssetRetention;
}

export type LocalClient = Client & {
  sync(): Promise<void>;
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
  incarnation: number;
}

interface Queued {
  id: string;
  seq: number;
  op: string;
  args: unknown;
  new_ids: string[];
  predicted: string[];
  predictable?: boolean;
  replay_candidate?: boolean;
  sent_seq?: number | null;
  observed_seq?: number | null;
  viewer?: string;
  now?: number;
}

interface StoreCapture {
  backend_required?: boolean;
  store_id?: string | null;
  watermark: number;
  send_revision: number;
  restore_refusal?: Refusal;
}

const PAGE = 4000;
const REFRESH_BEFORE_EXPIRY_MS = 24 * 60 * 60 * 1000;

function responsePageTooLarge(denied: Refusal): boolean {
  return denied.code === "E_BOUND"
    && denied.family === "bound"
    && denied.message.startsWith("the HTTP JSON response exceeds 16 MiB;")
    && denied.message.includes("smaller page");
}

class BackendAuthError extends Error {
  constructor(readonly denied: Refusal) {
    super(`${denied.code}: ${denied.message}`);
  }
}

async function requireSyncProtocol(core: DeviceCore): Promise<void> {
  // A JavaScript update can run inside an older Expo development build.
  // Probe without sending or changing an outbox entry, even when offline.
  const reply = await core.call({ op: "sync_state" });
  const denied = reply?.denied as Refusal | undefined;
  if (denied && typeof denied.code === "string" && denied.code !== "E_OP") throw new Error(`createLocalClient: ${denied.code}: native startup failed: ${denied.message}`);
  const state = reply?.ok as Record<string, unknown> | undefined;
  const uint = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
  if (denied || !state || typeof state.backend_required !== "boolean" || typeof state.acquired !== "boolean" || !(state.store_id === null || typeof state.store_id === "string") || !uint(state.watermark) || !uint(state.generation) || !uint(state.send_revision) || !Array.isArray(state.pending_ids) || state.pending_ids.length > 256 || !state.pending_ids.every((id) => typeof id === "string" && id.length > 0)) {
    throw new Error("createLocalClient: E_DEVICE_VERSION: the device lacks the sync receipt protocol this client speaks. Update the device to match the client: rebuild the app's native binary for snapback4-expo (reloading JavaScript does not update a native module), or serve the wasm this package version ships.");
  }
}

export async function createLocalClient(options: LocalOptions): Promise<LocalClient> {
  const retention = options.assets ?? { keep: "none", maxBytes: 0 };
  if (!["none", "viewed"].includes(retention.keep) || !Number.isSafeInteger(retention.maxBytes) || retention.maxBytes < 0) throw new Error("assets needs keep: viewed | none and a nonnegative maxBytes");
  const doFetch = options.fetch ?? globalThis.fetch.bind(globalThis);
  const base = options.url.replace(/\/$/, "");
  const headers: Record<string, string> = { "content-type": "application/json" };
  const sessions = options.sessionStore ?? defaultSessionStore;
  let session: Session | null = null;
  if (options.persona) headers["x-snapback-persona"] = options.persona;
  else {
    session = options.session ?? await restoreSession(base, sessions);
    if (session && (!Number.isFinite(session.expiresAt) || session.expiresAt <= Date.now())) {
      session = null;
      await forgetSession(base, sessions);
    }
    if (!session && options.guest) {
      const signedIn = await guest(base, doFetch);
      if (!signedIn.ok) throw new Error(`createLocalClient: ${signedIn.why.code}: ${signedIn.why.message}`);
      session = signedIn.session;
    }
    if (!session) throw new Error(`createLocalClient: no session for ${base}; pass one from guest(), login() or signup(), or say guest: true`);
    if (session.kind !== "action" && session.expiresAt - Date.now() <= REFRESH_BEFORE_EXPIRY_MS) {
      const refreshed = await rotateSession(base, session.token, doFetch);
      if (refreshed.ok) {
        if (refreshed.session.principal !== session.principal) {
          await forgetSession(base, sessions);
          throw new Error("createLocalClient: E_AUTH: a refreshed session changed principal");
        }
        session = refreshed.session;
      } else if (refreshed.why.code === "E_AUTH") {
        await forgetSession(base, sessions);
        throw new Error(`createLocalClient: ${refreshed.why.code}: ${refreshed.why.message}`);
      }
    }
    await keepSession(base, session, sessions);
    headers.authorization = `Bearer ${session.token}`;
  }
  const viewer: Principal = (options.persona ? `dev:${options.persona}` : session!.principal) as Principal;
  const principal: string = viewer;
  let sessionDead = false;
  let credentialRevision = 0;
  let rotating = false;
  const sessionListeners = new Set<(session: Session | null) => void>();
  const viewerListeners = new Set<(viewer: Principal | null) => void>();
  const writeListeners = new Set<(write: Exclude<Write, { state: "pending" }>) => void>();
  let history!: WriteHistory;
  const mutationIds = new MutationIds();
  let setLink!: (next: Link) => void;
  const emitWrite = <T extends Exclude<Write, { state: "pending" }>>(write: T): T => {
    mutationIds.finish(write.id);
    if (history.firstEmission(write.id)) {
      for (const listener of writeListeners) listener(write);
    }
    return write;
  };
  const emitLocalFailure = (write: Extract<Write, { state: "failed" }>) => emitWrite(history.remember(write));
  const requestCredentials = () => ({ headers: { ...headers }, revision: credentialRevision });

  // The device opens on the backend the server sends, or on the one it
  // kept when the server is unreachable: a device that has synced once
  // starts offline on what it holds. One store per server and viewer.
  const storeName = `snapback4-${encodeURIComponent(`${base}:${viewer}`)}`;
  let link: Link = "online";
  let generation = 0;
  let backend: BackendJson | null = null;
  try {
    backend = await loadBackend(doFetch, base, requestCredentials().headers);
  } catch (error) {
    if (error instanceof BackendAuthError) {
      await forgetSession(base, sessions);
      throw new Error(`createLocalClient: ${error.denied.code}: ${error.denied.message}`);
    }
    link = "offline";
  }
  const active = new Set<Promise<unknown>>();
  let closed = false;
  let closing: Promise<void> | undefined;
  const aborter = new AbortController();
  const core = await options.device.open(storeName, backend);
  let stopSuspend: (() => void) | undefined;
  let stopOutbox: (() => void) | undefined;
  let media: MediaCache | undefined;
  try {
  history = new WriteHistory({
    read: async () => (await call({ op: "meta", key: "write-history" })).ok as string | null,
    save: async value => {
      const reply = await call({ op: "keep_write", value });
      if (reply.denied) throw new Error(`${reply.denied.code}: ${reply.denied.message}`);
    },
  });
  await requireSyncProtocol(core);
  if (backend) generation = Number(backend.generation ?? 0);
  else {
    const state = await call({ op: "state" });
    generation = Number((state.ok as { generation?: number } | undefined)?.generation ?? 0);
  }
  if (!backend) backend = (await call({ op: "backend" })).ok as BackendJson;
  media = new MediaCache(core, principal, retention);
  await media.open();
  // The app's native module (LLP 3000.005 §9): fetched once per digest and
  // installed on the device, which keeps it; offline, the device answers
  // native reads with the module it kept, or says it has none.
  let nativeReady = false;
  let nativeInstall: { generation: number; promise: Promise<boolean> } | null = null;
  const installNativeAttempt = async (signal?: AbortSignal): Promise<boolean> => {
    const state = await call({ op: "state" });
    if (state.denied) return false;
    const have = state.ok as { native?: string | null } | undefined;
    let wanted = backend?.native?.digest;
    if (!wanted) {
      if (!backend?.programs.some((program) => program.native)) return true;
      // A backend restored by the device predates the server-only native
      // descriptor. Its loaded cache is usable; a rejected cache is repaired
      // from `/schema` once the link returns.
      if (typeof have?.native === "string" && have.native.length > 0) return true;
      if (link !== "online") return false;
      try {
        const refreshed = await loadBackend(doFetch, base, requestCredentials().headers, signal);
        if (Number(refreshed.generation ?? 0) !== generation) return false;
        backend = refreshed;
        wanted = refreshed.native?.digest;
      } catch {
        return false;
      }
    }
    if (!wanted) return false;
    if (have?.native === wanted) return true;
    const targetGeneration = generation;
    try {
      const request = requestCredentials();
      const response = await doFetch(`${base}/native.wasm`, { headers: request.headers, ...(signal ? { signal } : {}) });
      if (!response.ok) return false;
      const bytes = new Uint8Array(await response.arrayBuffer());
      let hex = "";
      for (const byte of bytes) hex += byte.toString(16).padStart(2, "0");
      const installed = await call({ op: "install_native", wasm: hex, digest: wanted, generation: targetGeneration });
      return !installed.denied && !closed && generation === targetGeneration && backend?.native?.digest === wanted;
    } catch {
      return false;
    }
  };
  const installNative = (signal?: AbortSignal): Promise<boolean> => {
    if (nativeInstall?.generation === generation) return nativeInstall.promise;
    const attempt = installNativeAttempt(signal);
    const installing = { generation, promise: attempt };
    nativeInstall = installing;
    void attempt.finally(() => { if (nativeInstall === installing) nativeInstall = null; }).catch(() => {});
    return attempt;
  };
  nativeReady = await installNative();
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
  const serverAnswers = new Map<string, { read: Extract<Read<unknown>, { data: unknown }>; at: number; tables: Set<string> }>();
  const settled = new Map<string, (write: Write) => void>();
  let lastSyncAt = Number((await call({ op: "meta", key: "syncedAt" })).ok ?? 0);
  let caughtUp = false;
  let identityChecked = false;
  let partitionCurrent = true;
  const initialSync = (await call({ op: "sync_state" })).ok as { store_id?: string | null; restore_refusal?: Refusal };
  let storeIdentity = initialSync?.store_id ?? undefined;
  partitionDenied = initialSync?.restore_refusal ?? null;
  let incarnation = 0;
  let acquired = false;
  const acquiredListeners = new Set<(value: boolean) => void>();
  function setAcquired(value: boolean) {
    if (acquired === value) return;
    acquired = value;
    for (const listener of acquiredListeners) listener(value);
  }
  // @ref LLP 3000.007#18.2 — acquisition belongs to the current store; a reconnect alone cannot bless an old partition.
  async function refreshAcquired() {
    const revision = incarnation;
    const state = (await call({ op: "sync_state" })).ok as { acquired: boolean } | undefined;
    if (revision === incarnation) setAcquired(!closed && !sessionDead && partitionCurrent && state?.acquired === true);
  }
  await refreshAcquired();
  // A kept sent entry can disappear on the first catch-up, before a screen mounts.
  for (const entry of await queued()) {
    const seq = entry.sent_seq ?? entry.observed_seq;
    if (entry.sent_seq == null && seq != null) await history.keep({ state: "sent", id: entry.id, seq, replayed: true });
  }
  // @ref LLP 3000.007#18.2 — observation fences answers before queued sync can retire the partition.
  function observeIncarnation(id?: string, force = false) {
    if (!force && (id === undefined || id === storeIdentity)) return;
    storeIdentity = id;
    incarnation++;
    partitionCurrent = false;
    setAcquired(false);
    caughtUp = false;
    lastSyncAt = 0;
    serverAnswers.clear();
    for (const watch of watches.values()) {
      watch.snapshot = { loading: true };
      watch.incarnation = incarnation;
      if (watch.expiryTimer) clearTimeout(watch.expiryTimer);
      watch.expiryTimer = null;
      notify(watch);
      void rerun(watch);
    }
  }

  function refuseRestore(denied?: Refusal) {
    if (denied?.code !== "E_STORE_RESTORE") return;
    partitionDenied = denied;
    observeIncarnation(storeIdentity, true);
    for (const watch of watches.values()) { watch.snapshot = { denied }; notify(watch); }
  }

  // @ref LLP 3000.007#18.2 — /probe and /changes report the committed head: a same-identity head below the acquisition captured before the request is a restore, whatever later writes do to the head.
  async function witnessRestore(storeId: unknown, head: unknown, capture: StoreCapture): Promise<boolean> {
    if (typeof storeId !== "string" || storeId !== storeIdentity || !(Number(head) < capture.watermark)) return false;
    const observed = await call({ op: "observe_store", page: { snapshot: false, generation, events: [], watermark: Number(head), more: false, store_id: storeId,
      requested_watermark: capture.watermark, captured_watermark: capture.watermark, send_revision: capture.send_revision } });
    if (observed.denied) refuseRestore(observed.denied);
    return partitionDenied?.code === "E_STORE_RESTORE";
  }

  async function captureStore(): Promise<StoreCapture | undefined> {
    const reply = await call({ op: "sync_state" });
    if (reply.denied) return;
    const capture = reply.ok as StoreCapture;
    if (capture.restore_refusal) { refuseRestore(capture.restore_refusal); return; }
    return capture;
  }

  async function call(request: Record<string, unknown>): Promise<{ ok?: unknown; denied?: Refusal }> {
    const work = core.call(request);
    active.add(work);
    try {
      const result = (await work) as { ok?: unknown; denied?: Refusal };
      if (!result.denied && ["apply", "observe_store", "adopt", "clear_rows", "admit", "settle"].includes(String(request.op))) await media?.reconcile();
      return result;
    }
    finally { active.delete(work); }
  }

  const offline = (): Refusal => ({ code: "E_OFFLINE", family: "link", message: "the server is unreachable", retryable: true });
  const unavailable = (): Refusal | null => closed ? { code: "E_CLOSED", family: "client", message: "this client is closed" } : sessionDead ? { code: "E_AUTH", family: "auth", message: "sign in to continue" } : null;

  setLink = (next: Link) => {
    if (closed || (sessionDead && next !== "signed-out")) return;
    if (link === next) return;
    link = next;
    if (next !== "online") {
      identityChecked = false;
      for (const watch of watches.values()) if ("data" in watch.snapshot && watch.snapshot.fresh) {
        watch.snapshot = { ...watch.snapshot, fresh: false, ...(lastSyncAt ? { since: lastSyncAt } : {}) };
        notify(watch);
      }
    }
    for (const listener of linkListeners) listener(next);
    if (next === "online") void flush();
    for (const watch of watches.values()) void rerun(watch);
  };

  let refreshTimer: ReturnType<typeof setTimeout> | undefined;
  let refreshing: Promise<SignIn> | null = null;

  const endSession = async () => {
    if (sessionDead) return;
    sessionDead = true;
    setAcquired(false);
    session = null;
    rotating = false;
    credentialRevision += 1;
    if (refreshTimer) { clearTimeout(refreshTimer); refreshTimer = undefined; }
    delete headers.authorization;
    delete headers["x-snapback-persona"];
    setLink("signed-out");
    try { await media?.clear(); }
    finally {
      try { await forgetSession(base, sessions); }
      finally {
        for (const listener of [...sessionListeners]) listener(null);
        for (const listener of [...viewerListeners]) listener(null);
      }
    }
  };

  const refusedSession = async (denied: unknown, revision: number) => {
    if (!sessionDead && !rotating && revision === credentialRevision && (denied as Refusal | undefined)?.code === "E_AUTH") await endSession();
  };

  const scheduleRefresh = (retryAfter?: number) => {
    if (refreshTimer) clearTimeout(refreshTimer);
    refreshTimer = undefined;
    if (closed || sessionDead || options.persona || !session || session.kind === "action") return;
    const untilDue = Math.max(0, session.expiresAt - Date.now() - REFRESH_BEFORE_EXPIRY_MS);
    const requested = retryAfter ?? (untilDue === 0 ? 60_000 : untilDue);
    const delay = Math.min(Math.max(1, requested), 2_147_000_000);
    refreshTimer = setTimeout(() => {
      refreshTimer = undefined;
      if (requested > delay) scheduleRefresh();
      else void refreshCurrent().catch(() => scheduleRefresh(60_000));
    }, delay);
    (refreshTimer as { unref?: () => void }).unref?.();
  };

  const refreshCurrent = (): Promise<SignIn> => {
    if (refreshing) return refreshing;
    if (closed) return Promise.resolve({ ok: false, why: { code: "E_CLOSED", family: "client", message: "this client is closed" } });
    if (sessionDead || !session || options.persona) return Promise.resolve({ ok: false, why: { code: "E_AUTH", family: "auth", message: "sign in with a session to refresh it" } });
    const token = session.token;
    const expectedPrincipal = session.principal;
    rotating = true;
    credentialRevision += 1;
    const work = (async (): Promise<SignIn> => {
      const refreshed = await rotateSession(base, token, doFetch);
      if (!refreshed.ok) {
        rotating = false;
        credentialRevision += 1;
        if (refreshed.why.code === "E_AUTH" && session?.token === token) await endSession();
        else if (refreshed.why.retryable) scheduleRefresh(60_000);
        return refreshed;
      }
      if (refreshed.session.principal !== expectedPrincipal) {
        const why: Refusal = { code: "E_AUTH", family: "auth", message: "a refreshed session changed principal" };
        rotating = false;
        credentialRevision += 1;
        await endSession();
        return { ok: false, why };
      }
      session = refreshed.session;
      headers.authorization = `Bearer ${session.token}`;
      credentialRevision += 1;
      const refreshedRevision = credentialRevision;
      let persistenceError: unknown;
      try { await keepSession(base, session, sessions); }
      catch (error) { persistenceError = error; }
      rotating = false;
      if (!closed) {
        for (const listener of [...sessionListeners]) listener(session);
        setLink("online");
        // A successful rotation makes the replacement bearer authoritative.
        // Let an older sync drain, then run one round at this credential
        // revision before reporting refresh completion.
        const priorSync = syncing;
        if (priorSync) try { await priorSync; } catch {}
        if (!closed && !sessionDead && credentialRevision === refreshedRevision) {
          try { await syncOnce(); } catch {}
          if (!closed && !sessionDead && credentialRevision === refreshedRevision && link === "online") {
            for (const watch of watches.values()) void rerun(watch);
          }
        }
      }
      scheduleRefresh();
      if (persistenceError) throw persistenceError;
      return refreshed;
    })();
    refreshing = work;
    void work.finally(() => {
      rotating = false;
      if (refreshing === work) refreshing = null;
    }).catch(() => {});
    return work;
  };

  async function post(path: string, body: unknown): Promise<{ ok: true; json: Record<string, unknown>; obsoleteAuth: boolean } | { ok: false }> {
    if (closed || sessionDead) return { ok: false };
    try {
      const request = requestCredentials();
      const response = await doFetch(`${base}${path}`, { method: "POST", headers: request.headers, body: JSON.stringify(body), signal: aborter.signal });
      const json = (await response.json()) as Record<string, unknown>;
      if (closed) return { ok: false };
      if (response.status >= 500) { setLink("offline"); return { ok: false }; }
      const denied = (json.denied ?? json.why) as Refusal | undefined;
      const obsoleteAuth = denied?.code === "E_AUTH" && (request.revision !== credentialRevision || rotating);
      await refusedSession(denied, request.revision);
      if (link !== "online") setLink("online");
      return { ok: true, json, obsoleteAuth };
    } catch {
      setLink("offline");
      return { ok: false };
    }
  }

  // ----- the stream -----

  let syncing: Promise<boolean> | null = null;
  function syncOnce(): Promise<boolean> {
    if (partitionDenied?.code === "E_STORE_RESTORE") return Promise.resolve(false);
    if (syncing) return syncing;
    const result = network(syncRound);
    syncing = result;
    void result.finally(() => { if (syncing === result) syncing = null; }).catch(() => {});
    return result;
  }
  async function syncRound(): Promise<boolean> {
    caughtUp = false;
    if (closed || sessionDead || partitionDenied?.code === "E_STORE_RESTORE") return false;
    const state = (await call({ op: "state" })).ok as { watermark: number; generation: number } | undefined;
    let watermark = state?.watermark ?? 0;
    const touched = new Set<string>();
    let adoptedGeneration = false;
    let after: string | undefined;
    let catchingUp = false;
    let pageLimit = PAGE;
    try {
      for (let pages = 0; pages < 100_000; pages++) {
        let page: Record<string, unknown>;
        let pageRevision = credentialRevision;
        let requestedStore: string | null | undefined;
        let backendRequired = false;
        const pageIncarnation = incarnation;
        try {
          const captured = await call({ op: "sync_state" });
          if (captured.denied) return false;
          const { pending_ids: pending, send_revision, store_id, watermark: capturedWatermark, backend_required, restore_refusal } = captured.ok as { pending_ids: string[]; send_revision: number; store_id?: string | null; watermark: number; backend_required?: boolean; restore_refusal?: Refusal };
          if (restore_refusal) { refuseRestore(restore_refusal); return false; }
          backendRequired = !!backend_required;
          requestedStore = store_id;
          const request = requestCredentials();
          const response = await doFetch(`${base}/sync`, { method: "POST", headers: request.headers, body: JSON.stringify({ from: watermark, limit: pageLimit, after: after ?? null, stream: catchingUp, pending, ...(store_id ? { store_id } : {}) }), signal: aborter.signal });
          if (response.status >= 500) { setLink("offline"); return false; }
          page = (await response.json()) as Record<string, unknown>;
          if (!response.ok && !page.denied) { setLink("offline"); return false; }
          page.send_revision = send_revision;
          page.requested_watermark = watermark;
          page.captured_watermark = capturedWatermark;
          pageRevision = request.revision;
        } catch {
          setLink("offline");
          return false;
        }
        if (closed) return false;
        if (page.denied) {
          const denied = page.denied as Refusal;
          if (pageIncarnation !== incarnation || pageRevision !== credentialRevision) return false;
          if (responsePageTooLarge(denied) && pageLimit > 1) {
            // Retry this exact stream position with a smaller page. Keep the
            // reduced limit for the round so every following wide page fits.
            pageLimit = Math.max(1, Math.floor(pageLimit / 2));
            continue;
          }
          await refusedSession(page.denied, pageRevision);
          if (!denied.retryable) {
            if (!partitionDenied) console.error(`snapback4: the server refused the partition: ${denied.code}: ${denied.message}`);
            partitionDenied = denied;
            for (const watch of watches.values()) void rerun(watch);
          }
          return false;
        }
        if (pageIncarnation !== incarnation || pageRevision !== credentialRevision) return false;
        // @ref LLP 3000.007#18.2 — sync identity retires the old partition before any read or outbox replay.
        let replacedStore = false;
        if (typeof page.store_id === "string") observeIncarnation(page.store_id);
        if ((typeof page.store_id === "string" && page.store_id !== requestedStore) || Number(page.watermark) < watermark) {
          for (const entry of await queued()) {
            const seq = entry.sent_seq ?? entry.observed_seq;
            if (entry.sent_seq == null && seq != null) await history.keep({ state: "sent", id: entry.id, seq, replayed: true });
          }
          const observed = await call({ op: "observe_store", page });
          if (observed.denied) { refuseRestore(observed.denied); return false; }
          const observation = observed.ok as { reset: boolean; backend_required?: boolean; send_revision: number; retired: Record<string, number> };
          page.send_revision = observation.send_revision;
          backendRequired = !!observation.backend_required;
          if (observation.reset) {
            if (typeof page.store_id !== "string") observeIncarnation(undefined, true);
            page.captured_watermark = 0;
            serverAnswers.clear();
            lastSyncAt = 0;
            await call({ op: "set_meta", key: "syncedAt", value: "0" });
            adoptedGeneration = true;
            for (const [id, sentSeq] of Object.entries(observation.retired)) {
              const receipt: Write = { state: "sent", id: id as Write["id"], seq: sentSeq, replayed: true };
              settled.get(id)?.(receipt); settled.delete(id);
              emitWrite(receipt);
            }
            for (const watch of watches.values()) void rerun(watch);
            watermark = 0; seq = 0; after = undefined; catchingUp = false;
            replacedStore = true;
          }
        }
        if (typeof page.store_id === "string") storeIdentity = page.store_id;
        if (link !== "online") setLink("online");
        partitionDenied = null;
        const pageGeneration = Number(page.generation ?? generation);
        if (pageGeneration !== generation || replacedStore || backendRequired) {
          // Generation counters restart with a new store. Reload the backend
          // even when its number matches, then acquire its current partition.
          let backendRevision = credentialRevision;
          const backendIncarnation = incarnation;
          try {
            const request = requestCredentials();
            backendRevision = request.revision;
            const nextBackend = await loadBackend(doFetch, base, request.headers, aborter.signal);
            if (closed || backendIncarnation !== incarnation) return false;
            const adopted = await call({ op: "adopt", backend: nextBackend, store_id: page.store_id ?? requestedStore ?? null, send_revision: page.send_revision });
            await refreshAcquired();
            if (adopted.denied) return false;
            backend = nextBackend;
            generation = Number(nextBackend.generation ?? pageGeneration);
            nativeReady = false;
            adoptedGeneration = true;
            nativeReady = await installNative(aborter.signal);
          } catch (error) {
            if (error instanceof BackendAuthError) await refusedSession(error.denied, backendRevision);
            return false;
          }
          watermark = 0; after = undefined; catchingUp = false; continue;
        }
        if (Number(page.watermark) < watermark || (catchingUp && page.snapshot) || (page.snapshot && page.more && !page.next)) return false;
        page.stage_snapshot = !!page.snapshot;
        page.snapshot_catchup = catchingUp;
        const applyingIncarnation = incarnation;
        const applied = await call({ op: "apply", page, first: !catchingUp && after === undefined });
        if (closed || applyingIncarnation !== incarnation) return false;
        if (applied.denied) { refuseRestore(applied.denied); return false; }
        for (const table of ((applied.ok as { touched?: string[] } | undefined)?.touched ?? [])) touched.add(table);
        if (page.snapshot && page.more && page.next) {
          after = page.next as string;
          continue;
        }
        after = undefined;
        watermark = Number(page.watermark ?? watermark);
        if (page.snapshot) { catchingUp = true; continue; }
        if (!page.more) {
          partitionCurrent = true;
          caughtUp = true;
          identityChecked = true;
          break;
        }
      }
      if (!caughtUp) return false;
      await refreshAcquired();
      seq = watermark;
      lastSyncAt = Date.now();
      await call({ op: "set_meta", key: "syncedAt", value: String(lastSyncAt) });
      return true;
    } finally {
      if (!closed && adoptedGeneration) {
        for (const watch of watches.values()) void rerun(watch);
      } else if (!closed && touched.size > 0) {
        for (const watch of watches.values()) if (watch.tables.size === 0 || [...watch.tables].some((t) => touched.has(t))) void rerun(watch);
      } else if (!closed && caughtUp && identityChecked) {
        for (const watch of watches.values()) {
          if (serverRun(watch.op)) { void rerun(watch); continue; }
          if (watch.incarnation !== incarnation || !("data" in watch.snapshot) || watch.snapshot.fresh) continue;
          const { since: _, ...read } = watch.snapshot;
          watch.snapshot = { ...read, fresh: true };
          notify(watch);
        }
      }
    }
  }

  async function probe(): Promise<void> {
    try {
      const request = requestCredentials();
      const probeIncarnation = incarnation;
      const capture = await captureStore();
      if (!capture) return;
      const response = await doFetch(`${base}/probe`, { headers: request.headers, signal: aborter.signal });
      let json: Record<string, unknown> = {};
      try { json = (await response.json()) as Record<string, unknown>; } catch {}
      if (closed) return;
      await refusedSession(json.denied ?? json.why, request.revision);
      if (response.status === 200 && json.ok === true && !sessionDead && probeIncarnation === incarnation) {
        // @ref LLP 3000.007#18.2 — verify identity before reconnect can bless cached local answers or resume a long poll.
        if (await witnessRestore(json.store_id, json.seq, capture)) return;
        if (typeof json.store_id === "string") observeIncarnation(json.store_id, json.store_id === storeIdentity && Number(json.seq) < Math.max(seq, capture.watermark));
        identityChecked = true;
        setLink("online");
      } else if (response.status !== 200 || json.ok !== true) setLink("offline");
    } catch { setLink("offline"); }
  }

  const changes = changeFeed(doFetch, base, aborter.signal, () => setLink("offline"), () => { if (!closed && !sessionDead && link === "offline") void network(probe); });

  async function waitForChange(): Promise<boolean> {
    if (link !== "online") {
      await new Promise((r) => setTimeout(r, 1000));
      if (!closed && !sessionDead) await probe();
      return false;
    }
    if (!identityChecked) { await probe(); return !caughtUp; }
    try {
      const request = requestCredentials();
      const changeIncarnation = incarnation;
      const capture = await captureStore();
      if (!capture) return false;
      const { response, json } = await changes(seq, options.waitSeconds ?? 25, request.headers, storeIdentity);
      if (!response.ok || json.denied) {
        await refusedSession(json.denied, request.revision);
        if (json.denied?.code === "E_AUTH") return false;
        throw new Error(`changes: HTTP ${response.status}`);
      }
      if (closed || changeIncarnation !== incarnation) return false;
      const replaced = json.store_id !== undefined && json.store_id !== storeIdentity;
      if (!replaced && await witnessRestore(json.store_id, json.seq, capture)) return false;
      const shrank = json.seq < Math.max(seq, capture.watermark);
      if (replaced || shrank) observeIncarnation(json.store_id, shrank);
      const changed = replaced || shrank || json.seq > seq || (json.generation !== undefined && json.generation !== generation);
      if (changed) {
        seq = Math.max(seq, json.seq);
        const touched = new Set(json.tables ?? []);
        for (const watch of watches.values()) {
          if (serverRun(watch.op) && (watch.tables.size === 0 || [...watch.tables].some((table) => touched.has(table)))) void rerun(watch);
        }
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
      while (!closed && !sessionDead && partitionDenied?.code !== "E_STORE_RESTORE") {
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

  // @ref LLP 3000.007#6.5 — route from compiled facts; keep server answers only in this client's memory.
  function serverRun(op: Query<unknown, unknown>): boolean {
    const program = backend?.programs.find((program) => program.name === op.name);
    if (program?.native) return !nativeReady;
    return (backend?.schema.operations?.[op.name]?.runs ?? program?.runs ?? op.runs) === "server";
  }

  function runLocal<R>(op: Query<unknown, R>, args: unknown) {
    const work = (async () => {
      while (true) {
        const revision = incarnation;
        const result = await evaluateLocal(op, args, revision);
        if (revision === incarnation || closed) return { ...result, incarnation: revision };
      }
    })();
    active.add(work);
    void work.finally(() => active.delete(work)).catch(() => {});
    return work;
  }

  async function evaluateLocal<R>(op: Query<unknown, R>, args: unknown, revision: number): Promise<{ read: Read<R>; tables: Set<string>; nextExpiry: number | null }> {
    const refused = unavailable();
    if (refused) return { read: { denied: refused }, tables: new Set(), nextExpiry: null };
    const schema = backend!.schema;
    const program = backend!.programs.find((p) => p.name === op.name);
    const tables = program && schema ? operationTables(program, schema) : new Set<string>();
    if (partitionDenied) return { read: { denied: partitionDenied }, tables, nextExpiry: null };
    const held = schema.operations?.[op.name]?.held ?? program?.held ?? op.held ?? false;
    const key = `${op.name}:${JSON.stringify(args)}`;
    const remembered = () => {
      const last = serverAnswers.get(key);
      if (last) for (const table of last.tables) tables.add(table);
      return { read: last ? { ...last.read, fresh: false, since: last.at } as Read<R> : { denied: offline() } as Read<R>, tables, nextExpiry: null };
    };
    const server = async () => {
      // A held query must not turn missing local coverage into a server scan, even during reset.
      if (held) return { read: { denied: offline() } as Read<R>, tables, nextExpiry: null };
      while (true) {
        const result = await post(`/q/${op.name}`, { args });
        if (revision !== incarnation) return { read: { loading: true } as Read<R>, tables, nextExpiry: null };
        if (sessionDead) return { read: { denied: { code: "E_AUTH", family: "auth", message: "sign in to read" } } as Read<R>, tables, nextExpiry: null };
        if (!result.ok) return remembered();
        if (result.obsoleteAuth) {
          const rotation = refreshing;
          if (rotation) try { await rotation; } catch {}
          const unavailableWhy = unavailable();
          if (unavailableWhy) return { read: { denied: unavailableWhy } as Read<R>, tables, nextExpiry: null };
          continue;
        }
        const json = result.json;
        for (const table of (json.tables as string[] | undefined) ?? []) tables.add(table);
        if (json.denied) { serverAnswers.delete(key); return { read: { denied: json.denied as Refusal } as Read<R>, tables, nextExpiry: null }; }
        const next = (json.next as Cursor | null | undefined) ?? null;
        const nextExpiry = typeof json.nextExpiry === "number" && Number.isFinite(json.nextExpiry) ? json.nextExpiry : null;
        const read = { data: json.data as R, complete: json.complete !== false, cut: (json.cut ?? null) as ReadCut, fresh: true, next };
        serverAnswers.set(key, { read, at: Date.now(), tables: new Set(tables) });
        return { read, tables, nextExpiry };
      }
    };
    // A rerun started by observation must not read the old partition while
    // its reset is still queued behind a send. Current server reads are safe.
    if (!partitionCurrent) return link === "online" ? server() : { read: { denied: offline() }, tables, nextExpiry: null };
    if (program?.native && !nativeReady) {
      if (link === "online") nativeReady = await installNative(aborter.signal);
      if (!nativeReady) return link === "online" ? server() : remembered();
    }
    if (!held && serverRun(op)) return link === "online" ? server() : remembered();
    const answer = await call({ op: "query", name: op.name, viewer: principal, args, now: Date.now() });
    const unavailableWhy = unavailable();
    if (unavailableWhy) return { read: { denied: unavailableWhy }, tables, nextExpiry: null };
    if (answer.denied) return { read: { denied: answer.denied }, tables, nextExpiry: null };
    const outcome = answer.ok as { denied?: Refusal; data?: unknown; complete?: boolean; cut?: ReadCut; next?: string | null; tables?: string[]; unknown?: boolean; retained?: boolean; nextExpiry?: number | null };
    for (const table of outcome.tables ?? []) tables.add(table);
    // @ref LLP 3000.007#18.2 — a left group answers from delivered rows, online and offline, including watch reruns.
    if (outcome.denied) return !held && outcome.unknown && !outcome.retained ? link === "online" ? server() : { read: { denied: offline() }, tables, nextExpiry: null } : { read: { denied: outcome.denied }, tables, nextExpiry: null };
    if (!held && !outcome.retained && outcome.complete === false && link === "online" && !(await queued()).some((e) => e.observed_seq == null && (e.predictable ?? e.predicted.length > 0))) return server();
    const fresh = link === "online" && caughtUp && identityChecked;
    const nextExpiry = typeof outcome.nextExpiry === "number" && Number.isFinite(outcome.nextExpiry) ? outcome.nextExpiry : null;
    return { read: { data: outcome.data as R, complete: outcome.complete !== false, cut: outcome.cut ?? null, fresh, next: (outcome.next as Cursor | null | undefined) ?? null, ...(fresh || !lastSyncAt ? {} : { since: lastSyncAt }) }, tables, nextExpiry };
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
      const { read, tables, nextExpiry, incarnation: revision } = await runLocal(watch.op, watch.args);
      if (revision !== incarnation) { watch.dirty = true; return; }
      if (closed || watches.get(watch.key) !== watch) return;
      watch.incarnation = revision;
      watch.tables = tables;
      watch.snapshot = read;
      scheduleExpiry(watch, nextExpiry);
      notify(watch);
    } finally {
      watch.running = false;
      const dirty = watch.dirty;
      watch.dirty = false;
      if (dirty && watches.get(watch.key) === watch) {
        void rerun(watch);
      }
    }
  }

  // ----- the outbox -----

  async function queued(): Promise<Queued[]> {
    const answer = await call({ op: "queued" });
    if (answer.denied) throw new Error(`${answer.denied.code}: ${answer.denied.message}`);
    const entries = (answer.ok as Queued[] | undefined) ?? [];
    for (const entry of entries) mutationIds.remember(entry.id, entry.op, entry.args);
    history.retainEmissions(entries.map(entry => entry.id));
    return entries;
  }

  let retry: ReturnType<typeof setTimeout> | undefined;
  let retryMs = 250;
  let flushing: Promise<void> | null = null;
  let exitDone: Promise<void> | undefined;
  let ordinarySending: string | undefined;
  let flushAgain = false;
  function flush(): Promise<void> {
    if (partitionDenied?.code === "E_STORE_RESTORE") return Promise.resolve();
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
    if (closed || sessionDead || retry || partitionDenied?.code === "E_STORE_RESTORE") return;
    retry = setTimeout(() => { retry = undefined; void flush(); }, retryMs);
    (retry as { unref?: () => void }).unref?.();
    retryMs = Math.min(5000, retryMs * 2);
  }

  async function flushOnce(acquire = true) {
    await exitDone;
    if (closed) return;
    for (const entry of await queued()) {
      await exitDone;
      if (closed) return;
      if (entry.sent_seq != null || (!acquire && entry.observed_seq != null)) {
        const receipt = { state: "sent" as const, id: entry.id, seq: entry.sent_seq ?? entry.observed_seq!, replayed: true as const };
        const known = await history.read(entry.id);
        // A sent outbox entry already persisted its receipt before settlement;
        // re-reading it must not refresh an evicted receipt. Emission is per
        // client: another owner's durable receipt is still this client's first
        // completion, and the emitted set suppresses a repeat.
        if (entry.sent_seq == null && !known) await history.keep(receipt);
        settled.get(entry.id)?.(receipt); settled.delete(entry.id);
        emitWrite(receipt);
        if (acquire) await syncOnce();
        continue;
      }
      try {
        const result = await network(async () => {
          await exitDone;
          if (closed || sessionDead) return { ok: false as const };
          if (!(await queued()).some((current) => current.id === entry.id && current.sent_seq == null)) return { ok: true as const, retired: true as const };
          ordinarySending = entry.id;
          try {
            const started = await call({ op: "begin_send" });
            if (started.denied) return { ok: false as const };
            const response = await post(`/m/${entry.op}`, { id: entry.id, args: entry.args, newIds: entry.new_ids });
            if (response.ok) {
              const json = response.json, why = (json.why ?? json.denied) as Refusal | undefined;
              if (!response.obsoleteAuth && !why?.retryable && (json.state === "sent" || why)) {
                await history.keep(json.state === "sent"
                  ? { state: "sent", id: entry.id, seq: Number(json.seq ?? 0), replayed: true }
                  : { state: "failed", id: entry.id, why: why! });
                const applied = await call({ op: "settle", id: entry.id, ...(json.state === "sent" ? { seq: Number(json.seq ?? 0) } : {}) });
                if (applied.denied) return { ok: false as const };
              }
            }
            return response;
          } finally { ordinarySending = undefined; }
        });
        if (closed) return;
        if (!result.ok) { retryFlush(); return; }
        if ("retired" in result) continue;
        const json = result.json;
        const why = (json.why ?? json.denied) as Refusal | undefined;
        if (result.obsoleteAuth || why?.retryable || (json.state !== "sent" && !why)) { retryFlush(); return; }
        retryMs = 250;
        const settle = settled.get(entry.id);
        settled.delete(entry.id);
        const outcome: Write = json.state === "sent"
          ? json.replayed === true
            ? { state: "sent", id: entry.id, seq: Number(json.seq ?? 0), replayed: true }
            : { state: "sent", id: entry.id, seq: Number(json.seq ?? 0), result: json.result }
          : { state: "failed", id: entry.id, why: (json.why as Refusal | undefined) ?? (json.denied as Refusal | undefined) ?? { code: "E_STORE", family: "store", message: "the server answered without a state", retryable: true } };
        if (outcome.state === "sent") { if (acquire) await syncOnce(); }
        else rerunTables(predictedTables(entry.predicted));
        settle?.(outcome);
        emitWrite(outcome);
      } catch { retryFlush(); return; }
    }
  }

  // @ref LLP 3000.007#18.2 — early replay needs the persisted store's identity and head; a replacement must retire known receipts through sync first.
  async function replayOnOpen() {
    const capture = await captureStore();
    if (!capture?.store_id || capture.backend_required || !(await queued()).some(entry => entry.sent_seq == null && entry.observed_seq == null)) return;
    try {
      const request = requestCredentials();
      const response = await doFetch(`${base}/probe`, { headers: request.headers, signal: aborter.signal });
      const head = await response.json();
      await refusedSession(head.denied ?? head.why, request.revision);
      if (!response.ok || head.ok !== true || sessionDead || request.revision !== credentialRevision) return;
      if (await witnessRestore(head.store_id, head.seq, capture)) return;
      if (head.store_id !== capture.store_id || !Number.isSafeInteger(head.seq) || head.seq < capture.watermark) return;
      // A slow snapshot must not hold an unknown write behind acquisition.
      // Receipt settlement still runs in the ordinary network queue; these
      // sends retain their IDs and the first sync collects their effects.
      await flushOnce(false);
    } catch { /* The ordinary sync/retry path owns an unreachable probe. */ }
  }

  const client: LocalClient = {
    act(op, args, options) {
      return act(op, args, options, options?.id ?? mintId(), post, () => unavailable() ?? (link !== "online" ? offline() : undefined));
    },
    async query(op, args) {
      while (true) {
        const result = await runLocal(op, args);
        if (result.incarnation === incarnation || closed) return result.read;
      }
    },
    observe<A, R>(op: Query<A, R>, args: A): Observed<R> {
      const key = `${op.name}:${JSON.stringify(args)}`;
      let watch = watches.get(key);
      if (!watch) {
        watch = { op: op as Query<unknown, unknown>, args, key, tables: new Set(), snapshot: { loading: true }, subscribers: new Set(), running: false, dirty: false, expiryTimer: null, incarnation };
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
    async mutate<A, R>(op: Mutation<A, R>, args: A, options?: MutateOptions): Promise<Write<R>> {
      const id = options?.id === undefined ? mintId() : options.id;
      const unavailableWhy = unavailable();
      if (unavailableWhy) {
        const failed = { state: "failed" as const, id, why: unavailableWhy };
        return mutationIds.knows(id) ? failed : emitLocalFailure(failed);
      }
      return mutationIds.run<R>(id, op.name, args, () => client.write(id), async (args, pending) => {
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
          // @ref LLP 3000.007#20.4 — capture replay eligibility with the synchronous journal entry; recovery must also defer local refusals to the server.
          const admitted = await call({ op: "admit", entry: { id, seq: submission, op: op.name, args, viewer: principal, now: Date.now(), new_ids: newIds, predicted: [], predictable, replay_candidate: options?.id !== undefined } satisfies Queued });
          if (admitted.denied) {
            settled.delete(id);
            const failed = { state: "failed" as const, id, why: admitted.denied };
            return admitted.denied.code === "E_WRITE_ID_REUSE" ? failed : emitLocalFailure(failed);
          }
          const entry = admitted.ok as Queued;
          if (!entry.predictable && !entry.predicted.length) Object.assign(pending, { reason: !acquired
            ? "queued without a row: not acquired yet"
            : "queued without a row: local data does not justify prediction" });
          rerunTables(predictedTables(entry.predicted));
        } catch (error) {
          settled.delete(id);
          return emitLocalFailure({ state: "failed", id, why: { code: "E_STORE", family: "store", message: `write ${id} admission outcome is unknown: ${String(error)}` } });
        }
        if (closed) { settled.delete(id); return pending; }
        void flush();
        if (link !== "online") { settled.delete(id); return pending; }
        let timer: ReturnType<typeof setTimeout> | undefined;
        try { return await Promise.race([result, new Promise<Write>((resolve) => { timer = setTimeout(() => resolve(pending), 4_000); })]) as Write<R>; }
        finally { clearTimeout(timer); settled.delete(id); }
      });
    },
    async write(id) {
      if (unavailable()) return undefined;
      const receipt = await history.read(id);
      if (receipt && receipt.state !== "pending") return unavailable() ? undefined : receipt;
      const entry = (await queued()).find(entry => entry.id === id);
      if (unavailable()) return undefined;
      if (!entry) { const latest = await history.read(id); return unavailable() ? undefined : latest; }
      const seq = entry.sent_seq ?? entry.observed_seq;
      if (seq != null) return { state: "sent", id, seq, replayed: true };
      return receipt ?? { state: "pending", id, ...(!entry.predictable && !entry.predicted.length
        ? { reason: !acquired ? "queued without a row: not acquired yet" : "queued without a row: local data does not justify prediction" } : {}) };
    },
    get acquired() { return acquired; },
    onAcquired(listener) { acquiredListeners.add(listener); return () => acquiredListeners.delete(listener); },
    async upload(bytes) {
      const unavailableWhy = unavailable();
      if (unavailableWhy) return { ok: false as const, why: unavailableWhy };
      if (link !== "online") return { ok: false as const, why: { code: "E_OFFLINE", family: "link", message: "the server is unreachable; uploads wait for no link", retryable: true } };
      const request = requestCredentials();
      const uploaded = await uploadAsset(base, request.headers, doFetch, bytes);
      if (uploaded.ok && !unavailable() && request.revision === credentialRevision) {
        // The device keeps only facts received from this uploader's server reply.
        await call({ op: "upload_facts", viewer: principal, asset: uploaded.asset });
      }
      if (!uploaded.ok) await refusedSession(uploaded.why, request.revision);
      if (!uploaded.ok && uploaded.why.code === "E_OFFLINE") setLink("offline");
      return uploaded;
    },
    async asset(id) {
      const denied = unavailable();
      if (denied) return { denied };
      if (link !== "online") return media!.read(id);
      const request = requestCredentials();
      const read = await fetchAsset(base, request.headers, doFetch, id, (blob, response) =>
        unavailable() || request.revision !== credentialRevision ? Promise.resolve() : media!.viewed(id, blob, response));
      if ("denied" in read) {
        await refusedSession(read.denied, request.revision);
        if (read.denied.code === "E_OFFLINE" && !unavailable()) { setLink("offline"); return media!.read(id); }
        await media!.invalidate(id);
      }
      if (unavailable() || request.revision !== credentialRevision) {
        if ("url" in read) read.revoke();
        return { denied: unavailable() ?? offline() };
      }
      return read;
    },
    assetSource: (id) => assetSource(base, requestCredentials().headers, id),
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
    refreshSession: refreshCurrent,
    async logoutAll() {
      if (refreshing) await refreshing;
      if (closed) return { ok: false, why: { code: "E_CLOSED", family: "client", message: "this client is closed" } };
      if (sessionDead || !session) return { ok: false, why: { code: "E_AUTH", family: "auth", message: "sign in to revoke sessions" } };
      const revision = credentialRevision;
      const revoked = await revokeAllSessions(base, session.token, doFetch);
      if (revoked.ok) {
        await endSession();
        await client.close();
      } else {
        await refusedSession(revoked.why, revision);
        if (sessionDead) await client.close();
      }
      return revoked;
    },
    async signOut() {
      if (refreshing) await refreshing;
      if (session && !sessionDead) await logout(base, session.token, doFetch);
      if (!sessionDead) await endSession();
      await client.close();
    },
    close() {
      if (closing) return closing;
      closed = true;
      setAcquired(false);
      acquiredListeners.clear();
      stopSuspend?.();
      stopOutbox?.();
      aborter.abort();
      if (retry) clearTimeout(retry);
      if (refreshTimer) clearTimeout(refreshTimer);
      for (const watch of watches.values()) if (watch.expiryTimer) clearTimeout(watch.expiryTimer);
      watches.clear();
      linkListeners.clear();
      sessionListeners.clear();
      viewerListeners.clear();
      writeListeners.clear();
      for (const [id, resolve] of settled) resolve({ state: "pending", id });
      closing = (async () => {
        await Promise.allSettled([following, syncing, flushing, refreshing, ...active]);
        await media?.close();
        await core.close();
        settled.clear();
      })();
      return closing;
    },
  };
  // @ref LLP 3000.007#20.4 — recover existing IDs before accepting a fresh synchronous web admission; custody stays with the outbox and its receipt window.
  await queued();
  const keptWrites = (await call({ op: "meta", key: "write-history" })).ok as string | null;
  for (const write of keptWrites ? JSON.parse(keptWrites) as Write[] : []) mutationIds.remember(write.id);
  if (link === "online") {
    // Web stores have one owner. Native owners may share an outbox with an
    // active sender, so their existing snapshot/receipt coordination runs first.
    if (core.onSuspend) await replayOnOpen();
    await syncOnce();
  }
  seq = Number(((await call({ op: "state" })).ok as { watermark?: number } | undefined)?.watermark ?? 0);
  if (core.onSuspend) {
    const sendOnExit = exitTransport(doFetch, base, aborter.signal);
    stopSuspend = core.onSuspend((entries, beginSend) => {
      const request = requestCredentials();
      // @ref LLP 3000.007#20.4 — document teardown may abort the ordinary request: only its same durable head may overlap the keepalive retry.
      exitDone = sendOnExit(entries, request.headers, () => (ordinarySending === undefined || ordinarySending === entries[0]?.id) && !closed && !sessionDead && !rotating && credentialRevision === request.revision && beginSend());
    });
  }
  stopOutbox = core.onOutbox?.(() => { void flush(); });
  follow();
  void flush();
  scheduleRefresh();
  return client;
  } catch (error) {
    stopSuspend?.();
    stopOutbox?.();
    aborter.abort();
    // Opening the device transfers its lifetime to this constructor. Until a
    // client is returned, every later startup failure must release it here.
    try { await media?.close(); await core.close(); } catch {}
    throw error;
  }
}

async function loadBackend(doFetch: typeof fetch, base: string, headers: Record<string, string>, signal?: AbortSignal): Promise<BackendJson> {
  const response = await doFetch(`${base}/schema`, { headers, ...(signal ? { signal } : {}) });
  let json: BackendJson & { denied?: Refusal };
  try { json = (await response.json()) as BackendJson & { denied?: Refusal }; }
  catch (error) {
    if (response.status === 401) throw new BackendAuthError({ code: "E_AUTH", family: "auth", message: "the server refused this session" });
    throw error;
  }
  if (json.denied || response.status === 401) throw new BackendAuthError(json.denied ?? { code: "E_AUTH", family: "auth", message: "the server refused this session" });
  if (!response.ok) throw new Error(`schema: HTTP ${response.status}`);
  return json;
}
