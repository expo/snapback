// The Channel A HTML-safe JSON serializer (LLP 0092 §0E.1) — the normative
// spec's implementation for every local-arm Channel A HTML assembler.
//
// Row data is attacker-influencable and a literal `</script>` inside any JSON
// string terminates the boot payload's script element regardless of MIME
// type, so the serializer applies unconditional unicode escapes to every
// string token — object keys included — and the completed serialization is
// mechanically asserted to contain none of the dangerous byte sequences.
// The byte-pinned fixture corpus is tests/fixtures/rqs-serializer/ (LLP 0092
// §0E.2); rqs-serializer.test.mjs reproduces every expected file
// byte-for-byte.
//
// ESCAPING TRAP (LLP 0092 §0E.1 rule 4): transport layers in this program
// have repeatedly decoded backslash-u sequences back into literal
// characters. This file therefore never spells U+003C/U+003E/U+2028/U+2029
// as literal characters (only as escape sequences), and the whole-output
// byte property check runs at runtime on real payloads, not only in tests,
// to catch exactly that decoding class.

const encoder = new TextEncoder();

/**
 * Serialize a JSON value compactly (RFC 8259, input-document key order) with
 * the LLP 0092 §0E.1 unconditional escapes applied inside every string
 * token: U+003C (less-than) as the six characters backslash-u-0-0-3-c,
 * U+003E (greater-than) as backslash-u-0-0-3-e, and the U+2028/U+2029
 * separators as backslash-u-2-0-2-8 / backslash-u-2-0-2-9 (lowercase hex).
 * All other characters follow JSON.stringify's standard short escapes and
 * raw UTF-8 passthrough, so the fixture bytes are unique.
 */
export function htmlSafeJsonSerialize(value) {
  const json = JSON.stringify(value);
  if (typeof json !== 'string') {
    throw new TypeError('htmlSafeJsonSerialize requires a JSON-serializable value');
  }
  // A global character replacement over the completed serialization is
  // exactly equivalent to per-token escaping: outside string tokens, RFC
  // 8259 JSON contains no U+003C/U+003E/U+2028/U+2029 characters at all, so
  // every replaced occurrence necessarily sits inside a string token (keys
  // and values alike).
  return json
    .replaceAll('<', '\\u003c')
    .replaceAll('>', '\\u003e')
    .replaceAll('\u2028', '\\u2028')
    .replaceAll('\u2029', '\\u2029');
}

/**
 * The mechanically checkable whole-output property of LLP 0092 §0E.1 rule 4:
 * the completed serialization's UTF-8 bytes contain no 0x3C, no 0x3E, and no
 * UTF-8 encoding of U+2028/U+2029 (E2 80 A8 / E2 80 A9). Returns the bytes
 * so callers embed exactly what was checked; throws on violation.
 */
export function assertHtmlSafeBytes(serialized) {
  const bytes = encoder.encode(serialized);
  for (let index = 0; index < bytes.length; index += 1) {
    const byte = bytes[index];
    if (byte === 0x3c || byte === 0x3e) {
      throw new Error(
        `SNAPBACK_INLINE_SERIALIZER_UNSAFE: completed serialization contains byte 0x${byte.toString(16)} at offset ${index}`,
      );
    }
    if (byte === 0xe2 && bytes[index + 1] === 0x80
      && (bytes[index + 2] === 0xa8 || bytes[index + 2] === 0xa9)) {
      throw new Error(
        `SNAPBACK_INLINE_SERIALIZER_UNSAFE: completed serialization contains a raw U+202${bytes[index + 2] === 0xa8 ? '8' : '9'} at offset ${index}`,
      );
    }
  }
  return bytes;
}

/**
 * Serialize and byte-check in one step — the only entry the Channel A seam
 * uses on real payloads.
 */
export function serializeBootPayload(value) {
  const serialized = htmlSafeJsonSerialize(value);
  assertHtmlSafeBytes(serialized);
  return serialized;
}
