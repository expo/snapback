let fallbackSequence = 0;

/**
 * Creates a collision-resistant process/document-local label.
 *
 * This is deliberately not a credential, nonce, authorization identity, or
 * persisted public ID. Web Crypto exposes getRandomValues in non-secure
 * contexts even when randomUUID is unavailable, as on physical Safari over
 * the attended carrier's pinned plain-HTTP link-local origin.
 */
export function createNonSecurityId(prefix, cryptoImplementation = globalThis.crypto) {
  const randomUuid = cryptoImplementation?.randomUUID?.call(cryptoImplementation);
  if (randomUuid) return `${prefix}_${randomUuid.replaceAll('-', '')}`;

  if (typeof cryptoImplementation?.getRandomValues === 'function') {
    const words = new Uint32Array(4);
    cryptoImplementation.getRandomValues(words);
    return `${prefix}_${Array.from(words, (word) => word.toString(16).padStart(8, '0')).join('')}`;
  }

  fallbackSequence += 1;
  return `${prefix}_${Date.now().toString(36)}_${fallbackSequence.toString(36)}`;
}
