// Sign-in (H0): a guest session, or a password account. Each returns a
// bearer token the client sends as `authorization`; the token is the
// device's to keep (in memory, or wherever the app keeps secrets). A
// deployed server refuses development personas, so this is the only door.

import { storeKey } from "./app-storage.ts";
import type { Refusal, Session, SignIn, SessionRevocation } from "./contract.ts";

export type { Session, SignIn, SessionRevocation } from "./contract.ts";

const offline = (): Refusal => ({ code: "E_OFFLINE", family: "link", message: "the server is unreachable", retryable: true });
const refused = (message: string): Refusal => ({ code: "E_AUTH", family: "auth", message });
const isSession = (value: unknown): value is Session => {
  const found = value as Partial<Session> | null;
  return Boolean(found && typeof found.principal === "string" && found.principal.length > 0 && typeof found.kind === "string" && typeof found.token === "string" && found.token.length > 0 && typeof found.expiresAt === "number" && Number.isFinite(found.expiresAt) && found.expiresAt > Date.now());
};

async function post(url: string, path: string, body: unknown, doFetch: typeof fetch): Promise<SignIn> {
  try {
    const response = await doFetch(`${url.replace(/\/$/, "")}${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const json = (await response.json()) as { session?: Session; denied?: Refusal };
    if (response.ok && isSession(json.session)) return { ok: true, session: json.session };
    return { ok: false, why: json.denied ?? refused("sign-in was refused") };
  } catch {
    return { ok: false, why: offline() };
  }
}

/** A guest principal, when the schema says `use identity guests`. */
export function guest(url: string, doFetch: typeof fetch = globalThis.fetch.bind(globalThis)): Promise<SignIn> {
  return post(url, "/auth/guest", {}, doFetch);
}

/** A new password account, when the schema says `use identity password`. */
export function signup(url: string, email: string, password: string, doFetch: typeof fetch = globalThis.fetch.bind(globalThis)): Promise<SignIn> {
  return post(url, "/auth/signup", { email, password }, doFetch);
}

export function login(url: string, email: string, password: string, doFetch: typeof fetch = globalThis.fetch.bind(globalThis)): Promise<SignIn> {
  return post(url, "/auth/login", { email, password }, doFetch);
}

/** Replace one live bearer token. The server invalidates `token` before it
 * returns the replacement, so callers must adopt the returned session. */
export async function refreshSession(url: string, token: string, doFetch: typeof fetch = globalThis.fetch.bind(globalThis)): Promise<SignIn> {
  try {
    const response = await doFetch(`${url.replace(/\/$/, "")}/auth/refresh`, { method: "POST", headers: { authorization: `Bearer ${token}` } });
    const json = (await response.json()) as { session?: Session; denied?: Refusal };
    if (response.ok && isSession(json.session)) return { ok: true, session: json.session };
    return { ok: false, why: json.denied ?? refused("session refresh was refused") };
  } catch {
    return { ok: false, why: offline() };
  }
}

/** End every live session for the bearer token's principal. */
export async function logoutAll(url: string, token: string, doFetch: typeof fetch = globalThis.fetch.bind(globalThis)): Promise<SessionRevocation> {
  try {
    const response = await doFetch(`${url.replace(/\/$/, "")}/auth/logout-all`, { method: "POST", headers: { authorization: `Bearer ${token}` } });
    const json = (await response.json()) as { ok?: boolean; revoked?: number; denied?: Refusal };
    if (json.denied) return { ok: false, why: json.denied };
    if (response.ok && (json.ok === true || typeof json.revoked === "number")) return { ok: true, revoked: Number(json.revoked ?? 0) };
    return { ok: false, why: refused("session revocation was refused") };
  } catch {
    return { ok: false, why: offline() };
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

/** Explicit browser persistence. Any script running on the page can read
 * this token; use it only when that exposure is acceptable. */
export function localStorageSessionStore(storage?: Pick<Storage, "getItem" | "setItem" | "removeItem">): SessionStore {
  const target = () => {
    const found = storage ?? globalThis.localStorage;
    if (!found) throw new Error("localStorage is unavailable in this runtime");
    return found;
  };
  return {
    async get(key) { return target().getItem(key); },
    async set(key, value) { target().setItem(key, value); },
    async delete(key) { target().removeItem(key); },
  };
}

export const sessionKey = (url: string) => storeKey("session", url.replace(/\/$/, ""));

/** The session kept for a server, if it has not expired. */
export async function restoreSession(url: string, store: SessionStore = defaultSessionStore): Promise<Session | null> {
  const key = sessionKey(url);
  const raw = await store.get(key);
  if (!raw) return null;
  try {
    const session = JSON.parse(raw) as Session;
    if (!isSession(session)) {
      await store.delete(key);
      return null;
    }
    return session;
  } catch {
    await store.delete(key);
    return null;
  }
}

export async function keepSession(url: string, session: Session, store: SessionStore = defaultSessionStore): Promise<void> {
  await store.set(sessionKey(url), JSON.stringify(session));
}

export async function forgetSession(url: string, store: SessionStore = defaultSessionStore): Promise<void> {
  await store.delete(sessionKey(url));
}

/** Best-effort server logout. A network failure or timeout cannot confirm
 * revocation; callers must clear their local credentials independently. */
export async function logout(url: string, token: string, doFetch: typeof fetch = globalThis.fetch.bind(globalThis)): Promise<void> {
  const aborter = new AbortController();
  let timer!: ReturnType<typeof setTimeout>;
  const deadline = new Promise<void>(resolve => {
    timer = setTimeout(() => { aborter.abort(); resolve(); }, 5_000);
    (timer as { unref?: () => void }).unref?.();
  });
  try {
    await Promise.race([doFetch(`${url.replace(/\/$/, "")}/auth/logout`, { method: "POST", headers: { authorization: `Bearer ${token}` }, signal: aborter.signal }), deadline]);
  } catch {
    // Offline: the token expires on its own.
  } finally { clearTimeout(timer); }
}
