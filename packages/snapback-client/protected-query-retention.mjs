// Ordinary generated LiveQuery custody for LLP 0043 M1 / LLP 0053 item 8.
//
// This state intentionally lives in the RQS carrier transaction domain but
// not in an RQS entry. RQS tokens prove authority-independent resumability;
// protected bytes instead require this exact query-authorization namespace,
// composite witness, server-MACed AuthorizedLease, and rollback-checked
// client deadline before they may cross a process boundary.

import {
  authorizedLeaseActivationHash,
  authorizedLeaseHash,
  deriveAuthorizedLeaseCommit,
  validateAuthorizedLease,
} from '@expo/snapback-contract/authorized-lease';
import {
  retainedQueryKey,
  stableJson,
} from '@expo/snapback-contract/client-store';

import { allocateQueryInstanceIdInMeta } from './rqs-store-meta.mjs';

const FORMAT = 'snapback.js-authorized-query-retention.v1';

const generatedIdentity = (ref) => {
  const value = ref?.expectedGeneration;
  const fields = ['schemaVersion', 'appId', 'schemaHash', 'bundleHash', 'inputsHash'];
  if (
    ref?.artifactKind !== 'functionReference'
    || ref?.kind !== 'LiveQuery'
    || value === null
    || typeof value !== 'object'
    || Array.isArray(value)
    || Object.keys(value).length !== fields.length
    || fields.some((field) => typeof value[field] !== 'string' || value[field].length === 0)
  ) return null;
  return Object.fromEntries(fields.map((field) => [field, value[field]]));
};

const activationHashFor = (identity) => authorizedLeaseActivationHash({
  ...identity,
  authMode: 'sessions',
});

const own = (record, key) => Object.hasOwn(record, key) ? record[key] : null;

const sameNamespace = (left, right) => (
  left?.clientStoreId === right?.clientStoreId
  && left?.queryKey === right?.queryKey
  && left?.queryInstanceId === right?.queryInstanceId
);

const nextSafe = (value, label) => {
  if (!Number.isSafeInteger(value) || value < 0 || value >= Number.MAX_SAFE_INTEGER) {
    const error = new Error(`SNAPBACK_RQS_STORE_ALLOCATOR_EXHAUSTED: ${label} is exhausted`);
    error.code = 'SNAPBACK_RQS_STORE_ALLOCATOR_EXHAUSTED';
    throw error;
  }
  return value + 1;
};

const baseEntryMatches = (entry, namespace, identity, activationHash) => (
  entry?.format === FORMAT
  && sameNamespace(entry.namespace, namespace)
  && stableJson(entry.expectedGeneration) === stableJson(identity)
  && entry.activationHash === activationHash
);

const invalidResult = (reason) => Object.freeze({
  retained: false,
  reason,
});

/**
 * Allocate (or recover) the never-reused namespace before subscribe_live.
 * No protected payload is exposed here; full lease validation happens in the
 * later readwrite seed transaction.
 */
export async function prepareProtectedQueryRetention({
  ref,
  args,
  name,
  storeHandle,
}) {
  const identity = generatedIdentity(ref);
  if (identity === null || typeof storeHandle?.materializationTransaction !== 'function') {
    return null;
  }
  const queryKey = retainedQueryKey(name, args);
  const activationHash = activationHashFor(identity);
  return storeHandle.materializationTransaction('readwrite', (view) => {
    const slot = view.storeMeta.authorizedQueryRetention;
    const current = own(slot, queryKey);
    if (current !== null) {
      const namespace = current.namespace;
      if (baseEntryMatches(current, namespace, identity, activationHash)) {
        return Object.freeze({
          activationHash,
          expectedGeneration: identity,
          namespace: Object.freeze(structuredClone(namespace)),
          queryKey,
        });
      }
      // An artifact/binding mismatch destroys the old bytes in the same
      // transaction that selects the successor namespace.
      delete slot[queryKey];
    }
    const allocated = allocateQueryInstanceIdInMeta(view.storeMeta);
    if (allocated === null) {
      const error = new Error('SNAPBACK_RQS_STORE_CORRUPT: query namespace metadata is invalid');
      error.code = 'SNAPBACK_RQS_STORE_CORRUPT';
      throw error;
    }
    view.storeMeta = allocated.meta;
    const namespace = {
      clientStoreId: view.storeMeta.clientStoreId,
      queryKey,
      queryInstanceId: allocated.queryInstanceId,
    };
    view.storeMeta.authorizedQueryRetention[queryKey] = {
      format: FORMAT,
      namespace,
      expectedGeneration: identity,
      activationHash,
      queryAuthorization: null,
      leaseRequest: null,
      lease: null,
      clientDeadlineMs: null,
      clockHighWaterMs: 0,
      retained: null,
    };
    return Object.freeze({
      activationHash,
      expectedGeneration: identity,
      namespace: Object.freeze(structuredClone(namespace)),
      queryKey,
    });
  });
}

const deletePrepared = (view, prepared, reason) => {
  const current = own(view.storeMeta.authorizedQueryRetention, prepared.queryKey);
  if (current !== null && sameNamespace(current.namespace, prepared.namespace)) {
    delete view.storeMeta.authorizedQueryRetention[prepared.queryKey];
  }
  return invalidResult(reason);
};

// @ref LLP 0053#retained-and-offline-authorization — equality expiry,
// rollback, malformed custody, and every exact-binding mismatch delete the
// protected bytes in the readwrite transaction before rows can be returned.
export async function seedProtectedQueryRetention({
  prepared,
  storeHandle,
  clientNowMs = Date.now(),
}) {
  if (prepared === null) return invalidResult('not-prepared');
  return storeHandle.materializationTransaction('readwrite', (view) => {
    const entry = own(view.storeMeta.authorizedQueryRetention, prepared.queryKey);
    const invalidate = (reason) => deletePrepared(view, prepared, reason);
    if (!baseEntryMatches(
      entry,
      prepared.namespace,
      prepared.expectedGeneration,
      prepared.activationHash,
    )) return invalidate('binding-mismatch');
    // A freshly allocated namespace is metadata, not protected payload. Keep
    // it so the immediately following online subscribe can durably reserve
    // its first lease request; there are no rows here that require deletion.
    if (
      entry.queryAuthorization === null
      && entry.leaseRequest === null
      && entry.lease === null
      && entry.retained === null
    ) return invalidResult('not-retained');
    if (
      !Number.isSafeInteger(clientNowMs)
      || clientNowMs < 0
      || !Number.isSafeInteger(entry.clockHighWaterMs)
      || clientNowMs < entry.clockHighWaterMs
    ) return invalidate('clock-rollback');
    const query = entry.queryAuthorization;
    const retained = entry.retained;
    let lease;
    try { lease = validateAuthorizedLease(entry.lease); } catch { return invalidate('lease-invalid'); }
    if (
      query === null
      || query.lifecycle !== 'active'
      || query.effectiveDisposition !== 'retain'
      || !Number.isSafeInteger(query.queryGeneration)
      || query.queryGeneration < 1
      || !query.accepted
      || retained === null
      || !Array.isArray(retained.rows)
      || !Number.isSafeInteger(retained.version)
      || entry.leaseRequest !== null
      || !Number.isSafeInteger(entry.clientDeadlineMs)
      || clientNowMs >= entry.clientDeadlineMs
    ) return invalidate('lease-unavailable-or-expired');
    const leaseHash = authorizedLeaseHash(lease);
    const witness = query.accepted.witness;
    if (
      leaseHash !== query.accepted.authorizedLeaseHash
      || retained.authorizedLeaseHash !== leaseHash
      || lease.clientStoreId !== prepared.namespace.clientStoreId
      || lease.queryKey !== prepared.queryKey
      || lease.queryInstanceId !== prepared.namespace.queryInstanceId
      || lease.principalId !== query.principalId
      || stableJson(lease.issuerId) !== stableJson(query.issuerId)
      || stableJson(lease.authorization) !== stableJson(query.authorization)
      || lease.data.versionStream !== query.versionStream
      || lease.activationHash !== prepared.activationHash
      || lease.authorityInstanceId !== query.authorityInstanceId
      || stableJson(witness?.authorization) !== stableJson(lease.authorization)
      || witness?.data?.versionStream !== lease.data.versionStream
      || witness?.data?.minCommitVersion !== lease.data.snapshotCommitVersion
      || retained.version !== lease.data.snapshotCommitVersion
      || retained.cursor?.stream !== lease.data.versionStream
      || retained.cursor?.version !== lease.data.snapshotCommitVersion
      || retained.queryGeneration !== query.queryGeneration
    ) return invalidate('binding-mismatch');
    entry.clockHighWaterMs = clientNowMs;
    view.storeMeta.authorizedQueryRetention[prepared.queryKey] = entry;
    return Object.freeze({
      retained: true,
      rows: structuredClone(retained.rows),
      version: retained.version,
      namespace: Object.freeze(structuredClone(prepared.namespace)),
    });
  });
}

/** Durably reserve the client-side lease timer before the network request. */
export async function beginProtectedQueryLease({
  prepared,
  storeHandle,
  leaseRequestId,
  clientNowMs,
  principalId,
  issuerId,
  authorization,
  versionStream,
  authorityInstanceId,
}) {
  return storeHandle.materializationTransaction('readwrite', (view) => {
    const entry = own(view.storeMeta.authorizedQueryRetention, prepared.queryKey);
    if (!baseEntryMatches(
      entry,
      prepared.namespace,
      prepared.expectedGeneration,
      prepared.activationHash,
    )) return invalidResult(entry === null ? 'binding-missing' : 'binding-mismatch');
    if (
      !Number.isSafeInteger(clientNowMs)
      || clientNowMs < entry.clockHighWaterMs
      || typeof leaseRequestId !== 'string'
      || leaseRequestId.length === 0
    ) return deletePrepared(view, prepared, 'clock-or-request-invalid');
    const expected = {
      principalId,
      issuerId: structuredClone(issuerId),
      authorization: structuredClone(authorization),
      versionStream,
      authorityInstanceId,
    };
    const current = entry.queryAuthorization;
    if (current !== null && (
      current.lifecycle !== 'active'
      || current.principalId !== principalId
      || stableJson(current.issuerId) !== stableJson(issuerId)
      || stableJson(current.authorization) !== stableJson(authorization)
      || current.versionStream !== versionStream
      || current.authorityInstanceId !== authorityInstanceId
    )) return deletePrepared(view, prepared, 'authority-mismatch');
    const queryGeneration = nextSafe(current?.queryGeneration ?? 0, 'query generation');
    entry.queryAuthorization = {
      lifecycle: 'active',
      queryGeneration,
      effectiveDisposition: 'retain',
      ...expected,
      accepted: null,
    };
    entry.leaseRequest = {
      leaseRequestId,
      queryInstanceId: prepared.namespace.queryInstanceId,
      queryGeneration,
      startedClientMs: clientNowMs,
    };
    entry.lease = null;
    entry.clientDeadlineMs = null;
    entry.clockHighWaterMs = clientNowMs;
    entry.retained = null;
    view.storeMeta.authorizedQueryRetention[prepared.queryKey] = entry;
    return Object.freeze({
      retained: true,
      request: Object.freeze(structuredClone(entry.leaseRequest)),
    });
  });
}

/** Commit the full revalidated snapshot and its lease as one carrier write. */
export async function commitProtectedQueryLease({
  prepared,
  storeHandle,
  lease,
  rows,
  version,
  clientNowMs,
}) {
  return storeHandle.materializationTransaction('readwrite', (view) => {
    const entry = own(view.storeMeta.authorizedQueryRetention, prepared.queryKey);
    const invalidate = (reason) => deletePrepared(view, prepared, reason);
    if (!baseEntryMatches(
      entry,
      prepared.namespace,
      prepared.expectedGeneration,
      prepared.activationHash,
    )) return invalidate('binding-mismatch');
    const query = entry.queryAuthorization;
    if (
      query === null
      || entry.leaseRequest === null
      || entry.leaseRequest.queryGeneration !== query.queryGeneration
      || !Array.isArray(rows)
      || !Number.isSafeInteger(version)
      || !Number.isSafeInteger(clientNowMs)
      || clientNowMs < entry.clockHighWaterMs
    ) return invalidate('reservation-or-snapshot-invalid');
    let derived;
    try {
      derived = deriveAuthorizedLeaseCommit({
        lease,
        request: entry.leaseRequest,
        expected: {
          clientStoreId: prepared.namespace.clientStoreId,
          queryKey: prepared.queryKey,
          queryInstanceId: prepared.namespace.queryInstanceId,
          principalId: query.principalId,
          authorization: query.authorization,
          versionStream: query.versionStream,
          activationHash: prepared.activationHash,
          authorityInstanceId: query.authorityInstanceId,
        },
        clientNowMs,
      });
    } catch (error) {
      return invalidate(
        `lease-invalid:${error?.code ?? 'unknown'}:${error?.diagnostic?.details?.field ?? 'unknown'}`,
      );
    }
    if (
      stableJson(derived.lease.issuerId) !== stableJson(query.issuerId)
      || version !== derived.lease.data.snapshotCommitVersion
    ) {
      return invalidate('snapshot-mismatch');
    }
    query.accepted = {
      witness: {
        authorization: structuredClone(derived.lease.authorization),
        data: {
          versionStream: derived.lease.data.versionStream,
          minCommitVersion: derived.lease.data.snapshotCommitVersion,
        },
      },
      authorizedLeaseHash: derived.leaseHash,
    };
    entry.queryAuthorization = query;
    entry.leaseRequest = null;
    entry.lease = structuredClone(derived.lease);
    entry.clientDeadlineMs = derived.clientDeadlineMs;
    entry.clockHighWaterMs = clientNowMs;
    entry.retained = {
      rows: structuredClone(rows),
      version,
      cursor: { stream: derived.lease.data.versionStream, version },
      queryGeneration: query.queryGeneration,
      authorizedLeaseHash: derived.leaseHash,
    };
    view.storeMeta.authorizedQueryRetention[prepared.queryKey] = entry;
    return Object.freeze({ retained: true, clientDeadlineMs: derived.clientDeadlineMs });
  });
}

export async function deleteProtectedQueryRetention({ prepared, storeHandle }) {
  if (prepared === null) return false;
  return storeHandle.materializationTransaction('readwrite', (view) => {
    const current = own(view.storeMeta.authorizedQueryRetention, prepared.queryKey);
    if (current === null || !sameNamespace(current.namespace, prepared.namespace)) return false;
    delete view.storeMeta.authorizedQueryRetention[prepared.queryKey];
    return true;
  });
}

export const PROTECTED_QUERY_RETENTION_FORMAT = FORMAT;
