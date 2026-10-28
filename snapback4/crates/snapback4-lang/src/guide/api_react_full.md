# API react: exact signature digest

Import from "snapback4/react". Generated from dist declarations; types named below retain their declaration meaning.
There is no useApp hook: useClient/useAuth/useOnline select its arms. ReadState uses loading/empty/denied/children. useAuth returns state and signup/login/logout. usePage requires c: cursor ?; run waits for a terminal write. Read/Write/Signal/Session/Cursor: guide api client.

```ts
export function AppProvider({ app, children }: { app: App; children: ReactNode; }): import("react").JSX.Element;
export function useAuth(): AuthSnapshot & Pick<AppAuth, "signup" | "login" | "guest" | "logout" | "logoutEverywhere">;
export function useAppReady(): boolean;
export function SnapbackProvider({ client, children }: { client: Client; children: ReactNode; }): import("react").JSX.Element;
export function useClient(): Client;
export function useRelease(): ReleaseSnapshot;
export function useOnline(): Online;
export function useNow(deadline?: number | null): number;
export function useQuery<A, R>(op: Query<A, R>, args: A, options?: ReadHookOptions): Read<R>;
export function ReadState<R extends readonly unknown[]>({ read: source, loading, empty, denied, children }: { read: Read<R> | { read: Read<R>; }; loading?: ReactNode; empty?: ReactNode; denied?: (why: Refusal) => ReactNode; children: (items: R, read: Ready<R>) => ReactNode; }): ReactNode;
export function useQueryData<A, R>(op: Query<A, R>, args: A, options?: ReadHookOptions): R | undefined;
export function useQueryResult<A, R>(op: Query<A, R>, args: A, options?: ReadHookOptions): { readonly data: R | undefined; readonly why: Refusal | null; readonly read: Read<R>; };
export function SignedIn({ children, fallback, restoring }: { children: ReactNode; fallback?: ReactNode; restoring?: ReactNode; }): ReactNode;
export function usePage<A, R extends readonly unknown[]>(op: PagedQuery<A, R>, args: Omit<A, "c">, options?: ReadHookOptions): PageHook<R>;
export function useFollowing<A, R extends readonly unknown[]>(op: FollowingQuery<A, R>, args: A): { loadMore: () => void; retry: () => void; refresh: () => void; items: readonly R[number][]; phase: import("./following.ts").FollowingPhase; hasMore: boolean; omissions: readonly { id: string; code: string; }[]; fact?: "older posts are not on this device"; code?: string; inbox?: Read<readonly R[number][]>; };
export function useMutation<A, R>(op: Ephemeral<A, R>): MutationHook<A, Signal<R>>;
export function useMutation<A, R>(op: Mutation<A, R>): WriteHook<A, R>;
export function usePendingWrite<A, R>(op: Mutation<A, R>, id?: string): { pending: boolean; run(args: A, options?: MutateOptions): Promise<Write<R>>; last: Write<R> | undefined; inFlight: boolean; restoring: boolean; };
export function usePendingWrites<A = unknown, R = unknown>(op?: Mutation<A, R>): readonly PendingWrite<A>[];
export function usePendingItems<Row, M extends Mutation<any, any>>(options: PendingItemsOptions<Row, M>): readonly import("./pending-items.ts").PendingItem<Row, MutationArgs<M>>[];
export function usePendingState<A, R, Value>(op: Mutation<A, R>, options: PendingStateOptions<A, Value>): { value: Value; intent: PendingIntent<A> | undefined; };
export function useAcquired(): boolean;
export function useAcquisition(): Acquisition;
export function useAction<A, R>(op: Action<A, R>): ActionHook<A, R>;
export function useLink(): Link;
export function useViewer(): Principal | null;
export function useSignedInViewer(): Principal;
export function usePersonaApp(persona: string | null, open: (persona: string) => App): App | null;
export function useSession(): Session | null;
export function useAsset(id: string | null | undefined): AssetState;
export function useSaveAsset(): { readonly save: (id: string, name?: string) => Promise<Saved>; readonly saving: boolean; readonly why: Refusal | null; };
export function useInspection(enabled?: boolean): ReadInspection | null;
export function useSeen<M extends { id: string; pending?: boolean; }, S extends string, T extends string>(family: ReceiptFamily<M, S, T>, options: SeenOptions): SeenSnapshot & { retry(): void; };
export function useUpload<A, R, K extends Extract<keyof A, string>>(op: Mutation<A, R>, argument: K, keptId?: string): { state: import("./uploads.ts").UploadIntent | undefined; id: string | undefined; available: boolean; uploadAndPlace: (args: Omit<A, K>, bytes: Blob | ArrayBuffer | Uint8Array, options?: Omit<import("./uploads.ts").UploadAndPlaceOptions<K>, "argument">) => Promise<import("./uploads.ts").UploadIntent>; retry: () => Promise<import("./uploads.ts").UploadIntent | undefined>; discard: () => Promise<import("./uploads.ts").UploadIntent | undefined>; };
export type ReleaseSnapshot = ServedRelease | { readonly loading: true; } | { readonly denied: Refusal; };
export interface ServedRelease { readonly generation: number; readonly operations: Readonly<Record<string, ServedOperation>>; readonly tables: Readonly<Record<string, { readonly fields: Readonly<Record<string, ServedType>>; }>>; }
export type FollowingPhase = "preparing" | "page" | "stalled" | "restart" | "refused" | "offline";
export interface FollowingSnapshot<T> { readonly items: readonly T[]; readonly phase: FollowingPhase; readonly hasMore: boolean; readonly omissions: readonly { id: string; code: string; }[]; readonly fact?: "older posts are not on this device"; readonly code?: string; readonly inbox?: Read<readonly T[]>; }
export type PendingItem<Row, A = unknown> = { kind: "row"; key: string; row: Row; } | ({ kind: "intent"; key: string; } & PendingIntent<A>);
export interface PendingIntent<A = unknown> { write: PendingWrite<A>; phase: IntentPhase; receipt?: { state: "sent"; id: string; seq: number; replayed: true; }; }
export type IntentPhase = "saving" | "queued" | "unknown" | "held" | "settling" | "evicted";
export interface PendingItemsOptions<Row, M extends Mutation<any, any>> { writes: readonly M[]; rows: readonly Row[]; scope: (write: PendingWrite<MutationArgs<M>>) => boolean; rowKey: (row: Row) => string; intentKey: (write: PendingWrite<MutationArgs<M>>) => string; }
export interface PendingStateOptions<A, Value> { scope: (write: PendingWrite<A>) => boolean; current: Value; read?: Read<unknown>; value: (args: A) => Value; }
export type AssetStage = "scheduled" | "client" | "session" | "media" | "refresh" | "queue" | "headers" | "body" | "backoff" | "retention" | "display";
export interface AssetWaiting { readonly stage: AssetStage; readonly since: number; readonly diagnosticAt: number; readonly received?: number; readonly total?: number; readonly progress?: "bytes" | "unknown"; readonly why?: Refusal; readonly interrupted?: Omit<AssetWaiting, "interrupted"> & { readonly why: Refusal; }; }
export interface Acquisition { readonly acquired: boolean; readonly rows: number; readonly tables: Readonly<Record<string, number>>; }
export function matchRead<T, H extends NoInfer<ReadMatchHandlers<T> | ReadMatchFallbackHandlers<T> | ReadMatchIncomplete<T> | MissingDenied<T>>>(read: Matchable<T>, handlers: H & FallbackDecisions<H>): ReturnType<Extract<H[keyof H], (...args: never[]) => unknown>>;
export function matchReadList<T extends readonly unknown[], H extends NoInfer<ReadMatchListHandlers<T>>>(input: Matchable<T>, handlers: H): ReturnType<Extract<H[keyof H], (...args: never[]) => unknown>>;
export type ReadMatchListHandlers<T extends readonly unknown[], R = unknown> = Pick<ReadMatchHandlers<T, R>, "denied"> & { [K in "loading" | "absent" | "partial" | "present"]?: ReadMatchHandlers<T, R>[K]; } & { otherwise: (read: Read<T>) => R; };
export function otherwiseAll<R>(fallback: (read: Read<unknown>) => R): ReadMatchOtherwiseAll<R>;
export function otherwiseAll<R, O extends ReadMatchOverrides<unknown>>(fallback: (read: Read<unknown>) => R, overrides: O): ReadMatchOtherwiseAll<R> & O;
export function isReady<R extends Read<unknown>>(read: R): read is Extract<R, { readonly data: unknown; }>;
export function isPresent<R extends Read<unknown>>(read: R): read is Extract<R, { readonly existence: "present"; }>;
export function isLoading<R extends Read<unknown>>(read: R): read is Extract<R, { readonly loading: true; }>;
export function isDenied<R extends Read<unknown>>(read: R): read is Extract<R, { readonly denied: Refusal; }>;
export function isFailed<W>(outcome: W & OutcomeInput<W>): outcome is FailedOutcome<W>;
export function sentResult<R>(write: Write<R> | null | undefined): R | undefined;
export function refusalOf<R>(write: Write<R> | null | undefined): Refusal | undefined;
export function existence(read: SettledRead<unknown>): "denied" | "present" | "absent" | "partial";
export function existence(read: Read<unknown>): "loading" | "denied" | "present" | "absent" | "partial";
export function readPresentation(read: Read<unknown>): ReadPresentation;
export interface ReadMatchHandlers<T, R = unknown> { loading: (read: Extract<Read<T>, { loading: true; }>) => R; denied: (why: Refusal, read: Extract<Read<T>, { denied: Refusal; }>) => R; absent: (read: Absent<T>) => R; partial: (data: T, read: Partial<T>) => R; present: (data: Present<T>["data"], read: Present<T>) => R; }
export type ReadMatchFallbackHandlers<T, R = unknown> = Pick<ReadMatchHandlers<T, R>, "denied" | "partial"> & { [K in "loading" | "absent" | "present"]?: ReadMatchHandlers<T, R>[K]; } & { otherwise: (read: Extract<Read<T>, { loading: true; }> | Absent<T> | Present<T>) => R; };
export interface ReadMatchOtherwiseAll<R> { readonly otherwise: OtherwiseAll<R>; }
export interface ReadMatchOverrides<R> { readonly loading?: (read: Extract<Read<unknown>, { loading: true; }>) => R; readonly denied?: (why: Refusal, read: Extract<Read<unknown>, { denied: Refusal; }>) => R; readonly absent?: (read: Absent<unknown>) => R; readonly partial?: (data: unknown, read: Partial<unknown>) => R; }
export type OtherwiseAll<R> = ((read: Read<unknown>) => R) & { readonly otherwiseAll: true; };
export interface ReadPresentation { readonly existence: ReturnType<typeof existence>; readonly pending: boolean; readonly incomplete: boolean; readonly stale: boolean; readonly revalidating: boolean; readonly why?: Refusal; readonly since?: number; }
export interface Client extends UploadCapabilities { readonly release?: import("./release.ts").ReleaseSource; readonly readOnly?: boolean; residency(): Promise<Residency | null>; now(): number; query<A, R>(op: Query<A, R>, args: A): Promise<SettledRead<R>>; observe<A, R>(op: Query<A, R>, args: A, options?: ObserveOptions): Observed<R>; mutate<A, R>(op: Ephemeral<A, R>, args: A): Promise<Signal<R>>; mutate<A, R>(op: Mutation<A, R>, args: A, options?: MutateOptions): MutationPromise<R>; write(id: string): Promise<Write | undefined>; pendingWrites(): Promise<readonly PendingWrite[]>; onPendingWrites(notify: () => void): () => void; act<A, R>(op: Action<A, R>, args: A, options?: ActOptions): Promise<Act<R>>; upload(bytes: Blob | ArrayBuffer | Uint8Array, options?: UploadOptions): Promise<Uploaded>; asset(id: string): Promise<AssetRead>; assetSource(id: string): { uri: string; headers: Record<string, string>; }; link(): Link; onLink(notify: (link: Link) => void): () => void; readonly acquired: boolean; onAcquired(notify: (acquired: boolean) => void): () => void; viewer(): Principal | null; onViewer(notify: (viewer: Principal | null) => void): () => void; onWrite(notify: (write: Exclude<Write, { state: "pending"; }>) => void): () => void; session(): Session | null; onSession(notify: (session: Session | null) => void): () => void; refreshSession(): Promise<SignIn>; logoutAll(): Promise<SessionRevocation>; signOut(): Promise<void>; close(): Promise<void>; }
export type Principal = string & { readonly __principal: "Principal"; };
export type Read<T> = Ready<T> | { readonly loading: true; } | { readonly denied: Refusal; };
export type Ready<T> = Present<T> | Partial<T> | Absent<T>;
export type SettledRead<T> = Exclude<Read<T>, { readonly loading: true; }>;
export type Write<R = unknown> = { readonly state: "pending"; readonly id: string; readonly reason?: string; readonly why?: undefined; } | { readonly state: "sent"; readonly id: string; readonly seq: number; readonly replayed?: false; readonly result: R; readonly why?: undefined; } | { readonly state: "sent"; readonly id: string; readonly seq: number; readonly replayed: true; readonly result?: never; readonly why?: undefined; } | { readonly state: "failed"; readonly id: string; readonly why: Refusal; };
export type Signal<R = unknown> = { readonly state: "sent"; readonly id: string; readonly result: R; } | { readonly state: "failed"; readonly id: string; readonly why: Refusal; };
export type Act<R = unknown> = { readonly state: "done"; readonly id: string; readonly result: R; } | { readonly state: "failed"; readonly id: string; readonly why: Refusal; } | { readonly state: "pending"; readonly id: string; } | { readonly denied: Refusal; readonly id: string; };
export type Outcome<R = unknown> = Write<R> | Signal<R> | Act<R>;
export interface Refusal { readonly code: string; readonly family: string; readonly message: string; readonly detail?: string; readonly site?: string; readonly rewrite?: string; readonly guide?: string; readonly rule?: string; readonly retryable?: boolean; readonly retryAfterMs?: number; }
export type Query<Args, Result> = Op<Args, Result> & { readonly kind: "query"; readonly ephemeralReads?: readonly string[]; readonly rowKey?: "id"; };
export type Mutation<Args, Result> = Op<Args, Result> & { readonly kind: "mutation"; readonly ephemeral?: false; };
export type Ephemeral<Args, Result> = Op<Args, Result> & { readonly kind: "mutation"; readonly ephemeral: true; readonly renews?: true; readonly renewMs: number; };
export type Action<Args, Result = unknown> = Op<Args, Result> & { readonly kind: "action"; };
export interface MutateOptions { readonly id?: string; readonly waitSeconds?: number; }
export interface PendingWrite<A = unknown> { readonly id: string; readonly op: string; readonly args: A; readonly state: "queued" | "sent" | "held"; readonly reason?: string; readonly predicted: readonly string[]; }
export type Link = "online" | "offline" | "signed-out";
export type Cursor = string & { readonly __cursor: "Cursor"; };
export type ArgsOf<O> = O extends Op<infer A, unknown> ? A : never;
export type ResultOf<O> = O extends Op<unknown, infer R> ? R : never;
export type RowOf<O> = NonNullable<ResultOf<O>> extends readonly (infer E)[] ? E : NonNullable<ResultOf<O>>;
export interface App { readonly client: Client; readonly online: Online; onOnlineChange(listener: () => void): () => void; readonly auth: AppAuth; readonly ready: Promise<AppResult>; mutate: Client["mutate"]; close(): Promise<void>; }
export type AppOptions = AppConfiguration & ({ readonly device: DeviceOpener; } | { readonly persona: string; } | { readonly readOnly: true; } | { readonly sessionStore: SessionStore; });
export type AppAuth = AuthSnapshot & AppAuthMethods;
export type AuthSnapshot = { readonly state: "signed-in"; readonly viewer: Principal; readonly why?: Refusal | undefined; } | { readonly state: "restoring" | "signed-out"; readonly viewer: null; readonly why?: Refusal | undefined; };
export type AuthState = "restoring" | "signed-out" | "signed-in";
export type AppResult = { readonly ok: true; } | { readonly ok: false; readonly why: Refusal; };
export interface Online extends Pick<Client, "query" | "observe" | "act" | "link" | "onLink" | "now" | "viewer" | "readOnly"> { mutate<A, R>(op: Ephemeral<A, R>, args: A): Promise<Signal<R>>; }
export interface SeenOptions { scope: string; through: number | null; active: boolean; }
export interface SeenSnapshot { readonly state: "idle" | "admitting" | "pending" | "retrying" | "failed"; readonly through: number; readonly why?: Refusal; }
export class QueryRefusal extends Error { readonly why: Refusal; constructor(why: Refusal); }
export interface ReadHookOptions extends ObserveOptions { readonly skip?: boolean; }
export type UseQuery<O> = O extends Query<any, any> ? Read<ResultOf<O>> : never;
export interface PageHook<R extends readonly unknown[]> { items: R[number][]; loading: boolean; why: Refusal | null; hasMore: boolean; read: Read<R>; loadMore: () => void; }
export type UsePage<O> = O extends Query<any, any> ? ResultOf<O> extends readonly unknown[] ? PageHook<ResultOf<O>> : never : never;
export interface MutationHook<A, Outcome> { run(args: A): Promise<Outcome>; last: Outcome | undefined; inFlight: boolean; }
export interface WriteHook<A, R> { run(args: A, options?: MutateOptions): Promise<Write<R>>; last: Write<R> | undefined; inFlight: boolean; }
export type UseMutation<O> = O extends Ephemeral<infer A, infer R> ? MutationHook<A, Signal<R>> : O extends Mutation<infer A, infer R> ? WriteHook<A, R> : never;
export interface ActionHook<A, R> { run(args: A, options?: ActOptions): Promise<Act<R>>; last: Act<R> | undefined; inFlight: boolean; }
export type UseAction<O> = O extends Action<infer A, infer R> ? ActionHook<A, R> : never;
export type AssetState = { readonly status: "empty"; } | { readonly status: "loading"; readonly waiting?: AssetWaiting; } | { readonly status: "ready"; readonly url: string; readonly type: string; readonly name?: string; } | { readonly status: "denied"; readonly why: Refusal; } | { readonly status: "error"; readonly why: Refusal; };
export type UploadIntent = { readonly id: string; readonly state: "queued" | "uploading"; } | { readonly id: string; readonly state: "cancelling"; readonly why?: Refusal; } | { readonly id: string; readonly state: "blocked"; readonly why: Refusal; } | { readonly id: string; readonly state: "placing"; readonly asset: Asset; } | Exclude<Write, { state: "pending"; }>;
export interface UploadAndPlaceOptions<K extends string = string> extends UploadOptions { readonly argument: K; readonly id?: string; }
export type Saved = { readonly ok: true; readonly name: string; } | { readonly ok: false; readonly why: Refusal; };
```
