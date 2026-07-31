// Type declarations for rqs-serializer.mjs — the Channel A HTML-safe JSON
// serializer (LLP 0092 §0E.1).

/** Compact RFC 8259 serialization with unconditional unicode escapes for
 * U+003C/U+003E/U+2028/U+2029 inside every string token (keys included);
 * throws TypeError for non-JSON-serializable values. */
export function htmlSafeJsonSerialize(value: unknown): string;

/** Assert the completed serialization's UTF-8 bytes contain none of the
 * dangerous sequences; returns the checked bytes, throws on violation. */
export function assertHtmlSafeBytes(serialized: string): Uint8Array;

/** Serialize and byte-check in one step — the only entry the Channel A seam
 * uses on real payloads. */
export function serializeBootPayload(value: unknown): string;
