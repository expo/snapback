// Public/operator mTLS admission and canonical provider transaction bridge.
//
// @ref LLP 0111#public-operator-and-command-authority — the CLI submits one
// closed signed request; provider credentials remain in this supervisor.
// @ref LLP 0111#atomic-request-response-replay — effect intent, effecting
// observation, terminal, and exact signed response each reach the canonical
// external authority before the next irreversible boundary.

import {
  canonicalAuthorityJson,
  OperatorAuthorityRefusal,
} from './operator-authority.mjs';
import {
  reserveOperatorAuthorityTransaction,
  settleOperatorAuthorityTransaction,
} from './operator-authority-transaction.mjs';
import { certificateSha256 } from './hosted-edge-admission.mjs';
import {
  canonicalJson,
  lifecycleRequestDigest,
  semanticEffectId,
  sha256,
} from './index.mjs';

const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,255}$/;
const DIGEST = /^sha256:[0-9a-f]{64}$/;
const LIFECYCLE_BODY_KEYS = Object.freeze([
  'grantId',
  'journeyId',
  'lifecycleRequest',
  'schemaVersion',
]);

const VARIANT_OPERATIONS = Object.freeze({
  'deploy.apply': Object.freeze([
    'acquireLease',
    'renewLease',
    'uploadImmutableRelease',
    'provisionInactive',
    'compatibilityPreflight',
    'stageRelease',
    'activateGeneration',
    'verifyServedPath',
    'fenceExternalEffects',
    'releaseLease',
  ]),
  'deploy.reconcile': Object.freeze(['reconcileEffect']),
  'backup.apply': Object.freeze([
    'acquireLease',
    'createVerifiedBackup',
    'releaseLease',
  ]),
  'backup.reconcile': Object.freeze(['reconcileEffect']),
  'restore.apply': Object.freeze([
    'acquireLease',
    'restoreBackupInactive',
    'verifyRestoredComponents',
    'verifyRestoredApplication',
    'releaseLease',
  ]),
  'restore.activate': Object.freeze([
    'activateRestoredGeneration',
    'releaseLease',
  ]),
  'restore.reconcile': Object.freeze(['reconcileEffect']),
  'rollback.apply': Object.freeze([
    'acquireLease',
    'rollback',
    'releaseLease',
  ]),
  'rollback.reconcile': Object.freeze(['reconcileEffect']),
  'cleanup.apply': Object.freeze(['releaseLease']),
  'cleanup.reconcile': Object.freeze(['reconcileEffect']),
});

function refuse(code, message, status = 409) {
  throw new OperatorAuthorityRefusal(code, message, status);
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
    refuse('SNAPBACK_OPERATOR_LIFECYCLE_BODY_INVALID', `${name} is not the exact closed shape`, 400);
  }
}

function safeDiagnostic(code, message, status = 409) {
  return {
    code,
    message: String(message).slice(0, 512),
    status,
  };
}

function effectIntentForJournal(lifecycleRequest) {
  const intent = lifecycleRequest.effectIntent;
  return {
    schemaVersion: intent.schemaVersion,
    operationId: intent.operationId,
    operation: intent.operation,
    requestDigest: lifecycleRequest.requestSha256,
    semanticEffectId: intent.semanticEffectId,
    targetBindingSha256: intent.targetBindingSha256,
    planSha256: intent.planSha256,
    effectKind: intent.effectKind,
    logicalResourceName: intent.logicalResourceName,
    desiredProviderStateSha256: intent.desiredProviderStateSha256,
    predecessorHeadSha256: intent.predecessorHeadSha256,
  };
}

function recoveredResponse(lifecycleRequest, effect) {
  if (effect.retainedResponse) {
    return {
      ...structuredClone(effect.retainedResponse),
      idempotentReplay: true,
    };
  }
  const observation = effect.observations.at(-1) ?? null;
  if (!effect.terminal) {
    return {
      schemaVersion: 'snapback.vm-adapter-lifecycle-response.v2',
      operation: lifecycleRequest.operation,
      operationId: lifecycleRequest.operationId,
      ok: false,
      idempotentReplay: true,
      remoteEvidence: false,
      requestSha256: lifecycleRequest.requestSha256,
      terminal: {
        schemaVersion: 'snapback.provider-effect-terminal.v1',
        semanticEffectId: lifecycleRequest.effectIntent.semanticEffectId,
        outcome: 'commitUncertain',
        recordedAtMs: Date.now(),
        reason: 'effectingRecordRecoveredWithoutTerminal',
        recoveryClass: 'explicitReconcileEffectRequired',
        providerVersion: observation?.providerRevision ?? null,
        lastObservationSha256: observation === null
          ? null
          : sha256(Buffer.from(canonicalJson(observation))),
        redactedEvidenceSha256: null,
        retainedResultSha256: null,
      },
      controlHead: structuredClone(lifecycleRequest.predecessorHead),
      observation,
      diagnostics: [{
        code: 'SNAPBACK_HOSTED_PROVIDER_COMMIT_UNCERTAIN',
        severity: 'error',
        message: 'recovered effecting journal has no terminal; provider execution will not repeat',
      }],
    };
  }
  return {
    schemaVersion: 'snapback.vm-adapter-lifecycle-response.v2',
    operation: lifecycleRequest.operation,
    operationId: lifecycleRequest.operationId,
    ok: effect.terminal.outcome === 'applied',
    idempotentReplay: true,
    remoteEvidence: false,
    requestSha256: lifecycleRequest.requestSha256,
    terminal: structuredClone(effect.terminal),
    controlHead: structuredClone(lifecycleRequest.predecessorHead),
    observation,
    diagnostics: [],
  };
}

function validateLifecycleBody(supervisor, operatorRequest) {
  const body = operatorRequest.body;
  assertClosed(body, LIFECYCLE_BODY_KEYS, 'SupervisorLifecycleExecutionV1');
  if (
    body.schemaVersion !== 'snapback.supervisor-lifecycle-execution.v1'
    || !SAFE_ID.test(body.journeyId ?? '')
    || !SAFE_ID.test(body.grantId ?? '')
    || !isPlainObject(body.lifecycleRequest)
  ) {
    refuse(
      'SNAPBACK_OPERATOR_LIFECYCLE_BODY_INVALID',
      'lifecycle execution identity or request is invalid',
      400,
    );
  }
  const operations = VARIANT_OPERATIONS[operatorRequest.variant];
  if (!operations || !operations.includes(body.lifecycleRequest.operation)) {
    refuse(
      'SNAPBACK_OPERATOR_LIFECYCLE_VARIANT_MISMATCH',
      'operator variant does not authorize this lifecycle operation',
      403,
    );
  }
  const lifecycleRequest = body.lifecycleRequest;
  const targetId = lifecycleRequest.targetBinding?.targetId;
  const registered = supervisor.database.heads?.[targetId];
  const canonicalControlHead = supervisor.database.controlHeads?.[targetId];
  const targetBindingSha256 = sha256(Buffer.from(canonicalJson(lifecycleRequest.targetBinding)));
  const predecessorHeadSha256 = sha256(Buffer.from(canonicalJson(lifecycleRequest.predecessorHead)));
  const requestSha256 = lifecycleRequestDigest(lifecycleRequest);
  const expectedSemanticEffectId = semanticEffectId({
    operationId: lifecycleRequest.effectIntent?.operationId,
    operation: lifecycleRequest.effectIntent?.operation,
    targetBindingDigest: lifecycleRequest.effectIntent?.targetBindingSha256,
    planDigest: lifecycleRequest.effectIntent?.planSha256,
    effectKind: lifecycleRequest.effectIntent?.effectKind,
    logicalResourceName: lifecycleRequest.effectIntent?.logicalResourceName,
    desiredProviderStateSha256: lifecycleRequest.effectIntent?.desiredProviderStateSha256,
  });
  if (
    !registered
    || !canonicalControlHead
    || canonicalJson(registered.binding) !== canonicalJson(lifecycleRequest.targetBinding)
    || canonicalJson(canonicalControlHead) !== canonicalJson(lifecycleRequest.predecessorHead)
    || registered.bindingSha256 !== targetBindingSha256
    || lifecycleRequest.requestSha256 !== requestSha256
    || lifecycleRequest.effectIntent?.requestSha256 !== requestSha256
    || lifecycleRequest.effectIntent?.semanticEffectId !== expectedSemanticEffectId
    || lifecycleRequest.effectIntent?.targetBindingSha256 !== targetBindingSha256
    || lifecycleRequest.effectIntent?.predecessorHeadSha256 !== predecessorHeadSha256
    || operatorRequest.targetHeadSha256 !== predecessorHeadSha256
    || !DIGEST.test(operatorRequest.targetHeadSha256 ?? '')
  ) {
    refuse(
      'SNAPBACK_OPERATOR_TARGET_HEAD_MISMATCH',
      'operator request does not bind canonical request/effect identities and the exact supervisor-owned predecessor head',
      409,
    );
  }
  return body;
}

async function executeLifecycle({
  supervisor,
  operatorRequest,
  providerExecutor,
  persistSupervisor,
}) {
  const body = validateLifecycleBody(supervisor, operatorRequest);
  const lifecycleRequest = body.lifecycleRequest;
  const intent = effectIntentForJournal(lifecycleRequest);
  const existing = supervisor.database.effects[intent.semanticEffectId];
  if (existing) {
    if (canonicalJson(existing.intent) !== canonicalJson(intent)) {
      refuse(
        'SNAPBACK_PROVIDER_EFFECT_ID_COLLISION',
        'semantic effect id changed meaning',
        409,
      );
    }
    if (!existing.terminal) {
      const recovered = recoveredResponse(lifecycleRequest, existing);
      supervisor.appendTerminal(intent.semanticEffectId, recovered.terminal, {
        journeyId: body.journeyId,
        grantId: body.grantId,
        retainedResponse: recovered,
      });
      await persistSupervisor(supervisor);
      return recovered;
    }
    return recoveredResponse(lifecycleRequest, existing);
  }

  supervisor.appendIntent(intent, {
    journeyId: body.journeyId,
    grantId: body.grantId,
    targetOrPlannedBindingDigest: intent.targetBindingSha256,
    confirmationDigest: lifecycleRequest.confirmationSha256,
  });
  await persistSupervisor(supervisor);

  const response = await providerExecutor.execute(lifecycleRequest, {
    beforeProviderEffect: async (observation) => {
      supervisor.markEffecting(intent.semanticEffectId, observation);
      await persistSupervisor(supervisor);
    },
  });
  supervisor.appendTerminal(intent.semanticEffectId, response.terminal, {
    journeyId: body.journeyId,
    grantId: body.grantId,
    retainedResponse: response,
  });
  await persistSupervisor(supervisor);
  return response;
}

export function assertOperatorCertificateBinding(request, peerCertificateRaw) {
  if (
    !Buffer.isBuffer(peerCertificateRaw)
    || peerCertificateRaw.length < 1
    || certificateSha256(peerCertificateRaw) !== request?.operatorCertificateSha256
  ) {
    refuse(
      'SNAPBACK_OPERATOR_MTLS_CERTIFICATE_MISMATCH',
      'mTLS client certificate digest does not match SupervisorRequestV1',
      403,
    );
  }
  return true;
}

export function createOperatorRequestService({
  responseSigner,
  providerExecutor,
  createSupervisor,
  persistSupervisor,
}) {
  if (
    typeof responseSigner?.assertReady !== 'function'
    || typeof responseSigner?.signResponse !== 'function'
    || typeof providerExecutor?.execute !== 'function'
    || typeof createSupervisor !== 'function'
    || typeof persistSupervisor !== 'function'
  ) {
    refuse(
      'SNAPBACK_OPERATOR_SERVICE_UNAVAILABLE',
      'operator service prerequisites are incomplete',
      503,
    );
  }

  return Object.freeze({
    async execute(request, {
      peerCertificateRaw,
      nowMs = Date.now(),
    } = {}) {
      assertOperatorCertificateBinding(request, peerCertificateRaw);
      const supervisor = createSupervisor();
      const reservation = reserveOperatorAuthorityTransaction(
        supervisor,
        request,
        { nowMs },
      );
      if (reservation.committed) await persistSupervisor(supervisor);
      if (reservation.state === 'terminal') return reservation.response;

      responseSigner.assertReady(nowMs);
      let result;
      let diagnostic = null;
      if (VARIANT_OPERATIONS[request.variant]) {
        result = await executeLifecycle({
          supervisor,
          operatorRequest: request,
          providerExecutor,
          persistSupervisor,
        });
      } else {
        diagnostic = safeDiagnostic(
          'SNAPBACK_OPERATOR_EXECUTOR_UNAVAILABLE',
          `operator variant ${request.variant} is authorized but has no installed executor`,
          501,
        );
        result = null;
      }
      const response = responseSigner.signResponse({
        request,
        body: {
          schemaVersion: 'snapback.supervisor-response-body.v1',
          ok: diagnostic === null,
          result,
          diagnostic,
        },
        supervisorIncarnation: supervisor.incarnation,
        supervisorGeneration: supervisor.database.generation + 1,
        supervisorHeadSha256: supervisor.anchor.controlHeadDigest,
        nowMs,
      });
      const transaction = settleOperatorAuthorityTransaction(
        supervisor,
        request,
        response,
        { nowMs },
      );
      if (transaction.committed) await persistSupervisor(supervisor);
      return transaction.response;
    },
  });
}

export const __operatorServiceTest = Object.freeze({
  LIFECYCLE_BODY_KEYS,
  VARIANT_OPERATIONS,
  effectIntentForJournal,
});
