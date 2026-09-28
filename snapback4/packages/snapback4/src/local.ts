import { readWithAdmissionRetry, transportRefusal, jitter, retryAfter, pauseOverload } from "./http-response.ts";
import { SearchBound, refreshSearchRoots, searchReplyIdentity } from "./local-search.ts";
import { deliveryCommit } from "./local-device.ts";
import { deviceRestore, coldRestoreWitness, restoreWitness } from "./device-restore.ts";
import { deviceControl, coldSnapshot, coldReplyStatus, type DeviceControlSnapshot } from "./device-control.ts";
import { publishDelivery } from "./local-publication.ts";
import { localDelivery } from "./local-delivery.ts";
import { deferReadNotifications } from "./read-notifications.ts";
import { armReadExpiry, correctReadExpiries, type ReadDeadlines } from "./read-expiry.ts";
import { bindWatchPeek, observationKey, endLingering, closeWatchAnswers, observeWatch } from "./observe-watch.ts";
import { EphemeralReads, type EphemeralRequest } from "./ephemeral-reads.ts";
import { ephemeralLane, routeMutations } from "./ephemeral.ts";
import { admitNow, failedAdmission } from "./admission.ts";
import { attachAdmissionAuthority } from "./admission-authority.ts";
import { acquisitionProgress } from "./acquisition.ts";
import { readResidency } from "./residency.ts";
import { serverClock } from "./clock.ts";
import { defaultFetch } from "#fetch";
import { ClosingResponses, trackClose, type ClosingResponse } from "./closing-responses.ts";
import type { Queued, StoreCapture } from "./local-types.ts";
import { deferStart, startDeferred, trackRotation } from "./client-start.ts";
// The local-first tier (LLP 3000 §7, one implementation): the device is
// the Rust module — the partition in its own store, the stream applied,
// the outbox kept, queries and predictions answered — and this client is
// what remains: sessions, links, transport and reads. The module is
// reached through one JSON call (`DeviceCore`), so the wasm device on the
// web (`snapback4/web`), the Expo module (`snapback4-expo`) and the
// `snapback4 device` process for Node (`snapback4/native`) all fit.
import { evaluateLocal } from "./local-query.ts";
import { ReadObservation } from "./read-observation.ts";
import { postForCaller, waitForCaller } from "./request-wait.ts";
import { runsOnServer, predictedTables, armLocalPresence, notifyLocalWatch as notify, rerunLocalTables, LocalReads, type LocalWatch as Watch } from "./local-reads.ts";
import { nativeInstaller } from "./local-native.ts";
import { BackendAuthError, loadBackend } from "./local-backend.ts";
import { mutationWaitSeconds, MutationIds, WriteHistory } from "./writes.ts";
import { localPendingHolds, localPendingWrites, pendingChanges } from "./pending-writes.ts";
import { changeFeed } from "./changes.ts";
import { explicitSync, requireSyncProtocol, responsePageTooLarge, syncTransport, type SyncPage } from "./local-sync.ts";
import { exitTransport } from "./local-exit.ts";
import { exitRefusalSettlement } from "./local-exit-settlement.ts";
import { deliverAcknowledgedReceipt, lookupWrite, readQueued, receiptBatch, recoverReceipt, retiredReceipts, settleReceipt, successSequence, syncSettledWrites, terminalDeviceCall } from "./local-receipts.ts";
import type { ObserveOptions, Client, Link, MutateOptions, Mutation, Observed, Principal, Query, Read, Refusal, Write } from "./contract.ts";
import { MediaCache, assetRetention, changesMediaAuthority, type MediaStorage, type AssetRetention } from "./local-assets.ts";
export type { AcquisitionMarker } from "./local-sync.ts";
export type { MediaStorage, AssetRetention } from "./local-assets.ts";
import { mintId } from "./client.ts";
import { operationTables, type BackendJson, type ProgramJson, type SchemaJson } from "./backend.ts";
import { assetSource, fetchAsset, uploadAsset } from "./assets.ts";
import { act } from "./actions.ts";
import { defaultSessionStore, forgetSession, guest, keepSession, logout, logoutAll as revokeAllSessions,
  refreshSession as rotateSession, restoreSession, type Session, type SessionStore, type SignIn } from "./auth.ts";
export type { DeviceCore, DeviceOpener, DeviceOpening, LocalOptions, LocalClient } from "./local-device.ts";
import type { LocalOptions, LocalClient } from "./local-device.ts";
// Fill the row allowance; fetchSync and E_BOUND still bound oversized pages.
const PAGE = 10000;
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
  const pending = pendingChanges();
  let holds!: ReturnType<typeof localPendingHolds>;
  let setLink!: (next: Link) => void;
  const emitWrite = <T extends Exclude<Write, { state: "pending" }>>(write: T): T => {
    mutationIds.finish(write.id); holds.forget(write.id);
    pending.notify();
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
  let link: Link = "online", linkRevision = 0;
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
  let deliveryQueue: ReturnType<typeof localDelivery> | undefined;
  let deliveryWitness = false;
  try {
  holds = localPendingHolds(call, () => closed || sessionDead ? undefined : `${credentialRevision}:${incarnation}`, pending.notify);
  attachAdmissionAuthority(core, options);
  history = new WriteHistory({
    read: async () => (await call({ op: "meta", key: "write-history" })).ok as string | null,
    lookup: async () => (await call({ op: "meta", key: "write-history", lookup: true })).ok as string | null,
    save: async value => {
      const reply = await terminalDeviceCall(committed => call({ op: "keep_write", value }, undefined, committed), () => {});
      if (reply.denied) throw new Error(`${reply.denied.code}: ${reply.denied.message}`);
    },
  });
  await requireSyncProtocol(core);
  const state = await call({ op: "state" });
  generation = Number((state.ok as { generation?: number } | undefined)?.generation ?? 0);
  if (!backend || Number(backend.generation ?? 0) !== generation) backend = (await call({ op: "backend" })).ok as BackendJson;
  stopOutbox = core.onOutbox?.(time => { clock.raiseIssued(time ?? 0); pending.notify(); flushRecovered?.(); });
  await clock.attach(core);
  if (session && session.expiresAt <= clock.issuedDeviceNow()) {
    await forgetSession(base, sessions);
    throw new Error("createLocalClient: E_AUTH: this session expired; sign in again");
  }
  media = new MediaCache(core, principal, retention, clock.issuedDeviceNow);
  await media.open();
  const installNative = nativeInstaller(() => ({ backend, generation, link, closed }), next => { backend = next; }, call, doFetch, base, requestCredentials);
  let nativeReady = await installNative();
  let networkTail: Promise<unknown> = Promise.resolve();
  let networkWork = 0;
  function network<T>(body: () => Promise<T>): Promise<T> {
    networkWork++;
    const result = networkTail.then(body);
    const release = () => { networkWork--; deliveryQueue?.available(); };
    void result.then(release, release);
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
  const ephemeralReads = new EphemeralReads(aborter.signal);
  const ephemeral = ephemeralLane({ url: base, fetch: doFetch, headers: () => ({ ...headers }),
    link: () => link, mint: mintId, signal: aborter.signal, offline: () => setLink("offline"),
    unavailable: () => unavailable() ?? partitionDenied, storeId: () => storeIdentity });
  const settled = new Map<string, { resolve: (write: Write) => void; response: ClosingResponse }>();
  const completeWrite = (write: Exclude<Write, { state: "pending" }>) => {
    settled.get(write.id)?.resolve(write); settled.delete(write.id); emitWrite(write);
  };
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
    sweepExpiries();
    void media?.reconcile().catch(() => {});
    scheduleRefresh();
  });
  await refreshAcquired();
  // A kept sent entry can disappear on the first catch-up, before a screen mounts.
  for (const entry of await queued()) {
    const seq = successSequence(entry);
    if (entry.sent_seq == null && seq != null) { const receipt = await history.acknowledged(entry.id, seq, true); if (receipt) await history.keep(receipt); }
  }
  // @ref LLP 3000.007#18.2 — observation fences answers before queued sync can retire the partition.
  function observeIncarnation(id?: string, force = false, delivery?: (() => void)[]) {
    if (!force && (id === undefined || id === storeIdentity)) return;
    const resetProgress = force || storeIdentity !== undefined;
    storeIdentity = id;
    incarnation++; holds.clear();
    deliveryWitness = false; deliveryQueue?.fence();
    partitionCurrent = false;
    const wasAcquired = acquired;
    acquired = false;
    if (resetProgress) progress.reset();
    caughtUp = false;
    identityChecked = false;
    seq = 0;
    lastSyncAt = 0;
    const approvals = deferReadNotifications(() => { endLingering(watches.values()); answers.clear(watches.values()); });
    // Finish invalidating every answer before invoking application callbacks.
    const deliver = () => {
      approvals();
      if (wasAcquired) for (const listener of acquiredListeners) listener(false);
      for (const watch of watches.values()) {
        notify(watch);
        void rerun(watch);
      }
    };
    if (delivery) delivery.push(deliver); else deliver();
  }
  function invalidateAnswers(delivery: (() => void)[], operation: string) {
    const approvals = deferReadNotifications(() => answers.committed(watches.values(), operation));
    delivery.push(() => { approvals(); for (const watch of watches.values()) { notify(watch); void rerun(watch); } });
    return delivery;
  }
  function refuseRestore(denied?: Refusal) {
    if (denied?.code !== "E_STORE_RESTORE") return;
    partitionDenied = denied;
    deliveryQueue?.fence(true);
    pending.notify();
    observeIncarnation(storeIdentity, true);
    for (const watch of watches.values()) { watch.publish({ denied }); notify(watch); }
  }
  const witnessRestore = restoreWitness(call, () => generation, refuseRestore,
    () => { deliveryWitness = true; deliveryQueue?.available(); });
  const witnessColdRestore = coldRestoreWitness((evidence, validated) => core[deviceRestore]!(evidence, validated),
    () => partitionDenied, refuseRestore, () => { partitionDenied = null; pending.notify(); if (!closed && !sessionDead) void client.sync().catch(() => {}); });
  async function captureStore(): Promise<StoreCapture | undefined> {
    const reply = await call({ op: "sync_state", capture: false });
    if (reply.denied) return;
    const capture = reply.ok as StoreCapture;
    if (capture.restore_refusal) { refuseRestore(capture.restore_refusal); return; }
    return capture;
  }
  async function call(request: Record<string, unknown>, committedTables?: Set<string>, terminalCommit?: (reply: { ok?: unknown; denied?: Refusal }) => void): Promise<{ ok?: unknown; denied?: Refusal }> {
    if (["observe_store", "apply", "adopt", "settle_exit"].includes(String(request.op))) while (history?.hasUnpersisted()) await history.persistPending();
    let observed = false;
    const delivery: (() => void)[] = [];
    const deliver = () => { for (const notify of delivery.splice(0)) notify(); };
    const committed = (result: { ok?: unknown; denied?: Refusal }) => {
      if (observed) return;
      observed = true;
      terminalCommit?.(result);
      if (!result.denied && ["apply", "admit", "settle", "settle_exit", "adopt", "observe_store", "begin_send", "hold_write", "keep_write"].includes(String(request.op))) delivery.push(pending.notify);
      // @ref LLP 3000.001#repair-b-never-install-a-confirmed-image-over-a-row-a-live-prediction-writes — preserve publication invalidations before fallible post-commit work.
      if (!result.denied && ["apply", "admit", "settle", "settle_exit", "clear_rows"].includes(String(request.op))) invalidateAnswers(delivery, String(request.op));
      if (!result.denied && request.op === "apply") {
        for (const table of (result.ok as { touched?: string[] } | undefined)?.touched ?? []) committedTables?.add(table);
        delivery.push(() => { if (!closed && !sessionDead) progress.page(request.page as Record<string, unknown>, request.first === true); });
      }
      // A committed replacement has already retired the client's partition.
      // Fence it before even media reconciliation can fail; native identity
      // is read separately and must never be a prerequisite for invalidation.
      if (!result.denied && request.op === "observe_store" && (result.ok as { reset?: boolean } | undefined)?.reset) {
        observeIncarnation(undefined, true, delivery);
        delivery.push(...retiredReceipts(history, (result.ok as { retired: Record<string, number> }).retired, completeWrite));
      }
      if (!result.denied && request.op === "adopt") observeIncarnation(storeIdentity, true, delivery);
    };
    if (deliveryQueue?.enabled) request = { ...request, delivery_now: clock.issuedDeviceNow() };
    const work = typeof request.now === "number" ? clock.persist().then(() => core.call(request, committed)) : core.call(request, committed);
    active.add(work);
    try {
      const result = (await work) as { ok?: unknown; denied?: Refusal };
      committed(result);
      deliver();
      if (!result.denied && ["apply", "settle", "withdraw", "dequeue"].includes(String(request.op))) deliveryQueue?.published();
      if (!result.denied && ["apply", "observe_store", "adopt", "clear_rows", "admit", "settle", "settle_exit"].includes(String(request.op)) && changesMediaAuthority(String(request.op), result.ok)) await media?.reconcile();
      return result;
    }
    finally { active.delete(work); deliver(); }
  }
  let transportFailure: Refusal | undefined;
  const offline = (): Refusal => transportFailure ?? transportRefusal();
  const unavailable = (): Refusal | null => closed ? { code: "E_CLOSED", family: "client", message: "this client is closed" } : sessionDead ? { code: "E_AUTH", family: "auth", message: "sign in to continue" } : null;
  setLink = (next: Link) => {
    if (closed || (sessionDead && next !== "signed-out")) return;
    if (link === next) return;
    link = next;
    linkRevision++;
    if (next !== "online") {
      identityChecked = false;
      const deliver = deferReadNotifications(() => {
        if (next === "signed-out") endLingering(watches.values());
        for (const watch of watches.values()) {
          if (next === "signed-out") watch.publish({ denied: unavailable()! });
          else if ("data" in watch.snapshot && watch.snapshot.fresh) watch.publish({ loading: true });
        }
      });
      deliver();
      for (const watch of watches.values()) notify(watch);
    }
    if (next === "signed-out") pending.notify();
    ephemeral.linkChanged();
    for (const listener of linkListeners) listener(next);
    if (next === "online") { deliveryQueue?.reconnect(); void flush(); }
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
    void deliveryQueue?.stop();
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
      sessionDead = true; holds.clear();
      session = null;
      rotating = false;
      credentialRevision += 1;
      // A dead session refreshes nothing (LLP 3000.018 §3.2).
      for (const watch of watches.values()) { if (watch.presenceRefresh) clearTimeout(watch.presenceRefresh); watch.presenceRefresh = null; watch.presenceEvery = undefined; }
      stopRefresh();
      if (refreshTimer) { clearTimeout(refreshTimer); refreshTimer = undefined; }
      delete headers.authorization;
      delete headers["x-snapback-persona"];
      setLink("signed-out");
      setAcquired(false);
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
    const approvals = deferReadNotifications(() => {
      endLingering(watches.values());
      for (const watch of watches.values()) { watch.reset({ loading: true }); scheduleExpiry(watch, null); }
    });
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
    approvals();
    for (const watch of watches.values()) notify(watch);
    void work.finally(() => {
      rotating = false;
      if (refreshing === work) refreshing = null;
      if (rotatingSession === rotation) rotatingSession = null;
    }).catch(() => {});
    return work;
  };
  // A quiet request is a background presence refresh: its failure retries on the
  // refresh timer and says nothing about the link (LLP 3000.018 §3.2).
  function post(path: string, body: unknown, captured?: ClosingResponse, eph?: EphemeralRequest, quiet = false, control?: DeviceControlSnapshot, decode?: (response: Response) => Promise<Record<string, unknown>>) {
    const work = sendPost(path, body, captured, eph, quiet, control, decode);
    active.add(work);
    void work.finally(() => active.delete(work)).catch(() => {});
    return work;
  }
  async function sendPost(path: string, body: unknown, captured?: ClosingResponse, eph?: EphemeralRequest, quiet = false, control?: DeviceControlSnapshot, decode?: (response: Response) => Promise<Record<string, unknown>>): Promise<{ ok: true; json: Record<string, unknown>; obsoleteAuth: boolean; searchIdentity?: string | undefined } | { ok: false }> {
    if (closed || sessionDead || partitionDenied?.code === "E_STORE_RESTORE") return { ok: false };
    try {
      const capture = control ?? (path.startsWith("/q/") ? await captureStore() : undefined);
      if (partitionDenied?.code === "E_STORE_RESTORE") return { ok: false };
      const request = requestCredentials();
      const reply = await postForCaller(doFetch, base, path, request.headers, body, eph?.signal ?? aborter.signal, (json, status) => captured?.capture(json, status), decode);
      if (!reply || (eph && !ephemeralReads.current(eph))) return { ok: false };
      const { response, json } = reply;
      const why = (json.denied ?? json.why) as Refusal | undefined;
      if (why?.code === "E_HTTP_RESPONSE" && response.status >= 500) { transportFailure = why; if (!quiet) setLink("offline"); return { ok: false }; }
      if (path.startsWith("/m/") && why?.retryable && !closed && !sessionDead && request.revision === credentialRevision) {
        await holds.record((body as { id: string }).id, why.code);
        retryAfterMs = retryAfter(response.headers.get("retry-after")); retryOverload = why.code === "E_RATE_LIMIT";
      }
      // I12: committed writes outlive their caller; reads require the live view.
      if (closed && !path.startsWith("/m/") && !path.startsWith("/a/")) return { ok: false };
      const denied = (json.denied ?? json.why) as Refusal | undefined;
      const obsoleteAuth = denied?.code === "E_AUTH" && (request.revision !== credentialRevision || rotating);
      await refusedSession(denied, request.revision);
      if (link !== "online") setLink("online");
      if (denied && typeof json.store_id !== "string") return { ok: true, json, obsoleteAuth };
      if (control) {
        const status = coldReplyStatus(control, json);
        const now = core[deviceControl]?.();
        if (status === "restore" && request.revision === credentialRevision && (!now || (now.transfer_store_id ?? now.store_id) === json.store_id)) {
          const work = witnessColdRestore({ storeId: String(json.store_id), head: Number(json.head ?? json.seq), capture: control }, !now);
          active.add(work); void work.finally(() => active.delete(work)).catch(() => {});
        }
        if (status !== "match") return { ok: false };
      } else if (path.startsWith("/q/")) return { ok: true, json, obsoleteAuth, searchIdentity: await searchReplyIdentity(capture, json, generation, witnessRestore) };
      return { ok: true, json, obsoleteAuth };
    } catch (error) {
      if (error instanceof SearchBound) throw error;
      transportFailure = transportRefusal(error);
      if (!quiet && (!eph || ephemeralReads.current(eph))) setLink("offline");
      return { ok: false };
    }
  }
  async function refusePartition(denied: Refusal, revision: number) {
    await refusedSession(denied, revision);
    if (!denied.retryable && partitionDenied?.code !== "E_STORE_RESTORE") {
      if (!partitionDenied) console.error(`snapback4: the server refused the partition: ${denied.code}: ${denied.message}`);
      partitionDenied = denied;
      if (denied.code === "E_STORE_RESTORE") pending.notify();
      for (const watch of watches.values()) void rerun(watch);
    }
  }
  let syncing: Promise<boolean> | null = null;
  const syncAfterCall = explicitSync(() => syncing, syncOnce);
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
          const { response, json } = await readWithAdmissionRetry(() => fetchSync(`${base}/sync`, { method: "POST", headers: request.headers, signal: aborter.signal }, { generation: capturedGeneration, from: watermark, limit: pageLimit, after: after ?? null, stream: !snapshotRequest && (catchingUp || (after === undefined && publicationOutstanding)), pending, ...(requestedStore ? { store_id: requestedStore } : {}) }), () => !closed && !sessionDead && request.revision === credentialRevision, aborter.signal);
          if ((json.denied as Refusal | undefined)?.code === "E_HTTP_RESPONSE" && response.status >= 500) { transportFailure = json.denied as Refusal; setLink("offline"); return false; }
          page = json as SyncPage;
          page.send_revision = send_revision;
          page.pending_through = pending_through;
          page.pending_complete = pending_complete;
          page.pending_bound = pending_bound;
          page.requested_watermark = watermark;
          page.captured_restore_watermark = restore_watermark;
          page.captured_restore_images_at = restore_images_at;
          page.captured_watermark = capturedWatermark;
          pageRevision = request.revision;
        } catch (error) {
          transportFailure = transportRefusal(error);
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
          if (observed.denied || partitionDenied?.code === "E_STORE_RESTORE") { refuseRestore(observed.denied); return false; }
          const observation = observed.ok as { reset: boolean; backend_required?: boolean; send_revision: number; retired: Record<string, number>; adoption_capture?: Record<string, string | null> };
          page.send_revision = observation.send_revision;
          adoptionCapture = observation.adoption_capture;
          // Observation reports shared metadata; keep this interpreter's adoption requirement.
          backendRequired ||= !!observation.backend_required;
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
            for (const watch of watches.values()) void rerun(watch);
          }
        }
        if (link !== "online") setLink("online");
        if (partitionDenied?.code === "E_STORE_RESTORE") return false;
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
            if (adopted.denied || partitionDenied?.code === "E_STORE_RESTORE") return false;
            backend = nextBackend;
            generation = Number(nextBackend.generation ?? pageGeneration);
            for (const watch of watches.values()) watchEphemeral(watch);
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
      } else if ((json.denied as Refusal | undefined)?.code !== "E_RATE_LIMIT" && (response.status !== 200 || json.ok !== true)) setLink("offline");
    } catch (error) { transportFailure = transportRefusal(error); setLink("offline"); }
  }
  const changes = changeFeed(doFetch, base, aborter.signal, () => setLink("offline"), () => { if (!closed && !sessionDead && link === "offline") void network(probe); });
  async function waitForChange(): Promise<boolean> {
    if (link !== "online") {
      await new Promise((r) => setTimeout(r, 1000));
      if (!closed && !sessionDead) await probe();
      return false;
    }
    if (!identityChecked) { await probe(); return !caughtUp; }
    const eph = ephemeralReads.pollRequest();
    try {
      const request = requestCredentials();
      const changeIncarnation = incarnation;
      const capture = await captureStore();
      if (!capture) return false;
      const { response, json } = await changes(seq, options.waitSeconds ?? 25, request.headers, storeIdentity, Object.values(backend!.schema.tables).some(table => table.ephemeral) ? ephemeralReads.parameters() : undefined, eph.signal);
      if (!ephemeralReads.current(eph)) return false;
      if (await pauseOverload(response, json.denied, aborter.signal)) return false;
      if (!response.ok || json.denied) {
        await refusedSession(json.denied, request.revision);
        if (json.denied?.code === "E_AUTH") return false;
        throw new Error(`changes: HTTP ${response.status}`);
      }
      if (closed || changeIncarnation !== incarnation || request.revision !== credentialRevision) return false;
      if (!ephemeralReads.changed(eph, json.ephemeral)) return false;
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
    } catch (error) {
      transportFailure = transportRefusal(error);
      if (closed || !ephemeralReads.current(eph)) return false;
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
  function runLocal<R>(op: Query<unknown, R>, args: unknown, watch?: Watch, quiet = false, backgroundWatch?: Watch) {
    // @ref LLP 3000.018#3.2 — each evaluation attempt, a retry included, is a new read for the remembered answers.
    let answerCache = answers.serverAnswers.view();
    const cold = coldSnapshot(core[deviceControl], !!core[deviceRestore] && !!(watch ?? backgroundWatch)?.serverOnly && !!syncing && !acquired, generation);
    const bypass = cold?.control;
    if (cold) clock.raiseIssued(cold.snapshot.issuedFloor);
    const queryEnvironment = {
      coldRead: bypass,
      get backend() { return backend!; },
      get partitionDenied() { return partitionDenied; },
      get credentialRevision() { return credentialRevision; },
      get incarnation() { return incarnation; },
      get authority() { return answers.revision; },
      get refreshing() { return refreshing; },
      get link() { return link; },
      get linkRevision() { return linkRevision; },
      get caughtUp() { return caughtUp; },
      get identityChecked() { return identityChecked; },
      get lastSyncAt() { return lastSyncAt; },
      get partitionCurrent() { return partitionCurrent; },
      get nativeReady() { return nativeReady; },
      set nativeReady(value: boolean) { nativeReady = value; },
      principal, signal: aborter.signal, unavailable, queued, call, installNative, notify,
      post: (path: string, body: unknown, captured?: ClosingResponse, eph?: EphemeralRequest) => post(path, body, captured, eph, quiet, bypass ? core[deviceControl]?.() : undefined),
      searchPost: (path: string, body: unknown, decode: (response: Response) => Promise<Record<string, unknown>>) => post(path, body, undefined, undefined, quiet, undefined, decode),
      refreshSearch: (name: string) => refreshSearchRoots(watches, name, backend?.schema.operations?.[name]?.search?.cursor, notify, rerun),
      deviceNow: clock.issuedDeviceNow, serverNow: clock.estimatedServerNow,
      offline, get serverAnswers() { return answerCache; }, ephemeralReads,
    };
    const work = (async () => {
      for (let attempt = 0; ; attempt++) {
        const revision = incarnation, authority = answers.revision;
        const result = { ...await evaluateLocal(queryEnvironment, op, args, revision, authority, watch), controlCurrent: bypass?.current };
        const denied = unavailable(); // Rule 1 also holds across the caller's await.
        if (denied) return { ...result, read: { denied }, incarnation: revision, authority };
        if (result.ephemeralStale || (result.ephemeralRequest && !ephemeralReads.current(result.ephemeralRequest))) {
          if (attempt >= 3) return { ...result, read: { loading: true } as Read<R>, incarnation: revision, authority };
          await new Promise(resolve => setTimeout(resolve, 25 * 2 ** attempt));
          answerCache = answers.serverAnswers.view();
          continue;
        }
        if ((revision === incarnation && authority === answers.revision) || closed || (watch && watches.get(watch.key) !== watch)) return { ...result, incarnation: revision, authority };
        // A mixed page never retries its server invocation after a delivery race.
        if (result.searchAttempt) return { ...result, read: { loading: true } as Read<R>, incarnation, authority: answers.revision };
        answerCache = answers.serverAnswers.view();
      }
    })();
    active.add(work); void work.finally(() => active.delete(work)).catch(() => {}); return work;
  }
  function publishLocal(result: Awaited<ReturnType<typeof runLocal>>, publish: () => boolean, watch?: Watch) {
    return publishDelivery(deliveryQueue, result, () => !unavailable()
      && result.incarnation === incarnation && result.authority === answers.revision
      && (result.credential === undefined || result.credential === credentialRevision)
      && (!result.controlCurrent || result.controlCurrent())
      && (!result.ephemeralRequest || ephemeralReads.current(result.ephemeralRequest))
      && (!("data" in result.read) || ((result.serverExpiry == null || result.serverExpiry > clock.estimatedServerNow())
      && (result.localWakeup || result.nextExpiry === null || result.nextExpiry > clock.issuedDeviceNow()))), publish, { client, watch });
  }
  function watchEphemeral(watch: Watch) {
    const tables = backend!.schema.operations?.[watch.op.name]?.ephemeralReads ?? [];
    if (!tables.length) { ephemeralReads.remove(watch); return; }
    ephemeralReads.add(watch, tables, reset => {
      const deliver = reset ? watch.reset({ loading: true }, true) : undefined;
      if (reset) scheduleExpiry(watch, null);
      return () => {
        deliver?.();
        if (watches.get(watch.key) !== watch) return;
        if (reset) notify(watch);
        void rerun(watch);
      };
    });
  }
  function rerunTables(tables: Set<string>) { rerunLocalTables(watches.values(), tables, rerun); }
  function scheduleExpiry(watch: Watch, nextExpiry: number | null, serverExpiry?: number | null, localWakeup = false) {
    const deadlines = { device: nextExpiry, server: serverExpiry ?? null, localWakeup };
    armReadExpiry(watch, deadlines, clock,
      () => !closed && watches.get(watch.key) === watch, sweepExpiries,
      (serverDue, now) => answers.expire(watch, serverDue, now));
  }
  function sweepExpiries() {
    correctReadExpiries(watches.values(), clock, withdrawExpiry,
      (watch, d) => scheduleExpiry(watch, d.device, d.server, d.localWakeup),
      watch => { if (watches.get(watch.key) === watch) void rerun(watch); });
  }
  function withdrawExpiry(watch: Watch, d: ReadDeadlines, serverDue: boolean, serverNow: number): () => void {
    // @ref LLP 3000.018#3.2 — fence every displayed expiry, preserving newer memory and its cuts.
    answers.expire(watch, serverDue, serverNow);
    // @ref LLP 3000.007#6.5 — Rule 5: expiry ends stale retention before asynchronous recovery.
    const denied = unavailable(), reset = denied || !d.localWakeup || serverDue;
    let deliver: (() => void) | undefined;
    if (denied) deliver = watch.reset({ denied }, true);
    else if (reset) deliver = watch.expire();
    else scheduleExpiry(watch, null, d.server, d.localWakeup); // A local wakeup preserves the server deadline.
    return () => { deliver?.(); if (reset && watches.get(watch.key) === watch) notify(watch); };
  }
  function armPresence(watch: Watch) { armLocalPresence(watch, !!unavailable(), !!syncing && !acquired, () => { void refreshPresence(watch); }); }
  // @ref LLP 3000.018#3.2 — a presence refresh evaluates in the background and publishes only an answer
  // that nothing replaced meanwhile: expiry, invalidation and store replacement keep their own withdrawal.
  async function refreshPresence(watch: Watch) {
    if (closed || sessionDead || watches.get(watch.key) !== watch) return;
    if (watch.running) return; // The re-run in flight re-arms the refresh when it settles.
    const shown = watch.snapshot;
    try {
      const result = await runLocal(watch.op, watch.args, undefined, true, watch);
      const { read, tables, nextExpiry, serverExpiry, localWakeup, refresh: after, served, ephemeralRequest, incarnation: revision, authority } = result;
      if (closed || sessionDead || watches.get(watch.key) !== watch) return;
      // A reply that a newer publication or re-run overtook decides nothing: the newer one armed the timer.
      if (watch.snapshot !== shown || watch.running) return;
      if (served && revision === incarnation && authority === answers.revision && (!ephemeralRequest || ephemeralReads.current(ephemeralRequest))) {
        publishLocal(result, () => {
          if (watches.get(watch.key) !== watch || watch.snapshot !== shown || watch.running) return false;
          watch.serverRead = true; watch.serverOnly = result.serverOnly === true;
          ephemeralReads.incomplete(watch, "data" in read && !read.complete);
          watch.tables = tables;
          scheduleExpiry(watch, nextExpiry, serverExpiry, localWakeup);
          const denied = unavailable();
          watch.publish(denied ? { denied } : read);
          notify(watch);
          watch.presenceEvery = after;
          return true;
        }, watch);
      }
    } catch {}
    if (watches.get(watch.key) === watch && !watch.running) armPresence(watch);
  }
  async function rerun(watch: Watch) {
    if (closed) return;
    if (watch.retain) { watch.reload(); notify(watch); }
    if (watch.running) {
      watch.dirty = true;
      return;
    }
    watch.running = true;
    const resetVersion = watch.resetVersion;
    let retryExpired = false;
    try {
      const result = await runLocal(watch.op, watch.args, watch);
      const { read, tables, nextExpiry, serverExpiry, localWakeup, refresh: after, served, ephemeralRequest, incarnation: revision, authority } = result;
      if (revision !== incarnation || authority !== answers.revision || (resetVersion !== watch.resetVersion)) { watch.dirty = true; return; }
      if (closed || watches.get(watch.key) !== watch) return;
      if (ephemeralRequest && !ephemeralReads.current(ephemeralRequest)) { watch.dirty = true; return; }
      retryExpired = result.retryExpired === true;
      if (!retryExpired) watch.expiredRetries = 0;
      const accepted = publishLocal(result, () => {
        if (closed || watches.get(watch.key) !== watch || resetVersion !== watch.resetVersion) return false;
        if (served || !result.controlCurrent) { watch.serverRead = served === true; watch.serverOnly = result.serverOnly === true; }
        ephemeralReads.incomplete(watch, "data" in read && !read.complete);
        watch.incarnation = revision;
        watch.tables = tables;
        // @ref LLP 3000.018#3.2 — a server's answer decides the refresh interval; one from this device keeps it.
        if (served) watch.presenceEvery = after;
        armPresence(watch);
        scheduleExpiry(watch, nextExpiry, serverExpiry, localWakeup);
        if (watch.snapshot !== read) {
          const denied = unavailable(); // Rule 1: immediately before notifying observers.
          watch.publish(denied ? { denied } : read);
          notify(watch);
        }
        return true;
      }, watch);
      if (!accepted) { watch.dirty = true; retryExpired = true; }
    } catch {
      if (!closed && watches.get(watch.key) === watch) {
        watch.publish({ loading: true }); notify(watch);
        armPresence(watch);
      }
    } finally {
      // @ref LLP 3000.019#3.3 — keep the expired value withdrawn while its live observation recovers.
      if (retryExpired && !closed && watches.get(watch.key) === watch) {
        watch.expiredRetries = Math.min((watch.expiredRetries ?? 0) + 1, 7);
        const pause = Math.min(25 * 2 ** (watch.expiredRetries - 1), 1000);
        await new Promise(resolve => setTimeout(resolve, pause));
      }
      watch.running = false;
      const dirty = watch.dirty;
      watch.dirty = false;
      if ((dirty || retryExpired) && !closed && !sessionDead && watches.get(watch.key) === watch) {
        void rerun(watch);
      }
    }
  }
  function queued() { return readQueued(call, mutationIds, history, settling); }
  let reconcileNeeded = false; // @ref LLP 3000.019#3.3 — failed housekeeping retries without gating dispatch.
  const receiptCall = (request: Record<string, unknown>) => terminalDeviceCall(
    committed => call(request, undefined, committed), () => { reconcileNeeded = true; retryFlush(); });
  let retry: ReturnType<typeof setTimeout> | undefined;
  let retryMs = 250;
  let retryAfterMs = 0, retryOverload = false;
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
        // A later admission cannot bypass the head's retryable hold/backoff.
        } while (flushAgain && !retry && link === "online" && !closed);
      } catch { retryFlush(); }
    })();
    flushing = run;
    void run.finally(() => { if (flushing === run) flushing = null; deliveryQueue?.available(); }).catch(() => {});
    return run;
  }
  function retryFlush() {
    if (closed || sessionDead || retry || partitionDenied?.code === "E_STORE_RESTORE") return;
    retry = setTimeout(() => { retry = undefined; void flush(); }, Math.max(retryOverload ? jitter(retryMs) : retryMs, retryAfterMs));
    retryAfterMs = 0; retryOverload = false;
    (retry as { unref?: () => void }).unref?.();
    retryMs = Math.min(5000, retryMs * 2);
  }
  async function flushOnce(acquire = true) {
    const syncUnobserved = (force = false) => syncSettledWrites(queued, syncOnce, () => caughtUp, acquire && !closed, force);
    await exitDone;
    if (closed || !sendingAllowed) return;
    if (reconcileNeeded) { reconcileNeeded = false; try { await media?.reconcile(); } catch { reconcileNeeded = true; retryFlush(); } }
    for await (const entry of receiptBatch(queued, history)) {
      await exitDone;
      if (closed) return;
      const success = successSequence(entry);
      if (success != null) {
        try { await deliverAcknowledgedReceipt(history, receiptCall, entry, success, completeWrite); } catch { retryFlush(); continue; }
        // @ref LLP 3000.019#3.3 — proven-success recovery/observation cannot gate the tail.
        if (acquire && (entry.observed_seq == null || !caughtUp) && (await queued().catch(() => { retryFlush(); return undefined; }))?.every(e => successSequence(e) != null)) await syncOnce();
        continue;
      }
      let ownsSettlement = false;
      try {
        const result = await network(async () => {
          await exitDone;
          if (closed || sessionDead) return { ok: false as const };
          const current = (await queued()).find(current => current.id === entry.id);
          if (!current) return { ok: true as const, retired: true as const };
          if (settling.has(entry.id)) return { ok: false as const };
          settling.add(entry.id);
          ownsSettlement = true;
          const known = await recoverReceipt(history, receiptCall, entry.id, current.sent_seq ?? current.observed_seq, successSequence(current) != null);
          if (known) return { ok: true as const, json: { ...known }, obsoleteAuth: false };
          const binding = entry.receipt_store?.id ?? entry.store_id ?? storeIdentity;
          if (!binding) return { ok: false as const };
          try {
            const revision = credentialRevision;
            const started = await call({ op: "begin_send", id: entry.id });
            if (started.denied) return { ok: false as const };
            const receipt = (started.ok as { receipt?: Exclude<Write, { state: "pending" }>; qualified?: boolean } | undefined)?.receipt;
            if (receipt) { const known = await recoverReceipt(history, receiptCall, entry.id, receipt.state === "sent" ? receipt.seq : undefined, (started.ok as { qualified?: boolean }).qualified === true); if (known) return { ok: true as const, json: { ...known }, obsoleteAuth: false }; }
            if (closed || sessionDead || rotating || revision !== credentialRevision) return { ok: false as const };
            ordinarySending = entry.id;
            const response = await post(`/m/${entry.op}`, { id: entry.id, args: entry.args, newIds: entry.new_ids, store_id: binding }, settled.get(entry.id)?.response);
            if (response.ok) {
              const json = response.json, why = (json.why ?? json.denied) as Refusal | undefined;
              if (!response.obsoleteAuth && !why?.retryable && (json.state === "sent" || why)) {
                try {
                  await settleReceipt(history, receiptCall, json.state === "sent"
                    ? { state: "sent", id: entry.id, seq: Number(json.seq ?? 0), replayed: true }
                    : { state: "failed", id: entry.id, why: why! }, json.replayed === true && json.store_id === binding ? binding : undefined);
                } catch { return { ...response, persistencePending: true }; }
              }
            }
            return response;
          } finally { ordinarySending = undefined; }
        });
        if (!result.ok) { await syncUnobserved(); retryFlush(); return; }
        if ("retired" in result) continue;
        const json = result.json;
        const why = (json.why ?? json.denied) as Refusal | undefined;
        if (result.obsoleteAuth || why?.retryable || (json.state !== "sent" && !why)) { await syncUnobserved(); retryFlush(); return; }
        retryMs = 250;
        const settle = settled.get(entry.id);
        settled.delete(entry.id);
        const outcome: Write = json.state === "sent"
          ? json.replayed === true
            ? { state: "sent", id: entry.id, seq: Number(json.seq ?? 0), replayed: true }
            : { state: "sent", id: entry.id, seq: Number(json.seq ?? 0), result: json.result }
          : { state: "failed", id: entry.id, why: (json.why as Refusal | undefined) ?? (json.denied as Refusal | undefined) ?? { code: "E_STORE", family: "store", message: "the server answered without a state", retryable: true } };
        if (!closed && !("persistencePending" in result)) {
          if (outcome.state !== "sent") rerunTables(predictedTables(entry.predicted));
          // Durable completion survives a failed observation check; retry sync separately.
          try { await syncUnobserved(outcome.state === "sent"); } catch { retryFlush(); }
        }
        settle?.resolve(outcome);
        emitWrite(outcome);
        if ("persistencePending" in result) { await syncUnobserved(); retryFlush(); return; }
      } catch { await syncUnobserved(); retryFlush(); return; }
      finally { if (ownsSettlement) settling.delete(entry.id); }
    }
    await syncUnobserved();
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
    residency: () => readResidency(call, unavailable),
    now: clock.issuedDeviceNow,
    act(op, args, options) {
      const response = closingResponses.request();
      return act(op, args, options, options?.id ?? mintId(), (path, body) => post(path, body, response), () => unavailable() ?? (partitionDenied?.code === "E_STORE_RESTORE" ? partitionDenied : link !== "online" ? offline() : undefined), async () => { if (closed) { await closingResponses.done; return response.take(); } });
    },
    async query(op, args) {
      while (true) {
        const result = await runLocal(op, args);
        const denied = unavailable(); // Rule 1: immediately before returning to the caller.
        if (denied) return { denied };
        if (result.ephemeralRequest && !ephemeralReads.current(result.ephemeralRequest)) continue;
        if (publishLocal(result, () => true)) return result.read;
      }
    },
    observe<A, R>(op: Query<A, R>, args: A, options?: ObserveOptions): Observed<R> {
      const keep = options?.keep;
      const key = observationKey(op, args, options);
      return observeWatch(watches, key,
        () => Object.assign(new ReadObservation<unknown>(keep), { op: op as Query<unknown, unknown>, args, key, tables: new Set<string>(), presenceRefresh: null, subscribers: new Set<() => void>(), running: false, dirty: false, expiryTimer: null, incarnation }),
        watch => {
          watchEphemeral(watch); const d = watch.deadlines;
          // @ref LLP 3000.023#3.4 — resubscription resumes the displayed row's original deadlines.
          if (d) scheduleExpiry(watch, d.device, d.server, d.localWakeup);
          void rerun(watch); },
        watch => ephemeralReads.remove(watch), unavailable, false);
    },
    mutate: routeMutations(ephemeral.mutate, function<A, R>(op: Mutation<A, R>, args: A, options?: MutateOptions): Promise<Write<R>> {
      const id = options?.id === undefined ? mintId() : options.id;
      const unavailableWhy = unavailable() ?? (partitionDenied?.code === "E_STORE_RESTORE" ? partitionDenied : null);
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
          const admitted = await receiptCall(request); // Committed admission survives media/host housekeeping failure.
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
        const wait = mutationWaitSeconds(options?.waitSeconds) ?? 4;
        if (link !== "online" || wait === 0) { settled.delete(id); return pending; }
        let timer: ReturnType<typeof setTimeout> | undefined;
        try {
          const outcome = await Promise.race([result, new Promise<Write>((resolve) => { timer = setTimeout(() => resolve(pending), wait * 1_000); })]) as Write<R>;
          if (outcome.state === "pending" && closed) { await closingResponses.done; return response.write(outcome); }
          return outcome;
        }
        finally { clearTimeout(timer); settled.delete(id); }
        })();
      });
    }),
    write(id) { return lookupWrite(history, queued, id, unavailable, () => acquired); },
    pendingWrites: () => localPendingWrites(queued, history, () => unavailable() ?? (partitionDenied?.code === "E_STORE_RESTORE" ? partitionDenied : null), () => acquired, holds),
    onPendingWrites: pending.subscribe,
    get acquired() { return acquired; },
    onAcquired(listener) { acquiredListeners.add(listener); return () => acquiredListeners.delete(listener); },
    async upload(bytes) {
      if (refreshing) await refreshing;
      const unavailableWhy = unavailable() ?? (partitionDenied?.code === "E_STORE_RESTORE" ? partitionDenied : null);
      if (unavailableWhy) return { ok: false as const, why: unavailableWhy };
      if (link !== "online") return { ok: false as const, why: offline() };
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
      if (!closed && !sessionDead) await syncAfterCall();
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
      closed = true; holds.clear();
      const deliveryStopped = deliveryQueue?.stop();
      closeWatchAnswers(watches, unavailable()!)();
      pending.notify(); pending.clear();
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
        await deliveryStopped;
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
  // Remember shared ids to route retries through lookup, without retaining or
  // settling their outcomes. Settlement's history.read remains strictly local.
  const keptWrites = (await call({ op: "meta", key: "write-history", lookup: true })).ok as string | null;
  for (const write of keptWrites ? JSON.parse(keptWrites) as Write[] : []) mutationIds.remember(write.id);
  seq = Number(((await call({ op: "state" })).ok as { watermark?: number } | undefined)?.watermark ?? 0);
  deliveryQueue = localDelivery({ offline: () => setLink("offline"), viewer: principal, url: base, fetch: doFetch, call, backend: () => backend,
    collect: core[deliveryCommit]?.bind(core), current: () => !closed && !sessionDead && !partitionDenied,
    ready: () => !closed && !sessionDead && !partitionDenied && !rotating && link === "online" && deliveryWitness && networkWork === 0 && !flushing,
    credentials: requestCredentials, refresh: () => refreshing, capture: captureStore, witness: witnessRestore, restored: () => partitionDenied?.code === "E_STORE_RESTORE",
    replaced: () => { observeIncarnation(undefined, true); deliveryQueue?.fence(true); }, auth: refusedSession,
    onRefused: options.onDeliveryRefused, now: clock.issuedDeviceNow });
  await deliveryQueue.open();
  const prepared = startDeferred(options);
  function listenForExit() {
    if (!core.onSuspend || stopSuspend || closed || sessionDead) return;
    sendingAllowed = true;
    const sendOnExit = exitTransport(doFetch, base, aborter.signal, exitRefusalSettlement({
      closed: () => closed, owners: settling, active,
      commit: async write => {
        const known = await history.read(write.id, true);
        if (known && known.state !== "pending") return false;
        const applied = await receiptCall({ op: "settle_exit", write });
        if (applied.denied) throw new Error(applied.denied.message);
        return applied.ok === true;
      },
      publish: write => {
        completeWrite(write);
        for (const watch of watches.values()) void rerun(watch);
      },
    }), async (entry, why) => {
      if (!closed && !sessionDead && !settling.has(entry.id)) await holds.record(entry.id, why.code);
    });
    stopSuspend = core.onSuspend((entries, beginSend) => {
      const request = requestCredentials();
      // @ref LLP 3000.007#20.4 — document teardown may abort the ordinary request: only its same durable head may overlap the keepalive retry.
      exitDone = sendOnExit(entries, request.headers, () => {
        const started = (ordinarySending === undefined || ordinarySending === entries[0]?.id) && !history.hasUnpersisted(entries[0]!.id) && !closed && !sessionDead && partitionDenied?.code !== "E_STORE_RESTORE" && !rotating && credentialRevision === request.revision && beginSend();
        if (started) pending.notify();
        return started && !closed && !sessionDead && !rotating && credentialRevision === request.revision;
      });
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
    if (deliveryQueue?.enabled && link === "online" && !deliveryWitness) await probe();
    deliveryQueue?.available();
    follow();
    void flush();
    scheduleRefresh();
  };
  progress.bind(client);
  bindWatchPeek(client, watches, unavailable);
  trackRotation(client, () => refreshing);
  trackClose(client, closingResponses);
  if (!deferStart(options, start)) await start();
  stopHost = core.onClient?.(client, base);
  return client;
  } catch (error) {
    stopSuspend?.();
    stopOutbox?.();
    stopClock?.();
    await deliveryQueue?.stop();
    aborter.abort();
    // Opening the device transfers its lifetime to this constructor. Until a
    // client is returned, every later startup failure must release it here.
    try { await media?.close(); await core.close(); } catch {}
    throw error;
  }
}
