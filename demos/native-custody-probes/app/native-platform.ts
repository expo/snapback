import { createNativeAuthCustodyStorage } from './custody-module';
import { sha256CryptoObject } from './sha256';

export const nativeCustodyStorage = createNativeAuthCustodyStorage();

// @ref LLP 0258#d3-custody-is-selected-by-capability-never-convenience-fallback
// — the probe injects the one explicitly selected durable adapter; it never
// substitutes memory or SecureStore when native custody is absent.
export function resolveNativeAppClientPlatform(): unknown {
  const globalCrypto = (globalThis as { crypto?: { subtle?: unknown } }).crypto;
  return Object.freeze({
    kind: 'expo-native',
    authCustodyStorage: nativeCustodyStorage,
    cryptoObject: globalCrypto?.subtle ? globalCrypto : sha256CryptoObject,
  });
}
