import type { RqsFilesAdapter } from './rqs-store-file.mjs';

export interface NativeRqsFilesProvider {
  readonly files: RqsFilesAdapter;
  readonly directory: string;
  readonly implementation?: string | null;
  readonly randomBytes?: (length: number) => Uint8Array;
}

/** DK-9 degradation fact: which store the ladder resolved and why.
 * Mirrors `client.rqsStoreInfo` (index.d.mts `RqsStoreInfo`). */
export interface DefaultRqsStoreInfo {
  readonly source: 'default' | 'disabled' | string;
  readonly implementation: string | null;
  readonly durable: boolean;
  readonly reason: string | null;
}

/** The runtime envelope resolveDefaultRqsStore actually returns:
 * `{ store, info }` — `store` is null when persistence is disabled. */
export interface DefaultRqsStoreResolution {
  readonly store: unknown;
  readonly info: DefaultRqsStoreInfo;
}

export interface DefaultRqsStoreAppOwnerKey {
  readonly appId: string;
  readonly storagePartition: string;
}

export interface DefaultRqsStoreOwnerPlatform {
  readonly kind: 'browser' | 'expo-web' | 'expo-native';
  readonly indexedDB?: unknown;
  readonly lockManager?: unknown;
}

export interface DefaultRqsStoreMemoryPlatform {
  readonly kind: 'memory';
  readonly indexedDB?: unknown;
  readonly lockManager?: unknown;
}

export type DefaultRqsStoreOptions = Readonly<{
  baseUrl?: string;
  appPlatform: Readonly<DefaultRqsStoreOwnerPlatform>;
  appOwnerKey: Readonly<DefaultRqsStoreAppOwnerKey>;
}> | Readonly<{
  baseUrl?: string;
  appPlatform?: Readonly<DefaultRqsStoreMemoryPlatform> | null;
  appOwnerKey?: Readonly<DefaultRqsStoreAppOwnerKey> | null;
}>;

export declare const DEFAULT_RQS_STORE_RESOLUTION_BRAND: unique symbol;

export declare function brandDefaultRqsStoreResolution<T extends DefaultRqsStoreResolution>(
  resolution: T,
): T;
export declare function isDefaultRqsStoreResolution(value: unknown): boolean;
export declare function registeredNativeRqsFiles(): Readonly<NativeRqsFilesProvider> | null;

export declare function resolveDefaultRqsStore(
  options?: DefaultRqsStoreOptions,
): DefaultRqsStoreResolution;

export declare function registerNativeRqsFiles(
  provider: NativeRqsFilesProvider,
): Readonly<NativeRqsFilesProvider>;

export declare function clearNativeRqsFiles(): void;
