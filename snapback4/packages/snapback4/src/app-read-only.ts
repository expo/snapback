import type { App, AppAuth, AppOptions, AppResult, AuthSnapshot } from "./app.ts";
import type { Client, Refusal, Session, SignIn } from "./contract.ts";
import { prepareClient } from "./client-start.ts";
import { createClient } from "./client.ts";
import { login, signup, guest, sessionKey, memorySessionStore } from "./auth.ts";
import { guardClient } from "./app-client.ts";
import { storeLock, logoutEpoch } from "./app-storage.ts";
import { readOnlyRefusal, verifyReadClient, registerReadCustody } from "./read-only.ts";
import { defaultFetch } from "#fetch";

// @ref LLP 3000.033#1.4 — read custody never constructs retirement, outbox or
// online journal owners. All persistent state stays below the SecureStore-safe .read key.
export function createReadOnlyApp(options: AppOptions): App {
  const url = options.url.replace(/\/$/, ""), key = sessionKey(url, true);
  const store = options.sessionStore ?? memorySessionStore(), fetcher = options.fetch ?? defaultFetch;
  const listeners = new Set<() => void>(), opening = new Map<Client, string>();
  let snapshot: AuthSnapshot = { state: "restoring", viewer: null };
  let closed = false, revision = 0;
  let ownedTokens = new Set<string>();
  let persistence: Promise<unknown> = Promise.resolve();
  let raw: Client = createClient({ url, readOnly: true, fetch: fetcher });
  let current = raw, stop = () => {}, fence = () => {};
  const ended = (): Refusal => ({ code: "E_AUTH", family: "auth", message: "the read session is no longer current" });
  const problem = (error: unknown): Refusal => (error as { why?: Refusal })?.why ?? { code: "E_CLIENT", family: "client", message: String(error) };
  function publish(next: AuthSnapshot) { snapshot = next; for (const listener of listeners) listener(); }
  function persist(work: () => Promise<void>) {
    const pending = persistence.catch(() => {}).then(() => storeLock(key, work));
    persistence = pending;
    return pending;
  }
  async function keptToken() {
    const text = await store.get(key);
    if (!text || logoutEpoch(text) !== null) return undefined;
    try { return (JSON.parse(text) as Session).token; } catch { return undefined; }
  }
  async function open(session: Session, expected: number, restoring: boolean): Promise<SignIn> {
    const prepared = { url, session, readOnly: true, fetch: fetcher,
      ...(options.waitSeconds === undefined ? {} : { waitSeconds: options.waitSeconds }) };
    const { client: candidate, start } = await prepareClient(prepared, () => createClient(prepared));
    opening.set(candidate, session.token);
    const why = await verifyReadClient(candidate);
    if (why || closed || expected !== revision) {
      opening.delete(candidate); await candidate.close();
      return { ok: false, why: why ?? ended() };
    }
    let token = session.token;
    try {
      await persist(async () => {
        if (closed || expected !== revision || (restoring && await keptToken() !== token)) throw { why: ended() };
        await store.set(key, JSON.stringify(candidate.session() ?? session));
        // Logout may have fenced this opener while storage was writing. Delete
        // only its credential, under the same lock, before releasing custody.
        if (closed || expected !== revision) {
          if (await keptToken() === token) await store.delete(key);
          throw { why: ended() };
        }
      });
    } catch (error) { opening.delete(candidate); await candidate.close(); return { ok: false, why: problem(error) }; }
    if (closed || expected !== revision) { opening.delete(candidate); await candidate.close(); return { ok: false, why: ended() }; }
    fence(); stop(); await raw.close();
    if (closed || expected !== revision) { opening.delete(candidate); await candidate.close(); return { ok: false, why: ended() }; }
    opening.delete(candidate); raw = candidate; ownedTokens = new Set([token]);
    const valid = () => !closed && expected === revision && raw === candidate;
    const loseCustody = () => {
      if (!valid()) return;
      ++revision; fence(); stop(); ownedTokens.clear();
      void candidate.close();
      publish({ state: "signed-out", viewer: null, why: ended() });
    };
    const authorized = async () => {
      await persistence;
      if (!valid()) return false;
      const kept = await keptToken();
      if (!valid()) return false;
      if (kept !== token) { loseCustody(); return false; }
      return true;
    };
    const guarded = guardClient(candidate, authorized, valid, ended);
    fence = guarded.fence;
    current = guarded.client;
    const refresh = current.refreshSession;
    current.refreshSession = async () => { const result = await refresh(); await persistence; return result; };
    current.close = close;
    current.signOut = async () => { await auth.logout(); };
    const adoptSession = async (next: Session | null) => {
      const previous = token;
      if (next) ownedTokens.add(next.token);
      try {
        await persist(async () => {
          if (!valid()) return;
          if (await keptToken() !== previous) { loseCustody(); return; }
          if (next) {
            await store.set(key, JSON.stringify(next));
            token = next.token;
            // Consumed predecessors have no custody after this write completes.
            ownedTokens.delete(previous);
          } else await store.delete(key);
        });
      } catch (error) {
        if (valid()) { loseCustody(); publish({ state: "signed-out", viewer: null, why: problem(error) }); }
      }
      if (!next && valid()) { fence(); publish({ state: "signed-out", viewer: null }); }
    };
    registerReadCustody(candidate, adoptSession);
    stop = candidate.onSession(next => { if (!next) void adoptSession(null); });
    publish({ state: "signed-in", viewer: candidate.viewer() });
    await start();
    return { ok: true, session: candidate.session() ?? session };
  }
  async function signIn(work: () => Promise<SignIn>): Promise<SignIn> {
    if (closed) return { ok: false, why: ended() };
    const expected = ++revision;
    fence(); publish({ state: "restoring", viewer: null });
    const result = await work();
    if (closed || expected !== revision) return { ok: false, why: ended() };
    const opened = result.ok ? await open(result.session, expected, false) : result;
    if (!opened.ok && !closed && expected === revision) publish({ state: "signed-out", viewer: null, why: opened.why });
    return opened;
  }
  const auth: AppAuth = {
    get state() { return snapshot.state; }, get viewer() { return snapshot.viewer; }, get why() { return snapshot.why; },
    getSnapshot: () => snapshot,
    onChange(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    signup: (email, password) => signIn(() => signup(url, email, password, { scope: "read" }, fetcher)),
    login: (email, password) => signIn(() => login(url, email, password, { scope: "read" }, fetcher)),
    guest: () => signIn(() => guest(url, { scope: "read" }, fetcher)),
    async logout() {
      if (closed) return { ok: false, why: ended() };
      const tokens = new Set([...ownedTokens, ...opening.values()]), expected = ++revision;
      fence(); stop();
      // raw.signOut revokes only after its own exact-credential verification.
      await Promise.all([raw.signOut(), ...[...opening.keys()].map(client => client.signOut())]);
      await persist(async () => { if (expected === revision && tokens.has(await keptToken() ?? "")) await store.delete(key); });
      if (expected === revision) { ownedTokens.clear(); publish({ state: "signed-out", viewer: null }); }
      return { ok: true };
    },
    logoutEverywhere: async () => ({ ok: false, why: readOnlyRefusal() }),
  };
  async function close() {
    if (closed) return;
    closed = true; ++revision; fence(); stop();
    await Promise.all([raw.close(), ...[...opening.keys()].map(client => client.close())]); opening.clear(); await persistence;
    listeners.clear();
  }
  const ready: Promise<AppResult> = (async () => {
    const expected = revision;
    try {
      const text = await store.get(key);
      if (closed || revision !== expected) return { ok: false, why: ended() };
      if (!text || logoutEpoch(text) !== null) { publish({ state: "signed-out", viewer: null }); return { ok: true }; }
      const session = JSON.parse(text) as Session;
      if (typeof session.token !== "string" || !session.token || typeof session.principal !== "string" || typeof session.expiresAt !== "number") throw { why: ended() };
      const opened = await open(session, expected, true);
      if (!opened.ok && !closed && revision === expected) publish({ state: "signed-out", viewer: null, why: opened.why });
      return opened;
    } catch (error) { const why = problem(error); if (!closed && expected === revision) publish({ state: "signed-out", viewer: null, why }); return { ok: false, why }; }
  })();
  return { auth, ready, get client() { return current; }, mutate: ((...args: Parameters<Client["mutate"]>) => current.mutate(...args)) as Client["mutate"], close };
}
