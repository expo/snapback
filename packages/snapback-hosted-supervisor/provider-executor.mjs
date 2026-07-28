// Supervisor-only executor for the closed Fly lifecycle V2 vocabulary.
//
// @ref LLP 0105#closed-carrier-digest-and-effect-journal — every operation
// is admitted through the generated closed carrier and returns one immutable
// applied/notApplied/commitUncertain terminal.
// @ref LLP 0105#exact-v1-closure-and-additive-v2-operations — this registry is
// exactly the packaged 17-operation lifecycle V2 vocabulary.
// @ref LLP 0105#always-on-supervisor-and-canonical-single-writer-head — Fly
// and Tigris authority is injected only by the standing supervisor; neither
// the CLI nor application target can resolve it.

import { createHash } from 'node:crypto';

import {
  canonicalJson,
  sha256,
  verifyBoundFlyMachineRoster,
} from './index.mjs';

const DIGEST = /^sha256:[0-9a-f]{64}$/;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,255}$/;
const REQUEST_VERSION = 'snapback.vm-adapter-lifecycle-request.v2';
const RESPONSE_VERSION = 'snapback.vm-adapter-lifecycle-response.v2';
const TERMINAL_VERSION = 'snapback.provider-effect-terminal.v1';
const OBSERVATION_VERSION = 'snapback.provider-effect-observation.v1';
const CANONICAL_FLY_API = 'https://api.machines.dev';
const REQUEST_KEYS = Object.freeze([
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
const INTENT_KEYS = Object.freeze([
  'desiredProviderStateSha256',
  'effectKind',
  'logicalResourceName',
  'operation',
  'operationId',
  'planSha256',
  'predecessorHeadSha256',
  'requestSha256',
  'schemaVersion',
  'semanticEffectId',
  'targetBindingSha256',
]);
const HEAD_KEYS = Object.freeze([
  'activationGeneration',
  'activeReleaseId',
  'admissionGeneration',
  'bindingSha256',
  'cleanupFloor',
  'committedAtMs',
  'generation',
  'journalRootSha256',
  'predecessorSha256',
  'replayFloor',
  'schemaVersion',
  'spendFloor',
  'supervisorIncarnation',
  'targetId',
]);
const LEASE_KEYS = Object.freeze([
  'acquiredAtMs',
  'expectedActivationGeneration',
  'expiresAtMs',
  'leaseId',
  'operationId',
  'targetId',
]);

export const PROVIDER_LIFECYCLE_OPERATIONS = Object.freeze([
  'acquireLease',
  'renewLease',
  'uploadImmutableRelease',
  'provisionInactive',
  'compatibilityPreflight',
  'createVerifiedBackup',
  'stageRelease',
  'activateGeneration',
  'verifyServedPath',
  'rollback',
  'fenceExternalEffects',
  'restoreBackupInactive',
  'verifyRestoredComponents',
  'verifyRestoredApplication',
  'activateRestoredGeneration',
  'reconcileEffect',
  'releaseLease',
]);

// The existing V2 schema cannot safely carry these required operation inputs.
// Keeping this exhaustive registry beside the executor turns each absence into
// a stable terminal rather than a private request dialect.
export const PROVIDER_OPERATION_BLOCKERS = Object.freeze({
  acquireLease: 'response carrier has no DeploymentLease member for the provider nonce',
  renewLease: 'Fly exposes create/get/release but no in-place lease-renew effect and the request has no replacement approval',
  uploadImmutableRelease: 'release.upload is a separate bounded stream and this carrier has no verified upload receipt',
  provisionInactive: 'carrier has no closed successor Machine/volume desired configuration',
  compatibilityPreflight: 'carrier has no release manifest, migration approval, or compatibility receipt vector',
  createVerifiedBackup: 'carrier has no maintenance fence, backup manifest, or Tigris destination identity',
  stageRelease: 'carrier has no verified release-upload receipt or desired staged control head',
  activateGeneration: 'carrier has no migration authority, successor config, or closed cutover state',
  verifyServedPath: 'carrier has no expected health nonce, served manifest, or authenticated inspection identity',
  rollback: 'carrier has no held-generation compatibility receipt or rollback approval payload',
  fenceExternalEffects: 'carrier has no exact runtime fence generation or desired Machine metadata',
  restoreBackupInactive: 'carrier has no backup identity, restore translation, or successor volume plan',
  verifyRestoredComponents: 'carrier has no restored component manifest or successor resource identity',
  verifyRestoredApplication: 'carrier has no hidden served endpoint, integrity nonce, or expected application facts',
  activateRestoredGeneration: 'carrier has no verified restore receipt or closed predecessor/successor handoff state',
  reconcileEffect: 'carrier has no uncertain-attempt reference, fresh observation vector, or resolved outcome',
});

export class ProviderExecutorRefusal extends Error {
  constructor(code, message, status = 409) {
    super(message);
    this.name = 'ProviderExecutorRefusal';
    this.code = code;
    this.status = status;
  }
}

function refuse(code, message, status = 409) {
  throw new ProviderExecutorRefusal(code, message, status);
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
    || canonicalJson(Object.keys(value).sort()) !== canonicalJson([...keys].sort())
  ) {
    refuse('SNAPBACK_HOSTED_LIFECYCLE_REQUEST_INVALID', `${name} is not the exact closed shape`, 400);
  }
}

function safeId(value) {
  return typeof value === 'string' && SAFE_ID.test(value);
}

function headSha256(head) {
  return sha256(Buffer.from(canonicalJson(head)));
}

function bindingSha256(binding) {
  return sha256(Buffer.from(canonicalJson(binding)));
}

function providerRequestSha256(method, uri, bodySha256 = null) {
  return sha256(Buffer.from(canonicalJson({ method, uri, bodySha256 })));
}

function responseFor(request, {
  ok,
  remoteEvidence = false,
  terminal,
  observation = null,
  diagnostics = [],
  idempotentReplay = false,
}) {
  return {
    schemaVersion: RESPONSE_VERSION,
    operation: request.operation,
    operationId: request.operationId,
    ok,
    idempotentReplay,
    remoteEvidence,
    requestSha256: request.requestSha256,
    terminal,
    controlHead: structuredClone(request.predecessorHead),
    observation,
    diagnostics,
  };
}

function terminalFor(request, outcome, {
  reason = null,
  recoveryClass = null,
  providerVersion = null,
  lastObservationSha256 = null,
  redactedEvidenceSha256 = null,
  retainedResultSha256 = null,
  nowMs = Date.now(),
} = {}) {
  return {
    schemaVersion: TERMINAL_VERSION,
    semanticEffectId: request.effectIntent.semanticEffectId,
    outcome,
    recordedAtMs: nowMs,
    reason,
    recoveryClass,
    providerVersion,
    lastObservationSha256,
    redactedEvidenceSha256,
    retainedResultSha256,
  };
}

function safeDiagnostic(code, message) {
  return { code, severity: 'error', message };
}

function diagnosticCode(error, fallback) {
  return typeof error?.code === 'string' && /^SNAPBACK_[A-Z0-9_]+$/.test(error.code)
    ? error.code
    : fallback;
}

function validateRequest(request) {
  assertClosed(request, REQUEST_KEYS, 'AdapterLifecycleRequestV2');
  assertClosed(request.effectIntent, INTENT_KEYS, 'ProviderEffectIntentV1');
  assertClosed(request.predecessorHead, HEAD_KEYS, 'HostedControlHeadV2');
  if (request.lease !== null) assertClosed(request.lease, LEASE_KEYS, 'DeploymentLease');
  if (
    request.schemaVersion !== REQUEST_VERSION
    || !PROVIDER_LIFECYCLE_OPERATIONS.includes(request.operation)
    || !safeId(request.operationId)
    || !Number.isSafeInteger(request.attempt)
    || request.attempt < 0
    || !DIGEST.test(request.planSha256 ?? '')
    || !DIGEST.test(request.requestSha256 ?? '')
    || !(request.confirmationSha256 === null || DIGEST.test(request.confirmationSha256 ?? ''))
    || request.predecessorHead.schemaVersion !== 'snapback.hosted-control-head.v2'
    || request.predecessorHead.targetId !== request.targetBinding?.targetId
    || request.effectIntent.schemaVersion !== 'snapback.provider-effect-intent.v1'
    || request.effectIntent.operation !== request.operation
    || request.effectIntent.operationId !== request.operationId
    || request.effectIntent.planSha256 !== request.planSha256
    || request.effectIntent.requestSha256 !== request.requestSha256
    || request.effectIntent.targetBindingSha256 !== bindingSha256(request.targetBinding)
    || request.effectIntent.predecessorHeadSha256 !== headSha256(request.predecessorHead)
    || !safeId(request.effectIntent.semanticEffectId)
    || !DIGEST.test(request.effectIntent.desiredProviderStateSha256 ?? '')
  ) {
    refuse(
      'SNAPBACK_HOSTED_LIFECYCLE_REQUEST_INVALID',
      'lifecycle identity, operation, target, plan, intent, or head binding is invalid',
      400,
    );
  }
  if (request.lease !== null && (
    !safeId(request.lease.leaseId)
    || request.lease.targetId !== request.targetBinding.targetId
    || !Number.isSafeInteger(request.lease.expiresAtMs)
    || !Number.isSafeInteger(request.lease.acquiredAtMs)
  )) {
    refuse('SNAPBACK_HOSTED_LIFECYCLE_REQUEST_INVALID', 'deployment lease binding is invalid', 400);
  }
  return request;
}

async function responseBytes(response) {
  return Buffer.from(await response.arrayBuffer());
}

function parseJson(bytes, code) {
  try {
    return JSON.parse(bytes.toString('utf8'));
  } catch {
    refuse(code, 'provider returned malformed JSON', 502);
  }
}

function observationFor(request, uri, method, {
  bodySha256 = null,
  providerRevision = null,
  nowMs,
}) {
  return {
    schemaVersion: OBSERVATION_VERSION,
    semanticEffectId: request.effectIntent.semanticEffectId,
    providerRequestSha256: providerRequestSha256(method, uri, bodySha256),
    providerUri: uri,
    observedAtMs: nowMs,
    providerRevision,
  };
}

async function exactFlyRoster({
  fetchImpl,
  apiBase,
  token,
  binding,
}) {
  const uri = `${apiBase}/v1/apps/${encodeURIComponent(binding.appId)}/machines`;
  const read = async () => {
    const response = await fetchImpl(uri, {
      headers: { authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(12_000),
    });
    return { status: response.status, bytes: await responseBytes(response) };
  };
  const first = await read();
  const second = await read();
  if (
    first.status !== 200
    || second.status !== 200
    || sha256(first.bytes) !== sha256(second.bytes)
  ) {
    refuse(
      'SNAPBACK_HOSTED_FLY_READBACK_UNSTABLE',
      'two bounded Fly roster reads did not return one identical successful body',
      503,
    );
  }
  const machines = parseJson(first.bytes, 'SNAPBACK_HOSTED_FLY_READBACK_INVALID');
  const active = verifyBoundFlyMachineRoster(binding, machines);
  return {
    active,
    bytes: first.bytes,
    sha256: sha256(first.bytes),
    uri: apiBase === CANONICAL_FLY_API
      ? uri
      : `${CANONICAL_FLY_API}/v1/apps/${encodeURIComponent(binding.appId)}/machines`,
  };
}

async function exactTigrisHead({ readTigrisControlHead, request }) {
  if (typeof readTigrisControlHead !== 'function') {
    refuse(
      'SNAPBACK_HOSTED_TIGRIS_CONTROL_CREDENTIAL_UNAVAILABLE',
      'standing supervisor has no target-scoped Tigris control-state reader',
      503,
    );
  }
  const first = await readTigrisControlHead(request.targetBinding);
  const second = await readTigrisControlHead(request.targetBinding);
  const firstBytes = Buffer.from(first?.bytes ?? []);
  const secondBytes = Buffer.from(second?.bytes ?? []);
  if (
    firstBytes.length < 2
    || first?.version === undefined
    || second?.version === undefined
    || first.version !== second.version
    || sha256(firstBytes) !== sha256(secondBytes)
  ) {
    refuse(
      'SNAPBACK_HOSTED_TIGRIS_READBACK_UNSTABLE',
      'two bounded Tigris control-head reads did not return one identical version',
      503,
    );
  }
  let head;
  try {
    head = JSON.parse(firstBytes.toString('utf8'));
  } catch {
    refuse('SNAPBACK_HOSTED_TIGRIS_HEAD_INVALID', 'Tigris control head is not one JSON value', 503);
  }
  if (canonicalJson(head) !== canonicalJson(request.predecessorHead)) {
    refuse(
      'SNAPBACK_HOSTED_TIGRIS_HEAD_MISMATCH',
      'Tigris control head does not equal the request predecessor head',
      409,
    );
  }
  return {
    sha256: sha256(firstBytes),
    version: String(first.version),
  };
}

async function exactLeaseRead({
  fetchImpl,
  apiBase,
  token,
  binding,
}) {
  const providerPath =
    `/v1/apps/${encodeURIComponent(binding.appId)}/machines/${encodeURIComponent(binding.activeMachineId)}/lease`;
  const actualUri = `${apiBase}${providerPath}`;
  const safeUri = `${CANONICAL_FLY_API}${providerPath}`;
  const read = async () => {
    const response = await fetchImpl(actualUri, {
      headers: { authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(12_000),
    });
    return { status: response.status, bytes: await responseBytes(response) };
  };
  const first = await read();
  const second = await read();
  if (
    first.status !== second.status
    || sha256(first.bytes) !== sha256(second.bytes)
    || ![200, 404].includes(first.status)
  ) {
    refuse(
      'SNAPBACK_HOSTED_FLY_LEASE_READBACK_UNSTABLE',
      'two bounded Fly lease reads did not return one identical terminal fact',
      503,
    );
  }
  return {
    status: first.status,
    value: first.status === 200
      ? parseJson(first.bytes, 'SNAPBACK_HOSTED_FLY_LEASE_READBACK_INVALID')
      : null,
    bytes: first.bytes,
    actualUri,
    safeUri,
  };
}

export function createFlyTigrisProviderExecutor({
  fetchImpl = globalThis.fetch,
  resolveFlyControlToken,
  readTigrisControlHead,
  flyApiBase = CANONICAL_FLY_API,
  now = () => Date.now(),
} = {}) {
  if (typeof fetchImpl !== 'function') {
    refuse('SNAPBACK_HOSTED_PROVIDER_EXECUTOR_INVALID', 'provider executor requires fetch', 500);
  }

  return Object.freeze({
    async execute(input, {
      beforeProviderEffect = undefined,
    } = {}) {
      const request = validateRequest(structuredClone(input));
      const nowMs = now();
      const blocker = PROVIDER_OPERATION_BLOCKERS[request.operation];
      if (blocker) {
        return responseFor(request, {
          ok: false,
          terminal: terminalFor(request, 'notApplied', {
            reason: 'closedCarrierPrerequisiteMissing',
            nowMs,
          }),
          diagnostics: [safeDiagnostic(
            'SNAPBACK_HOSTED_LIFECYCLE_CARRIER_INCOMPLETE',
            `${request.operation} refused: ${blocker}`,
          )],
        });
      }
      let token;
      let tokenError = null;
      try {
        token = await resolveFlyControlToken?.(request.targetBinding);
      } catch (error) {
        token = null;
        tokenError = error;
      }
      if (typeof token !== 'string' || token.length < 1) {
        return responseFor(request, {
          ok: false,
          terminal: terminalFor(request, 'notApplied', {
            reason: 'flyControlCredentialUnavailable',
            nowMs,
          }),
          diagnostics: [safeDiagnostic(
            diagnosticCode(
              tokenError,
              'SNAPBACK_HOSTED_FLY_CONTROL_CREDENTIAL_UNAVAILABLE',
            ),
            tokenError === null
              ? 'standing supervisor cannot resolve the exact target-scoped Fly control credential'
              : String(tokenError.message).slice(0, 512),
          )],
        });
      }

      try {
        await exactFlyRoster({
          fetchImpl,
          apiBase: flyApiBase,
          token,
          binding: request.targetBinding,
        });
        await exactTigrisHead({ readTigrisControlHead, request });
      } catch (error) {
        const code = diagnosticCode(error, 'SNAPBACK_HOSTED_PROVIDER_READBACK_FAILED');
        return responseFor(request, {
          ok: false,
          terminal: terminalFor(request, 'notApplied', {
            reason: 'providerReadbackRefused',
            nowMs,
          }),
          diagnostics: [safeDiagnostic(
            code,
            String(error?.message ?? 'provider read-back failed').slice(0, 512),
          )],
        });
      }

      if (request.operation !== 'releaseLease') {
        refuse(
          'SNAPBACK_HOSTED_LIFECYCLE_REGISTRY_DRIFT',
          `operation ${request.operation} has neither an executor nor a blocker`,
          500,
        );
      }
      if (request.lease === null) {
        return responseFor(request, {
          ok: false,
          terminal: terminalFor(request, 'notApplied', {
            reason: 'leaseRequired',
            nowMs,
          }),
          diagnostics: [safeDiagnostic(
            'SNAPBACK_DEPLOY_LEASE_INVALID',
            'releaseLease requires the exact acquired provider lease',
          )],
        });
      }

      let before;
      try {
        before = await exactLeaseRead({
          fetchImpl,
          apiBase: flyApiBase,
          token,
          binding: request.targetBinding,
        });
      } catch (error) {
        return responseFor(request, {
          ok: false,
          terminal: terminalFor(request, 'notApplied', {
            reason: 'leaseReadbackRefused',
            nowMs,
          }),
          diagnostics: [safeDiagnostic(
            error.code ?? 'SNAPBACK_HOSTED_FLY_LEASE_READBACK_FAILED',
            String(error.message ?? error).slice(0, 512),
          )],
        });
      }
      const providerLease = before.value?.data;
      if (
        before.status !== 200
        || providerLease?.nonce !== request.lease.leaseId
        || !Number.isFinite(Number(providerLease?.expires_at))
      ) {
        return responseFor(request, {
          ok: false,
          terminal: terminalFor(request, 'notApplied', {
            reason: 'leaseReadbackMismatch',
            providerVersion: providerLease?.version ?? null,
            nowMs,
          }),
          diagnostics: [safeDiagnostic(
            'SNAPBACK_DEPLOY_LEASE_INVALID',
            'Fly lease read-back does not match the exact request lease',
          )],
        });
      }

      const effectObservation = observationFor(
        request,
        before.safeUri,
        'DELETE',
        { providerRevision: providerLease.version ?? null, nowMs },
      );
      if (typeof beforeProviderEffect === 'function') {
        await beforeProviderEffect(structuredClone(effectObservation));
      }

      let effect;
      try {
        effect = await fetchImpl(before.actualUri, {
          method: 'DELETE',
          headers: {
            authorization: `Bearer ${token}`,
            'fly-machine-lease-nonce': request.lease.leaseId,
          },
          signal: AbortSignal.timeout(12_000),
        });
      } catch {
        return responseFor(request, {
          ok: false,
          terminal: terminalFor(request, 'commitUncertain', {
            reason: 'providerResponseLost',
            recoveryClass: 'freshLeaseReadbackRequired',
            providerVersion: providerLease.version ?? null,
            lastObservationSha256: sha256(Buffer.from(canonicalJson(effectObservation))),
            nowMs,
          }),
          observation: effectObservation,
          diagnostics: [safeDiagnostic(
            'SNAPBACK_HOSTED_PROVIDER_COMMIT_UNCERTAIN',
            'Fly lease release response was lost; exact reconciliation is required',
          )],
        });
      }
      const effectBytes = await responseBytes(effect);
      const evidenceSha256 = sha256(effectBytes);
      if (effect.status !== 200) {
        const uncertain = effect.status >= 500;
        return responseFor(request, {
          ok: false,
          terminal: terminalFor(request, uncertain ? 'commitUncertain' : 'notApplied', {
            reason: uncertain ? 'providerServerFailure' : 'providerRefused',
            recoveryClass: uncertain ? 'freshLeaseReadbackRequired' : null,
            providerVersion: providerLease.version ?? null,
            lastObservationSha256: sha256(Buffer.from(canonicalJson(effectObservation))),
            redactedEvidenceSha256: evidenceSha256,
            nowMs,
          }),
          observation: effectObservation,
          diagnostics: [safeDiagnostic(
            uncertain
              ? 'SNAPBACK_HOSTED_PROVIDER_COMMIT_UNCERTAIN'
              : 'SNAPBACK_HOSTED_PROVIDER_EFFECT_REFUSED',
            `Fly lease release returned HTTP ${effect.status}`,
          )],
        });
      }

      let after;
      try {
        after = await exactLeaseRead({
          fetchImpl,
          apiBase: flyApiBase,
          token,
          binding: request.targetBinding,
        });
      } catch {
        after = null;
      }
      if (after?.status !== 404) {
        return responseFor(request, {
          ok: false,
          terminal: terminalFor(request, 'commitUncertain', {
            reason: 'postEffectReadbackUnavailable',
            recoveryClass: 'freshLeaseReadbackRequired',
            providerVersion: providerLease.version ?? null,
            lastObservationSha256: sha256(Buffer.from(canonicalJson(effectObservation))),
            redactedEvidenceSha256: evidenceSha256,
            nowMs,
          }),
          observation: effectObservation,
          diagnostics: [safeDiagnostic(
            'SNAPBACK_HOSTED_PROVIDER_COMMIT_UNCERTAIN',
            'Fly acknowledged lease release but exact absence read-back did not converge',
          )],
        });
      }
      const retainedResultSha256 = sha256(Buffer.from(canonicalJson({
        targetId: request.targetBinding.targetId,
        machineId: request.targetBinding.activeMachineId,
        releasedLeaseSha256: `sha256:${createHash('sha256')
          .update(request.lease.leaseId)
          .digest('hex')}`,
        providerVersion: providerLease.version ?? null,
        absentReadbackSha256: sha256(after.bytes),
      })));
      return responseFor(request, {
        ok: true,
        remoteEvidence: flyApiBase === CANONICAL_FLY_API,
        terminal: terminalFor(request, 'applied', {
          providerVersion: providerLease.version ?? null,
          lastObservationSha256: sha256(Buffer.from(canonicalJson(effectObservation))),
          redactedEvidenceSha256: evidenceSha256,
          retainedResultSha256,
          nowMs,
        }),
        observation: effectObservation,
      });
    },
  });
}

export const __providerExecutorTest = Object.freeze({
  HEAD_KEYS,
  INTENT_KEYS,
  LEASE_KEYS,
  REQUEST_KEYS,
  bindingSha256,
  headSha256,
});
