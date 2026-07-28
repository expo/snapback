import { createPublicKey } from 'node:crypto';

import {
  canonicalJcs,
  createPublicationAuthorityReceipt,
  leaseSha256,
  parseTimestamp,
  sha256Hex,
  signPublicationLease,
  validatePublicationAuthorityTransition,
  validatePublicationLease,
  validatePublicationLeaseIssueRequest,
  vectorFromLease,
} from './protocol.mjs';

export class PublicationAuthorityError extends Error {
  constructor(code, message, status = 409) {
    super(message);
    this.name = 'PublicationAuthorityError';
    this.code = code;
    this.status = status;
  }
}
function refuse(code, message, status = 409) {
  throw new PublicationAuthorityError(code, message, status);
}

function requestSha256(request) {
  return sha256Hex(canonicalJcs(request));
}

function currentRecord(state) {
  return state.records.at(-1) ?? null;
}

function headIdentity(record) {
  if (record === null) return null;
  return {
    leaseSha256: leaseSha256(record.lease),
    operationId: record.lease.operationId,
    outcome: record.closure?.receipt.outcome ?? null,
    publicationEpoch: record.lease.publicationEpoch,
    status: record.status,
  };
}

export function projectPublicationAuthorityHead(state) {
  const record = currentRecord(state);
  if (record === null) {
    return {
      schemaVersion: 'snapback.publication-authority-head.v1',
      authorityGeneration: state.generation,
      publicationEpoch: state.publicationEpoch,
      status: 'empty',
      operationId: null,
      publisherInstanceId: null,
      leaseSha256: null,
      expiresAt: null,
      outcome: null,
      headSha256: null,
    };
  }
  return {
    schemaVersion: 'snapback.publication-authority-head.v1',
    authorityGeneration: state.generation,
    publicationEpoch: record.lease.publicationEpoch,
    status: record.status,
    operationId: record.lease.operationId,
    publisherInstanceId: record.lease.publisherInstanceId,
    leaseSha256: leaseSha256(record.lease),
    expiresAt: record.lease.expiresAt,
    outcome: record.closure?.receipt.outcome ?? null,
    headSha256: sha256Hex(canonicalJcs(headIdentity(record))),
  };
}

function transactionResult(result) {
  return { changed: false, result };
}

function changedTransaction(state, result) {
  state.generation += 1;
  return { changed: true, state, result };
}

function matchesTransition(record, transition) {
  return (
    transition.operationId === record.lease.operationId
    && transition.publicationEpoch === record.lease.publicationEpoch
    && transition.publisherInstanceId === record.lease.publisherInstanceId
    && transition.leaseSha256 === leaseSha256(record.lease)
  );
}

function assertCurrent(record, now) {
  if (now < parseTimestamp(record.lease.issuedAt, 'issuedAt')
      || now >= parseTimestamp(record.lease.expiresAt, 'expiresAt')) {
    refuse(
      'SNAPBACK_PUBLICATION_LEASE_EXPIRED',
      'publication lease is not current',
      410,
    );
  }
}

function vectorSha256(lease, side) {
  return sha256Hex(canonicalJcs(vectorFromLease(lease, side)));
}

/**
 * Monotone, single-head standing authority for public default-tag releases.
 *
 * @ref LLP 0041#unreviewed-post-round-correction-publication-lease-and-rollback
 * — issue allocates a durable epoch, acquire performs the prior-head
 * expected-value transition, and close binds either the final or prior vector.
 */
export class PublicationLeaseAuthority {
  constructor({ store, privateKey, now = () => Date.now() }) {
    if (!store || typeof store.read !== 'function' || typeof store.transact !== 'function') {
      throw new TypeError('publication authority store is required');
    }
    this.store = store;
    this.privateKey = privateKey;
    this.publicKey = createPublicKey(privateKey);
    this.now = now;
  }

  head() {
    return projectPublicationAuthorityHead(this.store.read());
  }

  issue(request) {
    try {
      validatePublicationLeaseIssueRequest(request);
    } catch (error) {
      refuse('SNAPBACK_PUBLICATION_ISSUE_INVALID', error.message, 400);
    }
    const digest = requestSha256(request);
    const now = this.now();
    return this.store.transact((state) => {
      const duplicate = state.records.find(
        (record) => record.lease.operationId === request.operationId,
      );
      if (duplicate) {
        if (duplicate.issueRequestSha256 !== digest) {
          refuse(
            'SNAPBACK_PUBLICATION_OPERATION_REPLAY_MISMATCH',
            'operationId was already used with different issue bytes',
          );
        }
        return transactionResult(duplicate.lease);
      }

      const head = projectPublicationAuthorityHead(state);
      if (
        request.expectedPublicationEpoch !== state.publicationEpoch
        || request.expectedHeadSha256 !== head.headSha256
      ) {
        refuse(
          'SNAPBACK_PUBLICATION_EXPECTED_HEAD_MISMATCH',
          'expected publication epoch or head does not match durable authority',
        );
      }
      const prior = currentRecord(state);
      if (
        prior !== null
        && prior.status !== 'closed'
        && now < parseTimestamp(prior.lease.expiresAt, 'expiresAt')
      ) {
        refuse(
          'SNAPBACK_PUBLICATION_LEASE_ACTIVE',
          'a current publication lease is already active',
        );
      }

      const issuedAt = new Date(now).toISOString();
      const expiresAt = new Date(now + request.lifetimeSeconds * 1_000).toISOString();
      const unsigned = {
        schemaVersion: 'snapback.authorized-publication-lease.v1',
        operationId: request.operationId,
        publisherInstanceId: request.publisherInstanceId,
        publicationEpoch: state.publicationEpoch + 1,
        candidateLedgerSha256: request.candidateLedgerSha256,
        candidateTag: request.candidateTag,
        defaultTag: request.defaultTag,
        issuedAt,
        expiresAt,
        packages: structuredClone(request.packages),
      };
      const lease = signPublicationLease({ unsigned, privateKey: this.privateKey });
      validatePublicationLease({
        lease,
        publicKey: this.publicKey,
        candidateLedgerSha256: request.candidateLedgerSha256,
        candidateTag: request.candidateTag,
        publisherInstanceId: request.publisherInstanceId,
        now,
      });
      state.publicationEpoch = lease.publicationEpoch;
      state.records.push({
        issueRequestSha256: digest,
        lease,
        status: 'issued',
        acquisition: null,
        closure: null,
      });
      return changedTransaction(state, lease);
    });
  }

  acquire(transition) {
    try {
      validatePublicationAuthorityTransition(transition);
    } catch (error) {
      refuse('SNAPBACK_PUBLICATION_TRANSITION_INVALID', error.message, 400);
    }
    const digest = requestSha256(transition);
    const now = this.now();
    return this.store.transact((state) => {
      const record = currentRecord(state);
      if (!record || !matchesTransition(record, transition)) {
        refuse(
          'SNAPBACK_PUBLICATION_EXPECTED_HEAD_MISMATCH',
          'acquire transition does not match durable authority head',
        );
      }
      if (record.acquisition) {
        if (record.acquisition.requestSha256 !== digest) {
          refuse(
            'SNAPBACK_PUBLICATION_TRANSITION_REPLAY_MISMATCH',
            'acquire was already committed with different bytes',
          );
        }
        return transactionResult(record.acquisition.receipt);
      }
      if (record.status !== 'issued' || transition.outcome !== 'acquired') {
        refuse(
          'SNAPBACK_PUBLICATION_TRANSITION_STATE_MISMATCH',
          'lease cannot be acquired from its current state',
        );
      }
      assertCurrent(record, now);
      if (
        transition.publicationLedgerSha256 !== null
        || transition.vectorSha256 !== vectorSha256(record.lease, 'prior')
      ) {
        refuse(
          'SNAPBACK_PUBLICATION_TRANSITION_VALUE_MISMATCH',
          'acquire transition does not bind the authorized prior vector',
        );
      }
      const receipt = createPublicationAuthorityReceipt(transition);
      record.acquisition = { requestSha256: digest, receipt };
      record.status = 'acquired';
      return changedTransaction(state, receipt);
    });
  }

  close(transition) {
    try {
      validatePublicationAuthorityTransition(transition);
    } catch (error) {
      refuse('SNAPBACK_PUBLICATION_TRANSITION_INVALID', error.message, 400);
    }
    const digest = requestSha256(transition);
    const now = this.now();
    return this.store.transact((state) => {
      const record = currentRecord(state);
      if (!record || !matchesTransition(record, transition)) {
        refuse(
          'SNAPBACK_PUBLICATION_EXPECTED_HEAD_MISMATCH',
          'close transition does not match durable authority head',
        );
      }
      if (record.closure) {
        if (record.closure.requestSha256 !== digest) {
          refuse(
            'SNAPBACK_PUBLICATION_TRANSITION_REPLAY_MISMATCH',
            'close was already committed with different bytes',
          );
        }
        return transactionResult(record.closure.receipt);
      }
      if (
        record.status !== 'acquired'
        || !['promoted', 'rolled-back'].includes(transition.outcome)
      ) {
        refuse(
          'SNAPBACK_PUBLICATION_TRANSITION_STATE_MISMATCH',
          'lease cannot close from its current state',
        );
      }
      assertCurrent(record, now);
      const side = transition.outcome === 'promoted' ? 'new' : 'prior';
      if (transition.vectorSha256 !== vectorSha256(record.lease, side)) {
        refuse(
          'SNAPBACK_PUBLICATION_TRANSITION_VALUE_MISMATCH',
          'close transition does not bind the authorized terminal vector',
        );
      }
      const receipt = createPublicationAuthorityReceipt(transition);
      record.closure = { requestSha256: digest, receipt };
      record.status = 'closed';
      return changedTransaction(state, receipt);
    });
  }
}
