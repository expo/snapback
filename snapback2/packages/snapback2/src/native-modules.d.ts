declare module "react-native" {
  import type React from "react";
  export interface LayoutChangeEvent { nativeEvent: { layout: { width: number; height: number } } }
  export interface ImageStyle { width?: number; height?: number; aspectRatio?: number }
  export type StyleProp<T> = T | readonly unknown[] | null | false | undefined;
  export interface ImageProps {
    source?: { uri: string; headers?: Record<string, string> };
    style?: StyleProp<ImageStyle>;
    onLayout?: (event: LayoutChangeEvent) => void;
    accessibilityLabel?: string;
    testID?: string;
  }
  export const Image: React.ComponentType<ImageProps>;
  export interface ViewProps {
    style?: StyleProp<ImageStyle>;
    testID?: string;
  }
  export const View: React.ComponentType<ViewProps>;
  export const PixelRatio: { get(): number };
}

declare module "expo-video" {
  import type React from "react";
  export interface VideoViewProps {
    player?: unknown;
    nativeControls?: boolean;
    style?: unknown;
    testID?: string;
  }
  export const VideoView: React.ComponentType<VideoViewProps>;
  export function useVideoPlayer(source: string | { uri?: string; headers?: Record<string, string> } | null): unknown;
}

declare module "expo-file-system" {
  export class FileSystemFile {
    readonly uri: string;
    readonly size: number;
    readonly type: string;
    arrayBuffer(): Promise<ArrayBuffer>;
    bytes(): Promise<Uint8Array<ArrayBuffer>>;
    slice(start?: number, end?: number, contentType?: string): Blob;
    stream(): ReadableStream<Uint8Array<ArrayBuffer>>;
    text(): Promise<string>;
  }
  export class File extends FileSystemFile implements Blob {
    constructor(uri: string);
  }
}

declare module "expo/fetch" {
  export const fetch: typeof globalThis.fetch;
}
