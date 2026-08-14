// Headless Phase-3 tiny-data transaction facade. This module is deliberately
// package-internal until Phase 4 publishes the @expo/snapback/data doorway.
// It delegates transport, auth, durable custody, optimistic IR, settlement,
// and diagnostics to the existing SnapbackClient owners.
//
// @ref LLP 0255#s7-transaction-grammar-composition-and-lifecycle
// @ref LLP 0255#s8-query-state-and-pendingwrites

import { createClientMutationId } from '@expo/snapback-contract/client-store';
import { canonicalizeClientValueV1 } from './canonical-client-value.mjs';
import { normalizeArgumentsAgainstContractV1 } from './argument-normalization.mjs';
import { sha256 } from './rqs.mjs';

const utf8 = new TextEncoder();
const CHUNK = Symbol('snapback.data-transaction-chunk.v1');
const MAX_CHUNKS = 16;
const MAX_DESCRIPTOR_BYTES = 65_536;
const MAX_DURABLE_RECORD_BYTES = 262_144;

const hex = (bytes) => [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
const digest = (domain, value) => `sha256:${hex(sha256(utf8.encode(
  `${domain}\n${canonicalizeClientValueV1(value)}`,
)))}`;
const frozen = (value) => {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) frozen(child);
    Object.freeze(value);
  }
  return value;
};

const dataError = (code, message, details = {}) => {
  const error = new TypeError(`${code}: ${message}`);
  error.code = code;
  error.diagnostic = frozen({
    schemaVersion: 'snapback.client-diagnostic.v2',
    code,
    severity: 'error',
    subsystem: 'data',
    message,
    details: { guideAnchor: 'guide/data/transactions', ...details },
  });
  return error;
};

const diagnosticOf = (error) => error?.diagnostic ?? frozen({
  schemaVersion: 'snapback.client-diagnostic.v2',
  code: error?.code ?? 'SNAPBACK_DATA_TRANSACTION_REFUSED',
  severity: 'error',
  subsystem: 'data',
  message: error?.message ?? String(error),
  details: {},
});

const projectResults = (entry, value) => {
  const chunkCount = entry?.core?.chunks?.length ?? 0;
  if (chunkCount === 1) return [value];
  if (chunkCount > 1) return entry.core.chunks.map((_, position) => value?.[`c${position}`]);
  const positional = value && typeof value === 'object'
    ? Object.keys(value).filter((key) => /^c\d+$/.test(key)).sort((left, right) => (
        Number(left.slice(1)) - Number(right.slice(1))
      ))
    : [];
  return positional.length > 0 ? positional.map((key) => value[key]) : [value];
};

function normalizeChunkArgs(reference, args, resource, operation) {
  if (args === null || typeof args !== 'object' || Array.isArray(args)) {
    throw dataError(
      'SNAPBACK_DATA_TRANSACTION_INVALID',
      `db.tx.${resource}.${operation}(...) requires one argument object`,
    );
  }
  try {
    return normalizeArgumentsAgainstContractV1(args, reference.argsContract, {
      path: `db.tx.${resource}.${operation}.args`,
    });
  } catch (cause) {
    throw dataError(
      'SNAPBACK_DATA_TRANSACTION_INVALID',
      `arguments do not match the exact generated ${resource}.${operation} contract`,
      { causeCode: cause?.code ?? null },
    );
  }
}

function makeChunk(reference, resource, operation, args, bindingToken) {
  return frozen({
    [CHUNK]: bindingToken,
    artifactKind: 'dataTransactionChunk',
    resource,
    operation,
    args: normalizeChunkArgs(reference, args, resource, operation),
  });
}

function transactionEnvelope(entry, intentId, namedArguments, canonicalArguments) {
  const functionReference = entry.functionReference;
  return frozen({
    artifactKind: 'dataTransaction',
    schemaVersion: 'snapback.data-transaction.v1',
    normalizedDataTransactionId: entry.normalizedDataTransactionId,
    core: entry.core,
    resolution: {
      ...entry.resolution,
      functionId: functionReference.id,
    },
    generation: functionReference.expectedGeneration,
    functionReference,
    chunkFunctionReferences: entry.chunkFunctionReferences,
    intentId,
    canonicalArguments,
    canonicalArgsDigest: digest('snapback:data-canonical-args:v1', namedArguments),
    // The canonical client owner fills these three durable authority records
    // in the same pre-dispatch cut that persists this envelope.
    authority: null,
    targetCustody: null,
    replayKey: {
      intentId,
      generationId: functionReference.expectedGeneration?.generationId
        ?? functionReference.expectedGeneration?.inputsHash,
      normalizedDataTransactionId: entry.normalizedDataTransactionId,
    },
    predictionClaims: null,
    createdAtClaim: Date.now(),
  });
}

function stateFromDisposition(previous, disposition) {
  if (disposition.status === 'queued') {
    return { ...previous, custody: 'accepted', dispatch: 'queued', settlement: 'pending' };
  }
  if (disposition.status === 'pending') {
    return { ...previous, custody: 'not-offered', dispatch: 'pending', settlement: 'pending' };
  }
  if (disposition.status === 'settled') {
    return { ...previous, custody: 'accepted', dispatch: 'settled', settlement: 'committed' };
  }
  if (disposition.status === 'refused' || disposition.status === 'failed') {
    return { ...previous, custody: 'not-offered', dispatch: 'refused', settlement: 'refused' };
  }
  return { ...previous, dispatch: disposition.status ?? 'unknown' };
}

function createHandle({ client, intentId, entry, launch = null }) {
  let current = frozen({
    intentId,
    presentation: entry.core.prediction === 'generated-exact' ? 'withheld' : 'unavailable',
    custody: 'preparing',
    dispatch: 'preparing',
    settlement: 'pending',
    observation: 'origin-only',
  });
  let disposed = false;
  const listeners = new Set();
  let unsubscribe = null;
  let dispatchResolve;
  let dispatchReject;
  let settleResolve;
  let settleReject;
  const dispatched = new Promise((resolve, reject) => {
    dispatchResolve = resolve;
    dispatchReject = reject;
  });
  const settled = new Promise((resolve, reject) => {
    settleResolve = resolve;
    settleReject = reject;
  });
  const publish = (next) => {
    current = frozen(next);
    if (disposed) return;
    for (const listener of [...listeners]) {
      try { listener(); } catch { /* observation never owns custody */ }
    }
  };
  const settleFrom = (payload) => {
    const result = payload?.settlement?.result ?? payload?.result;
    const receipt = payload?.settlement?.receipt ?? payload?.receipt ?? null;
    publish({ ...current, dispatch: 'settled', settlement: 'committed' });
    settleResolve(frozen({
      status: 'committed',
      intentId,
      results: projectResults(entry, result),
      receiptDigest: digest('snapback:data-settlement-receipt:v1', receipt ?? payload),
    }));
  };
  const refuseFrom = (failure) => {
    const refusal = diagnosticOf(failure?.failure ?? failure);
    publish({ ...current, dispatch: 'refused', settlement: 'refused' });
    settleResolve(frozen({
      status: 'refused',
      intentId,
      refusal,
      receiptDigest: digest('snapback:data-settlement-receipt:v1', failure),
    }));
  };
  const observe = async () => {
    let disposition;
    try {
      disposition = await client.mutationStatus(intentId);
      if (
        disposition.status === 'pending'
        && disposition.blockedReason === 'outcome-unknown'
        && typeof client.__refreshDataMutation === 'function'
      ) {
        disposition = await client.__refreshDataMutation(intentId);
      }
    } catch (error) {
      if (!disposed) settleReject(error);
      return;
    }
    if (disposition.status === 'settled') settleFrom(disposition);
    else if (disposition.status === 'failed') refuseFrom(disposition);
    else publish(stateFromDisposition(current, disposition));
  };
  const startObservation = () => {
    if (unsubscribe !== null) return;
    unsubscribe = client.subscribeMutation(intentId, () => { void observe(); });
    void observe();
  };
  if (launch !== null) {
    void launch().then((result) => {
      const dispatch = result.status === 'settled'
        ? { status: 'settled', intentId }
        : result.status === 'queued'
          ? {
              status: 'queued', intentId, custody: 'accepted',
              presentation: result.presentation ?? (result.operationHash ? 'installed' : 'withheld'),
            }
          : result.status === 'pending'
            ? {
                status: 'pending', intentId, custody: 'not-offered',
                blockedReason: 'outcome-unknown', presentation: result.presentation,
              }
            : { status: 'refused', intentId, refusal: diagnosticOf(result) };
      publish({
        ...stateFromDisposition(current, result),
        presentation: dispatch.presentation ?? current.presentation,
      });
      dispatchResolve(frozen(dispatch));
      if (result.status === 'settled') settleFrom(result);
      else startObservation();
    }).catch((error) => {
      const refusal = diagnosticOf(error);
      publish({ ...current, custody: 'not-offered', dispatch: 'refused', settlement: 'refused' });
      dispatchResolve(frozen({ status: 'refused', intentId, refusal }));
      settleResolve(frozen({
        status: 'refused', intentId, refusal,
        receiptDigest: digest('snapback:data-settlement-receipt:v1', error?.receipt ?? refusal),
      }));
    });
  } else {
    dispatchResolve(frozen({ status: 'pending', intentId, custody: 'not-offered', blockedReason: 'outcome-unknown', presentation: 'unavailable' }));
    startObservation();
  }
  return frozen({
    intentId,
    snapshot: () => current,
    subscribe(listener) {
      if (typeof listener !== 'function') throw new TypeError('transaction subscribe requires a listener');
      if (disposed) return () => {};
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    dispatched,
    settled,
    async refreshSettlement() { await observe(); },
    dispose() {
      disposed = true;
      listeners.clear();
      if (unsubscribe !== null) unsubscribe();
      unsubscribe = null;
    },
  });
}

export function createDataClient({ client, data } = {}) {
  if (
    client === null
    || typeof client !== 'object'
    || typeof client.__dataMutation !== 'function'
    || typeof client.mutationStatus !== 'function'
  ) throw dataError('SNAPBACK_DATA_BINDING_REQUIRED', 'createDataClient requires an app-data-capable Snapback client');
  const binding = data?.__snapbackDataBinding;
  if (!binding || !Array.isArray(binding.dataTransactionCatalog)) {
    throw dataError('SNAPBACK_DATA_BINDING_REQUIRED', 'generated data witnesses are missing or mismatched');
  }
  const bindingToken = Object.freeze({});
  const tx = Object.fromEntries(Object.entries(binding.operations).map(([resource, operations]) => [
    resource,
    frozen(Object.fromEntries(Object.entries(operations).map(([operation, reference]) => [
      operation,
      (args) => makeChunk(reference, resource, operation, args, bindingToken),
    ]))),
  ]));

  const transact = (...chunks) => {
    if (chunks.length < 1 || chunks.length > MAX_CHUNKS) {
      throw dataError(
        'SNAPBACK_DATA_TRANSACTION_BOUND_EXCEEDED',
        `db.transact admits 1..${MAX_CHUNKS} ordered chunks`,
        { ceiling: 'maxChunks', observed: chunks.length, limit: MAX_CHUNKS },
      );
    }
    if (chunks.some((chunk) => chunk?.[CHUNK] !== bindingToken)) {
      throw dataError(
        'SNAPBACK_DATA_TRANSACTION_INVALID',
        'db.transact accepts only inert chunks created by this generated db.tx binding',
      );
    }
    const writeTargets = new Set();
    for (const chunk of chunks) {
      if (chunk.operation === 'create') continue;
      const target = canonicalizeClientValueV1([chunk.resource, chunk.args.id]);
      if (writeTargets.has(target)) {
        throw dataError(
          'SNAPBACK_DATA_TRANSACTION_INVALID',
          'one data transaction cannot write the same existing row more than once',
          { resource: chunk.resource },
        );
      }
      writeTargets.add(target);
    }
    const shape = chunks.map(({ resource, operation }) => ({ resource, operation }));
    const entry = binding.dataTransactionCatalog.find((candidate) => (
      canonicalizeClientValueV1(candidate.shape) === canonicalizeClientValueV1(shape)
    ));
    if (!entry) {
      throw dataError(
        'SNAPBACK_DATA_TRANSACTION_NOT_CATALOGUED',
        'this transaction shape is absent from the active static catalogue',
      );
    }
    const intentId = createClientMutationId();
    const canonicalArguments = [];
    const namedArguments = {};
    for (const [position, chunk] of chunks.entries()) {
      for (const name of entry.argumentNames[position]) {
        canonicalArguments.push(chunk.args[name]);
        namedArguments[entry.resolution.kind === 'chunk-mutation' ? name : `c${position}_${name}`]
          = chunk.args[name];
      }
    }
    const envelope = transactionEnvelope(entry, intentId, namedArguments, canonicalArguments);
    const descriptorBytes = utf8.encode(canonicalizeClientValueV1(envelope)).byteLength;
    const firstViolation = descriptorBytes > MAX_DESCRIPTOR_BYTES
      ? ['maxDescriptorBytes', MAX_DESCRIPTOR_BYTES]
      : descriptorBytes > MAX_DURABLE_RECORD_BYTES
        ? ['maxDurableRecordBytes', MAX_DURABLE_RECORD_BYTES]
        : null;
    if (firstViolation !== null) {
      throw dataError(
        'SNAPBACK_DATA_TRANSACTION_BOUND_EXCEEDED',
        `transaction violates ${firstViolation[0]}`,
        { ceiling: firstViolation[0], observed: descriptorBytes, limit: firstViolation[1] },
      );
    }
    return createHandle({
      client,
      intentId,
      entry,
      launch: () => client.__dataMutation(entry.functionReference, {
        args: namedArguments,
        clientMutationId: intentId,
        dataTransaction: envelope,
      }),
    });
  };

  const pendingWrites = async (descriptor) => {
    if (descriptor?.status === 'skipped') return frozen([]);
    const resourceName = descriptor?.core?.resource ?? descriptor?.shape?.resource;
    const table = binding.dataResources.find(({ core }) => core.resource === resourceName)?.core?.table;
    if (typeof table !== 'string') return frozen([]);
    return frozen((await client.__dataPendingWrites())
      .filter((write) => write.reach.writes.includes(table))
      .sort((left, right) => left.sequence - right.sequence || left.intentId.localeCompare(right.intentId))
      .map(({ intentId, state, presentation }) => ({ intentId, state, presentation })));
  };

  return frozen({
    tx: frozen(tx),
    transact,
    transaction(intentId) {
      if (typeof intentId !== 'string' || intentId.length === 0) {
        throw dataError('SNAPBACK_DATA_TRANSACTION_INVALID', 'transaction recovery requires an intent id');
      }
      const entry = { core: { prediction: 'none', chunks: [] } };
      return createHandle({ client, intentId, entry });
    },
    pendingWrites,
    async query(descriptor, options = {}) {
      if (descriptor?.artifactKind !== 'dataQuery') {
        throw dataError('SNAPBACK_DATA_QUERY_SHAPE_INVALID', 'db.query requires a generated data query descriptor');
      }
      const result = await client.query(descriptor.functionReference, {
        ...options,
        args: descriptor.namedArguments,
      });
      return frozen({ ...result, pendingWrites: await pendingWrites(descriptor) });
    },
  });
}
