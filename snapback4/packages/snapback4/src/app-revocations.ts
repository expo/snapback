// @ref LLP 3000.013#6 — displaced sessions stay owned until remote retirement.
import { logout, sessionKey, type SessionStore } from "./auth.ts";
import { StorageWarning } from "./app-storage.ts";

export function sessionRevocations(url: string, store: SessionStore, fetcher: typeof fetch,
  locked: <T>(work: () => Promise<T>) => Promise<T>) {
  const key = sessionKey(url) + ".revocations";
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
  // Caller holds the session lock. Save before overwriting the only durable
  // copy of a displaced bearer; failure must leave that session untouched.
  async function stage(tokens: string[]) {
    if (!tokens.length) return;
    const saved = await read(), next = [...new Set([...saved, ...tokens])];
    if (next.length !== saved.length) await write(next);
  }
  let draining: Promise<void> = Promise.resolve();
  function drain(): Promise<void> {
    const result = draining.catch(() => {}).then(async () => {
      const tokens = await locked(async () => {
        const saved = await store.get(sessionKey(url));
        let kept: unknown;
        try { kept = saved ? JSON.parse(saved)?.token : undefined; } catch {}
        return (await read()).filter(token => token !== kept);
      });
      for (const token of tokens) {
        let confirmed = false;
        await logout(url, token, async (input, init) => {
          const response = await fetcher(input, init);
          const receipt = await response.clone().json() as { ok?: boolean; denied?: { code?: string } } | null;
          confirmed = (response.ok && receipt?.ok === true) || (response.status === 401 && receipt?.denied?.code === "E_AUTH");
          return response;
        });
        if (!confirmed) continue;
        await locked(async () => {
          const pending = await read(), remaining = pending.filter(value => value !== token);
          if (remaining.length === pending.length) return;
          if (remaining.length) await write(remaining);
          else await store.delete(key);
        });
      }
    });
    draining = result;
    return result;
  }
  return { stage, drain };
}
