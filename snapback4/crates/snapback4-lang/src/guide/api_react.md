# API react: exact signature digest

Import from "snapback4/react". Generated from dist declarations; types named below retain their declaration meaning.
There is no useApp hook: useClient/useAuth/useOnline select its arms. ReadState uses loading/empty/denied/children. useAuth returns state and signup/login/logout. usePage requires c: cursor ?; run waits for a terminal write. Read/Write/Signal/Session/Cursor: guide api client.

```ts
export type AssetState = { readonly status: "empty"; } | { readonly status: "loading"; readonly waiting?: AssetWaiting; } | { readonly status: "ready"; readonly url: string; readonly type: string; readonly name?: string; } | { readonly status: "denied"; readonly why: Refusal; } | { readonly status: "error"; readonly why: Refusal; };
export type AuthSnapshot = { readonly state: "signed-in"; readonly viewer: Principal; readonly why?: Refusal | undefined; } | { readonly state: "restoring" | "signed-out"; readonly viewer: null; readonly why?: Refusal | undefined; };
export function AppProvider({ app, children }: { app: App; children: ReactNode; }): import("react").JSX.Element;
export function useAuth(): AuthSnapshot & Pick<AppAuth, "signup" | "login" | "guest" | "logout" | "logoutEverywhere">;
export function useAppReady(): boolean;
export function useSignedInViewer(): Principal;
export function useOnline(): Online;
export function useQueryData<A, R>(op: Query<A, R>, args: A, options?: ReadHookOptions): R | undefined;
export function useQueryResult<A, R>(op: Query<A, R>, args: A, options?: ReadHookOptions): { readonly data: R | undefined; readonly why: Refusal | null; readonly read: Read<R>; };
export function useNow(deadline?: number | null): number;
export function useLink(): Link;
export function useSaveAsset(): { readonly save: (id: string, name?: string) => Promise<Saved>; readonly saving: boolean; readonly why: Refusal | null; };
export function useClient(): Client;
export function useQuery<A, R>(op: Query<A, R>, args: A, options?: ReadHookOptions): Read<R>;
export function usePage<A, R extends readonly unknown[]>(op: PagedQuery<A, R>, args: Omit<A, "c">, options?: ReadHookOptions): PageHook<R>;
export function useMutation<A, R>(op: Ephemeral<A, R>): MutationHook<A, Signal<R>>;
export function useMutation<A, R>(op: Mutation<A, R>): WriteHook<A, R>;
export function useAsset(id: string | null | undefined): AssetState;
export function useUpload<A, R, K extends Extract<keyof A, string>>(op: Mutation<A, R>, argument: K, keptId?: string): { state: import("./uploads.ts").UploadIntent | undefined; id: string | undefined; available: boolean; uploadAndPlace: (args: Omit<A, K>, bytes: Blob | ArrayBuffer | Uint8Array, options?: Omit<import("./uploads.ts").UploadAndPlaceOptions<K>, "argument">) => Promise<import("./uploads.ts").UploadIntent>; retry: () => Promise<import("./uploads.ts").UploadIntent | undefined>; discard: () => Promise<import("./uploads.ts").UploadIntent | undefined>; };
export function ReadState<R extends readonly unknown[]>({ read: source, loading, empty, denied, children }: { read: Read<R> | { read: Read<R>; }; loading?: ReactNode; empty?: ReactNode; denied?: (why: Refusal) => ReactNode; children: (items: R, read: Ready<R>) => ReactNode; }): ReactNode;
export interface ReadHookOptions extends ObserveOptions { readonly skip?: boolean; }
export interface PageHook<R extends readonly unknown[]> { items: R[number][]; loading: boolean; why: Refusal | null; hasMore: boolean; read: Read<R>; loadMore: () => void; }
type PagedQuery<A, R> = Query<A, R> & ("c" extends keyof A ? unknown : { readonly "usePage needs a query that declares `c: cursor ?` and reads `after c`; see `snapback4 guide reads`": true; });
export interface WriteHook<A, R> { run(args: A, options?: MutateOptions): Promise<Write<R>>; last: Write<R> | undefined; inFlight: boolean; }
export interface MutationHook<A, Outcome> { run(args: A): Promise<Outcome>; last: Outcome | undefined; inFlight: boolean; }
export type UsePage<O> = O extends Query<any, any> ? ResultOf<O> extends readonly unknown[] ? PageHook<ResultOf<O>> : never : never;
export type UseQuery<O> = O extends Query<any, any> ? Read<ResultOf<O>> : never;
export type UseMutation<O> = O extends Ephemeral<infer A, infer R> ? MutationHook<A, Signal<R>> : O extends Mutation<infer A, infer R> ? WriteHook<A, R> : never;
export function isFailed<W>(outcome: W & OutcomeInput<W>): outcome is FailedOutcome<W>;
export function sentResult<R>(write: Write<R> | null | undefined): R | undefined;
```

Declaration fingerprint: e75d9a8cc95e9be2c33698689f106b7ff41fdfa5f7c5bf00b0cb8fbed3b5d69b
