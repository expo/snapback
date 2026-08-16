import { createNativeAuthCustodyStorage } from './custody-module';
import { sha256CryptoObject } from './sha256';
import type { SnapbackAppClientPlatform } from '@expo/snapback-client';
import type {
  SnapbackAuthCustodyOwner,
  SnapbackAuthCustodyOwnerKey,
  SnapbackAuthCustodyRecord,
} from '@expo/snapback-contract/auth-coordinator';

const carrier = createNativeAuthCustodyStorage();
const storageCounters = {
  platformGradeCalls: 0,
  ownershipCalls: 0,
  readCalls: 0,
  replaceCalls: 0,
};

async function reportBearer(record: SnapbackAuthCustodyRecord | null) {
  const candidates = [record?.bearer, record?.pendingBearer]
    .filter((value): value is string => typeof value === 'string');
  if (candidates.length === 0) return;
  const report = (globalThis as {
    __nativeCustodyProbeReportSecret?: (
      kind: 'bearer' | 'recovery-code',
      literal: string,
    ) => Promise<void>;
  }).__nativeCustodyProbeReportSecret;
  if (report === undefined) {
    throw Object.assign(new Error('the in-memory secret scanner channel is unavailable'), {
      code: 'SNAPBACK_NATIVE_PROBE_SECRET_SCANNER_UNAVAILABLE',
    });
  }
  await Promise.all(candidates.map((literal) => report('bearer', literal)));
}

export const nativeCustodyStorage = Object.freeze({
  ownerKeyCapability: carrier.ownerKeyCapability,
  async platformGrade() {
    storageCounters.platformGradeCalls += 1;
    return carrier.platformGrade();
  },
  testHooks: carrier.testHooks,
  async withOwnership<T>(
    ownerKey: string | SnapbackAuthCustodyOwnerKey,
    operation: (owner: SnapbackAuthCustodyOwner) => T | Promise<T>,
  ): Promise<T> {
    storageCounters.ownershipCalls += 1;
    return carrier.withOwnership(ownerKey, (owner) => operation(Object.freeze({
      async read() {
        storageCounters.readCalls += 1;
        const record = await owner.read();
        await reportBearer(record);
        return record;
      },
      async replace(
        expectedRevision: number | null,
        next: SnapbackAuthCustodyRecord | Readonly<Record<string, unknown>>,
      ) {
        storageCounters.replaceCalls += 1;
        await reportBearer(next as SnapbackAuthCustodyRecord);
        const record = await owner.replace(expectedRevision, next);
        await reportBearer(record);
        return record;
      },
    })));
  },
});

export function nativeCustodyStorageCounters() {
  return Object.freeze({
    ...storageCounters,
    total: storageCounters.platformGradeCalls
      + storageCounters.ownershipCalls
      + storageCounters.readCalls
      + storageCounters.replaceCalls,
  });
}

// @ref LLP 0258#d3-custody-is-selected-by-capability-never-convenience-fallback
// — the probe injects the one explicitly selected durable adapter; it never
// substitutes memory or SecureStore when native custody is absent.
export function resolveNativeAppClientPlatform(): SnapbackAppClientPlatform {
  const globalCrypto = (globalThis as { crypto?: { subtle?: unknown } }).crypto;
  return Object.freeze({
    kind: 'expo-native',
    authCustodyStorage: nativeCustodyStorage,
    cryptoObject: globalCrypto?.subtle ? globalCrypto : sha256CryptoObject,
  });
}
