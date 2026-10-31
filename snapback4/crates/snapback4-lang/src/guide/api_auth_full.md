# API auth: exact signature digest

Import from "snapback4/auth". Generated from dist declarations; types named below retain their declaration meaning.

```ts
export function guest(url: string, options?: SignInOptions | typeof fetch, fetcher?: typeof fetch): Promise<SignIn>;
export function signup(url: string, email: string, password: string, options?: SignInOptions | typeof fetch, fetcher?: typeof fetch): Promise<SignIn>;
export function login(url: string, email: string, password: string, options?: SignInOptions | typeof fetch, fetcher?: typeof fetch): Promise<SignIn>;
export function refreshSession(url: string, token: string, doFetch?: typeof fetch): Promise<SignIn>;
export function logoutAll(url: string, token: string, doFetch?: typeof fetch): Promise<SessionRevocation>;
export function deleteAccount(url: string, token: string, doFetch?: typeof fetch): Promise<SessionRevocation>;
export function memorySessionStore(): SessionStore;
export function localStorageSessionStore(storage?: StorageLike, authorityNamespace?: string): SessionStore;
export function restoreSession(url: string, store?: SessionStore, now?: () => number, readOnly?: boolean): Promise<Session | null>;
export function keepSession(url: string, session: Session, store?: SessionStore, readOnly?: boolean): Promise<void>;
export function forgetSession(url: string, store?: SessionStore, readOnly?: boolean): Promise<void>;
export function logout(url: string, token: string, doFetch?: typeof fetch): Promise<void>;
export function narrowSession(url: string, session: Session, doFetch?: typeof fetch): Promise<SignIn>;
export interface Session { readonly principal: string; readonly kind: string; readonly token: string; readonly expiresAt: number; readonly scope?: "full" | "read"; readonly capExpiresAt?: number; }
export type SignIn = { readonly ok: true; readonly session: Session; } | { readonly ok: false; readonly why: Refusal; };
export type SessionRevocation = { readonly ok: true; readonly revoked: number; } | { readonly ok: false; readonly why: Refusal; };
export interface SignInOptions extends IdentityRetryOptions { readonly scope?: "full" | "read"; }
export interface SessionStore { get(key: string): Promise<string | null>; set(key: string, value: string): Promise<void>; delete(key: string): Promise<void>; }
export const defaultSessionStore: SessionStore
export interface StorageLike { getItem(key: string): string | null; setItem(key: string, value: string): void; removeItem(key: string): void; }
export const sessionKey: (url: string, readOnly?: boolean) => string
```
