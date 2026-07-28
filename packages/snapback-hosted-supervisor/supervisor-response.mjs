// Closed, purpose-bound SupervisorResponseV1 signing and verification.
//
// @ref LLP 0113#41-purpose-limited-service-intermediates — an online response
// key is accepted only through the exact `supervisor-response` intermediate
// chain and signature domain.
// @ref LLP 0111#atomic-request-response-replay — these exact signed bytes are
// the response retained by the operator request transaction.

import {
  createHash,
  createPrivateKey,
  createPublicKey,
  sign,
  verify,
} from 'node:crypto';

import {
  canonicalAuthorityJson,
  operatorRequestCanonicalSha256,
} from './operator-authority.mjs';

const DIGEST = /^sha256:[0-9a-f]{64}$/;
const RFC3339_MILLIS = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const INTERMEDIATE_VERSION = 'snapback.supervisor-service-intermediate.v1';
const RESPONSE_VERSION = 'snapback.supervisor-response.v1';
const RESPONSE_BODY_VERSION = 'snapback.supervisor-response-body.v1';
const INTERMEDIATE_DOMAIN = Buffer.from('snapback-supervisor-service-intermediate-v1\0');
const RESPONSE_DOMAIN = Buffer.from('snapback-supervisor-response-v1\0');
const MAX_INTERMEDIATE_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_RESPONSE_MS = 10 * 60 * 1000;
const ED25519_SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');

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

const RESPONSE_BODY_KEYS = Object.freeze([
  'diagnostic',
  'ok',
  'result',
  'schemaVersion',
]);

const RESPONSE_KEYS = Object.freeze([
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

export class SupervisorResponseRefusal extends Error {
  constructor(code, message, status = 500) {
    super(message);
    this.name = 'SupervisorResponseRefusal';
    this.code = code;
    this.status = status;
  }
}

function refuse(code, message, status = 500) {
  throw new SupervisorResponseRefusal(code, message, status);
}

function isPlainObject(value) {
  return value !== null
    && typeof value === 'object'
    && !Array.isArray(value)
    && Object.getPrototypeOf(value) === Object.prototype;
}

function assertClosed(value, keys, name) {
  if (
    !isPlainObject(value)
    || canonicalAuthorityJson(Object.keys(value).sort())
      !== canonicalAuthorityJson([...keys].sort())
  ) {
    refuse('SNAPBACK_SUPERVISOR_RESPONSE_INVALID', `${name} is not the exact closed shape`, 400);
  }
}

function sha256(bytes) {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
}

function unsigned(value) {
  const { signature: _signature, ...content } = value;
  return content;
}

function signingBytes(domain, value) {
  return Buffer.concat([domain, Buffer.from(canonicalAuthorityJson(unsigned(value)))]);
}

function signatureBytes(value, name) {
  if (typeof value !== 'string' || value.length > 512) {
    refuse('SNAPBACK_SUPERVISOR_RESPONSE_SIGNATURE_INVALID', `${name} signature is malformed`, 400);
  }
  const bytes = Buffer.from(value, 'base64url');
  if (bytes.length !== 64 || bytes.toString('base64url') !== value) {
    refuse('SNAPBACK_SUPERVISOR_RESPONSE_SIGNATURE_INVALID', `${name} signature is malformed`, 400);
  }
  return bytes;
}

function parseTime(value, name) {
  if (typeof value !== 'string' || !RFC3339_MILLIS.test(value)) {
    refuse('SNAPBACK_SUPERVISOR_RESPONSE_TIME_INVALID', `${name} must use millisecond RFC 3339`, 400);
  }
  const parsed = Date.parse(value);
  if (!Number.isSafeInteger(parsed)) {
    refuse('SNAPBACK_SUPERVISOR_RESPONSE_TIME_INVALID', `${name} is outside the supported interval`, 400);
  }
  return parsed;
}

function rawEd25519PublicKey(value) {
  const bytes = Buffer.from(value ?? '', 'base64url');
  if (bytes.length !== 32 || bytes.toString('base64url') !== value) {
    refuse(
      'SNAPBACK_SUPERVISOR_RESPONSE_INTERMEDIATE_INVALID',
      'response intermediate public key must be canonical Ed25519 bytes',
      400,
    );
  }
  return bytes;
}

function publicKeyForRawEd25519(bytes) {
  return createPublicKey({
    key: Buffer.concat([ED25519_SPKI_PREFIX, bytes]),
    format: 'der',
    type: 'spki',
  });
}

function validateIntermediate(intermediate, {
  installationId,
  rootKeyId,
  rootPublicKey,
  nowMs,
  allowHistorical = false,
}) {
  assertClosed(intermediate, INTERMEDIATE_KEYS, 'SupervisorServiceIntermediateV1');
  if (
    intermediate.schemaVersion !== INTERMEDIATE_VERSION
    || intermediate.installationId !== installationId
    || intermediate.rootKeyId !== rootKeyId
    || intermediate.purpose !== 'supervisor-response'
    || typeof intermediate.intermediateKeyId !== 'string'
    || intermediate.intermediateKeyId.length < 1
    || !Number.isSafeInteger(intermediate.serial)
    || intermediate.serial < 1
    || !Number.isSafeInteger(intermediate.revocationGeneration)
    || intermediate.revocationGeneration < 1
  ) {
    refuse(
      'SNAPBACK_SUPERVISOR_RESPONSE_INTERMEDIATE_INVALID',
      'response intermediate identity, purpose, serial, or generation is invalid',
      403,
    );
  }
  const issuedAtMs = parseTime(intermediate.issuedAt, 'intermediate issuedAt');
  const notBeforeMs = parseTime(intermediate.notBefore, 'intermediate notBefore');
  const expiresAtMs = parseTime(intermediate.expiresAt, 'intermediate expiresAt');
  if (
    issuedAtMs > notBeforeMs
    || expiresAtMs <= notBeforeMs
    || expiresAtMs - notBeforeMs > MAX_INTERMEDIATE_MS
    || (!allowHistorical && (nowMs < notBeforeMs || nowMs >= expiresAtMs))
  ) {
    refuse(
      'SNAPBACK_SUPERVISOR_RESPONSE_INTERMEDIATE_EXPIRED',
      'response intermediate is outside its exact validity interval',
      403,
    );
  }
  if (!verify(
    null,
    signingBytes(INTERMEDIATE_DOMAIN, intermediate),
    rootPublicKey,
    signatureBytes(intermediate.signature, 'intermediate'),
  )) {
    refuse(
      'SNAPBACK_SUPERVISOR_RESPONSE_INTERMEDIATE_INVALID',
      'response intermediate root signature did not verify',
      403,
    );
  }
  return {
    publicKey: publicKeyForRawEd25519(rawEd25519PublicKey(intermediate.publicKeyEd25519)),
    notBeforeMs,
    expiresAtMs,
  };
}

function validateBody(body) {
  assertClosed(body, RESPONSE_BODY_KEYS, 'SupervisorResponseBodyV1');
  if (body.diagnostic !== null) {
    assertClosed(body.diagnostic, ['code', 'message', 'status'], 'SupervisorResponseDiagnosticV1');
  }
  if (
    body.schemaVersion !== RESPONSE_BODY_VERSION
    || typeof body.ok !== 'boolean'
    || (body.ok && body.diagnostic !== null)
    || (!body.ok && !isPlainObject(body.diagnostic))
    || (body.diagnostic !== null && (
      typeof body.diagnostic.code !== 'string'
      || typeof body.diagnostic.message !== 'string'
      || !Number.isSafeInteger(body.diagnostic.status)
      || body.diagnostic.status < 400
      || body.diagnostic.status > 599
    ))
  ) {
    refuse('SNAPBACK_SUPERVISOR_RESPONSE_INVALID', 'response body union is invalid', 400);
  }
  canonicalAuthorityJson(body.result);
  canonicalAuthorityJson(body.diagnostic);
}

function createSignerCore({
  intermediate,
  rootPublicKey,
  installationId,
  rootKeyId,
  signResponseBytes,
  readCurrentIntermediateHead,
}) {
  function assertCurrentPurposeHead() {
    const head = readCurrentIntermediateHead();
    if (
      !isPlainObject(head)
      || head.purpose !== 'supervisor-response'
      || head.rootKeyId !== intermediate.rootKeyId
      || head.intermediateKeyId !== intermediate.intermediateKeyId
      || head.serial !== intermediate.serial
      || head.revocationGeneration !== intermediate.revocationGeneration
      || head.expiresAt !== intermediate.expiresAt
    ) {
      refuse(
        'SNAPBACK_SUPERVISOR_RESPONSE_AUTHORITY_HEAD_DRIFT',
        'response intermediate is not the exact current purpose head',
        503,
      );
    }
  }

  function currentValidity(nowMs) {
    const validity = validateIntermediate(intermediate, {
      installationId,
      rootKeyId,
      rootPublicKey,
      nowMs,
    });
    assertCurrentPurposeHead();
    return validity;
  }

  function assertReady(nowMs = Date.now()) {
    currentValidity(nowMs);
    return true;
  }

  function signResponse({
    request,
    body,
    supervisorIncarnation,
    supervisorGeneration,
    supervisorHeadSha256,
    nowMs = Date.now(),
  }) {
    const { expiresAtMs } = currentValidity(nowMs);
    validateBody(body);
    if (
      request.installationId !== installationId
      || !DIGEST.test(request.operatorCertificateSha256 ?? '')
      || !(request.targetHeadSha256 === null || DIGEST.test(request.targetHeadSha256 ?? ''))
      || !DIGEST.test(supervisorHeadSha256 ?? '')
      || !Number.isSafeInteger(supervisorGeneration)
      || supervisorGeneration < 1
      || typeof supervisorIncarnation !== 'string'
      || supervisorIncarnation.length < 1
    ) {
      refuse(
        'SNAPBACK_SUPERVISOR_RESPONSE_BINDING_INVALID',
        'response request, certificate, target, generation, or head binding is invalid',
        409,
      );
    }
    const issuedAt = new Date(nowMs).toISOString();
    const expiresAt = new Date(Math.min(nowMs + MAX_RESPONSE_MS, expiresAtMs)).toISOString();
    const content = {
      schemaVersion: RESPONSE_VERSION,
      audience: 'snapback-operator',
      installationId,
      supervisorIncarnation,
      supervisorGeneration,
      supervisorHeadSha256,
      requestId: request.requestId,
      requestSha256: operatorRequestCanonicalSha256(request),
      operatorCertificateSha256: request.operatorCertificateSha256,
      targetHeadSha256: request.targetHeadSha256,
      bodySha256: sha256(Buffer.from(canonicalAuthorityJson(body))),
      body: structuredClone(body),
      issuedAt,
      notBefore: issuedAt,
      expiresAt,
      keyId: intermediate.intermediateKeyId,
      serviceIntermediate: structuredClone(intermediate),
    };
    const bytesToSign = Buffer.concat([
      RESPONSE_DOMAIN,
      Buffer.from(canonicalAuthorityJson(content)),
    ]);
    const signatureValue = signResponseBytes(bytesToSign);
    const signature = Buffer.isBuffer(signatureValue)
      ? signatureValue.toString('base64url')
      : String(signatureValue);
    const responsePublicKey =
      publicKeyForRawEd25519(rawEd25519PublicKey(intermediate.publicKeyEd25519));
    if (!verify(
      null,
      bytesToSign,
      responsePublicKey,
      signatureBytes(signature, 'response'),
    )) {
      refuse(
        'SNAPBACK_SUPERVISOR_RESPONSE_CUSTODY_INVALID',
        'response custody signer returned a signature from another key',
      );
    }
    return { ...content, signature };
  }

  return Object.freeze({
    assertReady,
    signResponse,
  });
}

export function createExternalSupervisorResponseSigner({
  intermediate,
  signResponseBytes,
  rootPublicKeyPem,
  installationId,
  rootKeyId,
  readCurrentIntermediateHead,
}) {
  if (
    typeof signResponseBytes !== 'function'
    || typeof readCurrentIntermediateHead !== 'function'
  ) {
    refuse(
      'SNAPBACK_SUPERVISOR_RESPONSE_CUSTODY_INVALID',
      'response signer requires a native custody callback',
    );
  }
  return createSignerCore({
    intermediate,
    rootPublicKey: createPublicKey(rootPublicKeyPem),
    installationId,
    rootKeyId,
    signResponseBytes,
    readCurrentIntermediateHead,
  });
}

// Fixture/offline helper. Production service.mjs deliberately uses the
// external signer above so the intermediate private key never enters JS.
export function createSupervisorResponseSigner({
  intermediate,
  privateKeyPem,
  rootPublicKeyPem,
  installationId,
  rootKeyId,
  readCurrentIntermediateHead = () => ({
    purpose: 'supervisor-response',
    rootKeyId: intermediate.rootKeyId,
    intermediateKeyId: intermediate.intermediateKeyId,
    serial: intermediate.serial,
    revocationGeneration: intermediate.revocationGeneration,
    expiresAt: intermediate.expiresAt,
  }),
}) {
  const privateKey = createPrivateKey(privateKeyPem);
  const publicDer = createPublicKey(privateKey).export({ format: 'der', type: 'spki' });
  const expectedRaw = rawEd25519PublicKey(intermediate.publicKeyEd25519);
  if (
    publicDer.length !== ED25519_SPKI_PREFIX.length + expectedRaw.length
    || !publicDer.subarray(ED25519_SPKI_PREFIX.length).equals(expectedRaw)
  ) {
    refuse(
      'SNAPBACK_SUPERVISOR_RESPONSE_KEY_MISMATCH',
      'response private key does not match its purpose-limited intermediate',
    );
  }
  return createSignerCore({
    intermediate,
    rootPublicKey: createPublicKey(rootPublicKeyPem),
    installationId,
    rootKeyId,
    signResponseBytes: (bytes) => sign(null, bytes, privateKey),
    readCurrentIntermediateHead,
  });
}

export function verifySupervisorResponse(response, {
  rootPublicKeyPem,
  expectedInstallationId,
  expectedRootKeyId,
  expectedRequest = undefined,
  nowMs = Date.now(),
  allowHistorical = false,
}) {
  assertClosed(response, RESPONSE_KEYS, 'SupervisorResponseV1');
  if (
    response.schemaVersion !== RESPONSE_VERSION
    || response.audience !== 'snapback-operator'
    || response.installationId !== expectedInstallationId
    || response.keyId !== response.serviceIntermediate?.intermediateKeyId
    || !DIGEST.test(response.supervisorHeadSha256 ?? '')
    || !DIGEST.test(response.bodySha256 ?? '')
    || !(response.targetHeadSha256 === null || DIGEST.test(response.targetHeadSha256 ?? ''))
    || !Number.isSafeInteger(response.supervisorGeneration)
    || response.supervisorGeneration < 1
  ) {
    refuse('SNAPBACK_SUPERVISOR_RESPONSE_INVALID', 'response identity or digest binding is invalid', 400);
  }
  validateBody(response.body);
  if (sha256(Buffer.from(canonicalAuthorityJson(response.body))) !== response.bodySha256) {
    refuse('SNAPBACK_SUPERVISOR_RESPONSE_BODY_MISMATCH', 'response body digest did not verify', 409);
  }
  const issuedAtMs = parseTime(response.issuedAt, 'response issuedAt');
  const notBeforeMs = parseTime(response.notBefore, 'response notBefore');
  const expiresAtMs = parseTime(response.expiresAt, 'response expiresAt');
  if (
    issuedAtMs !== notBeforeMs
    || expiresAtMs <= notBeforeMs
    || expiresAtMs - issuedAtMs > MAX_RESPONSE_MS
    || (!allowHistorical && (nowMs < notBeforeMs || nowMs > expiresAtMs))
  ) {
    refuse('SNAPBACK_SUPERVISOR_RESPONSE_EXPIRED', 'response is outside its validity interval', 403);
  }
  const { publicKey, notBeforeMs: intermediateStart, expiresAtMs: intermediateEnd } =
    validateIntermediate(response.serviceIntermediate, {
      installationId: expectedInstallationId,
      rootKeyId: expectedRootKeyId,
      rootPublicKey: createPublicKey(rootPublicKeyPem),
      nowMs,
      allowHistorical,
    });
  if (issuedAtMs < intermediateStart || issuedAtMs > intermediateEnd) {
    refuse(
      'SNAPBACK_SUPERVISOR_RESPONSE_INTERMEDIATE_EXPIRED',
      'response issue time is outside the intermediate validity interval',
      403,
    );
  }
  if (!verify(
    null,
    signingBytes(RESPONSE_DOMAIN, response),
    publicKey,
    signatureBytes(response.signature, 'response'),
  )) {
    refuse('SNAPBACK_SUPERVISOR_RESPONSE_SIGNATURE_INVALID', 'response signature did not verify', 403);
  }
  if (expectedRequest && (
    response.requestId !== expectedRequest.requestId
    || response.requestSha256 !== operatorRequestCanonicalSha256(expectedRequest)
    || response.operatorCertificateSha256 !== expectedRequest.operatorCertificateSha256
    || response.targetHeadSha256 !== expectedRequest.targetHeadSha256
  )) {
    refuse('SNAPBACK_SUPERVISOR_RESPONSE_REQUEST_MISMATCH', 'response is bound to another request', 409);
  }
  return structuredClone(response);
}

export const __supervisorResponseTest = Object.freeze({
  INTERMEDIATE_DOMAIN,
  INTERMEDIATE_KEYS,
  INTERMEDIATE_VERSION,
  MAX_RESPONSE_MS,
  RESPONSE_BODY_KEYS,
  RESPONSE_BODY_VERSION,
  RESPONSE_DOMAIN,
  RESPONSE_KEYS,
  RESPONSE_VERSION,
});
