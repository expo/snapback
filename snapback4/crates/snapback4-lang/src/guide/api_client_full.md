# API client: exact signature digest

Import from "snapback4/client". Generated from dist declarations; types named below retain their declaration meaning.
observe returns getSnapshot/subscribe/close; query returns Read, mutate returns Write; asset returns a URL handle or denied. Upload each image column separately. sentResult is from snapback4/react or contract.

```ts
export function mintId(now?: number): string;
export function idFrom(key: string): string;
export function createClient(options: ClientOptions): Client;
export interface DeliveryRefused extends DeliveryBinding { group: string; from: number; through: number; why: Refusal; }
export function settleMutation<A, R>(client: Client, op: Mutation<A, R>, args: A, options?: MutateOptions): Promise<Write<R>>;
export function saveAsset(client: Pick<Client, "asset">, id: string, name?: string): Promise<Saved>;
export type Saved = { readonly ok: true; readonly name: string; } | { readonly ok: false; readonly why: Refusal; };
export interface Client extends UploadCapabilities { readonly release?: import("./release.ts").ReleaseSource; readonly readOnly?: boolean; residency(): Promise<Residency | null>; now(): number; query<A, R>(op: Query<A, R>, args: A): Promise<SettledRead<R>>; observe<A, R>(op: Query<A, R>, args: A, options?: ObserveOptions): Observed<R>; mutate<A, R>(op: Ephemeral<A, R>, args: A): Promise<Signal<R>>; mutate<A, R>(op: Mutation<A, R>, args: A, options?: MutateOptions): MutationPromise<R>; write(id: string): Promise<Write | undefined>; pendingWrites(): Promise<readonly PendingWrite[]>; onPendingWrites(notify: () => void): () => void; act<A, R>(op: Action<A, R>, args: A, options?: ActOptions): Promise<Act<R>>; upload(bytes: Blob | ArrayBuffer | Uint8Array, options?: UploadOptions): Promise<Uploaded>; asset(id: string): Promise<AssetRead>; assetSource(id: string): { uri: string; headers: Record<string, string>; }; link(): Link; onLink(notify: (link: Link) => void): () => void; readonly acquired: boolean; onAcquired(notify: (acquired: boolean) => void): () => void; viewer(): Principal | null; onViewer(notify: (viewer: Principal | null) => void): () => void; onWrite(notify: (write: Exclude<Write, { state: "pending"; }>) => void): () => void; session(): Session | null; onSession(notify: (session: Session | null) => void): () => void; refreshSession(): Promise<SignIn>; logoutAll(): Promise<SessionRevocation>; signOut(): Promise<void>; close(): Promise<void>; }
export type Principal = string & { readonly __principal: "Principal"; };
export interface Session { readonly principal: string; readonly kind: string; readonly token: string; readonly expiresAt: number; readonly scope?: "full" | "read"; readonly capExpiresAt?: number; }
export interface Refusal { readonly code: string; readonly family: string; readonly message: string; readonly detail?: string; readonly site?: string; readonly rewrite?: string; readonly guide?: string; readonly rule?: string; readonly retryable?: boolean; readonly retryAfterMs?: number; }
export type Read<T> = Ready<T> | { readonly loading: true; } | { readonly denied: Refusal; };
export type Ready<T> = Present<T> | Partial<T> | Absent<T>;
export type SettledRead<T> = Exclude<Read<T>, { readonly loading: true; }>;
export type Write<R = unknown> = { readonly state: "pending"; readonly id: string; readonly reason?: string; } | { readonly state: "sent"; readonly id: string; readonly seq: number; readonly replayed?: false; readonly result: R; } | { readonly state: "sent"; readonly id: string; readonly seq: number; readonly replayed: true; readonly result?: never; } | { readonly state: "failed"; readonly id: string; readonly why: Refusal; };
export type Signal<R = unknown> = { readonly state: "sent"; readonly id: string; readonly result: R; } | { readonly state: "failed"; readonly id: string; readonly why: Refusal; };
export type Act<R = unknown> = { readonly state: "done"; readonly id: string; readonly result: R; } | { readonly state: "failed"; readonly id: string; readonly why: Refusal; } | { readonly state: "pending"; readonly id: string; } | { readonly denied: Refusal; readonly id: string; };
export type Outcome<R = unknown> = Write<R> | Signal<R> | Act<R>;
export interface ActOptions { readonly id?: string; readonly waitSeconds?: number; }
export interface MutateOptions { readonly id?: string; readonly waitSeconds?: number; }
export type MutationPromise<R = unknown> = Promise<Write<R>> & { readonly state?: "failed"; readonly id?: string; readonly why?: Refusal; };
export interface PendingWrite<A = unknown> { readonly id: string; readonly op: string; readonly args: A; readonly state: "queued" | "sent" | "held"; readonly reason?: string; readonly predicted: readonly string[]; }
export type Link = "online" | "offline" | "signed-out";
export type Query<Args, Result> = Op<Args, Result> & { readonly kind: "query"; readonly ephemeralReads?: readonly string[]; readonly rowKey?: "id"; };
export type Mutation<Args, Result> = Op<Args, Result> & { readonly kind: "mutation"; readonly ephemeral?: false; };
export type Ephemeral<Args, Result> = Op<Args, Result> & { readonly kind: "mutation"; readonly ephemeral: true; readonly renews?: true; readonly renewMs: number; };
export type Action<Args, Result = unknown> = Op<Args, Result> & { readonly kind: "action"; };
export type ArgsOf<O> = O extends Op<infer A, unknown> ? A : never;
export type ResultOf<O> = O extends Op<unknown, infer R> ? R : never;
export type RowOf<O> = NonNullable<ResultOf<O>> extends readonly (infer E)[] ? E : NonNullable<ResultOf<O>>;
export interface Observed<T> { getSnapshot(): Read<T>; subscribe(notify: () => void): () => void; close(): void; }
export interface ObserveOptions { readonly keep?: boolean; }
export type Cursor = string & { readonly __cursor: "Cursor"; };
export interface ClientOptions { readonly readOnly?: boolean; readonly onDeliveryRefused?: (event: import("./delivery-state.ts").DeliveryRefused) => void; readonly url: string; readonly persona?: string; readonly session?: Session | { readonly token: string; readonly principal?: string; readonly kind?: string; readonly expiresAt?: number | string; }; readonly token?: string; readonly meter?: boolean; readonly fetch?: typeof fetch; readonly waitSeconds?: number; readonly onStoreChange?: (why: Refusal) => void; }
```
