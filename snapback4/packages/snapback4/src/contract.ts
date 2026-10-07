// The index card (LLP 3000 §2; LLP 2000.000 §8). These are the only words a
// screen may need. The mechanism is built to fit them; a screen that needs a
// word not here is a defect in the mechanism, not a gap in the card.

export interface Session {
  readonly principal: string;
  /** `guest` or `user` for built-in identity; an application-defined kind
   * for a session minted by its service. */
  readonly kind: string;
  readonly token: string;
  readonly expiresAt: number;
  /** Absent on legacy persisted sessions; authority always comes from the server. */
  readonly scope?: "full" | "read";
  readonly capExpiresAt?: number;
}

export type SignIn = { readonly ok: true; readonly session: Session } | { readonly ok: false; readonly why: Refusal };
export type SessionRevocation = { readonly ok: true; readonly revoked: number } | { readonly ok: false; readonly why: Refusal };

/** An opaque page position minted by whoever evaluated the page. Pass it back unchanged. */
export type Cursor = string & { readonly __cursor: "Cursor" };
/** The authenticated subject a rule sees as `viewer`. */
export type Principal = string & { readonly __principal: "Principal" };

/** Why something was refused. `family` and `code` are stable; `rewrite` compiles. */
export interface Refusal {
  readonly code: string;
  readonly family: string;
  readonly message: string;
  /** Original constraint text for development; render message to the user. */
  readonly detail?: string;
  readonly site?: string;
  readonly rewrite?: string;
  readonly guide?: string;
  readonly rule?: string;
  readonly retryable?: boolean;
}

export type ReadCut = "meter" | "words" | null;

/**
 * A read. `complete` is false beyond a sync horizon or at an online-only site.
 * `cut` names a disclosed meter or word-limit cut. Non-uniform server reads
 * withhold it: null means "not disclosed here", not "not cut".
 * An empty meter-cut page is partial: retry narrower, or continue if `next` exists.
 * `fresh` is transport truth: the value reflects the server now, as far as the
 * change feed can tell. When it does not, `since` is the wall-clock time (ms) of
 * the newest server state it does reflect, so a screen can say "as of three minutes ago".
 * Observations discard responses older than observed commits in the same store and
 * permanently refuse on store replacement or regression.
 * `connected[p]` is the exception. No commit announces that `connected[p]` changed, so an answer of a query that
 * may read it is a sample: it keeps the `fresh` it arrived with (true for a server's whole answer, false when
 * a local answer composes retained rows) until a newer answer replaces it. A background re-read about
 * 5 seconds after each reply settles does that while refreshes succeed; failed refreshes or a suspended
 * client leave the sample on screen, with the same flag, and no bound on its age.
 * A mounted same-key observation retains its answer during plain revalidation,
 * marked `revalidating: true`, until replacement, with no timeout. Transport
 * failure marks `fresh: false`; retry exhaustion also keeps the answer. Local
 * commits, durable/ephemeral change evidence and /sync publications start one
 * non-renewable second at the replacement attempt; capacity queue wait pauses
 * this budget. Online change
 * evidence can be revocation, so its second starts on receipt and includes queue
 * wait. Failure or timeout withdraws; a later accepted answer can still publish.
 * Applied local scope loss withdraws dependent audience groups immediately,
 * including staged removals; older replica answers wait for publication.
 * `keep: false` withdraws immediately; `keep: true` adds a 30 s subscriber-free
 * linger. Gate actions on `isReady(read) && !read.revalidating` when they
 * require a completed re-read.
 * Every option withdraws on expiry, a refusal, a viewer or credential change,
 * store reset, adoption or close. Retention never grants authority.
 * @ref LLP 3000.023#10 — all change evidence bounds retention.
 * Before the first answer use `loading`; a refusal carries its message in `denied`.
 */
// @ref LLP 3000.031#1.1 — existence describes the disclosed value, never hidden rows.
export interface ReadyMetadata {
  readonly complete: boolean;
  readonly cut: ReadCut;
  readonly fresh: boolean;
  readonly revalidating?: true;
  readonly since?: number;
  readonly next?: Cursor | null;
  readonly meter?: ReadMeter;
}
// @ref LLP 3000.031#3 — named arms preserve generic covariance.
// Every arm retains T; absent additionally proves null or an empty array.
interface Present<out T> extends ReadyMetadata {
  readonly existence: "present";
  readonly data: T & ({} | undefined);
}
interface Partial<out T> extends ReadyMetadata {
  readonly existence: "partial";
  readonly data: T;
}
interface Absent<out T> extends ReadyMetadata {
  readonly existence: "absent";
  readonly data: T & (null | []);
  readonly complete: true;
  readonly cut: null;
}
export type Ready<T> = Present<T> | Partial<T> | Absent<T>;
export type Read<T> =
  | Ready<T>
  | { readonly loading: true }
  | { readonly denied: Refusal };
/** A one-shot's final answer; ready can still be partial or stale. */
export type SettledRead<T> = Exclude<Read<T>, { readonly loading: true }>;

/** Engine work for this server answer under dev; never returned by serve. */
export interface ReadMeter {
  /** Precise reason, including non-uniform work that public `Read.cut` withholds. */
  readonly cut: ReadCut;
  readonly examined: number;
  readonly indexEntries: number;
  readonly probes: number;
  readonly steps: number;
  readonly heapBytes: number;
  readonly outputBytes: number;
  readonly rowsWritten: number;
}

/** A row this device changed and the server has not yet confirmed carries `pending: true`. */
export interface Pending {
  readonly pending?: boolean;
}

/** A write. Fresh `sent` carries the server answer, including null. A replay
 * confirms execution identity only: `replayed: true` has no historical result.
 * Pending rows show predictions; `id` is caller-supplied or client-minted and stable across replay. */
// @ref LLP 3000.007#17 — replay confirms execution without historical read authority
export type Write<R = unknown> =
  | { readonly state: "pending"; readonly id: string; readonly reason?: string }
  | { readonly state: "sent"; readonly id: string; readonly seq: number; readonly replayed?: false; readonly result: R }
  | { readonly state: "sent"; readonly id: string; readonly seq: number; readonly replayed: true; readonly result?: never }
  | { readonly state: "failed"; readonly id: string; readonly why: Refusal };

/** An admitted intent, oldest first. `sent` here means dispatch began and the
 * outcome is unknown; only Write.sent is a receipt. Held reasons are refusal
 * codes; predictions name rows as `table/id`, never row contents. */
// @ref LLP 3000.019#3.3 — an outbox list also represents writes without predicted rows.
export interface PendingWrite<A = unknown> {
  readonly id: string;
  readonly op: string;
  readonly args: A;
  readonly state: "queued" | "sent" | "held";
  readonly reason?: string;
  readonly predicted: readonly string[];
}

/** An action's server outcome. A denial precedes admission; a pending id
 * may already be running. Retry with that same id, never predict or queue
 * an action on the device. This new card word needs the author's ruling. */
// @ref LLP 3000.007#9.2 — request/response worker results have no predicted state.
export type Act<R = unknown> =
  | { readonly state: "done"; readonly id: string; readonly result: R }
  | { readonly state: "failed"; readonly id: string; readonly why: Refusal }
  | { readonly state: "pending"; readonly id: string }
  | { readonly denied: Refusal; readonly id: string };

export interface ActOptions {
  /** Reuse a previous pending/uncertain id to collect its recorded result. */
  readonly id?: string;
  /** Wait up to 25 seconds; 0 only admits or collects the request. */
  readonly waitSeconds?: number;
}

export interface MutateOptions {
  /** A 26-digit uppercase Crockford base32 id, first digit 0–7, as minted by
   * mintId(). Store it with the intent/fixture and reuse it for retries; this
   * is not a row id. For a fixture label, `idFrom(label)` gives the same id
   * every time.
   * Retries return the pending Write or a receipt without historical results.
   * Conflicting input is refused while this client or its outbox knows it;
   * otherwise a retained receipt or the server's original outcome wins. */
  readonly id?: string;
  /** Seconds to wait for the server's outcome once this client has custody of
   * the write: floored and clamped to 0–25 like `ActOptions`. Omitted keeps each
   * tier's default: a device waits up to 4 s while online; an online client
   * waits for its request. `0` returns at custody — `pending` with the write's
   * id — or with the refusal that prevented custody, so a composer can clear its
   * draft and take the next send. Custody is the device outbox, `createApp`'s
   * online intent journal, or the online client's memory queue. Settlement still
   * reaches `onWrite`, `client.write(id)` and a hook's `last`.
   * Before store identification the promise waits up to 15 seconds without
   * custody, even at zero. Reload loses that call; timeout is E_ADMISSION_TIMEOUT. */
  // @ref LLP 3000.008.002.000#3-submit-once-then-let-the-user-continue — admission is its own boundary, before settlement.
  readonly waitSeconds?: number;
}

/** The app's relationship to its server. While polling on a running host,
 * link loss is reported within 5 s: 2 s heartbeats, 4 s silence timeout.
 * Native fetch without streams uses polls of at most 2 s. Browser events
 * are immediate hints; authenticated /probe confirms recovery. Suspended
 * hosts deliver notifications when resumed. */
export type Link = "online" | "offline" | "signed-out";

/** A named operation. `Args` and `Result` are inferred from the authored program. */
export interface Op<Args, Result> {
  readonly held?: boolean;
  readonly runs?: "device" | "server";
  readonly predicts?: "eligible" | "never";
  readonly kind: "query" | "mutation" | "action";
  readonly name: string;
  readonly __args?: Args;
  readonly __result?: Result;
}
/** rowKey is emitted only for pages of source rows; projected `id` fields are not identity. */
export type Query<Args, Result> = Op<Args, Result> & { readonly kind: "query"; readonly ephemeralReads?: readonly string[]; readonly rowKey?: "id" };
/** Generated from a canonical Following view and its one-to-one card projection. */
export type FollowingQuery<Args, Result> = Query<Args, Result> & { readonly following: { readonly declaration: string; readonly pageSize: number; readonly cursor: string | null } };
// @ref LLP 3000.017#24-the-client — disjoint mutations keep durable custody out of the ephemeral lane.
export type Mutation<Args, Result> = Op<Args, Result> & { readonly kind: "mutation"; readonly ephemeral?: false };
export type Ephemeral<Args, Result> = Op<Args, Result> & {
  readonly kind: "mutation";
  readonly ephemeral: true;
  readonly renews?: true;
  /** One quarter of the shortest declared table life, in milliseconds. */
  readonly renewMs: number;
};
/** An online-only signal has no durable sequence, pending state or replay. */
export type Signal<R = unknown> =
  | { readonly state: "sent"; readonly id: string; readonly result: R }
  | { readonly state: "failed"; readonly id: string; readonly why: Refusal };
export type Action<Args, Result = unknown> = Op<Args, Result> & { readonly kind: "action" };
export type ArgsOf<O> = O extends Op<infer A, unknown> ? A : never;
export type ResultOf<O> = O extends Op<unknown, infer R> ? R : never;

/** Omitted and true: retain during plain revalidation without a timeout, marked
 * revalidating. Change evidence bounds both by one non-renewable second;
 * local capacity wait pauses it, online evidence includes queue wait.
 * False: withdraw immediately. True also lingers 30 s after unmount.
 * Failed bounded re-reads, expiry, refusals and resets withdraw for every policy.
 * @ref LLP 3000.023#3.2 — each policy owns a separate live watch. */
export interface ObserveOptions { readonly keep?: boolean }

/** A live read: the current value and a way to hear it change. */
export interface Observed<T> {
  getSnapshot(): Read<T>;
  subscribe(notify: () => void): () => void;
  close(): void;
}

/** An upload the server recorded: the facts it established, and the id a
 * row's `image`/`video` column takes (`{ id }` is enough; the server fills
 * the rest on the row). */
export interface Asset {
  readonly id: string;
  readonly type: string;
  readonly bytes: number;
  /** Present for images, null for video. */
  readonly width: number | null;
  readonly height: number | null;
  /** Milliseconds, for video; null for images. */
  readonly duration: number | null;
}

export type Uploaded = { readonly ok: true; readonly asset: Asset } | { readonly ok: false; readonly why: Refusal };

/** The bytes of an asset, fetched under the viewer's credentials: a blob
 * URL to put in `src`, and `revoke()` when the screen is done with it. A
 * one-view photo comes back `denied` with `E_ASSET_VIEWED` the second time. */
export type AssetRead =
  | { readonly url: string; readonly type: string; readonly bytes: number; readonly revoke: () => void }
  | { readonly denied: Refusal };

/** The whole client, as a screen sees it. Everything else is `why`. */
/** Existing callers await the write. A web admission refusal is also available
 * in the calling stack, before any storage or network wait. Absence of these
 * fields is not a server acknowledgement; await the ordinary Write outcome. */
export type MutationPromise<R = unknown> = Promise<Write<R>> & {
  readonly state?: "failed";
  readonly id?: string;
  readonly why?: Refusal;
};

/** Physical local rows, including predictions and retained/expired images still
 * stored. Counts confer no query authority. Media caches are separate. */
export interface Residency {
  /** UTF-8 stored row payload bytes, excluding keys and indexes. */
  readonly tables: Readonly<Record<string, { readonly rows: number; readonly bytes: number }>>;
  readonly totalBytes: number;
  /** SQLite allocated pages (including free pages; excluding WAL/SHM files),
   * or UTF-8 logical persistence record keys + values (before IDB packing).
   * Neither is RSS or an estimate of IndexedDB's physical disk allocation. */
  readonly totalBytesKind: "sqlite-pages" | "logical";
  /** Allocated wasm linear memory shared by this realm's devices, not live heap. */
  readonly wasmHeapBytes?: number;
}

export interface Client {
  readonly readOnly?: boolean;
  /** Local storage diagnostics; null on the online tier or mock. Rejects with
   * a coded error on a closed/signed-out local client or a failed device read. */
  residency(): Promise<Residency | null>;
  /** Estimated server Unix milliseconds; never goes backward on this device. */
  now(): number;
  /** Ready or refused within four rounds / 30 seconds, including queue and authority waits. */
  query<A, R>(op: Query<A, R>, args: A): Promise<SettledRead<R>>;
  observe<A, R>(op: Query<A, R>, args: A, options?: ObserveOptions): Observed<R>;
  /** Retry-safe intents: pass { id } to reuse the original write. A client
   * never admits a known id twice; an evicted receipt requires reopening. */
  mutate<A, R>(op: Ephemeral<A, R>, args: A): Promise<Signal<R>>;
  mutate<A, R>(op: Mutation<A, R>, args: A, options?: MutateOptions): MutationPromise<R>;
  /** Recover a write by mutation id. Unknown ids return undefined. Local
   * clients keep terminal receipts with their store, without historical results. */
  write(id: string): Promise<Write | undefined>;
  /** Current admitted, unsettled writes. Local/createApp queues survive reopen;
   * the raw online queue lasts only for that client. Closed/signed-out: []. */
  pendingWrites(): Promise<readonly PendingWrite[]>;
  /** Invalidate the pending-write list; read pendingWrites() again. */
  onPendingWrites(notify: () => void): () => void;
  act<A, R>(op: Action<A, R>, args: A, options?: ActOptions): Promise<Act<R>>;
  /** Send the bytes of a photo or video; place `asset.id` in a mutation's
   * `image`/`video` argument. Online only: an upload waits for no link. */
  upload(bytes: Blob | ArrayBuffer | Uint8Array): Promise<Uploaded>;
  /** The bytes of an asset a row the viewer may read holds, as a blob URL. */
  asset(id: string): Promise<AssetRead>;
  /** Where the bytes are and the headers that fetch them, for native image
   * and video views that take a URI with headers. */
  assetSource(id: string): { uri: string; headers: Record<string, string> };
  link(): Link;
  onLink(notify: (link: Link) => void): () => void;
  /** Snapshot and catch-up have finished for this store. Stays true offline;
   * reset invalidates it. The online tier has no partition and returns false. */
  readonly acquired: boolean;
  onAcquired(notify: (acquired: boolean) => void): () => void;
  viewer(): Principal | null;
  onViewer(notify: (viewer: Principal | null) => void): () => void;
  onWrite(notify: (write: Exclude<Write, { state: "pending" }>) => void): () => void;
  /** The current bearer session; null for personas and bare tokens until refreshed. */
  session(): Session | null;
  onSession(notify: (session: Session | null) => void): () => void;
  /** Rotate the bearer and adopt the replacement before notifying listeners. */
  refreshSession(): Promise<SignIn>;
  /** Revoke every session for this principal and close after confirmation. */
  logoutAll(): Promise<SessionRevocation>;
  /** Clear local credentials and close; remote session revocation is best effort. */
  signOut(): Promise<void>;
  /** Finish local cleanup without waiting on held network responses. Known write/action
   * outcomes survive; unreceived outcomes return pending with their original id. */
  close(): Promise<void>;
}

export function isReady<T>(read: Read<T>): read is Extract<Read<T>, { data: T }> {
  return "data" in read;
}
export function isLoading<T>(read: Read<T>): read is { readonly loading: true } {
  return "loading" in read;
}
export function isDenied<T>(read: Read<T>): read is { readonly denied: Refusal } {
  return "denied" in read;
}

/** The five UI meanings; narrow on read.existence after isReady for typed data. */
export function existence<T>(read: SettledRead<T>): "denied" | "present" | "absent" | "partial";
export function existence<T>(read: Read<T>): "loading" | "denied" | "present" | "absent" | "partial";
export function existence<T>(read: Read<T>): "loading" | "denied" | "present" | "absent" | "partial" {
  return "loading" in read ? "loading" : "denied" in read ? "denied" : read.existence;
}

/** Exhaustive handlers for the same five meanings on point and page reads. */
export interface ReadMatchHandlers<T, R = unknown> {
  loading: (read: Extract<Read<T>, { loading: true }>) => R;
  denied: (why: Refusal, read: Extract<Read<T>, { denied: Refusal }>) => R;
  absent: (read: Absent<T>) => R;
  partial: (data: T, read: Partial<T>) => R;
  present: (data: Present<T>["data"], read: Present<T>) => R;
}

/** `otherwise` covers omitted loading/absent/present handlers only.
 * Denial and uncertain emptiness always require an explicit decision. */
export type ReadMatchFallbackHandlers<T, R = unknown> =
  Pick<ReadMatchHandlers<T, R>, "denied" | "partial"> & {
    [K in "loading" | "absent" | "present"]?: ReadMatchHandlers<T, R>[K];
  } & { otherwise: (read: Extract<Read<T>, { loading: true }> | Absent<T> | Present<T>) => R };

/** Render the current read, preserving its narrowed data and metadata.
 * Pure dispatch: no reclassification, subscription, retention or permission.
 * For pages pass page.read; present pages may still be incomplete.
 * @ref LLP 3000.031#8 — explicit denied/partial decisions even with a fallback.
 */
export function matchRead<T, H extends ReadMatchHandlers<NoInfer<T>> | ReadMatchFallbackHandlers<NoInfer<T>>>(
  read: Read<T>, handlers: H,
): ReturnType<Extract<H[keyof H], (...args: never[]) => unknown>>;
export function matchRead<T, R>(read: Read<T>, handlers: (ReadMatchHandlers<T, R> & { otherwise?: never }) | ReadMatchFallbackHandlers<T, R>): R {
  if ("loading" in read) return handlers.loading ? handlers.loading(read) : handlers.otherwise!(read);
  if ("denied" in read) return handlers.denied(read.denied, read);
  switch (read.existence) {
    case "absent": return handlers.absent ? handlers.absent(read) : handlers.otherwise!(read);
    case "partial": return handlers.partial(read.data, read);
    case "present": return handlers.present ? handlers.present(read.data, read) : handlers.otherwise!(read);
  }
}

/** Display metadata only; never an authorization or mutation-admission decision. */
export interface ReadPresentation {
  readonly existence: ReturnType<typeof existence>;
  /** Waiting for a readable answer (`loading`), not a count or claim of pending writes. */
  readonly pending: boolean;
  /** True exactly when ready and (existence === "partial" || !complete || cut !== null || next != null), including nonempty data. */
  readonly incomplete: boolean;
  /** A ready answer with fresh === false; independent of revalidation. */
  readonly stale: boolean;
  readonly revalidating: boolean;
  /** The current denied arm's refusal, unchanged; render its message. */
  readonly why?: Refusal;
  /** The ready arm's server-state timestamp in milliseconds, unchanged (including zero). */
  readonly since?: number;
}

/**
 * Derive notice flags from this read alone. Owns no subscription, timer or saved result.
 * `existence` is copied through the existing classifier, including its pending-write
 * predicate. `incomplete` also covers nonempty pages with incomplete coverage, a
 * disclosed cut or a continuation. Use page.read, never page.items, for this input.
 * Loading and denied have no ready metadata: all flags except loading's `pending`
 * are false, and `since` is absent. Stale absence is still absence at the acquired
 * watermark; revalidation is a separate fact. These flags do not authorize actions
 * or narrow read.data; use matchRead for typed rendering, or isReady/read.existence.
 * @ref LLP 3000.031#7 — a pure presentation adapter over the existing read contract.
 */
export function readPresentation<T>(read: Read<T>): ReadPresentation {
  const state = existence(read);
  return {
    existence: state,
    pending: state === "loading",
    incomplete: isReady(read) && (state === "partial" || !read.complete || read.cut !== null || read.next != null),
    stale: isReady(read) && !read.fresh,
    revalidating: isReady(read) && read.revalidating === true,
    ...("denied" in read ? { why: read.denied } : {}),
    ...(isReady(read) && read.since !== undefined ? { since: read.since } : {}),
  };
}

/** Generated receipt-family binding; history and decorations keep independent authority. */
export type { ReceiptFamily } from "./receipt-family.ts";
