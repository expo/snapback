// Cross-language implementation of LLP 0156 fingerprint byte grammar.
// Deliberately no hashing dependency: callers choose their SHA-256 provider;
// this function owns the part most likely to drift across runtimes.
//
// @ref LLP 0156#e11--fingerprint-at-the-seam-group-in-the-flush-transaction

const encoder = new TextEncoder();

const branchFields = (input) => {
  switch (input.branch) {
    case 'typed_refusal':
      return [input.schemeVersion, input.kind, input.name, input.code];
    case 'app_refusal':
      return [input.schemeVersion, input.kind, input.name, input.appCode];
    case 'exception':
      return [
        input.schemeVersion,
        input.kind,
        input.name,
        input.errorClass,
        input.messageTemplate,
      ];
    case 'transport':
      return [input.schemeVersion, input.kind, input.name, input.statusClass];
    case 'diagnostic':
      return [input.schemeVersion, 'diagnostic', input.name, input.subsystem, input.code];
    default:
      throw new TypeError(`unknown fingerprint branch ${JSON.stringify(input.branch)}`);
  }
};

const branchTag = Object.freeze({
  typed_refusal: 0x01,
  app_refusal: 0x02,
  exception: 0x03,
  transport: 0x04,
  diagnostic: 0x05,
});

export function encodeFingerprintV1(input) {
  const chunks = [Uint8Array.of(branchTag[input.branch])];
  let length = 1;
  for (const rawField of branchFields(input)) {
    if (rawField === null || rawField === undefined) {
      chunks.push(Uint8Array.of(0));
      length += 1;
      continue;
    }
    const field = encoder.encode(String(rawField));
    const header = new Uint8Array(5);
    header[0] = 1;
    new DataView(header.buffer).setUint32(1, field.byteLength, false);
    chunks.push(header, field);
    length += header.byteLength + field.byteLength;
  }
  const encoded = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    encoded.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return encoded;
}

export function lowerHex(bytes) {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}
