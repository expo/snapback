// One finite, portable value grammar for client-side cache and React store
// identity.
//
// @ref LLP 0102#exact-identity-bytes-and-limits — identity is the RFC 8785
// admitted JSON subset with fixed structural and byte ceilings.

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

function hasLoneSurrogate(value) {
  for (let index = 0; index < value.length; index += 1) {
    const unit = value.charCodeAt(index);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return true;
      index += 1;
    } else if (unit >= 0xdc00 && unit <= 0xdfff) {
      return true;
    }
  }
  return false;
}

function validateString(value, path, limits) {
  if (hasLoneSurrogate(value)) throw invalid('lone UTF-16 surrogate', { path });
  const bytes = utf8.encode(value).byteLength;
  if (bytes > limits.maxStringUtf8Bytes) {
    throw invalid('string exceeds the UTF-8 byte limit', {
      path,
      bytes,
      limit: limits.maxStringUtf8Bytes,
    });
  }
}

function captureObject(value, path) {
  let keys;
  let descriptors;
  try {
    keys = Reflect.ownKeys(value);
    descriptors = Object.getOwnPropertyDescriptors(value);
  } catch {
    throw invalid('object descriptor inspection failed', { path });
  }
  if (keys.some((key) => typeof key !== 'string')) {
    throw invalid('symbol object key', { path });
  }
  const descriptorKeys = Reflect.ownKeys(descriptors);
  if (
    descriptorKeys.length !== keys.length
    || keys.some((key) => !Object.prototype.hasOwnProperty.call(descriptors, key))
  ) {
    throw invalid('inconsistent object descriptors', { path });
  }
  // A second key-only observation catches mutating and inconsistent proxy
  // traps without ever reading a property value through the source object.
  let confirmation;
  try {
    confirmation = Reflect.ownKeys(value);
  } catch {
    throw invalid('object key confirmation failed', { path });
  }
  if (
    confirmation.length !== keys.length
    || confirmation.some((key, index) => key !== keys[index])
  ) {
    throw invalid('object keys changed during descriptor capture', { path });
  }
  return keys.map((key) => [key, descriptors[key]]);
}

/**
 * Validate and serialize an admitted value to RFC 8785/JCS bytes. The return
 * value is a string because every admitted byte sequence is UTF-8 JSON.
 */
export function canonicalizeClientValueV1(value, options = {}) {
  const limits = Object.freeze({
    ...CANONICAL_CLIENT_VALUE_V1_LIMITS,
    ...(options.limits ?? {}),
  });
  const seen = new Set();
  let nodes = 0;

  const visit = (current, depth, path) => {
    nodes += 1;
    if (nodes > limits.maxNodes) {
      throw invalid('value exceeds the node limit', { path, nodes, limit: limits.maxNodes });
    }
    if (depth > limits.maxDepth) {
      throw invalid('value exceeds the depth limit', { path, depth, limit: limits.maxDepth });
    }
    if (current === null) return 'null';
    if (typeof current === 'boolean') return current ? 'true' : 'false';
    if (typeof current === 'number') {
      if (!Number.isFinite(current)) throw invalid('non-finite number', { path });
      return JSON.stringify(Object.is(current, -0) ? 0 : current);
    }
    if (typeof current === 'string') {
      validateString(current, path, limits);
      return JSON.stringify(current);
    }
    if (typeof current !== 'object') {
      throw invalid(`${typeof current} value`, { path });
    }
    if (seen.has(current)) throw invalid('cyclic value', { path });
    seen.add(current);
    try {
      if (Array.isArray(current)) {
        if (current.length > limits.maxArrayEntries) {
          throw invalid('array exceeds the entry limit', {
            path,
            entries: current.length,
            limit: limits.maxArrayEntries,
          });
        }
        const descriptors = captureObject(current, path);
        const byKey = new Map(descriptors);
        for (let index = 0; index < current.length; index += 1) {
          const descriptor = byKey.get(String(index));
          if (!descriptor || !descriptor.enumerable || !('value' in descriptor)) {
            throw invalid('sparse or accessor array entry', { path: `${path}[${index}]` });
          }
        }
        for (const [key, descriptor] of descriptors) {
          if (key === 'length') continue;
          if (!/^(0|[1-9][0-9]*)$/.test(key) || Number(key) >= current.length) {
            throw invalid('non-index array property', { path, key });
          }
          if (!descriptor.enumerable || !('value' in descriptor)) {
            throw invalid('non-data array entry', { path: `${path}[${key}]` });
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
        throw invalid('object prototype inspection failed', { path });
      }
      if (prototype !== Object.prototype && prototype !== null) {
        throw invalid('exotic object prototype', { path });
      }
      const descriptors = captureObject(current, path);
      if (descriptors.length > limits.maxObjectFields) {
        throw invalid('object exceeds the field limit', {
          path,
          fields: descriptors.length,
          limit: limits.maxObjectFields,
        });
      }
      const fields = [];
      for (const [key, descriptor] of descriptors) {
        validateString(key, `${path}{key}`, limits);
        if (!descriptor.enumerable) {
          throw invalid('non-enumerable object property', { path, key });
        }
        if (!('value' in descriptor)) {
          throw invalid('accessor object property', { path, key });
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
  const completeReference = {
    artifactKind: reference?.artifactKind,
    schemaVersion: reference?.schemaVersion,
    appId: reference?.appId,
    id: reference?.id,
    name: reference?.name,
    kind: reference?.kind,
    implementationHash: reference?.implementationHash,
    argsContractHash: reference?.argsContractHash,
    resultContractHash: reference?.resultContractHash,
  };
  // Validate/count the argument tree independently. The fixed key envelope
  // must not consume the argument depth/node budget defined by the public
  // grammar, while its bytes still count toward the final key ceiling.
  const canonicalArgs = canonicalizeClientValueV1(args);
  const key = [
    '[',
    canonicalizeClientValueV1('snapback:react-store-key:v1'),
    ',',
    canonicalizeClientValueV1(providerInstanceId),
    ',',
    canonicalizeClientValueV1(completeReference),
    ',',
    canonicalArgs,
    ']',
  ].join('');
  const bytes = utf8.encode(key).byteLength;
  if (bytes > CANONICAL_CLIENT_VALUE_V1_LIMITS.maxKeyUtf8Bytes) {
    throw invalid('complete store key exceeds the UTF-8 byte limit', {
      bytes,
      limit: CANONICAL_CLIENT_VALUE_V1_LIMITS.maxKeyUtf8Bytes,
    });
  }
  return key;
}
