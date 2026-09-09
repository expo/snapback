const modules = new Map([
  ["expo-constants", new URL("./expo.mjs", import.meta.url).href],
  ["expo", new URL("./expo.mjs", import.meta.url).href],
  ["react-native", new URL("./react-native.mjs", import.meta.url).href],
  ["expo-video", new URL("./expo-video.mjs", import.meta.url).href],
  ["expo-file-system", new URL("./expo-file-system.mjs", import.meta.url).href],
  ["expo/fetch", new URL("./expo-fetch.mjs", import.meta.url).href],
  ["expo-sqlite", new URL("./expo-sqlite.mjs", import.meta.url).href],
  ["expo-secure-store", new URL("./expo-secure-store.mjs", import.meta.url).href],
]);

export function resolve(specifier, context, nextResolve) {
  const url = modules.get(specifier);
  return url === undefined
    ? nextResolve(specifier, context)
    : { url, shortCircuit: true };
}
