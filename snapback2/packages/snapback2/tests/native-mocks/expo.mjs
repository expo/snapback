export function requireOptionalNativeModule() { return globalThis.__snapbackNative.memoryVideoMissing ? null : {}; }
export function requireNativeView() {
  return props => globalThis.__snapbackNative.React.createElement("NativeMemoryVideo", props);
}
export default { expoConfig: { extra: {} } };
