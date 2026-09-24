import type { Refusal } from "./contract.ts";

// Fixed-width UTF-16 units are injective even for unpaired JS surrogates, and
// the resulting alphabet is accepted unchanged by Expo SecureStore.
const hex = (text: string): string => {
  let encoded = "";
  for (let i = 0; i < text.length; i++) encoded += text.charCodeAt(i).toString(16).padStart(4, "0");
  return encoded;
};
export const storeKey = (kind: "session" | "writes", ...segments: string[]): string =>
  ["snapback4", ...segments.map(hex), kind].join(".");

const locks = new Map<string, Promise<unknown>>();
// The same lock protects each session replacement/deletion and each journal
// transaction across apps and tabs. Other hosts serialize within this runtime.
export function storeLock<T>(key: string, work: () => Promise<T>): Promise<T> {
  const previous = locks.get(key) ?? Promise.resolve();
  const result = previous.catch(() => {}).then(async () => {
    if (globalThis.navigator?.locks) return await globalThis.navigator.locks.request(key, () => work());
    return await work();
  });
  locks.set(key, result);
  void result.finally(() => { if (locks.get(key) === result) locks.delete(key); }).catch(() => {});
  return result;
}

export class StorageWarning extends Error {
  constructor(readonly why: Refusal) { super(why.message); }
}
