import type {
  SnapbackAuthCustodyStorage,
} from '@expo/snapback-contract/auth-coordinator';

export const SNAPBACK_AUTH_CUSTODY_SINGLE_RUNTIME_REFUSED:
  'SNAPBACK_AUTH_CUSTODY_SINGLE_RUNTIME_REFUSED';

export type NativeAuthCustodyPlatformGrade = Readonly<{
  os: 'ios' | 'android';
  grade: 'single-runtime';
  mechanism: string;
  moduleVersion: string;
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
};
