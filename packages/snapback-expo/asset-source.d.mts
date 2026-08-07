import type {
  AdaptedCommandAssetSource,
  CommandAssetSourceAdapter,
  PlatformCommandAssetSource,
} from '@expo/snapback-client';

export type ExpoPickerAssetSource = PlatformCommandAssetSource;
export interface ExpoFetchResponseLike {
  readonly ok?: boolean;
  readonly status?: number;
  bytes?(): Promise<Uint8Array>;
  arrayBuffer?(): Promise<ArrayBuffer>;
  blob?(): Promise<Blob>;
}

export function resolveExpoFetch(): Promise<typeof globalThis.fetch>;
export function expoAssetFetch(
  ...args: Parameters<typeof globalThis.fetch>
): ReturnType<typeof globalThis.fetch>;

export function createExpoAssetSourceAdapter(options?: Readonly<{
  fetch?: ((uri: string) => Promise<ExpoFetchResponseLike>) | null;
  fallbackFetch?: ((uri: string) => Promise<ExpoFetchResponseLike>) | null;
  readFileBytes?: ((uri: string) => Promise<Uint8Array>) | null;
}>): CommandAssetSourceAdapter;

export const adaptExpoAssetSource: (
  source: ExpoPickerAssetSource,
) => Promise<AdaptedCommandAssetSource>;
