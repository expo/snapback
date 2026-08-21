const DIGEST_ADAPTER_FORMAT = 'snapback.sha256-digest.v1';

const causeCode = (cause) => {
  const observed = cause?.diagnostic?.code ?? cause?.code;
  return typeof observed === 'string' && observed.length > 0 ? observed : null;
};

const nativeModuleUnavailable = (cause) => {
  const code = causeCode(cause);
  return [
    'ERR_MODULE_NOT_FOUND',
    'MODULE_NOT_FOUND',
    'ERR_NATIVE_MODULE_NOT_FOUND',
  ].includes(code)
    || /(?:cannot find|missing|unavailable|not linked).*native module|native module.*(?:cannot find|missing|unavailable|not linked)/iu
      .test(cause instanceof Error ? cause.message : String(cause));
};

function digestError(code, message, cause = null) {
  const details = Object.freeze({
    module: 'expo-crypto',
    algorithm: 'SHA-256',
    causeCode: causeCode(cause),
  });
  const error = new Error(`${code}: ${message}`, cause === null ? undefined : { cause });
  error.code = code;
  error.diagnostic = Object.freeze({
    schemaVersion: 'snapback.client-diagnostic.v1',
    code,
    severity: 'error',
    message,
    details,
  });
  return error;
}

export function expoCryptoDigestModuleUnavailable(cause) {
  return digestError(
    'SNAPBACK_AUTH_BOOTSTRAP_DIGEST_MODULE_UNAVAILABLE',
    'Expo native authentication bootstrap requires the first-party expo-crypto digest module.',
    cause,
  );
}

function digestBytes(value) {
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) {
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  }
  return null;
}

// @ref LLP 0181#native-adapters — Expo owns this narrowly typed hashing
// adapter. It deliberately projects no random-byte or UUID capability, so a
// successful digest can never be interpreted as evidence of a native CSPRNG.
// @ref LLP 0294#non-goals — digest and security-bearing randomness remain
// independently resolved and independently refused facts.
export function createExpoCryptoSha256DigestAdapter(expoCryptoModule) {
  const source = expoCryptoModule?.default ?? expoCryptoModule;
  const digest = expoCryptoModule?.digest ?? source?.digest;
  const sha256 = expoCryptoModule?.CryptoDigestAlgorithm?.SHA256
    ?? source?.CryptoDigestAlgorithm?.SHA256;
  if (typeof digest !== 'function' || sha256 !== 'SHA-256') {
    throw expoCryptoDigestModuleUnavailable(Object.assign(
      new TypeError('expo-crypto does not expose digest() and CryptoDigestAlgorithm.SHA256.'),
      { code: 'SNAPBACK_EXPO_CRYPTO_MODULE_INVALID' },
    ));
  }

  return Object.freeze({
    format: DIGEST_ADAPTER_FORMAT,
    async digest(input) {
      if (!(input instanceof Uint8Array)) {
        throw new TypeError('SHA-256 digest input must be a Uint8Array.');
      }
      let output;
      try {
        output = digestBytes(await digest(sha256, input));
      } catch (cause) {
        if (nativeModuleUnavailable(cause)) {
          throw expoCryptoDigestModuleUnavailable(cause);
        }
        throw digestError(
          'SNAPBACK_AUTH_BOOTSTRAP_DIGEST_FAILED',
          'Expo native authentication bootstrap could not compute its storage-partition digest.',
          cause,
        );
      }
      if (output?.byteLength !== 32) {
        throw digestError(
          'SNAPBACK_AUTH_BOOTSTRAP_DIGEST_FAILED',
          'Expo native authentication bootstrap received a malformed SHA-256 digest.',
          Object.assign(new Error('SHA-256 output must contain exactly 32 bytes.'), {
            code: 'SNAPBACK_EXPO_CRYPTO_DIGEST_INVALID',
          }),
        );
      }
      return new Uint8Array(output);
    },
  });
}
