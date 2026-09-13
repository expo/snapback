// The public package exposes a deliberately closed hosted surface while the
// standing-supervisor transport is completed. Read commands reuse the
// target-neutral control plane. Lifecycle commands accept only the generated
// V2 carrier and submit a separately device-signed SupervisorRequestV1 over
// certificate-pinned mTLS. The CLI never resolves a Fly/Tigris credential.
//
// @ref LLP 0111#closed-request-and-command-registry — command spellings and
// lifecycle variants are exhaustive; unknown combinations fail closed.
// @ref LLP 0111#public-operator-and-command-authority — provider credentials
// stay behind an adapter/supervisor boundary and never enter CLI output.

import {
  X509Certificate,
  createHash,
  createPublicKey,
  verify,
} from 'node:crypto';
import {
  lstatSync,
  readFileSync,
  realpathSync,
} from 'node:fs';
import { request as httpsRequest } from 'node:https';
import { dirname, join, resolve } from 'node:path';
import { checkServerIdentity } from 'node:tls';
import { fileURLToPath } from 'node:url';

import {
  inspectTargetAdmin,
  queryControlLogs,
  showTarget,
} from './deployment-control.mjs';

const packageRoot = dirname(fileURLToPath(import.meta.url));
const DIGEST = /^sha256:[0-9a-f]{64}$/;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,255}$/;
const RFC3339_MILLIS = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const MAX_REQUEST_BYTES = 4 * 1024 * 1024;
const MAX_OPERATOR_RESPONSE_BYTES = 64 * 1024 * 1024;
const DEFAULT_OPERATOR_RESPONSE_CLOCK_SKEW_MS = 30_000;
const INTERMEDIATE_DOMAIN = Buffer.from('snapback-supervisor-service-intermediate-v1\0');
const RESPONSE_DOMAIN = Buffer.from('snapback-supervisor-response-v1\0');
const ED25519_SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');
const OPERATOR_RESPONSE_KEYS = Object.freeze([
  'audience',
  'body',
  'bodySha256',
  'expiresAt',
  'installationId',
  'issuedAt',
  'keyId',
  'notBefore',
  'operatorCertificateSha256',
  'requestId',
  'requestSha256',
  'schemaVersion',
  'serviceIntermediate',
  'signature',
  'supervisorGeneration',
  'supervisorHeadSha256',
  'supervisorIncarnation',
  'targetHeadSha256',
]);
const INTERMEDIATE_KEYS = Object.freeze([
  'expiresAt',
  'installationId',
  'intermediateKeyId',
  'issuedAt',
  'notBefore',
  'publicKeyEd25519',
  'purpose',
  'revocationGeneration',
  'rootKeyId',
  'schemaVersion',
  'serial',
  'signature',
]);
const LIFECYCLE_REQUEST_KEYS = Object.freeze([
  'attempt',
  'confirmationSha256',
  'effectIntent',
  'lease',
  'operation',
  'operationId',
  'planSha256',
  'predecessorHead',
  'requestSha256',
  'schemaVersion',
  'targetBinding',
]);
const HOSTED_LIFECYCLE_RECOMMENDED_NEXT = Object.freeze({
  owner: 'Snapback hosted control plane',
  ticketOrDesignPointer: 'issues/shelved/20260728-hosted-lifecycle-carrier-and-custody-gap.md',
  note: 'Complete the reviewed per-operation carrier, supervisor-only lease custody, bootstrap/listener proof, and live Fly/Tigris journey before enabling lifecycle effects.',
});

function lifecycleEntry(operation) {
  return Object.freeze({
    kind: 'lifecycle',
    operation,
    availability: 'disabled',
    blockerCode: 'SNAPBACK_HOSTED_LIFECYCLE_CARRIER_INCOMPLETE',
  });
}

export const HOSTED_LIFECYCLE_VERBS = Object.freeze({
  'acquire-lease': 'acquireLease',
  'renew-lease': 'renewLease',
  'upload-immutable-release': 'uploadImmutableRelease',
  'provision-inactive': 'provisionInactive',
  'compatibility-preflight': 'compatibilityPreflight',
  'create-verified-backup': 'createVerifiedBackup',
  'stage-release': 'stageRelease',
  'activate-generation': 'activateGeneration',
  'verify-served-path': 'verifyServedPath',
  rollback: 'rollback',
  'fence-external-effects': 'fenceExternalEffects',
  'restore-backup-inactive': 'restoreBackupInactive',
  'verify-restored-components': 'verifyRestoredComponents',
  'verify-restored-application': 'verifyRestoredApplication',
  'activate-restored-generation': 'activateRestoredGeneration',
  'reconcile-effect': 'reconcileEffect',
  'release-lease': 'releaseLease',
});

export const HOSTED_COMMAND_REGISTRY = Object.freeze({
  plan: Object.freeze({ kind: 'read', operation: 'plan' }),
  inspect: Object.freeze({ kind: 'read', operation: 'inspectAdmin' }),
  logs: Object.freeze({ kind: 'read', operation: 'logs' }),
  ...Object.fromEntries(
    Object.entries(HOSTED_LIFECYCLE_VERBS)
      .map(([verb, operation]) => [`lifecycle ${verb}`, lifecycleEntry(operation)]),
  ),
});

export const HOSTED_ASSETS = Object.freeze({
  flyDriver: 'adapters/fly-machines-vm-driver.mjs',
  schemas: Object.freeze({
    flyTargetBindingV2: 'hosted-schemas/fly-target.binding-v2.schema.json',
    hostedControlHeadV2: 'hosted-schemas/hosted-control-head-v2.schema.json',
    lifecycleRequestV2: 'hosted-schemas/vm-adapter.lifecycle-request-v2.schema.json',
    lifecycleResponseV2: 'hosted-schemas/vm-adapter.lifecycle-response-v2.schema.json',
  }),
});

function fail(code, message, details = undefined) {
  const error = new Error(message);
  error.code = code;
  error.diagnostic = {
    code,
    severity: 'error',
    subsystem: 'hosted-control',
    message,
    ...(details === undefined ? {} : { details }),
  };
  return error;
}

function sha256(bytes) {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function assertClosed(value, keys, name) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
      || JSON.stringify(Object.keys(value).sort()) !== JSON.stringify([...keys].sort())) {
    throw fail('SNAPBACK_HOSTED_REQUEST_INVALID', `${name} must use its exact generated field set`);
  }
}

function readRegularFile(path, code) {
  const absolute = resolve(path);
  let stat;
  try {
    stat = lstatSync(absolute);
  } catch {
    throw fail(code, 'hosted request file is unavailable', { path: absolute });
  }
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size < 2 || stat.size > MAX_REQUEST_BYTES) {
    throw fail(code, 'hosted request must be a bounded regular non-symlink file', { path: absolute });
  }
  return { absolute: realpathSync.native(absolute), bytes: readFileSync(absolute) };
}

function readTransportFile(path, {
  code = 'SNAPBACK_HOSTED_OPERATOR_CREDENTIAL_UNAVAILABLE',
  privateCredential = false,
} = {}) {
  const file = readRegularFile(path, code);
  const stat = lstatSync(file.absolute);
  if (
    (typeof process.getuid === 'function' && stat.uid !== process.getuid())
    || (privateCredential && (stat.mode & 0o077) !== 0)
  ) {
    throw fail(
      code,
      privateCredential
        ? 'operator private credential must be owner-owned mode 0600'
        : 'operator trust file must be owned by the current user',
    );
  }
  return file;
}

function signatureBytes(value, label) {
  if (typeof value !== 'string' || value.length > 512) {
    throw fail('SNAPBACK_HOSTED_OPERATOR_RESPONSE_INVALID', `${label} signature is malformed`);
  }
  const bytes = Buffer.from(value, 'base64url');
  if (bytes.length !== 64 || bytes.toString('base64url') !== value) {
    throw fail('SNAPBACK_HOSTED_OPERATOR_RESPONSE_INVALID', `${label} signature is malformed`);
  }
  return bytes;
}

function unsigned(value) {
  const { signature: _signature, ...content } = value;
  return content;
}

function verifyOperatorResponse(response, request, rootPublicKeyPem, {
  nowMs = Date.now(),
  clockSkewMs = DEFAULT_OPERATOR_RESPONSE_CLOCK_SKEW_MS,
  minimumRevocationGeneration = 1,
} = {}) {
  if (!Number.isSafeInteger(nowMs)
    || !Number.isSafeInteger(clockSkewMs) || clockSkewMs < 0
    || !Number.isSafeInteger(minimumRevocationGeneration) || minimumRevocationGeneration < 1) {
    throw fail(
      'SNAPBACK_HOSTED_OPERATOR_RESPONSE_INVALID',
      'supervisor response verification time or revocation floor is invalid',
    );
  }
  assertClosed(response, OPERATOR_RESPONSE_KEYS, 'SupervisorResponseV1');
  assertClosed(response.serviceIntermediate, INTERMEDIATE_KEYS, 'SupervisorServiceIntermediateV1');
  assertClosed(
    response.body,
    ['diagnostic', 'ok', 'result', 'schemaVersion'],
    'SupervisorResponseBodyV1',
  );
  if (response.body.diagnostic !== null) {
    assertClosed(
      response.body.diagnostic,
      ['code', 'message', 'status'],
      'SupervisorResponseDiagnosticV1',
    );
  }
  const intermediate = response.serviceIntermediate;
  const requestSha256 = sha256(Buffer.concat([
    Buffer.from('snapback-supervisor-retained-request-v1\0'),
    Buffer.from(canonicalJson(request)),
  ]));
  if (
    response.schemaVersion !== 'snapback.supervisor-response.v1'
    || response.audience !== 'snapback-operator'
    || response.installationId !== request.installationId
    || response.requestId !== request.requestId
    || response.requestSha256 !== requestSha256
    || response.operatorCertificateSha256 !== request.operatorCertificateSha256
    || response.targetHeadSha256 !== request.targetHeadSha256
    || response.keyId !== intermediate.intermediateKeyId
    || intermediate.schemaVersion !== 'snapback.supervisor-service-intermediate.v1'
    || intermediate.installationId !== request.installationId
    || intermediate.rootKeyId !== request.rootKeyId
    || intermediate.purpose !== 'supervisor-response'
    || typeof intermediate.intermediateKeyId !== 'string'
    || intermediate.intermediateKeyId.length < 1
    || !Number.isSafeInteger(intermediate.serial)
    || intermediate.serial < 1
    || !Number.isSafeInteger(intermediate.revocationGeneration)
    || intermediate.revocationGeneration < 1
    || intermediate.revocationGeneration < minimumRevocationGeneration
    || response.body.schemaVersion !== 'snapback.supervisor-response-body.v1'
    || typeof response.body.ok !== 'boolean'
    || (response.body.ok && response.body.diagnostic !== null)
    || (!response.body.ok && (
      typeof response.body.diagnostic?.code !== 'string'
      || typeof response.body.diagnostic?.message !== 'string'
      || !Number.isSafeInteger(response.body.diagnostic?.status)
      || response.body.diagnostic.status < 400
      || response.body.diagnostic.status > 599
    ))
    || typeof response.supervisorIncarnation !== 'string'
    || response.supervisorIncarnation.length < 1
    || !Number.isSafeInteger(response.supervisorGeneration)
    || response.supervisorGeneration < 1
    || !DIGEST.test(response.supervisorHeadSha256 ?? '')
    || !(response.targetHeadSha256 === null || DIGEST.test(response.targetHeadSha256 ?? ''))
    || !DIGEST.test(response.bodySha256 ?? '')
    || sha256(Buffer.from(canonicalJson(response.body))) !== response.bodySha256
  ) {
    throw fail(
      'SNAPBACK_HOSTED_OPERATOR_RESPONSE_INVALID',
      'supervisor response identity, purpose, request, or body binding is invalid',
    );
  }
  const issuedAtMs = Date.parse(response.issuedAt);
  const notBeforeMs = Date.parse(response.notBefore);
  const expiresAtMs = Date.parse(response.expiresAt);
  const intermediateIssuedAtMs = Date.parse(intermediate.issuedAt);
  const intermediateNotBeforeMs = Date.parse(intermediate.notBefore);
  const intermediateExpiresAtMs = Date.parse(intermediate.expiresAt);
  if (
    !RFC3339_MILLIS.test(response.issuedAt ?? '')
    || !RFC3339_MILLIS.test(response.notBefore ?? '')
    || !RFC3339_MILLIS.test(response.expiresAt ?? '')
    || !RFC3339_MILLIS.test(intermediate.issuedAt ?? '')
    || !RFC3339_MILLIS.test(intermediate.notBefore ?? '')
    || !RFC3339_MILLIS.test(intermediate.expiresAt ?? '')
    || !Number.isSafeInteger(issuedAtMs)
    || !Number.isSafeInteger(notBeforeMs)
    || !Number.isSafeInteger(expiresAtMs)
    || issuedAtMs !== notBeforeMs
    || expiresAtMs <= notBeforeMs
    || expiresAtMs - issuedAtMs > 10 * 60 * 1000
    || nowMs < notBeforeMs - clockSkewMs
    || nowMs > expiresAtMs + clockSkewMs
    || !Number.isSafeInteger(intermediateIssuedAtMs)
    || !Number.isSafeInteger(intermediateNotBeforeMs)
    || !Number.isSafeInteger(intermediateExpiresAtMs)
    || intermediateIssuedAtMs > intermediateNotBeforeMs
    || intermediateExpiresAtMs <= intermediateNotBeforeMs
    || issuedAtMs < intermediateNotBeforeMs
    || issuedAtMs > intermediateExpiresAtMs
    || intermediateExpiresAtMs - intermediateNotBeforeMs > 7 * 24 * 60 * 60 * 1000
    || nowMs < intermediateNotBeforeMs - clockSkewMs
    || nowMs > intermediateExpiresAtMs + clockSkewMs
  ) {
    throw fail(
      'SNAPBACK_HOSTED_OPERATOR_RESPONSE_INVALID',
      'supervisor response was not issued inside its bounded intermediate interval',
    );
  }
  const rootPublicKey = createPublicKey(rootPublicKeyPem);
  if (!verify(
    null,
    Buffer.concat([
      INTERMEDIATE_DOMAIN,
      Buffer.from(canonicalJson(unsigned(intermediate))),
    ]),
    rootPublicKey,
    signatureBytes(intermediate.signature, 'intermediate'),
  )) {
    throw fail(
      'SNAPBACK_HOSTED_OPERATOR_RESPONSE_INVALID',
      'supervisor response intermediate root signature did not verify',
    );
  }
  const rawPublicKey = Buffer.from(intermediate.publicKeyEd25519 ?? '', 'base64url');
  if (
    rawPublicKey.length !== 32
    || rawPublicKey.toString('base64url') !== intermediate.publicKeyEd25519
  ) {
    throw fail(
      'SNAPBACK_HOSTED_OPERATOR_RESPONSE_INVALID',
      'supervisor response intermediate key encoding is invalid',
    );
  }
  const responsePublicKey = createPublicKey({
    key: Buffer.concat([ED25519_SPKI_PREFIX, rawPublicKey]),
    format: 'der',
    type: 'spki',
  });
  if (!verify(
    null,
    Buffer.concat([
      RESPONSE_DOMAIN,
      Buffer.from(canonicalJson(unsigned(response))),
    ]),
    responsePublicKey,
    signatureBytes(response.signature, 'response'),
  )) {
    throw fail(
      'SNAPBACK_HOSTED_OPERATOR_RESPONSE_INVALID',
      'supervisor response signature did not verify',
    );
  }
  return response;
}

function requestOperatorEndpoint(endpoint, {
  requestBytes,
  key,
  cert,
  ca,
  serverCertificateSha256,
  timeoutMs,
}) {
  let url;
  try {
    url = new URL(endpoint);
  } catch {
    throw fail('SNAPBACK_HOSTED_OPERATOR_ENDPOINT_INVALID', 'supervisor endpoint is not a URL');
  }
  if (
    url.protocol !== 'https:'
    || url.username
    || url.password
    || url.search
    || url.hash
    || !DIGEST.test(serverCertificateSha256 ?? '')
  ) {
    throw fail(
      'SNAPBACK_HOSTED_OPERATOR_ENDPOINT_INVALID',
      'supervisor endpoint must be credential-free HTTPS with a certificate digest pin',
    );
  }
  url.pathname = '/v1/operator/request';
  return new Promise((resolvePromise, rejectPromise) => {
    const outgoing = httpsRequest(url, {
      method: 'POST',
      key,
      cert,
      ca,
      minVersion: 'TLSv1.3',
      rejectUnauthorized: true,
      headers: {
        'content-type': 'application/json',
        'content-length': requestBytes.byteLength,
      },
      checkServerIdentity(hostname, certificate) {
        const hostnameError = checkServerIdentity(hostname, certificate);
        if (hostnameError) return hostnameError;
        if (sha256(certificate.raw) !== serverCertificateSha256) {
          return new Error('SNAPBACK_HOSTED_OPERATOR_SERVER_CERTIFICATE_MISMATCH');
        }
        return undefined;
      },
      signal: AbortSignal.timeout(timeoutMs),
    }, (incoming) => {
      const chunks = [];
      let bytes = 0;
      incoming.on('data', (chunk) => {
        bytes += chunk.byteLength;
        if (bytes > MAX_OPERATOR_RESPONSE_BYTES) {
          incoming.destroy(new Error('SNAPBACK_HOSTED_OPERATOR_RESPONSE_TOO_LARGE'));
          return;
        }
        chunks.push(chunk);
      });
      incoming.on('end', () => {
        const body = Buffer.concat(chunks);
        let value;
        try {
          value = JSON.parse(body.toString('utf8'));
        } catch {
          rejectPromise(fail(
            'SNAPBACK_HOSTED_OPERATOR_RESPONSE_INVALID',
            'supervisor did not return one JSON response',
          ));
          return;
        }
        if (incoming.statusCode !== 200) {
          rejectPromise(fail(
            value?.diagnostic?.code ?? 'SNAPBACK_HOSTED_OPERATOR_REQUEST_REFUSED',
            String(value?.diagnostic?.message ?? `supervisor HTTP ${incoming.statusCode}`).slice(0, 512),
          ));
          return;
        }
        resolvePromise(value);
      });
      incoming.on('error', rejectPromise);
    });
    outgoing.on('error', (error) => {
      rejectPromise(fail(
        error.message === 'SNAPBACK_HOSTED_OPERATOR_SERVER_CERTIFICATE_MISMATCH'
          ? 'SNAPBACK_HOSTED_OPERATOR_SERVER_CERTIFICATE_MISMATCH'
          : 'SNAPBACK_HOSTED_OPERATOR_TRANSPORT_FAILED',
        'mutually authenticated supervisor transport failed',
      ));
    });
    outgoing.end(requestBytes);
  });
}

export function resolveHostedAssets() {
  const flyDriver = realpathSync.native(join(packageRoot, HOSTED_ASSETS.flyDriver));
  const schemas = Object.fromEntries(
    Object.entries(HOSTED_ASSETS.schemas)
      .map(([name, path]) => [name, realpathSync.native(join(packageRoot, path))]),
  );
  return {
    flyDriver,
    flyDriverSha256: sha256(readFileSync(flyDriver)),
    schemas,
    schemaSha256: Object.fromEntries(
      Object.entries(schemas).map(([name, path]) => [name, sha256(readFileSync(path))]),
    ),
  };
}

export function createHostedPlan({
  targetId = null,
  controlRoot = undefined,
  ...options
} = {}) {
  const assets = resolveHostedAssets();
  const target = targetId === null ? null : showTarget(targetId, { controlRoot, ...options });
  if (target && target.adapter.provider !== 'fly-machines') {
    throw fail(
      'SNAPBACK_HOSTED_PROVIDER_UNSUPPORTED',
      'the packaged first hosted driver supports only fly-machines targets',
      { provider: target.adapter.provider },
    );
  }
  return {
    schemaVersion: 'snapback.hosted-command-plan.v1',
    ok: true,
    targetId,
    targetDescriptorSha256: target === null
      ? null
      : sha256(Buffer.from(canonicalJson(target))),
    driver: {
      kind: 'fly-machines',
      sha256: assets.flyDriverSha256,
      lifecycleAvailability: 'disabled',
      blockerCode: 'SNAPBACK_HOSTED_LIFECYCLE_CARRIER_INCOMPLETE',
      requiredEvidence: [
        'reviewed closed per-operation carrier',
        'supervisor bootstrap and purpose-key custody',
        'public mTLS listener reachability',
        'live Fly/Tigris provider receipt',
      ],
    },
    commands: Object.entries(HOSTED_COMMAND_REGISTRY).map(([command, entry]) => ({
      command,
      ...entry,
    })),
    schemas: assets.schemaSha256,
  };
}

export function runHostedRead(operation, {
  targetId,
  controlRoot = undefined,
  ...options
}) {
  if (operation === 'inspect') {
    return inspectTargetAdmin(targetId, { controlRoot, ...options });
  }
  if (operation === 'logs') {
    return queryControlLogs(targetId, { controlRoot, ...options });
  }
  throw fail('SNAPBACK_HOSTED_COMMAND_UNKNOWN', 'hosted read command is not in the closed registry');
}

export async function submitHostedOperatorRequest({
  requestPath,
  endpoint,
  clientKeyPath,
  clientCertificatePath,
  serverCaPath,
  rootPublicKeyPath,
  serverCertificateSha256,
  timeoutMs = 30_000,
  minimumRevocationGeneration = 1,
  clockSkewMs = DEFAULT_OPERATOR_RESPONSE_CLOCK_SKEW_MS,
  now = Date.now,
  transport = requestOperatorEndpoint,
} = {}) {
  const requestFile = readRegularFile(
    requestPath,
    'SNAPBACK_HOSTED_OPERATOR_REQUEST_UNAVAILABLE',
  );
  let request;
  try {
    request = JSON.parse(requestFile.bytes);
  } catch {
    throw fail(
      'SNAPBACK_HOSTED_OPERATOR_REQUEST_INVALID',
      'SupervisorRequestV1 file is not one JSON value',
    );
  }
  const key = readTransportFile(clientKeyPath, { privateCredential: true }).bytes;
  const cert = readTransportFile(clientCertificatePath).bytes;
  const ca = readTransportFile(serverCaPath).bytes;
  const rootPublicKey = readTransportFile(rootPublicKeyPath).bytes;
  let certificate;
  try {
    certificate = new X509Certificate(cert);
  } catch {
    throw fail(
      'SNAPBACK_HOSTED_OPERATOR_CREDENTIAL_UNAVAILABLE',
      'operator client certificate is invalid',
    );
  }
  if (
    request?.schemaVersion !== 'snapback.supervisor-request.v1'
    || !SAFE_ID.test(request.requestId ?? '')
    || !DIGEST.test(request.operatorCertificateSha256 ?? '')
    || sha256(certificate.raw) !== request.operatorCertificateSha256
  ) {
    throw fail(
      'SNAPBACK_HOSTED_OPERATOR_REQUEST_INVALID',
      'operator request identity or mTLS certificate digest binding is invalid',
    );
  }
  const response = await transport(endpoint, {
    requestBytes: requestFile.bytes,
    key,
    cert,
    ca,
    serverCertificateSha256,
    timeoutMs,
  });
  return verifyOperatorResponse(response, request, rootPublicKey, {
    nowMs: now(),
    clockSkewMs,
    minimumRevocationGeneration,
  });
}

export async function invokeHostedLifecycle(verb, {
  requestPath,
  operatorRequestPath,
  endpoint,
  clientKeyPath,
  clientCertificatePath,
  serverCaPath,
  rootPublicKeyPath,
  serverCertificateSha256,
  timeoutMs = 30_000,
  submitOperatorRequest = submitHostedOperatorRequest,
} = {}) {
  const operation = HOSTED_LIFECYCLE_VERBS[verb];
  if (!operation) {
    throw fail('SNAPBACK_HOSTED_LIFECYCLE_VERB_UNKNOWN', 'hosted lifecycle verb is not in the closed registry');
  }
  const requestFile = readRegularFile(requestPath, 'SNAPBACK_HOSTED_REQUEST_UNAVAILABLE');
  let request;
  try {
    request = JSON.parse(requestFile.bytes);
  } catch {
    throw fail('SNAPBACK_HOSTED_REQUEST_INVALID', 'hosted lifecycle request is not one JSON value');
  }
  assertClosed(request, LIFECYCLE_REQUEST_KEYS, 'AdapterLifecycleRequestV2');
  if (request.schemaVersion !== 'snapback.vm-adapter-lifecycle-request.v2'
      || request.operation !== operation
      || typeof request.operationId !== 'string'
      || !SAFE_ID.test(request.operationId)
      || typeof request.attempt !== 'number'
      || !Number.isSafeInteger(request.attempt)
      || request.attempt < 0
      || !DIGEST.test(request.planSha256)
      || !DIGEST.test(request.requestSha256)) {
    throw fail(
      'SNAPBACK_HOSTED_REQUEST_INVALID',
      'hosted lifecycle request identity, operation, attempt, or digests are invalid',
    );
  }
  return {
    schemaVersion: 'snapback.hosted-lifecycle-refusal.v1',
    ok: false,
    operation,
    operationId: request.operationId,
    code: 'SNAPBACK_HOSTED_LIFECYCLE_CARRIER_INCOMPLETE',
    requestFileSha256: sha256(requestFile.bytes),
    recommendedNext: HOSTED_LIFECYCLE_RECOMMENDED_NEXT,
    diagnostics: [{
      code: 'SNAPBACK_HOSTED_LIFECYCLE_CARRIER_INCOMPLETE',
      severity: 'error',
      message: operation === 'releaseLease'
        ? 'releaseLease is disabled until a supervisor-only opaque lease journal binds exact expiry, version, generation, and head facts'
        : `${operation} is disabled until its reviewed closed carrier and live supervisor/provider evidence are complete`,
    }],
  };
  /* c8 ignore start -- retained transport implementation is unreachable until
   * the reviewed carrier gate is lifted in the closed registry. */
  if (
    !operatorRequestPath
    || !endpoint
    || !clientKeyPath
    || !clientCertificatePath
    || !serverCaPath
    || !rootPublicKeyPath
    || !serverCertificateSha256
  ) {
    return {
      schemaVersion: 'snapback.hosted-lifecycle-refusal.v1',
      ok: false,
      operation,
      operationId: request.operationId,
      code: 'SNAPBACK_HOSTED_OPERATOR_TRANSPORT_REQUIRED',
      requestFileSha256: sha256(requestFile.bytes),
      diagnostics: [{
        code: 'SNAPBACK_HOSTED_OPERATOR_TRANSPORT_REQUIRED',
        severity: 'error',
        message: 'lifecycle effects require a signed operator request and certificate-pinned supervisor mTLS transport',
      }],
    };
  }
  const operatorRequestFile = readRegularFile(
    operatorRequestPath,
    'SNAPBACK_HOSTED_OPERATOR_REQUEST_UNAVAILABLE',
  );
  let operatorRequest;
  try {
    operatorRequest = JSON.parse(operatorRequestFile.bytes);
  } catch {
    throw fail(
      'SNAPBACK_HOSTED_OPERATOR_REQUEST_INVALID',
      'SupervisorRequestV1 file is not one JSON value',
    );
  }
  const body = operatorRequest?.body;
  if (
    body?.schemaVersion !== 'snapback.supervisor-lifecycle-execution.v1'
    || canonicalJson(body.lifecycleRequest) !== canonicalJson(request)
  ) {
    throw fail(
      'SNAPBACK_HOSTED_OPERATOR_REQUEST_INVALID',
      'signed operator request does not contain the byte-equivalent lifecycle request',
    );
  }
  const signedResponse = await submitOperatorRequest({
    requestPath: operatorRequestPath,
    endpoint,
    clientKeyPath,
    clientCertificatePath,
    serverCaPath,
    rootPublicKeyPath,
    serverCertificateSha256,
    timeoutMs,
  });
  const response = signedResponse.body?.result;
  if (response.schemaVersion !== 'snapback.vm-adapter-lifecycle-response.v2'
      || response.operation !== operation
      || response.operationId !== request.operationId
      || typeof response.ok !== 'boolean') {
    throw fail(
      'SNAPBACK_HOSTED_LIFECYCLE_RESPONSE_INVALID',
      'signed supervisor response identity does not match the lifecycle request',
    );
  }
  return response;
  /* c8 ignore stop */
}

export const __hostedControlTest = Object.freeze({
  LIFECYCLE_REQUEST_KEYS,
  MAX_REQUEST_BYTES,
  OPERATOR_RESPONSE_KEYS,
  verifyOperatorResponse,
});
