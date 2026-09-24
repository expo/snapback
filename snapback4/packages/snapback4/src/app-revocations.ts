// @ref LLP 3000.013#6 — displaced sessions stay owned until remote retirement.
import { logout, logoutAll, sessionKey, type SessionStore } from "./auth.ts";
import type { SessionRevocation } from "./contract.ts";
import { StorageWarning } from "./app-storage.ts";

type Journal = { tokens: string[]; all: string[] };
type Saved = { token?: string; snapback4Retired?: string[]; snapback4LogoutAll?: string[]; snapback4Backend?: string };
const unique = (tokens: string[]) => [...new Set(tokens)];
const strings = (tokens: unknown): tokens is string[] => Array.isArray(tokens) && tokens.every(token => typeof token === "string" && token.length > 0);

export function sessionRevocations(url: string, store: SessionStore, fetcher: typeof fetch,
  locked: <T>(work: () => Promise<T>) => Promise<T>) {
  const session = sessionKey(url), key = session + ".revocations";
  // A failed comparison/persistence attempt retains this runtime's obligation.
  const deferred = new Set<string>();
  // A successful global revocation consumes its bearer. Retry storage cleanup,
  // not the already-acknowledged remote operation, after a local failure.
  const acknowledged = new Map<string, boolean>();
  const decode = (bytes: string | null): Saved => {
    try { return JSON.parse(bytes ?? "null") ?? {}; } catch { return {}; }
  };
  const damaged = () => new StorageWarning({ code: "E_CLIENT", family: "client", site: "app.auth",
    message: "the saved session retirement record is damaged or belongs to another backend",
    rewrite: "repair sessionStore, then createApp({ url, sessionStore })" });
  function inline(saved: Saved): Journal {
    if (saved.snapback4Retired === undefined && saved.snapback4LogoutAll === undefined) return { tokens: [], all: [] };
    const tokens = saved.snapback4Retired ?? [], all = saved.snapback4LogoutAll ?? [];
    if (saved.snapback4Backend !== url || !strings(tokens) || !strings(all)) throw damaged();
    return { tokens, all };
  }
  async function read(): Promise<Journal> {
    const bytes = await store.get(key);
    if (bytes === null) return { tokens: [], all: [] };
    try {
      const value = JSON.parse(bytes) as { backend?: unknown; tokens?: unknown; all?: unknown } | null;
      if (value?.backend === url && strings(value.tokens) && (value.all === undefined || strings(value.all))) return { tokens: unique(value.tokens), all: unique(value.all ?? []) };
    } catch {}
    throw damaged();
  }
  const write = (journal: Journal) => store.set(key, JSON.stringify({ backend: url, ...journal }));
  // Caller holds the session lock. Moving a tombstone into a new session must
  // preserve global-revocation custody as well as ordinary token retirement.
  async function stage(tokens: string[]) {
    const embedded = inline(decode(await store.get(session)));
    if (!tokens.length && !embedded.tokens.length && !embedded.all.length) return;
    const saved = await read();
    const next = { tokens: unique([...saved.tokens, ...embedded.tokens, ...tokens]), all: unique([...saved.all, ...embedded.all]) };
    if (next.tokens.length !== saved.tokens.length || next.all.length !== saved.all.length) await write(next);
  }
  async function obligations(): Promise<Journal> {
    const saved = await read(), embedded = inline(decode(await store.get(session)));
    return { tokens: unique([...acknowledged.keys(), ...deferred, ...saved.tokens, ...embedded.tokens]), all: unique([...saved.all, ...embedded.all]) };
  }
  async function clearAcknowledged(token: string) {
    deferred.delete(token);
    await locked(async () => {
      const pending = await read();
      const next = { tokens: pending.tokens.filter(value => value !== token), all: pending.all.filter(value => value !== token) };
      if (next.tokens.length !== pending.tokens.length || next.all.length !== pending.all.length) {
        if (next.tokens.length || next.all.length) await write(next); else await store.delete(key);
      }
      const saved = decode(await store.get(session));
      if (saved.snapback4Retired?.includes(token) || saved.snapback4LogoutAll?.includes(token)) {
        if (saved.snapback4Retired) saved.snapback4Retired = saved.snapback4Retired.filter(value => value !== token);
        if (saved.snapback4LogoutAll) saved.snapback4LogoutAll = saved.snapback4LogoutAll.filter(value => value !== token);
        await store.set(session, JSON.stringify(saved));
      }
    });
    acknowledged.delete(token);
  }
  async function acknowledge(token: string) {
    try { await clearAcknowledged(token); }
    catch { await clearAcknowledged(token); }
  }
  async function flushAcknowledged() {
    // Closing can retire the last live holder of a server acknowledgement.
    // Retry only idempotent local cleanup; never reconsume a global bearer.
    for (const token of acknowledged.keys()) await acknowledge(token);
  }
  let draining: Promise<unknown> = Promise.resolve();
  function drain(): Promise<SessionRevocation> {
    const result = draining.catch(() => {}).then(async (): Promise<SessionRevocation> => {
      const pending = await locked(obligations);
      let outcome: SessionRevocation = { ok: true, revoked: 0 };
      for (const token of unique([...pending.all, ...pending.tokens])) {
        if (acknowledged.has(token)) { await acknowledge(token); continue; }
        let global = false, confirmed = false, work: Promise<unknown> | undefined;
        await locked(async () => {
          // I1: compare on EVERY dispatch, including a successful prior barrier.
          if (decode(await store.get(session)).token === token) return;
          // Another owner may have promoted this token to logout-all after the
          // first read. Ordinary logout must never consume its retry credential.
          if ((await obligations()).all.includes(token)) {
            global = true;
            work = logoutAll(url, token, fetcher).then(result => {
              confirmed = result.ok;
              if (!result.ok) outcome = result;
              else if (outcome.ok) outcome = { ok: true, revoked: outcome.revoked + result.revoked };
            });
          } else {
            work = logout(url, token, async (input, init) => {
              const response = await fetcher(input, init);
              const receipt = await response.clone().json() as { ok?: boolean; denied?: { code?: string } } | null;
              confirmed = (response.ok && receipt?.ok === true) || (response.status === 401 && receipt?.denied?.code === "E_AUTH");
              return response;
            });
          }
        });
        await work;
        if (confirmed) { acknowledged.set(token, global); await acknowledge(token); }
      }
      return outcome;
    });
    draining = result;
    return result;
  }
  async function retire(token: string) {
    deferred.add(token);
    try { await locked(() => stage([token])); } catch { /* still owned here */ }
    await drain();
  }
  return { stage, drain, retire, flushAcknowledged, pending: () => [...deferred],
    embedded: (bytes: string | null) => inline(decode(bytes)).tokens,
    global: (bytes: string | null) => inline(decode(bytes)).all,
    hasGlobal: () => locked(async () => [...acknowledged.values()].some(Boolean) || (await obligations()).all.length > 0),
  };
}
