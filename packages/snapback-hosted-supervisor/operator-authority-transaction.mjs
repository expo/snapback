// This adapter is the only bridge between the operator protocol's retained
// request/response state and the standing supervisor's canonical database.
// It deliberately does not provision roots, expose a listener, sign
// SupervisorResponseV1, or execute provider effects.
//
// @ref LLP 0105#atomic-request-response-replay — a newly accepted request and
// its canonical response bytes enter the replay journal in the same canonical
// supervisor generation; exact replay advances nothing.
// @ref LLP 0105#one-fail-closed-hosted-authority-and-recoverable-supervisor —
// operator replay state uses the existing SQLite/mirror/anchor transaction
// boundary instead of acquiring a second writer or authority store.

import { createHash } from 'node:crypto';

import {
  canonicalAuthorityJson,
  OperatorAuthorityRefusal,
  SupervisorOperatorAuthority,
} from './operator-authority.mjs';

const JOURNAL_SCHEMA_VERSION = 'snapback.supervisor-operator-journal-entry.v1';

function refuse(code, message, status = 500) {
  throw new OperatorAuthorityRefusal(code, message, status);
}

function sha256(bytes) {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
}

function snapshotDigest(snapshot) {
  return sha256(Buffer.from(canonicalAuthorityJson(snapshot)));
}

function assertSupervisor(supervisor) {
  if (
    supervisor === null
    || typeof supervisor !== 'object'
    || typeof supervisor.assertEffectAuthority !== 'function'
    || typeof supervisor.commit !== 'function'
    || supervisor.database === null
    || typeof supervisor.database !== 'object'
    || supervisor.installationReceipt === null
    || typeof supervisor.installationReceipt !== 'object'
    || typeof supervisor.installationReceipt.installationId !== 'string'
    || supervisor.installationReceipt.installationId.length < 1
  ) {
    refuse(
      'SNAPBACK_OPERATOR_SUPERVISOR_INVALID',
      'operator transactions require the canonical standing supervisor',
    );
  }
  if (
    !Array.isArray(supervisor.database.journal)
    || !supervisor.database.floors
    || !Number.isSafeInteger(supervisor.database.floors.replay)
    || supervisor.database.floors.replay < 0
  ) {
    refuse(
      'SNAPBACK_OPERATOR_SUPERVISOR_INVALID',
      'canonical supervisor journal or floors are unavailable',
    );
  }
  supervisor.assertEffectAuthority();
  if (!supervisor.database.operatorAuthority) {
    refuse(
      'SNAPBACK_OPERATOR_AUTHORITY_UNINITIALIZED',
      'offline root and device provisioning have not installed operator authority state',
      503,
    );
  }
}

/**
 * Admit, execute, retain, and commit one ordinary operator request.
 *
 * The caller supplies only an already-authorized execution function. Public
 * listener admission, mTLS certificate binding, response-intermediate
 * signing, provider execution, and release-upload streaming remain separate
 * gates. The returned `committed` bit lets the eventual listener distinguish
 * exact replay from a newly retained response without guessing from content.
 */
export function executeOperatorAuthorityTransaction(supervisor, request, {
  nowMs = Date.now(),
  execute,
  verifySpecialAuthority = undefined,
} = {}) {
  assertSupervisor(supervisor);
  const installationId = supervisor.installationReceipt.installationId;
  const authority = new SupervisorOperatorAuthority({
    installationId,
    state: supervisor.database.operatorAuthority,
  });
  const before = authority.snapshot();
  const beforeDigest = snapshotDigest(before);
  const response = authority.handleRequest(request, {
    nowMs,
    execute,
    verifySpecialAuthority,
  });
  const after = authority.snapshot();
  const afterDigest = snapshotDigest(after);

  if (afterDigest === beforeDigest) {
    return {
      response,
      committed: false,
      generation: supervisor.database.generation,
      operatorAuthoritySha256: beforeDigest,
    };
  }

  const retained = after.requestJournal?.[request.requestId];
  if (
    !retained
    || typeof retained.requestSha256 !== 'string'
    || typeof retained.response?.sha256 !== 'string'
  ) {
    refuse(
      'SNAPBACK_OPERATOR_RESPONSE_NOT_RETAINED',
      'new operator execution did not retain its canonical request and response',
    );
  }

  supervisor.commit((database) => {
    if (snapshotDigest(database.operatorAuthority) !== beforeDigest) {
      refuse(
        'SNAPBACK_OPERATOR_AUTHORITY_CAS_FAILED',
        'operator authority changed before the canonical transaction committed',
        409,
      );
    }
    database.operatorAuthority = after;
    database.floors.replay += 1;
    database.journal.push({
      schemaVersion: JOURNAL_SCHEMA_VERSION,
      kind: 'operatorRequest',
      requestId: retained.requestId,
      requestSha256: retained.requestSha256,
      responseSha256: retained.response.sha256,
      deviceId: retained.deviceId,
      sequence: retained.sequence,
      variant: retained.variant,
      scope: retained.scope,
      credentialBearing: retained.credentialBearing,
      committedAtMs: retained.committedAtMs,
      operatorAuthoritySha256: afterDigest,
    });
  });

  return {
    response,
    committed: true,
    generation: supervisor.database.generation,
    operatorAuthoritySha256: afterDigest,
  };
}

export const __operatorAuthorityTransactionTest = Object.freeze({
  JOURNAL_SCHEMA_VERSION,
  snapshotDigest,
});
