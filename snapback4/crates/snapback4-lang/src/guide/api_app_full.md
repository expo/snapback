# API app: exact signature digest

Import from "snapback4/app". Generated from dist declarations; types named below retain their declaration meaning.

```ts
export function createApp(options: AppOptions): App;
export interface Online extends Pick<Client, "query" | "observe" | "act" | "link" | "onLink" | "now" | "viewer" | "readOnly"> { mutate<A, R>(op: Ephemeral<A, R>, args: A): Promise<Signal<R>>; }
export interface Client extends UploadCapabilities { readonly release?: import("./release.ts").ReleaseSource; readonly readOnly?: boolean; residency(): Promise<Residency | null>; now(): number; query<A, R>(op: Query<A, R>, args: A): Promise<SettledRead<R>>; observe<A, R>(op: Query<A, R>, args: A, options?: ObserveOptions): Observed<R>; mutate<A, R>(op: Ephemeral<A, R>, args: A): Promise<Signal<R>>; mutate<A, R>(op: Mutation<A, R>, args: A, options?: MutateOptions): MutationPromise<R>; write(id: string): Promise<Write | undefined>; pendingWrites(): Promise<readonly PendingWrite[]>; onPendingWrites(notify: () => void): () => void; act<A, R>(op: Action<A, R>, args: A, options?: ActOptions): Promise<Act<R>>; upload(bytes: Blob | ArrayBuffer | Uint8Array, options?: UploadOptions): Promise<Uploaded>; asset(id: string): Promise<AssetRead>; assetSource(id: string): { uri: string; headers: Record<string, string>; }; link(): Link; onLink(notify: (link: Link) => void): () => void; readonly acquired: boolean; onAcquired(notify: (acquired: boolean) => void): () => void; viewer(): Principal | null; onViewer(notify: (viewer: Principal | null) => void): () => void; onWrite(notify: (write: Exclude<Write, { state: "pending"; }>) => void): () => void; session(): Session | null; onSession(notify: (session: Session | null) => void): () => void; refreshSession(): Promise<SignIn>; logoutAll(): Promise<SessionRevocation>; signOut(): Promise<void>; close(): Promise<void>; }
export type Principal = string & { readonly __principal: "Principal"; };
export interface Refusal { readonly code: string; readonly family: string; readonly message: string; readonly detail?: string; readonly site?: string; readonly rewrite?: string; readonly guide?: string; readonly rule?: string; readonly retryable?: boolean; readonly retryAfterMs?: number; }
export type Write<R = unknown> = { readonly state: "pending"; readonly id: string; readonly reason?: string; } | { readonly state: "sent"; readonly id: string; readonly seq: number; readonly replayed?: false; readonly result: R; } | { readonly state: "sent"; readonly id: string; readonly seq: number; readonly replayed: true; readonly result?: never; } | { readonly state: "failed"; readonly id: string; readonly why: Refusal; };
export type Outcome<R = unknown> = Write<R> | Signal<R> | Act<R>;
export type Read<T> = Ready<T> | { readonly loading: true; } | { readonly denied: Refusal; };
export type ArgsOf<O> = O extends Op<infer A, unknown> ? A : never;
export type ResultOf<O> = O extends Op<unknown, infer R> ? R : never;
export type RowOf<O> = NonNullable<ResultOf<O>> extends readonly (infer E)[] ? E : NonNullable<ResultOf<O>>;
export type AuthState = "restoring" | "signed-out" | "signed-in";
export type AppResult = { readonly ok: true; } | { readonly ok: false; readonly why: Refusal; };
export type AuthSnapshot = { readonly state: "signed-in"; readonly viewer: Principal; readonly why?: Refusal | undefined; } | { readonly state: "restoring" | "signed-out"; readonly viewer: null; readonly why?: Refusal | undefined; };
export type AppAuth = AuthSnapshot & AppAuthMethods;
export type LiveAuth = { readonly state: AuthState; readonly viewer: Principal | null; readonly why?: Refusal | undefined; } & AppAuthMethods;
export interface AppAuthMethods { signup(email: string, password: string): Promise<SignIn>; login(email: string, password: string): Promise<SignIn>; guest(): Promise<SignIn>; logout(): Promise<AppResult>; logoutEverywhere(): Promise<SessionRevocation>; onChange(listener: () => void): () => void; getSnapshot(): AuthSnapshot; }
export interface App { readonly client: Client; readonly online: Online; onOnlineChange(listener: () => void): () => void; readonly auth: AppAuth; readonly ready: Promise<AppResult>; mutate: Client["mutate"]; close(): Promise<void>; }
export type AppOptions = AppConfiguration & ({ readonly device: DeviceOpener; } | { readonly persona: string; } | { readonly readOnly: true; } | { readonly sessionStore: SessionStore; });
```
