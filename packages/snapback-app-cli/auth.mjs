// Credentialed principal projection for the app CLI.
//
// @ref LLP 0062#4-auth-the-existing-model-projected--with-explicit-selection
// — anonymous is the unconditional default; authority selection is explicit,
// auto refuses ambiguity, and a presented invalid source never falls back.

import { createHash } from 'node:crypto';
import { constants as fsConstants } from 'node:fs';
import {
  lstat,
  mkdir,
  open,
  readFile,
  readdir,
  rename,
  rm,
} from 'node:fs/promises';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';

import { AgentAuthorityFence } from '@expo/snapback-client';
import {
  SnapbackAppDataClient,
  createExternalSessionAppDataClient,
} from '@expo/snapback-client/app-data';

import {
  refuseUnadmittedPrincipal,
  targetAdmitsPrincipal,
  targetDescriptor,
} from './envelope.mjs';

export const PRINCIPAL = Object.freeze({
  ANONYMOUS: 'anonymous',
  DEV: 'dev',
  SESSION: 'session',
  AGENT: 'agent',
  AUTO: 'auto',
});

export const SESSION_BEARER_ENV = 'SNAPBACK_APP_SESSION_BEARER';
export const AGENT_PROFILE_ENV = 'SNAPBACK_APP_AGENT_PROFILE';
export const AGENT_PROFILE_FORMAT_VERSION = 1;
export const DEFAULT_AGENT_TOKEN_TTL_MS = 130_000;
export const DEFAULT_AGENT_ADMISSION_WAIT_MS = 5_000;

const MAX_SECRET_BYTES = 16 * 1024;
const MAX_PROFILE_BYTES = 64 * 1024;
const MAX_LIFECYCLE_RESPONSE_BYTES = 1024 * 1024;
const LIFECYCLE_TIMEOUT_MS = 60_000;
const RELEASE_TIMEOUT_MS = 5_000;
const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const ENV_NAME = /^[A-Z_][A-Z0-9_]{0,127}$/u;

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

const exactKeys = (value, expected, where) => {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw fail('SNAPBACK_APP_CLI_CREDENTIAL_SOURCE_INVALID', `${where} must be an object`);
  }
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) {
    throw fail('SNAPBACK_APP_CLI_CREDENTIAL_SOURCE_INVALID', `${where} has an invalid field set`, { fields: actual });
  }
};

export const normalizeTargetOrigin = (baseUrl) => {
  let url;
  try { url = new URL(baseUrl); } catch (cause) {
    throw fail('SNAPBACK_APP_CLI_USAGE', `'${baseUrl}' is not an absolute target URL`, undefined, cause);
  }
  if (!['http:', 'https:'].includes(url.protocol)
    || url.username !== '' || url.password !== ''
    || url.pathname !== '/' || url.search !== '' || url.hash !== '') {
    throw fail('SNAPBACK_APP_CLI_USAGE', 'the target must be a bare HTTP(S) origin without userinfo, path, query, or fragment');
  }
  return url.origin;
};

export const isLiteralLoopbackOrigin = (baseUrl) => {
  const url = new URL(normalizeTargetOrigin(baseUrl));
  return url.hostname === '127.0.0.1' || url.hostname === '[::1]' || url.hostname === '::1';
};

const requirePosix = () => {
  if (process.platform === 'win32' || typeof process.getuid !== 'function') {
    throw fail(
      'SNAPBACK_APP_CLI_HOST_UNSUPPORTED',
      'credentialed app-CLI lanes require POSIX ownership and mode semantics',
    );
  }
};

export const assertSupportedHost = requirePosix;

const assertSafeAncestors = async (absolute) => {
  requirePosix();
  const euid = process.getuid();
  const ancestors = [];
  let cursor = dirname(absolute);
  for (;;) {
    ancestors.push(cursor);
    const parent = dirname(cursor);
    if (parent === cursor) break;
    cursor = parent;
  }
  for (const path of ancestors.reverse()) {
    const info = await lstat(path).catch((cause) => {
      throw fail('SNAPBACK_APP_CLI_CREDENTIAL_SOURCE_INVALID', `credential ancestor '${path}' is unavailable`, { path }, cause);
    });
    if (!info.isDirectory() || info.isSymbolicLink() || (info.uid !== 0 && info.uid !== euid)
      || (info.mode & 0o022) !== 0) {
      throw fail('SNAPBACK_APP_CLI_CREDENTIAL_SOURCE_INVALID', `credential ancestor '${path}' is not an owned non-writable real directory`, { path });
    }
  }
};

const safePrivateFile = async (path, { limitBytes, label }) => {
  requirePosix();
  if (!isAbsolute(path) || resolve(path) !== path) {
    throw fail('SNAPBACK_APP_CLI_CREDENTIAL_SOURCE_INVALID', `${label} must be an absolute normalized path`);
  }
  await assertSafeAncestors(path);
  const handle = await open(
    path,
    fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0) | (fsConstants.O_CLOEXEC ?? 0),
  ).catch((cause) => {
    throw fail('SNAPBACK_APP_CLI_CREDENTIAL_SOURCE_INVALID', `${label} is unavailable`, { path }, cause);
  });
  try {
    const info = await handle.stat();
    if (!info.isFile() || info.uid !== process.getuid()
      || info.nlink !== 1 || (info.mode & 0o777) !== 0o600 || info.size > limitBytes) {
      throw fail(
        'SNAPBACK_APP_CLI_CREDENTIAL_SOURCE_INVALID',
        `${label} must be an owner-owned, single-link, bounded mode-0600 regular file`,
        { path },
      );
    }
    return await handle.readFile('utf8');
  } finally {
    await handle.close();
  }
};

export const readPrivateSecretFile = (path, label = 'secret input') => safePrivateFile(
  path,
  { limitBytes: MAX_SECRET_BYTES, label },
);

const credentialReference = (value) => {
  if (value?.kind === 'file') {
    exactKeys(value, ['kind', 'path'], 'credential reference');
    if (typeof value.path !== 'string' || !isAbsolute(value.path) || resolve(value.path) !== value.path) {
      throw fail('SNAPBACK_APP_CLI_CREDENTIAL_SOURCE_INVALID', 'credential file path must be absolute and normalized');
    }
    return Object.freeze({ kind: 'file', path: value.path });
  }
  if (value?.kind === 'env') {
    exactKeys(value, ['kind', 'name'], 'credential reference');
    if (!ENV_NAME.test(value.name ?? '')) throw fail('SNAPBACK_APP_CLI_CREDENTIAL_SOURCE_INVALID', 'credential environment variable name is invalid');
    return Object.freeze({ kind: 'env', name: value.name });
  }
  throw fail('SNAPBACK_APP_CLI_CREDENTIAL_SOURCE_INVALID', 'credential reference kind must be file or env');
};

export async function readAgentProfile(path) {
  const encoded = await safePrivateFile(path, { limitBytes: MAX_PROFILE_BYTES, label: 'agent profile' });
  let profile;
  try { profile = JSON.parse(encoded); } catch (cause) {
    throw fail('SNAPBACK_APP_CLI_CREDENTIAL_SOURCE_INVALID', 'agent profile is not valid JSON', { path }, cause);
  }
  exactKeys(profile, [
    'formatVersion', 'targetOrigin', 'appId', 'grantId', 'actorUserId',
    'effectiveUserId', 'credentialId', 'credentialGeneration', 'credential',
  ], 'agent profile');
  if (profile.formatVersion !== AGENT_PROFILE_FORMAT_VERSION
    || normalizeTargetOrigin(profile.targetOrigin) !== profile.targetOrigin
    || typeof profile.appId !== 'string' || profile.appId.length === 0
    || !UUID_V7.test(profile.grantId ?? '') || !UUID_V7.test(profile.actorUserId ?? '')
    || (profile.effectiveUserId !== null && !UUID_V7.test(profile.effectiveUserId ?? ''))
    || !UUID_V7.test(profile.credentialId ?? '')
    || !Number.isSafeInteger(profile.credentialGeneration) || profile.credentialGeneration < 0) {
    throw fail('SNAPBACK_APP_CLI_CREDENTIAL_SOURCE_INVALID', 'agent profile identity is invalid');
  }
  return Object.freeze({ ...profile, credential: credentialReference(profile.credential), path });
}

export async function readCredentialReference(reference, env = process.env) {
  if (reference.kind === 'file') {
    const value = (await safePrivateFile(reference.path, { limitBytes: MAX_SECRET_BYTES, label: 'agent credential' })).trim();
    if (!value.startsWith('sbac_')) throw fail('SNAPBACK_APP_CLI_CREDENTIAL_SOURCE_INVALID', 'agent credential file does not contain an sbac_ credential');
    return value;
  }
  const value = env[reference.name];
  if (typeof value !== 'string' || !value.startsWith('sbac_')) {
    throw fail('SNAPBACK_APP_CLI_CREDENTIAL_SOURCE_INVALID', `environment variable ${reference.name} does not contain an sbac_ credential`);
  }
  return value;
}

const sessionSource = async ({ sessionBearer, sessionBearerFile, env }) => {
  const candidates = [];
  if (sessionBearer !== undefined && sessionBearer !== null) candidates.push({ source: 'flag:session-bearer', value: sessionBearer });
  if (sessionBearerFile !== undefined && sessionBearerFile !== null) {
    const value = (await safePrivateFile(sessionBearerFile, { limitBytes: MAX_SECRET_BYTES, label: 'session bearer' })).trim();
    candidates.push({ source: 'flag:session-bearer-file', value });
  }
  if (typeof env[SESSION_BEARER_ENV] === 'string' && env[SESSION_BEARER_ENV].length > 0) {
    candidates.push({ source: `env:${SESSION_BEARER_ENV}`, value: env[SESSION_BEARER_ENV] });
  }
  return candidates;
};

const agentSource = ({ agentProfile, env }) => {
  const candidates = [];
  if (agentProfile !== undefined && agentProfile !== null) candidates.push({ source: 'flag:agent-profile', path: agentProfile });
  if (typeof env[AGENT_PROFILE_ENV] === 'string' && env[AGENT_PROFILE_ENV].length > 0) {
    candidates.push({ source: `env:${AGENT_PROFILE_ENV}`, path: env[AGENT_PROFILE_ENV] });
  }
  return candidates;
};

const oneOrRefuse = (candidates, label) => {
  if (candidates.length > 1) {
    throw fail('SNAPBACK_APP_CLI_USAGE', `${label} is ambiguous`, { sources: candidates.map((entry) => entry.source) });
  }
  return candidates[0] ?? null;
};

export async function selectPrincipal({
  requested = PRINCIPAL.ANONYMOUS,
  devUser = null,
  sessionBearer = null,
  sessionBearerFile = null,
  agentProfile = null,
  env = process.env,
} = {}) {
  if (!Object.values(PRINCIPAL).includes(requested)) {
    throw fail('SNAPBACK_APP_CLI_USAGE', `unknown principal '${requested}'`);
  }
  if (requested === PRINCIPAL.ANONYMOUS) return Object.freeze({ principalClass: PRINCIPAL.ANONYMOUS, source: 'default:anonymous' });
  if (requested === PRINCIPAL.DEV) {
    if (typeof devUser !== 'string' || devUser.length === 0) throw fail('SNAPBACK_APP_CLI_USAGE', '--principal dev requires --dev-user');
    return Object.freeze({ principalClass: PRINCIPAL.DEV, source: 'flag:dev-user', devUser });
  }
  const sessions = await sessionSource({ sessionBearer, sessionBearerFile, env });
  const agents = agentSource({ agentProfile, env });
  if (requested === PRINCIPAL.SESSION) {
    const selected = oneOrRefuse(sessions, 'session credential source');
    if (selected === null) throw fail('SNAPBACK_APP_CLI_USAGE', '--principal session requires a non-custodial bearer source');
    if (typeof selected.value !== 'string' || !selected.value.startsWith('sbs_')) {
      throw fail('SNAPBACK_APP_CLI_CREDENTIAL_SOURCE_INVALID', 'the selected session source is malformed');
    }
    return Object.freeze({ principalClass: PRINCIPAL.SESSION, source: selected.source, bearerToken: selected.value });
  }
  if (requested === PRINCIPAL.AGENT) {
    const selected = oneOrRefuse(agents, 'agent profile source');
    if (selected === null) throw fail('SNAPBACK_APP_CLI_USAGE', '--principal agent requires a credential profile');
    return Object.freeze({ principalClass: PRINCIPAL.AGENT, source: selected.source, profile: await readAgentProfile(selected.path) });
  }
  const live = [...sessions.map((entry) => ({ ...entry, principalClass: PRINCIPAL.SESSION })), ...agents.map((entry) => ({ ...entry, principalClass: PRINCIPAL.AGENT }))];
  const selected = oneOrRefuse(live, '--principal auto source inventory');
  if (selected === null) return Object.freeze({ principalClass: PRINCIPAL.ANONYMOUS, source: 'auto:none' });
  // Validate the selected source now; never fall through after a malformed or
  // stale candidate has made itself live.
  return selectPrincipal({
    requested: selected.principalClass,
    sessionBearer: selected.principalClass === PRINCIPAL.SESSION ? selected.value : null,
    agentProfile: selected.principalClass === PRINCIPAL.AGENT ? selected.path : null,
    env: {},
  });
}

const descriptorDiscovery = (descriptor) => ({ appCliDescriptor: descriptor ?? null });

export function assertPrincipalAdmitted(descriptor, principalClass) {
  const discovery = descriptorDiscovery(descriptor);
  if (!targetAdmitsPrincipal(discovery, principalClass)) refuseUnadmittedPrincipal(discovery, principalClass);
}

export function preflightFunctionPrincipal(fn, selection) {
  if (selection.principalClass === PRINCIPAL.ANONYMOUS && fn.authRequirement === 'authenticated') {
    throw fail('SNAPBACK_APP_CLI_USAGE', `function '${fn.name}' requires an authenticated principal`, { functionId: fn.id });
  }
}

const directJsonRequest = (origin, path, body, {
  bearer = null,
  limitBytes = MAX_LIFECYCLE_RESPONSE_BYTES,
  timeoutMs = LIFECYCLE_TIMEOUT_MS,
} = {}) => new Promise((resolvePromise, reject) => {
  const targetOrigin = normalizeTargetOrigin(origin);
  if (!isLiteralLoopbackOrigin(targetOrigin)) {
    reject(fail('SNAPBACK_APP_CLI_AGENT_ORIGIN_UNSAFE', 'agent credentials are restricted to literal loopback origins'));
    return;
  }
  const url = new URL(path, targetOrigin);
  const transport = url.protocol === 'https:' ? httpsRequest : httpRequest;
  const encoded = body === null ? null : Buffer.from(JSON.stringify(body));
  const request = transport(url, {
    method: body === null ? 'GET' : 'POST',
    headers: {
      accept: 'application/json',
      'x-snapback-auth-client-protocol': '1',
      ...(encoded === null ? {} : { 'content-type': 'application/json', 'content-length': encoded.byteLength }),
      ...(bearer === null ? {} : { authorization: `Bearer ${bearer}` }),
    },
  });
  request.setTimeout(timeoutMs, () => request.destroy(
    fail('SNAPBACK_APP_CLI_TIMEOUT', 'credentialed lifecycle request timed out'),
  ));
  request.once('socket', (socket) => {
    socket.once('connect', () => {
      const peer = socket.remoteAddress?.replace(/^::ffff:/u, '') ?? '';
      if (peer !== '127.0.0.1' && peer !== '::1') request.destroy(fail('SNAPBACK_APP_CLI_AGENT_ORIGIN_UNSAFE', 'agent credential transport connected to a non-loopback peer'));
    });
  });
  request.once('response', (response) => {
    if (response.statusCode >= 300 && response.statusCode < 400) {
      response.resume();
      reject(fail('SNAPBACK_APP_CLI_TRANSPORT_FAILED', 'credentialed lifecycle redirects are terminal', { status: response.statusCode }));
      return;
    }
    const chunks = [];
    let received = 0;
    response.on('data', (chunk) => {
      received += chunk.length;
      if (received > limitBytes) request.destroy(fail('SNAPBACK_APP_CLI_TRANSPORT_FAILED', 'credentialed lifecycle response exceeded its ingress bound'));
      else chunks.push(chunk);
    });
    response.once('end', () => {
      const text = Buffer.concat(chunks).toString('utf8');
      let payload = null;
      if (text.length > 0) {
        try { payload = JSON.parse(text); } catch (cause) {
          reject(fail('SNAPBACK_APP_CLI_TRANSPORT_FAILED', 'credentialed lifecycle response was not JSON', undefined, cause));
          return;
        }
      }
      if (response.statusCode < 200 || response.statusCode >= 300) {
        const diagnostic = payload?.diagnostic ?? {};
        const error = fail(
          diagnostic.code ?? 'SNAPBACK_APP_CLI_AUTH_REFUSED',
          'credentialed lifecycle request was refused',
          { status: response.statusCode },
        );
        error.status = response.statusCode;
        reject(error);
        return;
      }
      resolvePromise(Object.freeze({ status: response.statusCode, payload }));
    });
  });
  request.once('error', reject);
  if (encoded !== null) request.end(encoded); else request.end();
});

export const mintAgentToken = async (origin, { credential, grantId, pairingRequestId, ttlMs = DEFAULT_AGENT_TOKEN_TTL_MS }) => {
  const body = { credential, ttlMs, ...(grantId === undefined ? { pairingRequestId } : { grantId }) };
  return (await directJsonRequest(origin, '/auth/agents/token', body)).payload;
};

export const releaseAgentToken = async (origin, token) => {
  await directJsonRequest(origin, '/auth/agents/token/release', { token }, { timeoutMs: RELEASE_TIMEOUT_MS });
};

export const pairAgentGrant = async (origin, { credential, pairingRequestId, pairingCode, requestedScopes }) => (
  await directJsonRequest(origin, '/auth/agents/pair', { credential, pairingRequestId, pairingCode, requestedScopes })
).payload;

const admissionKey = (origin, appId, grantId) => createHash('sha256')
  .update(`${origin}\0${appId}\0${grantId}`, 'utf8').digest('hex');

export const defaultAuthorityRoot = () => join(homedir(), '.snapback', 'app-cli', 'authority');

const ensurePrivateDirectory = async (root) => {
  requirePosix();
  await mkdir(root, { recursive: true, mode: 0o700 });
  await assertSafeAncestors(join(root, '.snapback-app-cli-sentinel'));
  const info = await lstat(root);
  if (!info.isDirectory() || info.isSymbolicLink() || info.uid !== process.getuid() || (info.mode & 0o777) !== 0o700) {
    throw fail('SNAPBACK_APP_CLI_CREDENTIAL_SOURCE_INVALID', 'authority root must be an owner-owned real mode-0700 directory', { root });
  }
};

export async function acquireAgentAdmission({
  root = defaultAuthorityRoot(), origin, appId, grantId, capacity,
  waitMs = DEFAULT_AGENT_ADMISSION_WAIT_MS, leaseMs = DEFAULT_AGENT_TOKEN_TTL_MS,
}) {
  if (!Number.isInteger(capacity) || capacity < 1) throw fail('SNAPBACK_APP_CLI_PRINCIPAL_UNSUPPORTED', 'target supplied no usable per-grant token cap');
  const boundedCapacity = Math.max(1, capacity - 2); // watch + renewal headroom
  const directory = join(resolve(root), admissionKey(origin, appId, grantId));
  await ensurePrivateDirectory(resolve(root));
  await mkdir(directory, { mode: 0o700 }).catch((error) => { if (error.code !== 'EEXIST') throw error; });
  const deadline = Date.now() + waitMs;
  for (;;) {
    const now = Date.now();
    for (const name of await readdir(directory).catch(() => [])) {
      if (!/^slot-[0-9]+\.json$/u.test(name)) continue;
      const path = join(directory, name);
      const lease = await readFile(path, 'utf8').then(JSON.parse).catch(() => null);
      if (Number.isSafeInteger(lease?.expiresAtMs) && lease.expiresAtMs <= now) {
        await rm(path, { force: true });
      } else if (!Number.isSafeInteger(lease?.expiresAtMs)) {
        // A reader can observe the short truncate/write window during a live
        // renewal. Reclaim an incomplete crash residue only after a full lease
        // interval, never from one malformed observation.
        const info = await lstat(path).catch(() => null);
        if (info !== null && now - info.mtimeMs > leaseMs) await rm(path, { force: true });
      }
    }
    for (let slot = 0; slot < boundedCapacity; slot += 1) {
      const path = join(directory, `slot-${slot}.json`);
      try {
        const handle = await open(path, 'wx', 0o600);
        const writeLease = async (ttlMs) => {
          await handle.truncate(0);
          await handle.write(`${JSON.stringify({ pid: process.pid, expiresAtMs: Date.now() + ttlMs })}\n`, 0, 'utf8');
          await handle.sync();
        };
        await writeLease(leaseMs);
        let released = false;
        return Object.freeze({
          async renew(ttlMs) {
            if (released) throw fail('SNAPBACK_APP_CLI_CREDENTIAL_SOURCE_INVALID', 'agent admission lease is already released');
            if (!Number.isSafeInteger(ttlMs) || ttlMs < 1) {
              throw fail('SNAPBACK_APP_CLI_CREDENTIAL_SOURCE_INVALID', 'agent admission lease TTL is invalid');
            }
            await writeLease(ttlMs);
          },
          async release() {
            if (released) return;
            released = true;
            try { await handle.close(); } finally { await rm(path, { force: true }); }
          },
        });
      } catch (error) {
        if (error?.code !== 'EEXIST') throw error;
      }
    }
    if (Date.now() >= deadline) throw fail('SNAPBACK_APP_CLI_AGENT_ADMISSION_TIMEOUT', 'agent invocation could not enter the bounded per-grant admission gate', { capacity: boundedCapacity });
    await new Promise((tick) => { setTimeout(tick, 50); });
  }
}

export async function principalClient(baseUrl, appSurface, selection, {
  env = process.env,
  authorityRoot = defaultAuthorityRoot(),
  admissionWaitMs = DEFAULT_AGENT_ADMISSION_WAIT_MS,
  tokenTtlMs = DEFAULT_AGENT_TOKEN_TTL_MS,
} = {}) {
  const origin = normalizeTargetOrigin(baseUrl);
  const descriptor = appSurface.appCliDescriptor ?? null;
  assertPrincipalAdmitted(descriptor, selection.principalClass);
  if (selection.principalClass === PRINCIPAL.ANONYMOUS) {
    return Object.freeze({ client: new SnapbackAppDataClient(origin, { custody: 'anonymous-public' }), async close() {} });
  }
  if (selection.principalClass === PRINCIPAL.DEV) {
    const innerClient = new SnapbackAppDataClient(origin, { custody: 'anonymous-public' });
    // The headless client's dev assertion is a per-operation `userId`, not a
    // constructor default. Keep the façade narrow and inject it on exactly
    // the app-CLI call families so sessions mode can reject the legacy body
    // authority at the server gate.
    const client = Object.freeze({
      query: (ref, options = {}) => innerClient.query(ref, { ...options, userId: selection.devUser }),
      mutate: (ref, options = {}) => innerClient.mutate(ref, { ...options, userId: selection.devUser }),
      action: (ref, options = {}) => innerClient.action(ref, { ...options, userId: selection.devUser }),
      subscribeLive: (ref, options = {}) => innerClient.subscribeLive(ref, { ...options, userId: selection.devUser }),
      startLiveQuery: (ref, options = {}) => innerClient.startLiveQuery(ref, { ...options, userId: selection.devUser }),
    });
    return Object.freeze({ client, async close() {} });
  }
  if (selection.principalClass === PRINCIPAL.SESSION) {
    return Object.freeze({ client: createExternalSessionAppDataClient(origin, { bearerToken: selection.bearerToken }), async close() {} });
  }
  if (!isLiteralLoopbackOrigin(origin)) throw fail('SNAPBACK_APP_CLI_AGENT_ORIGIN_UNSAFE', 'agent credentials are restricted to literal loopback origins');
  const profile = selection.profile;
  if (profile.targetOrigin !== origin || profile.appId !== appSurface.appId) {
    throw fail('SNAPBACK_APP_CLI_CREDENTIAL_SOURCE_INVALID', 'agent profile does not bind this target and app');
  }
  const descriptorFacts = targetDescriptor(descriptorDiscovery(descriptor));
  const admission = await acquireAgentAdmission({
    root: authorityRoot, origin, appId: appSurface.appId, grantId: profile.grantId,
    capacity: descriptorFacts?.perGrantTokenCap, waitMs: admissionWaitMs, leaseMs: tokenTtlMs,
  });
  const credential = await readCredentialReference(profile.credential, env);
  let issued;
  const attestIssuedTuple = (receipt) => {
    if (receipt.actorUserId !== profile.actorUserId || receipt.effectiveUserId !== profile.effectiveUserId
      || receipt.credentialId !== profile.credentialId
      || receipt.credentialGeneration !== profile.credentialGeneration
      || receipt.grantId !== profile.grantId
      || typeof receipt.token !== 'string' || !receipt.token.startsWith('sbagt_')
      || !Number.isSafeInteger(receipt.expiresInMs) || receipt.expiresInMs < 1) {
      throw fail('SNAPBACK_APP_CLI_CREDENTIAL_SOURCE_INVALID', 'minted token authority does not match the durable profile tuple');
    }
  };
  try {
    issued = await mintAgentToken(origin, { credential, grantId: profile.grantId, ttlMs: tokenTtlMs });
    attestIssuedTuple(issued);
    await admission.renew(issued.expiresInMs);
    const authority = new AgentAuthorityFence({
      actorUserId: issued.actorUserId,
      credentialId: issued.credentialId,
      credentialGeneration: issued.credentialGeneration,
      grantId: issued.grantId,
      tokenId: issued.tokenId,
      bearerToken: issued.token,
    });
    const client = new SnapbackAppDataClient(origin, { agentAuthority: authority, authInvalidationProtocol: 1 });
    let closed = false;
    let renewalTimer = null;
    let renewing = null;
    let resolveRenewalTerminal;
    const renewalTerminal = new Promise((resolvePromise) => { resolveRenewalTerminal = resolvePromise; });
    const releaseWithRetry = async (token) => {
      try { await releaseAgentToken(origin, token); } catch {
        try { await releaseAgentToken(origin, token); } catch { /* TTL is the crash-safe backstop. */ }
      }
    };
    const scheduleRenewal = () => {
      if (closed) return;
      const headroom = Math.min(30_000, Math.max(1, Math.floor(issued.expiresInMs / 2)));
      renewalTimer = setTimeout(() => {
        renewing = (async () => {
          let successor;
          try {
            successor = await mintAgentToken(origin, {
              credential,
              grantId: profile.grantId,
              ttlMs: tokenTtlMs,
            });
            attestIssuedTuple(successor);
            if (closed) {
              await releaseWithRetry(successor.token);
              return;
            }
            await admission.renew(successor.expiresInMs);
            await client.replaceAgentCredential({
              actorUserId: successor.actorUserId,
              credentialId: successor.credentialId,
              credentialGeneration: successor.credentialGeneration,
              grantId: successor.grantId,
              tokenId: successor.tokenId,
              bearerToken: successor.token,
            });
            const predecessor = issued;
            issued = successor;
            successor = null;
            await releaseWithRetry(predecessor.token);
            scheduleRenewal();
          } catch (error) {
            if (successor?.token) await releaseWithRetry(successor.token);
            if (!closed) {
              const terminal = authority.terminate(authority.capture(), {
                authorityDisposition: 'carrier',
                terminalError: error,
              });
              await terminal?.settlement?.catch(() => {});
              resolveRenewalTerminal(error);
            }
          }
        })();
      }, Math.max(1, issued.expiresInMs - headroom));
    };
    scheduleRenewal();
    return Object.freeze({
      client,
      tokenExpiresInMs: issued.expiresInMs,
      renewalTerminal,
      async close() {
        if (closed) return;
        closed = true;
        clearTimeout(renewalTimer);
        try {
          await renewing;
          await releaseWithRetry(issued.token);
        } finally {
          await admission.release();
        }
      },
    });
  } catch (error) {
    if (issued?.token) {
      await releaseAgentToken(origin, issued.token).catch(async () => {
        await releaseAgentToken(origin, issued.token).catch(() => {});
      });
    }
    await admission.release();
    throw error;
  }
}

export async function writeAgentProfile(path, profile) {
  requirePosix();
  if (!isAbsolute(path) || resolve(path) !== path) {
    throw fail('SNAPBACK_APP_CLI_CREDENTIAL_SOURCE_INVALID', 'agent profile output must be an absolute normalized path');
  }
  const absolute = path;
  await ensurePrivateDirectory(dirname(absolute));
  const record = {
    formatVersion: AGENT_PROFILE_FORMAT_VERSION,
    targetOrigin: normalizeTargetOrigin(profile.targetOrigin),
    appId: profile.appId,
    grantId: profile.grantId,
    actorUserId: profile.actorUserId,
    effectiveUserId: profile.effectiveUserId ?? null,
    credentialId: profile.credentialId,
    credentialGeneration: profile.credentialGeneration,
    credential: credentialReference(profile.credential),
  };
  const temporary = `${absolute}.tmp-${process.pid}`;
  let temporaryHandle;
  try {
    temporaryHandle = await open(temporary, 'wx', 0o600);
    await temporaryHandle.writeFile(`${JSON.stringify(record, null, 2)}\n`);
    await temporaryHandle.sync();
    await temporaryHandle.close();
    temporaryHandle = null;
    await rename(temporary, absolute);
    const directory = await open(dirname(absolute), fsConstants.O_RDONLY | (fsConstants.O_CLOEXEC ?? 0));
    try { await directory.sync(); } finally { await directory.close(); }
  } catch (error) {
    await temporaryHandle?.close().catch(() => {});
    await rm(temporary, { force: true }).catch(() => {});
    throw error;
  }
  return readAgentProfile(absolute);
}

export async function onboardAgentProfile({
  origin,
  appId,
  profilePath,
  credential,
  credentialReference: reference,
  pairingRequestId,
  pairingCode,
  requestedScopes,
  waitMs = 120_000,
  pollMs = 500,
}) {
  const targetOrigin = normalizeTargetOrigin(origin);
  if (!isLiteralLoopbackOrigin(targetOrigin)) {
    throw fail('SNAPBACK_APP_CLI_AGENT_ORIGIN_UNSAFE', 'agent pairing is restricted to literal loopback origins');
  }
  await pairAgentGrant(targetOrigin, { credential, pairingRequestId, pairingCode, requestedScopes });
  const deadline = Date.now() + waitMs;
  let issued;
  for (;;) {
    try {
      issued = await mintAgentToken(targetOrigin, { credential, pairingRequestId, ttlMs: DEFAULT_AGENT_TOKEN_TTL_MS });
      break;
    } catch (error) {
      if (error?.code !== 'SNAPBACK_AUTH_GRANT_PENDING' || Date.now() >= deadline) throw error;
      await new Promise((tick) => { setTimeout(tick, pollMs); });
    }
  }
  try {
    return await writeAgentProfile(profilePath, {
      targetOrigin,
      appId,
      grantId: issued.grantId,
      actorUserId: issued.actorUserId,
      effectiveUserId: issued.effectiveUserId,
      credentialId: issued.credentialId,
      credentialGeneration: issued.credentialGeneration,
      credential: reference,
    });
  } finally {
    // Pairing only persists the durable grant/profile tuple. Its first scoped
    // token is released immediately and never enters the profile.
    await releaseAgentToken(targetOrigin, issued.token).catch(async () => {
      await releaseAgentToken(targetOrigin, issued.token).catch(() => {});
    });
  }
}
