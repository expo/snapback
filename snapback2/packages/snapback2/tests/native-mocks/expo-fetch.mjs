export async function fetch(input, init) {
  return globalThis.__snapbackNative.expoFetch(input, init);
}
