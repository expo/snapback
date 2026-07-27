import { createHash } from 'node:crypto';

export const CANONICAL_PROFILE = 'snapback-document-canonical-json-v1';

export const HASH_DOMAINS = Object.freeze({
  operation: 'snapback-document-operation-v1',
  frontier: 'snapback-document-frontier-v1',
  snapshot: 'snapback-document-snapshot-v1',
  settlement: 'snapback-document-settlement-v1',
});

export class DocumentProtocolError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'DocumentProtocolError';
    this.code = code;
    this.details = details;
  }
}

function fail(code, message, details = {}) {
  throw new DocumentProtocolError(code, message, details);
}

function assertUnicodeString(value, path) {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) {
        fail(
          'SNAPBACK_DOCUMENT_CANONICAL_STRING_INVALID',
          `${path} contains an unpaired high surrogate`,
          { path, index },
        );
      }
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      fail(
        'SNAPBACK_DOCUMENT_CANONICAL_STRING_INVALID',
        `${path} contains an unpaired low surrogate`,
        { path, index },
      );
    }
  }
}

export function compareUtf8(left, right) {
  return Buffer.compare(Buffer.from(left, 'utf8'), Buffer.from(right, 'utf8'));
}

function encode(value, path) {
  if (value === null) return 'null';
  if (value === true) return 'true';
  if (value === false) return 'false';
  if (typeof value === 'string') {
    assertUnicodeString(value, path);
    return JSON.stringify(value);
  }
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value) || Object.is(value, -0)) {
      fail(
        'SNAPBACK_DOCUMENT_CANONICAL_NUMBER_INVALID',
        `${path} must be a safe integer in minimal JSON notation`,
        { path, value },
      );
    }
    return String(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item, index) => encode(item, `${path}[${index}]`)).join(',')}]`;
  }
  if (typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) {
    const keys = Object.keys(value).sort(compareUtf8);
    return `{${keys.map((key) => {
      assertUnicodeString(key, `${path} key`);
      const item = value[key];
      if (item === undefined) {
        fail(
          'SNAPBACK_DOCUMENT_CANONICAL_VALUE_INVALID',
          `${path}.${key} cannot be undefined`,
          { path: `${path}.${key}` },
        );
      }
      return `${JSON.stringify(key)}:${encode(item, `${path}.${key}`)}`;
    }).join(',')}}`;
  }
  fail(
    'SNAPBACK_DOCUMENT_CANONICAL_VALUE_INVALID',
    `${path} is not in the closed canonical JSON value domain`,
    { path, type: typeof value },
  );
}

// @ref LLP 0068#canonical-wire-and-hash-profile — the exploratory reducer
// uses the proposed byte profile and domain separation verbatim, without
// claiming that the Draft protocol is accepted.
export function canonicalJson(value) {
  return encode(value, '$');
}

export function canonicalBytes(value) {
  return Buffer.from(canonicalJson(value), 'utf8');
}

export function hashCanonical(domain, value) {
  if (!Object.values(HASH_DOMAINS).includes(domain)) {
    fail(
      'SNAPBACK_DOCUMENT_HASH_DOMAIN_INVALID',
      'the document hash domain is not recognized',
      { domain },
    );
  }
  const hash = createHash('sha256');
  hash.update(domain, 'utf8');
  hash.update(Buffer.from([0]));
  hash.update(canonicalBytes(value));
  return hash.digest('hex');
}
