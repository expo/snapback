import { browserAdmission, synchronousSessionStore } from "./admission.ts";
import { indexedDbSessionStore } from "./session-authority.ts";
import { defaultFetch } from "#fetch";
import { isReadToken } from "./read-token.ts";
// Sign-in (H0): a guest session, or a password account. Each returns a
// bearer token the client sends as `authorization`; the token is the
// device's to keep (in memory, or wherever the app keeps secrets). A
// deployed server refuses development personas, so this is the only door.

import { storeKey, logoutEpoch } from "./app-storage.ts";
import type { Refusal, Session, SignIn, SessionRevocation } from "./contract.ts";
import { readResponse, transportRefusal, invalidResponse } from "./http-response.ts";

export type { Session, SignIn, SessionRevocation } from "./contract.ts";

const refused = (message: string): Refusal => ({ code: "E_AUTH", family: "auth", message });
const isSession = (value: unknown, now = Date.now()): value is Session => {
  const found = value as Partial<Session> | null;
  return Boolean(found && typeof found.principal === "string" && found.principal.length > 0 && typeof found.kind === "string" && typeof found.token === "string" && found.token.length > 0 && typeof found.expiresAt === "number" && Number.isFinite(found.expiresAt) && found.expiresAt > now);
};

async function post(url: string, path: string, body: unknown, doFetch: typeof fetch): Promise<SignIn> {
  try {
    const response = await doFetch(`${url.replace(/\/$/, "")}${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const json = (await readResponse(response)) as { session?: Session; denied?: Refusal };
    if (response.ok && isSession(json.session, Number(response.headers.get("x-snapback-time") ?? Date.now()))) return { ok: true, session: json.session };
    return { ok: false, why: json.denied ?? refused("sign-in was refused") };
  } catch (error) {
    return { ok: false, why: transportRefusal(error) };
  }
}

export interface SignInOptions { readonly scope?: "full" | "read"; }
const signInArgs = (options: SignInOptions | typeof fetch, doFetch: typeof fetch) => typeof options === "function" ? { options: {}, doFetch: options } : { options, doFetch };

/** A guest principal, when the schema says `use identity guests`. */
export function guest(url: string, options: SignInOptions | typeof fetch = {}, fetcher: typeof fetch = defaultFetch): Promise<SignIn> {
  const args = signInArgs(options, fetcher);
  return post(url, "/auth/guest", args.options, args.doFetch);
}

/** A new password account, when the schema says `use identity password`. */
export function signup(url: string, email: string, password: string, options: SignInOptions | typeof fetch = {}, fetcher: typeof fetch = defaultFetch): Promise<SignIn> {
  const args = signInArgs(options, fetcher);
  return post(url, "/auth/signup", { email, password, ...args.options }, args.doFetch);
}

export function login(url: string, email: string, password: string, options: SignInOptions | typeof fetch = {}, fetcher: typeof fetch = defaultFetch): Promise<SignIn> {
  const args = signInArgs(options, fetcher);
  return post(url, "/auth/login", { email, password, ...args.options }, args.doFetch);
}

/** Replace one live full-session bearer token. The server invalidates `token` before it
 * returns the replacement, so callers must adopt or revoke the returned session. */
export async function refreshSession(url: string, token: string, doFetch: typeof fetch = defaultFetch): Promise<SignIn> {
  // @ref LLP 3000.033#1.3 — SDK read credentials live until expiry, without rotation.
  if (isReadToken(token)) return { ok: false, why: { code: "E_READ_ONLY_REFRESH", family: "auth", guide: "read-only",
    message: "read sessions cannot refresh; sign in again or narrow a full session again" } };
  try {
    const response = await doFetch(`${url.replace(/\/$/, "")}/auth/refresh`, { method: "POST", headers: { authorization: `Bearer ${token}` } });
    const json = (await readResponse(response)) as { session?: Session; denied?: Refusal };
    if (response.ok && isSession(json.session, Number(response.headers.get("x-snapback-time") ?? Date.now()))) return { ok: true, session: json.session };
    return { ok: false, why: json.denied ?? invalidResponse(response.status, "session refresh") };
  } catch (error) {
    return { ok: false, why: transportRefusal(error) };
  }
}

/** End every live session for the bearer token's principal. */
export async function logoutAll(url: string, token: string, doFetch: typeof fetch = defaultFetch): Promise<SessionRevocation> {
  try {
    const response = await doFetch(`${url.replace(/\/$/, "")}/auth/logout-all`, { method: "POST", headers: { authorization: `Bearer ${token}` } });
    const json = (await readResponse(response)) as { ok?: boolean; revoked?: number; denied?: Refusal };
    if (json.denied) return { ok: false, why: json.denied };
    if (response.ok && (json.ok === true || typeof json.revoked === "number")) return { ok: true, revoked: Number(json.revoked ?? 0) };
    return { ok: false, why: refused("session revocation was refused") };
  } catch (error) {
    return { ok: false, why: transportRefusal(error) };
  }
}

/** Where a device keeps its bearer session. The default is memory, so a web
 * page cannot read a long-lived token from browser storage. Pass a secure
 * platform store for continuity across starts. */
export interface SessionStore {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  delete(key: string): Promise<void>;
}

/** A session store that forgets when this JavaScript runtime exits. */
export function memorySessionStore(): SessionStore {
  const m = new Map<string, string>();
  return { async get(k) { return m.get(k) ?? null; }, async set(k, v) { m.set(k, v); }, async delete(k) { m.delete(k); } };
}

export const defaultSessionStore: SessionStore = memorySessionStore();

/** Structural session mirror, usable without DOM types. */
export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/** Explicit browser persistence: coherent IndexedDB authority and a synchronous
 * localStorage mirror. Custom mirror adapters need a stable unique namespace.
 * Any script on this origin can read the token; opt in only when acceptable. */
export function localStorageSessionStore(storage?: StorageLike, authorityNamespace?: string): SessionStore {
  const target = () => {
    const found = storage ?? globalThis.localStorage;
    if (!found) throw new Error("localStorage is unavailable in this runtime");
    return found;
  };
  const store = browserAdmission() ? indexedDbSessionStore(target, authorityNamespace ?? (!storage || storage === globalThis.localStorage ? "default" : undefined)) : {
    async get(key) { return target().getItem(key); },
    async set(key, value) { target().setItem(key, value); },
    async delete(key) { target().removeItem(key); },
  } satisfies SessionStore;
  return synchronousSessionStore(store, key => target().getItem(key));
}

export const sessionKey = (url: string, readOnly = false) => storeKey("session", url.replace(/\/$/, "")) + (readOnly ? ".read" : "");

/** The session kept for a server, if it has not expired. */
export async function restoreSession(url: string, store: SessionStore = defaultSessionStore, now: () => number = Date.now, readOnly = false): Promise<Session | null> {
  const key = sessionKey(url, readOnly);
  const raw = await store.get(key);
  if (!raw || logoutEpoch(raw) !== null) return null;
  try {
    const session = JSON.parse(raw) as Session;
    if (isSession(session, now())) return session;
  } catch { /* Invalid JSON follows the same cleanup path as an expired session. */ }
  // A store may condition cleanup on the exact bytes returned by get. Let a
  // changed-snapshot or storage failure propagate instead of deleting twice.
  await store.delete(key);
  return null;
}

export async function keepSession(url: string, session: Session, store: SessionStore = defaultSessionStore, readOnly = false): Promise<void> {
  await store.set(sessionKey(url, readOnly), JSON.stringify(session));
}

export async function forgetSession(url: string, store: SessionStore = defaultSessionStore, readOnly = false): Promise<void> {
  await store.delete(sessionKey(url, readOnly));
}

/** Best-effort server logout. A network failure or timeout cannot confirm
 * revocation; callers must clear their local credentials independently. */
export async function logout(url: string, token: string, doFetch: typeof fetch = defaultFetch): Promise<void> {
  let timer!: ReturnType<typeof setTimeout>;
  const deadline = new Promise<void>(resolve => {
    timer = setTimeout(resolve, 5_000);
    (timer as { unref?: () => void }).unref?.();
  });
  try {
    await Promise.race([doFetch(`${url.replace(/\/$/, "")}/auth/logout`, { method: "POST", headers: { authorization: `Bearer ${token}` } }), deadline]);
  } catch {
    // Offline: the token expires on its own.
  } finally { clearTimeout(timer); }
}

/** Mint an independent read family capped at the full parent's current expiry. */
export async function narrowSession(url: string, session: Session, doFetch: typeof fetch = defaultFetch): Promise<SignIn> {
  try {
    const response = await doFetch(`${url.replace(/\/$/, "")}/auth/narrow`, { method: "POST", headers: { authorization: `Bearer ${session.token}` } });
    const json = await readResponse(response) as { session?: Session; denied?: Refusal };
    if (response.ok && isSession(json.session, Number(response.headers.get("x-snapback-time") ?? Date.now()))) return { ok: true, session: json.session };
    return { ok: false, why: json.denied ?? invalidResponse(response.status, "session narrowing") };
  } catch (error) { return { ok: false, why: transportRefusal(error) }; }
}
