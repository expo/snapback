import type { SessionStore } from "snapback4/auth";

/** Pass the expo-secure-store module; no native module is loaded by this adapter. */
export interface SecureStoreLike {
  getItemAsync(key: string): Promise<string | null>;
  setItemAsync(key: string, value: string): Promise<void>;
  deleteItemAsync(key: string): Promise<void>;
}

// Fixed-width UTF-16 units preserve every JS key, including lone surrogates.
// @ref LLP 3000.013#6.9-wave-12-client-recipes — backend and read/full session keys must never collide.
export function secureStoreSessionStore(secureStore: SecureStoreLike): SessionStore {
  const key = (value: string) => "snapback4.session." + Array.from({ length: value.length }, (_, i) => value.charCodeAt(i).toString(16).padStart(4, "0")).join("");
  return {
    get: value => secureStore.getItemAsync(key(value)),
    set: (value, session) => secureStore.setItemAsync(key(value), session),
    delete: value => secureStore.deleteItemAsync(key(value)),
  };
}
