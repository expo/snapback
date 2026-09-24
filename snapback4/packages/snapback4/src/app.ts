// @ref LLP 3000.013#6 — one app owns identity, client lifetimes and pending-write custody.
import { createClient } from "./client.ts";
import { prepareClient } from "./client-start.ts";
import { createLocalClient, type DeviceOpener, type LocalOptions } from "./local.ts";
import { storeLock, sessionEpoch, StorageWarning } from "./app-storage.ts";
import { assetRetention, type AssetRetention } from "./local-assets.ts";
import { onlineCustody } from "./app-online.ts";
import { guardClient } from "./app-client.ts";
import { sessionRevocations } from "./app-revocations.ts";
import { signup, login, guest, keepSession, restoreSession, forgetSession, memorySessionStore, logout as revokeSession, logoutAll as revokeAllSessions, sessionKey, type SessionStore } from "./auth.ts";
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
  constructor() { super({ code: "E_AUTH", family: "auth", message: "the stored session changed in another app", site: "app.auth", rewrite: "await app.auth.login(email, password)" }); }
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
  const backing = options.sessionStore ?? memorySessionStore();
  const storage: SessionStore = { set: (key, value) => backing.set(key, value), delete: key => backing.delete(key), async get(key) {
    const bytes = await backing.get(key);
    if (key === sessionKey(url)) {
      const observed = sessionEpoch(bytes);
      if (observed !== null && owner?.valid && BigInt(observed) > BigInt(owner.epoch)) fence(owner, new SessionEpochChanged());
    }
    return bytes;
  } };
  if (!options.sessionStore && typeof window !== "undefined") console.info("snapback4: createApp keeps sessions in memory. To restore after a page restart, pass sessionStore: localStorageSessionStore() from snapback4/auth. Scripts on the page can read that persisted token.");
  let persistence: Promise<unknown> = Promise.resolve();
  const persist = <T>(work: () => Promise<T>) => {
    const result = persistence.catch(() => {}).then(work);
    persistence = result;
    return result;
  };
  // I1: every revocation compares the stored bearer. I2/I5: one record
  // commits session + epoch, only after opening succeeds. I3: journal before
  // displacement, drain after commit. I4: an observed epoch fences old work.
  // See CLIENT-AND-OPERATIONS.md, session state-machine invariants.
  const epochKey = sessionKey(url) + ".epoch";
  const readEpoch = async () => {
    const marker = (await storage.get(epochKey)) ?? "0";
    const tombstone = sessionEpoch(await storage.get(sessionKey(url))) ?? "0";
    const epoch = BigInt(marker) > BigInt(tombstone) ? marker : tombstone;
    if (owner?.valid && BigInt(epoch) > BigInt(owner.epoch)) fence(owner, new SessionEpochChanged());
    return epoch;
  };
  const captureEpoch = () => persist(() => storeLock(sessionKey(url), readEpoch));
  const revocations = sessionRevocations(url, storage, fetcher, work => persist(() => storeLock(sessionKey(url), work)));
  let logoutBarrier: Promise<void> = Promise.resolve();
  const revokeRetired = (token: string) => { void revocations.retire(token).catch(report); };
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
    if (expectedToken !== undefined) return; // A refusal is not an explicit logout.
    const epoch = (BigInt(await readEpoch()) + 1n).toString();
    // The tombstone is the single durable logout commit. It carries retirement
    // custody too, so a quota failure cannot split the fence from the bearer.
    const retired = revocations.embedded(text);
    await storage.set(sessionKey(url), JSON.stringify({ snapback4Logout: epoch, snapback4Backend: url,
      snapback4Retired: [...new Set([...retired, ...revocations.pending(), ...(token ? [token] : [])])] }));

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
        const keptEpoch = sessionEpoch(bytes);
        if (keptEpoch !== null) await storage.set(key, JSON.stringify({ snapback4Logout: keptEpoch }));
        else await storage.delete(key);
      })),
    };
    const session = await restoreSession(url, restoringStore);
    return { session, epoch };
  }
  let snapshot: AuthSnapshot = { state: "restoring", viewer: null };
  const listeners = new Set<() => void>();
  let current = createClient({ url, fetch: fetcher });
  type Scope = { valid: boolean; epoch: string; session: Session; issued: Set<string>; aborter: AbortController; client?: Client; view?: Client; save?: () => Promise<void>; logout?: Promise<void>; stop(): void; pause(): void };
  const scopes = new Set<Scope>();
  let owner: (Scope & { client: Client }) | undefined;
  let operations: Promise<unknown> = Promise.resolve();
  let closed = false;
  let revision = 0;
  const publish = (state: AuthState, viewer: Principal | null, why?: Refusal) => {
    snapshot = { state, viewer, ...(why ? { why } : {}) };
    for (const listener of listeners) { try { listener(); } catch (error) { console.error("snapback4 auth listener:", error); } }
  };
  const report = (error: unknown) => publish(snapshot.state, snapshot.viewer, problem(error));
  const drainRevocations = () => { void revocations.drain().catch(report); };
  const enqueue = <T>(work: () => Promise<T>) => {
    const result = operations.catch(() => {}).then(work);
    operations = result;
    return result;
  };
  const inactive = (): SignIn => ({ ok: false, why: { code: "E_CLOSED", family: "client", message: "this app operation was superseded", site: "app.auth", rewrite: "await app.auth.login(email, password)" } });
  const hide = (state: AuthState = "signed-out", pause = true) => {
    if (pause) owner?.pause();
    if (current !== owner?.view) void current.close();
    current = createClient({ url, fetch: fetcher });
    publish(state, null);
  };
  async function release() {
    const previous = owner;
    owner = undefined;
    if (!previous) return;
    previous.pause();
    try { await previous.client.close(); }
    finally {
      if (previous.valid) try { await previous.save?.(); } catch (error) { report(error); }
      const retired = previous.client.session()?.token;
      previous.stop(); await persistence.catch(() => {}); previous.valid = false; scopes.delete(previous);
      if (retired) previous.issued.add(retired);
      for (const token of previous.issued) revokeRetired(token);
    }
  }
  function fence(scope: Scope, error: SessionEpochChanged) {
    scope.valid = false; scope.pause(); scope.stop(); scope.aborter.abort();
    if (scope.client) void scope.client.signOut().catch(() => {});
    if (owner !== scope || closed) return;
    const expected = revision;
    hide("restoring");
    void enqueue(async () => {
      if (owner !== scope) return;
      await release();
      if (revision === expected) publish("signed-out", null, error.why);
    }).catch(report);
  }
  async function open(session: Session, expected: number, epoch: string, restoring = false): Promise<SignIn> {
    if (closed || revision !== expected) { revokeRetired(session.token); return inactive(); }
    const previous = owner;
    hide("restoring", false);
    // Keep the prior runtime's rotations and pending-write custody alive until
    // commit. A failed replacement must not repair, revoke or detach it.
    // Every opener owns its persistence, including before it returns a Client.
    // Logout invalidates this guard synchronously, ahead of any network work.
    const scope: Scope = { valid: true, epoch, session, issued: new Set([session.token]), aborter: new AbortController(), stop() {}, pause() {} };
    scopes.add(scope);
    let restoreToken = restoring ? session.token : undefined;
    let preparing = true, committing = false;
    const scopedStore: SessionStore = {
      get: sessionStore.get,
      set: (key, value) => persist(() => storeLock(key, async () => {
        if (key !== sessionKey(url)) { await storage.set(key, value); return; }
        const next = JSON.parse(value) as Session;
        const saved = await storage.get(key);
        let kept: Session | undefined;
        try { kept = saved ? JSON.parse(saved) : undefined; } catch {}
        if (!scope.valid || await readEpoch() !== epoch) {
          revokeRetired(next.token);
          const error = new SessionEpochChanged(); fence(scope, error);
          throw restoreToken !== undefined ? new RestorationChanged() : error;
        }
        if (restoreToken !== undefined && kept?.token !== restoreToken) {
          if (next.token !== scope.session.token && next.token !== kept?.token) revokeRetired(next.token);
          throw new RestorationChanged();
        }
        // Constructors can write/rotate several times. These saves are private
        // until their final successful opening; no durable account is displaced.
        if (preparing && !committing) { scope.session = next; return; }
        const replacing = preparing && !restoring;
        if (!replacing && kept?.token && kept.token !== scope.session.token && kept?.token !== next.token) {
          revokeRetired(next.token);
          const error = new SessionEpochChanged(); fence(scope, error);
          throw restoreToken !== undefined ? new RestorationChanged() : error;
        }
        if (replacing) await revocations.stage([...(kept?.token ? [kept.token] : []), ...revocations.pending()].filter(token => token !== next.token));
        const nextEpoch = replacing && kept?.token && kept.token !== next.token ? (BigInt(epoch) + 1n).toString() : epoch;
        // I2/I5: no separate epoch write and no fallible opening after this set.
        if (kept?.token !== next.token || replacing) await storage.set(key, JSON.stringify({ ...next, snapback4Epoch: nextEpoch, snapback4Backend: url }));
        epoch = nextEpoch; scope.epoch = nextEpoch; scope.session = next;
        scope.issued.clear(); scope.issued.add(next.token);
        if (restoreToken !== undefined) restoreToken = next.token;
      })),
      delete: key => scope.valid ? (key === sessionKey(url) ? removeSession(scope.session.token, restoreToken !== undefined) : sessionStore.delete(key)) : Promise.resolve(),
    };
    async function authorized(): Promise<boolean> {
      const startedEpoch = await captureEpoch();
      if (!scope.valid || startedEpoch !== epoch) {
        fence(scope, new SessionEpochChanged()); return false;
      }
      return true;
    }
    const scopedFetch: typeof fetch = async (input, init) => {
      // Cancel backend acquisition before a local Client exists. Once open,
      // the client owns cancellation and late rotation revocation itself.
      const path = new URL(typeof input === "string" || input instanceof URL ? input : input.url).pathname;
      if (path === new URL(url + "/auth/logout").pathname) {
        const headers = new Headers(init?.headers ?? (typeof input === "string" || input instanceof URL ? undefined : input.headers));
        const token = headers.get("authorization")?.match(/^Bearer (.+)$/i)?.[1];
        await scope.logout?.catch(() => {});
        if (token) await revocations.retire(token);
        return Response.json({ ok: true });
      }
      if (!await authorized()) return Response.json({ denied: new SessionEpochChanged().why }, { status: 401 });
      if (init?.signal?.aborted) throw init.signal.reason ?? new Error("request was cancelled");
      if (!scope.valid && !path.startsWith("/auth/")) throw new Error("app opener was cancelled");
      if (path !== "/schema") {
        const response = await fetcher(input, init);
        if (path === new URL(url + "/auth/refresh").pathname) {
          try {
            const issued = (await response.clone().json() as { session?: Session }).session;
            if (issued?.token) {
              scope.issued.add(issued.token);
              if (!scope.valid) revokeRetired(issued.token);
            }
          } catch { /* The lower-level client reports malformed replies. */ }
        }
        return response;
      }
      const aborter = new AbortController();
      const abort = () => aborter.abort();
      const signals = [scope.aborter.signal, init?.signal].filter((signal): signal is AbortSignal => !!signal);
      for (const signal of signals) { signal.addEventListener("abort", abort, { once: true }); if (signal.aborted) abort(); }
      try { return await fetcher(input, { ...init, signal: aborter.signal }); }
      finally { for (const signal of signals) signal.removeEventListener("abort", abort); }
    };
    let raw: Client | undefined, startClient: (() => Promise<void>) | undefined;
    try {
      await keepSession(url, session, scopedStore);
      if (!scope.valid || revision !== expected) return inactive();
      if (options.device) {
        // Preserve all local tuning while retaining app-owned identity, even
        // when an untyped caller supplies lower-level sign-in options.
        const { persona: _persona, guest: _guest, ...localOptions }: LocalOptions = { ...options, device: options.device };
        const prepared = { ...localOptions, assets: assets!, url, session, sessionStore: scopedStore, fetch: scopedFetch };
        const local = await prepareClient(prepared, () => createLocalClient(prepared));
        raw = local.client; startClient = local.start;
      } else {
        const prepared = { url, session, fetch: scopedFetch };
        const online = await prepareClient(prepared, () => createClient(prepared));
        raw = online.client; startClient = online.start;
      }
      scope.client = raw;
      scope.save = async () => { const next = raw?.session(); if (next) await keepSession(url, next, scopedStore); };
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
            let warning: Refusal | undefined;
            try { await release(); await scope.logout; await removeSession(rejected); }
            catch (error) { warning = problem(error); }
            if (revision === rejectionRevision) publish("signed-out", null, warning);
          }).catch(report);
        }
      });
      let warning: Refusal | undefined;
      const custody = options.device ? undefined : await onlineCustody(raw, url, storage, error => {
        warning = problem(error);
        if (scope.valid) report(error);
      }, false);
      const baseClient = custody?.client ?? raw;
      const client = guardClient(baseClient, authorized, () => scope.valid, () => new SessionEpochChanged().why);
      // Public Client lifecycle calls have the same atomic identity boundary as
      // app.auth. Internal retirement always uses baseClient, never these routes.
      client.signOut = async () => { if (owner === scope) await auth.logout(); };
      client.logoutAll = () => owner === scope ? auth.logoutEverywhere()
        : Promise.resolve({ ok: false, why: new SessionEpochChanged().why });
      if (!scope.valid || closed || revision !== expected) {
        custody?.pause();
        if (scope.valid && closed) await client.close();
        else void baseClient.signOut().catch(() => {});
        return inactive();
      }
      const own = Object.assign(scope, { client: baseClient, view: client, pause: () => { custody?.pause(); } });
      owner = own;
      const next = raw.session();
      if (!next) { hide("restoring"); await release(); await removeSession(scope.session.token, restoreToken !== undefined); if (revision === expected) publish("signed-out", null); return inactive(); }
      // Local opening can rotate a near-expiry bearer before returning.
      committing = true;
      await keepSession(url, next, scopedStore);
      preparing = false;
      if (previous) {
        previous.valid = false; previous.pause(); previous.stop(); previous.aborter.abort();
        void previous.client.signOut().catch(() => {}).finally(() => scopes.delete(previous));
      }
      if (!scope.valid || closed || revision !== expected) {
        if (!closed) void baseClient.signOut().catch(() => {});
        await release();
        drainRevocations();
        return { ok: true, session: next }; // The durable commit already happened.
      }
      restoreToken = undefined;
      current = client;
      publish("signed-in", raw.viewer(), warning);
      custody?.start();
      // Preserve the documented local acquisition barrier. This is after the
      // identity commit: a transport/startup error reports why, never rollback.
      if (startClient) try { await startClient(); } catch (error) { if (scope.valid) report(error); }
      drainRevocations();
      return { ok: true, session: raw.session() ?? next };
    } catch (error) {
      if (revision === expected) hide("restoring", false);
      // Abort only the provisional owner. The previous durable session and
      // epoch are unchanged; every issued successor remains in retirement custody.
      scope.valid = false; scope.pause(); scope.stop(); scope.aborter.abort();
      if (!(error instanceof RestorationChanged)) {
        void revokeSession(url, scope.session.token, scopedFetch);
        if (raw) void raw.signOut().catch(() => {});
        await scope.logout;
        // Provisional failure never owns the previously stored account.
      }
      try { if (owner === scope) await release(); else await raw?.close(); } catch {}
      if (previous?.valid && !closed && revision === expected) {
        owner = previous; current = previous.view ?? previous.client;
        publish("signed-in", previous.client.viewer(), problem(error));
      }
      throw error;
    } finally {
      if (owner !== scope) { scope.stop(); await persistence.catch(() => {}); scope.valid = false; scopes.delete(scope); if (preparing) for (const token of scope.issued) revokeRetired(token); }
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
        drainRevocations();
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
        const bearer = owner?.client.session()?.token;
        if (!bearer) return { ok: false, why: { code: "E_AUTH", family: "auth", message: "sign in to revoke sessions", site: "app.auth.logoutEverywhere", rewrite: "await app.auth.login(email, password)" } };
        ++revision; hide("restoring");
        logoutBarrier = forgetSession(url, sessionStore);
        const retiring = [...scopes];
        for (const scope of retiring) {
          scope.logout = logoutBarrier; scope.valid = false; scope.pause(); scope.stop(); scope.aborter.abort();
        }
        owner = undefined;
        try {
          // I1/I2: a failed local commit must not remotely revoke a saved token.
          await logoutBarrier;
          const result = await revokeAllSessions(url, bearer, fetcher);
          publish("signed-out", null, result.ok ? undefined : result.why);
          return result;
        } catch (error) {
          publish("signed-out", null, problem(error));
          return { ok: false, why: problem(error) };
        } finally {
          for (const scope of retiring) {
            if (scope.client) void scope.client.signOut().catch(() => {}).finally(() => scopes.delete(scope));
            else revokeRetired(scope.session.token);
          }
          drainRevocations();
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
          if (!session) { publish("signed-out", null); drainRevocations(); return { ok: true }; }
          const result = await open(session, expected, epoch, true);
          drainRevocations();
          return result;
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
