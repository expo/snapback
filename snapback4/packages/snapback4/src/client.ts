import { dependencies, intersects, intervalChanges, readFootprint, type Changes, QueryCuts, waitForQueryWrites } from "./query-dependencies.ts";
import { bindSessionRefusal } from "./session-refusal.ts";
import { bindFollowing } from "./following-transport.ts";
import { assetReader, readAsset } from "./asset-progress.ts";
import { ReadScopeGate, readOnlyRefusal, validateReadOptions, registerReadVerification } from "./read-only.ts";
import { OnlineIntentPresentation, offerIntentRead, registerPendingIntents, registerIntentObserver } from "./pending-items.ts";
import { withDecorations, currentDecorations, valueDeadline, type ValueDeadlines, type DecorationPaths } from "./read-decoration.ts";
import { watchCanRevoke, evidenceTouches } from "./change-evidence.ts";
import { ObservationWork } from "./observation-work.ts";
import { episodeDeadline } from "./read-episode.ts";
import { readyRead } from "./read-existence.ts";
import { settledQuery, terminalQueryRefusal } from "./query-settlement.ts";
import { matchingReads } from "./read-key.ts";
import { readResponse, readWithAdmissionRetry, transportRefusal, jitter, retryAfter, pauseRefusal, pauseProbe, refusal, overloaded } from "./http-response.ts";
import { onlineDelivery } from "./online-delivery.ts";
import { offerDelivery } from "./delivery-acceptance.ts";
export type { DeliveryRefused } from "./delivery-state.ts";
// The card's words, from the module that returns them: `import { createClient, type Client } from "snapback4/client"`.
export { saveAsset, type Saved } from "./files.ts";
export type { Client, Principal, Session, Refusal, Read, Ready, SettledRead, Write, Signal, Act, Outcome, ActOptions, MutateOptions, MutationPromise, PendingWrite, Link, Query, Mutation, Ephemeral, Action, ArgsOf, ResultOf, RowOf, Observed, ObserveOptions, Cursor } from "./contract.ts";
import { deferReadNotifications } from "./read-notifications.ts";
import { armReadExpiry, correctReadExpiries, readDeadlineWithdrawn } from "./read-expiry.ts";
import { bindWatchPeek, observationKey, endLingering, closeWatchAnswers, observeWatch } from "./observe-watch.ts";
import type { BackendJson } from "./backend.ts";
import { EphemeralReads, type EphemeralRequest } from "./ephemeral-reads.ts";
import { ephemeralLane, routeMutations } from "./ephemeral.ts";
import { admissionRefusal, browserAdmission, failedAdmission, sdkOwning, BROWSER_WRITE_FIX, ONLINE_WRITE_FIX } from "./admission.ts";
import { serverClock } from "./clock.ts";
import { defaultFetch } from "#fetch";
import { ClosingResponses, trackClose, type ClosingResponse } from "./closing-responses.ts";
import { deferStart, trackRotation } from "./client-start.ts";
// The online tier (LLP 2000.000 §7.4): no store, no interpreter. Reads go
// to the server and are `fresh` when it answered; an observed read re-runs
// when a commit touches its tables; a write is sent with a client-minted id
// and applies at most once, and waits as `pending` while the link is down.
// Every word a screen reads is on the card (contract.ts).

import { ReadObservation } from "./read-observation.ts";
import { changeFeed } from "./changes.ts";
import { presenceRefresh } from "./presence-refresh.ts";
import { duringRead, checkRead, withReadSignal, READ_WORK_EXPIRED } from "./read-work.ts";
import { mutationWaitSeconds, MutationIds, WriteHistory } from "./writes.ts";
import { pendingChanges } from "./pending-writes.ts";
import type { ObserveOptions, Client, Cursor, Link, MutateOptions, Mutation, Observed, Principal, Query, Read, ReadCut, ReadMeter, Refusal, Write } from "./contract.ts";
import { logout, logoutAll as revokeAllSessions, refreshSession as rotateSession, type Session, type SignIn } from "./auth.ts";
import { isReadToken } from "./read-token.ts";
import { assetQueue } from "./asset-download.ts";
import { assetSource, fetchAsset, uploadAsset } from "./assets.ts";
import { act } from "./actions.ts";
import { waitForCaller } from "./request-wait.ts";
import { trackDispatch, type DispatchState } from "./online-dispatch.ts";
import { armRefusal, armRequest, operationArm, type ArmFence } from "./online-arm-fence.ts";
import { sha256, utf8 } from "./sha256.ts";

export interface ClientOptions {
  readonly readOnly?: boolean;
  /** Delivery reports refused by the application; these are separate from onWrite. */
  readonly onDeliveryRefused?: (event: import("./delivery-state.ts").DeliveryRefused) => void;
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

interface QueryResult<R> extends ValueDeadlines {
  publicationCurrent?: () => boolean;
  generation?: number | undefined;
  deadlineWithdrawn?: () => boolean;
  delivery?: unknown; credential?: number | undefined;
  read: Read<R>; tables: string[];
  scopes?: import("./local-reads.ts").ReadScopes | undefined; seq: number; epoch: number; nextExpiry: number | null;
  transportOffline?: boolean; ephemeralRequest?: EphemeralRequest; ephemeral?: unknown;
  /** The server's presence refresh interval (LLP 3000.018). */
  refresh?: number | undefined;
}
interface Watch extends ReadObservation<unknown> {
  answerGeneration?: number | undefined;
  scopes?: import("./local-reads.ts").ReadScopes | undefined;
  op: Query<unknown, unknown>;
  args: unknown;
  key: string;
  tables: Set<string>;
  /** Re-runs a watch whose answer read presence (LLP 3000.018), every
   * `presenceEvery` ms until a successful answer reads none. */
  presenceRefresh: ReturnType<typeof setTimeout> | null;
  presenceEvery?: number | undefined;
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

/** The id a stable key names, in the `mintId()` form: the same key gives the
 * same id on every client and host. For fixtures, seeds and replays keyed by a
 * label (`idFrom("seed:post-17")`), as a write id or a fixture row's id. It is a
 * name, not a secret: anyone who knows the key knows the id. A derived id sorts
 * before every minted id, as if minted at the epoch. */
export function idFrom(key: string): string {
  if (typeof key !== "string" || key === "") throw new TypeError("idFrom: the key must be a non-empty string");
  const digest = sha256(utf8(JSON.stringify(["snapback4:id:v1", key])));
  // 80 bits of hash under a zero time: a derived row never crowds a `by .id`
  // window of minted rows, and the first ten digits read as zeros.
  let value = 0n;
  for (let i = 0; i < 10; i++) value = (value << 8n) | BigInt(digest[i]!);
  let out = "";
  for (let i = 0; i < 26; i++) {
    out = ALPHABET[Number(value & 31n)] + out;
    value >>= 5n;
  }
  return out;
}

let warnedBrowserWrites = false;

export function createClient(options: ClientOptions): Client {
  validateReadOptions(options);
  // @ref LLP 3000.013#6.2 — say so at construction, not at the first refused click.
  if (!options.readOnly && !sdkOwning() && browserAdmission() && !warnedBrowserWrites) {
    warnedBrowserWrites = true;
    console.warn(`snapback4: createClient in a browser reads, but refuses durable writes with E_ADMISSION: it has no synchronous admission journal. For browser writes use ${ONLINE_WRITE_FIX} when no table syncs, otherwise ${BROWSER_WRITE_FIX}. Pass readOnly: true to silence this.`);
  }
  const clock = serverClock(options.fetch ?? defaultFetch);
  // @ref LLP 3000.017#3.3 — ordinary responses discover schema capability without changing durable traffic.
  const transport = clock.wrap(options.fetch ?? defaultFetch);
  const doFetch: typeof fetch = async (...args) => {
    if (readGate) {
      const why = await readGate.verify();
      if (why) return Response.json({ denied: why }, { status: 403 });
      const sent = new Headers(args[1]?.headers).get("authorization");
      if (sent !== headers.authorization) return Response.json({ denied: auth() }, { status: 401 });
    }
    const response = await transport(...args);
    if (!closed && response.headers.get("x-snapback-ephemeral") === "1" && !ephemeralAdvertised) {
      ephemeralAdvertised = true;
      backendLoaded = false;
      ephemeralReads.reissuePoll();
    }
    if (response.headers.get("x-snapback-settlement") === "1") settlementAdvertised = true;
    return response;
  };
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
  let delivery: ReturnType<typeof onlineDelivery> | undefined;
  const aborter = new AbortController();
  const downloads = assetQueue();
  const requests = new Set<Promise<unknown>>();
  let closing: Promise<void> | undefined;
  const closingResponses = new ClosingResponses();
  let seq = 0;
  let minimumReadSeq = 0, queryEpoch = 0;
  const queryChanges = new QueryCuts();
  let queryBackend: BackendJson | undefined, settlementAdvertised = false, queryGeneration = 0;
  let storeIdentity: string | undefined;
  const readGate = options.readOnly ? new ReadScopeGate(base, transport,
    () => ({ token: headers.authorization?.slice(7), revision: credentialRevision, store: storeIdentity, closed: closed || !!storeRefusal || !credentials }),
    json => { observeStore(json, minimumReadSeq); if (typeof json.viewer === "string") setViewer(json.viewer as Principal); }, aborter.signal) : undefined;
  const dispatch: DispatchState = { identify: async () => {
    if (!storeIdentity && !probed) await waitForCaller(probe(), aborter.signal);
  } };
  let probed = false;
  let storeRefusal: Refusal | null = null;
  const linkListeners = new Set<(link: Link) => void>();
  const sessionListeners = new Set<(session: Session | null) => void>();
  const viewerListeners = new Set<(viewer: Principal | null) => void>();
  const history = options.readOnly ? undefined : new WriteHistory();
  const mutationIds = options.readOnly ? undefined : new MutationIds();
  const pendingEvents = pendingChanges();
  let intentEpoch = 0;
  const intentScope = () => closed || !credentials || storeRefusal ? undefined : `${viewer}:${storeIdentity}`;
  const intentPresentation = options.readOnly ? undefined : new OnlineIntentPresentation(intentScope, pendingEvents.notify);
  const writeListeners = new Set<(write: Exclude<Write, { state: "pending" }>) => void>();
  const emitWrite = <T extends Exclude<Write, { state: "pending" }>>(write: T): T => {
    history?.remember(write);
    mutationIds?.finish(write.id);
    const entry = pending.find(entry => entry.id === write.id);
    if (entry && !entry.retired && entry.owner === viewer) intentPresentation?.settled(write, { id: entry.id, op: entry.op.name, args: entry.args, state: entry.state, predicted: [] });
    intentPresentation?.release(write.id);
    if (entry) entry.done = true;
    pendingEvents.notify();
    for (const listener of writeListeners) listener(write);
    return write;
  };
  const watches = new Map<string, Watch>();
  const resetWatches = (publish = true, cause = "schema-reset") => {
    intentEpoch++; intentPresentation?.items(); pendingEvents.notify();
    const deliver = deferReadNotifications(() => {
      endLingering(watches.values());
      for (const watch of watches.values()) { watch.reset({ loading: true }, false, cause); scheduleExpiry(watch, null, null); }
    });
    if (publish) { deliver(); for (const watch of watches.values()) notify(watch); }
    return deliver;
  };
  const ephemeralReads = new EphemeralReads(aborter.signal);
  let backend: BackendJson | undefined;
  let backendLoaded = false, ephemeralAdvertised = false, schemaLoading = false;
  const ephemeralTables = (op: Query<unknown, unknown>) => backend
    ? backend.schema.operations?.[op.name]?.ephemeralReads ?? [] : op.ephemeralReads ?? [];
  const hasEphemeral = () => backend ? Object.values(backend.schema.tables).some(table => table.ephemeral)
    : ephemeralAdvertised || [...watches.values()].some(watch => ephemeralTables(watch.op).length);
  async function refreshBackend(minimumGeneration: number | undefined) {
    if (refreshing) await refreshing;
    if (closed || storeRefusal || !credentials || !watches.size) return false;
    const revision = credentialRevision, floor = minimumReadSeq;
    const { response, json } = await readWithAdmissionRetry(() => doFetch(`${base}/schema`, { headers: { ...headers }, signal: aborter.signal }), () => !closed && credentials && revision === credentialRevision, aborter.signal);
    const next = json as unknown as BackendJson & { denied?: Refusal };
    if (closed || storeRefusal || !watches.size) return false;
    if (await obsoleteRefusal(next.denied, revision)) return false;
    if (!credentials || revision !== credentialRevision || !response.ok || !next.schema?.tables) return false;
    if (minimumGeneration !== undefined && (!Number.isSafeInteger(next.generation) || next.generation < minimumGeneration)) return false;
    observeStore(json, floor);
    if (storeRefusal) return false;
    const firstBackend = !backend;
    // @ref LLP 3000.017#3.3 — capability installation retires pre-discovery answers, including in-flight reads.
    if (firstBackend) queryEpoch++;
    if (backend && next.generation < backend.generation) return false;
    backend = next;
    if (next.store_id === storeIdentity && (!queryBackend || next.generation > queryBackend.generation)) { queryBackend = next; pendingEvents.notify(); }
    ephemeralAdvertised = Object.values(next.schema.tables).some(table => table.ephemeral);
    for (const watch of watches.values()) watchEphemeral(watch);
    if (firstBackend) {
      const deliver = resetWatches(false); deliver();
      for (const watch of watches.values()) { notify(watch); void scheduleRead(watch); }
    }
    // Seeding is safe only after existing answers have been retired. Later
    // generations still belong to the poll's invalidation path.
    generation ??= next.generation;
    return true;
  }
  async function loadBackend(minimumGeneration = generation) {
    // Discovery failures and the adoption publication window retry here, so a
    // held /changes request cannot postpone installation for its whole wait.
    // Until the interests are known, query polling keeps durable changes live.
    // @ref LLP 3000.023#3.4 — discovery withdraws; copying an answer through reset loses its episode.
    schemaLoading = true;
    queryEpoch++;
    const deliver = resetWatches(false); deliver();
    for (const watch of watches.values()) { notify(watch); void scheduleRead(watch); }
    const fallback = setInterval(() => {
      if (closed || storeRefusal || !credentials || !watches.size) { clearInterval(fallback); return; }
      for (const watch of watches.values()) void scheduleRead(watch);
    }, 500);
    try {
      let backoff = 25;
      while (!closed && !storeRefusal && credentials && watches.size > 0) {
        try { backendLoaded = await waitForCaller(refreshBackend(minimumGeneration), aborter.signal) === true; } catch { backendLoaded = false; }
        if (backendLoaded) return true;
        await waitForCaller(new Promise(resolve => setTimeout(resolve, backoff)), aborter.signal);
        backoff = Math.min(backoff * 2, 500);
      }
      return false;
    } finally {
      clearInterval(fallback);
      schemaLoading = false;
      if (backendLoaded && !closed && !storeRefusal && credentials) for (const watch of watches.values()) void scheduleRead(watch);
    }
  }
  const ephemeral = options.readOnly ? undefined : ephemeralLane({ url: base, fetch: doFetch, headers: () => ({ ...headers }),
    link: () => link, mint: mintId, signal: aborter.signal, offline: () => setLink("offline"),
    unavailable: () => storeRefusal ?? (closed ? ended() : !credentials ? auth() : null), storeId: () => storeIdentity });

  const pending: { owner: Principal | null; retired?: boolean; id: string; op: Mutation<unknown, unknown>; args: unknown; state: "queued" | "sent" | "held"; reason?: string; done?: boolean; response: ClosingResponse; resolve: (write: Write) => void }[] = [];
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

  let authRefusal: Refusal | undefined;
  const endCredentials = (why?: Refusal) => {
    void delivery?.stop();
    if (!credentials) return;
    authRefusal = why;
    session = null;
    stopRefresh(auth());
    credentialRevision += 1;
    if (refreshTimer) clearTimeout(refreshTimer);
    credentials = false;
    intentPresentation?.clear();
    delete headers.authorization;
    delete headers["x-snapback-persona"];
    setViewer(null);
    setLink("signed-out");
    pendingEvents.notify();
    // A dead session refreshes nothing (LLP 3000.018 §3.2).
    for (const watch of watches.values()) { if (watch.presenceRefresh) clearTimeout(watch.presenceRefresh); watch.presenceRefresh = null; watch.presenceEvery = undefined; }
    for (const listener of [...sessionListeners]) listener(null);
  };

  const setLink = (next: Link) => {
    if (closed || storeRefusal || (!credentials && next !== "signed-out")) return;
    if (link === next) return;
    link = next; pendingEvents.notify();
    const changed: Watch[] = [];
    const deliver = deferReadNotifications(() => {
      if (next === "signed-out") endLingering(watches.values());
      if (next !== "online") for (const watch of watches.values()) {
        if (next === "signed-out" || "data" in watch.snapshot) {
          if (next === "signed-out") watch.publish({ denied: auth() }); else watch.failed(true);
          changed.push(watch);
        }
      }
    });
    deliver();
    for (const watch of changed) notify(watch);
    ephemeral?.linkChanged();
    for (const listener of linkListeners) listener(next);
    if (next === "online") {
      void delivery?.reconnect();
      void flush();
      for (const watch of watches.values()) void scheduleRead(watch);
    } else if (next === "signed-out") failUnsentWrites(auth());
  };

  const setViewer = (next: Principal | null) => {
    if (viewer === next) return;
    // @ref LLP 3000.023#3.4 — account retirement also fences queued arguments
    // and late receipts. The initial token-only identification adopts its queue.
    for (const entry of pending) {
      if (viewer !== null) entry.retired = true;
      else if (!entry.retired) entry.owner = next;
    }
    if (viewer !== null) intentPresentation?.clear();
    viewer = next;
    void delivery?.reset(true);
    resetWatches(true, "viewer");
    if (credentials) for (const watch of watches.values()) void scheduleRead(watch);
    for (const listener of viewerListeners) listener(next);
  };

  let transportFailure: Refusal | undefined, changesRefusal: Refusal | undefined;
  const offline = (): Refusal => transportFailure ?? transportRefusal();
  const auth = (): Refusal => authRefusal ?? ({ code: "E_AUTH", family: "auth", message: "sign in to continue" });
  const ended = (): Refusal => ({ code: "E_CLOSED", family: "client", message: "this client is closed" });

  function stopForStore(code: "E_STORE_REPLACED" | "E_STORE_RESTORE") {
    if (storeRefusal) return;
    intentPresentation?.clear();
    void delivery?.reset(true);
    storeRefusal = { code, family: "store", site: "client", guide: "sync",
      message: `${code === "E_STORE_REPLACED" ? "the backend store identity changed" : "the backend store sequence regressed"}; outstanding writes may have executed and their outcomes are unknown; this client will not retry them`,
      rewrite: "close this client and create a new client for the current backend; reconcile outstanding writes before submitting new intent" };
    // @ref LLP 3000.023#3.4 — even lingering approvals withdraw before callbacks can inspect a peer.
    const deliver = deferReadNotifications(() => {
      endLingering(watches.values());
      queryEpoch++;
      // Terminal connectivity is observable without discarding the session that
      // createApp may validate on its replacement client.
      link = "signed-out";
      if (retry) { clearTimeout(retry); retry = undefined; }
      if (refreshTimer) clearTimeout(refreshTimer);
      aborter.abort();
      stopRefresh(storeRefusal!);
      for (const watch of watches.values()) { watch.reset({ denied: storeRefusal! }); scheduleExpiry(watch, null, null); }
    });
    deliver();
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

  function observeStore(json: Record<string, unknown>, floorAtDispatch: number, receipt = false, touched?: Changes): void {
    if (storeRefusal) return;
    const why = (json.denied ?? json.why) as Refusal | undefined;
    if (why?.code === "E_STORE_REPLACED" || why?.code === "E_STORE_RESTORE") { stopForStore(why.code); return; }
    const id = json.store_id;
    if (typeof id !== "string" || !id) return; // Older servers have no identity envelope.
    if (storeIdentity !== undefined && id !== storeIdentity) { stopForStore("E_STORE_REPLACED"); return; }
    storeIdentity = id;
    if (typeof json.generation === "number" && Number.isSafeInteger(json.generation) && json.generation > queryGeneration) {
      queryGeneration = json.generation; pendingEvents.notify();
    }
    if (dispatch.store !== id) { dispatch.store = id; dispatch.owner?.observe(id); }
    // Replayed receipts name a historical commit; their head is the current
    // store watermark. A buffered response may predate a later observed write,
    // so restoration compares with the floor at dispatch, not at delivery.
    const head = receipt && json.replayed === true ? json.head : json.head ?? json.seq;
    if (typeof head !== "number" || !Number.isSafeInteger(head) || head < 0) return;
    if (head < floorAtDispatch) { stopForStore("E_STORE_RESTORE"); return; }
    if (head > minimumReadSeq) queryChanges.change(head, touched);
    minimumReadSeq = Math.max(minimumReadSeq, head);
  }

  const scheduleRefresh = (retryAfter?: number) => {
    if (refreshTimer) clearTimeout(refreshTimer);
    refreshTimer = undefined;
    if (closed || storeRefusal || !credentials || !session || session.kind === "action") return;
    // @ref LLP 3000.033#1.3 — read sessions expire without any SDK rotation.
    if (readGate || isReadToken(session.token)) {
      const remaining = session.expiresAt - clock.issuedDeviceNow();
      if (remaining <= 0) { endCredentials(); return; }
      refreshTimer = setTimeout(() => scheduleRefresh(), Math.min(remaining, 2_147_000_000));
      (refreshTimer as { unref?: () => void }).unref?.();
      return;
    }
    const untilDue = Math.max(0, session.expiresAt - clock.issuedDeviceNow() - refreshBeforeExpiry);
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
    const token = headers.authorization?.slice("Bearer ".length);
    if (readGate || isReadToken(token)) return Promise.resolve({ ok: false, why: readOnlyRefusal("E_READ_ONLY_REFRESH") });
    if (closed || storeRefusal) return Promise.resolve({ ok: false, why: storeRefusal ?? ended() });
    if (refreshing) return refreshing;
    if (!credentials || !token || options.persona) return Promise.resolve({ ok: false, why: authRefusal ?? { code: "E_AUTH", family: "auth", message: "sign in with a session to refresh it" } });
    const expectedPrincipal = viewer;
    credentialRevision += 1;
    const deliverReset = resetWatches(false, "credentials");
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
    void rotation.then(result => { if (closed || storeRefusal || !credentials) retire(result); });
    const work = (async (): Promise<SignIn> => {
      const refreshed = await Promise.race([rotation, refreshStopped]);
      if (storeRefusal) { retire(refreshed); return { ok: false, why: storeRefusal }; }
      if (closed) { retire(refreshed); return { ok: false, why: ended() }; }
      // Sign-out separately ends credentials and cancels adoption.
      if (!credentials) { retire(refreshed); return { ok: false, why: auth() }; }
      credentialRevision += 1;
      if (!refreshed.ok) {
        if (refreshed.why.code === "E_AUTH" && !refreshed.why.retryable) endCredentials(refreshed.why);
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
        for (const watch of watches.values()) void scheduleRead(watch);
        scheduleRefresh();
      }
      return refreshed;
    })();
    refreshing = work;
    deliverReset();
    for (const watch of watches.values()) notify(watch);
    void work.finally(() => { if (refreshing === work) refreshing = null; }).catch(() => {});
    return work;
  }

  // A rotation invalidates the old token. Its late refusal is not a refusal
  // of the replacement: retry at the new revision (writes keep their id).
  async function obsoleteRefusal(why: Refusal | undefined, revision: number): Promise<boolean> {
    if (why?.code !== "E_AUTH" || why.retryable) return false;
    if (refreshing) await refreshing;
    if (storeRefusal || closed) return false;
    if (revision !== credentialRevision && credentials && !closed && !storeRefusal) return true;
    if (!closed) endCredentials(why);
    return false;
  }

  // A quiet request is a background presence refresh: its failure retries on the
  // refresh timer and says nothing about the link (LLP 3000.018 §3.2).
  function post(path: string, body: unknown, captured?: ClosingResponse, eph?: EphemeralRequest, quiet = false, signal?: AbortSignal, arm?: ArmFence) {
    let arrived = false;
    const request = waitForCaller(sendPost(path, body, 0, known => { arrived = known; }, captured, eph, quiet, signal, arm), signal ?? eph?.signal ?? aborter.signal, () => arrived).then(result => {
      // A terminal store change owns outstanding effect outcomes: preserve its
      // explicit unknown-outcome refusal instead of an ordinary offline retry.
      if (storeRefusal && path.startsWith("/a/")) return { ok: true as const, json: { denied: storeRefusal } };
      return result ?? { ok: false as const };
    });
    requests.add(request);
    void request.finally(() => requests.delete(request)).catch(() => {});
    return request;
  }

  async function sendPost(path: string, body: unknown, attempt = 0, arrived = (_known: boolean) => {}, captured?: ClosingResponse, eph?: EphemeralRequest, quiet = false, signal?: AbortSignal, arm?: ArmFence): Promise<{ ok: true; json: Record<string, unknown>; revision?: number } | { ok: false }> {
    if (refreshing) await refreshing;
    const retired = armRefusal(arm);
    if (retired) return { ok: true, json: { denied: retired } };
    if (signal?.aborted || closed || !credentials || storeRefusal || (eph && !ephemeralReads.current(eph))) return { ok: false };
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
    try { encoded = JSON.stringify(path.startsWith("/m/") ? { ...(body as object), retry_write: true } : body); }
    catch { return { ok: true, json: { denied: { code: "E_INPUT", family: "input", message: "request arguments must be JSON-serializable" } } }; }
    try {
      // @ref LLP 3000.019#3.3 — the list follows dispatch, never receipt state.
      if (path.startsWith("/m/")) {
        const entry = pending.find(entry => entry.id === (body as { id: string }).id);
        if (entry) { entry.state = "sent"; delete entry.reason; pendingEvents.notify(); }
      }
      // A synchronous dispatch subscriber can end or rotate this session.
      if (closed || !credentials || storeRefusal || refreshing || revision !== credentialRevision) return { ok: false };
      const send = () => doFetch(`${base}${path}`, armRequest({ method: "POST", headers: { ...headers, ...(options.meter && path.startsWith("/q/") ? { "x-snapback-meter": "1" } : {}) }, body: encoded, ...((path.startsWith("/q/") || path.startsWith("/following/")) ? { signal: signal ?? eph?.signal ?? aborter.signal } : {}) }, arm));
      const { response, json } = path.startsWith("/q/")
        ? await readWithAdmissionRetry(send, () => !armRefusal(arm) && !closed && credentials && revision === credentialRevision && (!eph || ephemeralReads.current(eph)) && !signal?.aborted, signal ?? eph?.signal ?? aborter.signal)
        : await send().then(async response => ({ response, json: await readResponse(response) }));
      // Late bodies are consumed without adoption. A parsed effect response
      // already known at close still finishes its local settlement.
      if (signal?.aborted || (eph && !ephemeralReads.current(eph))) return { ok: false };
      captured?.capture(json, response.status);
      if (closed) return { ok: false };
      arrived(true);
      if (storeRefusal) return { ok: false };
      const mutation = path.startsWith("/m/") ? pending.find(entry => entry.id === (body as { id: string }).id) : undefined;
      const metadata = queryBackend ?? backend;
      const writes = mutation && metadata?.generation === json.generation && dependencies(metadata, mutation.op.name)?.writes;
      observeStore(json, floor, !!mutation, writes && json.replayed !== true && (json.head ?? json.seq) === json.seq && json.seq === minimumReadSeq + 1 ? writes : undefined);
      if (storeRefusal) return { ok: false };
      const why = (json.why ?? json.denied) as Refusal | undefined;
      if (why?.code === "E_HTTP_RESPONSE" && response.status >= 500) { transportFailure = why; if (!quiet) setLink("offline"); return { ok: false }; }
      const entry = path.startsWith("/m/") ? pending.find(entry => entry.id === (body as { id: string }).id) : undefined;
      if (entry && why?.retryable) {
        await hold(entry, why.code);
        retryAfterMs = retryAfter(response.headers.get("retry-after"));
        retryOverload = why.code === "E_RATE_LIMIT";
      }
      // An arm's local refusal is not a rejection of the shared client's live
      // credential. Retired calls cannot retry under its replacement either.
      if (!armRefusal(arm) && await obsoleteRefusal((json.denied ?? json.why) as Refusal | undefined, revision)) {
        arrived(false);
        if (attempt === 3) return { ok: false };
        await new Promise(resolve => setTimeout(resolve, 25 * 2 ** attempt));
        return sendPost(path, body, attempt + 1, arrived, captured, eph, quiet, signal, arm);
      }
      if (storeRefusal || (closed && !path.startsWith("/m/") && !path.startsWith("/a/"))) return { ok: false };
      if (credentials && typeof json.viewer === "string") setViewer(json.viewer as Principal);
      if (link !== "online" && credentials) setLink("online");
      return { ok: true, json, revision };
    } catch (error) {
      if (signal?.aborted) return { ok: false };
      transportFailure = transportRefusal(error);
      if (!signal?.aborted && credentials && !quiet && (!eph || ephemeralReads.current(eph))) setLink("offline");
      return { ok: false };
    }
  }

  async function runQuery<A, R>(op: Query<A, R>, args: A, quiet = false, signal?: AbortSignal): Promise<QueryResult<R>> {
    checkRead(signal);
    if (op == null || typeof op !== "object" || typeof op.name !== "string") return { read: { denied: { code: "E_OP", family: "op", message: "pass a generated handle (api.op), not an operation name", guide: "client" } }, tables: [], seq: minimumReadSeq, epoch: queryEpoch, valueDevice: null, valueServer: null, nextExpiry: null };
    const eph = ephemeralTables(op).length ? ephemeralReads.request() : undefined;
    const result = await withReadSignal(signal, eph?.signal ?? aborter.signal, stopped => runQueryOnce(op, args, eph, quiet, stopped));
    checkRead(signal);
    return { ...result, deadlineWithdrawn: () => result.nextExpiry !== null && result.nextExpiry > clock.estimatedServerNow()
      && readDeadlineWithdrawn(matchingReads(watches.values(), op, args), result.nextExpiry), ...(eph ? { ephemeralRequest: eph } : {}) };
  }
  async function runQueryOnce<A, R>(op: Query<A, R>, args: A, eph?: EphemeralRequest, quiet = false, signal?: AbortSignal): Promise<QueryResult<R>> {
    const epoch = queryEpoch;
    if (closed || storeRefusal || changesRefusal) return { read: { denied: storeRefusal ?? changesRefusal ?? ended() }, tables: [], seq: minimumReadSeq, epoch, valueDevice: null, valueServer: null, nextExpiry: null };
    if (!credentials || link === "signed-out") return { read: { denied: auth() }, tables: [], seq: minimumReadSeq, epoch, valueDevice: null, valueServer: null, nextExpiry: null };
    const result = await post(`/q/${op.name}`, { args }, undefined, eph, quiet, signal, operationArm(op));
    if (storeRefusal || closed) return { read: { denied: storeRefusal ?? ended() }, tables: [], seq: minimumReadSeq, epoch: queryEpoch, valueDevice: null, valueServer: null, nextExpiry: null };
    if (!credentials) return { read: { denied: auth() }, tables: [], seq: minimumReadSeq, epoch, valueDevice: null, valueServer: null, nextExpiry: null };
    if (!result.ok) return { read: { denied: offline() }, tables: [], seq: minimumReadSeq, epoch, valueDevice: null, valueServer: null, nextExpiry: null, transportOffline: true };
    const json = result.json;
    const refresh = typeof json.refresh === "number" && Number.isFinite(json.refresh) ? json.refresh : undefined;
    if (json.denied) return { ephemeral: json.ephemeral, read: { denied: json.denied as Refusal }, tables: (json.tables as string[] | undefined) ?? [], seq: Number(json.seq ?? json.head ?? minimumReadSeq), epoch, valueDevice: null, valueServer: null, nextExpiry: null, refresh };
    const values: ValueDeadlines = { valueDevice: null, valueServer: valueDeadline(json.decorationExpiry, Array.isArray(json.decorationPaths)) };
    const at = Number(json.seq ?? 0);
    const nextExpiry = typeof json.nextExpiry === "number" && Number.isFinite(json.nextExpiry) ? json.nextExpiry : null;
    if (json.loading || !("data" in json)) return { ephemeral: json.ephemeral, read: { loading: true }, tables: (json.tables as string[] | undefined) ?? [], seq: Number(json.seq ?? json.head ?? minimumReadSeq), epoch, nextExpiry, valueDevice: null, valueServer: null, refresh };
    const next = (json.next as Cursor | null | undefined) ?? null;
    const meter = json.meter ? { meter: json.meter as ReadMeter } : {};
    const read = readyRead({ data: json.data as R, complete: json.complete !== false, cut: (json.cut ?? null) as ReadCut, fresh: !schemaLoading, next, ...meter });
    withDecorations(read, Array.isArray(json.decorationPaths) ? json.decorationPaths as DecorationPaths : [], values.valueDevice,
      values.valueServer, clock.issuedDeviceNow, clock.estimatedServerNow);
    return { generation: typeof json.generation === "number" ? json.generation : undefined, scopes: json.scopes as import("./local-reads.ts").ReadScopes | undefined, delivery: json.delivery, credential: result.revision, ephemeral: json.ephemeral, read, tables: (json.tables as string[] | undefined) ?? [], seq: at, epoch, nextExpiry, ...values, refresh };
  }

  const currentRead = <R>(result: QueryResult<R>, watch?: Watch) => {
    result.read = currentDecorations(result.read);
    const current = result.epoch === queryEpoch && (result.seq >= minimumReadSeq || result.publicationCurrent?.() === true)
      && (result.nextExpiry === null || result.nextExpiry > clock.estimatedServerNow())
      && (result.credential === undefined || result.credential === credentialRevision)
      && (!result.ephemeralRequest || ephemeralReads.accept(result.ephemeralRequest, result.ephemeral, watch));
    return current;
  };

  function acceptDelivery<R>(result: QueryResult<R> & { retryExhausted?: boolean }, read: Read<unknown>) {
    if (options.readOnly) return;
    if ("data" in result.read && !result.transportOffline && !result.retryExhausted) {
      const scope = intentScope();
      offerIntentRead(read, scope, result.seq, () => scope != null && scope === intentScope() && currentRead(result));
    }
    offerDelivery(client, read, current => { void delivery?.accept(result.delivery, current).catch(() => {}); },
      () => !closed && !storeRefusal && credentials && currentRead(result));
  }

  function watchEphemeral(watch: Watch) {
    const tables = ephemeralTables(watch.op);
    if (!tables.length) { ephemeralReads.remove(watch); return; }
    ephemeralReads.add(watch, tables, (reset, changed, preserved) => {
      const deliver = reset ? watch.reset({ loading: true }, true) : undefined;
      if (reset) scheduleExpiry(watch, null, null);
      return () => {
        deliver?.();
        if (watches.get(watch.key) !== watch) return;
        if (reset) notify(watch);
        void scheduleRead(watch, changed, preserved);
      };
    });
  }

  const readyNotifications = new Map<Watch, readonly (() => void)[]>();
  let readyNotificationTimer: ReturnType<typeof setTimeout> | undefined;
  let readyNotificationAt = Infinity;
  function cancelReadyNotification() {
    if (readyNotificationTimer !== undefined) clearTimeout(readyNotificationTimer);
    readyNotificationTimer = undefined;
    readyNotificationAt = Infinity;
  }
  function flushReadyNotifications() {
    cancelReadyNotification();
    const ready = [...readyNotifications]; readyNotifications.clear();
    for (const [watch, subscribers] of ready) {
      if (watches.get(watch.key) !== watch || !("data" in watch.snapshot)) continue;
      for (const subscriber of subscribers) if (watch.subscribers.has(subscriber)) {
        try { subscriber(); } catch (error) { console.error("snapback4 client listener:", error); }
      }
    }
  }
  // @ref LLP 3000.023#10 — coalesce ready notifications under pressure, never authorization or withdrawals.
  function notifyReady(watch: Watch, previousDeadline: number | undefined) {
    readyNotifications.set(watch, [...watch.subscribers]);
    if (!readWork.hasPending) { flushReadyNotifications(); return; }
    // Publication retires the old episode timer. Its displayed answer still
    // needs a notification by that same bound, even when other work is held.
    const now = Date.now();
    const at = Math.min(now + (typeof document === "undefined" ? 0 : 50), previousDeadline ?? Infinity);
    if (previousDeadline !== undefined && previousDeadline <= now) { flushReadyNotifications(); return; }
    if (at >= readyNotificationAt) return;
    cancelReadyNotification(); readyNotificationAt = at;
    readyNotificationTimer = setTimeout(flushReadyNotifications, at - now);
  }
  function notify(watch: Watch) {
    readyNotifications.delete(watch);
    for (const subscriber of watch.subscribers) subscriber();
  }

  function scheduleExpiry(watch: Watch, nextExpiry: number | null, valueServer: QueryResult<unknown>["valueServer"], valueRetry?: number) {
    armReadExpiry(watch, { device: null, server: nextExpiry, localWakeup: false, valueDevice: null, valueServer, valueRetry }, clock,
      () => !closed && watches.get(watch.key) === watch, sweepExpiries, undefined, link === "online");
  }

  function sweepExpiries() {
    correctReadExpiries(watches.values(), clock, withdrawExpiry,
      (watch, d) => scheduleExpiry(watch, d.server, d.valueServer, d.valueRetry),
      watch => { if (watches.get(watch.key) === watch) void acquireRead(watch); });
  }

  function withdrawExpiry(watch: Watch): () => void {
    const deliver = watch.expire();
    return () => { deliver(); if (watches.get(watch.key) === watch) notify(watch); };
  }

  // @ref LLP 3000.018#3.2 — a server's reply decides the refresh interval; a transport failure keeps it, so it retries.
  function schedulePresence(watch: Watch, answered: boolean, after?: number) {
    // A closed client or ended credentials keep no interval, whichever read settles last.
    if (closed || !credentials) watch.presenceEvery = undefined;
    else if (answered) watch.presenceEvery = after;
    watch.presenceRefresh = presenceRefresh(watch.presenceRefresh, watch.presenceEvery, () => {
      watch.presenceRefresh = null;
      void refreshPresence(watch);
    });
  }

  // @ref LLP 3000.018#3.2 — a presence refresh reads in the background and publishes only an answer that
  // nothing replaced meanwhile: expiry, invalidation and sign-out keep their own immediate withdrawal.
  async function refreshPresence(watch: Watch) {
    if (closed || storeRefusal || !credentials || watches.get(watch.key) !== watch) return;
    if (watch.inFlight) return; // The fetch in flight re-arms the refresh when it settles.
    const shown = watch.snapshot;
    const result = await runQuery(watch.op, watch.args, true);
    if (closed || watches.get(watch.key) !== watch) return;
    // A reply that a newer publication or read overtook decides nothing: the newer one armed the timer.
    if (watch.snapshot !== shown || watch.inFlight) return;
    // A failed or stale reply keeps the answer and the interval, and retries.
    if (result.transportOffline || result.deadlineWithdrawn?.() || !currentRead(result, watch)) { schedulePresence(watch, false); return; }
    if (watch.snapshot !== shown || watch.inFlight || watches.get(watch.key) !== watch) return;
    // An accepted reply is published whatever it says, loading and refusals included.
    watch.tables = new Set(result.tables); watch.scopes = result.scopes; watch.answerGeneration = result.generation;
    watch.publish(result.read);
    acceptDelivery(result, watch.snapshot);
    ephemeralReads.incomplete(watch, "data" in result.read && !result.read.complete);
    if (!watch.kept) scheduleExpiry(watch, result.nextExpiry, result.valueServer);
    notify(watch);
    schedulePresence(watch, true, result.refresh);
  }

  const readWork = new ObservationWork<Watch>(false);
  function scheduleRead(watch: Watch, changed = false, preserved?: unknown, evidenceGeneration?: unknown) {
    if (changed && typeof evidenceGeneration === "number" && watch.answerGeneration !== undefined && evidenceGeneration !== watch.answerGeneration) watch.reset({ loading: true }, false, "program-generation");
    const bounded = changed && watchCanRevoke(watch, preserved);
    if (closed || storeRefusal) { watch.reset({ denied: storeRefusal ?? ended() }); notify(watch); return; }
    // Online change evidence may be revocation: its budget includes capacity wait.
    watch.reload(bounded, { queued: !bounded }); notify(watch);
    acquireRead(watch);
    if (changed) readWork.prioritize(watch);
  }
  function acquireRead(watch: Watch) {
    if (watch.inFlight) { watch.dirty = true; return; }
    readWork.schedule(watch, signal => refresh(watch, signal));
  }
  async function refresh(watch: Watch, signal: AbortSignal) {
    if (watches.get(watch.key) !== watch) return;
    if (closed || storeRefusal) { watch.reset({ denied: storeRefusal ?? ended() }); notify(watch); return; }
    if (watch.inFlight) {
      watch.dirty = true;
      return;
    }
    // @ref LLP 3000.023#3.5 — every option follows the reset fence; retention never renews an episode.
    watch.inFlight = true;
    const resetVersion = watch.resetVersion;
    let exhausted = false, retryExpired = false, batchReady = true;
    try {
      const result = await duringRead(watch.fetch(() => runQuery(watch.op, watch.args, false, signal), () => notify(watch), { publishResult: false, revalidate: watch.kept || !("data" in watch.snapshot), accept: result => {
        if (signal.aborted) return true;
        if (result.deadlineWithdrawn?.()) return true;
        // Due bodies return to the paced queue without exhausting the sequence retry round.
        if (result.nextExpiry !== null && result.nextExpiry <= clock.estimatedServerNow()) return true;
        if (!currentRead(result, watch)) return false;
        // Install deadlines before publication: a subscriber can close synchronously.
        if (!result.transportOffline) {
          // Do not move either side of a row-expiry boundary into a UI batch.
          batchReady &&= watch.deadlines?.server == null && result.nextExpiry === null;
          scheduleExpiry(watch, result.nextExpiry, result.valueServer);
        }
        return true;
      } }), signal);
      checkRead(signal);
      if (result.deadlineWithdrawn?.()) return;
      if (resetVersion !== watch.resetVersion) { watch.dirty = credentials; return; }
      const { tables, retryExhausted } = result;
      exhausted = retryExhausted === true;
      if (closed || watches.get(watch.key) !== watch) return;
      if (storeRefusal || !currentRead(result, watch)) {
        if (!storeRefusal && result.nextExpiry !== null && result.nextExpiry <= clock.estimatedServerNow()) { retryExpired = true; return; }
        if (storeRefusal) watch.reset({ denied: storeRefusal }); else watch.failed(result.transportOffline);
        if (!watch.kept) scheduleExpiry(watch, null, null);
        schedulePresence(watch, false);
        notify(watch);
        return;
      }
      if (!result.transportOffline && !exhausted) { watch.tables = new Set(tables); watch.scopes = result.scopes; watch.answerGeneration = result.generation; }
      const previousDeadline = episodeDeadline(watch.snapshot);
      if (result.transportOffline || exhausted) watch.failed(result.transportOffline); else watch.publish(result.read);
      acceptDelivery(result, watch.snapshot);
      if (batchReady && !result.transportOffline && !exhausted && watch.deadlines?.server == null
        && "data" in watch.snapshot && watch.snapshot.existence === "present") notifyReady(watch, previousDeadline);
      else notify(watch);
      ephemeralReads.incomplete(watch, "data" in result.read && !result.read.complete);
      if (exhausted && !watch.kept) scheduleExpiry(watch, null, null);
      schedulePresence(watch, !exhausted && !result.transportOffline, result.refresh);
    } catch {
      if (!signal.aborted && !closed && resetVersion === watch.resetVersion && watches.get(watch.key) === watch) { watch.failed(link === "offline"); notify(watch); }
    } finally {
      watch.inFlight = false;
      const dirty = watch.dirty;
      watch.dirty = false;
      if (credentials && !closed && !storeRefusal && !exhausted && watches.get(watch.key) === watch) {
        if (retryExpired && !signal.aborted) readWork.retry(watch, 25, signal => refresh(watch, signal));
        else if (dirty || signal.reason === READ_WORK_EXPIRED) void acquireRead(watch);
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
    let response: Response | undefined;
    try {
      response = await doFetch(`${base}/probe`, { headers: { ...headers }, signal: aborter.signal });
      const json = await readResponse(response);
      if (closed || storeRefusal) return;
      observeStore(json, floor);
      if (storeRefusal) return;
      if (await obsoleteRefusal(json.denied as Refusal | undefined, revision)) {
        if (attempt < 3) { await new Promise(resolve => setTimeout(resolve, 25 * 2 ** attempt)); await probeOnce(attempt + 1); }
        return;
      }
      if (overloaded(refusal(json.denied)) && credentials && revision === credentialRevision) setLink("online");
      if (response.status === 200 && json.ok === true && credentials && revision === credentialRevision) {
        probed = true;
        setLink("online");
        return;
      }
    } catch {}
    if (!closed && credentials && !storeRefusal) await pauseProbe(response, aborter.signal);
  }

  const changes = changeFeed(doFetch, base, aborter.signal, () => { if (!closed && credentials) setLink("offline"); }, () => { if (!closed && credentials && link === "offline") void probe(); });

  async function poll() {
    if (polling) return;
    polling = true;
    while (!closed && !storeRefusal && !changesRefusal && watches.size > 0) {
      if (link !== "online") {
        await new Promise((r) => setTimeout(r, 1000));
        if (!closed && credentials && link === "offline") await probe();
        continue;
      }
      if (!backendLoaded && ephemeralAdvertised && !await loadBackend()) continue;
      const eph = ephemeralReads.pollRequest();
      try {
        if (refreshing) await refreshing;
        if (closed || storeRefusal || !credentials) break;
        const revision = credentialRevision;
        const floor = minimumReadSeq;
        const { response, json } = await changes(seq, options.waitSeconds ?? 25, { ...headers }, storeIdentity, hasEphemeral() ? ephemeralReads.parameters() : undefined, eph.signal);
        if (closed || storeRefusal) break;
        if (!ephemeralReads.current(eph)) continue;
        observeStore(json as unknown as Record<string, unknown>, floor, false, seq <= minimumReadSeq ? (json.generation === queryBackend?.generation ? intervalChanges(json.changes, seq, json.seq) : undefined) ?? json.tables : undefined);
        if (storeRefusal) break;
        if (await obsoleteRefusal(json.denied, revision)) continue;
        if (closed || storeRefusal || !credentials) break;
        if (await pauseRefusal(response, json.denied, aborter.signal)) continue;
        if (refusal(json.denied)) {
          changesRefusal = json.denied; queryEpoch++; pendingEvents.notify();
          const deliver = deferReadNotifications(() => { for (const watch of watches.values()) { watch.reset({ denied: changesRefusal! }); scheduleExpiry(watch, null, null); } });
          deliver(); for (const watch of watches.values()) notify(watch);
          break;
        }
        if (!ephemeralReads.changed(eph, json.ephemeral)) continue;
        if (!response.ok || json.denied) throw new Error(`changes: HTTP ${response.status}`);
        const changedGeneration = generation !== undefined && json.generation !== undefined && generation !== json.generation;
        minimumReadSeq = Math.max(minimumReadSeq, json.seq);
        if (changedGeneration) {
          const deliver = resetWatches(false, "program-generation");
          queryEpoch++;
          deliver();
          for (const watch of watches.values()) notify(watch);
          if ((backend || ephemeralAdvertised) && !await loadBackend(json.generation)) continue;
        }
        generation = backend?.generation ?? json.generation;
        if (json.seq > seq || changedGeneration) {
          seq = Math.max(seq, json.seq);
          for (const watch of watches.values()) {
            if (changedGeneration || evidenceTouches(watch, json.tables)) void scheduleRead(watch, true, json.preserved, json.generation);
          }
        }
      } catch (error) {
        transportFailure = transportRefusal(error);
        if (closed || storeRefusal) break;
        if (!ephemeralReads.current(eph)) continue;
        if (credentials) setLink("offline");
        await new Promise((r) => setTimeout(r, 1000));
      }
    }
    polling = false;
  }

  async function hold(entry: (typeof pending)[number], reason: string) {
    entry.state = "held"; entry.reason = reason;
    pendingEvents.notify();
    await dispatch.owner?.held?.(entry.id, reason);
  }
  async function send(entry: (typeof pending)[number]): Promise<boolean> {
    const result = await post(`/m/${entry.op.name}`, { id: entry.id, args: entry.args }, entry.response);
    if (storeRefusal) return true;
    if (!result.ok) return false;
    const json = result.json;
    const refusal = (json.why ?? json.denied) as Refusal | undefined;
    if (refusal?.retryable) {
      await hold(entry, refusal.code);
      return false;
    }
    if (json.state === "sent") {
      const at = Number(json.seq ?? 0);
      minimumReadSeq = Math.max(minimumReadSeq, at);
      const outcome = json.replayed === true
        ? { state: "sent", id: entry.id, seq: at, replayed: true } as const
        : { state: "sent", id: entry.id, seq: at, result: json.result } as const;
      entry.resolve(outcome);
      emitWrite(outcome);
      for (const watch of watches.values()) void scheduleRead(watch, true, json.preserved, json.generation);
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
  let retryAfterMs = 0, retryOverload = false;
  function flush(): Promise<void> {
    if (flushing) return flushing;
    if (retry) { clearTimeout(retry); retry = undefined; }
    const run = async () => {
      try {
        while (!closed && !storeRefusal && pending.length > 0 && link !== "signed-out") {
          const entry = pending[0]!;
          sending = entry;
          let sent: boolean;
          try { sent = await send(entry); }
          finally { sending = null; }
          if (!sent) {
            if (closed || storeRefusal || !credentials) return;
            retry = setTimeout(() => { retry = undefined; void flush(); }, retryOverload ? jitter(Math.max(retryMs, retryAfterMs)) : Math.max(retryMs, retryAfterMs));
            retryAfterMs = 0; retryOverload = false;
            (retry as { unref?: () => void }).unref?.();
            retryMs = Math.min(retryMs * 2, 5000);
            return;
          }
          retryMs = 250;
          pending.shift();
        }
      } finally {
        // Release custody before this run resolves. A caller receiving the
        // last receipt may admit its successor before promise adoption ends.
        if (flushing === result) flushing = null;
      }
    };
    // A pending-list subscriber may submit another write at dispatch. Install
    // the flush owner before notifying it, so the same head is not sent twice.
    const result = Promise.resolve().then(run);
    flushing = result;
    void result.catch(() => {});
    return result;
  }

  const stopClock = clock.subscribe((shift, revised) => {
    // Sub-frame sampling noise must not make a query response refetch itself.
    if (closed || (!revised && Math.abs(shift) < 10)) return;
    sweepExpiries();
    scheduleRefresh();
  });
  if (!options.readOnly) delivery = onlineDelivery({ offline: () => setLink("offline"), url: base, fetch: doFetch, mint: mintId,
    ready: () => !closed && credentials && !storeRefusal && !refreshing && link === "online" && !!storeIdentity,
    current: () => !closed && credentials && !storeRefusal, headers: () => ({ ...headers }), revision: () => credentialRevision,
    floor: () => minimumReadSeq, store: () => storeIdentity, observe: (json, floor) => observeStore(json, floor, true),
    obsolete: obsoleteRefusal, refresh: () => refreshing, onRefused: options.onDeliveryRefused });
  void delivery?.start();
  const client: Client = {
    readOnly: options.readOnly ?? false,
    async residency() { return null; },
    now: clock.issuedDeviceNow,
    act(op, args, options) {
      if (readGate) return Promise.resolve({ state: "failed", id: options?.id ?? mintId(), why: readOnlyRefusal() });
      const arm = operationArm(op);
      const response = closingResponses.request();
      return act(op, args, options, options?.id ?? mintId(), (path, body) => post(path, body, response, undefined, false, undefined, arm), () => armRefusal(arm) ?? storeRefusal ?? (closed ? ended() : !credentials || link === "signed-out" ? auth() : link !== "online" ? offline() : undefined), async () => { if (closed) { await closingResponses.done; return storeRefusal ? { ok: true, json: { denied: storeRefusal } } : response.take(); } });
    },
    query: settledQuery(async <A, R>(op: Query<A, R>, args: A, signal: AbortSignal) => {
      if (link === "offline") { void probe(); return () => ({ denied: offline() }); }
      const floor = minimumReadSeq;
      const evaluate = async () => {
        const candidate = await runQuery(op, args, false, signal);
        // Discover through ordinary traffic. Old servers/adapters need no new
        // request and retain the unknown barrier. Bind facts to the reply generation.
        if ("data" in candidate.read && settlementAdvertised && (!queryBackend || queryBackend.generation !== candidate.generation)) {
          try {
            const discoveryFloor = minimumReadSeq, discoveryRevision = credentialRevision;
            const response = await doFetch(`${base}/schema`, { headers: { ...headers }, signal });
            const json = await duringRead(response.json(), signal); checkRead(signal);
            // @ref LLP 3000.023#11 — optional facts never suppress a current-session refusal.
            const obsolete = await obsoleteRefusal(json.denied, discoveryRevision); checkRead(signal);
            if (!obsolete && credentials && !closed && discoveryRevision === credentialRevision && response.ok && json.schema?.tables && Array.isArray(json.programs)) {
              observeStore(json, discoveryFloor);
              if (!storeRefusal && json.store_id === storeIdentity && Number.isSafeInteger(json.generation)
                && (!queryBackend || json.generation > queryBackend.generation)) {
                queryBackend = json; pendingEvents.notify();
              }
            }
          } catch { checkRead(signal); }
        }
        return candidate;
      };
      const read = new ReadObservation<R>();
      const result = await read.fetch<QueryResult<R>>(evaluate, () => {}, { publishResult: false });
      const schema = result.generation !== undefined && queryBackend?.generation === result.generation ? queryBackend : undefined;
      const inputs = dependencies(schema, op.name)?.reads;
      if (queryBackend && result.generation !== undefined && queryBackend.generation !== result.generation) {
        return () => undefined;
      }
      if (inputs && schema && result.generation === schema.generation) result.publicationCurrent = () => result.seq >= floor
        && queryChanges.current(result.seq, readFootprint(inputs, result.tables));
      // Discovery is a publication fence, including after facade approval and during custody waits.
      const installedFacts = queryBackend, candidateStore = storeIdentity;
      const factsCurrent = () => queryBackend === installedFacts && storeIdentity === candidateStore
        && (result.generation === undefined || result.generation === queryGeneration);
      const blocks = () => factsCurrent() && link !== "offline" && !closed && !storeRefusal && !changesRefusal && credentials && pending.some(w => !w.done && !w.retired
        && intersects(inputs, dependencies(schema, w.op.name)?.writes));
      return () => {
        if (link === "offline") return { denied: offline() };
        if (!factsCurrent()) return;
        if (result.deadlineWithdrawn?.() || !currentRead(result)) return;
        // Only custody may waive a publication round. Loading or obsolete
        // candidates still spend the existing bound, even with pending writes.
        if ("data" in result.read && blocks()) return { wait: (signal: AbortSignal) => waitForQueryWrites(blocks, pendingEvents.subscribe, signal) };
        acceptDelivery(result, result.read);
        return result.read;
      };
    }, () => terminalQueryRefusal({ scope: null, store: readGate?.refusal ?? storeRefusal, closed: closed ? ended() : null,
      session: !credentials || link === "signed-out" ? auth() : null, changes: changesRefusal,
      partition: null, inherited: null }), aborter.signal),
    observe<A, R>(op: Query<A, R>, args: A, options?: ObserveOptions): Observed<R> {
      const keep = options?.keep;
      const key = observationKey(op, args, options);
      return observeWatch(watches, key,
        () => {
          const watch: Watch = Object.assign(new ReadObservation<unknown>(keep), { op: op as Query<unknown, unknown>, args, key, tables: new Set<string>(), presenceRefresh: null, subscribers: new Set<() => void>(), inFlight: false, dirty: false, expiryTimer: null });
          watch.dependencies = () => ({ tables: watch.tables, scopes: watch.scopes });
          return watch;
        },
        watch => { watchEphemeral(watch); void scheduleRead(watch); void poll(); },
        watch => { readWork.cancel(watch); ephemeralReads.remove(watch); }, () => armRefusal(operationArm(op)) ?? storeRefusal ?? (closed ? ended() : !credentials ? auth() : null), true,
        watch => { watch.dirty = false; return readWork.cancel(watch); });
    },
    mutate: routeMutations(options.readOnly ? () => Promise.resolve({ state: "failed", id: mintId(), why: readOnlyRefusal() }) : ephemeral!.mutate, function<A, R>(op: Mutation<A, R>, args: A, options?: MutateOptions): Promise<Write<R>> {
      const id = options?.id === undefined ? mintId() : options.id;
      if (op == null || typeof op !== "object" || typeof op.name !== "string") return failedAdmission(id, { code: "E_OP", family: "op", message: "pass a generated handle (api.op), not an operation name", guide: "client" });
      if (readGate) return failedAdmission(id, readOnlyRefusal());
      if (closed || !credentials || link === "signed-out" || storeRefusal) {
        const failed = { state: "failed" as const, id, why: storeRefusal ?? (closed ? ended() : auth()) };
        return Object.assign(Promise.resolve(mutationIds?.knows(id) ? failed : emitWrite(failed)), failed);
      }
      // The bare online transport has no browser admission journal. An app's
      // private online custody may replay an intent it already persisted.
      if (browserAdmission() && !dispatch.owner) return failedAdmission<R>(id, admissionRefusal(
        "this online client has no synchronous browser admission journal; createApp journals browser writes: without a device when no table syncs, with webDevice() otherwise", "client.mutate",
        `${ONLINE_WRITE_FIX} when no table syncs; otherwise ${BROWSER_WRITE_FIX}`));
      return mutationIds!.run<R>(id, op.name, args, () => client.write(id), async (args, write) => {
        let settle!: (write: Write) => void;
        const settled = new Promise<Write>((resolve) => { settle = resolve; });
        const entry: (typeof pending)[number] = { owner: viewer, id, op: op as Mutation<unknown, unknown>, args, state: "queued", response: closingResponses.request(), resolve: settle };
        pending.push(entry);
        intentPresentation?.admit(id);
        pendingEvents.notify();
        history?.remember(write);
        const attempt = flush();
        const wait = mutationWaitSeconds(options?.waitSeconds);
        if (link !== "online" || wait === 0) return write;
        let timer: ReturnType<typeof setTimeout> | undefined;
        try {
          const timeout = wait === undefined ? [] : [new Promise<Write>(resolve => { timer = setTimeout(() => resolve(write), wait * 1_000); })];
          const outcome = await Promise.race([settled, attempt.then((): Write => write), ...timeout]) as Write<R>;
          if (outcome.state === "pending" && closed) { await closingResponses.done; return entry.response.write(outcome); }
          return outcome;
        } finally { clearTimeout(timer); }
      });
    }),
    async write(id) { const receipt = await history?.read(id); return !closed && credentials ? receipt : undefined; },
    async pendingWrites() {
      return closed || !credentials || storeRefusal ? [] : pending.filter(entry => !entry.done && !entry.retired && entry.owner === viewer).map(entry => ({
        id: entry.id, op: entry.op.name, args: JSON.parse(JSON.stringify(entry.args)), state: entry.state,
        ...(entry.reason ? { reason: entry.reason } : {}), predicted: [],
      }));
    },
    onPendingWrites: pendingEvents.subscribe,
    acquired: false,
    onAcquired: () => () => {},
    async upload(bytes, options) {
      if (readGate) return { ok: false, why: readOnlyRefusal() };
      if (storeRefusal || closed) return { ok: false, why: storeRefusal ?? ended() };
      if (refreshing) await refreshing;
      if (storeRefusal || closed) return { ok: false, why: storeRefusal ?? ended() };
      if (!credentials || link === "signed-out") return { ok: false, why: auth() };
      const requestHeaders = { ...headers };
      const sameSession = () => !refreshing && requestHeaders.authorization === headers.authorization;
      const uploaded = await waitForCaller(uploadAsset(base, requestHeaders, doFetch, bytes,
        () => !storeRefusal && !closed && credentials && sameSession(), options), aborter.signal);
      // Uploads have no mutation id: an obsolete success cannot be replayed or
      // handed to another session. A stopped retry also returns this refusal.
      if (!uploaded || storeRefusal || closed || !credentials) return { ok: false, why: storeRefusal ?? (closed ? ended() : auth()) };
      if (!sameSession()) return { ok: false, why: { code: "E_AUTH", family: "auth", message: "the session changed during upload; start the upload again" } };
      if (!uploaded.ok && uploaded.why.code === "E_AUTH" && !uploaded.why.retryable) endCredentials(uploaded.why);
      if (!uploaded.ok && uploaded.why.code === "E_OFFLINE") setLink("offline");
      return uploaded;
    },
    asset: assetReader(async (id, progress) => {
      if (readGate) { const why = await readGate.verify(); if (why) return { denied: why }; }
      if (storeRefusal || closed) return { denied: storeRefusal ?? ended() };
      if (refreshing) { progress("refresh"); await refreshing; }
      if (storeRefusal || closed) return { denied: storeRefusal ?? ended() };
      if (!credentials) return { denied: auth() };
      const revision = credentialRevision, assetPrincipal = viewer;
      const read = await fetchAsset(base, { ...headers }, doFetch, id, undefined, aborter.signal, () => !storeRefusal && !closed && credentials && revision === credentialRevision, downloads, progress);
      if (storeRefusal || closed || !credentials) {
        if ("url" in read) read.revoke();
        return { denied: storeRefusal ?? (closed ? ended() : auth()) };
      }
      // @ref LLP 3000.008.002.000#6 — completed bytes stay with the same principal; rotation cannot authorize a replay.
      if (revision !== credentialRevision) {
        if ("url" in read && assetPrincipal !== null && assetPrincipal === viewer) return read;
        if ("denied" in read) {
          // Admission backoff belongs to the transfer, not its bearer. Keep
          // the outcome (including Retry-After) for permitted hook recovery.
          if (read.denied.code === "E_AUTH") return readAsset(client, id, progress);
          return read;
        }
        read.revoke();
        return { denied: { code: "E_AUTH", family: "auth", message: "the session changed during download; the view may already have been consumed" } };
      }
      if ("denied" in read && await obsoleteRefusal(read.denied, revision)) return readAsset(client, id, progress);
      if (storeRefusal || closed || !credentials) {
        if ("url" in read) read.revoke();
        return { denied: storeRefusal ?? (closed ? ended() : auth()) };
      }
      return read;
    }),
    assetSource: (id) => storeRefusal || closed || (readGate && !readGate.verified) ? { uri: "", headers: {} } : assetSource(base, headers, id),
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
      if (readGate) return { ok: false, why: readOnlyRefusal() };
      if (storeRefusal || closed) return { ok: false, why: storeRefusal ?? ended() };
      if (refreshing) await refreshing;
      if (storeRefusal || closed) return { ok: false, why: storeRefusal ?? ended() };
      const bearer = headers.authorization?.slice("Bearer ".length);
      if (!credentials || !bearer) return { ok: false, why: auth() };
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
      const draining = delivery?.stop(true);
      // Stop ordinary work synchronously; only delivery's own signals receive
      // the bounded grace period. endCredentials/close must not abort them.
      delivery = undefined;
      const bearer = !readGate || readGate.verified ? headers.authorization?.slice("Bearer ".length) : undefined;
      endCredentials();
      // refreshCurrent owns revocation of any late, unkept successor.
      // Close immediately so outstanding work cannot reuse the credentials.
      const closing = client.close();
      if (bearer) void logout(base, bearer, readGate ? transport : doFetch);
      await Promise.all([closing, draining]);
    },
    close() {
      readWork.clear();
      cancelReadyNotification(); readyNotifications.clear();
      if (closing) return closing;
      closed = true;
      intentPresentation?.clear();
      void delivery?.stop();
      closeWatchAnswers(watches, storeRefusal ?? ended())();
      pendingEvents.notify(); pendingEvents.clear();
      stopClock();
      closingResponses.begin();
      stopRefresh(ended());
      aborter.abort();
      if (retry) clearTimeout(retry);
      if (refreshTimer) clearTimeout(refreshTimer);
      watches.clear();
      linkListeners.clear();
      viewerListeners.clear();
      for (const entry of pending) {
        // The request already dispatched may have committed. Its send owns
        // settlement; cancellation without a receipt leaves the id pending.
        if (entry === sending) continue;
        const outcome = { state: "pending", id: entry.id } as const;
        entry.resolve(outcome);
        history?.remember(outcome);
      }
      writeListeners.clear();
      closing = Promise.allSettled([flushing, ...requests]).then(() => { pending.length = 0; sessionListeners.clear(); closingResponses.finish(); });
      return closing;
    },
  };
  bindFollowing(client, async (op, args, body, signal) => {
    const revision = credentialRevision, epoch = queryEpoch;
    const blocked = () => closed || !credentials || !!storeRefusal || !!changesRefusal || link !== "online" || !!refreshing || pending.length > 0;
    if (blocked()) return;
    const result = await post(`/following/${op.name}`, { ...body, args }, undefined, undefined, false, signal);
    if (blocked() || revision !== credentialRevision || epoch !== queryEpoch || !result.ok) return;
    // Parsed HTTP refusals, including E_READ_ONLY for a raw read token, have
    // ok:true and flow to the controller's refused state without polling.
    return { ...result.json, __followingCurrent: () => !blocked() && revision === credentialRevision && epoch === queryEpoch };
  }, () => closed || !credentials || !!storeRefusal || link !== "online" || pending.length > 0);
  trackDispatch(client, dispatch);
  readWork.bind(client, watches);
  bindWatchPeek(client, watches, () => storeRefusal ?? (closed ? ended() : !credentials ? auth() : null));
  const start = async () => {
    if (closed) return;
    if (readGate) { scheduleRefresh(); await readGate.verify(); return; }
    if (session && !isReadToken(session.token) && session.kind !== "action" && session.expiresAt - clock.issuedDeviceNow() <= refreshBeforeExpiry) void refreshCurrent();
    else scheduleRefresh();
  };
  if (readGate) registerReadVerification(client, () => readGate.verify());
  trackRotation(client, () => refreshing);
  trackClose(client, closingResponses);
  if (!deferStart(options, start)) start();
  if (intentPresentation) registerPendingIntents(client, { scope: intentScope, revision: () => `${credentialRevision}:${intentEpoch}`, retain: intentPresentation.retain, read: async () => {
    const scope = intentScope(), epoch = intentEpoch, revision = credentialRevision, pending = await client.pendingWrites();
    return scope != null && scope === intentScope() && epoch === intentEpoch && revision === credentialRevision ? intentPresentation.sync(pending) : [];
  } });
  if (intentPresentation) registerIntentObserver(client, ids => intentPresentation.observed(ids));
  bindSessionRefusal(client, () => authRefusal);
  return client;
}
