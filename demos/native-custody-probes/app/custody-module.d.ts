import type {
  SnapbackAuthCustodyOwnerKey,
  SnapbackAuthCustodyStorage,
} from '@expo/snapback-contract/auth-coordinator';

export type NativeCustodyPlatformGrade = Readonly<{
  carrier: string;
  grade: 'durable';
  formatVersion: number;
  recoveryAvailable: boolean;
  moduleVersion?: string;
}>;

export type NativeCustodyTestHooks = Readonly<{
  corruptCiphertext?(ownerKey: SnapbackAuthCustodyOwnerKey): Promise<void>;
  deleteKeyAlias?(ownerKey: SnapbackAuthCustodyOwnerKey): Promise<void>;
}>;

export type NativeAuthCustodyStorage = SnapbackAuthCustodyStorage & Readonly<{
  ownerKeyCapability: 'owner-key-v1';
  platformGrade(): NativeCustodyPlatformGrade;
  testHooks?: NativeCustodyTestHooks;
}>;

export function createNativeAuthCustodyStorage(): NativeAuthCustodyStorage;
