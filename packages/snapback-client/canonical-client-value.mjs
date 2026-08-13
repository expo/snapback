// One finite, portable value grammar for client-side cache and React store
// identity.
//
// @ref LLP 0114#exact-identity-bytes-and-limits — identity is the RFC 8785
// admitted JSON subset with fixed structural and byte ceilings.

import { normalizeGeneratedArgumentsV1 } from './argument-normalization.mjs';

export const CANONICAL_CLIENT_VALUE_V1_LIMITS = Object.freeze({
  maxDepth: 32,
  maxNodes: 4_096,
  maxObjectFields: 256,
  maxArrayEntries: 1_024,
  maxStringUtf8Bytes: 65_536,
  maxKeyUtf8Bytes: 262_144,
});

const utf8 = new TextEncoder();

function diagnosticError(code, message, details = {}) {
  const diagnostic = Object.freeze({
    schemaVersion: 'snapback.client-diagnostic.v1',
    code,
    severity: 'error',
    message,
    details: Object.freeze({ ...details }),
  });
  const error = new TypeError(`${code}: ${message}`);
  error.code = code;
  error.diagnostic = diagnostic;
  return error;
}

function invalid(reason, details = {}) {
  return diagnosticError(
    'SNAPBACK_REACT_ARGS_INVALID',
    `React query arguments are not a CanonicalClientValueV1: ${reason}`,
    { reason, ...details },
  );
}

const refuseAt = (reason, path, details = {}) => {
  throw invalid(reason, { path, ...details });
};

const enforceLimit = (value, limit, reason, path, label) => {
  if (value > limit) refuseAt(reason, path, { [label]: value, limit });
};

const hasLoneSurrogate = (value) => /[\uD800-\uDFFF]/u.test(value);

function validateString(value, path, limits) {
  if (hasLoneSurrogate(value)) refuseAt('lone UTF-16 surrogate', path);
  const bytes = utf8.encode(value).byteLength;
  enforceLimit(
    bytes,
    limits.maxStringUtf8Bytes,
    'string exceeds the UTF-8 byte limit',
    path,
    'bytes',
  );
}

function captureObject(value, path) {
  let keys;
  let descriptors;
  try {
    keys = Reflect.ownKeys(value);
    descriptors = Object.getOwnPropertyDescriptors(value);
  } catch {
    refuseAt('object descriptor inspection failed', path);
  }
  if (keys.some((key) => typeof key !== 'string')) {
    refuseAt('symbol object key', path);
  }
  if (
    Reflect.ownKeys(descriptors).length !== keys.length
    || keys.some((key) => !Object.hasOwn(descriptors, key))
  ) {
    refuseAt('inconsistent object descriptors', path);
  }
  // A second key-only observation catches mutating and inconsistent proxy
  // traps without ever reading a property value through the source object.
  let confirmation;
  try {
    confirmation = Reflect.ownKeys(value);
  } catch {
    refuseAt('object key confirmation failed', path);
  }
  if (
    confirmation.length !== keys.length
    || confirmation.some((key, index) => key !== keys[index])
  ) {
    refuseAt('object keys changed during descriptor capture', path);
  }
  return keys.map((key) => [key, descriptors[key]]);
}

/**
 * Validate and serialize an admitted value to RFC 8785/JCS bytes. The return
 * value is a string because every admitted byte sequence is UTF-8 JSON.
 */
export function canonicalizeClientValueV1(value, options = {}) {
  const limits = {
    ...CANONICAL_CLIENT_VALUE_V1_LIMITS,
    ...(options.limits ?? {}),
  };
  const seen = new Set();
  let nodes = 0;

  const visit = (current, depth, path) => {
    nodes += 1;
    enforceLimit(nodes, limits.maxNodes, 'value exceeds the node limit', path, 'nodes');
    enforceLimit(depth, limits.maxDepth, 'value exceeds the depth limit', path, 'depth');
    if (current === null) return 'null';
    if (typeof current === 'boolean') return current ? 'true' : 'false';
    if (typeof current === 'number') {
      if (!Number.isFinite(current)) refuseAt('non-finite number', path);
      return JSON.stringify(Object.is(current, -0) ? 0 : current);
    }
    if (typeof current === 'string') {
      validateString(current, path, limits);
      return JSON.stringify(current);
    }
    if (typeof current !== 'object') {
      refuseAt(`${typeof current} value`, path);
    }
    if (seen.has(current)) refuseAt('cyclic value', path);
    seen.add(current);
    try {
      if (Array.isArray(current)) {
        enforceLimit(
          current.length,
          limits.maxArrayEntries,
          'array exceeds the entry limit',
          path,
          'entries',
        );
        const descriptors = captureObject(current, path);
        const byKey = new Map(descriptors);
        for (let index = 0; index < current.length; index += 1) {
          const descriptor = byKey.get(String(index));
          if (!descriptor || !descriptor.enumerable || !('value' in descriptor)) {
            refuseAt('sparse or accessor array entry', `${path}[${index}]`);
          }
        }
        for (const [key, descriptor] of descriptors) {
          if (key === 'length') continue;
          if (!/^(0|[1-9][0-9]*)$/.test(key) || Number(key) >= current.length) {
            refuseAt('non-index array property', path, { key });
          }
          if (!descriptor.enumerable || !('value' in descriptor)) {
            refuseAt('non-data array entry', `${path}[${key}]`);
          }
        }
        const entries = [];
        for (let index = 0; index < current.length; index += 1) {
          entries.push(visit(byKey.get(String(index)).value, depth + 1, `${path}[${index}]`));
        }
        return `[${entries.join(',')}]`;
      }

      let prototype;
      try {
        prototype = Object.getPrototypeOf(current);
      } catch {
        refuseAt('object prototype inspection failed', path);
      }
      if (prototype !== Object.prototype && prototype !== null) {
        refuseAt('exotic object prototype', path);
      }
      const descriptors = captureObject(current, path);
      enforceLimit(
        descriptors.length,
        limits.maxObjectFields,
        'object exceeds the field limit',
        path,
        'fields',
      );
      const fields = [];
      for (const [key, descriptor] of descriptors) {
        validateString(key, `${path}{key}`, limits);
        if (!descriptor.enumerable) {
          refuseAt('non-enumerable object property', path, { key });
        }
        if (!('value' in descriptor)) {
          refuseAt('accessor object property', path, { key });
        }
        fields.push([key, descriptor.value]);
      }
      fields.sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));
      return `{${fields.map(([key, fieldValue]) => (
        `${JSON.stringify(key)}:${visit(fieldValue, depth + 1, `${path}.${key}`)}`
      )).join(',')}}`;
    } finally {
      seen.delete(current);
    }
  };

  const canonical = visit(value, 1, '$');
  const bytes = utf8.encode(canonical).byteLength;
  if (bytes > limits.maxKeyUtf8Bytes) {
    throw invalid('canonical value exceeds the UTF-8 byte limit', {
      bytes,
      limit: limits.maxKeyUtf8Bytes,
    });
  }
  return canonical;
}

export function canonicalReactStoreKeyV1(providerInstanceId, reference, args) {
  if (typeof providerInstanceId !== 'string' || providerInstanceId.length === 0) {
    throw diagnosticError(
      'SNAPBACK_REACT_PROVIDER_INVALID',
      'React provider instance identity is missing',
    );
  }
  const completeReference = Object.fromEntries([
    'artifactKind',
    'schemaVersion',
    'appId',
    'id',
    'name',
    'kind',
    'implementationHash',
    'argsContractHash',
    'resultContractHash',
  ].map((field) => [field, reference?.[field]]));
  // Validate/count the argument tree independently. The fixed key envelope
  // must not consume the argument depth/node budget defined by the public
  // grammar, while its bytes still count toward the final key ceiling.
  const canonicalArgs = canonicalizeClientValueV1(
    normalizeGeneratedArgumentsV1(reference, args),
  );
  const key = `["snapback:react-store-key:v1",${canonicalizeClientValueV1(providerInstanceId)
  },${canonicalizeClientValueV1(completeReference)},${canonicalArgs}]`;
  const bytes = utf8.encode(key).byteLength;
  if (bytes > CANONICAL_CLIENT_VALUE_V1_LIMITS.maxKeyUtf8Bytes) {
    throw invalid('complete store key exceeds the UTF-8 byte limit', {
      bytes,
      limit: CANONICAL_CLIENT_VALUE_V1_LIMITS.maxKeyUtf8Bytes,
    });
  }
  return key;
}
