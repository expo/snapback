import type {
  AdaptedCommandAssetSource,
  PlatformCommandAssetSource,
} from '@expo/snapback-client';

export type ExpoBlobSource = Readonly<{
  readonly size: number;
  readonly name?: string;
  readonly type?: string;
  slice(start?: number, end?: number, contentType?: string): ExpoBlobSource;
} & ({
  arrayBuffer(): Promise<ArrayBuffer>;
  bytes?(): Promise<Uint8Array>;
} | {
  arrayBuffer?(): Promise<ArrayBuffer>;
  bytes(): Promise<Uint8Array>;
})>;
export type ExpoPickerAssetSource = ExpoBlobSource | (PlatformCommandAssetSource & Readonly<{
  file?: ExpoBlobSource | null;
}>);
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
}>): (
  source: ExpoPickerAssetSource,
) => Promise<AdaptedCommandAssetSource>;

export const adaptExpoAssetSource: (
  source: ExpoPickerAssetSource,
) => Promise<AdaptedCommandAssetSource>;
