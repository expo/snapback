// @ref LLP 3000.013#6 — displaced sessions stay owned until remote retirement.
import { logout, sessionKey, type SessionStore } from "./auth.ts";
import { StorageWarning } from "./app-storage.ts";

export function sessionRevocations(url: string, store: SessionStore, fetcher: typeof fetch,
  locked: <T>(work: () => Promise<T>) => Promise<T>) {
  const session = sessionKey(url), key = session + ".revocations";
  // If storage is unavailable, this owner retains the obligation until either
  // persistence or remote acknowledgement succeeds. Never discard on an error.
  const deferred = new Set<string>();
  const decode = (bytes: string | null): { token?: string; snapback4Retired?: string[]; snapback4Backend?: string } => {
    try { return JSON.parse(bytes ?? "null") ?? {}; } catch { return {}; }
  };
  const inline = (saved: ReturnType<typeof decode>): string[] => {
    const tokens = saved.snapback4Retired;
    if (tokens === undefined) return [];
    if (saved.snapback4Backend === url && Array.isArray(tokens) && tokens.every(token => typeof token === "string" && token.length > 0)) return tokens;
    throw new StorageWarning({ code: "E_CLIENT", family: "client", site: "app.auth",
      message: "the saved logout retirement record is damaged or belongs to another backend",
      rewrite: "repair sessionStore, then createApp({ url, sessionStore })" });
  };
  async function read(): Promise<string[]> {
    const bytes = await store.get(key);
    if (bytes === null) return [];
    try {
      const value = JSON.parse(bytes) as { backend?: unknown; tokens?: unknown } | null;
      if (value?.backend === url && Array.isArray(value.tokens) && value.tokens.every(token => typeof token === "string" && token.length > 0)) return [...new Set(value.tokens)];
    } catch {}
    throw new StorageWarning({ code: "E_CLIENT", family: "client", site: "app.auth",
      message: "the saved session revocation journal is damaged",
      rewrite: "repair sessionStore, then createApp({ url, sessionStore })" });
  }
  const write = (tokens: string[]) => store.set(key, JSON.stringify({ backend: url, tokens }));
  // Caller holds the session lock. The currently stored token remains protected
  // even if this preparation succeeds and the later account commit fails.
  async function stage(tokens: string[]) {
    const embedded = inline(decode(await store.get(session)));
    if (!tokens.length && !embedded.length) return;
    const saved = await read(), next = [...new Set([...saved, ...embedded, ...tokens])];
    if (next.length !== saved.length) await write(next);
  }
  let draining: Promise<void> = Promise.resolve();
  function drain(): Promise<void> {
    const result = draining.catch(() => {}).then(async () => {
      const tokens = await locked(async () => [...new Set([...deferred, ...await read(),
        ...inline(decode(await store.get(session)))])]);
      for (const token of tokens) {
        let confirmed = false, work: Promise<void> | undefined;
        await locked(async () => {
          // I1: compare on EVERY path, including successful barriers, stale
          // peers, constructor failures, close and background journal replay.
          if (decode(await store.get(session)).token === token) return;
          work = logout(url, token, async (input, init) => {
            const response = await fetcher(input, init);
            const receipt = await response.clone().json() as { ok?: boolean; denied?: { code?: string } } | null;
            confirmed = (response.ok && receipt?.ok === true) || (response.status === 401 && receipt?.denied?.code === "E_AUTH");
            return response;
          });
        });
        await work;
        if (!confirmed) continue;
        deferred.delete(token);
        await locked(async () => {
          const pending = await read(), remaining = pending.filter(value => value !== token);
          if (remaining.length !== pending.length) {
            if (remaining.length) await write(remaining);
            else await store.delete(key);
          }
          const bytes = await store.get(session), saved = decode(bytes);
          if (saved.snapback4Retired?.includes(token)) {
            saved.snapback4Retired = saved.snapback4Retired.filter(value => value !== token);
            await store.set(session, JSON.stringify(saved));
          }
        });
      }
    });
    draining = result;
    return result;
  }
  async function retire(token: string) {
    deferred.add(token);
    try { await locked(() => stage([token])); } catch { /* still owned here */ }
    await drain();
  }
  return { stage, drain, retire, pending: () => [...deferred], embedded: (bytes: string | null) => inline(decode(bytes)) };
}
