import type { AuthTokenStore } from "./types.js";

/** Adapts explicitly supplied browser storage; the client never selects storage itself. */
export function browserTokenStore(
  storage: Pick<Storage, "getItem" | "setItem" | "removeItem">,
  key: string,
): AuthTokenStore {
  if (!storage || typeof storage.getItem !== "function"
    || typeof storage.setItem !== "function" || typeof storage.removeItem !== "function") {
    throw new TypeError("browserTokenStore requires an explicit Storage implementation");
  }
  if (!key) throw new TypeError("browserTokenStore requires a non-empty key");
  return {
    load: () => storage.getItem(key),
    save: (token) => {
      if (token === null) storage.removeItem(key);
      else storage.setItem(key, token);
    },
    loadPrincipal: () => storage.getItem(`${key}:principal`),
    savePrincipal: (principal) => {
      if (principal === null) storage.removeItem(`${key}:principal`);
      else storage.setItem(`${key}:principal`, principal);
    },
  };
}
