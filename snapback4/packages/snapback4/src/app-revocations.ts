// @ref LLP 3000.013#6 — displaced sessions stay owned until remote retirement.
import { logout, logoutAll, sessionKey, type SessionStore } from "./auth.ts";
import type { SessionRevocation } from "./contract.ts";
import { StorageWarning } from "./app-storage.ts";
import { globalFences, mergeFences, type GlobalFence, type SessionOrigin } from "./app-global.ts";

type Journal = { tokens: string[]; all: string[]; fences: GlobalFence[] };
type Saved = { token?: string; snapback4Retired?: string[]; snapback4LogoutAll?: string[]; snapback4GlobalFences?: GlobalFence[]; snapback4Backend?: string };
const unique = (tokens: string[]) => [...new Set(tokens)];
const strings = (tokens: unknown): tokens is string[] => Array.isArray(tokens) && tokens.every(token => typeof token === "string" && token.length > 0);

export function sessionRevocations(url: string, store: SessionStore, fetcher: typeof fetch,
  locked: <T>(work: () => Promise<T>) => Promise<T>) {
  const session = sessionKey(url), key = session + ".revocations";
  // A failed comparison/persistence attempt retains this runtime's obligation.
  const deferred = new Set<string>();
  const origins = new Map<string, SessionOrigin>();
  // A successful global revocation consumes its bearer. Retry storage cleanup,
  // not the already-acknowledged remote operation, after a local failure.
  const acknowledged = new Map<string, { global: boolean; fence?: GlobalFence | undefined }>();
  const decode = (bytes: string | null): Saved => {
    try { return JSON.parse(bytes ?? "null") ?? {}; } catch { return {}; }
  };
  const damaged = () => new StorageWarning({ code: "E_CLIENT", family: "client", site: "app.auth",
    message: "the saved session retirement record is damaged or belongs to another backend",
    rewrite: "repair sessionStore, then createApp({ url, sessionStore })" });
  function inline(saved: Saved): Journal {
    if (saved.snapback4Retired === undefined && saved.snapback4LogoutAll === undefined && saved.snapback4GlobalFences === undefined) return { tokens: [], all: [], fences: [] };
    const tokens = saved.snapback4Retired ?? [], all = saved.snapback4LogoutAll ?? [], fences = saved.snapback4GlobalFences ?? [];
    if (saved.snapback4Backend !== url || !strings(tokens) || !strings(all) || !globalFences(fences)) throw damaged();
    return { tokens, all, fences };
  }
  async function read(): Promise<Journal> {
    const bytes = await store.get(key);
    if (bytes === null) return { tokens: [], all: [], fences: [] };
    try {
      const value = JSON.parse(bytes) as { backend?: unknown; tokens?: unknown; all?: unknown; fences?: unknown } | null;
      if (value?.backend === url && strings(value.tokens) && (value.all === undefined || strings(value.all)) && (value.fences === undefined || globalFences(value.fences))) return { tokens: unique(value.tokens), all: unique(value.all ?? []), fences: value.fences ?? [] };
    } catch {}
    throw damaged();
  }
  const write = (journal: Journal) => store.set(key, JSON.stringify({ backend: url, ...journal }));
  function promote(next: Journal): Journal {
    for (const [token, origin] of origins) {
      const matching = next.fences.filter(value => value.principal === origin.principal && BigInt(value.epoch) > BigInt(origin.epoch));
      const latest = matching.reduce<GlobalFence | undefined>((a, b) => !a || BigInt(b.epoch) > BigInt(a.epoch) ? b : a, undefined);
      if (latest && !latest.complete) {
        latest.tokens = unique([...latest.tokens, token]);
        next.all = unique([...next.all, token]);
      }
    }
    return next;
  }
  // Caller holds the session lock. Moving a tombstone into a new session must
  // preserve global-revocation custody as well as ordinary token retirement.
  async function stage(tokens: string[]) {
    const embedded = inline(decode(await store.get(session)));
    if (!tokens.length && !embedded.tokens.length && !embedded.all.length && !embedded.fences.length) return;
    const saved = await read();
    const next = promote({ tokens: unique([...saved.tokens, ...embedded.tokens, ...tokens]), all: unique([...saved.all, ...embedded.all]), fences: mergeFences(saved.fences, embedded.fences) });
    if (JSON.stringify(next) !== JSON.stringify(saved)) await write(next);
  }
  async function obligations(): Promise<Journal> {
    const saved = await read(), embedded = inline(decode(await store.get(session)));
    const fences = mergeFences(saved.fences, embedded.fences);
    const completed = new Set(fences.filter(value => value.complete).flatMap(value => value.tokens));
    return promote({ tokens: unique([...acknowledged.keys(), ...deferred, ...saved.tokens, ...embedded.tokens]), all: unique([...saved.all, ...embedded.all]).filter(token => !completed.has(token)), fences });
  }
  async function clearAcknowledged(token: string) {
    await locked(async () => {
      const receipt = acknowledged.get(token)?.fence;
      const embedded = inline(decode(await store.get(session)));
      const pending = await read();
      const completed = (fence: GlobalFence) => receipt !== undefined && fence.principal === receipt.principal && BigInt(fence.epoch) <= BigInt(receipt.epoch);
      const retired = new Set([token, ...mergeFences(pending.fences, embedded.fences).filter(completed).flatMap(value => value.tokens)]);
      const finish = (fences: GlobalFence[]) => fences.map(value => completed(value) ? { ...value, tokens: [], complete: true } : { ...value, tokens: value.tokens.filter(token => !retired.has(token)) });
      const next = { tokens: pending.tokens.filter(value => !retired.has(value)), all: pending.all.filter(value => !retired.has(value)), fences: finish(pending.fences) };
      if (JSON.stringify(next) !== JSON.stringify(pending)) {
        if (next.tokens.length || next.all.length || next.fences.length) await write(next); else await store.delete(key);
      }
      const saved = decode(await store.get(session));
      if (saved.snapback4Retired?.some(value => retired.has(value)) || saved.snapback4LogoutAll?.some(value => retired.has(value)) || saved.snapback4GlobalFences?.some(completed)) {
        if (saved.snapback4Retired) saved.snapback4Retired = saved.snapback4Retired.filter(value => !retired.has(value));
        if (saved.snapback4LogoutAll) saved.snapback4LogoutAll = saved.snapback4LogoutAll.filter(value => !retired.has(value));
        if (saved.snapback4GlobalFences) saved.snapback4GlobalFences = finish(saved.snapback4GlobalFences);
        await store.set(session, JSON.stringify(saved));
      }
      for (const value of retired) { deferred.delete(value); origins.delete(value); }
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
        let global = false, confirmed = false, fence: GlobalFence | undefined, work: Promise<unknown> | undefined;
        await locked(async () => {
          // I1: compare on EVERY dispatch, including a successful prior barrier.
          if (decode(await store.get(session)).token === token) return;
          // Another owner may have promoted this token to logout-all after the
          // first read. Ordinary logout must never consume its retry credential.
          // Resolve a late response's generation again on dispatch: the global
          // fence may have committed after its first retirement attempt.
          // A failed journal write cannot prevent retirement of a discarded
          // bearer: the live runtime still owns it. Reads below must succeed.
          try { await stage([...deferred]); } catch { /* retain runtime custody */ }
          const latest = await obligations();
          if (latest.all.includes(token)) {
            global = true;
            fence = latest.fences.find(value => !value.complete && value.tokens.includes(token));
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
        if (confirmed) { acknowledged.set(token, { global, fence }); await acknowledge(token); }
      }
      return outcome;
    });
    draining = result;
    return result;
  }
  async function retire(token: string, origin?: SessionOrigin) {
    deferred.add(token);
    if (origin) origins.set(token, origin);
    try { await locked(() => stage([token])); } catch { /* still owned here */ }
    await drain();
  }
  return { stage, drain, retire, flushAcknowledged, pending: () => [...deferred],
    embedded: (bytes: string | null) => inline(decode(bytes)).tokens,
    global: (bytes: string | null) => inline(decode(bytes)).all,
    fences: (bytes: string | null) => inline(decode(bytes)).fences,
    hasGlobal: () => locked(async () => [...acknowledged.values()].some(value => value.global) || (await obligations()).all.length > 0),
  };
}
