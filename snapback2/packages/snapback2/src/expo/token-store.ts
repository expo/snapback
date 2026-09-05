import * as SecureStore from "expo-secure-store";
import { decodePrincipalBinding } from "../token-store.js";
import type { AuthTokenStore } from "../types.js";

export interface SecureStoreAdapter {
  getItemAsync(key: string): Promise<string | null>;
  setItemAsync(key: string, value: string): Promise<void>;
  deleteItemAsync(key: string): Promise<void>;
}

// @ref LLP 1013#4-locks-the-token-store-and-the-partition — SecureStore keys
// use its legal alphabet; token deletion also deletes the cached principal.
export function expoSecureTokenStore(name = "default", adapter: SecureStoreAdapter = SecureStore): AuthTokenStore {
  if (!/^[A-Za-z0-9._-]+$/.test(name)) throw new TypeError("expoSecureTokenStore name must contain only A-Z, a-z, 0-9, '.', '_', or '-'");
  const keys = { token: `snapback2.${name}.token`, principal: `snapback2.${name}.principal` };
  const cache: Partial<Record<keyof typeof keys, string | null>> = {};
  let tail = Promise.resolve();
  function ordered<T>(body: () => Promise<T>): Promise<T> {
    const result = tail.then(body);
    tail = result.then(() => undefined, () => undefined);
    return result;
  }
  const load = (kind: keyof typeof keys) => ordered(async () => {
    if (cache[kind] === undefined) cache[kind] = await adapter.getItemAsync(keys[kind]);
    return cache[kind]!;
  });
  const save = (kind: keyof typeof keys, value: string | null) => ordered(async () => {
    if (value !== null && new TextEncoder().encode(value).byteLength > 2048) {
      throw new TypeError("expoSecureTokenStore values must fit in 2 KB");
    }
    if (value === null && kind === "token") {
      delete cache.token;
      delete cache.principal;
      const results = await Promise.allSettled(Object.values(keys).map((key) => adapter.deleteItemAsync(key)));
      const failure = results.find((result) => result.status === "rejected");
      if (failure?.status === "rejected") throw failure.reason;
      cache.token = cache.principal = null;
    } else {
      delete cache[kind];
      if (value === null) await adapter.deleteItemAsync(keys[kind]);
      else await adapter.setItemAsync(keys[kind], value);
      cache[kind] = value;
    }
  });
  return { load: () => load("token"), save: (value) => save("token", value),
    loadPrincipal: async () => decodePrincipalBinding(await load("principal"))?.principal ?? null,
    loadPrincipalBinding: async () => decodePrincipalBinding(await load("principal")),
    savePrincipal: async (principal, token) => {
      const boundToken = token ?? await load("token");
      await save("principal", principal === null || boundToken === null ? null : JSON.stringify({ token: boundToken, principal }));
    } };

}
