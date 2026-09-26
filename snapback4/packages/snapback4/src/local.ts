import { admitNow, failedAdmission } from "./admission.ts";
import { attachAdmissionAuthority } from "./admission-authority.ts";
import { acquisitionProgress } from "./acquisition.ts";
import { serverClock } from "./clock.ts";
import { defaultFetch } from "#fetch";
import { ClosingResponses, trackClose, type ClosingResponse } from "./closing-responses.ts";
import type { Queued, StoreCapture } from "./local-types.ts";
import { deferStart, startDeferred, trackRotation } from "./client-start.ts";
// The local-first tier (LLP 3000 §7, one implementation): the device is
// the Rust module — the partition in its own store, the stream applied,
// the outbox kept, queries and predictions answered — and this client is
// what remains: the session, the link, the transport, and the observation
// of reads. Every word a screen reads is still the card. The module is
// reached through one JSON call (`DeviceCore`), so the wasm device on the
// web (`snapback4/web`), the Expo module (`snapback4-expo`) and the
// `snapback4 device` process for Node (`snapback4/native`) all fit.

import { evaluateLocal } from "./local-query.ts";
import { ReadObservation } from "./read-observation.ts";
import { postForCaller, waitForCaller } from "./request-wait.ts";
import { runsOnServer, predictedTables, LocalReads, type LocalWatch as Watch } from "./local-reads.ts";
import { BackendAuthError, loadBackend } from "./local-backend.ts";
import { MutationIds, WriteHistory } from "./writes.ts";
import { changeFeed } from "./changes.ts";
import { requireSyncProtocol, responsePageTooLarge, syncTransport, type SyncPage } from "./local-sync.ts";
import { exitTransport } from "./local-exit.ts";
import { exitRefusalSettlement } from "./local-exit-settlement.ts";
import { recoverReceipt, settleReceipt } from "./local-receipts.ts";
import type { Client, Link, MutateOptions, Mutation, Observed, Principal, Query, Read, Refusal, Write } from "./contract.ts";
import { MediaCache, assetRetention, type MediaStorage, type AssetRetention } from "./local-assets.ts";
export type { AcquisitionMarker } from "./local-sync.ts";
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

export type { DeviceCore, DeviceOpener, DeviceOpening, LocalOptions, LocalClient } from "./local-device.ts";
import type { LocalOptions, LocalClient } from "./local-device.ts";

const PAGE = 4000;
const REFRESH_BEFORE_EXPIRY_MS = 24 * 60 * 60 * 1000;

export async function createLocalClient(options: LocalOptions): Promise<LocalClient> {
  const retention = assetRetention(options.assets);
  const clock = serverClock(options.fetch ?? defaultFetch).fork();
  const doFetch = clock.wrap(options.fetch ?? defaultFetch);
  const fetchSync = syncTransport(doFetch);
  const base = options.url.replace(/\/$/, "");
  const headers: Record<string, string> = { "content-type": "application/json" };
  const sessions = options.sessionStore ?? defaultSessionStore;
  let session: Session | null = null;
  if (options.persona) headers["x-snapback-persona"] = options.persona;
  else {
    session = options.session ?? await restoreSession(base, sessions, () => 0);
    if (session && (!Number.isFinite(session.expiresAt) || session.expiresAt <= 0)) {
      session = null;
      await forgetSession(base, sessions);
    }
    if (!session && options.guest) {
      const signedIn = await guest(base, doFetch);
      if (!signedIn.ok) throw new Error(`createLocalClient: ${signedIn.why.code}: ${signedIn.why.message}`);
      session = signedIn.session;
    }
    if (!session) throw new Error(`createLocalClient: no session for ${base}; pass one from guest(), login() or signup(), or say guest: true`);
    if (!startDeferred(options) && session.kind !== "action" && session.expiresAt - clock.estimatedServerNow() <= REFRESH_BEFORE_EXPIRY_MS) {
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
  // Restore the kept backend before installing anything from the server.
  // A generation change can erase the evidence needed to detect a restore;
  // the ordinary sync preflight and captured adoption must run first.
  // One store per server and viewer.
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
  const closingResponses = new ClosingResponses();
  const aborter = new AbortController();
  // @ref LLP 3000.001#repair-b-never-install-a-confirmed-image-over-a-row-a-live-prediction-writes — startup must preserve the evidence until the server head has been validated.
  const core = await options.device.open(storeName, null).catch(error => {
    // This refusal permits a conditional first-install request: another
    // owner may have initialized the name since the failed open.
    // Store corruption, ownership and other open failures must not fall back.
    const message = error instanceof Error ? error.message : String(error);
    if (!backend || !message.includes("E_AUTH") || !message.includes("this device has never synced: the server must be reachable once to open")) throw error;
    return options.device.open(storeName, { initial_backend: backend });
  });
  let stopSuspend: (() => void) | undefined;
  // Web mutations can arrive after publication but before startup validation.
  let sendingAllowed = !core.onSuspend;
  let stopOutbox: (() => void) | undefined;
  let flushRecovered: (() => void) | undefined;
  let stopClock: (() => void) | undefined;
  let media: MediaCache | undefined;
  try {
  attachAdmissionAuthority(core, options);
  history = new WriteHistory({
    read: async () => (await call({ op: "meta", key: "write-history" })).ok as string | null,
    save: async value => {
      const reply = await call({ op: "keep_write", value });
      if (reply.denied) throw new Error(`${reply.denied.code}: ${reply.denied.message}`);
    },
  });
  await requireSyncProtocol(core);
  const state = await call({ op: "state" });
  generation = Number((state.ok as { generation?: number } | undefined)?.generation ?? 0);
  if (!backend || Number(backend.generation ?? 0) !== generation) backend = (await call({ op: "backend" })).ok as BackendJson;
  stopOutbox = core.onOutbox?.(time => { clock.raiseIssued(time ?? 0); flushRecovered?.(); });
  await clock.attach(core);
  if (session && session.expiresAt <= clock.issuedDeviceNow()) {
    await forgetSession(base, sessions);
    throw new Error("createLocalClient: E_AUTH: this session expired; sign in again");
  }
  media = new MediaCache(core, principal, retention, clock.issuedDeviceNow);
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
  const settled = new Map<string, { resolve: (write: Write) => void; response: ClosingResponse }>();
  const answers = new LocalReads();
  // @ref LLP 3000.013#6 — dispatched mutations own settlement through close.
  const settling = new Set<string>();
  // Unversioned syncedAt may be server time; omit it until a wall-time resync.
  let lastSyncAt = Number((await call({ op: "meta", key: "syncedAt:wall:1" })).ok ?? 0);
  let caughtUp = false;
  let identityChecked = false;
  let partitionCurrent = true;
  const initialSync = (await call({ op: "sync_state", capture: false })).ok as { store_id?: string | null; restore_refusal?: Refusal };
  let storeIdentity = initialSync?.store_id ?? undefined;
  partitionDenied = initialSync?.restore_refusal ?? null;
  let incarnation = 0;
  const progress = acquisitionProgress();
  let acquired = false;
  const acquiredListeners = new Set<(value: boolean) => void>();
  function setAcquired(value: boolean) {
    if (value) progress.acquired(true); else progress.reset();
    if (acquired === value) return;
    acquired = value;
    for (const listener of acquiredListeners) listener(value);
  }
  // @ref LLP 3000.007#18.2 — acquisition belongs to the current store; a reconnect alone cannot bless an old partition.
  async function refreshAcquired(afterAdoption = false) {
    const revision = incarnation;
    const state = (await call({ op: "sync_state", capture: false })).ok as { acquired: boolean } | undefined;
    if (revision === incarnation) {
      // Compatible widening may preserve native acquisition. Revalidate it
      // only after the new backend is installed and this read succeeds.
      if (afterAdoption && state?.acquired === true) partitionCurrent = true;
      setAcquired(!closed && !sessionDead && partitionCurrent && state?.acquired === true);
    }
  }
  stopClock = clock.subscribe((shift, revised) => {
    // Sub-frame sampling noise must not make a query response refetch itself.
    if (closed || (!revised && Math.abs(shift) < 10)) return;
    for (const watch of watches.values()) void rerun(watch);
    void media?.reconcile().catch(() => {});
    scheduleRefresh();
  });
  await refreshAcquired();
  // A kept sent entry can disappear on the first catch-up, before a screen mounts.
  for (const entry of await queued()) {
    const seq = entry.sent_seq ?? entry.observed_seq;
    if (entry.sent_seq == null && seq != null) await history.keep({ state: "sent", id: entry.id, seq, replayed: true });
  }
  // @ref LLP 3000.007#18.2 — observation fences answers before queued sync can retire the partition.
  function observeIncarnation(id?: string, force = false, delivery?: (() => void)[]) {
    if (!force && (id === undefined || id === storeIdentity)) return;
    const resetProgress = force || storeIdentity !== undefined;
    storeIdentity = id;
    incarnation++;
    partitionCurrent = false;
    const wasAcquired = acquired;
    acquired = false;
    if (resetProgress) progress.reset();
    caughtUp = false;
    identityChecked = false;
    seq = 0;
    lastSyncAt = 0;
    answers.clear(watches.values());
    // Finish invalidating every answer before invoking application callbacks.
    const deliver = () => {
      if (wasAcquired) for (const listener of acquiredListeners) listener(false);
      for (const watch of watches.values()) {
        notify(watch);
        void rerun(watch);
      }
    };
    if (delivery) delivery.push(deliver); else deliver();
  }
  function invalidateAnswers(delivery: (() => void)[] = []) {
    answers.clear(watches.values());
    delivery.push(() => { for (const watch of watches.values()) { notify(watch); void rerun(watch); } });
    return delivery;
  }
  function refuseRestore(denied?: Refusal) {
    if (denied?.code !== "E_STORE_RESTORE") return;
    partitionDenied = denied;
    observeIncarnation(storeIdentity, true);
    for (const watch of watches.values()) { watch.publish({ denied }); notify(watch); }
  }
  // @ref LLP 3000.001#repair-b-never-install-a-confirmed-image-over-a-row-a-live-prediction-writes — the device validates head observations against private progress and retained image heads before replay or freshness decisions.
  async function witnessRestore(storeId: unknown, head: unknown, capture: StoreCapture): Promise<boolean> {
    if (!Number.isSafeInteger(head) || Number(head) < 0) return true;
    if (typeof storeId !== "string" || storeId !== (capture.transfer_store_id ?? capture.store_id)) return false;
    const observed = await call({ op: "observe_store", page: { snapshot: false, generation, events: [], watermark: head, more: false, store_id: storeId,
      requested_watermark: capture.restore_watermark ?? capture.transfer_watermark ?? capture.watermark,
      captured_restore_watermark: capture.restore_watermark, captured_restore_images_at: capture.restore_images_at,
      captured_watermark: capture.watermark, send_revision: capture.send_revision } });
    if (observed.denied) { refuseRestore(observed.denied); return true; }
    return false;
  }
  async function captureStore(): Promise<StoreCapture | undefined> {
    const reply = await call({ op: "sync_state", capture: false });
    if (reply.denied) return;
    const capture = reply.ok as StoreCapture;
    if (capture.restore_refusal) { refuseRestore(capture.restore_refusal); return; }
    return capture;
  }
  async function call(request: Record<string, unknown>, committedTables?: Set<string>): Promise<{ ok?: unknown; denied?: Refusal }> {
    if (["observe_store", "apply", "adopt", "settle_exit"].includes(String(request.op))) while (history?.hasUnpersisted()) await history.persistPending();
    let observed = false;
    const delivery: (() => void)[] = [];
    const deliver = () => { for (const notify of delivery.splice(0)) notify(); };
    const committed = (result: { ok?: unknown; denied?: Refusal }) => {
      if (observed) return;
      observed = true;
      // @ref LLP 3000.001#repair-b-never-install-a-confirmed-image-over-a-row-a-live-prediction-writes — preserve publication invalidations before fallible post-commit work.
      if (!result.denied && ["apply", "admit", "settle", "settle_exit", "clear_rows"].includes(String(request.op))) invalidateAnswers(delivery);
      if (!result.denied && request.op === "apply") {
        for (const table of (result.ok as { touched?: string[] } | undefined)?.touched ?? []) committedTables?.add(table);
        delivery.push(() => { if (!closed && !sessionDead) progress.page(request.page as Record<string, unknown>, request.first === true); });
      }
      // A committed replacement has already retired the client's partition.
      // Fence it before even media reconciliation can fail; native identity
      // is read separately and must never be a prerequisite for invalidation.
      if (!result.denied && request.op === "observe_store" && (result.ok as { reset?: boolean } | undefined)?.reset) observeIncarnation(undefined, true, delivery);
      if (!result.denied && request.op === "adopt") observeIncarnation(storeIdentity, true, delivery);
    };
    const work = typeof request.now === "number" ? clock.persist().then(() => core.call(request, committed)) : core.call(request, committed);
    active.add(work);
    try {
      const result = (await work) as { ok?: unknown; denied?: Refusal };
      committed(result);
      deliver();
      if (!result.denied && ["apply", "observe_store", "adopt", "clear_rows", "admit", "settle", "settle_exit"].includes(String(request.op))) await media?.reconcile();
      return result;
    }
    finally { active.delete(work); deliver(); }
  }
  const offline = (): Refusal => ({ code: "E_OFFLINE", family: "link", message: "the server is unreachable", retryable: true });
  const unavailable = (): Refusal | null => closed ? { code: "E_CLOSED", family: "client", message: "this client is closed" } : sessionDead ? { code: "E_AUTH", family: "auth", message: "sign in to continue" } : null;
  setLink = (next: Link) => {
    if (closed || (sessionDead && next !== "signed-out")) return;
    if (link === next) return;
    link = next;
    if (next !== "online") {
      identityChecked = false;
      for (const watch of watches.values()) {
        if (next === "signed-out") watch.publish({ denied: unavailable()! });
        else if ("data" in watch.snapshot && watch.snapshot.fresh) watch.publish({ loading: true });
      }
      for (const watch of watches.values()) notify(watch);
    }
    for (const listener of linkListeners) listener(next);
    if (next === "online") void flush();
    for (const watch of watches.values()) void rerun(watch);
  };
  let refreshTimer: ReturnType<typeof setTimeout> | undefined;
  let refreshing: Promise<SignIn> | null = null;
  let rotatingSession: Promise<SignIn> | null = null;
  let retireRotation: ((result: SignIn) => void) | undefined;
  let persistingSession: Promise<void> | undefined;
  let endingSession: Promise<void> | undefined;
  const signedOut = (): SignIn => ({ ok: false, why: { code: "E_AUTH", family: "auth", message: "sign in to continue" } });
  let stopRefresh!: () => void;
  const refreshStopped = new Promise<SignIn>(resolve => { stopRefresh = () => resolve(signedOut()); });
  // @ref LLP 3000.011.003.000#2 — local sign-out fences refresh before durable credential deletion; it never deletes the replica or outbox.
  const endSession = (): Promise<void> => {
    if (endingSession) return endingSession;
    const notifySession = !sessionDead;
    const work = Promise.resolve().then(async () => {
      try {
        // A store write already in progress must finish before deletion. A
        // still-pending network refresh has no permission to start a write.
        try { await persistingSession; } catch {}
        await forgetSession(base, sessions);
        await media?.clear();
      } finally {
        if (notifySession) {
          for (const listener of [...sessionListeners]) listener(null);
          for (const listener of [...viewerListeners]) listener(null);
        }
      }
    });
    // Coalesce even a listener's reentrant sign-out onto the same deletion.
    endingSession = work;
    void work.catch(() => { if (endingSession === work) endingSession = undefined; });
    if (!sessionDead) {
      sessionDead = true;
      session = null;
      rotating = false;
      credentialRevision += 1;
      stopRefresh();
      if (refreshTimer) { clearTimeout(refreshTimer); refreshTimer = undefined; }
      delete headers.authorization;
      delete headers["x-snapback-persona"];
      setAcquired(false);
      setLink("signed-out");
    }
    return work;
  };
  const refusedSession = async (denied: unknown, revision: number) => {
    if (!sessionDead && !rotating && revision === credentialRevision && (denied as Refusal | undefined)?.code === "E_AUTH") await endSession();
  };
  const scheduleRefresh = (retryAfter?: number) => {
    if (refreshTimer) clearTimeout(refreshTimer);
    refreshTimer = undefined;
    if (closed || sessionDead || options.persona || !session || session.kind === "action") return;
    const untilDue = Math.max(0, session.expiresAt - clock.issuedDeviceNow() - REFRESH_BEFORE_EXPIRY_MS);
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
    if (closed) return Promise.resolve({ ok: false, why: { code: "E_CLOSED", family: "client", message: "this client is closed" } });
    if (sessionDead || !session || options.persona) return Promise.resolve({ ok: false, why: { code: "E_AUTH", family: "auth", message: "sign in with a session to refresh it" } });
    if (refreshing) return refreshing;
    const token = session.token;
    const expectedPrincipal = session.principal;
    rotating = true;
    credentialRevision += 1;
    const rotation = rotateSession(base, token, doFetch);
    rotatingSession = rotation;
    let retired = false;
    const retire = (result: SignIn) => {
      if (retired || !result.ok || session?.token === result.session.token) return;
      retired = true; void logout(base, result.session.token, doFetch);
    };
    retireRotation = retire;
    void rotation.then(refreshed => { if (closed) retire(refreshed); }).catch(() => {});
    const work = (async (): Promise<SignIn> => {
      // Sign-out stops adoption, but lets a committed rotation return its
      // successor for best-effort family revocation, even after close.
      const refreshed = await Promise.race([rotation, refreshStopped]);
      if (sessionDead) return signedOut();
      if (closed) { retire(refreshed); return { ok: false, why: { code: "E_CLOSED", family: "client", message: "this client is closed" } }; }
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
      try { await (persistingSession = keepSession(base, session, sessions)); }
      catch (error) { persistenceError = error; }
      finally { persistingSession = undefined; }
      if (sessionDead) return signedOut();
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
      if (rotatingSession === rotation) rotatingSession = null;
    }).catch(() => {});
    return work;
  };

  function post(path: string, body: unknown, captured?: ClosingResponse) {
    const work = sendPost(path, body, captured);
    active.add(work);
    void work.finally(() => active.delete(work)).catch(() => {});
    return work;
  }
  async function sendPost(path: string, body: unknown, captured?: ClosingResponse): Promise<{ ok: true; json: Record<string, unknown>; obsoleteAuth: boolean } | { ok: false }> {
    if (closed || sessionDead) return { ok: false };
    try {
      const request = requestCredentials();
      const reply = await postForCaller(doFetch, base, path, request.headers, body, aborter.signal, (json, status) => captured?.capture(json, status));
      if (!reply) return { ok: false };
      const { response, json } = reply;
      // I12: delivered mutation/action outcomes still belong to their callers
      // after close. Reads continue to require the live view at delivery.
      if (closed && !path.startsWith("/m/") && !path.startsWith("/a/")) return { ok: false };
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

  async function refusePartition(denied: Refusal, revision: number) {
    await refusedSession(denied, revision);
    if (!denied.retryable) {
      if (!partitionDenied) console.error(`snapback4: the server refused the partition: ${denied.code}: ${denied.message}`);
      partitionDenied = denied;
      for (const watch of watches.values()) void rerun(watch);
    }
  }

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
    try { await history.persistPending(); } catch { retryFlush(); return false; }
    const state = (await call({ op: "state" })).ok as { watermark: number; generation: number } | undefined;
    let watermark = state?.watermark ?? 0;
    const touched = new Set<string>();
    let adoptedGeneration = false;
    let after: string | undefined;
    let catchingUp = false;
    let publicationOutstanding = false;
    let restartingSnapshot = false;
    let pageLimit = PAGE;
    try {
      for (let pages = 0; pages < 100_000; pages++) {
        let page: SyncPage;
        let pageRevision = credentialRevision;
        let requestedStore: string | null | undefined;
        let publishedStore: string | null | undefined;
        let backendRequired = false;
        let pageIncarnation = incarnation;
        try {
          const captured = await call({ op: "sync_state" });
          if (captured.denied) return false;
          const { generation: capturedGeneration, pending_ids: pending, send_revision, store_id, transfer_store_id, watermark: capturedWatermark, transfer_watermark, restore_watermark, restore_images_at, snapshot_catchup, pending_through, pending_complete, pending_bound, backend_required, restore_refusal } = captured.ok as { generation: number; pending_ids: string[]; pending_through: number; pending_complete: boolean; pending_bound: number; transfer_watermark: number; restore_watermark?: number; restore_images_at?: number; snapshot_catchup?: boolean; send_revision: number; store_id?: string | null; transfer_store_id?: string | null; watermark: number; backend_required?: boolean; restore_refusal?: Refusal };
          if (restore_refusal) { refuseRestore(restore_refusal); return false; }
          backendRequired = !!backend_required;
          requestedStore = transfer_store_id ?? store_id;
          publishedStore = store_id;
          observeIncarnation(store_id ?? undefined, backendRequired && partitionCurrent);
          storeIdentity = store_id ?? undefined;
          pageIncarnation = incarnation;
          const snapshotRequest = restartingSnapshot || after !== undefined;
          watermark = snapshotRequest ? 0 : transfer_watermark ?? capturedWatermark;
          catchingUp = !snapshotRequest && (snapshot_catchup ?? catchingUp);
          publicationOutstanding ||= watermark > capturedWatermark;
          const request = requestCredentials();
          const response = await fetchSync(`${base}/sync`, { method: "POST", headers: request.headers, signal: aborter.signal }, { generation: capturedGeneration, from: watermark, limit: pageLimit, after: after ?? null, stream: !snapshotRequest && (catchingUp || (after === undefined && publicationOutstanding)), pending, ...(requestedStore ? { store_id: requestedStore } : {}) });
          if (response.status >= 500) { setLink("offline"); return false; }
          page = (await response.json()) as SyncPage;
          if (!response.ok && !page.denied) { setLink("offline"); return false; }
          page.send_revision = send_revision;
          page.pending_through = pending_through;
          page.pending_complete = pending_complete;
          page.pending_bound = pending_bound;
          page.requested_watermark = watermark;
          page.captured_restore_watermark = restore_watermark;
          page.captured_restore_images_at = restore_images_at;
          page.captured_watermark = capturedWatermark;
          pageRevision = request.revision;
        } catch {
          setLink("offline");
          return false;
        }
        if (closed || pageIncarnation !== incarnation || pageRevision !== credentialRevision) return false;
        const denied = page.denied as Refusal | undefined;
        // @ref LLP 3000.007.003#5 — early discovery enters the same identity/adoption path as overflow.
        const generationChanged = denied?.code === "E_SYNC_GENERATION" && denied.family === "generation";
        if (generationChanged && (typeof page.watermark !== "number" || !Number.isFinite(page.watermark) || !Number.isInteger(page.watermark) || page.watermark < 0)) {
          setLink("offline");
          return false;
        }
        // @ref LLP 3000.007.001#3.11 — adopt an oversized reply's identity before shrinking or retrying its position.
        if (denied && !generationChanged && !responsePageTooLarge(denied)) {
          await refusePartition(denied, pageRevision);
          return false;
        }
        // @ref LLP 3000.007#18.2 — sync identity retires the old partition before any read or outbox replay.
        let replacedStore = false;
        let adoptionCapture: Record<string, string | null> | undefined;
        {
          // Neither refusal delivers a row batch. An overflow watermark is
          // only an event cut; preserve explicit image-head evidence without
          // inventing terminality or treating a refusal as delivered progress.
          // Generation discovery reports the current head, so it must check
          // retained image evidence before adoption can clear that evidence.
          const observed = await call({ op: "observe_store", page: denied ? { ...page, snapshot: false, events: [], more: true,
            ...(generationChanged ? { images_at: page.watermark } : {}) } : page });
          if (observed.denied) { refuseRestore(observed.denied); return false; }
          const observation = observed.ok as { reset: boolean; backend_required?: boolean; send_revision: number; retired: Record<string, number>; adoption_capture?: Record<string, string | null> };
          page.send_revision = observation.send_revision;
          adoptionCapture = observation.adoption_capture;
          backendRequired = !!observation.backend_required;
          if (observation.reset) {
            // call() already invalidated the retired incarnation synchronously.
            // Discard this round's old cursors before inspecting the new store.
            watermark = 0; after = undefined; catchingUp = false; publicationOutstanding = false;
            page.captured_watermark = 0;
            adoptedGeneration = true;
            replacedStore = true;
            const observedRead = await call({ op: "sync_state", capture: false });
            if (observedRead.denied) return false;
            const observedState = observedRead.ok as { store_id?: string | null } | undefined;
            publishedStore = observedState?.store_id;
            storeIdentity = publishedStore ?? undefined;
            await call({ op: "set_meta", key: "syncedAt:wall:1", value: "0" });
            for (const [id, sentSeq] of Object.entries(observation.retired)) {
              const receipt: Write = { state: "sent", id: id as Write["id"], seq: sentSeq, replayed: true };
              settled.get(id)?.resolve(receipt); settled.delete(id);
              emitWrite(receipt);
            }
            for (const watch of watches.values()) void rerun(watch);
          }
        }
        if (link !== "online") setLink("online");
        if (!denied) partitionDenied = null;
        const pageGeneration = Number(page.generation ?? generation);
        if (generationChanged || pageGeneration !== generation || (backendRequired && partitionCurrent)) observeIncarnation(storeIdentity, true);
        if (generationChanged || pageGeneration !== generation || replacedStore || backendRequired) {
          // Generation counters restart with a new store. Reload the backend
          // even when its number matches, then acquire its current partition.
          let backendRevision = credentialRevision;
          const backendIncarnation = incarnation;
          try {
            const request = requestCredentials();
            backendRevision = request.revision;
            const nextBackend = await loadBackend(doFetch, base, request.headers, aborter.signal);
            if (closed || backendIncarnation !== incarnation || request.revision !== credentialRevision) return false;
            const adopted = await call({ op: "adopt", backend: nextBackend, store_id: publishedStore ?? null, send_revision: page.send_revision, adoption_capture: adoptionCapture });
            if (adopted.denied) return false;
            backend = nextBackend;
            generation = Number(nextBackend.generation ?? pageGeneration);
            partitionDenied = null;
            nativeReady = false;
            adoptedGeneration = true;
            await refreshAcquired(true);
            nativeReady = await installNative(aborter.signal);
          } catch (error) {
            if (error instanceof BackendAuthError) await refusedSession(error.denied, backendRevision);
            return false;
          }
          watermark = 0; after = undefined; catchingUp = false; publicationOutstanding = false; continue;
        }
        if (denied) {
          if (page.snapshot === true && pageLimit === 1 && (watermark > 0 || catchingUp)) {
            // Restart acquisition without applying the refusal's watermark.
            // Keep the reduced limit; snapshot rows can split a whole commit.
            watermark = 0; after = undefined; catchingUp = false;
            restartingSnapshot = true;
            partitionDenied = null;
            continue;
          }
          if (pageLimit > 1) {
            pageLimit = Math.max(1, Math.floor(pageLimit / 2));
            continue;
          }
          await refusePartition(denied, pageRevision);
          return false;
        }
        if (Number(page.watermark) < watermark || (catchingUp && page.snapshot) || (page.snapshot && page.more && !page.next)) return false;
        page.stage_snapshot = !!page.snapshot;
        page.snapshot_catchup = catchingUp;
        const applyingIncarnation = incarnation;
        const applied = await call({ op: "apply", page, first: !catchingUp && after === undefined }, touched);
        if (closed || applyingIncarnation !== incarnation) return false;
        if (applied.denied) { refuseRestore(applied.denied); return false; }
        restartingSnapshot = false;
        const published = (applied.ok as { published?: boolean } | undefined)?.published !== false;
        publicationOutstanding = !published;
        // call() has already preserved committed tables for finally, even if
        // its media reconciliation or the following metadata inspection fails.
        if (published) {
          const publishedRead = await call({ op: "sync_state", capture: false });
          if (closed || applyingIncarnation !== incarnation || publishedRead.denied) return false;
          const publishedState = publishedRead.ok as { store_id?: string | null; watermark: number } | undefined;
          publishedStore = publishedState?.store_id;
          observeIncarnation(publishedStore ?? undefined);
          storeIdentity = publishedStore ?? undefined;
          watermark = publishedState?.watermark ?? watermark;
        }
        if (page.snapshot && page.more && page.next) {
          after = page.next as string;
          continue;
        }
        after = undefined;
        if (page.snapshot) { catchingUp = true; continue; }
        if (!page.more && published) {
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
      await call({ op: "set_meta", key: "syncedAt:wall:1", value: String(lastSyncAt) });
      // A later reconnect can establish custody that startup could not validate.
      const resumeSending = !sendingAllowed;
      listenForExit();
      if (resumeSending && sendingAllowed) void flush();
      return true;
    } finally {
      if (!closed && adoptedGeneration) {
        for (const watch of watches.values()) void rerun(watch);
      } else if (!closed && touched.size > 0) {
        for (const watch of watches.values()) if (watch.tables.size === 0 || [...watch.tables].some((t) => touched.has(t))) void rerun(watch);
      } else if (!closed && caughtUp && identityChecked) {
        for (const watch of watches.values()) {
          if (runsOnServer(backend!, watch.op, nativeReady) || watch.kept) { void rerun(watch); continue; }
          if (watch.incarnation !== incarnation || !("data" in watch.snapshot) || watch.snapshot.fresh) continue;
          const { since: _, ...read } = watch.snapshot;
          watch.publish({ ...read, fresh: true });
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
      if (response.status === 200 && json.ok === true && !sessionDead && probeIncarnation === incarnation && request.revision === credentialRevision) {
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
      if (closed || changeIncarnation !== incarnation || request.revision !== credentialRevision) return false;
      const replaced = json.store_id !== undefined && json.store_id !== storeIdentity;
      if (await witnessRestore(json.store_id, json.seq, capture)) return false;
      const shrank = json.seq < Math.max(seq, capture.watermark);
      if (replaced || shrank) observeIncarnation(json.store_id, shrank);
      const changed = replaced || shrank || json.seq > seq || (json.generation !== undefined && json.generation !== generation);
      if (changed) {
        seq = Math.max(seq, json.seq);
        const touched = new Set(json.tables ?? []);
        for (const watch of watches.values()) {
          if (runsOnServer(backend!, watch.op, nativeReady) && (watch.tables.size === 0 || [...watch.tables].some((table) => touched.has(table)))) void rerun(watch);
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

  // @ref LLP 3000.016#2.2 — local outcomes and one publication procedure govern every read kind.
  function runLocal<R>(op: Query<unknown, R>, args: unknown, watch?: Watch) {
    const queryEnvironment = {
      get backend() { return backend!; },
      get partitionDenied() { return partitionDenied; },
      get credentialRevision() { return credentialRevision; },
      get incarnation() { return incarnation; },
      get authority() { return answers.revision; },
      get refreshing() { return refreshing; },
      get link() { return link; },
      get caughtUp() { return caughtUp; },
      get identityChecked() { return identityChecked; },
      get lastSyncAt() { return lastSyncAt; },
      get partitionCurrent() { return partitionCurrent; },
      get nativeReady() { return nativeReady; },
      set nativeReady(value: boolean) { nativeReady = value; },
      principal, signal: aborter.signal, unavailable, queued, call, post, installNative, notify,
      deviceNow: clock.issuedDeviceNow, serverNow: clock.estimatedServerNow,
      offline, serverAnswers: answers.serverAnswers,
    };
    const work = (async () => {
      while (true) {
        const revision = incarnation, authority = answers.revision;
        const result = await evaluateLocal(queryEnvironment, op, args, revision, authority, watch);
        const denied = unavailable(); // Rule 1 also holds across the caller's await.
        if (denied) return { ...result, read: { denied }, incarnation: revision, authority };
        if ((revision === incarnation && authority === answers.revision) || closed || (watch && watches.get(watch.key) !== watch)) return { ...result, incarnation: revision, authority };
      }
    })();
    active.add(work);
    void work.finally(() => active.delete(work)).catch(() => {});
    return work;
  }


  function notify(watch: Watch) {
    for (const subscriber of watch.subscribers) subscriber();
  }

  function rerunTables(tables: Set<string>) {
    if (!tables.size) return;
    for (const watch of watches.values()) if (watch.tables.size === 0 || [...watch.tables].some((table) => tables.has(table))) void rerun(watch);
  }

  function scheduleExpiry(watch: Watch, nextExpiry: number | null, serverExpiry?: number | null) {
    if (watch.expiryTimer) clearTimeout(watch.expiryTimer);
    watch.expiryTimer = null;
    if ((nextExpiry == null && serverExpiry == null) || closed) return;
    const delay = Math.min(nextExpiry == null ? Infinity : clock.deviceDelay(nextExpiry), serverExpiry == null ? Infinity : clock.serverDelay(serverExpiry), 2_147_483_647);
    watch.expiryTimer = setTimeout(() => {
      watch.expiryTimer = null;
      if (watches.get(watch.key) !== watch) return;
      if ((nextExpiry == null || clock.deviceDelay(nextExpiry) > 0) && (serverExpiry == null || clock.serverDelay(serverExpiry) > 0)) { scheduleExpiry(watch, nextExpiry, serverExpiry); return; }
      // @ref LLP 3000.007#6.5 — Rule 5: expiry ends stale retention before
      // asynchronous recovery, including an already-running replacement.
      const denied = unavailable();
      watch.reset(denied ? { denied } : { loading: true });
      notify(watch);
      void rerun(watch);
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
      const { read, tables, nextExpiry, serverExpiry, incarnation: revision, authority } = await runLocal(watch.op, watch.args, watch);
      if (revision !== incarnation || authority !== answers.revision) { watch.dirty = true; return; }
      if (closed || watches.get(watch.key) !== watch) return;
      watch.incarnation = revision;
      watch.tables = tables;
      scheduleExpiry(watch, nextExpiry, serverExpiry);
      if (watch.snapshot !== read) {
        const denied = unavailable(); // Rule 1: immediately before notifying observers.
        watch.publish(denied ? { denied } : read);
        notify(watch);
      }
    } catch {
      if (!closed && watches.get(watch.key) === watch) { watch.publish({ loading: true }); notify(watch); }
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
    if (closed || !sendingAllowed) return;
    for (const entry of await queued()) {
      await exitDone;
      if (closed) return;
      if (entry.sent_seq != null || entry.observed_seq != null) {
        const receipt = await history.acknowledged(entry.id, entry.sent_seq ?? entry.observed_seq!);
        // A sent outbox entry already persisted its receipt before settlement;
        // re-reading it must not refresh an evicted receipt. Emission is per
        // client: another owner's durable receipt is still this client's first
        // completion, and the emitted set suppresses a repeat.
        if (entry.sent_seq == null) await settleReceipt(history, call, receipt);
        settled.get(entry.id)?.resolve(receipt); settled.delete(entry.id);
        emitWrite(receipt);
        // A published acknowledgement already includes this effect. Starting
        // another sync would withdraw freshness from a completed acquisition.
        if (acquire && (entry.observed_seq == null || !caughtUp)) await syncOnce();
        continue;
      }
      let ownsSettlement = false;
      try {
        const result = await network(async () => {
          await exitDone;
          if (closed || sessionDead) return { ok: false as const };
          const current = (await queued()).find(current => current.id === entry.id);
          if (!current || current.sent_seq != null) return { ok: true as const, retired: true as const };
          const known = await recoverReceipt(history, call, entry.id, current.observed_seq);
          if (known) return { ok: true as const, json: { ...known }, obsoleteAuth: false };
          const binding = entry.store_id ?? storeIdentity;
          if (!binding) return { ok: false as const };
          if (settling.has(entry.id)) return { ok: false as const };
          settling.add(entry.id);
          ownsSettlement = true;
          try {
            const started = await call({ op: "begin_send", id: entry.id });
            if (started.denied) return { ok: false as const };
            const receipt = (started.ok as { receipt?: Exclude<Write, { state: "pending" }> } | undefined)?.receipt;
            if (receipt) { const known = await recoverReceipt(history, call, entry.id, receipt.state === "sent" ? receipt.seq : undefined); return { ok: true as const, json: { ...(known ?? receipt) }, obsoleteAuth: false }; }
            ordinarySending = entry.id;
            const response = await post(`/m/${entry.op}`, { id: entry.id, args: entry.args, newIds: entry.new_ids, store_id: binding }, settled.get(entry.id)?.response);
            if (response.ok) {
              const json = response.json, why = (json.why ?? json.denied) as Refusal | undefined;
              if (!response.obsoleteAuth && !why?.retryable && (json.state === "sent" || why)) {
                try {
                  await settleReceipt(history, call, json.state === "sent"
                    ? { state: "sent", id: entry.id, seq: Number(json.seq ?? 0), replayed: true }
                    : { state: "failed", id: entry.id, why: why! });
                } catch { retryFlush(); return { ...response, persistencePending: true }; }
              }
            }
            return response;
          } finally { ordinarySending = undefined; }
        });
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
        if (!closed && !("persistencePending" in result)) {
          if (outcome.state === "sent") { if (acquire) await syncOnce(); }
          else rerunTables(predictedTables(entry.predicted));
        }
        settle?.resolve(outcome);
        emitWrite(outcome);
        if ("persistencePending" in result) return;
      } catch { retryFlush(); return; }
      finally { if (ownsSettlement) settling.delete(entry.id); }
    }
  }

  // @ref LLP 3000.007#18.2 — early replay needs the persisted store's identity and head; a replacement must retire known receipts through sync first.
  async function replayOnOpen(): Promise<boolean> {
    const capture = await captureStore();
    if (!capture || capture.backend_required || closed || sessionDead) return false;
    if (!capture.store_id) return false;
    const request = requestCredentials();
    let response: Response;
    try { response = await doFetch(`${base}/probe`, { headers: request.headers, signal: aborter.signal }); }
    catch { return !closed && !sessionDead; } // An unreachable probe leaves the kept store's offline custody intact.
    try {
      const head = await response.json();
      await refusedSession(head.denied ?? head.why, request.revision);
      if (!response.ok || head.ok !== true || closed || sessionDead || request.revision !== credentialRevision) return false;
      if (await witnessRestore(head.store_id, head.seq, capture)) return false;
      if (head.store_id !== capture.store_id) return false;
      return !closed && !sessionDead;
    } catch { return false; } // Failed validation or persistence cannot authorize exit transport.
  }

  let stopHost: void | (() => void);
  const client: LocalClient = {
    now: clock.issuedDeviceNow,
    act(op, args, options) {
      const response = closingResponses.request();
      return act(op, args, options, options?.id ?? mintId(), (path, body) => post(path, body, response), () => unavailable() ?? (link !== "online" ? offline() : undefined), async () => { if (closed) { await closingResponses.done; return response.take(); } });
    },
    async query(op, args) {
      while (true) {
        const result = await runLocal(op, args);
        const denied = unavailable(); // Rule 1: immediately before returning to the caller.
        if (denied) return { denied };
        if ((result.incarnation === incarnation && result.authority === answers.revision) || closed) return result.read;
      }
    },
    observe<A, R>(op: Query<A, R>, args: A): Observed<R> {
      const key = `${op.name}:${JSON.stringify(args)}`;
      let watch = watches.get(key);
      if (!watch) {
        watch = Object.assign(new ReadObservation<unknown>(), { op: op as Query<unknown, unknown>, args, key, tables: new Set<string>(), subscribers: new Set<() => void>(), running: false, dirty: false, expiryTimer: null, incarnation });
        watches.set(key, watch);
        void rerun(watch);
      }
      const own = watch;
      const mine = new Set<() => void>();
      return {
        getSnapshot: () => own.read(unavailable()) as Read<R>,
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
    mutate<A, R>(op: Mutation<A, R>, args: A, options?: MutateOptions): Promise<Write<R>> {
      const id = options?.id === undefined ? mintId() : options.id;
      const unavailableWhy = unavailable();
      if (unavailableWhy) {
        const failed = { state: "failed" as const, id, why: unavailableWhy };
        if (!mutationIds.knows(id)) emitLocalFailure(failed);
        return failedAdmission<R>(id, unavailableWhy);
      }
      return mutationIds.run<R>(id, op.name, args, () => client.write(id), (args, pending) => {
        const submission = ++submissions;
        const newIds: string[] = [];
        // The module mints ids for `new` from the ids we pass, so the server
        // applies the same ones; a burst takes them from one ascending clock.
        for (let n = 0; n < 8; n++) newIds.push(mintId());
        const schema = backend!.schema;
        const program = backend!.programs.find((p) => p.name === op.name);
        const predictable = Boolean(program && schema && [...operationTables(program, schema)].every((t) => schema.tables[t]?.sync));
        const request = { op: "admit", entry: { id, seq: submission, op: op.name, args, viewer: principal, now: clock.issuedDeviceNow(), new_ids: newIds, predicted: [], predictable, replay_candidate: options?.id !== undefined } satisfies Queued };
        const denied = admitNow(core, request);
        if (denied) return failedAdmission<R>(id, denied);
        return (async () => {
        const response = closingResponses.request();
        const result = new Promise<Write>((resolve) => settled.set(id, { resolve, response }));
        try {
          // @ref LLP 3000.007#20.4 — capture replay eligibility with the synchronous journal entry; recovery must also defer local refusals to the server.
          const admitted = await call(request);
          if (admitted.denied) {
            settled.delete(id);
            const failed = { state: "failed" as const, id, why: admitted.denied };
            return admitted.denied.code === "E_WRITE_ID_REUSE" ? failed : emitLocalFailure(failed);
          }
          const entry = admitted.ok as Queued;
          clock.raiseIssued(entry.now ?? 0);
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
        try {
          const outcome = await Promise.race([result, new Promise<Write>((resolve) => { timer = setTimeout(() => resolve(pending), 4_000); })]) as Write<R>;
          if (outcome.state === "pending" && closed) { await closingResponses.done; return response.write(outcome); }
          return outcome;
        }
        finally { clearTimeout(timer); settled.delete(id); }
        })();
      });
    },
    async write(id) {
      if (unavailable()) return undefined;
      const entry = (await queued()).find(entry => entry.id === id);
      if (unavailable()) return undefined;
      const seq = entry?.sent_seq ?? entry?.observed_seq;
      const receipt = seq == null ? await history.read(id) : await history.acknowledged(id, seq).catch(() => history.read(id));
      if (unavailable()) return undefined;
      if (!entry || (receipt && receipt.state !== "pending")) return receipt;
      return receipt ?? { state: "pending", id, ...(!entry.predictable && !entry.predicted.length
        ? { reason: !acquired ? "queued without a row: not acquired yet" : "queued without a row: local data does not justify prediction" } : {}) };
    },
    get acquired() { return acquired; },
    onAcquired(listener) { acquiredListeners.add(listener); return () => acquiredListeners.delete(listener); },
    async upload(bytes) {
      if (refreshing) await refreshing;
      const unavailableWhy = unavailable();
      if (unavailableWhy) return { ok: false as const, why: unavailableWhy };
      if (link !== "online") return { ok: false as const, why: { code: "E_OFFLINE", family: "link", message: "the server is unreachable; uploads wait for no link", retryable: true } };
      const request = requestCredentials();
      const sameSession = () => !refreshing && request.headers.authorization === headers.authorization;
      const uploaded = await waitForCaller(uploadAsset(base, request.headers, doFetch, bytes,
        () => !unavailable() && link === "online" && sameSession()), aborter.signal);
      const interrupted = (): Refusal | null => unavailable() ?? (!sameSession()
        ? { code: "E_AUTH", family: "auth", message: "the session changed during upload; start the upload again" } : null);
      let why = interrupted();
      if (!uploaded || why) return { ok: false, why: why! };
      if (uploaded.ok) {
        let finish!: () => void;
        const keeping = new Promise<void>(resolve => { finish = resolve; });
        active.add(keeping); // Close must wait for receipt cleanup as well as its write.
        try {
          const stored = await core.call({ op: "upload_facts", viewer: principal, asset: uploaded.asset }) as { denied?: Refusal };
          // No helper-promise gap between this check and settling upload().
          why = interrupted();
          if (why) {
            // A cleanup refusal cannot replace the upload's session refusal.
            await core.call({ op: "forget_upload_facts", viewer: principal, id: uploaded.asset.id });
            return { ok: false, why };
          }
          return stored.denied ? { ok: false, why: stored.denied } : uploaded;
        } finally { active.delete(keeping); finish(); }
      }
      await refusedSession(uploaded.why, credentialRevision);
      why = interrupted();
      if (why) return { ok: false, why };
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
      const token = session?.token;
      // Capture before endSession's synchronous callbacks. The real promise
      // remains tracked until adoption ends, including its resolved microtask.
      const rotation = rotatingSession, retire = retireRotation;
      const ending = endSession();
      if (token) void logout(base, token, doFetch);
      if (rotation) void rotation.then(refreshed => {
        if (refreshed.ok && refreshed.session.token !== token) retire?.(refreshed);
      }).catch(() => {});
      await ending;
      await client.close();
    },
    close() {
      if (closing) return closing;
      closed = true;
      closingResponses.begin();
      stopRefresh();
      stopHost?.();
      setAcquired(false);
      acquiredListeners.clear();
      stopSuspend?.();
      stopOutbox?.();
      stopClock?.();
      aborter.abort();
      if (retry) clearTimeout(retry);
      if (refreshTimer) clearTimeout(refreshTimer);
      for (const watch of watches.values()) if (watch.expiryTimer) clearTimeout(watch.expiryTimer);
      for (const watch of watches.values()) watch.publish({ denied: unavailable()! });
      for (const watch of watches.values()) notify(watch);
      watches.clear();
      linkListeners.clear();
      sessionListeners.clear();
      viewerListeners.clear();
      writeListeners.clear();
      // Network waits cancel promptly. Already delivered responses retain local
      // receipt/settlement custody until that bounded device work finishes.
      for (const [id, { resolve }] of settled) if (!settling.has(id)) resolve({ state: "pending", id });
      closing = (async () => {
        await Promise.allSettled([following, syncing, flushing, persistingSession, endingSession, ...active]);
        for (const [id, { resolve }] of settled) resolve({ state: "pending", id });
        await media?.close();
        // A failed admission can leave storage unavailable until reopen; clock
        // bookkeeping must still release the core and its recovery journal.
        await Promise.allSettled([clock.detach()]);
        await core.close();
      })().finally(() => { settled.clear(); closingResponses.finish(); });
      return closing;
    },
  };
  // @ref LLP 3000.007#20.4 — recover existing IDs before accepting a fresh synchronous web admission; custody stays with the outbox and its receipt window.
  await queued();
  const keptWrites = (await call({ op: "meta", key: "write-history" })).ok as string | null;
  for (const write of keptWrites ? JSON.parse(keptWrites) as Write[] : []) mutationIds.remember(write.id);
  seq = Number(((await call({ op: "state" })).ok as { watermark?: number } | undefined)?.watermark ?? 0);
  const prepared = startDeferred(options);
  function listenForExit() {
    if (!core.onSuspend || stopSuspend || closed || sessionDead) return;
    sendingAllowed = true;
    const sendOnExit = exitTransport(doFetch, base, aborter.signal, exitRefusalSettlement({
      closed: () => closed, owners: settling, active,
      commit: async write => {
        const known = await history.read(write.id, true);
        if (known && known.state !== "pending") return false;
        const applied = await call({ op: "settle_exit", write });
        if (applied.denied) throw new Error(applied.denied.message);
        return applied.ok === true;
      },
      publish: write => {
        settled.get(write.id)?.resolve(write); settled.delete(write.id);
        emitWrite(write);
        for (const watch of watches.values()) void rerun(watch);
      },
    }));
    stopSuspend = core.onSuspend((entries, beginSend) => {
      const request = requestCredentials();
      // @ref LLP 3000.007#20.4 — document teardown may abort the ordinary request: only its same durable head may overlap the keepalive retry.
      exitDone = sendOnExit(entries, request.headers, () => (ordinarySending === undefined || ordinarySending === entries[0]?.id) && !history.hasUnpersisted(entries[0]!.id) && !closed && !sessionDead && !rotating && credentialRevision === request.revision && beginSend());
    });
  }
  flushRecovered = () => { void flush(); };
  const start = async () => {
    if (closed) return;
    if (prepared && session && session.kind !== "action" && session.expiresAt - clock.issuedDeviceNow() <= REFRESH_BEFORE_EXPIRY_MS) await refreshCurrent();
    // Exit and ordinary replay share the same startup checks, even offline.
    // Native owners retain their existing snapshot/receipt coordination first.
    const replayAllowed = core.onSuspend && await replayOnOpen();
    if (replayAllowed) listenForExit();
    // Install the same-head exit retry before awaiting ordinary delivery.
    // Slow delivery and snapshots must not consume the page's exit opportunity.
    if (replayAllowed && link === "online") await flushOnce(false);
    if (link === "online") await syncOnce();
    follow();
    void flush();
    scheduleRefresh();
  };
  progress.bind(client);
  trackRotation(client, () => refreshing);
  trackClose(client, closingResponses);
  if (!deferStart(options, start)) await start();
  stopHost = core.onClient?.(client, base);
  return client;
  } catch (error) {
    stopSuspend?.();
    stopOutbox?.();
    stopClock?.();
    aborter.abort();
    // Opening the device transfers its lifetime to this constructor. Until a
    // client is returned, every later startup failure must release it here.
    try { await media?.close(); await core.close(); } catch {}
    throw error;
  }
}
