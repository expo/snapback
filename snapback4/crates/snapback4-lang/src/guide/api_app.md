# API app: exact signature digest

Import from "snapback4/app". Generated from dist declarations; types named below retain their declaration meaning.
startup?: "progressive" | "awaited". Web devices with a custody probe default to progressive: app.ready means usable client and write custody, not local replica readiness. localStatus(app.client) / useLocalStatus() report engine and acquisition state. "awaited" restores the device-opening barrier; openers without a probe always await. Author ruling 2026-10-30: default now, Lane C qualification follows.

```ts
export function createApp(options: AppOptions): App;
export type AppOptions = AppConfiguration & ({ readonly device: DeviceOpener; } | { readonly persona: string; } | { readonly readOnly: true; } | { readonly sessionStore: SessionStore; });
export type AppAuth = AuthSnapshot & AppAuthMethods;
export interface AppAuthMethods { signup(email: string, password: string): Promise<SignIn>; login(email: string, password: string): Promise<SignIn>; guest(): Promise<SignIn>; logout(): Promise<AppResult>; logoutEverywhere(): Promise<SessionRevocation>; deleteAccount(): Promise<SessionRevocation>; onChange(listener: () => void): () => void; getSnapshot(): AuthSnapshot; }
export type AuthSnapshot = { readonly state: "signed-in"; readonly viewer: Principal; readonly why?: Refusal | undefined; } | { readonly state: "restoring" | "signed-out"; readonly viewer: null; readonly why?: Refusal | undefined; };
export type AuthState = "restoring" | "signed-out" | "signed-in";
export interface App { readonly client: Client; readonly online: Online; onOnlineChange(listener: () => void): () => void; readonly auth: AppAuth; readonly ready: Promise<AppResult>; mutate: Client["mutate"]; close(): Promise<void>; }
export interface Online extends Pick<Client, "query" | "observe" | "act" | "link" | "onLink" | "now" | "viewer" | "readOnly"> { mutate<A, R>(op: Ephemeral<A, R>, args: A): Promise<Signal<R>>; }
```

Declaration fingerprint: def373be78bca24d17bce948d7f75eb84f63efa63b7cdba270353b40d58b3522
