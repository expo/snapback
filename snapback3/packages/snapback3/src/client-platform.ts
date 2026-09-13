import { SnapbackError, type ClientStorage } from './resource/types.js';

/** Host defaults stay outside the browser client graph. A platform entrypoint
 * may provide these only when the application did not explicitly override them. */
// @ref LLP 2000#integration-choices — native dependencies live behind their
// own entrypoint while the portable client retains one lifecycle owner.
export interface ClientPlatformDefaults {
  defaultStorage?: () => ClientStorage;
  fetch?: typeof globalThis.fetch;
  idFactory?: () => string;
}

const storageJobs = new WeakMap<ClientStorage, Promise<void>>();

/** Storage ownership uses the same URL identity as portable requests and the
 * browser's default IndexedDB namespace. */
export function normalizeOwnerUrl(url: string): string { return url.replace(/\/+$/, ''); }

/** Orders clients sharing one adapter instance. Separate adapter instances own
 * their existing subscribe/notification coordination. */
export function storageJob<T>(storage: ClientStorage, run: () => Promise<T>): Promise<T> {
  const result = (storageJobs.get(storage) ?? Promise.resolve()).then(run);
  storageJobs.set(storage, result.then(() => {}, () => {}));
  return result;
}

export function timer(fn: () => void, ms: number): ReturnType<typeof setTimeout> {
  const handle = setTimeout(fn, ms);
  (handle as any).unref?.();
  return handle;
}

/** Create a bounded journal-safe identity without assuming randomUUID exists.
 * Expo supplies expo-crypto here; browsers may use either Web Crypto form. */
export function platformId(factory?: () => string): string {
  let id: unknown;
  if (factory) id = factory();
  else {
    const crypto = globalThis.crypto;
    if (typeof crypto?.randomUUID === 'function') id = crypto.randomUUID();
    else if (typeof crypto?.getRandomValues === 'function') {
      const bytes = crypto.getRandomValues(new Uint8Array(16));
      bytes[6] = (bytes[6]! & 0x0f) | 0x40;
      bytes[8] = (bytes[8]! & 0x3f) | 0x80;
      const hex = [...bytes].map(value => value.toString(16).padStart(2, '0')).join('');
      id = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
    }
  }
  if (typeof id !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(id)) {
    throw new SnapbackError('S3_PLATFORM_ID',
      'A secure 1–128 character identity source is required. Use the Expo entrypoint or provide idFactory.');
  }
  return id;
}
