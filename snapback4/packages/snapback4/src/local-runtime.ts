import type { ServerClock } from "./clock.ts";
import type { DeviceCompatibility, DeviceEngine, DeviceVersionStatus } from "./device-version.ts";
import type { LocalStatus } from "./local-status.ts";
// Delivery and sync use the owning client's live state through accessors.
// No second owner, queue, watermark or cached state is introduced by this split.
import { type BackendJson } from "./backend.ts";
import { evidenceTouches } from "./change-evidence.ts";
import { changeFeed } from "./changes.ts";
import { type ClosingResponse } from "./closing-responses.ts";
import type { Client, Link, Refusal, Write } from "./contract.ts";
import { coldReplyStatus, deviceControl, type DeviceControlSnapshot } from "./device-control.ts";
import { type RestoreEvidence } from "./device-restore.ts";
import { DeviceVersionError } from "./device-version.ts";
import { EphemeralReads, type EphemeralRequest } from "./ephemeral-reads.ts";
import { jitter, overloaded, pauseRefusal, readResponse, readWithAdmissionRetry, refusal, retryAfter, transportRefusal } from "./http-response.ts";
import { LocalAcquisition, foregroundHint, progressiveState } from "./local-acquisition.ts";
import { MediaCache, changesMediaAuthority } from "./local-assets.ts";
import { BackendAuthError, BackendRefusalError, loadBackend } from "./local-backend.ts";
import type { DeviceCore } from "./local-device.ts";
import { type LocalOptions } from "./local-device.ts";
import { exitRefusalSettlement } from "./local-exit-settlement.ts";
import { exitTransport } from "./local-exit.ts";
import { FollowingIntents } from "./local-following.ts";
import { LocalNetwork } from "./local-network.ts";
import { LocalReads, applyChanges, localApplyChanges, notifyLocalWatch as notify, predictedTables, publishedApplyCut, runsOnServer, type LocalWatch as Watch } from "./local-reads.ts";
import { deliverAcknowledgedReceipt, receiptBatch, recoverReceipt, retiredReceipts, settleReceipt, successSequence, syncSettledWrites } from "./local-receipts.ts";
import { SearchBound, searchReplyIdentity } from "./local-search.ts";
import { localUnavailable } from "./local-status.ts";
import { responsePageTooLarge, type SyncPage } from "./local-sync.ts";
import type { Queued, StoreCapture } from "./local-types.ts";
import { QueryCustody } from "./query-custody.ts";
import { intervalChanges, type Changes, type Footprint } from "./query-dependencies.ts";
import { readyRead } from "./read-existence.ts";
import { withReadSignal } from "./read-work.ts";
import { postForCaller } from "./request-wait.ts";
import { DeviceUploads } from "./uploads.ts";
import { WriteHistory } from "./writes.ts";
const PAGE = 10000;
export interface LocalRuntimeContext {
  readonly aborter: AbortController;
  acquired: boolean;
  readonly acquisitionWalk: LocalAcquisition;
  readonly active: Set<Promise<unknown>>;
  readonly answers: LocalReads;
  authenticationFloor: number;
  backend: BackendJson | null;
  readonly base: string;
  readonly captureStore: () => Promise<StoreCapture | undefined>;
  caughtUp: boolean;
  readonly changes: (seq: number, wait: number, headers: Record<string, string>, storeIdentity?: string, ephemeral?: { epoch: number; incarnation: string; tables: string[]; }, restart?: AbortSignal) => Promise<{ response: Response; json: Awaited<ReturnType<ReturnType<typeof changeFeed>>>["json"]; }>;
  changesStopped: Refusal | null;
  readonly clock: ServerClock;
  closed: boolean;
  compatibility: DeviceCompatibility | undefined;
  compatibilityKnown: boolean;
  readonly completeWrite: (write: Exclude<Write, { state: "pending"; }>) => void;
  core: DeviceCore | undefined;
  coreFailure: Refusal | undefined;
  coreReady: boolean;
  credentialRevision: number;
  custodyEntries: Queued[];
  deliveryQueue: { open: (force?: boolean) => Promise<void>; readonly enabled: boolean; accept(manifest: unknown, current?: () => boolean): Promise<void>; published(): void; available(): void; reconnect(): void; fence(clear?: boolean): void; stop(): Promise<void>; } | undefined;
  readonly doFetch: { (input: RequestInfo | URL, init?: RequestInit): Promise<Response>; (input: string | URL | Request, init?: RequestInit): Promise<Response>; };
  readonly emitWrite: <T extends Exclude<Write, { state: "pending"; }>>(write: T) => T;
  readonly ephemeralReads: EphemeralReads;
  exitDone: Promise<void> | undefined;
  readonly fetchSync: (url: string, init: RequestInit, body: Record<string, unknown>) => Promise<Response>;
  flushAgain: boolean;
  flushing: Promise<void> | null;
  following: Promise<void> | null;
  followingIntents: FollowingIntents;
  generation: number;
  history: WriteHistory;
  holds: { clear(): void; forget(id: string): void; record(id: string, reason: string): Promise<void>; reasons(entries: Queued[]): Promise<Map<string, string>>; };
  identified: boolean;
  identityChecked: boolean;
  incarnation: number;
  readonly incompatible: (why: Refusal | undefined) => DeviceVersionError | undefined;
  readonly installNative: (signal?: AbortSignal) => Promise<boolean>;
  readonly invalidateAnswers: (delivery: (() => void)[], operation: string, touched?: readonly string[], preserved?: unknown, publishedCut?: number, oneShotTables?: Changes | null | undefined, external?: Footprint) => Watch[];
  lastSyncAt: number;
  link: Link;
  readonly localState: { bind(client: Client): void; set(next: LocalStatus): void; };
  media: MediaCache | undefined;
  nativeReady: boolean;
  readonly network: LocalNetwork;
  readonly observeIncarnation: (id?: string, force?: boolean, delivery?: (() => void)[], cause?: string) => void;
  readonly offline: () => Refusal;
  readonly onlineBlocked: () => boolean;
  onlineGeneration: number;
  onlineHead: number;
  onlineStore: string | undefined;
  readonly options: LocalOptions;
  ordinarySending: string | undefined;
  partitionCurrent: boolean;
  partitionDenied: Refusal | null;
  readonly pending: { subscribe(notify: () => void): () => void; notify(): void; clear(): void; };
  pendingRestoreProof: RestoreEvidence | undefined;
  persistingProof: boolean;
  readonly persistPendingProof: () => Promise<void>;
  readonly post: (path: string, body: unknown, captured?: ClosingResponse, eph?: EphemeralRequest, quiet?: boolean, control?: DeviceControlSnapshot, decode?: (response: Response) => Promise<Record<string, unknown>>, signal?: AbortSignal) => Promise<{ ok: true; json: Record<string, unknown>; obsoleteAuth: boolean; searchIdentity?: string | undefined; } | { ok: false; }>;
  readonly progress: { bind(client: Client): void; acquired(value: boolean): void; reset(): void; usable(state: { acquired_tables?: string[]; floored_groups?: number; } | undefined): void; page(page: Record<string, unknown>, first: boolean, published?: boolean): void; };
  progressive: boolean;
  readonly queryCustody: QueryCustody;
  readonly queued: () => Promise<Queued[]>;
  readonly receiptCall: (request: Record<string, unknown>) => Promise<{ ok?: unknown; denied?: Refusal }>;
  reconcileNeeded: boolean;
  readonly refreshAcquired: (afterAdoption?: boolean) => Promise<void>;
  readonly refusedSession: (denied: unknown, revision: number) => Promise<void>;
  readonly refuseRestore: (denied?: Refusal, confirmed?: boolean) => void;
  readonly requestCredentials: () => { headers: { [x: string]: string; }; revision: number; };
  readonly rerunTables: (tables: Set<string>) => void;
  retry: ReturnType<typeof setTimeout> | undefined;
  retryAfterMs: number;
  retryMs: number;
  retryOverload: boolean;
  rotating: boolean;
  readonly scheduleRead: (watch: Watch, changed?: boolean, cut?: number, preserved?: unknown, writes?: Footprint) => void;
  sendingAllowed: boolean;
  seq: number;
  sessionDead: boolean;
  readonly setAcquired: (value: boolean) => void;
  setLink: (next: Link) => void;
  readonly settled: Map<string, { resolve: (write: Write) => void; response: ClosingResponse; }>;
  readonly settling: Set<string>;
  stopSuspend: (() => void) | undefined;
  storeIdentity: string | undefined;
  transportFailure: Refusal | undefined;
  readonly uploads: DeviceUploads;
  readonly version: { status: () => DeviceVersionStatus; signal: AbortSignal; blocked: () => boolean; denied: () => Refusal | null; publish: (fn: (why: Refusal) => void) => void; compatible: (engine: DeviceEngine, headers?: Record<string, string>) => void; refuse: (why: Refusal | undefined) => DeviceVersionError | undefined; run<T>(work: () => Promise<T>): Promise<T>; };
  readonly versionBlocked: () => boolean;
  readonly watchEphemeral: (watch: Watch) => void;
  readonly watches: Map<string, Watch>;
  readonly witnessColdRestore: (evidence: RestoreEvidence, identityUnavailable: boolean) => Promise<void>;
  readonly witnessRestore: (storeId: unknown, head: unknown, capture: StoreCapture, onlineHead?: number) => Promise<boolean>;
}
export function localRuntime(env: LocalRuntimeContext) {

  async function call(request: Record<string, unknown>, committedTables?: { tables: Set<string>; unknown: boolean; resumed: Set<Watch> }, terminalCommit?: (reply: { ok?: unknown; denied?: Refusal }) => void): Promise<{ ok?: unknown; denied?: Refusal }> {
    const custodyRead = request.op === "queued" || request.op === "meta" && request.key === "write-history";
    if (!env.core || env.progressive && env.coreFailure && !custodyRead) return { denied: env.coreFailure ?? localUnavailable() };
    if (["observe_store", "apply", "adopt", "settle_exit"].includes(String(request.op))) while (env.history?.hasUnpersisted()) await env.history.persistPending();
    // A retained restore proof is retried before the next device transaction; a failed retry
    // fails that transaction rather than letting it proceed over unpersisted evidence.
    if (env.pendingRestoreProof && !env.persistingProof && ["observe_store", "apply", "adopt", "settle_exit", "sync_state"].includes(String(request.op))) await env.persistPendingProof();
    if (env.versionBlocked() && ["observe_store", "apply", "adopt"].includes(String(request.op))) return { denied: env.version.denied()! };
    const entry = request.entry as { id: string; op: string } | undefined;
    if (request.op === "admit" && entry) env.queryCustody.admitted(entry.id, entry.op);
    const writeTables = env.queryCustody.effects(entry?.id ?? String(request.id));
    const endAdmission = request.op === "admit" ? env.answers.admitting(() => env.watches.values(), writeTables) : undefined;
    let observed = false;
    const delivery: (() => void)[] = [];
    const deliver = () => { for (const notify of delivery.splice(0)) notify(); };
    const committed = (result: { ok?: unknown; denied?: Refusal }) => {
      if (observed) return;
      observed = true;
      terminalCommit?.(result);
      if (request.op === "queued" && Array.isArray(result.ok)) env.queryCustody.recovered(result.ok as Queued[]);
      if (request.op === "settle" && !result.denied) { env.queryCustody.settled(String(request.id)); env.custodyEntries = env.custodyEntries.filter(entry => entry.id !== request.id); }
      if (!result.denied && request.op === "apply" && (result.ok as { published?: boolean })?.published === true) env.answers.published(Number((request.page as { watermark?: number }).watermark));
      if (!result.denied && ["apply", "admit", "admit_upload", "upload_state", "upload_ready", "settle", "settle_exit", "adopt", "observe_store", "begin_send", "hold_write", "keep_write"].includes(String(request.op))) delivery.push(env.pending.notify);
      // @ref LLP 3000.001#repair-b-never-install-a-confirmed-image-over-a-row-a-live-prediction-writes — preserve publication invalidations before fallible post-commit work.
      const touched = (result.ok as { touched?: string[] } | undefined)?.touched;
      const cut = request.op === "apply" ? publishedApplyCut(request.page as Record<string, unknown>, (result.ok as { published?: boolean })?.published) : undefined;
      const external = request.op === "apply" ? applyChanges(request.page as Record<string, unknown>, cut) : undefined;
      const writeEffects = request.op !== "settle" || (result as { settlement_unchanged?: unknown }).settlement_unchanged === true ? writeTables : undefined;
      const queryTables = ["admit", "settle"].includes(String(request.op)) ? writeEffects ?? null : cut === undefined ? null : env.answers.predictions?.length === 0 && external ? localApplyChanges(request.page as Record<string, unknown>, external, touched) ?? null : touched ?? null;
      if (!result.denied && ["apply", "admit", "settle", "settle_exit", "clear_rows"].includes(String(request.op))) for (const watch of env.invalidateAnswers(delivery, String(request.op), touched, (result as { preserved?: unknown }).preserved, cut, queryTables, external)) committedTables?.resumed.add(watch);
      if (!result.denied && request.op === "apply") {
        delivery.push(env.answers.withdrawScopes(env.watches.values(), request.page as Parameters<LocalReads["withdrawScopes"]>[1], (result.ok as { published?: boolean })?.published !== false, env.link === "offline" ? env.offline() : undefined));
        const footprint = (result.ok as { touched?: string[] } | undefined)?.touched;
        if (committedTables && footprint === undefined) committedTables.unknown = true;
        for (const table of footprint ?? []) committedTables?.tables.add(table);
        delivery.push(() => { if (!env.closed && !env.sessionDead) env.progress.page(request.page as Record<string, unknown>, request.first === true, (result.ok as { published?: boolean })?.published !== false); });
      }
      // Fence a committed replacement before fallible media reconciliation or native identity reads.
      if (!result.denied && request.op === "observe_store" && (result.ok as { reset?: boolean } | undefined)?.reset) {
        env.observeIncarnation(undefined, true, delivery);
        delivery.push(...retiredReceipts(env.history, (result.ok as { retired: Record<string, number> }).retired, env.completeWrite));
      }
      if (!result.denied && request.op === "adopt") env.observeIncarnation(env.storeIdentity, true, delivery, "schema-reset");
    };
    if (env.deliveryQueue?.enabled) request = { ...request, delivery_now: env.clock.issuedDeviceNow() };
    const work = typeof request.now === "number" ? env.clock.persist().then(() => env.core!.call(request, committed)) : env.core.call(request, committed);
    env.active.add(work);
    try {
      const result = (await work) as { ok?: unknown; denied?: Refusal };
      committed(result);
      deliver();
      if (!result.denied && ["apply", "settle", "withdraw", "dequeue"].includes(String(request.op))) env.deliveryQueue?.published();
      if (!result.denied && ["apply", "observe_store", "adopt", "clear_rows", "admit", "settle", "settle_exit"].includes(String(request.op)) && changesMediaAuthority(String(request.op), result.ok)) await env.media?.reconcile(
        ["apply", "admit", "settle"].includes(String(request.op)) ? (result.ok as { touched?: string[] } | undefined)?.touched : undefined);
      return result;
    }
    finally { endAdmission?.(); env.active.delete(work); deliver(); }
  }

  async function sendPost(path: string, body: unknown, captured?: ClosingResponse, eph?: EphemeralRequest, quiet = false, control?: DeviceControlSnapshot, decode?: (response: Response) => Promise<Record<string, unknown>>, signal?: AbortSignal): Promise<{ ok: true; json: Record<string, unknown>; obsoleteAuth: boolean; searchIdentity?: string | undefined } | { ok: false }> {
    if (env.closed || env.sessionDead || env.onlineBlocked() || env.partitionDenied?.code === "E_STORE_RESTORE") return { ok: false };
    try {
      const capture = control ?? (path.startsWith("/q/") ? await env.captureStore() : undefined);
      if (env.onlineBlocked() || env.partitionDenied?.code === "E_STORE_RESTORE" || signal?.aborted) return { ok: false };
      const request = env.requestCredentials();
      if (env.progressive) delete request.headers["x-snapback-device"];
      const onlineCapture = { store_id: env.onlineStore ?? null, watermark: env.onlineHead, send_revision: 0 }, onlineIncarnation = env.incarnation;
      let authAtDecode: boolean | undefined;
      const received = (json: Record<string, unknown>, status: number) => {
        const why = (json.denied ?? json.why) as Refusal | undefined;
        if (why?.code !== "E_AUTH") { captured?.capture(json, status); return; }
        const applicable = request.revision >= env.authenticationFloor;
        authAtDecode = applicable;
        captured?.capture(json, status, () => applicable && request.revision >= env.authenticationFloor);
      };
      const reply = await withReadSignal(!env.progressive && path.startsWith("/q/") ? env.version.signal : undefined, eph?.signal ?? env.aborter.signal, lifetime => withReadSignal(signal, lifetime, stopped => postForCaller(env.doFetch, env.base, path, request.headers, body, stopped, received, decode, () => !env.onlineBlocked())));
      if (!reply || (env.onlineBlocked() && !path.startsWith("/m/")) || signal?.aborted || (eph && !env.ephemeralReads.current(eph))) return { ok: false };
      const { response, json } = reply;
      const why = (json.denied ?? json.why) as Refusal | undefined;
      if (why?.code === "E_HTTP_RESPONSE" && response.status >= 500) { env.transportFailure = why; if (!quiet) env.setLink("offline"); return { ok: false }; }
      if (path.startsWith("/m/") && why?.retryable && !env.closed && !env.sessionDead && request.revision === env.credentialRevision) {
        await env.holds.record((body as { id: string }).id, why.code);
        env.retryAfterMs = retryAfter(response.headers.get("retry-after")); env.retryOverload = why.code === "E_RATE_LIMIT";
      }
      // I12: committed writes outlive their caller; reads require the live view.
      if (env.closed && !path.startsWith("/m/") && !path.startsWith("/a/")) return { ok: false };
      const denied = (json.denied ?? json.why) as Refusal | undefined;
      const obsoleteAuth = denied?.code === "E_AUTH" && (authAtDecode === false || request.revision < env.authenticationFloor);
      await env.refusedSession(denied, request.revision);
      if (obsoleteAuth && path.startsWith("/a/")) return { ok: false };
      if (env.link !== "online") env.setLink("online");
      if (denied && typeof json.store_id !== "string") return { ok: true, json, obsoleteAuth };
      if (env.progressive && path.startsWith("/q/") && onlineIncarnation === env.incarnation && request.revision === env.credentialRevision) await onlineEvidence(json, onlineCapture);
      if (control) {
        const status = coldReplyStatus(control, json);
        const now = env.core?.[deviceControl]?.();
        if (status === "restore" && request.revision === env.credentialRevision && (!now || (now.transfer_store_id ?? now.store_id) === json.store_id)) {
          const work = env.witnessColdRestore({ storeId: String(json.store_id), head: Number(json.head ?? json.seq), capture: control }, !now);
          env.active.add(work); void work.finally(() => env.active.delete(work)).catch(() => {});
        }
        if (status !== "match") return { ok: false };
      } else if (path.startsWith("/q/")) return { ok: true, json, obsoleteAuth, searchIdentity: await searchReplyIdentity(capture, json, env.generation, env.witnessRestore) };
      return { ok: true, json, obsoleteAuth };
    } catch (error) {
      if (signal?.aborted || env.onlineBlocked()) return { ok: false };
      if (error instanceof SearchBound) throw error;
      env.transportFailure = transportRefusal(error);
      if (!signal?.aborted && !quiet && (!eph || env.ephemeralReads.current(eph))) env.setLink("offline");
      return { ok: false };
    }
  }

  async function refusePartition(denied: Refusal, revision: number) {
    await env.refusedSession(denied, revision);
    if (!denied.retryable && env.partitionDenied?.code !== "E_STORE_RESTORE") {
      if (!env.partitionDenied) console.error(`snapback4: the server refused the partition: ${denied.code}: ${denied.message}`);
      env.answers.refuse(env.watches.values(), denied); env.partitionDenied = denied!;
      env.pending.notify();
      for (const watch of env.watches.values()) void env.scheduleRead(watch);
    }
  }

  async function syncRound(): Promise<boolean> {
    if (!env.coreReady) return false;
    env.caughtUp = false;
    if (env.closed || env.sessionDead || env.versionBlocked() || env.partitionDenied?.code === "E_STORE_RESTORE") return false;
    try { await env.history.persistPending(); } catch { retryFlush(); return false; }
    const state = (await call({ op: "state" })).ok as { watermark: number; generation: number } | undefined;
    let watermark = state?.watermark ?? 0;
    const resumed = new Set<Watch>(), touched = { tables: new Set<string>(), unknown: false, resumed };
    let adoptedGeneration = false;
    let after: string | undefined;
    let catchingUp = false;
    let publicationOutstanding = false;
    let restartingSnapshot = false;
    let pageLimit = PAGE;
    let progressiveTurn = false;
    let progressiveCaughtUp = false;
    let acquisitionRequest: ReturnType<LocalAcquisition["request"]>;
    let recoveringAcquisition = false;
    try {
      for (let pages = 0; pages < 100_000; pages++) {
        let page: SyncPage;
        let pageRevision = env.credentialRevision;
        let requestedStore: string | null | undefined;
        let publishedStore: string | null | undefined;
        let backendRequired = false;
        let pageIncarnation = env.incarnation;
        const onlineCapture = { store_id: env.onlineStore ?? null, watermark: env.onlineHead, send_revision: 0 };
        try {
          const captured = await call({ op: "sync_state" });
          if (env.versionBlocked() || captured.denied) return false;
          const { generation: capturedGeneration, pending_ids: pending, send_revision, store_id, transfer_store_id, watermark: capturedWatermark, transfer_watermark, restore_watermark, restore_images_at, snapshot_catchup, pending_through, pending_complete, pending_bound, backend_required, restore_refusal } = captured.ok as { generation: number; pending_ids: string[]; pending_through: number; pending_complete: boolean; pending_bound: number; transfer_watermark: number; restore_watermark?: number; restore_images_at?: number; snapshot_catchup?: boolean; send_revision: number; store_id?: string | null; transfer_store_id?: string | null; watermark: number; backend_required?: boolean; restore_refusal?: Refusal };
          if (restore_refusal) { env.refuseRestore(restore_refusal); return false; }
          if (!env.compatibilityKnown && progressiveState(captured.ok) && !progressiveState(captured.ok)?.replacement_required) {
            const metadata = await loadBackend(env.doFetch, env.base, env.requestCredentials().headers, env.aborter.signal);
            env.compatibility = metadata.device_compatibility; env.compatibilityKnown = true;
          }
          backendRequired = !!backend_required;
          requestedStore = transfer_store_id ?? store_id;
          publishedStore = store_id;
          env.observeIncarnation(store_id ?? (env.progressive ? env.storeIdentity : undefined), backendRequired && env.partitionCurrent);
          env.storeIdentity = store_id ?? (env.progressive ? env.storeIdentity : undefined); env.identified = !!store_id && !backendRequired;
          pageIncarnation = env.incarnation;
          const snapshotRequest = restartingSnapshot || after !== undefined || env.acquisitionWalk.replacement(env.compatibility, captured.ok) && !snapshot_catchup;
          watermark = snapshotRequest ? 0 : transfer_watermark ?? capturedWatermark;
          catchingUp = !snapshotRequest && (snapshot_catchup ?? catchingUp);
          publicationOutstanding ||= watermark > capturedWatermark;
          const request = env.requestCredentials();
          const hints = [...env.watches.values()].filter(w => !(w as { lingering?: unknown }).lingering).map(w => foregroundHint(env.backend, w.op.name, w.args)).filter(h => h !== undefined);
          const acquisition = acquisitionRequest ?? env.acquisitionWalk.request(env.compatibility, captured.ok, hints, snapshotRequest || catchingUp);
          acquisitionRequest = acquisition;
          progressiveTurn = acquisition !== undefined;
          const { response, json } = await withReadSignal(env.version.signal, env.aborter.signal, signal => readWithAdmissionRetry(() => env.fetchSync(`${env.base}/sync`, { method: "POST", headers: request.headers, signal }, { generation: capturedGeneration, from: watermark, limit: pageLimit, after: after ?? null, stream: !snapshotRequest && (catchingUp || (after === undefined && publicationOutstanding)), pending, ...(requestedStore ? { store_id: requestedStore } : {}), ...acquisition }), () => !env.closed && !env.sessionDead && !env.versionBlocked() && request.revision === env.credentialRevision, signal));
          if ((json.denied as Refusal | undefined)?.code === "E_HTTP_RESPONSE" && response.status >= 500) { env.transportFailure = json.denied as Refusal; env.setLink("offline"); return false; }
          page = json as SyncPage;
          page.send_revision = send_revision;
          page.pending_through = pending_through;
          page.pending_complete = pending_complete;
          page.pending_bound = pending_bound;
          page.requested_watermark = watermark;
          page.captured_restore_watermark = restore_watermark;
          page.captured_restore_images_at = restore_images_at;
          page.captured_watermark = capturedWatermark;
          // This is a local capture, overwritten after decoding untrusted wire fields.
          page.captured_acquisition = acquisition?.acquire ? progressiveState(captured.ok)?.adoption_capture : undefined;
          pageRevision = request.revision;
        } catch (error) {
          env.transportFailure = transportRefusal(error);
          env.setLink("offline");
          return false;
        }
        if (env.closed || env.versionBlocked() || pageIncarnation !== env.incarnation || pageRevision !== env.credentialRevision) return false;
        // Preserve the pre-attachment server basis on the first fresh sync.
        // Continuation watermarks are pinned, not new head observations.
        const head = page.images_at ?? (page.snapshot ? !after ? page.watermark : undefined : !page.more ? page.watermark : undefined);
        if (env.progressive && typeof head === "number" && head < onlineCapture.watermark
          && await env.witnessRestore(page.store_id, head, onlineCapture, onlineCapture.watermark)) return false;
        const denied = page.denied as Refusal | undefined;
        if (env.incompatible(denied)) { if (!env.progressive) env.partitionDenied = denied!; env.pending.notify(); return false; }
        // @ref LLP 3000.007.003#5 — early discovery enters the same identity/adoption path as overflow.
        const generationChanged = denied?.code === "E_SYNC_GENERATION" && denied.family === "generation";
        if (generationChanged && (typeof page.watermark !== "number" || !Number.isFinite(page.watermark) || !Number.isInteger(page.watermark) || page.watermark < 0)) {
          env.setLink("offline");
          return false;
        }
        // @ref LLP 3000.007.001#3.11 — adopt an oversized reply's identity before shrinking or retrying its position.
        const acquireBound = !!acquisitionRequest?.acquire && denied?.code === "E_BOUND" && denied.family === "bound" && !denied.retryable;
        if (denied && !generationChanged && !responsePageTooLarge(denied) && !acquireBound) {
          if (overloaded(refusal(denied))) env.setLink("online");
          if ((progressiveTurn || recoveringAcquisition) && env.acquisitionWalk.refuse(denied)) env.localState.set({ state: "unavailable", executable: false, acquired: false, why: denied });
          await refusePartition(denied, pageRevision);
          return false;
        }
        // @ref LLP 3000.023#11 — record the POST outcome before identity/schema adoption can rebind its outbox.
        if (env.ordinarySending && (generationChanged || Number(page.generation ?? env.generation) !== env.generation || page.store_id !== requestedStore || backendRequired)) return false;
        // @ref LLP 3000.007#18.2 — sync identity retires the old partition before any read or outbox replay.
        let replacedStore = false;
        let adoptionCapture: Record<string, string | null> | undefined;
        {
          // Refusals deliver no rows; an overflow watermark is only an event cut.
          // Preserve image heads without inventing progress. Generation discovery
          // must validate retained evidence before adoption can clear it.
          const observed = await call({ op: "observe_store", page: denied ? { ...page, snapshot: false, events: [], more: true,
            ...(generationChanged ? { images_at: page.watermark } : {}) } : page });
          if (env.versionBlocked() || observed.denied || env.partitionDenied?.code === "E_STORE_RESTORE") { env.refuseRestore(observed.denied); return false; }
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
            env.storeIdentity = publishedStore ?? undefined; env.identified = !!env.storeIdentity && !observedState?.backend_required;
            await call({ op: "set_meta", key: "syncedAt:wall:1", value: "0" });
            for (const watch of env.watches.values()) void env.scheduleRead(watch);
          }
        }
        if (env.link !== "online") env.setLink("online");
        if (env.partitionDenied?.code === "E_STORE_RESTORE") return false;
        if (!denied) env.partitionDenied = null;
        const pageGeneration = Number(page.generation ?? env.generation);
        if (generationChanged || pageGeneration !== env.generation || (backendRequired && env.partitionCurrent)) env.observeIncarnation(env.storeIdentity, true);
        if (generationChanged || pageGeneration !== env.generation || replacedStore || backendRequired) {
          // A new store restarts generation numbers. Reload even on a match, then acquire its partition.
          let backendRevision = env.credentialRevision;
          const backendIncarnation = env.incarnation;
          try {
            const request = env.requestCredentials();
            backendRevision = request.revision;
            const nextBackend = await withReadSignal(env.version.signal, env.aborter.signal, signal => loadBackend(env.doFetch, env.base, request.headers, signal));
            if (env.closed || env.versionBlocked() || backendIncarnation !== env.incarnation || request.revision !== env.credentialRevision) return false;
            const adopted = await call({ op: "adopt", backend: nextBackend, store_id: publishedStore ?? null, send_revision: page.send_revision, adoption_capture: adoptionCapture });
            if (env.versionBlocked() || adopted.denied || env.partitionDenied?.code === "E_STORE_RESTORE") return false;
            env.backend = nextBackend;
            env.compatibility = nextBackend.device_compatibility; env.compatibilityKnown = true;
            env.generation = Number(nextBackend.generation ?? pageGeneration);
            env.onlineGeneration = env.generation;
            for (const watch of env.watches.values()) env.watchEphemeral(watch);
            env.partitionDenied = null;
            env.nativeReady = false;
            adoptedGeneration = true;
            await env.refreshAcquired(true);
            env.nativeReady = await env.installNative(env.aborter.signal);
          } catch (error) {
            if (error instanceof BackendRefusalError && env.incompatible(error.denied)) return false;
            if (error instanceof BackendAuthError) await env.refusedSession(error.denied, backendRevision);
            return false;
          }
          watermark = 0; after = undefined; catchingUp = false; publicationOutstanding = false; acquisitionRequest = undefined; continue;
        }
        if (denied) {
          // @ref LLP 3000.001.001#64-re-acquisition-stays-staged-in-the-first-increment — an atomic group can exceed delivery bounds although its rows fit a staged snapshot. Recover without publishing a partial floor.
          if (acquireBound && (!responsePageTooLarge(denied) || pageLimit === 1)) {
            acquisitionRequest = undefined; recoveringAcquisition = true;
            restartingSnapshot = true; after = undefined; catchingUp = false;
            env.acquisitionWalk.reset(); env.partitionDenied = null;
            continue;
          }
          if (page.snapshot === true && pageLimit === 1 && (watermark > 0 || catchingUp)) {
            // Restart at the reduced limit without adopting the refusal's watermark; snapshots can split commits.
            watermark = 0; after = undefined; catchingUp = false;
            restartingSnapshot = true;
            env.partitionDenied = null;
            continue;
          }
          if (pageLimit > 1) {
            pageLimit = Math.max(1, Math.floor(pageLimit / 2));
            continue;
          }
          if (recoveringAcquisition && env.acquisitionWalk.refuse(denied)) env.localState.set({ state: "unavailable", executable: false, acquired: false, why: denied });
          await refusePartition(denied, pageRevision);
          return false;
        }
        if (Number(page.watermark) < watermark || (catchingUp && page.snapshot) || (page.snapshot && page.more && !page.next)) return false;
        page.stage_snapshot = !!page.snapshot;
        page.snapshot_catchup = catchingUp;
        const applyingIncarnation = env.incarnation;
        const applied = await call({ op: "apply", page, first: !catchingUp && after === undefined }, touched);
        if (env.closed || env.versionBlocked() || applyingIncarnation !== env.incarnation) return false;
        if (applied.denied) { env.refuseRestore(applied.denied); return false; }
        restartingSnapshot = false; acquisitionRequest = undefined;
        const published = (applied.ok as { published?: boolean } | undefined)?.published !== false;
        publicationOutstanding = !published;
        // call() preserved committed tables for finally, even if media or the following metadata read fails.
        if (published) {
          const publishedRead = await call({ op: "sync_state", capture: false });
          if (env.closed || env.versionBlocked() || applyingIncarnation !== env.incarnation || publishedRead.denied) return false;
          const publishedState = publishedRead.ok as { store_id?: string | null; backend_required?: boolean; watermark: number } | undefined;
          publishedStore = publishedState?.store_id;
          env.observeIncarnation(publishedStore ?? undefined);
          env.storeIdentity = publishedStore ?? undefined; env.identified = !!env.storeIdentity && !publishedState?.backend_required;
          if (progressiveTurn && !publishedState?.backend_required) env.partitionCurrent = true;
          if (progressiveTurn) { env.setAcquired(progressiveState(publishedRead.ok)?.acquired === true); env.progress.usable(progressiveState(publishedRead.ok)); }
          watermark = publishedState?.watermark ?? watermark;
          // Journal receipts need the adopted store/head in awaited mode too.
          if (publishedStore) {
            if (env.onlineStore !== publishedStore) env.onlineHead = 0;
            env.onlineStore = publishedStore;
            env.onlineHead = Math.max(env.onlineHead, typeof head === "number" ? head : watermark);
          }
          if (publishedState) { for (const watch of env.answers.applied(env.watches.values(), publishedState.watermark)) resumed.add(watch); for (const table of env.followingIntents.applied()) touched.tables.add(table); }
        }
        if (page.snapshot && page.more && page.next) {
          after = page.next as string;
          continue;
        }
        after = undefined;
        if (page.snapshot) { catchingUp = true; continue; }
        // @ref LLP 3000.001.001#42-two-tiers-then-the-walk — one unit and a bounded ordinary drain per turn; queued interactive work precedes the next unit.
        if (progressiveTurn) {
          if (!env.acquisitionWalk.applied(page, published)) continue;
          progressiveCaughtUp = !page.more; break;
        }
        if (!page.more && published) {
          env.partitionCurrent = true;
          env.caughtUp = true;
          env.identityChecked = true;
          break;
        }
      }
      if (!env.caughtUp && !progressiveTurn) return false;
      await env.refreshAcquired();
      env.acquisitionWalk.pending = progressiveTurn && !env.acquired;
      if (progressiveTurn) { env.caughtUp = progressiveCaughtUp; env.identityChecked ||= progressiveCaughtUp; }
      env.seq = watermark; env.lastSyncAt = Date.now();
      await call({ op: "set_meta", key: "syncedAt:wall:1", value: String(env.lastSyncAt) });
      await env.queued(); // @ref LLP 3000.031#1.1 — refresh pending facts invalidated even by empty applies.
      // A later reconnect can establish custody that startup could not validate.
      const resumeSending = !env.sendingAllowed;
      listenForExit();
      if (resumeSending && env.sendingAllowed) void flush();
      return true;
    } finally {
      if (!env.closed && adoptedGeneration) {
        for (const watch of env.watches.values()) void env.scheduleRead(watch);
      } else if (!env.closed && (touched.unknown || touched.tables.size > 0 || resumed.size > 0)) {
        for (const watch of env.watches.values()) if (resumed.has(watch) || watch.serverRead || watch.deadlines?.localWakeup || touched.unknown || watch.tables.size === 0 || [...watch.tables].some((t) => touched.tables.has(t))) void env.scheduleRead(watch);
      } else if (!env.closed && env.caughtUp && env.identityChecked) {
        for (const watch of env.watches.values()) {
          if (runsOnServer(env.backend!, watch.op, env.nativeReady) || watch.kept || watch.changeCut !== undefined) { void env.scheduleRead(watch); continue; }
          if (watch.incarnation !== env.incarnation || !("data" in watch.snapshot) || watch.snapshot.fresh) continue;
          const { since: _, ...read } = watch.snapshot;
          watch.publish(readyRead({ ...read, fresh: true }, watch.pending?.() ?? false));
          notify(watch);
        }
      }
    }
  }

  async function probe(): Promise<void> {
    if (env.versionBlocked()) return; try {
      const request = env.requestCredentials();
      const probeIncarnation = env.incarnation;
      const capture = await env.captureStore();
      if (!capture || env.versionBlocked()) return;
      const onlineCapture = { store_id: env.onlineStore ?? null, watermark: env.onlineHead, send_revision: 0 };
      const response = await env.doFetch(`${env.base}/probe`, { headers: request.headers, signal: env.aborter.signal });
      const json = await readResponse(response);
      if (env.closed || env.versionBlocked()) return;
      await env.refusedSession(json.denied ?? json.why, request.revision);
      const denied = refusal(json.denied ?? json.why);
      if (denied && !env.sessionDead && probeIncarnation === env.incarnation && request.revision === env.credentialRevision) {
        if (denied.code !== "E_HTTP_RESPONSE") env.setLink("online");
        await pauseRefusal(response, { ...denied, retryable: true }, env.aborter.signal); return;
      }
      if (response.status === 200 && json.ok === true && !env.sessionDead && probeIncarnation === env.incarnation && request.revision === env.credentialRevision) {
        // @ref LLP 3000.007#18.2 — verify identity before reconnect can bless cached local answers or resume a long poll.
        if (env.progressive && json.store_id === onlineCapture.store_id && Number.isSafeInteger(Number(json.seq)) && Number(json.seq) < onlineCapture.watermark
          && await env.witnessRestore(json.store_id, Number(json.seq), onlineCapture, onlineCapture.watermark)) return;
        if (await env.witnessRestore(json.store_id, json.seq, capture) || env.versionBlocked()) return;
        if (typeof json.store_id === "string") env.observeIncarnation(json.store_id, json.store_id === env.storeIdentity && Number(json.seq) < Math.max(env.seq, capture.watermark));
        env.identityChecked = true;
        env.setLink("online");
      } else if (response.status !== 200 || json.ok !== true) env.setLink("offline");
    } catch (error) { env.transportFailure = transportRefusal(error); env.setLink("offline"); }
  }

  async function onlineEvidence(json: Record<string, unknown>, captured: StoreCapture, notified?: () => void): Promise<number | undefined> {
    const id = json.store_id, head = Number(json.head ?? (json.replayed === true ? undefined : json.seq));
    if (typeof id !== "string" || !Number.isSafeInteger(head) || head < 0) return;
    const replaced = env.onlineStore !== undefined && id !== env.onlineStore && id !== env.storeIdentity;
    if (!replaced && head < captured.watermark && await env.witnessRestore(id, head, captured, captured.watermark)) return;
    const nextGeneration = Number(json.generation ?? env.onlineGeneration);
    const changedProgram = nextGeneration !== env.onlineGeneration;
    if (replaced || changedProgram) {
      env.observeIncarnation(id, changedProgram, undefined, changedProgram ? "program-generation" : "store-reset");
      if (replaced) {
        env.onlineHead = 0;
        notified?.(); env.options.onStoreChange?.({ code: "E_STORE_REPLACED", family: "store", message: "the backend store identity changed" });
      }
    }
    env.onlineGeneration = nextGeneration;
    if (id !== env.onlineStore && id === env.storeIdentity) env.onlineHead = 0;
    env.onlineStore = id; env.storeIdentity = id; env.onlineHead = Math.max(env.onlineHead, head); env.identityChecked = true;
    // Capture the adopted epoch before the caller's await can yield to another
    // adoption. Authority stays epoch-bound; same-store cuts survive adoption.
    return env.incarnation;
  }

  async function waitOnlineChange(): Promise<void> {
    const request = env.requestCredentials(), revision = env.incarnation;
    const capture = { store_id: env.onlineStore ?? null, watermark: env.onlineHead, send_revision: 0 };
    const eph = env.ephemeralReads.pollRequest();
    delete request.headers["x-snapback-device"];
    try {
      const { response, json } = await env.changes(env.seq, env.options.waitSeconds ?? 25, request.headers, env.storeIdentity,
        Object.values(env.backend!.schema.tables).some(table => table.ephemeral) ? env.ephemeralReads.parameters() : undefined, eph.signal);
      if (env.closed || env.sessionDead || request.revision !== env.credentialRevision || revision !== env.incarnation) return;
      // A terminal refusal of the current credential outranks the attachment boundary.
      await env.refusedSession(json.denied, request.revision);
      if (env.sessionDead || !env.ephemeralReads.current(eph)) return;
      if (env.coreReady) {
        // Attachment completed while this poll was held: its store/head evidence still
        // counts (a witnessed shrink is fenced through the attached core), and so does its
        // change evidence: touched watches lose currency until sync applies that cut. The
        // attached core's sync owns the cursor, so `seq` does not move here.
        if (env.incompatible(json.denied)) return;
        if (response.ok && !json.denied || json.denied?.family === "generation") await onlineEvidence(json as unknown as Record<string, unknown>, capture);
        if (json.denied && json.denied.family !== "generation" && !json.denied.retryable && !(await pauseRefusal(response, json.denied, env.aborter.signal))) {
          env.changesStopped = json.denied; env.answers.refuse(env.watches.values(), json.denied); return;
        }
        if (response.ok && !json.denied && !env.partitionDenied && Number.isSafeInteger(json.seq) && json.store_id === env.storeIdentity && json.generation === env.generation) {
          const tables = env.answers.notified(json.tables, json.seq, json.seq > env.seq);
          if (json.seq > env.seq) for (const watch of env.watches.values()) if (evidenceTouches(watch, tables)) void env.scheduleRead(watch, true, json.seq, json.preserved);
        }
        return;
      }
      if (!response.ok || json.denied) {
        if (env.incompatible(json.denied)) return;
        // A real generation refusal may carry the adoption evidence too.
        await onlineEvidence(json as unknown as Record<string, unknown>, capture);
        if (json.denied?.family === "generation") return;
        if (await pauseRefusal(response, json.denied, env.aborter.signal)) return;
        if (json.denied && !json.denied.retryable) { env.changesStopped = json.denied; env.answers.refuse(env.watches.values(), json.denied); return; }
        throw new Error(`changes: HTTP ${response.status}`);
      }
      if (!env.ephemeralReads.changed(eph, json.ephemeral)) return;
      await onlineEvidence(json as unknown as Record<string, unknown>, capture);
      if (env.partitionDenied?.code === "E_STORE_RESTORE" || env.closed || env.sessionDead) return;
      env.setLink("online");
      const tables = env.answers.notified(json.tables, json.seq, json.seq > env.seq);
      if (json.seq > env.seq) for (const watch of env.watches.values()) if (evidenceTouches(watch, tables)) env.scheduleRead(watch, true, json.seq, json.preserved);
      env.seq = Math.max(env.seq, json.seq);
    } catch (error) {
      if (!env.closed && !env.sessionDead && env.ephemeralReads.current(eph)) { env.transportFailure = transportRefusal(error); env.setLink("offline"); await new Promise(resolve => setTimeout(resolve, 1000)); }
    }
  }

  async function waitForChange(): Promise<boolean> {
    if (env.versionBlocked()) return false;
    if (env.link !== "online") {
      await new Promise((r) => setTimeout(r, 1000));
      if (!env.closed && !env.sessionDead) await probe();
      return false;
    }
    if (!env.identityChecked) { await probe(); return !env.caughtUp; }
    const eph = env.ephemeralReads.pollRequest();
    try {
      const request = env.requestCredentials();
      const changeIncarnation = env.incarnation;
      const capture = await env.captureStore();
      if (!capture || env.versionBlocked()) return false;
      const onlineCapture = { store_id: env.onlineStore ?? null, watermark: env.onlineHead, send_revision: 0 };
      const { response, json } = await withReadSignal(env.version.signal, eph.signal, signal => env.changes(env.seq, env.options.waitSeconds ?? 25, request.headers, env.storeIdentity, Object.values(env.backend!.schema.tables).some(table => table.ephemeral) ? env.ephemeralReads.parameters() : undefined, signal));
      if (env.versionBlocked() || !env.ephemeralReads.current(eph)) return false;
      if (!response.ok || json.denied) {
        if (env.incompatible(json.denied)) { if (!env.progressive) env.changesStopped = json.denied!; return false; }
        await env.refusedSession(json.denied, request.revision);
        if (json.denied?.code === "E_AUTH" && !json.denied.retryable) return false;
        if (await pauseRefusal(response, json.denied, env.aborter.signal)) return false;
        if (refusal(json.denied) && !env.closed && changeIncarnation === env.incarnation && request.revision === env.credentialRevision) {
          env.changesStopped = json.denied!; env.pending.notify(); env.answers.refuse(env.watches.values(), json.denied!); return false; }
        throw new Error(`changes: HTTP ${response.status}`);
      }
      if (env.closed || changeIncarnation !== env.incarnation || request.revision !== env.credentialRevision) return false;
      if (!env.ephemeralReads.changed(eph, json.ephemeral)) return false;
      const replaced = json.store_id !== undefined && json.store_id !== env.storeIdentity;
      // @ref LLP 3000.002.000#6 — a head witnessed online before attachment fences a later same-store shrink here, as the sync round does.
      if (env.progressive && json.store_id === onlineCapture.store_id && Number.isSafeInteger(Number(json.seq)) && Number(json.seq) < onlineCapture.watermark
        && await env.witnessRestore(json.store_id, Number(json.seq), onlineCapture, onlineCapture.watermark)) return false;
      if (await env.witnessRestore(json.store_id, json.seq, capture) || env.versionBlocked()) return false;
      const notifiedTables = env.answers.notified(json.tables, json.seq, json.seq > env.seq, json.store_id === env.storeIdentity && json.generation === env.generation ? intervalChanges(json.changes, env.seq, json.seq) : undefined);
      const shrank = json.seq < Math.max(env.seq, capture.watermark);
      // @ref LLP 3000.023#10 — a program change retires the replica even with no touched tables or sequence advance.
      const generationChanged = json.generation !== undefined && json.generation !== env.generation;
      if (replaced || shrank || generationChanged) env.observeIncarnation(json.store_id, shrank || generationChanged, undefined, generationChanged ? "program-generation" : "store-reset");
      const changed = replaced || shrank || generationChanged || json.seq > env.seq;
      if (changed) {
        env.seq = Math.max(env.seq, json.seq);
        for (const watch of env.watches.values()) {
          if (evidenceTouches(watch, notifiedTables)) void env.scheduleRead(watch, true, json.seq, json.preserved);
        }
      }
      return changed;
    } catch (error) {
      env.transportFailure = transportRefusal(error);
      if (env.closed || env.versionBlocked() || !env.ephemeralReads.current(eph)) return false;
      env.setLink("offline");
      await new Promise((r) => setTimeout(r, 1000));
      return false;
    }
  }

  function follow() {
    if (env.following) return;
    env.following = (async () => {
      while (!env.closed && !env.sessionDead && !env.onlineBlocked() && !env.changesStopped && env.partitionDenied?.code !== "E_STORE_RESTORE") {
        if (env.progressive && !env.coreReady) { await waitOnlineChange(); continue; }
        if (env.caughtUp && !env.acquisitionWalk.pending && !await waitForChange()) continue;
        let ok = false;
        try {
          ok = await env.network.once();
        } catch {
          if (env.closed) break;
        }
        if (env.closed) break;
        if (!ok) await new Promise((r) => setTimeout(r, 1000));
      }
    })();
  }

  function flush(): Promise<void> {
    if (!env.coreReady || env.versionBlocked() || env.partitionDenied?.code === "E_STORE_RESTORE") return Promise.resolve();
    if (env.flushing) {
      env.flushAgain = true;
      return env.flushing;
    }
    if (env.closed || env.sessionDead) return Promise.resolve();
    if (env.retry) { clearTimeout(env.retry); env.retry = undefined; }
    const run = (async () => {
      try {
        do {
          env.flushAgain = false;
          await flushOnce();
        // A later admission cannot bypass the head's retryable hold/backoff.
        } while (env.flushAgain && !env.retry && env.link === "online" && !env.closed);
      } catch { retryFlush(); }
    })();
    env.flushing = run;
    void run.finally(() => { if (env.flushing === run) env.flushing = null; env.deliveryQueue?.available(); }).catch(() => {});
    return run;
  }

  function retryFlush() {
    if (env.closed || env.sessionDead || env.versionBlocked() || env.retry || env.partitionDenied?.code === "E_STORE_RESTORE") return;
    env.retry = setTimeout(() => { env.retry = undefined; void flush(); }, env.retryOverload ? jitter(Math.max(env.retryMs, env.retryAfterMs)) : Math.max(env.retryMs, env.retryAfterMs));
    env.retryAfterMs = 0; env.retryOverload = false;
    (env.retry as { unref?: () => void }).unref?.();
    env.retryMs = Math.min(5000, env.retryMs * 2);
  }

  async function flushOnce(acquire = true) {
    const syncUnobserved = (force = false) => syncSettledWrites(env.queued, env.network.once, () => env.caughtUp, acquire && !env.closed, force);
    await env.exitDone;
    if (env.closed || env.versionBlocked() || !env.sendingAllowed) return;
    if (env.reconcileNeeded) { env.reconcileNeeded = false; try { await env.media?.reconcile(); } catch { env.reconcileNeeded = true; retryFlush(); } }
    for await (const entry of receiptBatch(env.queued, env.history)) {
      await env.exitDone;
      if (env.closed || env.versionBlocked()) return;
      const success = successSequence(entry);
      if (success != null) {
        try { await deliverAcknowledgedReceipt(env.history, env.receiptCall, entry, success, env.completeWrite); } catch { retryFlush(); continue; }
        // @ref LLP 3000.019#3.3 — proven-success recovery/observation cannot gate the tail.
        if (acquire && (entry.observed_seq == null || !env.caughtUp) && (await env.queued().catch(() => { retryFlush(); return undefined; }))?.every(e => successSequence(e) != null)) await env.network.once();
        continue;
      }
      let ownsSettlement = false;
      try {
        const result = await env.network.run(async () => {
          await env.exitDone;
          if (env.closed || env.sessionDead) return { ok: false as const };
          let current = (await env.queued()).find(current => current.id === entry.id);
          if (!current) return { ok: true as const, retired: true as const };
          if (env.settling.has(entry.id)) return { ok: false as const };
          env.settling.add(entry.id);
          ownsSettlement = true;
          const known = await recoverReceipt(env.history, env.receiptCall, entry.id, current.sent_seq ?? current.observed_seq, successSequence(current) != null);
          if (known) return { ok: true as const, json: { ...known }, obsoleteAuth: false };
          const binding = entry.receipt_store?.id ?? entry.store_id ?? env.storeIdentity;
          if (!binding) return { ok: false as const };
          try {
            const prepared = await env.uploads.prepare(current);
            if (!prepared) return { ok: false as const };
            if ("cancelled" in prepared) {
              const why = { code: "E_UPLOAD_CANCELLED", family: "asset", message: "upload-and-place intent cancelled before placement dispatch" };
              await settleReceipt(env.history, env.receiptCall, { state: "failed", id: entry.id, why }, undefined, binding);
              return { ok: true as const, json: { state: "failed", why }, obsoleteAuth: false };
            }
            current = prepared.entry;
            const revision = env.credentialRevision;
            const started = await call({ op: "begin_send", id: entry.id });
            if (started.denied) return { ok: false as const };
            const receipt = (started.ok as { receipt?: Exclude<Write, { state: "pending" }>; qualified?: boolean } | undefined)?.receipt;
            if (receipt) { const known = await recoverReceipt(env.history, env.receiptCall, entry.id, receipt.state === "sent" ? receipt.seq : undefined, (started.ok as { qualified?: boolean }).qualified === true); if (known) return { ok: true as const, json: { ...known }, obsoleteAuth: false }; }
            if (env.closed || env.sessionDead || env.versionBlocked() || env.rotating || revision !== env.credentialRevision) return { ok: false as const };
            env.ordinarySending = entry.id;
            let response = await env.post(`/m/${entry.op}`, { id: entry.id, args: current.args, newIds: current.new_ids, store_id: binding }, env.settled.get(entry.id)?.response);
            if (response.ok && current.upload && !response.obsoleteAuth) {
              const why = (response.json.why ?? response.json.denied) as Refusal | undefined;
              if (why && !why.retryable) {
                const receipt = await env.uploads.finish(current, why);
                if (!receipt) return { ok: false as const };
                response = { ...response, json: receipt };
              }
            }
            if (response.ok) {
              const json = response.json, why = (json.why ?? json.denied) as Refusal | undefined;
              if (!response.obsoleteAuth && !why?.retryable && (json.state === "sent" || why)) {
                try {
                  await settleReceipt(env.history, env.receiptCall, json.state === "sent"
                    ? { state: "sent", id: entry.id, seq: Number(json.seq ?? 0), replayed: true }
                    : { state: "failed", id: entry.id, why: why! }, json.replayed === true && json.store_id === binding ? binding : undefined, binding);
                } catch { return { ...response, persistencePending: true }; }
              }
            }
            return response;
          } finally { env.ordinarySending = undefined; }
        });
        if (!result.ok) { await syncUnobserved(); retryFlush(); return; }
        if ("retired" in result) continue;
        const json = result.json;
        const why = (json.why ?? json.denied) as Refusal | undefined;
        if (result.obsoleteAuth || why?.retryable || (json.state !== "sent" && !why)) { await syncUnobserved(); retryFlush(); return; }
        env.retryMs = 250;
        const settle = env.settled.get(entry.id);
        env.settled.delete(entry.id);
        const outcome: Write = json.state === "sent"
          ? json.replayed === true
            ? { state: "sent", id: entry.id, seq: Number(json.seq ?? 0), replayed: true }
            : { state: "sent", id: entry.id, seq: Number(json.seq ?? 0), result: json.result }
          : { state: "failed", id: entry.id, why: (json.why as Refusal | undefined) ?? (json.denied as Refusal | undefined) ?? { code: "E_STORE", family: "store", message: "the server answered without a state", retryable: true } };
        if (!env.closed && !("persistencePending" in result)) {
          if (outcome.state !== "sent") env.rerunTables(predictedTables(entry.predicted));
          // Durable completion survives a failed observation check; retry sync separately.
          try { await syncUnobserved(outcome.state === "sent"); } catch { retryFlush(); }
        }
        settle?.resolve(outcome);
        env.emitWrite(outcome);
        if ("persistencePending" in result) { await syncUnobserved(); retryFlush(); return; }
      } catch { await syncUnobserved(); retryFlush(); return; }
      finally { if (ownsSettlement) env.settling.delete(entry.id); }
    }
    await syncUnobserved();
  }

  // @ref LLP 3000.007#18.2 — early replay needs the persisted store's identity and head; a replacement must retire known receipts through sync first.
  async function replayOnOpen(): Promise<boolean> {
    const capture = await env.captureStore();
    if (!capture || capture.backend_required || env.closed || env.sessionDead) return false;
    if (!capture.store_id) return false;
    const request = env.requestCredentials();
    let response: Response;
    try { response = await env.doFetch(`${env.base}/probe`, { headers: request.headers, signal: env.aborter.signal }); }
    catch { return !env.closed && !env.sessionDead; } // An unreachable probe leaves the kept store's offline custody intact.
    try {
      const head = await response.json();
      await env.refusedSession(head.denied ?? head.why, request.revision);
      if (!response.ok || head.ok !== true || env.closed || env.sessionDead || request.revision !== env.credentialRevision) return false;
      if (await env.witnessRestore(head.store_id, head.seq, capture)) return false;
      if (head.store_id !== capture.store_id) return false;
      return !env.closed && !env.sessionDead;
    } catch { return false; } // Failed validation or persistence cannot authorize exit transport.
  }

  function listenForExit() {
    if (!env.core?.onSuspend || env.stopSuspend || env.closed || env.sessionDead) return;
    env.sendingAllowed = true;
    const sendOnExit = exitTransport(env.doFetch, env.base, env.aborter.signal, exitRefusalSettlement({
      closed: () => env.closed, owners: env.settling, active: env.active,
      commit: async write => {
        const known = await env.history.read(write.id, true);
        if (known && known.state !== "pending") return false;
        const applied = await env.receiptCall({ op: "settle_exit", write });
        if (applied.denied) throw new Error(applied.denied.message);
        return applied.ok === true;
      },
      publish: write => {
        env.completeWrite(write);
        for (const watch of env.watches.values()) void env.scheduleRead(watch);
      },
    }), async (entry, why) => {
      if (!env.closed && !env.sessionDead && !env.settling.has(entry.id)) await env.holds.record(entry.id, why.code);
    });
    env.stopSuspend = env.core.onSuspend((entries, beginSend) => {
      const request = env.requestCredentials();
      // @ref LLP 3000.007#20.4 — document teardown may abort the ordinary request: only its same durable head may overlap the keepalive retry.
      env.exitDone = sendOnExit(entries, request.headers, () => {
        const started = (env.ordinarySending === undefined || env.ordinarySending === entries[0]?.id) && !env.history.hasUnpersisted(entries[0]!.id) && !env.closed && !env.sessionDead && !env.versionBlocked() && env.partitionDenied?.code !== "E_STORE_RESTORE" && !env.rotating && env.credentialRevision === request.revision && beginSend();
        if (started) env.pending.notify();
        return started && !env.closed && !env.sessionDead && !env.rotating && env.credentialRevision === request.revision;
      });
    });
  }
  return { call, syncRound, probe, onlineEvidence, waitOnlineChange, waitForChange, follow, sendPost, refusePartition, flush, retryFlush, flushOnce, replayOnOpen, listenForExit };
}
