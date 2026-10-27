# API client: exact signature digest

Import from "snapback4/client". Generated from dist declarations; types named below retain their declaration meaning.
observe returns getSnapshot/subscribe/close; query returns Read, mutate returns Write; asset returns a URL handle or denied. Upload each image column separately. sentResult is from snapback4/react or contract.

```ts
export function createClient(options: ClientOptions): Client;
export interface ClientOptions { readonly readOnly?: boolean; readonly onDeliveryRefused?: (event: import("./delivery-state.ts").DeliveryRefused) => void; readonly url: string; readonly persona?: string; readonly session?: Session | { readonly token: string; readonly principal?: string; readonly kind?: string; readonly expiresAt?: number | string; }; readonly token?: string; readonly meter?: boolean; readonly fetch?: typeof fetch; readonly waitSeconds?: number; readonly onStoreChange?: (why: Refusal) => void; }
export interface Client { query<A, R>(op: Query<A, R>, args: A): Promise<SettledRead<R>>; observe<A, R>(op: Query<A, R>, args: A, options?: ObserveOptions): Observed<R>; mutate<A, R>(op: Ephemeral<A, R>, args: A): Promise<Signal<R>>; mutate<A, R>(op: Mutation<A, R>, args: A, options?: MutateOptions): MutationPromise<R>; upload(bytes: Blob | ArrayBuffer | Uint8Array, options?: UploadOptions): Promise<Uploaded>; asset(id: string): Promise<AssetRead>; close(): Promise<void>; /* other methods: dist/contract.d.ts */ }
export interface Observed<T> { getSnapshot(): Read<T>; subscribe(notify: () => void): () => void; close(): void; }
export interface ObserveOptions { readonly keep?: boolean; }
export type Read<T> = Ready<T> | { readonly loading: true; } | { readonly denied: Refusal; };
export type Write<R = unknown> = { readonly state: "pending"; readonly id: string; readonly reason?: string; } | { readonly state: "sent"; readonly id: string; readonly seq: number; readonly replayed?: false; readonly result: R; } | { readonly state: "sent"; readonly id: string; readonly seq: number; readonly replayed: true; readonly result?: never; } | { readonly state: "failed"; readonly id: string; readonly why: Refusal; };
export type Signal<R = unknown> = { readonly state: "sent"; readonly id: string; readonly result: R; } | { readonly state: "failed"; readonly id: string; readonly why: Refusal; };
export type Cursor = string & { readonly __cursor: "Cursor"; };
// AssetRead: import type from snapback4/contract
export type AssetRead = { readonly url: string; readonly type: string; readonly bytes: number; readonly revoke: () => void; readonly name?: string; } | { readonly denied: Refusal; };
// Uploaded: import type from snapback4/contract
export type Uploaded = { readonly ok: true; readonly asset: Asset; } | { readonly ok: false; readonly why: Refusal; };
export function settleMutation<A, R>(client: Client, op: Mutation<A, R>, args: A, options?: MutateOptions): Promise<Write<R>>;
export interface Session { readonly principal: string; readonly kind: string; readonly token: string; readonly expiresAt: number; readonly scope?: "full" | "read"; readonly capExpiresAt?: number; }
// SignIn: import type from snapback4/contract
export type SignIn = { readonly ok: true; readonly session: Session; } | { readonly ok: false; readonly why: Refusal; };
export type Query<Args, Result> = Op<Args, Result> & { readonly kind: "query"; readonly ephemeralReads?: readonly string[]; readonly rowKey?: "id"; };
export type Mutation<Args, Result> = Op<Args, Result> & { readonly kind: "mutation"; readonly ephemeral?: false; };
export interface MutateOptions { readonly id?: string; readonly waitSeconds?: number; }
export function mintId(now?: number): string;
export function idFrom(key: string): string;
export type Ready<T> = Present<T> | Partial<T> | Absent<T>;
export type SettledRead<T> = Exclude<Read<T>, { readonly loading: true; }>;
export interface Refusal { readonly code: string; readonly family: string; readonly message: string; readonly detail?: string; readonly site?: string; readonly rewrite?: string; readonly guide?: string; readonly rule?: string; readonly retryable?: boolean; readonly retryAfterMs?: number; }
export type MutationPromise<R = unknown> = Promise<Write<R>> & { readonly state?: "failed"; readonly id?: string; readonly why?: Refusal; };
// UploadOptions: import type from snapback4/contract
export interface UploadOptions { readonly file?: { readonly type?: string; readonly name?: string; readonly size?: number; }; }
```

Other exports/options: dist/client.d.ts; follow its named imports only on demand.

Declaration fingerprint: 3a021c30b076c2e16e8b2b5b62a7f3977f4d360e5005948ae894043ebaa7a2f3
