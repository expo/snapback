import { createNativeAuthCustodyStorage } from './custody-module';
import { sha256CryptoObject } from './sha256';

export const nativeCustodyStorage = createNativeAuthCustodyStorage();

// @ref LLP 0258#d3-custody-is-selected-by-capability-never-convenience-fallback
// — the probe injects the one explicitly selected durable adapter; it never
// substitutes memory or SecureStore when native custody is absent.
export function resolveNativeAppClientPlatform(): unknown {
  const globalCrypto = (globalThis as { crypto?: { subtle?: unknown } }).crypto;
  // LANE-A-INTEGRATION: app-client's Phase 2 normalization must admit this
  // kind and adapter key. This file is the sole platform-shape integration
  // point if Lane A lands a different final key spelling.
  return Object.freeze({
    kind: 'expo-native',
    authCustodyStorage: nativeCustodyStorage,
    cryptoObject: globalCrypto?.subtle ? globalCrypto : sha256CryptoObject,
  });
}
