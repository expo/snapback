const INSTALLATION_ALPHABET = '0123456789abcdefghjkmnpqrstvwxyz';
const INSTALLATION_PATTERN = /^inst_[0-7][0-9a-hjkmnp-tv-z]{25}$/u;
const TOKEN_ID_PATTERN = /^ptok_[0-7][0-9a-hjkmnp-tv-z]{25}$/u;

import { isAgentAuthorityFence } from './agent-authority-brand.mjs';
import { SnapbackClient } from './index.mjs';

const cryptoRandomSource = (what) => {
  const source = globalThis.crypto;
  if (typeof source?.getRandomValues === 'function') return source;
  const code = 'SNAPBACK_CLIENT_WEBCRYPTO_RNG_MISSING';
  const message = `${what} requires crypto.getRandomValues, which this runtime `
    + 'does not provide (React Native/Hermes ships no WebCrypto). Install an '
    + 'RNG polyfill before constructing the client — Expo: expo-crypto '
    + '(import its getRandomValues polyfill), bare RN: '
    + 'react-native-get-random-values.';
  const error = new Error(`${code}: ${message}`);
  error.code = code;
  error.diagnostic = { code, message };
  throw error;
};

const encodeInstallationBody = (bytes) => {
  let value = 0n;
  for (const byte of bytes) value = (value << 8n) | BigInt(byte);
  let body = '';
  for (let index = 0; index < 26; index += 1) {
    body = INSTALLATION_ALPHABET[Number(value & 31n)] + body;
    value >>= 5n;
  }
  return body;
};

/** Mint the random installation identity used only by the push registry. */
export function newPushInstallationId() {
  const bytes = new Uint8Array(16);
  cryptoRandomSource('push installation identity').getRandomValues(bytes);
  return `inst_${encodeInstallationBody(bytes)}`;
}

const validateStorage = (storage) => {
  if (!storage || typeof storage !== 'object') {
    throw new TypeError('pushInstallationStorage must be an object');
  }
  for (const method of ['read', 'write', 'clear']) {
    if (typeof storage[method] !== 'function') {
      throw new TypeError(`pushInstallationStorage.${method} must be a function`);
    }
  }
  return storage;
};

const responseInvalid = (operation) => new Error(
  `SNAPBACK_PUSH_REGISTRY_RESPONSE_INVALID: ${operation} response is invalid`,
);

/**
 * Attach the optional registry surface to an existing SnapbackClient. The
 * returned object is the same client, now carrying `client.push`; importing
 * the root or ./online alone never closes over this module.
 *
 * @ref LLP 0143#d6-activation-migration-and-the-no-op-posture — applications that do
 * not select push pay no push-shaped runtime closure.
 */
export function attachPushRegistry(client, { pushInstallationStorage = null } = {}) {
  if (!(client instanceof SnapbackClient)) {
    throw new TypeError('attachPushRegistry requires a SnapbackClient');
  }
  if (Object.hasOwn(client, 'push')) {
    throw new TypeError('push registry is already attached to this client');
  }
  // The brand function is package-private. This receives the root client's
  // exact request funnel without exporting a generic request API.
  const request = SnapbackClient.auth.call(client, isAgentAuthorityFence);
  if (typeof request !== 'function') {
    throw new TypeError('attachPushRegistry requires the package-private client bridge');
  }
  const storage = pushInstallationStorage === null
    ? null
    : validateStorage(pushInstallationStorage);

  const readInstallationId = async () => {
    if (storage === null) return null;
    const stored = await storage.read();
    if (stored === null || stored === undefined) return null;
    if (typeof stored !== 'string' || !INSTALLATION_PATTERN.test(stored)) {
      const error = new Error(
        'SNAPBACK_PUSH_INSTALLATION_CUSTODY_CORRUPT: stored installation identity is invalid',
      );
      error.code = 'SNAPBACK_PUSH_INSTALLATION_CUSTODY_CORRUPT';
      throw error;
    }
    return stored;
  };

  const installationId = async () => {
    if (storage === null) {
      const error = new Error(
        'SNAPBACK_PUSH_INSTALLATION_CUSTODY_REQUIRED: push registration requires explicit durable installation custody',
      );
      error.code = 'SNAPBACK_PUSH_INSTALLATION_CUSTODY_REQUIRED';
      throw error;
    }
    const stored = await readInstallationId();
    if (stored !== null) return stored;
    await storage.write(newPushInstallationId());
    const committed = await readInstallationId();
    if (committed === null) {
      const error = new Error(
        'SNAPBACK_PUSH_INSTALLATION_CUSTODY_CORRUPT: installation identity write did not persist',
      );
      error.code = 'SNAPBACK_PUSH_INSTALLATION_CUSTODY_CORRUPT';
      throw error;
    }
    return committed;
  };

  const registerToken = async ({ token } = {}) => {
    if (
      typeof token !== 'string'
      || token.length === 0
      || token.length > 1_024
      || !/^(?:Exponent|Expo)PushToken\[[A-Za-z0-9_-]+\]$/u.test(token)
    ) {
      throw new TypeError('SNAPBACK_PUSH_TOKEN_INVALID: token must be an Expo push token');
    }
    const installation = await installationId();
    const response = await request.call(client, 'POST', '/push/tokens/register', {
      installationId: installation,
      token,
    });
    if (
      !response
      || typeof response !== 'object'
      || typeof response.tokenId !== 'string'
      || !TOKEN_ID_PATTERN.test(response.tokenId)
      || response.installationId !== installation
      || !Number.isSafeInteger(response.registeredAt)
      || response.registeredAt < 0
      || typeof response.rotated !== 'boolean'
      || typeof response.ownershipTransferred !== 'boolean'
      || Object.keys(response).length !== 5
    ) throw responseInvalid('registration');
    return Object.freeze({ ...response });
  };

  const registerExpoToken = async ({ getExpoPushTokenAsync, projectId } = {}) => {
    if (typeof getExpoPushTokenAsync !== 'function') {
      throw new TypeError('getExpoPushTokenAsync must be a function');
    }
    const result = await getExpoPushTokenAsync(
      projectId === undefined ? undefined : { projectId },
    );
    if (!result || typeof result.data !== 'string') {
      throw new TypeError(
        'SNAPBACK_PUSH_TOKEN_INVALID: getExpoPushTokenAsync returned no ExpoPushToken.data',
      );
    }
    return registerToken({ token: result.data });
  };

  const unregisterToken = async () => {
    const installation = await readInstallationId();
    if (installation === null) {
      return Object.freeze({ tokenId: null, retired: false });
    }
    const response = await request.call(
      client,
      'POST',
      '/push/tokens/unregister',
      { installationId: installation },
    );
    if (
      !response
      || typeof response !== 'object'
      || (response.tokenId !== null && (
        typeof response.tokenId !== 'string'
        || !TOKEN_ID_PATTERN.test(response.tokenId)
      ))
      || typeof response.retired !== 'boolean'
      || Object.keys(response).length !== 2
    ) throw responseInvalid('unregister');
    return Object.freeze({ ...response });
  };

  const push = Object.freeze({
    installationId,
    registerToken,
    unregisterToken,
    registerExpoToken,
  });
  Object.defineProperty(client, 'push', {
    configurable: false,
    enumerable: true,
    value: push,
    writable: false,
  });
  return client;
}
