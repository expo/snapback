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

/** End a session on the server; the token stops resolving. */
export async function logout(url: string, token: string, doFetch: typeof fetch = globalThis.fetch.bind(globalThis)): Promise<void> {
  try {
    await doFetch(`${url.replace(/\/$/, "")}/auth/logout`, { method: "POST", headers: { authorization: `Bearer ${token}` } });
  } catch {
    // Offline: the token expires on its own.
  }
}
