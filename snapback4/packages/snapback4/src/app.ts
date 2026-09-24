// @ref LLP 3000.013#6 — one app owns identity, client lifetimes and pending-write custody.
import { createClient } from "./client.ts";
import { createLocalClient, type DeviceOpener, type LocalOptions } from "./local.ts";
import { storeLock, logoutEpoch, StorageWarning } from "./app-storage.ts";
import { assetRetention, type AssetRetention } from "./local-assets.ts";
import { onlineCustody } from "./app-online.ts";
import { signup, login, guest, keepSession, restoreSession, forgetSession, memorySessionStore, logout as revokeSession, sessionKey, type SessionStore } from "./auth.ts";
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
/** Local configuration (including assets and waitSeconds) applies only with a
 * device; the online tier ignores it. Identity is owned by app.auth. */
export interface AppOptions extends Omit<LocalOptions, "device" | "persona" | "session" | "guest"> {
  readonly device?: DeviceOpener | undefined;
}

function problem(error: unknown): Refusal {
  if (error instanceof StorageWarning) return error.why;
  const message = error instanceof Error ? error.message : String(error);
  const code = message.includes("E_AUTH:") ? "E_AUTH" : "E_CLIENT";
  return { code, family: code === "E_AUTH" ? "auth" : "client", message,
    site: "app.auth", rewrite: "await app.auth.login(email, password)" };
}

// A restored snapshot lost its compare-and-save race to another app. Opening
// must retry from storage without revoking the winning session's family.
class RestorationChanged extends Error {}
class SessionEpochChanged extends StorageWarning {
  constructor() { super({ code: "E_AUTH", family: "auth", message: "this session was ended by another app's logout", site: "app.auth", rewrite: "await app.auth.login(email, password)" }); }
}

export function createApp(options: AppOptions): App {
  let assets: AssetRetention | undefined, configurationError: StorageWarning | undefined;
  try { if (options.device) assets = assetRetention(options.assets); }
  catch (error) {
    configurationError = new StorageWarning({ code: "E_CLIENT", family: "client", message: String(error),
      site: "app.assets", rewrite: 'createApp({ url, device, assets: { keep: "viewed", maxBytes: 67108864 } })' });
  }
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
  // This marker survives deletion of the bearer. Every owner keeps the epoch
  // it started in, so a response delayed across another app's logout cannot
  // restore that account or overwrite a subsequent sign-in.
  const epochKey = sessionKey(url) + ".epoch";
  const readEpoch = async () => {
    const marker = (await storage.get(epochKey)) ?? "0";
    const tombstone = logoutEpoch(await storage.get(sessionKey(url))) ?? "0";
    return BigInt(marker) > BigInt(tombstone) ? marker : tombstone;
  };
  const captureEpoch = () => persist(() => storeLock(sessionKey(url), readEpoch));
  let logoutBarrier: Promise<void> = Promise.resolve();
  const revokeRetired = (token: string) => { void logoutBarrier.then(() => revokeSession(url, token, fetcher)).catch(() => {}); };
  // Replacement and deletion share one lock across tabs. A server refusal
  // only owns its rejected token, never a successor kept by another runtime.
  const removeSession = (expectedToken?: string, restoring = false) => persist(() => storeLock(sessionKey(url), async () => {
    const text = await storage.get(sessionKey(url));
    let token: string | undefined;
    try { const saved = text ? JSON.parse(text) : null; if (typeof saved?.token === "string") token = saved.token; } catch {}
    if (expectedToken !== undefined && token !== expectedToken) {
      if (restoring) throw new RestorationChanged();
      return;
    }
    let tombstone = false;
    if (expectedToken === undefined) {
      const epoch = (BigInt(await readEpoch()) + 1n).toString();
      try { await storage.set(epochKey, epoch); }
      catch {
        // Never remove or revoke a bearer before its fence is durable. A
        // shrinking overwrite can succeed even when the epoch key is full.
        await storage.set(sessionKey(url), JSON.stringify({ snapback4Logout: epoch }));
        tombstone = true;
        // Freed quota may permit the marker now; keep the tombstone either way.
        try { await storage.set(epochKey, epoch); } catch {}
      }
    }
    if (!tombstone) await storage.delete(sessionKey(url));
    // Explicit clearing may drop a successor this runtime never observed.
    if (token) void revokeSession(url, token, fetcher);
  }));
  const sessionStore: SessionStore = {
    get: key => persist(() => storeLock(key, () => storage.get(key))),
    set: (key, value) => persist(() => storeLock(key, () => storage.set(key, value))),
    delete: key => key === sessionKey(url) ? removeSession() : persist(() => storeLock(key, () => storage.delete(key))),
  };
  async function restore() {
    let bytes: string | null = null, epoch = "0";
    const restoringStore: SessionStore = {
      ...sessionStore,
      get: key => persist(() => storeLock(key, async () => {
        epoch = await readEpoch();
        bytes = await storage.get(key);
        return bytes;
      })),
      // Invalid/expired data is garbage collection, not an explicit logout.
      // Compare the exact snapshot; a replacement makes restoration restart.
      delete: key => persist(() => storeLock(key, async () => {
        if (await storage.get(key) !== bytes) throw new RestorationChanged();
        await storage.delete(key);
      })),
    };
    const session = await restoreSession(url, restoringStore);
    return { session, epoch };
  }
  let snapshot: AuthSnapshot = { state: "restoring", viewer: null };
  const listeners = new Set<() => void>();
  let current = createClient({ url, fetch: fetcher });
  type Scope = { valid: boolean; session: Session; aborter: AbortController; client?: Client; logout?: Promise<void>; stop(): void; pause(): void };
  const scopes = new Set<Scope>();
  let owner: (Scope & { client: Client }) | undefined;
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
    finally { previous.stop(); await persistence.catch(() => {}); previous.valid = false; scopes.delete(previous); }
  }
  function fence(scope: Scope, error: SessionEpochChanged) {
    scope.valid = false; scope.pause(); scope.stop(); scope.aborter.abort();
    if (scope.client) void scope.client.signOut().catch(() => {});
    if (owner !== scope) return;
    const expected = revision;
    hide("restoring");
    void enqueue(async () => {
      if (owner !== scope) return;
      await release();
      if (revision === expected) publish("signed-out", null, error.why);
    }).catch(report);
  }
  async function open(session: Session, expected: number, epoch: string, restoring = false): Promise<SignIn> {
    if (closed || revision !== expected) { if (!closed) revokeRetired(session.token); return inactive(); }
    hide("restoring");
    await release();
    if (closed || revision !== expected) { if (!closed) revokeRetired(session.token); return inactive(); }
    // Every opener owns its persistence, including before it returns a Client.
    // Logout invalidates this guard synchronously, ahead of any network work.
    const scope: Scope = { valid: true, session, aborter: new AbortController(), stop() {}, pause() {} };
    scopes.add(scope);
    let restoreToken = restoring ? session.token : undefined;
    const scopedStore: SessionStore = {
      get: sessionStore.get,
      set: (key, value) => persist(() => storeLock(key, async () => {
        if (key === sessionKey(url)) {
          const next = JSON.parse(value) as Session;
          if (scope.valid && await readEpoch() !== epoch) {
            // The old token may already have been consumed by rotation, so
            // logout could not revoke this successor before it arrived.
            void revokeSession(url, next.token, scopedFetch);
            const error = new SessionEpochChanged();
            fence(scope, error);
            throw restoreToken !== undefined ? new RestorationChanged() : error;
          }
          if (scope.valid && restoreToken !== undefined) {
            const saved = await storage.get(key);
            let token: unknown;
            try { token = saved ? JSON.parse(saved)?.token : undefined; } catch {}
            if (scope.valid && token !== restoreToken) {
              // A constructor may have rotated before finding a different
              // saved account. Revoke only its unkept replacement, never a
              // stale ancestor of the session another app now owns.
              if (next.token !== scope.session.token && next.token !== token) void revokeSession(url, next.token, scopedFetch);
              throw new RestorationChanged();
            }
          }
          scope.session = next;
          // A new sign-in may replace the tombstone only after its epoch has
          // another durable home. Otherwise an old owner could see epoch 0.
          if (scope.valid && logoutEpoch(await storage.get(key)) !== null) await storage.set(epochKey, epoch);
        }
        if (scope.valid) await storage.set(key, value);
        else if (key === sessionKey(url)) void revokeSession(url, scope.session.token, scopedFetch);
        if (key === sessionKey(url) && restoreToken !== undefined) restoreToken = scope.session.token;
      })),
      delete: key => scope.valid ? (key === sessionKey(url) ? removeSession(scope.session.token, restoreToken !== undefined) : sessionStore.delete(key)) : Promise.resolve(),
    };
    const scopedFetch: typeof fetch = async (input, init) => {
      // Cancel backend acquisition before a local Client exists. Once open,
      // the client owns cancellation and late rotation revocation itself.
      const path = new URL(typeof input === "string" || input instanceof URL ? input : input.url).pathname;
      if (path === new URL(url + "/auth/logout").pathname) await scope.logout;
      if (path === new URL(url + "/auth/refresh").pathname) {
        const startedEpoch = await captureEpoch();
        if (!scope.valid || startedEpoch !== epoch) {
          const error = new SessionEpochChanged();
          fence(scope, error);
          return new Response(JSON.stringify({ denied: error.why }), { status: 401, headers: { "content-type": "application/json" } });
        }
      }
      if (!scope.valid && !path.startsWith("/auth/")) throw new Error("app opener was cancelled");
      if (path !== "/schema") return fetcher(input, init);
      const aborter = new AbortController();
      const abort = () => aborter.abort();
      const signals = [scope.aborter.signal, init?.signal].filter((signal): signal is AbortSignal => !!signal);
      for (const signal of signals) { signal.addEventListener("abort", abort, { once: true }); if (signal.aborted) abort(); }
      try { return await fetcher(input, { ...init, signal: aborter.signal }); }
      finally { for (const signal of signals) signal.removeEventListener("abort", abort); }
    };
    let raw: Client | undefined;
    try {
      await keepSession(url, session, scopedStore);
      if (!scope.valid || revision !== expected) return inactive();
      if (options.device) {
        // Preserve all local tuning while retaining app-owned identity, even
        // when an untyped caller supplies lower-level sign-in options.
        const { persona: _persona, guest: _guest, ...localOptions }: LocalOptions = { ...options, device: options.device };
        raw = await createLocalClient({ ...localOptions, assets: assets!, url, session, sessionStore: scopedStore, fetch: scopedFetch });
      } else raw = createClient({ url, session, fetch: scopedFetch });
      scope.client = raw;
      if (!scope.valid || closed || revision !== expected) {
        if (scope.valid && closed) await raw.close();
        else void raw.signOut().catch(() => {});
        return inactive();
      }
      scope.stop = raw.onSession(next => {
        if (next) void keepSession(url, next, scopedStore).catch(error => { if (scope.valid) report(error); });
        else if (scope.valid && owner === scope) {
          const rejected = scope.session.token;
          const rejectionRevision = revision;
          hide("restoring");
          void enqueue(async () => {
            if (owner !== scope) return;
            await release();
            await scope.logout;
            await removeSession(rejected);
            if (revision === rejectionRevision) publish("signed-out", null);
          }).catch(report);
        }
      });
      let warning: Refusal | undefined;
      const custody = options.device ? undefined : await onlineCustody(raw, url, storage, error => {
        warning = problem(error);
        if (scope.valid) report(error);
      });
      const client = custody?.client ?? raw;
      if (!scope.valid || closed || revision !== expected) {
        custody?.pause();
        if (scope.valid && closed) await client.close();
        else void client.signOut().catch(() => {});
        return inactive();
      }
      const own = Object.assign(scope, { client, pause: () => { custody?.pause(); } });
      owner = own;
      const next = raw.session();
      if (!next) { hide("restoring"); await release(); await removeSession(scope.session.token, restoreToken !== undefined); if (revision === expected) publish("signed-out", null); return inactive(); }
      // Local opening can rotate a near-expiry bearer before returning.
      await keepSession(url, next, scopedStore);
      if (!scope.valid || closed || revision !== expected) {
        if (!closed) void client.signOut().catch(() => {});
        await release();
        return inactive();
      }
      restoreToken = undefined;
      current = client;
      publish("signed-in", raw.viewer(), warning);
      return { ok: true, session: next };
    } catch (error) {
      if (revision === expected) hide("restoring");
      // An opener that reports failure must not leave a restorable bearer.
      // Fence late saves first, then clear only this opener's saved token.
      scope.valid = false; scope.pause(); scope.stop(); scope.aborter.abort();
      if (!(error instanceof RestorationChanged)) {
        void revokeSession(url, scope.session.token, scopedFetch);
        if (raw) void raw.signOut().catch(() => {});
        await scope.logout;
        await removeSession(scope.session.token);
      }
      try { if (owner === scope) await release(); else await raw?.close(); } catch {}
      throw error;
    } finally {
      if (owner !== scope) { scope.stop(); await persistence.catch(() => {}); scope.valid = false; scopes.delete(scope); }
    }
  }

  const signIn = (work: () => Promise<SignIn>): Promise<SignIn> => {
    const expected = ++revision;
    return enqueue(async () => {
      if (closed || revision !== expected) return inactive();
      try {
        if (configurationError) throw configurationError;
        const epoch = await captureEpoch();
        if (closed || revision !== expected) return inactive();
        const result = await work();
        if (!result.ok) {
          if (revision !== expected) return inactive();
          if (snapshot.state === "restoring") publish("signed-out", null, result.why);
          return result;
        }
        return await open(result.session, expected, epoch);
      } catch (error) {
        if (revision !== expected) return inactive();
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
      const expected = ++revision;
      hide("restoring");
      // Credential deletion is deliberately outside the auth/network queue.
      // Constructors and retiring clients can no longer write this session.
      logoutBarrier = forgetSession(url, sessionStore);
      for (const scope of scopes) {
        scope.logout = logoutBarrier;
        scope.valid = false; scope.pause(); scope.stop(); scope.aborter.abort();
        if (scope.client) void scope.client.signOut().catch(() => {}).finally(() => scopes.delete(scope));
        else revokeRetired(scope.session.token);
      }
      owner = undefined;
      const ending = logoutBarrier.then<AppResult>(() => {
        if (revision === expected) publish("signed-out", null);
        return { ok: true };
      }).catch((error): AppResult => {
        if (revision === expected) publish("signed-out", null, problem(error));
        return { ok: false, why: problem(error) };
      });
      // Later sign-ins wait for local deletion, never for remote revocation.
      operations = Promise.allSettled([operations, ending]);
      return ending;
    },
    logoutEverywhere() {
      return enqueue(async () => {
        if (!owner) return { ok: false, why: { code: "E_AUTH", family: "auth", message: "sign in to revoke sessions", site: "app.auth.logoutEverywhere", rewrite: "await app.auth.login(email, password)" } };
        try {
          const result = await owner.client.logoutAll();
          if (result.ok) { ++revision; hide("restoring"); await release(); await forgetSession(url, sessionStore); publish("signed-out", null); }
          return result;
        } catch (error) {
          if (!owner) publish("signed-out", null, problem(error));
          else report(error);
          return { ok: false, why: problem(error) };
        }
      });
    },
  };
  const ready = enqueue(async (): Promise<AppResult> => {
    const expected = 0;
    try {
      if (configurationError) throw configurationError;
      while (!closed && revision === expected) {
        try {
          const { session, epoch } = await restore();
          if (closed || revision !== expected) {
            if (session && !closed) revokeRetired(session.token);
            return { ok: true };
          }
          if (!session) { publish("signed-out", null); return { ok: true }; }
          return await open(session, expected, epoch, true);
        }
        catch (error) { if (!(error instanceof RestorationChanged)) throw error; }
      }
      return { ok: true };
    } catch (error) {
      if (revision !== expected) return { ok: true };
      publish("signed-out", null, problem(error)); return { ok: false, why: problem(error) };
    }
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
