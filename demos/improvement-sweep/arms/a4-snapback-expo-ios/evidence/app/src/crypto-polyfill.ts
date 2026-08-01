// FINDING (0137-a1expo): the packaged @expo/snapback-client 0.1.7 requires
// WebCrypto — crypto.getRandomValues (mutation identity), crypto.randomUUID
// (provider/store ids), and crypto.subtle.digest('SHA-256') (react-binding
// manifest digests) — but React Native/Hermes provides no globalThis.crypto
// at all, so the documented Expo path dies at prepareReactBinding with
// "Cannot read property 'subtle' of undefined". Neither the Expo guide page
// nor the package documents a polyfill requirement. This app-authored shim
// (expo-crypto-backed, digest-only subtle) is the minimal consumer
// workaround; it must be imported before any Snapback module.
import * as ExpoCrypto from 'expo-crypto';

type TypedArray = Uint8Array | Int8Array | Uint16Array | Int16Array | Uint32Array | Int32Array | Uint8ClampedArray;

const toBytes = (data: ArrayBuffer | TypedArray | DataView): Uint8Array => {
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  return new Uint8Array(data.buffer as ArrayBuffer, data.byteOffset, data.byteLength);
};

const subtle = {
  digest: async (algorithm: string | { name?: string }, data: ArrayBuffer | TypedArray | DataView): Promise<ArrayBuffer> => {
    const name = typeof algorithm === 'string' ? algorithm : algorithm?.name;
    if (name !== 'SHA-256') {
      throw new Error(`crypto-polyfill: unsupported digest algorithm ${String(name)}`);
    }
    return await ExpoCrypto.digest(ExpoCrypto.CryptoDigestAlgorithm.SHA256, toBytes(data) as unknown as BufferSource);
  },
};

const cryptoLike = {
  getRandomValues: <T extends TypedArray>(array: T): T => ExpoCrypto.getRandomValues(array),
  randomUUID: (): string => ExpoCrypto.randomUUID(),
  subtle,
};

const existing = (globalThis as unknown as { crypto?: Record<string, unknown> }).crypto;
if (!existing) {
  Object.defineProperty(globalThis, 'crypto', { value: cryptoLike, configurable: true });
} else {
  if (typeof existing.getRandomValues !== 'function') existing.getRandomValues = cryptoLike.getRandomValues;
  if (typeof existing.randomUUID !== 'function') existing.randomUUID = cryptoLike.randomUUID;
  if (!existing.subtle) existing.subtle = subtle;
}
