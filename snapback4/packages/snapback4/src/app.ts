import { admissionRefusal, browserAdmission, failedAdmission, sessionReader } from "./admission.ts";
import { prepareAdmissionAuthority } from "./admission-authority.ts";
import { mintId } from "./client.ts";
import { defaultFetch } from "#fetch";
// @ref LLP 3000.013#6 — one app owns identity, client lifetimes and pending-write custody.
import { createClient } from "./client.ts";
import { holdClose } from "./closing-responses.ts";
import { waitForCaller } from "./request-wait.ts";
import { prepareClient, waitForRotation } from "./client-start.ts";
import { createLocalClient, type DeviceOpener, type LocalOptions, type LocalClient } from "./local.ts";
import { storeLock, sessionEpoch, StorageWarning } from "./app-storage.ts";
import { assetRetention, type AssetRetention } from "./local-assets.ts";
import { onlineCustody } from "./app-online.ts";
import { guardClient } from "./app-client.ts";
import { sessionRevocations } from "./app-revocations.ts";
import { mergeFences, type SessionOrigin } from "./app-global.ts";
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
  const fetcher = options.fetch ?? defaultFetch;
  const backing = options.sessionStore ?? memorySessionStore();
  const storage: SessionStore = { set: (key, value) => backing.set(key, value), delete: key => backing.delete(key), async get(key) {
    const bytes = await backing.get(key);
    if (key === sessionKey(url)) {
      const observed = sessionEpoch(bytes);
      if (observed !== null) observeEpoch(observed);
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
  // I6: hide the public view before client retirement can notify observers.
  // I7: known refusal conditionally tombstones its bearer before later opens;
  // its consumed predecessor is also refused; unrelated successors are preserved.
  // I8: hiding permanently fences exposed facades; raw retry custody is private.
  // I9: global logout fences a principal/generation; a late rotation inherits
  // that obligation. Only a successful logout-all acknowledges global removal.
  // I10: retirement receipts cover their dispatch snapshot, never later tokens.
  // I11: global selection may adopt a peer rotation only in the caller's epoch.
  // I12: fencing stops new dispatches, never rewrites a dispatched outcome.
  // See CLIENT-AND-OPERATIONS.md, session state-machine invariants.
  const epochKey = sessionKey(url) + ".epoch";
  const readEpoch = async () => {
    const marker = (await storage.get(epochKey)) ?? "0";
    const tombstone = sessionEpoch(await storage.get(sessionKey(url))) ?? "0";
    const epoch = BigInt(marker) > BigInt(tombstone) ? marker : tombstone;
    observeEpoch(epoch);
    return epoch;
  };
  const captureEpoch = () => persist(() => storeLock(sessionKey(url), readEpoch));
  const revocations = sessionRevocations(url, storage, fetcher, work => persist(() => storeLock(sessionKey(url), work)));
  let logoutBarrier: Promise<void> = Promise.resolve();
  const revokeRetired = (token: string, origin?: SessionOrigin) => { void revocations.retire(token, origin).catch(report); };
  // Replacement and deletion share one lock across tabs. A server refusal
  // only owns its rejected token, never a successor kept by another runtime.
  const removeSession = (expectedToken?: string | readonly string[], restoring = false, global?: { session: Session; epoch: string; consumed?: string | undefined }) => persist(() => storeLock(sessionKey(url), async () => {
    const commit = async () => {
      const text = await storage.get(sessionKey(url));
      let token: string | undefined, kept: Session | undefined;
      try { kept = text ? JSON.parse(text) : undefined; if (typeof kept?.token === "string") token = kept.token; } catch {}
      // Choose under the same lock as the fence. A peer may have saved a
      // successor; our raw client may instead own a newer, unpersisted one.
      if (global && token && kept?.principal !== global.session.principal) throw new SessionEpochChanged();
      if (global) {
        // Already inside the session lock: read directly, without reentering
        // retirement's lock. Completed fences survive in the journal after a
        // new login removes the tombstone. Only this principal's fences count.
        const fences = mergeFences(revocations.fences(text),
          revocations.journalFences(await storage.get(sessionKey(url) + ".revocations")));
        if (fences.some(value => value.principal === global.session.principal && BigInt(value.epoch) > BigInt(global.epoch))) throw new SessionEpochChanged();
        // A replacement can also commit while this operation waits for its
        // rotation. Compare that session's committed scope, not readEpoch's
        // shared/legacy counter, which can advance for another principal.
        if (token && BigInt(sessionEpoch(text) ?? "0") > BigInt(global.epoch)) throw new SessionEpochChanged();
      }
      const globalToken = global ? (token && token !== global.consumed ? token : global.session.token) : undefined;
      if (expectedToken !== undefined && !(typeof expectedToken === "string" ? [expectedToken] : expectedToken).includes(token ?? "")) {
        if (restoring) throw new RestorationChanged();
        return;
      }
      const currentEpoch = await readEpoch();
      const epoch = (BigInt(currentEpoch) + 1n).toString();
      // The tombstone is the single durable logout commit. It carries retirement
      // custody too, so a quota failure cannot split the fence from the bearer.
      const retired = revocations.embedded(text);
      const all = [...new Set([...revocations.global(text), ...(globalToken ? [globalToken] : [])])];
      const fences = mergeFences(revocations.fences(text), global && globalToken ? [{ principal: global.session.principal, epoch, tokens: [globalToken] }] : []);
      await storage.set(sessionKey(url), JSON.stringify({ snapback4Logout: epoch, snapback4Backend: url,
        snapback4Retired: [...new Set([...retired, ...revocations.pending(), ...(token ? [token] : [])])].filter(token => !all.includes(token)),
        ...(all.length ? { snapback4LogoutAll: all } : {}), ...(fences.length ? { snapback4GlobalFences: fences } : {}) }));
    };
    try { await commit(); }
    catch (error) {
      // A known server refusal cannot be treated as a recoverable session.
      // Retry one failed storage operation while retaining the same lock; a
      // second failure is reported and must never authorize local data access.
      if (expectedToken === undefined || global || error instanceof RestorationChanged) throw error;
      await commit();
    }
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
  const anonymous = () => {
    const client = createClient({ url, fetch: fetcher });
    if (browserAdmission()) client.mutate = (_op, _args, options) => failedAdmission(options?.id ?? mintId(),
      admissionRefusal("session restoration or sign-in is incomplete; mutation was not admitted", "app.mutate", "await app.ready; await app.auth.login(email, password); retry with the same id"));
    return client;
  };
  let current = anonymous();
  type Scope = { valid: boolean; sealing?: boolean; waitRotation?: () => Promise<void>; epoch: string; session: Session; consumed?: string | undefined; issued: Set<string>; aborter: AbortController; client?: Client; view?: Client; expose?: () => Client; fenceView?: () => () => void; save?: () => Promise<void>; logout?: Promise<void>; stop(): void; pause(): void };
  const scopes = new Set<Scope>();
  let owner: (Scope & { client: Client }) | undefined;
  let operations: Promise<unknown> = Promise.resolve();
  let closed = false;
  const closeWaits = new AbortController();
  let revision = 0;
  let cancelSignIn: (() => void) | undefined;
  let recoveryAbort: AbortController | undefined;
  const publish = (state: AuthState, viewer: Principal | null, why?: Refusal) => {
    snapshot = { state, viewer, ...(why ? { why } : {}) };
    for (const listener of listeners) { try { listener(); } catch (error) { console.error("snapback4 auth listener:", error); } }
  };
  const report = (error: unknown) => publish(snapshot.state, snapshot.viewer, problem(error));
  const reportResult = (result: SessionRevocation) => { if (!result.ok) report(new StorageWarning(result.why)); };
  const drainRevocations = () => { void revocations.drain().then(reportResult).catch(report); };
  const enqueue = <T>(work: () => Promise<T>) => {
    const result = operations.catch(() => {}).then(work);
    operations = result;
    return result;
  };
  const inactive = (): Extract<SignIn, { ok: false }> => ({ ok: false, why: { code: "E_CLOSED", family: "client", message: "this app operation was superseded", site: "app.auth", rewrite: "await app.auth.login(email, password)" } });
  const hide = (state: AuthState = "signed-out", pause = true) => {
    if (pause) owner?.pause();
    const notifyHidden = [...scopes].map(scope => scope.fenceView?.());
    if (current !== owner?.view) void current.close();
    current = anonymous();
    publish(closed ? "signed-out" : state, null);
    for (const notify of notifyHidden) notify?.();
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
      for (const token of previous.issued) revokeRetired(token, { principal: previous.session.principal, epoch: previous.epoch });
    }
  }
  function observeEpoch(epoch: string) {
    // A provisional owner does not replace the rollback candidate's duty to
    // observe the shared epoch. Fence every older scope before any callback.
    fenceScopes([...scopes].filter(scope => scope.valid && BigInt(epoch) > BigInt(scope.epoch)), new SessionEpochChanged());
  }
  function fence(scope: Scope, error: SessionEpochChanged) {
    fenceScopes([scope], error);
  }
  function fenceScopes(stale: Scope[], error: SessionEpochChanged) {
    for (const scope of stale) scope.valid = false;
    const affected = owner && stale.includes(owner) ? owner : undefined;
    const expected = revision;
    // Publish before raw retirement emits client callbacks, with every rollback
    // candidate already invalid. Auth and client observers share this boundary.
    if (affected && !closed) hide("restoring");
    for (const scope of stale) {
      scope.pause(); scope.stop(); scope.aborter.abort();
      if (scope.client) void scope.client.signOut().catch(() => {});
    }
    if (!affected || closed) return;
    void enqueue(async () => {
      if (owner !== affected) return;
      await release();
      if (revision === expected) publish("signed-out", null, error.why);
    }).catch(report);
  }
  async function open(session: Session, expected: number, epoch: string, restoring = false): Promise<SignIn> {
    if (closed || revision !== expected) { revokeRetired(session.token); return inactive(); }
    const previous = owner, previousVisible = snapshot.state === "signed-in";
    hide("restoring", false);
    // Keep the prior runtime's rotations and pending-write custody alive until
    // commit. A failed replacement must not repair, revoke or detach it.
    // Every opener owns its persistence, including before it returns a Client.
    // Logout invalidates this guard synchronously, ahead of any network work.
    const scope: Scope = { valid: true, epoch, session, issued: new Set([session.token]), aborter: new AbortController(), stop() {}, pause() {} };
    const retire = (token: string) => revokeRetired(token, { principal: session.principal, epoch: scope.epoch });
    const cancelled = (): SignIn => {
      // A peer can fence this provisional scope before it becomes owner.
      // The still-current auth operation must finish cleanup/publication (or
      // retry restoration), rather than return with its view left restoring.
      if (!scope.valid && !closed && revision === expected) throw restoring ? new RestorationChanged() : new SessionEpochChanged();
      return inactive();
    };
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
          retire(next.token);
          const error = new SessionEpochChanged(); fence(scope, error);
          throw restoreToken !== undefined ? new RestorationChanged() : error;
        }
        if (restoreToken !== undefined && kept?.token !== restoreToken) {
          if (next.token !== scope.session.token && next.token !== kept?.token) retire(next.token);
          throw new RestorationChanged();
        }
        // Constructors can write/rotate several times. These saves are private
        // until their final successful opening; no durable account is displaced.
        if (preparing && !committing) { scope.session = next; return; }
        const replacing = preparing && !restoring;
        if (!replacing && kept?.token && kept.token !== scope.session.token && kept?.token !== next.token) {
          retire(next.token);
          const error = new SessionEpochChanged(); fence(scope, error);
          throw restoreToken !== undefined ? new RestorationChanged() : error;
        }
        if (replacing) await revocations.stage([...(kept?.token ? [kept.token] : []), ...revocations.pending()].filter(token => token !== next.token));
        const nextEpoch = replacing && kept?.token && kept.token !== next.token ? (BigInt(epoch) + 1n).toString() : epoch;
        // I2/I5: no separate epoch write and no fallible opening after this set.
        if (kept?.token !== next.token || replacing) await storage.set(key, JSON.stringify({ ...next, snapback4Epoch: nextEpoch, snapback4Backend: url }));
        epoch = nextEpoch; scope.epoch = nextEpoch; scope.session = next; scope.consumed = undefined;
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
    function admit(): Refusal | undefined {
      if (!options.device) return admissionRefusal("this browser app has no durable web device", "app.mutate", "createApp({ url, device: webDevice(), sessionStore: localStorageSessionStore() })");
      const read = sessionReader(backing);
      if (!read) return admissionRefusal("the session store cannot be checked synchronously", "app.mutate", "use localStorageSessionStore() on the web, then retry with the same id");
      try {
        const marker = read(epochKey) ?? "0";
        const stored = sessionEpoch(read(sessionKey(url))) ?? "0";
        const currentEpoch = BigInt(marker) > BigInt(stored) ? marker : stored;
        // An unlocked observation may catch our own session commit before its
        // in-memory epoch assignment. Confirm under the lock before fencing.
        if (!scope.valid || currentEpoch !== epoch) {
          void authorized().catch(() => {});
          return new SessionEpochChanged().why;
        }
      } catch (error) { return admissionRefusal(`session storage is unavailable: ${String(error)}`, "app.mutate"); }
      return undefined;
    }
    const scopedFetch: typeof fetch = async (input, init) => {
      // Cancel backend acquisition before a local Client exists. Once open,
      // the client owns cancellation and late rotation revocation itself.
      const path = new URL(typeof input === "string" || input instanceof URL ? input : input.url).pathname;
      if (path === new URL(url + "/auth/logout").pathname) {
        const headers = new Headers(init?.headers ?? (typeof input === "string" || input instanceof URL ? undefined : input.headers));
        const token = headers.get("authorization")?.match(/^Bearer (.+)$/i)?.[1];
        await scope.logout?.catch(() => {});
        if (token) await revocations.retire(token, { principal: session.principal, epoch: scope.epoch });
        return Response.json({ ok: true });
      }
      if (scope.sealing && path === new URL(url + "/auth/refresh").pathname) throw new Error("global logout is selecting its retry credential");
      if (!await authorized()) return Response.json({ denied: new SessionEpochChanged().why }, { status: 401 });
      // The epoch check awaits storage. A concurrent response can retire this
      // store while it waits; never dispatch a fresh request through that gap.
      if (changedStore && !path.startsWith("/auth/")) return Response.json({ denied: changedStore });
      if (init?.signal?.aborted) throw init.signal.reason ?? new Error("request was cancelled");
      if (!scope.valid && !path.startsWith("/auth/")) throw new Error("app opener was cancelled");
      if (path !== "/schema") {
        const response = await fetcher(input, init);
        if (path === new URL(url + "/auth/refresh").pathname) {
          try {
            const issued = (await response.clone().json() as { session?: Session }).session;
            if (issued?.token) {
              scope.issued.add(issued.token);
              // Record only the known consumed kept predecessor, not arbitrary
              // tokens from a failed save or another runtime's successor.
              const prior = new Headers(init?.headers).get("authorization")?.slice(7);
              if (issued.principal === scope.session.principal && prior === scope.session.token) scope.consumed = prior;
              if (!scope.valid) retire(issued.token);
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
    let notifyPublished: ((published: Client) => void) | undefined;
    // Native host observers must not adopt a restoration candidate that can
    // still be discarded when its rotated session is persisted.
    const device = options.device && { open: async (...args: Parameters<DeviceOpener["open"]>) => {
      const core = await options.device!.open(...args);
      const notify = core.onClient?.bind(core);
      if (notify) core.onClient = (client, origin) => {
        let stop: void | (() => void);
        notifyPublished = published => { stop = notify(published as LocalClient, origin); };
        return () => stop?.();
      };
      return core;
    } };
    let custody: Awaited<ReturnType<typeof onlineCustody>> | undefined;
    let changedStore: Refusal | undefined;
    let recovering = false;
    let retirement: Promise<void> | undefined;
    const recoverStore = () => {
      if (!changedStore || !custody) return;
      // Retire intents even when another auth operation has superseded this
      // owner. No later sign-in may replay them against the replacement.
      if (!retirement) {
        retirement = custody.refuseStore(changedStore);
        void retirement.catch(error => { if (scope.valid && owner === scope) report(error); });
      }
      if (changedStore.code !== "E_STORE_REPLACED" || recovering || owner !== scope || !scope.valid || closed || revision !== expected) return;
      recovering = true;
      const retired = retirement;
      hide("restoring");
      void enqueue(async () => {
        await retired;
        if (owner !== scope || closed || revision !== expected) return;
        await release();
        if (closed || revision !== expected) return;
        const restored = await restore();
        if (closed || revision !== expected) return;
        if (!restored.session) { publish("signed-out", null); return; }
        // Reuse the kept session only if the replacement backend accepts it.
        recoveryAbort = scope.aborter;
        const response = await fetcher(url + "/probe", { headers: { authorization: `Bearer ${restored.session.token}` }, signal: scope.aborter.signal });
        const json = await response.json() as { ok?: boolean; denied?: Refusal };
        if (closed || revision !== expected) return;
        if (!response.ok || json.ok !== true) {
          if (json.denied?.code === "E_AUTH") await removeSession(restored.session.token);
          if (revision === expected) publish("signed-out", null, json.denied ?? { code: "E_OFFLINE", family: "link", message: "the replacement backend is unreachable", retryable: true });
          return;
        }
        await open(restored.session, expected, restored.epoch, true);
      }).catch(error => { if (!closed && revision === expected) publish("signed-out", null, problem(error)); })
        .finally(() => { if (recoveryAbort === scope.aborter) recoveryAbort = undefined; });
    };
    try {
      await keepSession(url, session, scopedStore);
      if (!scope.valid || revision !== expected) return cancelled();
      if (options.device) {
        // Preserve all local tuning while retaining app-owned identity, even
        // when an untyped caller supplies lower-level sign-in options.
        const { persona: _persona, guest: _guest, ...localOptions }: LocalOptions = { ...options, device: device! };
        const prepared = { ...localOptions, assets: assets!, url, session, sessionStore: scopedStore, fetch: scopedFetch };
        const read = sessionReader(backing);
        if (browserAdmission() && read) prepareAdmissionAuthority(prepared, {
          capture: () => ({ key: sessionKey(url), epoch, principal: scope.session.principal }), read,
        });
        const local = await prepareClient(prepared, () => createLocalClient(prepared));
        raw = local.client; startClient = local.start;
      } else {
        const prepared = { url, session, fetch: scopedFetch, onStoreChange: (why: Refusal) => { changedStore = why; recoverStore(); } };
        const online = await prepareClient(prepared, () => createClient(prepared));
        raw = online.client; startClient = online.start;
      }
      scope.client = raw;
      scope.waitRotation = () => waitForRotation(raw!);
      scope.save = async () => { const next = raw?.session(); if (next) await keepSession(url, next, scopedStore); };
      if (!scope.valid || closed || revision !== expected) {
        if (scope.valid && closed) await raw.close();
        else void raw.signOut().catch(() => {});
        return cancelled();
      }
      let lastSession = raw.session() ?? session;
      const stopSession = raw.onSession(next => {
        if (next) {
          lastSession = next;
          // The local client already saves through scopedStore before this
          // notification. A second save could commit a rotation after its
          // own save failed, while refreshSession still reports that failure.
          if (!options.device) void keepSession(url, next, scopedStore).catch(error => { if (scope.valid) report(error); });
        } else if (scope.valid) {
          const rejected = lastSession.token;
          const rejectionRevision = revision;
          scope.valid = false;
          // Refusal deletion cannot queue behind a held sign-in response.
          // A rollback candidate owns this duty even while another scope opens.
          const clearing = removeSession([rejected, ...(scope.consumed ? [scope.consumed] : [])]);
          if (owner === scope) hide("restoring");
          void clearing.catch(report);
          void enqueue(async () => {
            if (owner !== scope) return;
            let warning: Refusal | undefined;
            try { await clearing; await release(); await scope.logout; }
            catch (error) { warning = problem(error); }
            if (revision === rejectionRevision) publish("signed-out", null, warning);
          }).catch(report);
        }
      });
      // Lower-level clients notify viewer/link/acquisition loss before their
      // asynchronous session cleanup completes. Hide the app view first, so
      // subscribers never observe signed-in paired with a dead client (I6).
      const hideLostView = () => {
        if (owner === scope && current === scope.view && !raw!.viewer()) hide("restoring");
      };
      const stops = [stopSession, raw.onViewer(hideLostView), raw.onLink(hideLostView), raw.onAcquired(hideLostView)];
      scope.stop = () => { for (const stop of stops) stop(); };
      let warning: Refusal | undefined;
      custody = options.device ? undefined : await onlineCustody(raw, url, storage, error => {
        warning = problem(error);
        if (scope.valid) report(error);
      }, false);
      recoverStore();
      const baseClient = custody?.client ?? raw;
      scope.expose = () => {
        const guarded = guardClient(baseClient, authorized, () => scope.valid, () => changedStore ?? new SessionEpochChanged().why, () => retirement, admit);
        const client = guarded.client;
        scope.view = client; scope.fenceView = guarded.fence;
        const exposed = () => owner === scope && current === client;
        // Revoked facades cannot alter the private retry/rollback owner either.
        client.close = () => exposed() ? closeApp() : Promise.resolve();
        client.signOut = async () => { if (exposed()) await auth.logout(); };
        client.logoutAll = () => exposed() ? auth.logoutEverywhere()
          : Promise.resolve({ ok: false, why: new SessionEpochChanged().why });
        return client;
      };
      const client = scope.expose();
      if (!scope.valid || closed || revision !== expected) {
        custody?.pause();
        if (scope.valid && closed) await baseClient.close();
        else void baseClient.signOut().catch(() => {});
        return cancelled();
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
      recoverStore();
      if (scope.valid && current === client) notifyPublished?.(client);
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
        owner = previous;
        if (previousVisible) {
          current = previous.expose!();
          publish("signed-in", previous.client.viewer(), problem(error));
        } else hide();
      }
      throw error;
    } finally {
      if (owner !== scope) { scope.stop(); await persistence.catch(() => {}); scope.valid = false; scopes.delete(scope); if (preparing) for (const token of scope.issued) retire(token); }
    }
  }

  const signIn = (work: () => Promise<SignIn>): Promise<SignIn> => {
    if (closed) return Promise.resolve(inactive());
    cancelSignIn?.();
    const cancelled = new Promise<null>(resolve => { cancelSignIn = () => resolve(null); });
    const expected = ++revision;
    recoveryAbort?.abort();
    return enqueue(async () => {
      if (closed || revision !== expected) return inactive();
      try {
        if (configurationError) throw configurationError;
        const epoch = await captureEpoch();
        if (closed || revision !== expected) return inactive();
        // Cancel only this wait. A committed login/guest response still owns
        // a bearer, which must be read and revoked if this opener was retired.
        const request = work();
        const result = await Promise.race([request, cancelled]);
        if (!result) {
          void request.then(late => { if (late.ok) revokeRetired(late.session.token); });
          return inactive();
        }
        if (closed || revision !== expected) {
          if (result.ok) revokeRetired(result.session.token);
          return inactive();
        }
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
      cancelSignIn?.();
      const expected = ++revision;
      recoveryAbort?.abort();
      hide(closed ? "signed-out" : "restoring");
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
      if (closed) return Promise.resolve(inactive());
      const expected = ++revision;
      return enqueue(async () => {
        if (closed || revision !== expected) return inactive();
        const selected = owner;
        try {
          if (selected) {
            // Block new rotations, but let the one already dispatched adopt
            // and persist its successor before selecting the global bearer.
            selected.sealing = true;
            await waitForCaller(selected.waitRotation?.() ?? Promise.resolve(), closeWaits.signal);
            if (closed || revision !== expected || owner !== selected || !selected.valid) return inactive();
            const session = selected.client.session();
            if (!session) return inactive();
            // The tombstone privately owns the global retry credential. Normal
            // retirement must not consume it if logout-all is offline/refused.
            logoutBarrier = removeSession(undefined, false, { session, epoch: selected.epoch, consumed: selected.consumed });
            await logoutBarrier;
            for (const scope of scopes) {
              scope.logout = logoutBarrier; scope.valid = false; scope.pause(); scope.stop(); scope.aborter.abort();
            }
            owner = undefined;
            // The durable fence hides this view even if a later auth action is
            // queued. That action has not opened its replacement yet (I6).
            hide();
            for (const scope of scopes) {
              if (scope.client) void scope.client.signOut().catch(() => {}).finally(() => scopes.delete(scope));
              else revokeRetired(scope.session.token);
            }
          } else {
            if (revision === expected) hide();
            if (!await revocations.hasGlobal()) return { ok: false, why: { code: "E_AUTH", family: "auth", message: "sign in to revoke sessions", site: "app.auth.logoutEverywhere", rewrite: "await app.auth.login(email, password)" } };
          }
          // Close detaches this network wait; drain still owns its late acknowledgement.
          const result = await waitForCaller(revocations.drain(), closeWaits.signal) ?? inactive();
          if (revision === expected && !closed) reportResult(result);
          return result;
        } catch (error) {
          if (revision === expected && !closed) {
            // Before commit the stored account and its public facade remain
            // valid. Report the failure without announcing a logout.
            report(error);
          }
          return { ok: false, why: problem(error) };
        } finally { if (selected?.valid) selected.sealing = false; }
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
  let closingApp: Promise<void> | undefined;
  function closeApp(): Promise<void> {
    if (closingApp) return closingApp;
    let resolve!: () => void, reject!: (error: unknown) => void;
    closingApp = new Promise<void>((done, fail) => { resolve = done; reject = fail; });
    const finish = [...scopes].map(scope => holdClose(scope.client));
    cancelSignIn?.(); recoveryAbort?.abort();
    closed = true; closeWaits.abort(); ++revision; hide();
    void enqueue(async () => {
      await release(); await current.close();
      await revocations.flushAcknowledged().catch(report);
      listeners.clear();
    }).then(() => { for (const release of finish) release(); resolve(); },
      error => { for (const release of finish) release(); reject(error); });
    return closingApp;
  }
  return {
    auth, ready,
    get client() { return current; },
    mutate: (op, args, options) => current.mutate(op, args, options),
    close: closeApp,
  };
}
