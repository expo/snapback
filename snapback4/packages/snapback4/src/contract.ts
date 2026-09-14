// The index card (LLP 3000 §2; LLP 2000.000 §8). These are the only words a
// screen may need. The mechanism is built to fit them; a screen that needs a
// word not here is a defect in the mechanism, not a gap in the card.

/** An opaque page position minted by whoever evaluated the page. Pass it back unchanged. */
export type Cursor = string & { readonly __cursor: "Cursor" };
/** The authenticated subject a rule sees as `viewer`. */
export type Principal = string & { readonly __principal: "Principal" };

/** Why something was refused. `family` and `code` are stable; `rewrite` compiles. */
export interface Refusal {
  readonly code: string;
  readonly family: string;
  readonly message: string;
  readonly site?: string;
  readonly rewrite?: string;
  readonly guide?: string;
  readonly rule?: string;
  readonly retryable?: boolean;
}

/**
 * A read. `complete` is false beyond a sync horizon or at an online-only site.
 * `fresh` is transport truth: the value reflects the server now. When it does
 * not, `since` is the wall-clock time (ms) of the newest server state it does
 * reflect, so a screen can say "as of three minutes ago".
 */
export type Read<T> =
  | { readonly data: T; readonly complete: boolean; readonly fresh: boolean; readonly since?: number; readonly next?: Cursor | null }
  | { readonly loading: true }
  | { readonly denied: Refusal };

/** A row this device changed and the server has not yet confirmed carries `pending: true`. */
export interface Pending {
  readonly pending?: boolean;
}

/** A write. `sent.result` is the server answer; pending rows show predictions.
 * `id` is client-minted and stable across replay. */
// @ref LLP 3000.007#8 — only sent carries a mutation result
export type Write<R = unknown> =
  | { readonly state: "pending"; readonly id: string }
  | { readonly state: "sent"; readonly id: string; readonly seq: number; readonly result: R }
  | { readonly state: "failed"; readonly id: string; readonly why: Refusal };

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

/** The app's relationship to its server. */
export type Link = "online" | "offline" | "signed-out";

/** A named operation. `Args` and `Result` are inferred from the authored program. */
export interface Op<Args, Result> {
  readonly runs?: "device" | "server";
  readonly predicts?: "eligible" | "never";
  readonly kind: "query" | "mutation" | "action";
  readonly name: string;
  readonly __args?: Args;
  readonly __result?: Result;
}
export type Query<Args, Result> = Op<Args, Result> & { readonly kind: "query" };
export type Mutation<Args, Result> = Op<Args, Result> & { readonly kind: "mutation" };
export type Action<Args, Result = unknown> = Op<Args, Result> & { readonly kind: "action" };
export type ArgsOf<O> = O extends Op<infer A, unknown> ? A : never;
export type ResultOf<O> = O extends Op<unknown, infer R> ? R : never;

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
export interface Client {
  query<A, R>(op: Query<A, R>, args: A): Promise<Read<R>>;
  observe<A, R>(op: Query<A, R>, args: A): Observed<R>;
  mutate<A, R>(op: Mutation<A, R>, args: A): Promise<Write<R>>;
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
  viewer(): Principal | null;
  onViewer(notify: (viewer: Principal | null) => void): () => void;
  onWrite(notify: (write: Exclude<Write, { state: "pending" }>) => void): () => void;
  close(): Promise<void>;
}

export function isReady<T>(read: Read<T>): read is { readonly data: T; readonly complete: boolean; readonly fresh: boolean; readonly since?: number; readonly next?: Cursor | null } {
  return "data" in read;
}
export function isLoading<T>(read: Read<T>): read is { readonly loading: true } {
  return "loading" in read;
}
export function isDenied<T>(read: Read<T>): read is { readonly denied: Refusal } {
  return "denied" in read;
}
