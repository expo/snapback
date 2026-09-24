// @ref LLP 3000.013#6 — one app owns identity, client lifetimes and pending-write custody.
import { createClient } from "./client.ts";
import { createLocalClient, type DeviceOpener } from "./local.ts";
import { onlineCustody } from "./app-online.ts";
import { signup, login, guest, keepSession, restoreSession, forgetSession, memorySessionStore, logout as revokeSession, type SessionStore } from "./auth.ts";
import type { Client, Principal, Refusal, Session, SessionRevocation, SignIn } from "./contract.ts";

export type AuthState = "restoring" | "signed-out" | "signed-in";
export type AppResult = { readonly ok: true } | { readonly ok: false; readonly why: Refusal };
export interface AuthSnapshot {
  readonly state: AuthState;
  readonly viewer: Principal | null;
  readonly why?: Refusal | undefined;
}
export interface AppAuth extends AuthSnapshot {
  signup(email: string, password: string): Promise<SignIn>;
  login(email: string, password: string): Promise<SignIn>;
  guest(): Promise<SignIn>;
  logout(): Promise<AppResult>;
  logoutEverywhere(): Promise<SessionRevocation>;
  onChange(listener: () => void): () => void;
  getSnapshot(): AuthSnapshot;
}
export interface App {
  readonly client: Client;
  readonly auth: AppAuth;
  /** Initial session restoration; no network sign-in is attempted without a kept session. */
  readonly ready: Promise<AppResult>;
  mutate: Client["mutate"];
  /** Stop this runtime, preserving session and pending writes for reopening. */
  close(): Promise<void>;
}
export interface AppOptions {
  readonly url: string;
  readonly device?: DeviceOpener | undefined;
  readonly sessionStore?: SessionStore;
  readonly fetch?: typeof fetch;
}

function problem(error: unknown): Refusal {
  const message = error instanceof Error ? error.message : String(error);
  return { code: message.includes("E_AUTH:") ? "E_AUTH" : "E_CLIENT", family: "client", message,
    site: "app.auth", rewrite: "await app.auth.login(email, password)" };
}

export function createApp(options: AppOptions): App {
  const url = options.url.replace(/\/$/, "");
  const fetcher = options.fetch ?? globalThis.fetch.bind(globalThis);
  const storage = options.sessionStore ?? memorySessionStore();
  if (!options.sessionStore && typeof window !== "undefined") console.info("snapback4: createApp keeps sessions in memory. To restore after a page restart, pass sessionStore: localStorageSessionStore() from snapback4/auth. Scripts on the page can read that persisted token.");
  let persistence: Promise<unknown> = Promise.resolve();
  const persist = <T>(work: () => Promise<T>) => {
    const result = persistence.catch(() => {}).then(work);
    persistence = result;
    return result;
  };
  const sessionStore: SessionStore = {
    get: key => persist(() => storage.get(key)),
    set: (key, value) => persist(() => storage.set(key, value)),
    delete: key => persist(() => storage.delete(key)),
  };
  let snapshot: AuthSnapshot = { state: "restoring", viewer: null };
  const listeners = new Set<() => void>();
  let current = createClient({ url, fetch: fetcher });
  let owner: { client: Client; stop(): void; pause(): void } | undefined;
  let operations: Promise<unknown> = Promise.resolve();
  let closed = false;
  let revision = 0;
  const publish = (state: AuthState, viewer: Principal | null, why?: Refusal) => {
    snapshot = { state, viewer, ...(why ? { why } : {}) };
    for (const listener of listeners) listener();
  };
  const report = (error: unknown) => publish(snapshot.state, snapshot.viewer, problem(error));
  const enqueue = <T>(work: () => Promise<T>) => {
    const result = operations.catch(() => {}).then(work);
    operations = result;
    return result;
  };
  const inactive = (): SignIn => ({ ok: false, why: { code: "E_CLOSED", family: "client", message: "this app operation was superseded", site: "app.auth", rewrite: "await app.auth.login(email, password)" } });
  const hide = (state: AuthState = "signed-out") => {
    owner?.pause();
    if (current !== owner?.client) void current.close();
    current = createClient({ url, fetch: fetcher });
    publish(state, null);
  };
  async function release() {
    const previous = owner;
    owner = undefined;
    if (!previous) return;
    previous.pause();
    try { await previous.client.close(); }
    finally { previous.stop(); await persistence.catch(() => {}); }
  }
  async function open(session: Session, expected: number): Promise<SignIn> {
    if (closed || revision !== expected) { if (!closed) void revokeSession(url, session.token, fetcher); return inactive(); }
    hide("restoring");
    await release();
    if (closed || revision !== expected) { if (!closed) void revokeSession(url, session.token, fetcher); return inactive(); }
    await keepSession(url, session, sessionStore);
    const raw = options.device
      ? await createLocalClient({ url, session, sessionStore, device: options.device, fetch: fetcher })
      : createClient({ url, session, fetch: fetcher });
    if (closed || revision !== expected) { await (closed ? raw.close() : raw.signOut()); return inactive(); }
    try {
      const custody = options.device ? undefined : await onlineCustody(raw, url, storage, report);
      const client = custody?.client ?? raw;
      const own = { client, pause: () => { custody?.pause(); }, stop: () => {} };
      owner = own;
      own.stop = raw.onSession(next => {
        if (owner !== own) return;
        if (next) void keepSession(url, next, sessionStore).catch(report);
        else {
          hide();
          void enqueue(async () => {
            if (owner !== own) return;
            await release();
            await forgetSession(url, sessionStore);
          }).catch(report);
        }
      });
      const next = raw.session();
      if (!next) { hide(); await release(); await forgetSession(url, sessionStore); return inactive(); }
      // Local opening can rotate a near-expiry bearer before returning.
      await keepSession(url, next, sessionStore);
      if (closed || revision !== expected) {
        if (!closed) await client.signOut();
        await release();
        return inactive();
      }
      current = client;
      publish("signed-in", raw.viewer());
      return { ok: true, session: next };
    } catch (error) {
      hide();
      // A failed journal read or session save never exposes the half-open
      // authenticated client, and must release its transport/device lifetime.
      try { if (owner) await release(); else await raw.close(); } catch {}
      throw error;
    }
  }
  const signIn = (work: () => Promise<SignIn>): Promise<SignIn> => {
    const expected = ++revision;
    return enqueue(async () => {
      if (closed || revision !== expected) return inactive();
      try {
        const result = await work();
        if (!result.ok) {
          if (snapshot.state === "restoring") publish("signed-out", null, result.why);
          return result;
        }
        return await open(result.session, expected);
      } catch (error) {
        if (snapshot.state === "restoring") publish("signed-out", null, problem(error));
        else report(error);
        return { ok: false, why: problem(error) };
      }
    });
  };
  const auth: AppAuth = {
    get state() { return snapshot.state; },
    get viewer() { return snapshot.viewer; },
    get why() { return snapshot.why; },
    getSnapshot: () => snapshot,
    onChange(listener) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    signup: (email, password) => signIn(() => signup(url, email, password, fetcher)),
    login: (email, password) => signIn(() => login(url, email, password, fetcher)),
    guest: () => signIn(() => guest(url, fetcher)),
    logout() {
      ++revision;
      hide();
      return enqueue(async () => {
        const previous = owner;
        // Credential clearing must remain retryable even if an earlier outbox
        // save failed. Drain old work before the final session deletion.
        let failure: unknown;
        previous?.stop();
        try { await previous?.client.signOut(); } catch (error) { failure = error; }
        try { await release(); } catch (error) { failure ??= error; }
        try { await forgetSession(url, sessionStore); } catch (error) { failure ??= error; }
        if (failure) { report(failure); return { ok: false, why: problem(failure) }; }
        return { ok: true };
      });
    },
    logoutEverywhere() {
      return enqueue(async () => {
        if (!owner) return { ok: false, why: { code: "E_AUTH", family: "auth", message: "sign in to revoke sessions", site: "app.auth.logoutEverywhere", rewrite: "await app.auth.login(email, password)" } };
        try {
          const result = await owner.client.logoutAll();
          if (result.ok) { ++revision; hide(); await release(); await forgetSession(url, sessionStore); }
          return result;
        } catch (error) { report(error); return { ok: false, why: problem(error) }; }
      });
    },
  };
  const ready = enqueue(async (): Promise<AppResult> => {
    const expected = 0;
    try {
      const session = await restoreSession(url, sessionStore);
      if (closed || revision !== expected) return { ok: true };
      if (session) return await open(session, expected);
      publish("signed-out", null);
      return { ok: true };
    } catch (error) { publish("signed-out", null, problem(error)); return { ok: false, why: problem(error) }; }
  });
  return {
    auth, ready,
    get client() { return current; },
    mutate: (op, args, options) => current.mutate(op, args, options),
    close() {
      closed = true; ++revision; hide();
      return enqueue(async () => { await release(); await current.close(); listeners.clear(); });
    },
  };
}
