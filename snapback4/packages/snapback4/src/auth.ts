// Sign-in (H0): a guest session, or a password account. Each returns a
// bearer token the client sends as `authorization`; the token is the
// device's to keep (in memory, or wherever the app keeps secrets). A
// deployed server refuses development personas, so this is the only door.

import type { Refusal } from "./contract.ts";

export interface Session {
  readonly principal: string;
  readonly kind: "guest" | "user";
  readonly token: string;
  readonly expiresAt: number;
}

export type SignIn = { readonly ok: true; readonly session: Session } | { readonly ok: false; readonly why: Refusal };

async function post(url: string, path: string, body: unknown, doFetch: typeof fetch): Promise<SignIn> {
  try {
    const response = await doFetch(`${url.replace(/\/$/, "")}${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const json = (await response.json()) as { session?: Session; denied?: Refusal };
    if (json.session) return { ok: true, session: json.session };
    return { ok: false, why: json.denied ?? { code: "E_AUTH", family: "auth", message: "sign-in was refused" } };
  } catch {
    return { ok: false, why: { code: "E_OFFLINE", family: "link", message: "the server is unreachable", retryable: true } };
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

/** Where a device keeps its session between starts: `localStorage` on the
 * web, memory elsewhere, or what the app passes (`expo-secure-store` fits
 * behind three one-line methods). The client restores the session itself:
 * an app calls `createLocalClient({ url })` on a cold start and gets the
 * same principal back. */
export interface SessionStore {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  delete(key: string): Promise<void>;
}

const kept = new Map<string, string>();

export const defaultSessionStore: SessionStore = {
  async get(key) {
    try { return globalThis.localStorage?.getItem(key) ?? kept.get(key) ?? null; } catch { return kept.get(key) ?? null; }
  },
  async set(key, value) {
    kept.set(key, value);
    try { globalThis.localStorage?.setItem(key, value); } catch { /* memory keeps it for this run */ }
  },
  async delete(key) {
    kept.delete(key);
    try { globalThis.localStorage?.removeItem(key); } catch { /* nothing to forget there */ }
  },
};

/** A session store that forgets on exit, for tests and one-off scripts. */
export function memorySessionStore(): SessionStore {
  const m = new Map<string, string>();
  return { async get(k) { return m.get(k) ?? null; }, async set(k, v) { m.set(k, v); }, async delete(k) { m.delete(k); } };
}

export const sessionKey = (url: string) => `snapback4:${url.replace(/\/$/, "")}:session`;

/** The session kept for a server, if it has not expired. */
export async function restoreSession(url: string, store: SessionStore = defaultSessionStore): Promise<Session | null> {
  const raw = await store.get(sessionKey(url));
  if (!raw) return null;
  try {
    const session = JSON.parse(raw) as Session;
    if (typeof session.token !== "string" || typeof session.principal !== "string") return null;
    if (typeof session.expiresAt === "number" && session.expiresAt <= Date.now()) return null;
    return session;
  } catch {
    return null;
  }
}

export async function keepSession(url: string, session: Session, store: SessionStore = defaultSessionStore): Promise<void> {
  await store.set(sessionKey(url), JSON.stringify(session));
}

export async function forgetSession(url: string, store: SessionStore = defaultSessionStore): Promise<void> {
  await store.delete(sessionKey(url));
}

/** End a session on the server; the token stops resolving. */
export async function logout(url: string, token: string, doFetch: typeof fetch = globalThis.fetch.bind(globalThis)): Promise<void> {
  try {
    await doFetch(`${url.replace(/\/$/, "")}/auth/logout`, { method: "POST", headers: { authorization: `Bearer ${token}` } });
  } catch {
    // Offline: the token expires on its own.
  }
}
