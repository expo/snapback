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

// A logout can shrink an existing session when quota prevents allocating an
// epoch key. This noncredential value must survive ordinary session cleanup.
export function logoutEpoch(raw: string | null): string | null {
  try {
    const epoch: unknown = raw ? JSON.parse(raw)?.snapback4Logout : undefined;
    return typeof epoch === "string" && /^(0|[1-9][0-9]*)$/.test(epoch) ? epoch : null;
  } catch { return null; }
}

// Session and epoch share one atomic value. Read legacy logout records too.
export function sessionEpoch(raw: string | null): string | null {
  try {
    const value = raw ? JSON.parse(raw) : undefined;
    const epoch: unknown = value?.snapback4Epoch ?? value?.snapback4Logout;
    return typeof epoch === "string" && /^(0|[1-9][0-9]*)$/.test(epoch) ? epoch : null;
  } catch { return null; }
}

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

// @ref LLP 3000.007#20.4 — exit notifications cannot hold up session retirement.
// Publish transport notifications outside every queued local session turn.
// Observing the settled tail is not acquiring the cross-tab lock: callbacks
// may themselves queue work behind another tab's logout without holding it.
export function afterStoreLock(key: string | undefined, work: () => void): void {
  const pending = key === undefined ? undefined : locks.get(key);
  if (!pending) { work(); return; }
  const retry = () => afterStoreLock(key, work);
  void pending.then(retry, retry);
}
