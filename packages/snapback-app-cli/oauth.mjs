// OAuth-facade acquisition for the external app CLI.
//
// @ref LLP 0204#d4--surface-3-the-downloadable-cli — login is a public-client
// authorization-code flow with DCR, PKCE S256, and owner-only bearer custody.
// @ref LLP 0150#summary — token bytes never transit the human or enter CLI
// output; the facade's deliberately weaker bearer is named and bounded.

import { createHash, randomBytes } from 'node:crypto';
import { constants as fsConstants } from 'node:fs';
import {
  lstat,
  mkdir,
  open,
  rename,
  rm,
} from 'node:fs/promises';
import { createServer } from 'node:http';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';

import { normalizeTargetOrigin } from './auth.mjs';

export const OAUTH_CLIENT_FORMAT_VERSION = 1;
export const OAUTH_BEARER_FORMAT_VERSION = 1;
export const OAUTH_PUBLIC_CLIENT_FILE = 'oauth-public-client.json';
export const OAUTH_BEARER_FILE = 'oauth-bearer-token.json';

const MAX_RESPONSE_BYTES = 1024 * 1024;
const MAX_PROFILE_BYTES = 64 * 1024;
const REQUEST_TIMEOUT_MS = 60_000;
const LOGIN_TIMEOUT_MS = 5 * 60_000;
const OAUTH_BEARER_MAX_TTL_SECONDS = 15 * 60;
const CALLBACK_PATH = '/oauth/callback';
const READ_KINDS = new Set(['Query', 'LiveQuery', 'query', 'liveQuery']);

const fail = (code, message, details = undefined, cause = undefined) => {
  const error = new Error(`${code}: ${message}`, cause === undefined ? undefined : { cause });
  error.code = code;
  error.diagnostic = Object.freeze({
    code,
    message,
    ...(details === undefined ? {} : { details: Object.freeze({ ...details }) }),
  });
  return error;
};

const requirePosix = () => {
  if (process.platform === 'win32' || typeof process.getuid !== 'function') {
    throw fail(
      'SNAPBACK_APP_CLI_HOST_UNSUPPORTED',
      'OAuth bearer custody requires POSIX ownership and mode semantics',
    );
  }
};

const assertPrivateDirectory = async (directory) => {
  requirePosix();
  if (!isAbsolute(directory) || resolve(directory) !== directory) {
    throw fail('SNAPBACK_APP_CLI_CREDENTIAL_SOURCE_INVALID', 'OAuth profile directory must be absolute and normalized');
  }
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const info = await lstat(directory);
  if (!info.isDirectory() || info.isSymbolicLink() || info.uid !== process.getuid()
    || (info.mode & 0o777) !== 0o700) {
    throw fail(
      'SNAPBACK_APP_CLI_CREDENTIAL_SOURCE_INVALID',
      'OAuth profile directory must be an owner-owned real mode-0700 directory',
      { directory },
    );
  }
};

const assertExistingPrivateFile = async (path) => {
  const info = await lstat(path).catch((error) => {
    if (error?.code === 'ENOENT') return null;
    throw error;
  });
  if (info === null) return false;
  if (!info.isFile() || info.isSymbolicLink() || info.uid !== process.getuid()
    || info.nlink !== 1 || (info.mode & 0o777) !== 0o600
    || info.size > MAX_PROFILE_BYTES) {
    throw fail(
      'SNAPBACK_APP_CLI_CREDENTIAL_SOURCE_INVALID',
      'OAuth custody records must be owner-owned, single-link, bounded mode-0600 files',
      { path },
    );
  }
  return true;
};

const readPrivateJson = async (path) => {
  const handle = await open(
    path,
    fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0) | (fsConstants.O_CLOEXEC ?? 0),
  ).catch((error) => {
    if (error?.code === 'ENOENT') return null;
    throw fail('SNAPBACK_APP_CLI_CREDENTIAL_SOURCE_INVALID', 'OAuth custody record is unavailable', { path }, error);
  });
  if (handle === null) return null;
  let value;
  try {
    const info = await handle.stat();
    if (!info.isFile() || info.uid !== process.getuid()
      || info.nlink !== 1 || (info.mode & 0o777) !== 0o600
      || info.size > MAX_PROFILE_BYTES) {
      throw fail(
        'SNAPBACK_APP_CLI_CREDENTIAL_SOURCE_INVALID',
        'OAuth custody records must be owner-owned, single-link, bounded mode-0600 files',
        { path },
      );
    }
    try { value = JSON.parse(await handle.readFile('utf8')); } catch (cause) {
      throw fail('SNAPBACK_APP_CLI_CREDENTIAL_SOURCE_INVALID', 'OAuth custody record is not valid JSON', { path }, cause);
    }
  } finally {
    await handle.close();
  }
  return value;
};

const writePrivateJson = async (path, value) => {
  await assertExistingPrivateFile(path);
  const temporary = `${path}.tmp-${process.pid}-${randomBytes(6).toString('hex')}`;
  let handle;
  try {
    handle = await open(temporary, 'wx', 0o600);
    await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`);
    await handle.sync();
    await handle.close();
    handle = null;
    await rename(temporary, path);
    const directory = await open(dirname(path), fsConstants.O_RDONLY | (fsConstants.O_CLOEXEC ?? 0));
    try { await directory.sync(); } finally { await directory.close(); }
  } catch (error) {
    await handle?.close().catch(() => {});
    await rm(temporary, { force: true }).catch(() => {});
    throw error;
  }
};

export const defaultOAuthProfileDirectory = (origin) => {
  const target = normalizeTargetOrigin(origin);
  const targetKey = createHash('sha256').update(target, 'utf8').digest('hex');
  return join(homedir(), '.snapback', 'app-cli', 'oauth', targetKey);
};

const endpointAtTarget = (origin, value, field) => {
  let endpoint;
  try { endpoint = new URL(value); } catch (cause) {
    throw fail('SNAPBACK_APP_CLI_TRANSPORT_FAILED', `OAuth metadata ${field} is not an absolute URL`, undefined, cause);
  }
  if (endpoint.origin !== origin || !['http:', 'https:'].includes(endpoint.protocol)) {
    throw fail('SNAPBACK_APP_CLI_TRANSPORT_FAILED', `OAuth metadata ${field} leaves the selected app origin`);
  }
  return endpoint.href;
};

const boundedResponseBody = async (response) => {
  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > MAX_RESPONSE_BYTES) {
    throw fail('SNAPBACK_APP_CLI_TRANSPORT_FAILED', 'OAuth response exceeded its ingress bound');
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.byteLength > MAX_RESPONSE_BYTES) {
    throw fail('SNAPBACK_APP_CLI_TRANSPORT_FAILED', 'OAuth response exceeded its ingress bound');
  }
  return bytes.toString('utf8');
};

const request = async (url, {
  method = 'GET',
  headers = {},
  body = undefined,
  timeoutMs = REQUEST_TIMEOUT_MS,
} = {}) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let response;
  try {
    response = await fetch(url, {
      method,
      headers: { 'x-snapback-auth-client-protocol': '1', ...headers },
      body,
      redirect: 'manual',
      signal: controller.signal,
    });
    const text = await boundedResponseBody(response);
    let payload = null;
    if (text.length > 0) {
      try { payload = JSON.parse(text); } catch (cause) {
        throw fail('SNAPBACK_APP_CLI_TRANSPORT_FAILED', 'OAuth response was not JSON', undefined, cause);
      }
    }
    return Object.freeze({ response, payload });
  } catch (cause) {
    if (cause?.code?.startsWith?.('SNAPBACK_')) throw cause;
    throw fail('SNAPBACK_APP_CLI_TRANSPORT_FAILED', 'OAuth request failed', undefined, cause);
  } finally {
    clearTimeout(timer);
  }
};

const facadeAbsent = () => fail(
  'SNAPBACK_APP_CLI_AUTH_REFUSED',
  'this app has no enabled OAuth facade; enable api.oauth with the explicit api.oauth.bearer opt-in, or use the native snapback-app pair path',
  { alternatives: ['set api.oauth.enabled and api.oauth.bearer to true', 'run snapback-app --server <url> pair --help'] },
);

export async function discoverOAuthFacade(baseUrl) {
  const origin = normalizeTargetOrigin(baseUrl);
  const { response, payload } = await request(`${origin}/.well-known/oauth-authorization-server`);
  if (response.status === 404) throw facadeAbsent();
  if (!response.ok) throw fail('SNAPBACK_APP_CLI_AUTH_REFUSED', 'OAuth facade discovery was refused', { status: response.status });
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)
    || payload.issuer !== origin
    || !Array.isArray(payload.code_challenge_methods_supported)
    || !payload.code_challenge_methods_supported.includes('S256')
    || !Array.isArray(payload.grant_types_supported)
    || !payload.grant_types_supported.includes('authorization_code')
    || !Array.isArray(payload.response_types_supported)
    || !payload.response_types_supported.includes('code')
    || !Array.isArray(payload.token_endpoint_auth_methods_supported)
    || !payload.token_endpoint_auth_methods_supported.includes('none')
    || !Array.isArray(payload.scopes_supported)
    || payload.scopes_supported.length === 0
    || payload.scopes_supported.some((scope) => typeof scope !== 'string' || scope.length === 0)) {
    throw fail('SNAPBACK_APP_CLI_TRANSPORT_FAILED', 'OAuth authorization-server metadata is incomplete or incompatible');
  }
  return Object.freeze({
    origin,
    authorizationEndpoint: endpointAtTarget(origin, payload.authorization_endpoint, 'authorization_endpoint'),
    tokenEndpoint: endpointAtTarget(origin, payload.token_endpoint, 'token_endpoint'),
    registrationEndpoint: endpointAtTarget(origin, payload.registration_endpoint, 'registration_endpoint'),
    scopesSupported: Object.freeze([...payload.scopes_supported]),
  });
}

const explicitlyReadNamed = (scope) => /(^|[.\-:_/])read$/iu.test(scope);

// Default heuristic, in order: a bundle explicitly named `read` (including
// names such as `items.read`), the first declared bundle whose members are all
// Query/LiveQuery functions, then the metadata's first declared bundle.
export function defaultOAuthScopes(metadata, inspection) {
  const advertised = metadata.scopesSupported;
  const named = advertised.find(explicitlyReadNamed);
  if (named !== undefined) return Object.freeze([named]);
  const bundles = inspection?.schema?.api?.oauth?.bundles ?? {};
  const functions = new Map(
    (inspection?.functions?.functions ?? []).map((fn) => [fn?.name, fn?.kind]),
  );
  const queryOnly = advertised.find((scope) => {
    const members = bundles?.[scope]?.functions;
    return Array.isArray(members) && members.length > 0
      && members.every((name) => READ_KINDS.has(functions.get(name)));
  });
  return Object.freeze([queryOnly ?? advertised[0]]);
}

export function parseOAuthScopes(value, metadata, inspection) {
  if (value === null || value === undefined) return defaultOAuthScopes(metadata, inspection);
  const scopes = value.split(',').map((scope) => scope.trim()).filter(Boolean);
  if (scopes.length === 0 || new Set(scopes).size !== scopes.length) {
    throw fail('SNAPBACK_APP_CLI_USAGE', '--scopes must name one or more unique comma-separated OAuth bundles');
  }
  const unknown = scopes.filter((scope) => !metadata.scopesSupported.includes(scope));
  if (unknown.length > 0) {
    throw fail('SNAPBACK_APP_CLI_USAGE', '--scopes names a bundle the app does not advertise', { unknown });
  }
  return Object.freeze(scopes);
}

const callbackPort = (redirectUri) => {
  const uri = new URL(redirectUri);
  if (uri.protocol !== 'http:' || uri.hostname !== '127.0.0.1'
    || uri.pathname !== CALLBACK_PATH || uri.search !== '' || uri.hash !== '') {
    throw fail('SNAPBACK_APP_CLI_CREDENTIAL_SOURCE_INVALID', 'cached OAuth redirect URI is not the app CLI loopback callback');
  }
  const port = Number(uri.port);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw fail('SNAPBACK_APP_CLI_CREDENTIAL_SOURCE_INVALID', 'cached OAuth redirect URI has no usable port');
  }
  return port;
};

const randomFallbackRedirect = () => {
  const port = 49_152 + randomBytes(2).readUInt16BE(0) % 16_384;
  return `http://127.0.0.1:${port}${CALLBACK_PATH}`;
};

const startLoopback = (port, state) => new Promise((resolvePromise, reject) => {
  let settled = false;
  let resolveCode;
  let rejectCode;
  const code = new Promise((resolveCodePromise, rejectCodePromise) => {
    resolveCode = resolveCodePromise;
    rejectCode = rejectCodePromise;
  });
  const server = createServer((incoming, response) => {
    const url = new URL(incoming.url ?? '/', 'http://127.0.0.1');
    if (incoming.method !== 'GET' || url.pathname !== CALLBACK_PATH) {
      response.writeHead(404).end();
      return;
    }
    if (url.searchParams.get('state') !== state) {
      response.writeHead(400, { 'content-type': 'text/plain; charset=utf-8' });
      response.end('OAuth state did not match. Return to the terminal and try login again.\n');
      if (!settled) {
        settled = true;
        rejectCode(fail('SNAPBACK_APP_CLI_AUTH_REFUSED', 'OAuth callback state did not match'));
      }
      return;
    }
    const oauthError = url.searchParams.get('error');
    const authorizationCode = url.searchParams.get('code');
    if (oauthError !== null || authorizationCode === null || authorizationCode.length === 0) {
      response.writeHead(400, { 'content-type': 'text/plain; charset=utf-8' });
      response.end('Authorization was denied. Return to the terminal.\n');
      if (!settled) {
        settled = true;
        rejectCode(fail('SNAPBACK_APP_CLI_AUTH_REFUSED', 'OAuth authorization was denied'));
      }
      return;
    }
    response.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
    response.end('Snapback CLI authorization complete. You may close this tab.\n');
    if (!settled) {
      settled = true;
      resolveCode(authorizationCode);
    }
  });
  server.once('error', reject);
  server.listen(port, '127.0.0.1', () => {
    server.off('error', reject);
    const address = server.address();
    resolvePromise(Object.freeze({
      redirectUri: `http://127.0.0.1:${address.port}${CALLBACK_PATH}`,
      code,
      async close() {
        settled = true;
        await new Promise((done) => server.close(done));
      },
    }));
  });
});

const acquireLoopback = async (redirectUri, state) => {
  try {
    return await startLoopback(redirectUri === null ? 0 : callbackPort(redirectUri), state);
  } catch {
    return null;
  }
};

const validateClientRecord = (record, origin) => {
  const expectedKeys = ['clientId', 'formatVersion', 'redirectUri', 'registeredAtMs', 'targetOrigin'];
  if (record === null || typeof record !== 'object' || Array.isArray(record)
    || Object.keys(record).sort().some((key, index) => key !== expectedKeys[index])
    || Object.keys(record).length !== expectedKeys.length
    || record.formatVersion !== OAUTH_CLIENT_FORMAT_VERSION
    || record.targetOrigin !== origin
    || typeof record.clientId !== 'string' || record.clientId.length === 0
    || typeof record.redirectUri !== 'string'
    || !Number.isSafeInteger(record.registeredAtMs) || record.registeredAtMs < 0) {
    throw fail('SNAPBACK_APP_CLI_CREDENTIAL_SOURCE_INVALID', 'cached OAuth public-client registration is invalid');
  }
  callbackPort(record.redirectUri);
  return Object.freeze(record);
};

const registerClient = async (metadata, redirectUri) => {
  const { response, payload } = await request(metadata.registrationEndpoint, {
    method: 'POST',
    headers: { accept: 'application/json', 'content-type': 'application/json' },
    body: JSON.stringify({
      redirect_uris: [redirectUri],
      client_name: 'Snapback app CLI',
      token_endpoint_auth_method: 'none',
    }),
  });
  if (!response.ok || typeof payload?.client_id !== 'string' || payload.client_id.length === 0
    || typeof payload.client_secret === 'string') {
    throw fail('SNAPBACK_APP_CLI_AUTH_REFUSED', 'OAuth dynamic client registration was refused', { status: response.status });
  }
  return payload.client_id;
};

const codeFromPaste = (pasted, state) => {
  const value = pasted.trim();
  if (value.length === 0) throw fail('SNAPBACK_APP_CLI_USAGE', 'no OAuth authorization code was pasted');
  try {
    const callback = new URL(value);
    if (callback.searchParams.get('state') !== state) {
      throw fail('SNAPBACK_APP_CLI_AUTH_REFUSED', 'pasted OAuth callback state did not match');
    }
    const oauthError = callback.searchParams.get('error');
    const code = callback.searchParams.get('code');
    if (oauthError !== null || code === null || code.length === 0) {
      throw fail('SNAPBACK_APP_CLI_AUTH_REFUSED', 'pasted OAuth callback did not carry an authorization code');
    }
    return code;
  } catch (error) {
    if (error?.code?.startsWith?.('SNAPBACK_')) throw error;
    return value;
  }
};

const withTimeout = (promise, timeoutMs) => {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(fail('SNAPBACK_APP_CLI_TIMEOUT', 'OAuth login timed out')), timeoutMs);
    }),
  ]).finally(() => clearTimeout(timer));
};

export async function loginWithOAuth({
  origin: baseUrl,
  profileDirectory = null,
  requestedScopes = null,
  noBrowser = false,
  loadInspection,
  readPastedCode,
  onAuthorizeUrl,
  nowMs = () => Date.now(),
  timeoutMs = LOGIN_TIMEOUT_MS,
}) {
  const metadata = await discoverOAuthFacade(baseUrl);
  const origin = metadata.origin;
  const directory = resolve(profileDirectory ?? defaultOAuthProfileDirectory(origin));
  await assertPrivateDirectory(directory);
  const clientPath = join(directory, OAUTH_PUBLIC_CLIENT_FILE);
  const tokenPath = join(directory, OAUTH_BEARER_FILE);
  const cached = await readPrivateJson(clientPath);
  const previous = cached === null ? null : validateClientRecord(cached, origin);
  const state = randomBytes(24).toString('base64url');
  const verifier = randomBytes(32).toString('base64url');
  const challenge = createHash('sha256').update(verifier, 'utf8').digest('base64url');

  let loopback = noBrowser ? null : await acquireLoopback(previous?.redirectUri ?? null, state);
  let redirectUri = loopback?.redirectUri ?? previous?.redirectUri ?? null;
  if (redirectUri === null) {
    const reservation = await acquireLoopback(null, state);
    if (reservation === null) redirectUri = randomFallbackRedirect();
    else {
      redirectUri = reservation.redirectUri;
      if (noBrowser) await reservation.close();
      else loopback = reservation;
    }
  }

  let client = previous;
  try {
    if (client === null) {
      const clientId = await registerClient(metadata, redirectUri);
      client = Object.freeze({
        formatVersion: OAUTH_CLIENT_FORMAT_VERSION,
        targetOrigin: origin,
        clientId,
        redirectUri,
        registeredAtMs: nowMs(),
      });
      await writePrivateJson(clientPath, client);
    }

    const inspection = await loadInspection();
    const scopes = parseOAuthScopes(requestedScopes, metadata, inspection);
    const authorize = new URL(metadata.authorizationEndpoint);
    authorize.search = new URLSearchParams({
      response_type: 'code',
      client_id: client.clientId,
      redirect_uri: client.redirectUri,
      scope: scopes.join(' '),
      state,
      code_challenge: challenge,
      code_challenge_method: 'S256',
    }).toString();
    onAuthorizeUrl(authorize.href, { mode: loopback === null ? 'paste' : 'loopback' });

    const authorizationCode = loopback === null
      ? codeFromPaste(await withTimeout(readPastedCode(), timeoutMs), state)
      : await withTimeout(loopback.code, timeoutMs);
    const tokenForm = new URLSearchParams({
      grant_type: 'authorization_code',
      code: authorizationCode,
      redirect_uri: client.redirectUri,
      client_id: client.clientId,
      code_verifier: verifier,
    });
    const { response, payload } = await request(metadata.tokenEndpoint, {
      method: 'POST',
      headers: { accept: 'application/json', 'content-type': 'application/x-www-form-urlencoded' },
      body: tokenForm.toString(),
    });
    if (!response.ok
      || typeof payload?.access_token !== 'string' || payload.access_token.length === 0
      || payload.token_type !== 'Bearer'
      || !Number.isSafeInteger(payload.expires_in) || payload.expires_in < 1
      || payload.expires_in > OAUTH_BEARER_MAX_TTL_SECONDS
      || typeof payload.scope !== 'string'
      || Object.hasOwn(payload, 'refresh_token')) {
      throw fail('SNAPBACK_APP_CLI_AUTH_REFUSED', 'OAuth authorization-code exchange was refused or incompatible', { status: response.status });
    }
    const grantedScopes = payload.scope.split(/\s+/u).filter(Boolean);
    if (grantedScopes.length !== scopes.length
      || grantedScopes.some((scope) => !scopes.includes(scope))) {
      throw fail('SNAPBACK_APP_CLI_AUTH_REFUSED', 'OAuth token scopes did not match the approved request');
    }
    const issuedAtMs = nowMs();
    const expiresAtMs = issuedAtMs + payload.expires_in * 1_000;
    await writePrivateJson(tokenPath, {
      formatVersion: OAUTH_BEARER_FORMAT_VERSION,
      credentialType: 'bearer',
      targetOrigin: origin,
      clientId: client.clientId,
      accessToken: payload.access_token,
      tokenType: payload.token_type,
      scopeBundles: grantedScopes,
      issuedAtMs,
      expiresAtMs,
      refreshSupported: false,
    });
    return Object.freeze({
      loggedIn: true,
      targetOrigin: origin,
      profileDirectory: directory,
      clientRegistrationFile: clientPath,
      bearerTokenFile: tokenPath,
      clientRegistration: previous === null ? 'created' : 'reused',
      completionMode: loopback === null ? 'paste' : 'loopback',
      scopes,
      expiresAt: new Date(expiresAtMs).toISOString(),
      refreshSupported: false,
    });
  } finally {
    await loopback?.close().catch(() => {});
  }
}
