import type { SnapbackAuthCustodyStorage } from './auth-coordinator.mjs';

/**
 * Browser storage for AuthCoordinator: IndexedDB custody with Web Locks
 * ownership and a transactionally fenced lease fallback.
 *
 * Injected platform objects (`indexedDB`, `lockManager`, `cryptoObject`) are
 * typed opaquely so the declaration does not require DOM lib types; pass the
 * ambient browser globals or structurally compatible test doubles.
 */
export function createIndexedDbAuthCustodyStorage(options?: {
  indexedDB?: unknown;
  lockManager?: unknown;
  cryptoObject?: unknown;
  databaseName?: string;
  wallNow?: () => number;
  monotonicNow?: () => number;
}): SnapbackAuthCustodyStorage & {
  readonly ownerKeyCapability: 'owner-key-v1';
  close(): Promise<void>;
};
