// The standing supervisor's operator boundary is deliberately smaller than
// its provider-effect engine. This module owns only request admission,
// canonical response replay, per-device revocation, and bounded release
// upload transitions.
//
// @ref LLP 0111#standing-supervisor-root-and-operator-protocol — every remote
// request is device-signed, scoped, sequenced, and bound to the current
// installation/root/revocation head.
// @ref LLP 0111#atomic-request-response-replay — response bytes are retained
// before the device sequence advances, and exact replay does not rerun work.
// @ref LLP 0111#bounded-release-upload — uploads reserve a nondeployable
// temporary object before bytes and become immutable only after size and hash
// verification.

import {
  createHash,
  createPublicKey,
  randomUUID,
  verify,
} from 'node:crypto';
import { isAsyncFunction } from 'node:util/types';

const DIGEST = /^sha256:[0-9a-f]{64}$/;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,255}$/;
const REQUEST_SCHEMA_VERSION = 'snapback.supervisor-request.v1';
const STATE_SCHEMA_VERSION = 'snapback.supervisor-operator-authority-state.v1';
const INLINE_RESPONSE_BYTES = 1024 * 1024;
const MAX_RESPONSE_BYTES = 64 * 1024 * 1024;
const MAX_UPLOAD_BYTES = 2 * 1024 * 1024 * 1024;
const MAX_UPLOAD_TOTAL_MS = 15 * 60 * 1000;
const MAX_UPLOAD_IDLE_MS = 30 * 1000;
const RESPONSE_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

const REQUEST_KEYS = Object.freeze([
  'body',
  'bodySha256',
  'certificateExpiresAtMs',
  'certificateRevocationGeneration',
  'credentialBearing',
  'deviceId',
  'deviceKeyId',
  'expiresAtMs',
  'installationId',
  'issuedAtMs',
  'observedRevocationGeneration',
  'operatorCertificateSha256',
  'requestId',
  'rootKeyId',
  'schemaVersion',
  'scope',
  'sequence',
  'signature',
  'subject',
  'targetHeadSha256',
  'variant',
]);

function entry(scope, authority = 'scope', credentialBearing = false) {
  return Object.freeze({
    authority,
    credentialBearing,
    scopes: Object.freeze(Array.isArray(scope) ? [...scope] : scope === null ? [] : [scope]),
  });
}

export const SUPERVISOR_REQUEST_REGISTRY = Object.freeze({
  'operator.enrollment.issue': entry('operator.enroll', 'scope', true),
  'operator.enrollment.consume': entry(null, 'enrollment-bundle', true),
  'operator.certificate.renew': entry(null, 'certificate-self', true),
  'operator.device.list': entry('operator.admin'),
  'operator.device.revoke': entry('operator.admin'),
  'operator.device.rebind': entry(null, 'recovery-bootstrap', true),
  'operator.delegation.plan': entry('root.admin', 'scope-and-recovery-threshold'),
  'operator.delegation.confirm': entry('root.admin', 'scope-and-recovery-threshold'),
  'operator.delegation.apply': entry('root.admin', 'scope-and-recovery-threshold'),
  'root.rotate.plan': entry('root.admin'),
  'root.rotate.confirm': entry('root.admin', 'scope-and-recovery-threshold'),
  'root.rotate.apply': entry('root.admin', 'scope-and-recovery-threshold'),
  'root.recover.plan': entry(null, 'recovery-threshold'),
  'root.recover.confirm': entry(null, 'recovery-threshold'),
  'root.recover.apply': entry(null, 'recovery-threshold', true),
  'root.intermediate.issue': entry('root.admin', 'scope-and-recovery-threshold'),
  'root.intermediate.renew': entry('root.admin', 'scope-and-recovery-threshold'),
  'root.intermediate.rotate': entry('root.admin', 'scope-and-recovery-threshold'),
  'root.intermediate.unseal': entry(null, 'local-recovery-threshold', true),
  'target.register': entry('target.register'),
  'target.rebind': entry(null, 'recovery-owner-and-target-proof'),
  'supervisor.doctor': entry('supervisor.read'),
  'supervisor.inspect': entry('supervisor.read'),
  'supervisor.logs': entry('supervisor.read'),
  'supervisor.inspect-admin': entry('supervisor.read'),
  'supervisor.cost': entry('supervisor.read'),
  'release.upload': entry('release.upload'),
  'deploy.plan': entry('deploy.plan'),
  'deploy.confirm': entry('deploy.confirm'),
  'deploy.apply': entry('deploy.apply'),
  'deploy.reconcile': entry('deploy.reconcile'),
  'backup.plan': entry('backup.plan'),
  'backup.confirm': entry('backup.confirm'),
  'backup.apply': entry('backup.apply'),
  'backup.reconcile': entry('backup.reconcile'),
  'restore.plan': entry('restore.plan'),
  'restore.confirm': entry('restore.confirm'),
  'restore.apply': entry('restore.apply'),
  'restore.activate': entry('restore.activate'),
  'restore.reconcile': entry('restore.reconcile'),
  'rollback.plan': entry('rollback.plan'),
  'rollback.confirm': entry('rollback.confirm'),
  'rollback.apply': entry('rollback.apply'),
  'rollback.reconcile': entry('rollback.reconcile'),
  'cleanup.plan': entry('cleanup.plan'),
  'cleanup.confirm': entry('cleanup.confirm'),
  'cleanup.apply': entry('cleanup.apply'),
  'cleanup.reconcile': entry('cleanup.reconcile'),
  'capability.publication.plan': entry('capability.publish'),
  'capability.publication.confirm': entry('capability.publish', 'scope-and-explicit-approval'),
  'capability.publication.provision': entry('capability.publish'),
  'capability.publication.finalize': entry('capability.publish'),
  'capability.publication.withdraw': entry('capability.withdraw'),
  'capability.publication.renew': entry('capability.publish'),
  'capability.publication.reconcile': entry(['capability.publish', 'capability.withdraw']),
});

export const SUPERVISOR_SCOPE_VOCABULARY = Object.freeze([
  ...new Set(Object.values(SUPERVISOR_REQUEST_REGISTRY).flatMap(({ scopes }) => scopes)),
].sort());

export class OperatorAuthorityRefusal extends Error {
  constructor(code, message, status = 409, details = undefined) {
    super(message);
    this.name = 'OperatorAuthorityRefusal';
    this.code = code;
    this.status = status;
    if (details !== undefined) this.details = details;
  }
}

function refuse(code, message, status = 409, details = undefined) {
  throw new OperatorAuthorityRefusal(code, message, status, details);
}

function isPlainObject(value) {
  return value !== null
    && typeof value === 'object'
    && !Array.isArray(value)
    && Object.getPrototypeOf(value) === Object.prototype;
}

export function canonicalAuthorityJson(value) {
  if (value === null) return 'null';
  if (typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value)) {
      refuse('SNAPBACK_OPERATOR_CANONICAL_VALUE_INVALID', 'authority values require safe integers');
    }
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalAuthorityJson).join(',')}]`;
  if (isPlainObject(value)) {
    return `{${Object.keys(value).sort().map((key) => (
      `${JSON.stringify(key)}:${canonicalAuthorityJson(value[key])}`
    )).join(',')}}`;
  }
  refuse('SNAPBACK_OPERATOR_CANONICAL_VALUE_INVALID', 'authority values must be JSON-compatible');
}

function sha256(bytes) {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
}

function sha256Json(domain, value) {
  return sha256(Buffer.concat([Buffer.from(domain), Buffer.from(canonicalAuthorityJson(value))]));
}

function assertClosed(value, keys, name) {
  if (!isPlainObject(value) || canonicalAuthorityJson(Object.keys(value).sort()) !== canonicalAuthorityJson([...keys].sort())) {
    refuse('SNAPBACK_OPERATOR_REQUEST_INVALID', `${name} must use the exact closed field set`, 400);
  }
}

function assertId(value, name) {
  if (typeof value !== 'string' || !SAFE_ID.test(value)) {
    refuse('SNAPBACK_OPERATOR_REQUEST_INVALID', `${name} is not a bounded identifier`, 400);
  }
}

function assertDigest(value, name, nullable = false) {
  if ((nullable && value === null) || (typeof value === 'string' && DIGEST.test(value))) return;
  refuse('SNAPBACK_OPERATOR_REQUEST_INVALID', `${name} is not a SHA-256 digest`, 400);
}

function assertSafeInteger(value, name, minimum = 0) {
  if (!Number.isSafeInteger(value) || value < minimum) {
    refuse('SNAPBACK_OPERATOR_REQUEST_INVALID', `${name} is not a bounded safe integer`, 400);
  }
}

function clone(value) {
  return structuredClone(value);
}

function requestWithoutSignature(request) {
  const { signature: _signature, ...unsigned } = request;
  return unsigned;
}

export function operatorRequestSigningBytes(request) {
  return Buffer.concat([
    Buffer.from('snapback-supervisor-request-v1\0'),
    Buffer.from(canonicalAuthorityJson(requestWithoutSignature(request))),
  ]);
}

export function operatorRequestBodySha256(body) {
  return sha256Json('snapback-supervisor-request-body-v1\0', body);
}

function validateRequestShape(request) {
  assertClosed(request, REQUEST_KEYS, 'SupervisorRequestV1');
  if (request.schemaVersion !== REQUEST_SCHEMA_VERSION) {
    refuse('SNAPBACK_OPERATOR_REQUEST_INVALID', 'request schema version is unsupported', 400);
  }
  for (const name of [
    'installationId',
    'rootKeyId',
    'deviceId',
    'deviceKeyId',
    'subject',
    'requestId',
    'variant',
  ]) assertId(request[name], name);
  assertDigest(request.operatorCertificateSha256, 'operatorCertificateSha256');
  assertDigest(request.targetHeadSha256, 'targetHeadSha256', true);
  assertDigest(request.bodySha256, 'bodySha256');
  for (const name of [
    'certificateExpiresAtMs',
    'certificateRevocationGeneration',
    'observedRevocationGeneration',
    'sequence',
    'issuedAtMs',
    'expiresAtMs',
  ]) assertSafeInteger(request[name], name, name === 'sequence' ? 1 : 0);
  if (!(request.scope === null || (typeof request.scope === 'string' && SAFE_ID.test(request.scope)))) {
    refuse('SNAPBACK_OPERATOR_REQUEST_INVALID', 'scope must be null or a closed scope identifier', 400);
  }
  if (typeof request.credentialBearing !== 'boolean'
      || typeof request.signature !== 'string'
      || request.signature.length < 1
      || request.signature.length > 512) {
    refuse('SNAPBACK_OPERATOR_REQUEST_INVALID', 'credentialBearing or signature is malformed', 400);
  }
  canonicalAuthorityJson(request.body);
  if (operatorRequestBodySha256(request.body) !== request.bodySha256) {
    refuse('SNAPBACK_OPERATOR_BODY_DIGEST_MISMATCH', 'request body digest does not match its canonical body', 400);
  }
  return canonicalAuthorityJson(request);
}

function emptyState({ installationId, rootKeyId, nowMs }) {
  assertId(installationId, 'installationId');
  assertId(rootKeyId, 'rootKeyId');
  assertSafeInteger(nowMs, 'nowMs');
  return {
    schemaVersion: STATE_SCHEMA_VERSION,
    installationId,
    rootKeyId,
    operatorRevocationGeneration: 1,
    devices: {},
    requestJournal: {},
    sequenceJournal: {},
    responseObjects: {},
    responseTombstones: {},
    pendingRequests: {},
    pendingUploads: {},
    uploads: {},
    createdAtMs: nowMs,
    updatedAtMs: nowMs,
  };
}

function validateInitialState(state) {
  if (!isPlainObject(state) || state.schemaVersion !== STATE_SCHEMA_VERSION) {
    refuse('SNAPBACK_OPERATOR_STATE_INVALID', 'operator authority state schema is invalid', 500);
  }
  assertId(state.installationId, 'installationId');
  assertId(state.rootKeyId, 'rootKeyId');
  assertSafeInteger(state.operatorRevocationGeneration, 'operatorRevocationGeneration', 1);
  const next = clone(state);
  next.pendingRequests ??= {};
  for (const name of [
    'devices',
    'requestJournal',
    'sequenceJournal',
    'responseObjects',
    'responseTombstones',
    'pendingRequests',
    'pendingUploads',
    'uploads',
  ]) {
    if (!isPlainObject(next[name])) {
      refuse('SNAPBACK_OPERATOR_STATE_INVALID', `${name} state is invalid`, 500);
    }
  }
  return next;
}

function encodeResponse(state, response, nowMs) {
  const canonical = canonicalAuthorityJson(response);
  const bytes = Buffer.from(canonical);
  if (bytes.length > MAX_RESPONSE_BYTES) {
    refuse('SNAPBACK_OPERATOR_RESPONSE_TOO_LARGE', 'canonical response exceeds 64 MiB', 500);
  }
  const digest = sha256(bytes);
  if (bytes.length <= INLINE_RESPONSE_BYTES) {
    return {
      kind: 'inline',
      sha256: digest,
      bytes: bytes.toString('base64url'),
      byteLength: bytes.length,
      retainedAtMs: nowMs,
      retainUntilMs: nowMs + RESPONSE_RETENTION_MS,
    };
  }
  const objectKey = `authority-responses/${digest.slice('sha256:'.length)}`;
  state.responseObjects[objectKey] = {
    sha256: digest,
    generation: 1,
    bytes: bytes.toString('base64url'),
  };
  return {
    kind: 'object',
    sha256: digest,
    objectKey,
    objectGeneration: 1,
    byteLength: bytes.length,
    retainedAtMs: nowMs,
    retainUntilMs: nowMs + RESPONSE_RETENTION_MS,
  };
}

function decodeResponse(state, record) {
  const encoded = record.response.kind === 'inline'
    ? record.response.bytes
    : state.responseObjects[record.response.objectKey]?.bytes;
  if (typeof encoded !== 'string') {
    refuse('SNAPBACK_OPERATOR_REPLAY_BYTES_MISSING', 'retained response bytes are unavailable', 410);
  }
  const bytes = Buffer.from(encoded, 'base64url');
  if (bytes.length !== record.response.byteLength || sha256(bytes) !== record.response.sha256) {
    refuse('SNAPBACK_OPERATOR_REPLAY_BYTES_INVALID', 'retained response bytes failed integrity verification', 500);
  }
  return JSON.parse(bytes.toString('utf8'));
}

function terminalRedaction(record) {
  return {
    schemaVersion: 'snapback.supervisor-replay-redaction.v1',
    ok: false,
    requestId: record.requestId,
    responseSha256: record.response.sha256,
    terminal: true,
    code: 'SNAPBACK_OPERATOR_CREDENTIAL_REPLAY_GONE',
  };
}

function requestDigest(canonical) {
  return sha256(Buffer.concat([
    Buffer.from('snapback-supervisor-retained-request-v1\0'),
    Buffer.from(canonical),
  ]));
}

export function operatorRequestCanonicalSha256(request) {
  return requestDigest(validateRequestShape(request));
}

export class SupervisorOperatorAuthority {
  #state;
  #openUploadHashes = new Map();

  constructor({
    installationId,
    rootKeyId,
    nowMs = Date.now(),
    state = undefined,
  }) {
    this.#state = state === undefined
      ? emptyState({ installationId, rootKeyId, nowMs })
      : validateInitialState(state);
    if (installationId !== undefined && installationId !== this.#state.installationId) {
      refuse('SNAPBACK_OPERATOR_INSTALLATION_MISMATCH', 'restored state belongs to another installation', 409);
    }
    if (rootKeyId !== undefined && rootKeyId !== this.#state.rootKeyId) {
      refuse('SNAPBACK_OPERATOR_ROOT_MISMATCH', 'restored state belongs to another root', 409);
    }
  }

  snapshot() {
    return clone(this.#state);
  }

  registerDevice({
    deviceId,
    deviceKeyId,
    subject,
    publicKeyPem,
    effectiveScopes,
    certificateSha256,
    certificateExpiresAtMs,
    certificateRevocationGeneration = this.#state.operatorRevocationGeneration,
    nowMs = Date.now(),
  }) {
    for (const [name, value] of Object.entries({ deviceId, deviceKeyId, subject })) assertId(value, name);
    assertDigest(certificateSha256, 'certificateSha256');
    assertSafeInteger(certificateExpiresAtMs, 'certificateExpiresAtMs', 1);
    assertSafeInteger(certificateRevocationGeneration, 'certificateRevocationGeneration', 1);
    if (certificateExpiresAtMs <= nowMs
        || certificateExpiresAtMs - nowMs > 24 * 60 * 60 * 1000) {
      refuse(
        'SNAPBACK_OPERATOR_CERTIFICATE_EXPIRY_INVALID',
        'operator certificates must expire within 24 hours of enrollment',
        400,
      );
    }
    if (certificateRevocationGeneration > this.#state.operatorRevocationGeneration) {
      refuse(
        'SNAPBACK_OPERATOR_REVOCATION_HEAD_AHEAD',
        'device certificate cannot name a future revocation generation',
        409,
      );
    }
    if (this.#state.devices[deviceId]) {
      refuse('SNAPBACK_OPERATOR_DEVICE_EXISTS', 'device id is already enrolled', 409);
    }
    if (!Array.isArray(effectiveScopes)
        || effectiveScopes.length < 1
        || new Set(effectiveScopes).size !== effectiveScopes.length
        || effectiveScopes.some((scope) => !SUPERVISOR_SCOPE_VOCABULARY.includes(scope))) {
      refuse('SNAPBACK_OPERATOR_SCOPE_INVALID', 'device scopes are not a nonempty subset of the closed vocabulary', 400);
    }
    try {
      createPublicKey(publicKeyPem);
    } catch {
      refuse('SNAPBACK_OPERATOR_DEVICE_KEY_INVALID', 'device public key is not usable', 400);
    }
    const next = clone(this.#state);
    next.devices[deviceId] = {
      deviceId,
      deviceKeyId,
      subject,
      publicKeyPem,
      effectiveScopes: [...effectiveScopes].sort(),
      certificateSha256,
      certificateExpiresAtMs,
      certificateRevocationGeneration,
      status: 'active',
      revokedAtGeneration: null,
      enrolledAtMs: nowMs,
      lastSequence: 0,
    };
    next.sequenceJournal[deviceId] = {};
    next.updatedAtMs = nowMs;
    this.#state = next;
    return clone(next.devices[deviceId]);
  }

  revokeDevice(deviceId, { nowMs = Date.now() } = {}) {
    assertId(deviceId, 'deviceId');
    const device = this.#state.devices[deviceId];
    if (!device) refuse('SNAPBACK_OPERATOR_DEVICE_UNKNOWN', 'device is not enrolled', 404);
    if (device.status === 'revoked') return clone(device);
    const next = clone(this.#state);
    next.operatorRevocationGeneration += 1;
    next.devices[deviceId].status = 'revoked';
    next.devices[deviceId].revokedAtGeneration = next.operatorRevocationGeneration;
    next.devices[deviceId].revokedAtMs = nowMs;
    next.updatedAtMs = nowMs;
    this.#state = next;
    return clone(next.devices[deviceId]);
  }

  #findReplay(request, canonical) {
    const retained = this.#state.requestJournal[request.requestId];
    if (retained) {
      if (retained.requestSha256 !== requestDigest(canonical)) {
        refuse('SNAPBACK_OPERATOR_REQUEST_ID_COLLISION', 'request id was reused with different canonical bytes', 409);
      }
      if (retained.credentialBearing) {
        const device = this.#state.devices[retained.deviceId];
        if (device?.status !== 'active'
            || retained.installationId !== this.#state.installationId
            || retained.rootKeyId !== this.#state.rootKeyId) {
          refuse(
            'SNAPBACK_OPERATOR_CREDENTIAL_REPLAY_GONE',
            'credential-bearing response is no longer replayable',
            410,
            terminalRedaction(retained),
          );
        }
      }
      return { found: true, response: decodeResponse(this.#state, retained) };
    }
    const tombstone = this.#state.responseTombstones[request.requestId];
    if (tombstone) {
      if (tombstone.requestSha256 !== requestDigest(canonical)) {
        refuse('SNAPBACK_OPERATOR_REQUEST_ID_COLLISION', 'tombstoned request id was reused with different bytes', 409);
      }
      refuse('SNAPBACK_OPERATOR_REPLAY_TOMBSTONED', 'retained response has been receipt-bearing garbage collected', 410, clone(tombstone));
    }
    const pending = this.#state.pendingUploads[request.requestId];
    if (pending) {
      if (pending.requestSha256 !== requestDigest(canonical)) {
        refuse('SNAPBACK_OPERATOR_REQUEST_ID_COLLISION', 'pending upload request id was reused with different bytes', 409);
      }
      return {
        found: true,
        response: {
          schemaVersion: 'snapback.release-upload-pending.v1',
          ok: true,
          requestId: request.requestId,
          state: this.#state.uploads[request.requestId].state,
          receivedBytes: this.#state.uploads[request.requestId].receivedBytes,
        },
      };
    }
    const pendingRequest = this.#state.pendingRequests[request.requestId];
    if (pendingRequest) {
      if (
        pendingRequest.requestSha256 !== requestDigest(canonical)
        || pendingRequest.deviceId !== request.deviceId
        || pendingRequest.sequence !== request.sequence
      ) {
        refuse(
          'SNAPBACK_OPERATOR_REQUEST_ID_COLLISION',
          'pending request id was reused with different device, sequence, or bytes',
          409,
        );
      }
      return { found: false, pending: true, response: null };
    }
    return { found: false, pending: false, response: null };
  }

  #authorizeNew(request, canonical, { nowMs, verifySpecialAuthority }) {
    if (request.installationId !== this.#state.installationId) {
      refuse('SNAPBACK_OPERATOR_INSTALLATION_MISMATCH', 'request installation is not current', 409);
    }
    if (request.rootKeyId !== this.#state.rootKeyId) {
      refuse('SNAPBACK_OPERATOR_ROOT_MISMATCH', 'request root is not current', 409);
    }
    if (request.observedRevocationGeneration !== this.#state.operatorRevocationGeneration) {
      refuse('SNAPBACK_OPERATOR_REVOCATION_HEAD_BEHIND', 'request does not prove the current global revocation head', 409);
    }
    const device = this.#state.devices[request.deviceId];
    if (!device || device.status !== 'active') {
      refuse('SNAPBACK_OPERATOR_DEVICE_REVOKED', 'device is unknown or revoked', 403);
    }
    if (request.deviceKeyId !== device.deviceKeyId
        || request.subject !== device.subject
        || request.operatorCertificateSha256 !== device.certificateSha256
        || request.certificateExpiresAtMs !== device.certificateExpiresAtMs
        || request.certificateRevocationGeneration !== device.certificateRevocationGeneration) {
      refuse('SNAPBACK_OPERATOR_CERTIFICATE_MISMATCH', 'request certificate facts do not match the enrolled device', 403);
    }
    if (request.issuedAtMs > nowMs || request.expiresAtMs < nowMs
        || request.expiresAtMs <= request.issuedAtMs
        || request.expiresAtMs - request.issuedAtMs > 10 * 60 * 1000
        || request.certificateExpiresAtMs < nowMs) {
      refuse('SNAPBACK_OPERATOR_REQUEST_EXPIRED', 'request or operator certificate is outside its validity window', 403);
    }
    let signature;
    try {
      signature = Buffer.from(request.signature, 'base64url');
    } catch {
      refuse('SNAPBACK_OPERATOR_SIGNATURE_INVALID', 'device signature encoding is invalid', 403);
    }
    if (signature.length !== 64 || signature.toString('base64url') !== request.signature) {
      refuse('SNAPBACK_OPERATOR_SIGNATURE_INVALID', 'device signature encoding is invalid', 403);
    }
    if (!verify(null, operatorRequestSigningBytes(request), createPublicKey(device.publicKeyPem), signature)) {
      refuse('SNAPBACK_OPERATOR_SIGNATURE_INVALID', 'device signature did not verify', 403);
    }
    const registry = SUPERVISOR_REQUEST_REGISTRY[request.variant];
    if (!registry) {
      refuse('SNAPBACK_OPERATOR_VARIANT_UNKNOWN', 'request variant is not in the closed registry', 400);
    }
    if (request.credentialBearing !== registry.credentialBearing) {
      refuse(
        'SNAPBACK_OPERATOR_RESPONSE_CLASS_MISMATCH',
        'credential-bearing response class does not match the closed operation registry',
        400,
      );
    }
    if (registry.scopes.length > 0) {
      if (!registry.scopes.includes(request.scope) || !device.effectiveScopes.includes(request.scope)) {
        refuse('SNAPBACK_OPERATOR_SCOPE_DENIED', 'request scope does not exactly authorize its variant', 403);
      }
    } else if (request.scope !== null) {
      refuse('SNAPBACK_OPERATOR_SCOPE_DENIED', 'special-authority request must not substitute an operator scope', 403);
    }
    if (registry.authority !== 'scope' && registry.authority !== 'certificate-self') {
      if (typeof verifySpecialAuthority !== 'function'
          || verifySpecialAuthority({ request: clone(request), authority: registry.authority }) !== true) {
        refuse('SNAPBACK_OPERATOR_SPECIAL_AUTHORITY_REQUIRED', 'request lacks its exact special authority proof', 403);
      }
    }
    const expectedSequence = device.lastSequence + 1;
    const pendingForDevice = [
      ...Object.values(this.#state.pendingUploads),
      ...Object.values(this.#state.pendingRequests),
    ].find((pending) => (pending.request ?? pending).deviceId === device.deviceId);
    if (pendingForDevice) {
      refuse(
        'SNAPBACK_OPERATOR_SEQUENCE_PENDING',
        'device has an unfinished upload request at its next sequence',
        409,
        { requestId: (pendingForDevice.request ?? pendingForDevice).requestId },
      );
    }
    const sequenceRequestId = this.#state.sequenceJournal[device.deviceId]?.[String(request.sequence)];
    if (request.sequence !== expectedSequence || sequenceRequestId !== undefined) {
      refuse('SNAPBACK_OPERATOR_SEQUENCE_CONFLICT', 'request sequence is not the exact next device sequence', 409, {
        expectedSequence,
      });
    }
    return { device, canonical };
  }

  #commitResponse(next, request, canonical, response, nowMs) {
    const retained = encodeResponse(next, response, nowMs);
    next.requestJournal[request.requestId] = {
      requestId: request.requestId,
      requestSha256: requestDigest(canonical),
      requestCanonical: canonical,
      installationId: request.installationId,
      rootKeyId: request.rootKeyId,
      deviceId: request.deviceId,
      sequence: request.sequence,
      variant: request.variant,
      scope: request.scope,
      targetHeadSha256: request.targetHeadSha256,
      credentialBearing: SUPERVISOR_REQUEST_REGISTRY[request.variant].credentialBearing,
      response: retained,
      committedAtMs: nowMs,
    };
    next.sequenceJournal[request.deviceId][String(request.sequence)] = request.requestId;
    next.devices[request.deviceId].lastSequence = request.sequence;
    next.updatedAtMs = nowMs;
  }

  reserveRequest(request, {
    nowMs = Date.now(),
    verifySpecialAuthority = undefined,
  } = {}) {
    const canonical = validateRequestShape(request);
    const replay = this.#findReplay(request, canonical);
    if (replay.found) {
      return { state: 'terminal', response: clone(replay.response), recovered: true };
    }
    if (request.variant === 'release.upload') {
      refuse('SNAPBACK_RELEASE_UPLOAD_STREAM_REQUIRED', 'release.upload must use the bounded streaming transition API', 400);
    }
    if (replay.pending) {
      return { state: 'reserved', response: null, recovered: true };
    }
    this.#authorizeNew(request, canonical, { nowMs, verifySpecialAuthority });
    const next = clone(this.#state);
    next.pendingRequests[request.requestId] = {
      requestId: request.requestId,
      requestSha256: requestDigest(canonical),
      requestCanonical: canonical,
      installationId: request.installationId,
      rootKeyId: request.rootKeyId,
      deviceId: request.deviceId,
      sequence: request.sequence,
      variant: request.variant,
      scope: request.scope,
      targetHeadSha256: request.targetHeadSha256,
      credentialBearing: SUPERVISOR_REQUEST_REGISTRY[request.variant].credentialBearing,
      reservedAtMs: nowMs,
    };
    next.updatedAtMs = nowMs;
    this.#state = next;
    return { state: 'reserved', response: null, recovered: false };
  }

  settleReservedRequest(request, response, { nowMs = Date.now() } = {}) {
    const canonical = validateRequestShape(request);
    const pending = this.#state.pendingRequests[request.requestId];
    if (
      !pending
      || pending.requestSha256 !== requestDigest(canonical)
      || pending.deviceId !== request.deviceId
      || pending.sequence !== request.sequence
    ) {
      refuse(
        'SNAPBACK_OPERATOR_REQUEST_NOT_RESERVED',
        'terminal response requires the exact canonical pending request reservation',
        409,
      );
    }
    canonicalAuthorityJson(response);
    const next = clone(this.#state);
    this.#commitResponse(next, request, canonical, response, nowMs);
    delete next.pendingRequests[request.requestId];
    this.#state = next;
    return clone(response);
  }

  handleRequest(request, {
    nowMs = Date.now(),
    execute,
    verifySpecialAuthority = undefined,
  } = {}) {
    const canonical = validateRequestShape(request);
    const replay = this.#findReplay(request, canonical);
    if (replay.found) return clone(replay.response);
    if (request.variant === 'release.upload') {
      refuse('SNAPBACK_RELEASE_UPLOAD_STREAM_REQUIRED', 'release.upload must use the bounded streaming transition API', 400);
    }
    this.#authorizeNew(request, canonical, { nowMs, verifySpecialAuthority });
    if (typeof execute !== 'function') {
      refuse('SNAPBACK_OPERATOR_EXECUTOR_REQUIRED', 'new requests require an executor', 500);
    }
    if (isAsyncFunction(execute)) {
      refuse(
        'SNAPBACK_OPERATOR_ASYNC_EXECUTOR_REQUIRED',
        'async provider executors must use handleRequestAsync',
        500,
      );
    }
    const next = clone(this.#state);
    let response;
    try {
      response = execute({ request: clone(request), state: next });
      if (response && typeof response.then === 'function') {
        refuse(
          'SNAPBACK_OPERATOR_ASYNC_EXECUTOR_REQUIRED',
          'promise-returning provider executors must use handleRequestAsync',
          500,
        );
      }
      canonicalAuthorityJson(response);
      this.#commitResponse(next, request, canonical, response, nowMs);
    } catch (error) {
      if (error instanceof OperatorAuthorityRefusal) throw error;
      throw error;
    }
    this.#state = next;
    return clone(response);
  }

  // @ref LLP 0111#atomic-request-response-replay — provider I/O may await,
  // but the canonical response is retained before sequence state advances.
  async handleRequestAsync(request, {
    nowMs = Date.now(),
    execute,
    verifySpecialAuthority = undefined,
  } = {}) {
    const canonical = validateRequestShape(request);
    const replay = this.#findReplay(request, canonical);
    if (replay.found) return clone(replay.response);
    if (request.variant === 'release.upload') {
      refuse('SNAPBACK_RELEASE_UPLOAD_STREAM_REQUIRED', 'release.upload must use the bounded streaming transition API', 400);
    }
    this.#authorizeNew(request, canonical, { nowMs, verifySpecialAuthority });
    if (typeof execute !== 'function') {
      refuse('SNAPBACK_OPERATOR_EXECUTOR_REQUIRED', 'new requests require an executor', 500);
    }
    const next = clone(this.#state);
    const response = await execute({ request: clone(request), state: next });
    canonicalAuthorityJson(response);
    this.#commitResponse(next, request, canonical, response, nowMs);
    this.#state = next;
    return clone(response);
  }

  beginReleaseUpload(request, upload, {
    nowMs = Date.now(),
    verifySpecialAuthority = undefined,
  } = {}) {
    const canonical = validateRequestShape(request);
    if (request.variant !== 'release.upload') {
      refuse('SNAPBACK_RELEASE_UPLOAD_VARIANT_INVALID', 'stream API accepts only release.upload', 400);
    }
    const replay = this.#findReplay(request, canonical);
    if (replay.found) return clone(replay.response);
    this.#authorizeNew(request, canonical, { nowMs, verifySpecialAuthority });
    assertClosed(upload, [
      'attemptId',
      'declaredBytes',
      'declaredSha256',
      'spendReservationId',
      'temporaryObjectKey',
    ], 'release upload reservation');
    assertId(upload.attemptId, 'attemptId');
    assertId(upload.spendReservationId, 'spendReservationId');
    assertSafeInteger(upload.declaredBytes, 'declaredBytes', 1);
    assertDigest(upload.declaredSha256, 'declaredSha256');
    if (!isPlainObject(request.body)
        || request.body.declaredBytes !== upload.declaredBytes
        || request.body.declaredSha256 !== upload.declaredSha256) {
      refuse(
        'SNAPBACK_RELEASE_UPLOAD_BODY_MISMATCH',
        'upload length and digest must match the signed request body',
        409,
      );
    }
    const expectedPrefix = `uploads/${this.#state.installationId}/${request.requestId}/${upload.attemptId}`;
    if (upload.declaredBytes > MAX_UPLOAD_BYTES || upload.temporaryObjectKey !== expectedPrefix) {
      refuse('SNAPBACK_RELEASE_UPLOAD_RESERVATION_INVALID', 'upload exceeds 2 GiB or does not use its isolated temporary key', 400);
    }
    const next = clone(this.#state);
    next.pendingUploads[request.requestId] = {
      request: clone(request),
      requestCanonical: canonical,
      requestSha256: requestDigest(canonical),
    };
    next.uploads[request.requestId] = {
      ...clone(upload),
      requestId: request.requestId,
      state: 'reserved',
      receivedBytes: 0,
      reservedAtMs: nowMs,
      lastProgressAtMs: nowMs,
      terminalAtMs: null,
      immutableObjectKey: null,
      actualSha256: null,
      cleanupDueAtMs: null,
      unusedSpendReleased: false,
    };
    next.updatedAtMs = nowMs;
    this.#state = next;
    this.#openUploadHashes.set(request.requestId, createHash('sha256'));
    return {
      schemaVersion: 'snapback.release-upload-reservation.v1',
      ok: true,
      requestId: request.requestId,
      attemptId: upload.attemptId,
      temporaryObjectKey: upload.temporaryObjectKey,
      declaredBytes: upload.declaredBytes,
      idleDeadlineMs: nowMs + MAX_UPLOAD_IDLE_MS,
      totalDeadlineMs: nowMs + MAX_UPLOAD_TOTAL_MS,
    };
  }

  appendReleaseUploadChunk({ requestId, bytes, nowMs = Date.now() }) {
    assertId(requestId, 'requestId');
    const upload = this.#state.uploads[requestId];
    if (!upload || !['reserved', 'receiving'].includes(upload.state)) {
      refuse('SNAPBACK_RELEASE_UPLOAD_NOT_OPEN', 'upload is not open for bytes', 409);
    }
    const chunk = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
    if (nowMs - upload.reservedAtMs > MAX_UPLOAD_TOTAL_MS
        || nowMs - upload.lastProgressAtMs > MAX_UPLOAD_IDLE_MS) {
      return this.#terminalizeUpload(requestId, {
        code: 'SNAPBACK_RELEASE_UPLOAD_TIMEOUT',
        actualSha256: null,
        nowMs,
      });
    }
    if (upload.receivedBytes + chunk.length > upload.declaredBytes
        || upload.receivedBytes + chunk.length > MAX_UPLOAD_BYTES) {
      return this.#terminalizeUpload(requestId, {
        code: 'SNAPBACK_RELEASE_UPLOAD_SIZE_MISMATCH',
        actualSha256: null,
        nowMs,
      });
    }
    const hash = this.#openUploadHashes.get(requestId);
    if (!hash) {
      return this.#terminalizeUpload(requestId, {
        code: 'SNAPBACK_RELEASE_UPLOAD_STREAM_LOST',
        actualSha256: null,
        nowMs,
      });
    }
    hash.update(chunk);
    const next = clone(this.#state);
    next.uploads[requestId].state = 'receiving';
    next.uploads[requestId].receivedBytes += chunk.length;
    next.uploads[requestId].lastProgressAtMs = nowMs;
    next.updatedAtMs = nowMs;
    this.#state = next;
    return {
      schemaVersion: 'snapback.release-upload-progress.v1',
      ok: true,
      requestId,
      receivedBytes: next.uploads[requestId].receivedBytes,
      declaredBytes: next.uploads[requestId].declaredBytes,
    };
  }

  finishReleaseUpload({ requestId, nowMs = Date.now() }) {
    assertId(requestId, 'requestId');
    const upload = this.#state.uploads[requestId];
    if (!upload || !['reserved', 'receiving'].includes(upload.state)) {
      refuse('SNAPBACK_RELEASE_UPLOAD_NOT_OPEN', 'upload is not open for completion', 409);
    }
    if (nowMs - upload.reservedAtMs > MAX_UPLOAD_TOTAL_MS
        || nowMs - upload.lastProgressAtMs > MAX_UPLOAD_IDLE_MS) {
      return this.#terminalizeUpload(requestId, {
        code: 'SNAPBACK_RELEASE_UPLOAD_TIMEOUT',
        actualSha256: null,
        nowMs,
      });
    }
    const hash = this.#openUploadHashes.get(requestId);
    if (!hash) {
      return this.#terminalizeUpload(requestId, {
        code: 'SNAPBACK_RELEASE_UPLOAD_STREAM_LOST',
        actualSha256: null,
        nowMs,
      });
    }
    const actualSha256 = `sha256:${hash.digest('hex')}`;
    this.#openUploadHashes.delete(requestId);
    if (upload.receivedBytes !== upload.declaredBytes || actualSha256 !== upload.declaredSha256) {
      return this.#terminalizeUpload(requestId, {
        code: upload.receivedBytes === upload.declaredBytes
          ? 'SNAPBACK_RELEASE_UPLOAD_HASH_MISMATCH'
          : 'SNAPBACK_RELEASE_UPLOAD_SIZE_MISMATCH',
        actualSha256,
        nowMs,
      });
    }
    const response = {
      schemaVersion: 'snapback.release-upload-receipt.v1',
      ok: true,
      requestId,
      releaseSha256: actualSha256,
      receivedBytes: upload.receivedBytes,
      immutableObjectKey: `releases/${actualSha256.slice('sha256:'.length)}`,
      spendReservationId: upload.spendReservationId,
      completedAtMs: nowMs,
    };
    this.#commitUploadTerminal(requestId, response, {
      state: 'complete',
      actualSha256,
      immutableObjectKey: response.immutableObjectKey,
      cleanupDueAtMs: null,
      unusedSpendReleased: true,
      nowMs,
    });
    return clone(response);
  }

  abortReleaseUpload(requestId, {
    code = 'SNAPBACK_RELEASE_UPLOAD_DISCONNECTED',
    nowMs = Date.now(),
  } = {}) {
    assertId(requestId, 'requestId');
    return this.#terminalizeUpload(requestId, { code, actualSha256: null, nowMs });
  }

  reconcileOpenUploads({ nowMs = Date.now() } = {}) {
    const receipts = [];
    for (const [requestId, upload] of Object.entries(this.#state.uploads)) {
      if (['reserved', 'receiving'].includes(upload.state)
          && (!this.#openUploadHashes.has(requestId)
            || nowMs - upload.reservedAtMs > MAX_UPLOAD_TOTAL_MS
            || nowMs - upload.lastProgressAtMs > MAX_UPLOAD_IDLE_MS)) {
        receipts.push(this.#terminalizeUpload(requestId, {
          code: this.#openUploadHashes.has(requestId)
            ? 'SNAPBACK_RELEASE_UPLOAD_TIMEOUT'
            : 'SNAPBACK_RELEASE_UPLOAD_STREAM_LOST',
          actualSha256: null,
          nowMs,
        }));
      }
    }
    return receipts;
  }

  #terminalizeUpload(requestId, { code, actualSha256, nowMs }) {
    const upload = this.#state.uploads[requestId];
    if (!upload || !['reserved', 'receiving'].includes(upload.state)) {
      refuse('SNAPBACK_RELEASE_UPLOAD_NOT_OPEN', 'upload is not open for terminalization', 409);
    }
    this.#openUploadHashes.delete(requestId);
    const response = {
      schemaVersion: 'snapback.release-upload-receipt.v1',
      ok: false,
      requestId,
      code,
      receivedBytes: upload.receivedBytes,
      declaredBytes: upload.declaredBytes,
      declaredSha256: upload.declaredSha256,
      actualSha256,
      temporaryObjectKey: upload.temporaryObjectKey,
      cleanupOnly: true,
      cleanupDueAtMs: nowMs + 24 * 60 * 60 * 1000,
      unusedSpendReleased: true,
      terminalAtMs: nowMs,
    };
    this.#commitUploadTerminal(requestId, response, {
      state: 'cleanupOnly',
      actualSha256,
      immutableObjectKey: null,
      cleanupDueAtMs: response.cleanupDueAtMs,
      unusedSpendReleased: true,
      nowMs,
    });
    return clone(response);
  }

  #commitUploadTerminal(requestId, response, terminal) {
    const pending = this.#state.pendingUploads[requestId];
    if (!pending) {
      refuse('SNAPBACK_RELEASE_UPLOAD_PENDING_REQUEST_MISSING', 'upload lost its pending authority request', 500);
    }
    const next = clone(this.#state);
    Object.assign(next.uploads[requestId], {
      state: terminal.state,
      actualSha256: terminal.actualSha256,
      immutableObjectKey: terminal.immutableObjectKey,
      cleanupDueAtMs: terminal.cleanupDueAtMs,
      unusedSpendReleased: terminal.unusedSpendReleased,
      terminalAtMs: terminal.nowMs,
    });
    this.#commitResponse(
      next,
      pending.request,
      pending.requestCanonical,
      response,
      terminal.nowMs,
    );
    delete next.pendingUploads[requestId];
    this.#state = next;
  }

  garbageCollectResponse(requestId, { nowMs = Date.now() } = {}) {
    assertId(requestId, 'requestId');
    const record = this.#state.requestJournal[requestId];
    if (!record) refuse('SNAPBACK_OPERATOR_RESPONSE_UNKNOWN', 'response is not retained', 404);
    if (nowMs < record.response.retainUntilMs) {
      refuse('SNAPBACK_OPERATOR_RESPONSE_RETENTION_ACTIVE', 'response is still inside minimum retention', 409);
    }
    const next = clone(this.#state);
    if (record.response.kind === 'object') delete next.responseObjects[record.response.objectKey];
    next.responseTombstones[requestId] = {
      requestId,
      requestSha256: record.requestSha256,
      responseSha256: record.response.sha256,
      deletedAtMs: nowMs,
      terminal: true,
    };
    delete next.requestJournal[requestId];
    next.updatedAtMs = nowMs;
    this.#state = next;
    return clone(next.responseTombstones[requestId]);
  }
}

export const __operatorAuthorityTest = Object.freeze({
  INLINE_RESPONSE_BYTES,
  MAX_RESPONSE_BYTES,
  MAX_UPLOAD_BYTES,
  MAX_UPLOAD_TOTAL_MS,
  MAX_UPLOAD_IDLE_MS,
  REQUEST_KEYS,
  REQUEST_SCHEMA_VERSION,
  STATE_SCHEMA_VERSION,
  randomRequestId: () => randomUUID(),
});
