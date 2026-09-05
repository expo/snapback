import type { AuthTokenStore } from "./types.js";

/** A principal is useful before authentication only alongside the bearer that established it. */
export function decodePrincipalBinding(value: string | null): { token: string; principal: string } | null {
  if (value === null) return null;
  try {
    const binding = JSON.parse(value);
    return binding && typeof binding.token === "string" && typeof binding.principal === "string"
      ? { token: binding.token, principal: binding.principal } : null;
  } catch { return null; }
}

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
    loadPrincipal: () => decodePrincipalBinding(storage.getItem(`${key}:principal`))?.principal ?? null,
    loadPrincipalBinding: () => decodePrincipalBinding(storage.getItem(`${key}:principal`)),
    savePrincipal: (principal, token) => {
      const boundToken = token ?? storage.getItem(key);
      if (principal === null || boundToken === null) storage.removeItem(`${key}:principal`);
      else storage.setItem(`${key}:principal`, JSON.stringify({ token: boundToken, principal }));
    },
  };
}
