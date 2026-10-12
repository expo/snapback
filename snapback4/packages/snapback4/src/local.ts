import { immediateUpload } from "./local-upload.ts";
import { DeviceUploads } from "./uploads.ts";
export { blobArrayBuffer } from "./assets.ts";
export { uploadAndPlace, hasUploads, type UploadIntent, type UploadAndPlaceOptions, type UploadClient } from "./uploads.ts";
import { LocalNetwork } from "./local-network.ts";
import { intervalChanges, type Changes, type Footprint } from "./query-dependencies.ts";
import { QueryCustody } from "./query-custody.ts";
import { notifyFollowing } from "./following-transport.ts";
import { bindSessionRefusal } from "./session-refusal.ts";
import { refuseReadDevice, validateReadOptions, refreshDeviceSession as rotateSession } from "./read-only.ts";
import { watchCanRevoke, evidenceTouches } from "./change-evidence.ts";
import { assetReader, readAsset } from "./asset-progress.ts";
import { ObservationWork } from "./observation-work.ts";
import { readyRead } from "./read-existence.ts";
import { currentDecorations, copyDecorations } from "./read-decoration.ts";
import { heldQueryRefusal, settledQuery, terminalQueryRefusal } from "./query-settlement.ts";
import { matchingReads } from "./read-key.ts";
import { duringRead, checkRead, withReadSignal, READ_WORK_EXPIRED } from "./read-work.ts";
import { readResponse, readWithAdmissionRetry, transportRefusal, jitter, retryAfter, pauseRefusal, refusal, overloaded } from "./http-response.ts";
import { SearchBound, refreshSearchRoots, searchReplyIdentity } from "./local-search.ts";
import { deliveryCommit, type LocalOptions, type LocalClient } from "./local-device.ts";
import { deviceRestore, coldRestoreWitness, restoreWitness } from "./device-restore.ts";
import { deviceControl, coldSnapshot, coldReplyStatus, type DeviceControlSnapshot } from "./device-control.ts";
import { publishDelivery } from "./local-publication.ts";
import { localDelivery } from "./local-delivery.ts";
import { deferReadNotifications } from "./read-notifications.ts";
import { readDeadlineWithdrawn } from "./read-expiry.ts";
import { localReadDeadlines, withdrawnLocalResult } from "./local-read-deadlines.ts";
import { bindWatchPeek, observationKey, endLingering, closeWatchAnswers, observeWatch } from "./observe-watch.ts";
import { EphemeralReads, type EphemeralRequest } from "./ephemeral-reads.ts";
import { ephemeralLane, routeMutations } from "./ephemeral.ts";
import { admitNow, failedAdmission, mutationEntry } from "./admission.ts";
import { IdentityWait, identityRefusal, localAdmissionIdentity } from "./identity-admission.ts";
import { attachAdmissionAuthority } from "./admission-authority.ts";
import { acquisitionProgress } from "./acquisition.ts";
import { readResidency } from "./residency.ts";
import { serverClock } from "./clock.ts";
import { defaultFetch } from "#fetch";
import { ClosingResponses, trackClose, type ClosingResponse } from "./closing-responses.ts";
import type { Queued, StoreCapture, LocalResult } from "./local-types.ts";
import { deferStart, startDeferred, trackRotation } from "./client-start.ts";
import { evaluateLocal } from "./local-query.ts";
import { FollowingIntents, FollowingHistory } from "./local-following.ts";
import { answerIdentity } from "./read-observation.ts";
import { postForCaller, waitForCaller } from "./request-wait.ts";
import { runsOnServer, retainedWatch, localWatch, predictedTables, armLocalPresence, notifyLocalWatch as notify, rerunLocalTables, publishedApplyCut, applyChanges, localApplyChanges, LocalReads, type LocalWatch as Watch } from "./local-reads.ts";
import { nativeInstaller } from "./local-native.ts";
import { BackendAuthError, BackendRefusalError, loadBackend, openLocalDevice } from "./local-backend.ts";
import { mutationWaitSeconds, MutationIds, WriteHistory } from "./writes.ts";
import { registerLocalPendingIntents, localPendingHolds, localPendingWrites, pendingChanges } from "./pending-writes.ts";
import { changeFeed } from "./changes.ts";
import { episodeDeadline } from "./read-episode.ts";
import { requireSyncProtocol, responsePageTooLarge, syncTransport, type SyncPage } from "./local-sync.ts";
import { exitTransport } from "./local-exit.ts";
import { exitRefusalSettlement } from "./local-exit-settlement.ts";
import { deliverAcknowledgedReceipt, publicWrite, resolveClosingWrites, lookupWrite, readQueued, receiptBatch, recoverReceipt, retiredReceipts, settleReceipt, successSequence, syncSettledWrites, terminalDeviceCall } from "./local-receipts.ts";
import type { ObserveOptions, Client, Link, MutateOptions, Mutation, Observed, Principal, Query, Read, Refusal, Write } from "./contract.ts";
import { MediaCache, assetRetention, changesMediaAuthority, type MediaStorage, type AssetRetention } from "./local-assets.ts";
export type { AcquisitionMarker } from "./local-sync.ts"; export type { MediaStorage, AssetRetention } from "./local-assets.ts";
import { mintId } from "./client.ts";
import { type BackendJson, type ProgramJson, type SchemaJson } from "./backend.ts";
import { assetQueue } from "./asset-download.ts";
import { assetSource, fetchAsset } from "./assets.ts";
import { act } from "./actions.ts";
import { defaultSessionStore, forgetSession, guest, keepSession, logout, logoutAll as revokeAllSessions, restoreSession, type Session, type SessionStore, type SignIn } from "./auth.ts";
export type { DeviceCore, DeviceOpener, DeviceOpening, LocalOptions, LocalClient } from "./local-device.ts";
const PAGE = 10000; // Fill the row allowance; fetchSync and E_BOUND still bound oversized pages.
const REFRESH_BEFORE_EXPIRY_MS = 24 * 60 * 60 * 1000;
export async function createLocalClient(options: LocalOptions): Promise<LocalClient> {
  validateReadOptions(options); refuseReadDevice(options.session);
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
    refuseReadDevice(session);
    if (session && (!Number.isFinite(session.expiresAt) || session.expiresAt <= 0)) {
      session = null;
      await forgetSession(base, sessions);
    }
    if (!session && options.guest) {
      const signedIn = await guest(base, doFetch);
      if (!signedIn.ok) throw new Error(`createLocalClient: ${signedIn.why.code}: ${signedIn.why.message}`);
      refuseReadDevice(signedIn.session); session = signedIn.session;
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
      } else if (refreshed.why.code === "E_AUTH" && !refreshed.why.retryable) {
        await forgetSession(base, sessions);
        throw new Error(`createLocalClient: ${refreshed.why.code}: ${refreshed.why.message}`);
      }
    }
    await keepSession(base, session, sessions);
    headers.authorization = `Bearer ${session.token}`;
  }
  const viewer: Principal = (options.persona ? `dev:${options.persona}` : session!.principal) as Principal;
  const principal: string = viewer;
  let sessionDead = false, credentialRevision = 0, rotating = false;
  const sessionListeners = new Set<(session: Session | null) => void>();
  const viewerListeners = new Set<(viewer: Principal | null) => void>();
  const writeListeners = new Set<(write: Exclude<Write, { state: "pending" }>) => void>();
  let history!: WriteHistory;
  const mutationIds = new MutationIds();
  const pending = pendingChanges(), identification = new IdentityWait(pending.notify);
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
  const storeName = `snapback4-${encodeURIComponent(`${base}:${viewer}`)}`;
  let link: Link = "online", linkRevision = 0;
  let generation = 0;
  let backend: BackendJson | null = null;
  let startupRefusal: BackendRefusalError | undefined;
  try {
    backend = await loadBackend(doFetch, base, requestCredentials().headers);
  } catch (error) {
    if (error instanceof BackendAuthError) {
      await forgetSession(base, sessions);
      throw new Error(`createLocalClient: ${error.denied.code}: ${error.denied.message}`);
    }
    if (error instanceof BackendRefusalError) startupRefusal = error;
    if (!startupRefusal || ["E_OFFLINE", "E_HTTP_RESPONSE"].includes(startupRefusal.denied.code)) link = "offline";
  }
  const active = new Set<Promise<unknown>>();
  let closed = false, closing: Promise<void> | undefined;
  const closingResponses = new ClosingResponses();
  const aborter = new AbortController();
  const downloads = assetQueue();
  const core = await openLocalDevice(options.device, storeName, backend, startupRefusal);
  let stopSuspend: (() => void) | undefined, stopClock: (() => void) | undefined;
  let sendingAllowed = !core.onSuspend;
  let stopOutbox: (() => void) | undefined, flushRecovered: (() => void) | undefined;
  let followingIntents!: FollowingIntents;
  let media: MediaCache | undefined, deliveryQueue: ReturnType<typeof localDelivery> | undefined, deliveryWitness = false;
  try {
  const queued = () => answers.readQueued(() => readQueued(call, mutationIds, history, settling), watches.values());
  const queryCustody = new QueryCustody(() => backend, queued, pending.subscribe, () => unavailable() ?? changesStopped ?? partitionDenied, () => ordinarySending ? network.acquire() : network.once(), () => link === "offline");
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
  stopOutbox = core.onOutbox?.((time, entries) => { clock.raiseIssued(time ?? 0); followingIntents?.recovered(entries ?? []); pending.notify(); flushRecovered?.(); });
  await clock.attach(core);
  if (session && session.expiresAt <= clock.issuedDeviceNow()) {
    await forgetSession(base, sessions);
    throw new Error("createLocalClient: E_AUTH: this session expired; sign in again");
  }
  media = new MediaCache(core, principal, retention, clock.issuedDeviceNow);
  await media.open();
  const installNative = nativeInstaller(() => ({ backend, generation, link, closed }), next => { backend = next; }, call, doFetch, base, requestCredentials);
  let nativeReady = await installNative();
  const network = new LocalNetwork(syncRound, () => partitionDenied?.code === "E_STORE_RESTORE", () => deliveryQueue?.available());
  let submissions = Number((await call({ op: "next_submission" })).ok ?? 1) - 1, seq = 0;
  let partitionDenied: Refusal | null = null, changesStopped: Refusal | null = null;
  const linkListeners = new Set<(link: Link) => void>();
  const watches = new Map<string, Watch>();
  const ephemeralReads = new EphemeralReads(aborter.signal);
  const ephemeral = ephemeralLane({ url: base, fetch: doFetch, headers: () => ({ ...headers }),
    link: () => link, mint: mintId, signal: aborter.signal, offline: () => setLink("offline"),
    unavailable: () => unavailable() ?? partitionDenied, storeId: () => storeIdentity });
  const settled = new Map<string, { resolve: (write: Write) => void; response: ClosingResponse }>();
  const completeWrite = (write: Exclude<Write, { state: "pending" }>) => {
    write = publicWrite(write); settled.get(write.id)?.resolve(write); settled.delete(write.id); emitWrite(write);
  };
  const answers = new LocalReads();
  followingIntents = new FollowingIntents(() => backend, queued, tables => { const delivery: (() => void)[] = []; invalidateAnswers(delivery, "admit", tables); for (const notify of delivery) notify(); }, principal);
  const { scheduleExpiry, sweepExpiries } = localReadDeadlines(watches, answers, clock, () => closed, () => unavailable(), acquireRead, () => link === "online");
  // @ref LLP 3000.013#6 — dispatched mutations own settlement through close.
  const settling = new Set<string>();
  let lastSyncAt = Number((await call({ op: "meta", key: "syncedAt:wall:1" })).ok ?? 0);
  let caughtUp = false, identityChecked = false, partitionCurrent = true;
  const initialSync = (await call({ op: "sync_state", capture: false })).ok as { store_id?: string | null; backend_required?: boolean; restore_refusal?: Refusal };
  let storeIdentity = initialSync?.store_id ?? undefined;
  let identified = !!storeIdentity && !initialSync?.backend_required;
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
  for (const entry of await queued()) {
    const seq = successSequence(entry);
    if (entry.sent_seq == null && seq != null) { const receipt = await history.acknowledged(entry.id, seq, true); if (receipt) await history.keep(receipt); }
  }
  // @ref LLP 3000.007#18.2 — observation fences answers before queued sync can retire the partition.
  function observeIncarnation(id?: string, force = false, delivery?: (() => void)[], cause = "store-reset") {
    if (!force && (id === undefined || id === storeIdentity)) return;
    const resetProgress = force || storeIdentity !== undefined;
    storeIdentity = id; identified = false;
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
    const approvals = deferReadNotifications(() => { endLingering(watches.values()); answers.clear(watches.values(), true, undefined, cause); });
    // Finish invalidating every answer before invoking application callbacks.
    const deliver = () => {
      approvals(); pending.notify();
      if (wasAcquired) for (const listener of acquiredListeners) listener(false);
      for (const watch of watches.values()) {
        notify(watch);
        void scheduleRead(watch);
      }
    };
    if (delivery) delivery.push(deliver); else deliver();
  }
  function invalidateAnswers(delivery: (() => void)[], operation: string, touched?: readonly string[], preserved?: unknown, publishedCut?: number, oneShotTables: Changes | null | undefined = touched, external?: Footprint) {
    if (!["apply", "admit", "settle"].includes(operation)) touched = undefined;
    const affected = [...watches.values()].filter(watch => touched === undefined || operation === "apply" && (watch.serverRead || watch.deadlines?.localWakeup || retainedWatch(backend!, watch)) || (touched.length > 0
      && evidenceTouches(watch, touched)));
    const approvals = deferReadNotifications(() => answers.committed(affected, operation, touched, preserved, publishedCut, oneShotTables, external));
    // Warm applies return every invalidated owner for sync's resumption set; cold acquisition remains progressive.
    delivery.push(() => { approvals(); for (const watch of affected) { notify(watch); if (operation !== "apply" || !acquired) scheduleRead(watch); } });
    return affected;
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
  async function call(request: Record<string, unknown>, committedTables?: { tables: Set<string>; unknown: boolean; resumed: Set<Watch> }, terminalCommit?: (reply: { ok?: unknown; denied?: Refusal }) => void): Promise<{ ok?: unknown; denied?: Refusal }> {
    if (["observe_store", "apply", "adopt", "settle_exit"].includes(String(request.op))) while (history?.hasUnpersisted()) await history.persistPending();
    const entry = request.entry as { id: string; op: string } | undefined;
    if (request.op === "admit" && entry) queryCustody.admitted(entry.id, entry.op);
    const writeTables = queryCustody.effects(entry?.id ?? String(request.id));
    const endAdmission = request.op === "admit" ? answers.admitting(() => watches.values(), writeTables) : undefined;
    let observed = false;
    const delivery: (() => void)[] = [];
    const deliver = () => { for (const notify of delivery.splice(0)) notify(); };
    const committed = (result: { ok?: unknown; denied?: Refusal }) => {
      if (observed) return;
      observed = true;
      terminalCommit?.(result);
      if (request.op === "queued" && Array.isArray(result.ok)) queryCustody.recovered(result.ok as Queued[]);
      if (request.op === "settle" && !result.denied) queryCustody.settled(String(request.id));
      if (!result.denied && request.op === "apply" && (result.ok as { published?: boolean })?.published === true) answers.published(Number((request.page as { watermark?: number }).watermark));
      if (!result.denied && ["apply", "admit", "admit_upload", "upload_state", "upload_ready", "settle", "settle_exit", "adopt", "observe_store", "begin_send", "hold_write", "keep_write"].includes(String(request.op))) delivery.push(pending.notify);
      // @ref LLP 3000.001#repair-b-never-install-a-confirmed-image-over-a-row-a-live-prediction-writes — preserve publication invalidations before fallible post-commit work.
      const touched = (result.ok as { touched?: string[] } | undefined)?.touched;
      const cut = request.op === "apply" ? publishedApplyCut(request.page as Record<string, unknown>, (result.ok as { published?: boolean })?.published) : undefined;
      const external = request.op === "apply" ? applyChanges(request.page as Record<string, unknown>, cut) : undefined;
      const writeEffects = request.op !== "settle" || (result as { settlement_unchanged?: unknown }).settlement_unchanged === true ? writeTables : undefined;
      const queryTables = ["admit", "settle"].includes(String(request.op)) ? writeEffects ?? null : cut === undefined ? null : answers.predictions?.length === 0 && external ? localApplyChanges(request.page as Record<string, unknown>, external, touched) ?? null : touched ?? null;
      if (!result.denied && ["apply", "admit", "settle", "settle_exit", "clear_rows"].includes(String(request.op))) for (const watch of invalidateAnswers(delivery, String(request.op), touched, (result as { preserved?: unknown }).preserved, cut, queryTables, external)) committedTables?.resumed.add(watch);
      if (!result.denied && request.op === "apply") {
        delivery.push(answers.withdrawScopes(watches.values(), request.page as Parameters<LocalReads["withdrawScopes"]>[1], (result.ok as { published?: boolean })?.published !== false, link === "offline" ? offline() : undefined));
        const footprint = (result.ok as { touched?: string[] } | undefined)?.touched;
        if (committedTables && footprint === undefined) committedTables.unknown = true;
        for (const table of footprint ?? []) committedTables?.tables.add(table);
        delivery.push(() => { if (!closed && !sessionDead) progress.page(request.page as Record<string, unknown>, request.first === true); });
      }
      // Fence a committed replacement before fallible media reconciliation or native identity reads.
      if (!result.denied && request.op === "observe_store" && (result.ok as { reset?: boolean } | undefined)?.reset) {
        observeIncarnation(undefined, true, delivery);
        delivery.push(...retiredReceipts(history, (result.ok as { retired: Record<string, number> }).retired, completeWrite));
      }
      if (!result.denied && request.op === "adopt") observeIncarnation(storeIdentity, true, delivery, "schema-reset");
    };
    if (deliveryQueue?.enabled) request = { ...request, delivery_now: clock.issuedDeviceNow() };
    const work = typeof request.now === "number" ? clock.persist().then(() => core.call(request, committed)) : core.call(request, committed);
    active.add(work);
    try {
      const result = (await work) as { ok?: unknown; denied?: Refusal };
      committed(result);
      deliver();
      if (!result.denied && ["apply", "settle", "withdraw", "dequeue"].includes(String(request.op))) deliveryQueue?.published();
      if (!result.denied && ["apply", "observe_store", "adopt", "clear_rows", "admit", "settle", "settle_exit"].includes(String(request.op)) && changesMediaAuthority(String(request.op), result.ok)) await media?.reconcile(
        ["apply", "admit", "settle"].includes(String(request.op)) ? (result.ok as { touched?: string[] } | undefined)?.touched : undefined);
      return result;
    }
    finally { endAdmission?.(); active.delete(work); deliver(); }
  }
  let transportFailure: Refusal | undefined, authRefusal: Refusal | undefined;
  const offline = (): Refusal => transportFailure ?? transportRefusal();
  const unavailable = (): Refusal | null => closed ? { code: "E_CLOSED", family: "client", message: "this client is closed" } : sessionDead ? authRefusal ?? { code: "E_AUTH", family: "auth", message: "sign in to continue" } : null;
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
          else if ("data" in watch.snapshot) watch.failed(true);
        }
      });
      deliver();
      for (const watch of watches.values()) notify(watch);
    }
    pending.notify();
    ephemeral.linkChanged();
    for (const listener of linkListeners) listener(next);
    if (next === "online") { deliveryQueue?.reconnect(); void flush(); }
    for (const watch of watches.values()) void scheduleRead(watch);
  };
  let refreshTimer: ReturnType<typeof setTimeout> | undefined;
  let refreshing: Promise<SignIn> | null = null, rotatingSession: Promise<SignIn> | null = null;
  let retireRotation: ((result: SignIn) => void) | undefined;
  let persistingSession: Promise<void> | undefined, endingSession: Promise<void> | undefined;
  const signedOut = (): SignIn => ({ ok: false, why: authRefusal ?? { code: "E_AUTH", family: "auth", message: "sign in to continue" } });
  let stopRefresh!: () => void;
  const refreshStopped = new Promise<SignIn>(resolve => { stopRefresh = () => resolve(signedOut()); });
  // @ref LLP 3000.011.003.000#2 — local sign-out fences refresh before durable credential deletion; it never deletes the replica or outbox.
  const endSession = (why?: Refusal): Promise<void> => {
    if (!sessionDead) authRefusal = why;
    void deliveryQueue?.stop();
    if (endingSession) return endingSession;
    const notifySession = !sessionDead;
    const work = Promise.resolve().then(async () => {
      try {
        // Finish an in-progress store write before deletion; a pending refresh cannot start another.
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
    if (!sessionDead && !rotating && revision === credentialRevision && (denied as Refusal | undefined)?.code === "E_AUTH" && !(denied as Refusal).retryable) await endSession(denied as Refusal);
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
    if (sessionDead || !session || options.persona) return Promise.resolve({ ok: false, why: authRefusal ?? { code: "E_AUTH", family: "auth", message: "sign in with a session to refresh it" } });
    if (refreshing) return refreshing;
    const token = session.token;
    const expectedPrincipal = session.principal;
    rotating = true;
    credentialRevision += 1;
    const approvals = deferReadNotifications(() => {
      endLingering(watches.values());
      answers.serverAnswers.clear(); answers.evidence(); for (const watch of watches.values()) { watch.reset({ loading: true }, false, "credentials"); scheduleExpiry(watch, null, null, false, null, null); }
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
      // Sign-out stops adoption; a committed rotation still returns its successor for family revocation.
      const refreshed = await Promise.race([rotation, refreshStopped]);
      if (sessionDead) return signedOut();
      if (closed) { retire(refreshed); return { ok: false, why: { code: "E_CLOSED", family: "client", message: "this client is closed" } }; }
      if (!refreshed.ok) {
        rotating = false;
        credentialRevision += 1;
        if (refreshed.why.code === "E_AUTH" && !refreshed.why.retryable && session?.token === token) await endSession(refreshed.why);
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
        // Rotation makes the replacement bearer authoritative. Drain older sync,
        // then sync this credential revision before reporting completion.
        const priorSync = network.current;
        if (priorSync) try { await priorSync; } catch {}
        if (!closed && !sessionDead && credentialRevision === refreshedRevision) {
          try { await network.once(); } catch {}
          if (!closed && !sessionDead && credentialRevision === refreshedRevision && link === "online") {
            for (const watch of watches.values()) void scheduleRead(watch);
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
  // Quiet presence failures retry on their timer without changing the link (LLP 3000.018 §3.2).
  function post(path: string, body: unknown, captured?: ClosingResponse, eph?: EphemeralRequest, quiet = false, control?: DeviceControlSnapshot, decode?: (response: Response) => Promise<Record<string, unknown>>, signal?: AbortSignal) {
    const work = sendPost(path, body, captured, eph, quiet, control, decode, signal);
    active.add(work);
    void work.finally(() => active.delete(work)).catch(() => {});
    return work;
  }
  async function sendPost(path: string, body: unknown, captured?: ClosingResponse, eph?: EphemeralRequest, quiet = false, control?: DeviceControlSnapshot, decode?: (response: Response) => Promise<Record<string, unknown>>, signal?: AbortSignal): Promise<{ ok: true; json: Record<string, unknown>; obsoleteAuth: boolean; searchIdentity?: string | undefined } | { ok: false }> {
    if (closed || sessionDead || partitionDenied?.code === "E_STORE_RESTORE") return { ok: false };
    try {
      const capture = control ?? (path.startsWith("/q/") ? await captureStore() : undefined);
      if (partitionDenied?.code === "E_STORE_RESTORE" || signal?.aborted) return { ok: false };
      const request = requestCredentials();
      const reply = await withReadSignal(signal, eph?.signal ?? aborter.signal, stopped => postForCaller(doFetch, base, path, request.headers, body, stopped, (json, status) => captured?.capture(json, status), decode));
      if (!reply || signal?.aborted || (eph && !ephemeralReads.current(eph))) return { ok: false };
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
      if (signal?.aborted) return { ok: false };
      if (error instanceof SearchBound) throw error;
      transportFailure = transportRefusal(error);
      if (!signal?.aborted && !quiet && (!eph || ephemeralReads.current(eph))) setLink("offline");
      return { ok: false };
    }
  }
  async function refusePartition(denied: Refusal, revision: number) {
    await refusedSession(denied, revision);
    if (!denied.retryable && partitionDenied?.code !== "E_STORE_RESTORE") {
      if (!partitionDenied) console.error(`snapback4: the server refused the partition: ${denied.code}: ${denied.message}`);
      answers.refuse(watches.values(), denied); partitionDenied = denied;
      pending.notify();
      for (const watch of watches.values()) void scheduleRead(watch);
    }
  }
  async function syncRound(): Promise<boolean> {
    caughtUp = false;
    if (closed || sessionDead || partitionDenied?.code === "E_STORE_RESTORE") return false;
    try { await history.persistPending(); } catch { retryFlush(); return false; }
    const state = (await call({ op: "state" })).ok as { watermark: number; generation: number } | undefined;
    let watermark = state?.watermark ?? 0;
    const resumed = new Set<Watch>(), touched = { tables: new Set<string>(), unknown: false, resumed };
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
          storeIdentity = store_id ?? undefined; identified = !!storeIdentity && !backendRequired;
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
          if (overloaded(refusal(denied))) setLink("online");
          await refusePartition(denied, pageRevision);
          return false;
        }
        // @ref LLP 3000.023#11 — record the POST outcome before identity/schema adoption can rebind its outbox.
        if (ordinarySending && (generationChanged || Number(page.generation ?? generation) !== generation || page.store_id !== requestedStore || backendRequired)) return false;
        // @ref LLP 3000.007#18.2 — sync identity retires the old partition before any read or outbox replay.
        let replacedStore = false;
        let adoptionCapture: Record<string, string | null> | undefined;
        {
          // Refusals deliver no rows; an overflow watermark is only an event cut.
          // Preserve image heads without inventing progress. Generation discovery
          // must validate retained evidence before adoption can clear it.
          const observed = await call({ op: "observe_store", page: denied ? { ...page, snapshot: false, events: [], more: true,
            ...(generationChanged ? { images_at: page.watermark } : {}) } : page });
          if (observed.denied || partitionDenied?.code === "E_STORE_RESTORE") { refuseRestore(observed.denied); return false; }
          const observation = observed.ok as { reset: boolean; backend_required?: boolean; send_revision: number; retired: Record<string, number>; adoption_capture?: Record<string, string | null> };
          page.send_revision = observation.send_revision;
          adoptionCapture = observation.adoption_capture;
          // Observation reports shared metadata; keep this interpreter's adoption requirement.
          backendRequired ||= !!observation.backend_required;
          if (observation.reset) {
            // call() fenced the retired incarnation; discard its cursors before inspecting the new store.
            watermark = 0; after = undefined; catchingUp = false; publicationOutstanding = false;
            page.captured_watermark = 0;
            adoptedGeneration = true;
            replacedStore = true;
            const observedRead = await call({ op: "sync_state", capture: false });
            if (observedRead.denied) return false;
            const observedState = observedRead.ok as { store_id?: string | null; backend_required?: boolean } | undefined;
            publishedStore = observedState?.store_id;
            storeIdentity = publishedStore ?? undefined; identified = !!storeIdentity && !observedState?.backend_required;
            await call({ op: "set_meta", key: "syncedAt:wall:1", value: "0" });
            for (const watch of watches.values()) void scheduleRead(watch);
          }
        }
        if (link !== "online") setLink("online");
        if (partitionDenied?.code === "E_STORE_RESTORE") return false;
        if (!denied) partitionDenied = null;
        const pageGeneration = Number(page.generation ?? generation);
        if (generationChanged || pageGeneration !== generation || (backendRequired && partitionCurrent)) observeIncarnation(storeIdentity, true);
        if (generationChanged || pageGeneration !== generation || replacedStore || backendRequired) {
          // A new store restarts generation numbers. Reload even on a match, then acquire its partition.
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
            // Restart at the reduced limit without adopting the refusal's watermark; snapshots can split commits.
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
        // call() preserved committed tables for finally, even if media or the following metadata read fails.
        if (published) {
          const publishedRead = await call({ op: "sync_state", capture: false });
          if (closed || applyingIncarnation !== incarnation || publishedRead.denied) return false;
          const publishedState = publishedRead.ok as { store_id?: string | null; backend_required?: boolean; watermark: number } | undefined;
          publishedStore = publishedState?.store_id;
          observeIncarnation(publishedStore ?? undefined);
          storeIdentity = publishedStore ?? undefined; identified = !!storeIdentity && !publishedState?.backend_required;
          watermark = publishedState?.watermark ?? watermark;
          if (publishedState) { for (const watch of answers.applied(watches.values(), publishedState.watermark)) resumed.add(watch); for (const table of followingIntents.applied()) touched.tables.add(table); }
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
      seq = watermark; lastSyncAt = Date.now();
      await call({ op: "set_meta", key: "syncedAt:wall:1", value: String(lastSyncAt) });
      await queued(); // @ref LLP 3000.031#1.1 — refresh pending facts invalidated even by empty applies.
      // A later reconnect can establish custody that startup could not validate.
      const resumeSending = !sendingAllowed;
      listenForExit();
      if (resumeSending && sendingAllowed) void flush();
      return true;
    } finally {
      if (!closed && adoptedGeneration) {
        for (const watch of watches.values()) void scheduleRead(watch);
      } else if (!closed && (touched.unknown || touched.tables.size > 0 || resumed.size > 0)) {
        for (const watch of watches.values()) if (resumed.has(watch) || watch.serverRead || watch.deadlines?.localWakeup || touched.unknown || watch.tables.size === 0 || [...watch.tables].some((t) => touched.tables.has(t))) void scheduleRead(watch);
      } else if (!closed && caughtUp && identityChecked) {
        for (const watch of watches.values()) {
          if (runsOnServer(backend!, watch.op, nativeReady) || watch.kept || watch.changeCut !== undefined) { void scheduleRead(watch); continue; }
          if (watch.incarnation !== incarnation || !("data" in watch.snapshot) || watch.snapshot.fresh) continue;
          const { since: _, ...read } = watch.snapshot;
          watch.publish(readyRead({ ...read, fresh: true }, watch.pending?.() ?? false));
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
      const json = await readResponse(response);
      if (closed) return;
      await refusedSession(json.denied ?? json.why, request.revision);
      const denied = refusal(json.denied ?? json.why);
      if (denied && !sessionDead && probeIncarnation === incarnation && request.revision === credentialRevision) {
        if (denied.code !== "E_HTTP_RESPONSE") setLink("online");
        await pauseRefusal(response, { ...denied, retryable: true }, aborter.signal); return;
      }
      if (response.status === 200 && json.ok === true && !sessionDead && probeIncarnation === incarnation && request.revision === credentialRevision) {
        // @ref LLP 3000.007#18.2 — verify identity before reconnect can bless cached local answers or resume a long poll.
        if (await witnessRestore(json.store_id, json.seq, capture)) return;
        if (typeof json.store_id === "string") observeIncarnation(json.store_id, json.store_id === storeIdentity && Number(json.seq) < Math.max(seq, capture.watermark));
        identityChecked = true;
        setLink("online");
      } else if (response.status !== 200 || json.ok !== true) setLink("offline");
    } catch (error) { transportFailure = transportRefusal(error); setLink("offline"); }
  }
  const changes = changeFeed(doFetch, base, aborter.signal, () => setLink("offline"), () => { if (!closed && !sessionDead && link === "offline") void network.run(probe); });
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
      if (!response.ok || json.denied) {
        await refusedSession(json.denied, request.revision);
        if (json.denied?.code === "E_AUTH" && !json.denied.retryable) return false;
        if (await pauseRefusal(response, json.denied, aborter.signal)) return false;
        if (refusal(json.denied) && !closed && changeIncarnation === incarnation && request.revision === credentialRevision) {
          changesStopped = json.denied!; pending.notify(); answers.refuse(watches.values(), changesStopped); return false; }
        throw new Error(`changes: HTTP ${response.status}`);
      }
      if (closed || changeIncarnation !== incarnation || request.revision !== credentialRevision) return false;
      if (!ephemeralReads.changed(eph, json.ephemeral)) return false;
      const replaced = json.store_id !== undefined && json.store_id !== storeIdentity;
      if (await witnessRestore(json.store_id, json.seq, capture)) return false;
      const notifiedTables = answers.notified(json.tables, json.seq, json.seq > seq, json.store_id === storeIdentity && json.generation === generation ? intervalChanges(json.changes, seq, json.seq) : undefined);
      const shrank = json.seq < Math.max(seq, capture.watermark);
      // @ref LLP 3000.023#10 — a program change retires the replica even with no touched tables or sequence advance.
      const generationChanged = json.generation !== undefined && json.generation !== generation;
      if (replaced || shrank || generationChanged) observeIncarnation(json.store_id, shrank || generationChanged, undefined, generationChanged ? "program-generation" : "store-reset");
      const changed = replaced || shrank || generationChanged || json.seq > seq;
      if (changed) {
        seq = Math.max(seq, json.seq);
        for (const watch of watches.values()) {
          if (evidenceTouches(watch, notifiedTables)) void scheduleRead(watch, true, json.seq, json.preserved);
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
      while (!closed && !sessionDead && !changesStopped && partitionDenied?.code !== "E_STORE_RESTORE") {
        if (caughtUp && !await waitForChange()) continue;
        let ok = false;
        try {
          ok = await network.once();
        } catch {
          if (closed) break;
        }
        if (closed) break;
        if (!ok) await new Promise((r) => setTimeout(r, 1000));
      }
    })();
  }
  const pendingRead = (tables: Set<string> | null, predictions = core[deviceControl]?.()?.predictions) => answers.pending(tables, predictions); // @ref LLP 3000.016#2.2 — one publication procedure governs every read kind.
  function runLocal<R>(op: Query<unknown, R>, args: unknown, watch?: Watch, quiet = false, backgroundWatch?: Watch, signal?: AbortSignal): Promise<LocalResult<R>> {
    // @ref LLP 3000.018#3.2 — each evaluation attempt, a retry included, is a new read for the remembered answers.
    let answerCache = answers.serverAnswers.view(); const owner = watch ?? backgroundWatch, changeVersion = owner?.changeVersion;
    const cold = coldSnapshot(core[deviceControl], !!core[deviceRestore] && !!(watch ?? backgroundWatch)?.serverOnly && !!network.current && !acquired, generation);
    const bypass = cold?.control;
    if (cold) clock.raiseIssued(cold.snapshot.issuedFloor);
    const queryEnvironment = { current: () => !owner || owner.changeVersion === changeVersion,
      retainedCurrent: answers.retainedCurrent(), ...(owner ? { serverCurrent: answers.serverCurrent(owner), inputsCurrent: answers.inputsCurrent(owner) } : signal ? { ...answers.oneShotCurrent(backend!, op.name) } : {}),
      revalidate: !watch || watch.kept || !("data" in watch.snapshot),
      coldRead: bypass,
      serverDeadlineWithdrawn: (deadline: number | null | undefined) => readDeadlineWithdrawn(matchingReads(watches.values(), op, args), deadline),
      get backend() { return backend!; },
      get partitionDenied() { return changesStopped ?? partitionDenied; }, get credentialRevision() { return credentialRevision; },
      get incarnation() { return incarnation; }, get authority() { return answers.revision; },
      get refreshing() { return refreshing; }, get link() { return link; },
      get linkRevision() { return linkRevision; }, get caughtUp() { return caughtUp; },
      get identityChecked() { return identityChecked; }, get lastSyncAt() { return lastSyncAt; },
      get partitionCurrent() { return partitionCurrent; }, get nativeReady() { return nativeReady; },
      set nativeReady(value: boolean) { nativeReady = value; },
      principal, signal: signal ?? aborter.signal, unavailable, queued, pending: pendingRead, call, installNative, notify, followingPending: (tables: ReadonlySet<string>) => followingIntents.pending(tables),
      post: (path: string, body: unknown, captured?: ClosingResponse, eph?: EphemeralRequest) => post(path, body, captured, eph, quiet, bypass ? core[deviceControl]?.() : undefined, undefined, signal),
      searchPost: (path: string, body: unknown, decode: (response: Response) => Promise<Record<string, unknown>>) => post(path, body, undefined, undefined, quiet, undefined, decode, signal),
      refreshSearch: (name: string) => refreshSearchRoots(watches, name, backend?.schema.operations?.[name]?.search?.cursor, notify, scheduleRead),
      deviceNow: clock.issuedDeviceNow, serverNow: clock.estimatedServerNow,
      offline, get serverAnswers() { return answerCache; }, ephemeralReads,
    };
    const work = duringRead((async (): Promise<LocalResult<R>> => {
      for (let attempt = 0; ; attempt++) {
        checkRead(signal);
        const revision = incarnation, authority = answers.revision;
        const result = { ...await evaluateLocal(queryEnvironment, op, args, revision, authority, watch), controlCurrent: bypass?.current };
        checkRead(signal);
        const denied = unavailable(); // Rule 1 also holds across the caller's await.
        if (denied) return { ...result, read: { denied }, incarnation: revision, authority };
        if (!owner && signal) return { ...result, incarnation: revision, authority }; // One-shot owns the bounded rounds.
        if (result.ephemeralStale || (result.ephemeralRequest && !ephemeralReads.current(result.ephemeralRequest))) {
          if (attempt >= 3) return { ...result, retryExhausted: true, read: { loading: true } as Read<R>, incarnation: revision, authority };
          await new Promise(resolve => setTimeout(resolve, 25 * 2 ** attempt));
          answerCache = answers.serverAnswers.view();
          continue;
        }
        if (watch || (revision === incarnation && (authority === answers.revision || result.publicationCurrent?.())) || closed) return { ...result, incarnation: revision, authority };
        // A mixed page never retries its server invocation after a delivery race.
        if (result.searchAttempt) return { ...result, read: { loading: true } as Read<R>, incarnation, authority: answers.revision };
        answerCache = answers.serverAnswers.view();
      }
    })(), signal);
    active.add(work); void work.finally(() => active.delete(work)).catch(() => {}); return work;
  }
  function publishLocal(result: Awaited<ReturnType<typeof runLocal>>, publish: () => boolean, watch?: Watch) {
    result.read = currentDecorations(result.read);
    return publishDelivery(deliveryQueue, result, () => !unavailable() && (!("data" in result.read) || !changesStopped && !partitionDenied && answers.blocked(result) === undefined)
      && result.incarnation === incarnation && (result.authority === answers.revision || result.publicationCurrent?.() === true)
      && (result.credential === undefined || result.credential === credentialRevision) && (!result.controlCurrent || result.controlCurrent())
      && (!result.ephemeralRequest || ephemeralReads.current(result.ephemeralRequest))
      && (!("data" in result.read) || ((result.serverExpiry == null || result.serverExpiry > clock.estimatedServerNow())
      && (result.localWakeup || result.nextExpiry === null || result.nextExpiry > clock.issuedDeviceNow()))), publish, { client, watch });
  }
  function watchEphemeral(watch: Watch) {
    const tables = backend!.schema.operations?.[watch.op.name]?.ephemeralReads ?? [];
    if (!tables.length) { ephemeralReads.remove(watch); return; }
    ephemeralReads.add(watch, tables, (reset, changed, preserved) => {
      const deliver = reset ? watch.reset({ loading: true }, true) : undefined;
      if (reset) scheduleExpiry(watch, null, null, false, null, null);
      return () => {
        deliver?.();
        if (watches.get(watch.key) !== watch) return;
        if (reset) notify(watch);
        void scheduleRead(watch, changed, undefined, preserved);
      };
    });
  }
  function rerunTables(tables: Set<string>) { rerunLocalTables(watches.values(), tables, scheduleRead); }
  function armPresence(watch: Watch) { armLocalPresence(watch, !!unavailable(), !!network.current && !acquired, () => { void refreshPresence(watch); }); }
  async function refreshPresence(watch: Watch) {
    if (closed || sessionDead || watches.get(watch.key) !== watch) return;
    if (watch.running) return; // The re-run in flight re-arms the refresh when it settles.
    const shown = watch.snapshot, changeVersion = watch.changeVersion;
    try {
      const result = await runLocal(watch.op, watch.args, undefined, true, watch);
      const { read, tables, nextExpiry, serverExpiry, localWakeup, valueDevice, valueServer, refresh: after, served, ephemeralRequest, incarnation: revision, authority } = result;
      if (withdrawnLocalResult(watches.values(), watch, result)) { armPresence(watch); return; }
      if (closed || sessionDead || watches.get(watch.key) !== watch) return;
      // A reply that a newer publication or re-run overtook decides nothing: the newer one armed the timer.
      if (watch.snapshot !== shown || watch.running || watch.changeVersion !== changeVersion && !result.publicationCurrent?.()) return;
      if (served && revision === incarnation && (authority === answers.revision || result.publicationCurrent?.()) && (!ephemeralRequest || ephemeralReads.current(ephemeralRequest))) {
        publishLocal(result, () => {
          if (watches.get(watch.key) !== watch || watch.snapshot !== shown || watch.running || watch.changeVersion !== changeVersion && !result.publicationCurrent?.() || !answers.current(watch, result)) return false;
          watch.serverRead = true; watch.serverOnly = result.serverOnly === true;
          ephemeralReads.incomplete(watch, "data" in read && !read.complete);
          watch.tables = tables; watch.scopes = result.scopes; watch.setExistenceTables(result.existenceTables ?? null);
          scheduleExpiry(watch, nextExpiry, serverExpiry, localWakeup, valueDevice, valueServer);
          const denied = unavailable();
          watch.publish(denied ? { denied } : result.read);
          notify(watch);
          watch.presenceEvery = after;
          return true;
        }, watch);
      }
    } catch {}
    if (watches.get(watch.key) === watch && !watch.running) armPresence(watch);
  }
  const readWork = new ObservationWork<Watch>(); // @ref LLP 3000.023#10 — changed input retires an older attempt; refresh cadence alone does not.
  function scheduleRead(watch: Watch, changed = false, cut?: number, preserved?: unknown) {
    if (closed || sessionDead) return; if (changed) answers.changed(watch, cut);
    const denied = changesStopped ?? partitionDenied; if (denied) { watch.reset({ denied }); notify(watch); return; }
    if (watch.scopeCut !== undefined && link !== "online") { watch.publish({ denied: offline() }); notify(watch); return; }
    watch.reload(changed && watchCanRevoke(watch, preserved), { queued: true }); notify(watch); acquireRead(watch);
  }
  function acquireRead(watch: Watch) {
    if (closed || sessionDead) return;
    if (watch.running) { watch.dirty = true; return; }
    readWork.schedule(watch, signal => rerun(watch, signal));
  }
  async function rerun(watch: Watch, signal: AbortSignal) {
    if (closed || watches.get(watch.key) !== watch) return;
    if (watch.running) { watch.dirty = true; return; }
    watch.running = true;
    const resetVersion = watch.resetVersion, changeVersion = watch.changeVersion, startedWith = answerIdentity(watch.snapshot);
    let retryExpired = false;
    try {
      if (watch.detachedEpoch !== undefined) {
        const before = incarnation, state = await duringRead(captureStore(), signal);
        if (before !== incarnation) { watch.dirty = true; return; }
        checkRead(signal); if (state) { answers.reconcile(watch, state.watermark); delete watch.detachedEpoch; }
      }
      if (answers.deferUntilSync(watch, acquired, backend!, unavailable() ?? changesStopped ?? partitionDenied)) return;
      const result = await runLocal(watch.op, watch.args, watch, false, undefined, signal);
      checkRead(signal);
      if (withdrawnLocalResult(watches.values(), watch, result)) return;
      const { read, tables, nextExpiry, serverExpiry, localWakeup, valueDevice, valueServer, refresh: after, served, ephemeralRequest, incarnation: revision, authority } = result;
      if (revision !== incarnation || resetVersion !== watch.resetVersion || (authority !== answers.revision || changeVersion !== watch.changeVersion) && !result.publicationCurrent?.()) { watch.dirty = true; return; }
      if (closed || watches.get(watch.key) !== watch) return;
      if (ephemeralRequest && !ephemeralReads.current(ephemeralRequest)) { watch.dirty = true; return; }
      retryExpired = result.retryExpired === true;
      if (retryExpired && "data" in watch.snapshot && answerIdentity(watch.snapshot) !== startedWith) return;
      if (!answers.current(watch, result)) { if (watch.scopeCut !== undefined && link !== "online") { watch.publish({ denied: offline() }); notify(watch); } watch.dirty = true; retryExpired = true; return; }
      if (!retryExpired) watch.expiredRetries = 0;
      const accepted = publishLocal(result, () => {
        if (signal.aborted || closed || watches.get(watch.key) !== watch || resetVersion !== watch.resetVersion || changeVersion !== watch.changeVersion && !result.publicationCurrent?.()) return false;
        if (served || !result.controlCurrent) { watch.serverRead = served === true; watch.serverOnly = result.serverOnly === true; }
        ephemeralReads.incomplete(watch, "data" in read && !read.complete);
        watch.incarnation = revision;
        // @ref LLP 3000.018#3.2 — a server's answer decides the refresh interval; one from this device keeps it.
        if (served) watch.presenceEvery = after;
        armPresence(watch);
        if ((result.transportOffline || result.retryExhausted) && (!("data" in read) || episodeDeadline(watch.snapshot) !== undefined)) {
          watch.failed(result.transportOffline);
          if (!watch.kept) scheduleExpiry(watch, nextExpiry, serverExpiry, localWakeup, valueDevice, valueServer);
          notify(watch); return true;
        }
        scheduleExpiry(watch, nextExpiry, serverExpiry, localWakeup, valueDevice, valueServer);
        if (watch.snapshot !== read) {
          watch.tables = tables; watch.scopes = result.scopes;
          watch.setExistenceTables(result.existenceTables ?? null); const denied = unavailable(); // Rule 1: immediately before notifying observers.
          watch.publish(denied ? { denied } : copyDecorations(result.read, result.transportOffline && "data" in result.read ? { ...result.read, revalidating: true as const } : result.read));
          notify(watch);
        }
        return true;
      }, watch);
      if (!accepted) { watch.dirty = true; retryExpired = true; }
    } catch {
      if (!signal.aborted && !closed && changeVersion === watch.changeVersion && resetVersion === watch.resetVersion && watches.get(watch.key) === watch) {
        watch.failed(link === "offline"); notify(watch);
        armPresence(watch);
      }
    } finally {
      watch.running = false;
      const dirty = watch.dirty;
      watch.dirty = false;
      if (!closed && !sessionDead && watches.get(watch.key) === watch) {
        if (retryExpired && !signal.aborted) {
          watch.expiredRetries = Math.min((watch.expiredRetries ?? 0) + 1, 7);
          readWork.retry(watch, Math.min(25 * 2 ** (watch.expiredRetries - 1), 1000), signal => rerun(watch, signal));
        } else if (dirty || signal.reason === READ_WORK_EXPIRED) void acquireRead(watch);
      }
    }
  }
  let reconcileNeeded = false; // @ref LLP 3000.019#3.3 — failed housekeeping retries without gating dispatch.
  const receiptCall = (request: Record<string, unknown>) => terminalDeviceCall(
    committed => call(request, undefined, committed), () => { reconcileNeeded = true; retryFlush(); });
  let retry: ReturnType<typeof setTimeout> | undefined;
  let retryMs = 250;
  let retryAfterMs = 0, retryOverload = false;
  let flushing: Promise<void> | null = null;
  let exitDone: Promise<void> | undefined;
  let ordinarySending: string | undefined, flushAgain = false;
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
    retry = setTimeout(() => { retry = undefined; void flush(); }, retryOverload ? jitter(Math.max(retryMs, retryAfterMs)) : Math.max(retryMs, retryAfterMs));
    retryAfterMs = 0; retryOverload = false;
    (retry as { unref?: () => void }).unref?.();
    retryMs = Math.min(5000, retryMs * 2);
  }
  async function flushOnce(acquire = true) {
    const syncUnobserved = (force = false) => syncSettledWrites(queued, network.once, () => caughtUp, acquire && !closed, force);
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
        if (acquire && (entry.observed_seq == null || !caughtUp) && (await queued().catch(() => { retryFlush(); return undefined; }))?.every(e => successSequence(e) != null)) await network.once();
        continue;
      }
      let ownsSettlement = false;
      try {
        const result = await network.run(async () => {
          await exitDone;
          if (closed || sessionDead) return { ok: false as const };
          let current = (await queued()).find(current => current.id === entry.id);
          if (!current) return { ok: true as const, retired: true as const };
          if (settling.has(entry.id)) return { ok: false as const };
          settling.add(entry.id);
          ownsSettlement = true;
          const known = await recoverReceipt(history, receiptCall, entry.id, current.sent_seq ?? current.observed_seq, successSequence(current) != null);
          if (known) return { ok: true as const, json: { ...known }, obsoleteAuth: false };
          const binding = entry.receipt_store?.id ?? entry.store_id ?? storeIdentity;
          if (!binding) return { ok: false as const };
          try {
            const prepared = await uploads.prepare(current);
            if (!prepared) return { ok: false as const };
            if ("cancelled" in prepared) {
              const why = { code: "E_UPLOAD_CANCELLED", family: "asset", message: "upload-and-place intent cancelled before placement dispatch" };
              await settleReceipt(history, receiptCall, { state: "failed", id: entry.id, why }, undefined, binding);
              return { ok: true as const, json: { state: "failed", why }, obsoleteAuth: false };
            }
            current = prepared.entry;
            const revision = credentialRevision;
            const started = await call({ op: "begin_send", id: entry.id });
            if (started.denied) return { ok: false as const };
            const receipt = (started.ok as { receipt?: Exclude<Write, { state: "pending" }>; qualified?: boolean } | undefined)?.receipt;
            if (receipt) { const known = await recoverReceipt(history, receiptCall, entry.id, receipt.state === "sent" ? receipt.seq : undefined, (started.ok as { qualified?: boolean }).qualified === true); if (known) return { ok: true as const, json: { ...known }, obsoleteAuth: false }; }
            if (closed || sessionDead || rotating || revision !== credentialRevision) return { ok: false as const };
            ordinarySending = entry.id;
            let response = await post(`/m/${entry.op}`, { id: entry.id, args: current.args, newIds: current.new_ids, store_id: binding }, settled.get(entry.id)?.response);
            if (response.ok && current.upload && !response.obsoleteAuth) {
              const why = (response.json.why ?? response.json.denied) as Refusal | undefined;
              if (why && !why.retryable) {
                const receipt = await uploads.finish(current, why);
                if (!receipt) return { ok: false as const };
                response = { ...response, json: receipt };
              }
            }
            if (response.ok) {
              const json = response.json, why = (json.why ?? json.denied) as Refusal | undefined;
              if (!response.obsoleteAuth && !why?.retryable && (json.state === "sent" || why)) {
                try {
                  await settleReceipt(history, receiptCall, json.state === "sent"
                    ? { state: "sent", id: entry.id, seq: Number(json.seq ?? 0), replayed: true }
                    : { state: "failed", id: entry.id, why: why! }, json.replayed === true && json.store_id === binding ? binding : undefined, binding);
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
  const followingHistory = new FollowingHistory(() => backend, () => notifyFollowing(client));
  const uploads = new DeviceUploads({ base, viewer: principal, fetch: doFetch, signal: aborter.signal, current: () => !closed && !sessionDead && !rotating && !partitionDenied,
    unavailable: () => unavailable() ?? partitionDenied, storeId: () => storeIdentity, capture: captureStore, credentials: requestCredentials,
    entry: (id, op, args) => mutationEntry(id, ++submissions, op, args, principal, clock.issuedDeviceNow(), backend!, true),
    call: receiptCall, queued, write: id => client.write(id), notify: pending.notify, flush: () => { void flush(); }, subscribe: pending.subscribe });
  const client: LocalClient = {
    uploadAndPlace: uploads.uploadAndPlace.bind(uploads), uploads: uploads.uploads.bind(uploads), uploadIntent: uploads.uploadIntent.bind(uploads),
    retryUpload: uploads.retryUpload.bind(uploads), discardUpload: uploads.discardUpload.bind(uploads), onUploads: uploads.onUploads,
    serverUploads: uploads.serverUploads.bind(uploads), cancelServerUpload: uploads.cancelServerUpload.bind(uploads),
    residency: () => readResidency(call, unavailable),
    now: clock.issuedDeviceNow,
    act(op, args, options) {
      const response = closingResponses.request();
      return act(op, args, options, options?.id ?? mintId(), (path, body) => post(path, body, response), () => unavailable() ?? (partitionDenied?.code === "E_STORE_RESTORE" ? partitionDenied : link !== "online" ? offline() : undefined), async () => { if (closed) { await closingResponses.done; return response.take(); } });
    },
    query: settledQuery(async (op, args, signal) => {
      const result = await runLocal(op, args, undefined, false, undefined, signal);
      let waiting = !("denied" in result.read) && !("loading" in result.read && link === "offline") && await queryCustody.blocked(op.name, result); checkRead(signal); return () => {
        if (waiting) return link === "offline" ? { denied: offline() } : { wait: async (signal: AbortSignal) => { await queryCustody.wait(op.name, result, signal); waiting = await queryCustody.blocked(op.name, result); } };
        if (answers.blocked(result) !== undefined || "data" in result.read && readDeadlineWithdrawn(matchingReads(watches.values(), op, args), result.serverExpiry)) { answers.serverAnswers.forget(`${op.name}:${JSON.stringify(args)}`); return; }
        if (publishLocal(result, () => true)) return "loading" in result.read && (link === "offline" || result.heldUnavailable) ? { denied: link === "offline" ? offline() : heldQueryRefusal() } : result.read;
      };
    }, () => terminalQueryRefusal({ scope: null, store: null, closed: closed ? unavailable() : null, session: sessionDead ? unavailable() : null, changes: changesStopped, partition: partitionDenied, inherited: null }), aborter.signal),
    observe<A, R>(op: Query<A, R>, args: A, options?: ObserveOptions): Observed<R> {
      const keep = options?.keep;
      const key = observationKey(op, args, options);
      return observeWatch(watches, key,
        () => Object.assign(localWatch(keep, op as Query<unknown, unknown>, args, key, incarnation, pendingRead), { opaque: () => !backend?.programs.some(p => p.name === op.name && !p.native) }),
        watch => {
          watchEphemeral(watch); const d = watch.deadlines;
          // @ref LLP 3000.023#3.4 — resubscription resumes the displayed row's original deadlines.
          if (d) scheduleExpiry(watch, d.device, d.server, d.localWakeup, d.valueDevice, d.valueServer);
          answers.resume(watch); void scheduleRead(watch); },
        watch => { answers.detach(watch); readWork.cancel(watch); ephemeralReads.remove(watch); }, unavailable, false, watch => { watch.dirty = false; return readWork.cancel(watch); },
        (watch, detached) => answers.restore(watch, detached, unavailable() ?? changesStopped ?? partitionDenied));
    },
    mutate: routeMutations(ephemeral.mutate, function<A, R>(op: Mutation<A, R>, args: A, options?: MutateOptions): Promise<Write<R>> {
      const id = options?.id === undefined ? mintId() : options.id;
      const unavailableWhy = unavailable() ?? (partitionDenied?.code === "E_STORE_RESTORE" ? partitionDenied : null);
      if (unavailableWhy) {
        const failed = { state: "failed" as const, id, why: unavailableWhy };
        if (!mutationIds.knows(id)) emitLocalFailure(failed);
        return failedAdmission<R>(id, unavailableWhy);
      }
      return followingHistory.track(op.name, () => followingIntents.track(op.name, () => mutationIds.run<R>(id, op.name, args, () => client.write(id), (args, pending) => {
        const waiting = !identified || identification.size > 0;
        const identity = waiting ? localAdmissionIdentity(backend, generation) : undefined;
        const submit = (release = () => {}): Promise<Write<R>> => {
        const request = { op: "admit", ...(waiting ? identity!.fields() : {}),
          entry: mutationEntry(id, ++submissions, op.name, args, principal, clock.issuedDeviceNow(), backend!, options?.id !== undefined) };
        const denied = admitNow(core, request);
        if (denied) { release(); if (denied.code === "E_ADMISSION_STORE") emitLocalFailure({ state: "failed", id, why: denied }); return failedAdmission<R>(id, denied); }
        return (async () => {
        const response = closingResponses.request();
        const result = new Promise<Write>((resolve) => settled.set(id, { resolve, response }));
        try {
          // @ref LLP 3000.007#20.4 — capture replay eligibility with the synchronous journal entry; recovery must also defer local refusals to the server.
          const admitted = await receiptCall(request); // Committed admission survives media/host housekeeping failure.
          release();
          if (admitted.denied) {
            settled.delete(id);
            const why = waiting && ["E_GENERATION", "E_PREDICT", "E_STORE_REPLACED", "E_STORE_RESTORE", "E_ADMISSION_STORE"].includes(admitted.denied.code) ? identityRefusal(false) : admitted.denied;
            const failed = { state: "failed" as const, id, why };
            return admitted.denied.code === "E_WRITE_ID_REUSE" ? failed : emitLocalFailure(failed);
          }
          const entry = admitted.ok as Queued;
          clock.raiseIssued(entry.now ?? 0);
          if (!entry.predictable && !entry.predicted.length) Object.assign(pending, { reason: !acquired
            ? "queued without a row: not acquired yet"
            : "queued without a row: local data does not justify prediction" });
          rerunTables(predictedTables(entry.predicted));
        } catch (error) {
          release(); settled.delete(id);
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
        };
        if (!waiting) return submit();
        return identification.run<R>({ id, op: op.name, args }, async () => {
          const state = (await call({ op: "sync_state", capture: false })).ok as StoreCapture | undefined;
          const ready = identity!.check(state, backend, generation, unavailable() ?? partitionDenied);
          if (ready === true) { storeIdentity = state!.store_id!; identified = true; }
          return ready;
        }, submit, why => emitLocalFailure({ state: "failed", id, why }));
      })));
    }),
    write(id) { return unavailable() ? Promise.resolve(undefined) : identification.write(id) ?? lookupWrite(history, queued, id, unavailable, () => acquired); },
    pendingWrites: async () => identification.visible(await localPendingWrites(queued, history, () => unavailable() ?? (partitionDenied?.code === "E_STORE_RESTORE" ? partitionDenied : null), () => acquired, holds), !unavailable()),
    onPendingWrites: pending.subscribe,
    get acquired() { return acquired; },
    onAcquired(listener) { acquiredListeners.add(listener); return () => acquiredListeners.delete(listener); },
    upload: immediateUpload({ get refreshing() { return refreshing; }, unavailable, get partitionDenied() { return partitionDenied; }, get link() { return link; },
      base, requestCredentials, headers, doFetch, aborter, active, core, principal, refusedSession, get credentialRevision() { return credentialRevision; }, setLink }),
    asset: assetReader(async (id, progress) => {
      const denied = unavailable(); if (denied) return { denied };
      progress("media"); await media!.reconcile(); if (refreshing) { progress("refresh"); await refreshing; } // @ref LLP 3000.008.002.000#6 — reconcile expiry, then wait for the active bearer.
      if (unavailable()) return { denied: unavailable()! };
      if (link !== "online") { progress("media"); return media!.read(id); }
      const request = requestCredentials();
      const read = await fetchAsset(base, request.headers, doFetch, id, (blob, response) =>
        unavailable() || request.revision !== credentialRevision ? Promise.resolve() : media!.viewed(id, blob, response), aborter.signal,
        () => !unavailable() && request.revision === credentialRevision, downloads, progress);
      // @ref LLP 3000.008.002.000#6 — a rotated pre-dispatch refusal has no asset authority to invalidate.
      if ("denied" in read && !unavailable() && request.revision !== credentialRevision) {
        return read.denied.code === "E_AUTH" ? readAsset(client, id, progress) : read;
      }
      if ("denied" in read) {
        await refusedSession(read.denied, request.revision);
        if (read.denied.code === "E_OFFLINE" && !unavailable()) {
          setLink("offline");
          const retained = await media!.read(id);
          return "url" in retained ? retained : read;
        }
        if (read.denied.code !== "E_CLIENT") await media!.invalidate(id);
      }
      if (unavailable()) {
        if ("url" in read) read.revoke();
        return { denied: unavailable()! };
      }
      return read;
    }),
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
      if (!closed && !sessionDead) await network.afterCall();
    },
    refreshSession: refreshCurrent,
    async logoutAll() {
      if (refreshing) await refreshing;
      if (closed) return { ok: false, why: { code: "E_CLOSED", family: "client", message: "this client is closed" } };
      if (sessionDead || !session) return { ok: false, why: authRefusal ?? { code: "E_AUTH", family: "auth", message: "sign in to revoke sessions" } };
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
      // Capture before endSession callbacks; track until adoption ends, including its resolved microtask.
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
      readWork.clear();
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
      // Cancel network waits; drain delivered responses through local settlement.
      identification.close();
      closing = (async () => {
        await Promise.allSettled([following, network.current, network.active, flushing, persistingSession, endingSession, ...active]);
        await resolveClosingWrites(queued, history, settled);
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
  const keptWrites = (await call({ op: "meta", key: "write-history", lookup: true })).ok as string | null;
  for (const write of keptWrites ? JSON.parse(keptWrites) as Write[] : []) mutationIds.remember(write.id);
  seq = Number(((await call({ op: "state" })).ok as { watermark?: number } | undefined)?.watermark ?? 0);
  deliveryQueue = localDelivery({ offline: () => setLink("offline"), viewer: principal, url: base, fetch: doFetch, call, backend: () => backend,
    collect: core[deliveryCommit]?.bind(core), current: () => !closed && !sessionDead && !partitionDenied,
    ready: () => !closed && !sessionDead && !partitionDenied && !rotating && link === "online" && deliveryWitness && !network.busy && !flushing,
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
        for (const watch of watches.values()) void scheduleRead(watch);
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
    // Exit and ordinary replay share the host's startup checks, even offline.
    const replayAllowed = core.onSuspend && await replayOnOpen();
    if (replayAllowed) listenForExit();
    // Install same-head exit retry before slow delivery/snapshots can consume the exit opportunity.
    if (replayAllowed && link === "online") await flushOnce(false);
    if (link === "online") await network.once();
    if (deliveryQueue?.enabled && link === "online" && !deliveryWitness) await probe();
    deliveryQueue?.available();
    follow();
    void flush();
    scheduleRefresh();
  };
  registerLocalPendingIntents(client, queued, history, identification, holds, () => unavailable() || partitionDenied ? undefined : `${viewer}:${storeIdentity}`, () => acquired, () => `${credentialRevision}:${incarnation}`);
  followingHistory.bind(client, {
    current: () => { const revision = credentialRevision, epoch = incarnation; return () => revision === credentialRevision && epoch === incarnation; },
    inputsCurrent: () => answers.inputsCurrent(), unavailable: () => !!unavailable() || !!partitionDenied || link !== "online",
    refreshing: () => !!refreshing, pending: pendingRead, intents: followingIntents,
    send: (op, args, body, signal) => post(`/following/${op.name}`, { ...body, args }, undefined, undefined, false, undefined, undefined, signal),
  });
  progress.bind(client); readWork.bind(client, watches);
  bindWatchPeek(client, watches, unavailable);
  trackRotation(client, () => refreshing);
  trackClose(client, closingResponses);
  if (!deferStart(options, start)) await start();
  stopHost = core.onClient?.(client, base);
  bindSessionRefusal(client, () => authRefusal);
  return client;
  } catch (error) {
    stopSuspend?.(); stopOutbox?.();
    stopClock?.();
    await deliveryQueue?.stop();
    aborter.abort();
    // This constructor owns the opened device until return; startup failures release it.
    try { await media?.close(); await core.close(); } catch {}
    throw error;
  }
}
