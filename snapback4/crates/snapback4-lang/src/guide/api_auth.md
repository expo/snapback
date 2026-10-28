# API auth: exact signature digest

Import from "snapback4/auth". Generated from dist declarations; types named below retain their declaration meaning.

```ts
export function signup(url: string, email: string, password: string, options?: SignInOptions | typeof fetch, fetcher?: typeof fetch): Promise<SignIn>;
export function login(url: string, email: string, password: string, options?: SignInOptions | typeof fetch, fetcher?: typeof fetch): Promise<SignIn>;
export type SignIn = { readonly ok: true; readonly session: Session; } | { readonly ok: false; readonly why: Refusal; };
export interface Session { readonly principal: string; readonly kind: string; readonly token: string; readonly expiresAt: number; readonly scope?: "full" | "read"; readonly capExpiresAt?: number; }
export interface SignInOptions extends IdentityRetryOptions { readonly scope?: "full" | "read"; }
export function guest(url: string, options?: SignInOptions | typeof fetch, fetcher?: typeof fetch): Promise<SignIn>;
export interface SessionStore { get(key: string): Promise<string | null>; set(key: string, value: string): Promise<void>; delete(key: string): Promise<void>; }
export function memorySessionStore(): SessionStore;
export function restoreSession(url: string, store?: SessionStore, now?: () => number, readOnly?: boolean): Promise<Session | null>;
export function keepSession(url: string, session: Session, store?: SessionStore, readOnly?: boolean): Promise<void>;
export function forgetSession(url: string, store?: SessionStore, readOnly?: boolean): Promise<void>;
export function logout(url: string, token: string, doFetch?: typeof fetch): Promise<void>;
export function logoutAll(url: string, token: string, doFetch?: typeof fetch): Promise<SessionRevocation>;
export function refreshSession(url: string, token: string, doFetch?: typeof fetch): Promise<SignIn>;
export function narrowSession(url: string, session: Session, doFetch?: typeof fetch): Promise<SignIn>;
```

Declaration fingerprint: 774ca62187dde905e8ae3065302315e08f46f2ab54542f230d75337a07be8500
