# API app: exact signature digest

Import from "snapback4/app". Generated from dist declarations; types named below retain their declaration meaning.

```ts
export function createApp(options: AppOptions): App;
export type AppOptions = AppConfiguration & ({ readonly device: DeviceOpener; } | { readonly persona: string; } | { readonly readOnly: true; } | { readonly sessionStore: SessionStore; });
export type AppAuth = AuthSnapshot & AppAuthMethods;
export interface AppAuthMethods { signup(email: string, password: string): Promise<SignIn>; login(email: string, password: string): Promise<SignIn>; guest(): Promise<SignIn>; logout(): Promise<AppResult>; logoutEverywhere(): Promise<SessionRevocation>; onChange(listener: () => void): () => void; getSnapshot(): AuthSnapshot; }
export type AuthSnapshot = { readonly state: "signed-in"; readonly viewer: Principal; readonly why?: Refusal | undefined; } | { readonly state: "restoring" | "signed-out"; readonly viewer: null; readonly why?: Refusal | undefined; };
export type AuthState = "restoring" | "signed-out" | "signed-in";
export interface App { readonly client: Client; readonly online: Online; onOnlineChange(listener: () => void): () => void; readonly auth: AppAuth; readonly ready: Promise<AppResult>; mutate: Client["mutate"]; close(): Promise<void>; }
export interface Online extends Pick<Client, "query" | "observe" | "act" | "link" | "onLink" | "now" | "viewer" | "readOnly"> { mutate<A, R>(op: Ephemeral<A, R>, args: A): Promise<Signal<R>>; }
```

Declaration fingerprint: 6fe8eb546db5cd487f5662ec8760ace5bfe0a53bc2ec570ae0dbe84fc0e9bd4b
