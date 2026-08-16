import type { SnapbackAuthCustodyStorage } from './auth-coordinator.mjs';

/** Structural expo-secure-store surface injected by the application. */
export interface SnapbackSecureStoreModule {
  getItemAsync(key: string, options?: unknown): Promise<string | null>;
  setItemAsync(key: string, value: string, options?: unknown): Promise<void>;
  deleteItemAsync?(key: string, options?: unknown): Promise<void>;
}

export interface SnapbackSecureStoreAuthCustodyOptions {
  /** Passed through to SecureStore reads and writes (for example keychain service options). */
  secureStoreOptions?: unknown;
}

/**
 * Native ordinary-bearer custody for AuthCoordinator. The injected string
 * store cannot carry sender-constrained CryptoKey material and refuses it
 * with `SNAPBACK_AUTH_CUSTODY_STORAGE_FAILED`.
 */
export function createSecureStoreAuthCustodyStorage(
  SecureStore: SnapbackSecureStoreModule,
  options?: SnapbackSecureStoreAuthCustodyOptions,
): SnapbackAuthCustodyStorage & {
  readonly ownerKeyCapability: 'owner-key-v1';
};
