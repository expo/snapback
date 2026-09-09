// Explicit core forwarding preserves ESM star exports across the external module boundary.
// E2: esbuild drops the indirect external star export through react-native.
// Re-export every native component (and hook, such as useAssetFile) by name here
// AND in react-native.tsx; the built-entry parity test protects this list.
export * from "./react-core.js";
export { AssetImage, AssetVideo, useAssetFile, SnapbackProvider } from "./react-native.js";
export type { AssetImageProps, AssetVideoProps, SnapbackProviderProps } from "./react-native.js";
export * from "./expo/index.js";
