import type {
  SnapbackAuthCustodyStorage,
} from '@expo/snapback-contract/auth-coordinator';

export const SNAPBACK_AUTH_CUSTODY_SINGLE_RUNTIME_REFUSED:
  'SNAPBACK_AUTH_CUSTODY_SINGLE_RUNTIME_REFUSED';

export type NativeAuthCustodyPlatformGrade = Readonly<{
  os: 'ios' | 'android';
  grade: 'single-runtime';
  carrier: string;
  mechanism: string;
  moduleVersion: string;
  storageFormatVersion: number;
}>;

export type NativeAuthCustodyDiagnostic = Readonly<{
  code: string;
  message: string;
  details: Readonly<Record<string, unknown>>;
}>;

export interface SnapbackNativeAuthCustodyModule {
  platformGrade(): Promise<Record<string, unknown>>;
  read(appId: string, storageKey: string): Promise<Record<string, unknown>>;
  compareAndReplace(
    appId: string,
    storageKey: string,
    expectedRevision: number | null,
    serializedRecord: string,
  ): Promise<Record<string, unknown>>;
  /** Debug builds only; Android corrupts the persisted AEAD ciphertext. */
  corruptCiphertext?(
    appId: string,
    storageKey: string,
  ): Promise<Record<string, unknown>>;
}

export interface NativeAuthCustodyStorageOptions {
  /** Test/custom-runtime injection; ordinary Expo applications omit this. */
  nativeModule?: SnapbackNativeAuthCustodyModule;
  /** Receives recoverable custody-absent diagnostics, including Android key loss. */
  onDiagnostic?(diagnostic: NativeAuthCustodyDiagnostic): void;
}

export function createNativeAuthCustodyStorage(
  options?: NativeAuthCustodyStorageOptions,
): SnapbackAuthCustodyStorage & {
  readonly ownerKeyCapability: 'owner-key-v1';
  platformGrade(): Promise<NativeAuthCustodyPlatformGrade>;
  readonly testHooks: Readonly<{
    corruptCiphertext(ownerKey: Readonly<{
      appId: string;
      storagePartition: string;
    }>): Promise<void>;
  }>;
};
