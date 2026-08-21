export const CryptoDigestAlgorithm = Object.freeze({ SHA256: 'SHA-256' });

export async function digest() {
  throw new Error('The package-closure expo-crypto stub has no native digest implementation');
}
