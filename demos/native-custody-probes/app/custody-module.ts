import type { SnapbackAuthCustodyStorage } from '@expo/snapback-contract/auth-coordinator';

type NativeAuthCustodyStorage = SnapbackAuthCustodyStorage & Readonly<{
  ownerKeyCapability: 'owner-key-v1';
  platformGrade(): Readonly<{
    carrier: string;
    grade: 'durable';
    formatVersion: number;
    recoveryAvailable: boolean;
    moduleVersion?: string;
  }>;
  testHooks?: Readonly<{
    corruptCiphertext?(ownerKey: Readonly<{ appId: string; storagePartition: string }>): Promise<void>;
    deleteKeyAlias?(ownerKey: Readonly<{ appId: string; storagePartition: string }>): Promise<void>;
  }>;
}>;

const unavailable = () => {
  const error = new Error(
    'Lane A package packages/snapback-expo-custody is not present. Replace the import indirection in custody-module.ts.',
  ) as Error & { code: string; diagnostic: Readonly<Record<string, unknown>> };
  error.code = 'SNAPBACK_AUTH_CUSTODY_NATIVE_MODULE_UNAVAILABLE';
  error.diagnostic = Object.freeze({
    schemaVersion: 'snapback.client-diagnostic.v1',
    code: error.code,
    severity: 'error',
    message: 'The native custody proof requires the Lane A custody module.',
    details: Object.freeze({ integrationFile: 'app/custody-module.ts' }),
  });
  return error;
};

// LANE-A-INTEGRATION: replace this local implementation with this one line:
// export { createNativeAuthCustodyStorage } from '@expo/snapback-expo-custody';
export function createNativeAuthCustodyStorage(): NativeAuthCustodyStorage {
  return Object.freeze({
    ownerKeyCapability: 'owner-key-v1' as const,
    platformGrade() {
      return Object.freeze({
        carrier: 'lane-a-module-unavailable',
        grade: 'durable' as const,
        formatVersion: 0,
        recoveryAvailable: false,
        moduleVersion: 'unavailable-shim',
      });
    },
    async withOwnership() {
      throw unavailable();
    },
  });
}
