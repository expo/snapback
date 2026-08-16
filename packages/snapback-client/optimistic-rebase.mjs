// Browser-safe optimistic layer stacking and authoritative rebase for the
// Move-3 Phase-1 IR lane. The outbox owns durable intent and sequence; this
// module owns only the recomputable presentation layer and its inspection
// record.
//
// @ref LLP 0155#rebase — authoritative delivery replaces the base, confirmed
//   identities retire, and every remaining operation replays in sequence.
// @ref LLP 0133#divergence-on-settle — clientMutationId is settlement
//   correlation; confirmation may bridge until authoritative delivery.

import { canonicalizeClientValueV1 } from './canonical-client-value.mjs';
import { evaluateLocalMutationIrV1 } from './ir-evaluator.mjs';
import { admitLocalMutationReadsV1 } from './local-read-admission.mjs';
import {
  rewriteGeneratedArgumentIdsV1,
  rewriteOptimisticLayerIdsV1,
} from './settlement-id-resolution.mjs';

export const OPTIMISTIC_REBASE_SNAPSHOT_FORMAT_V1 =
  'snapback.optimistic-rebase-snapshot.v1';
export const OPTIMISTIC_REBASE_OUTCOME_FORMAT_V1 =
  'snapback.optimistic-rebase-outcome.v1';
// Inspection keeps enough recent rebases to diagnose churn without retaining
// every replayed operation for the lifetime of a client.
export const OPTIMISTIC_REBASE_OUTCOME_CAP = 64;

const PRIVATE_LAYER_FORMAT_V1 = 'snapback.private-optimistic-layer.v1';
const SETTLEMENT_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/u;

const plain = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

const deepFreeze = (value) => {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
};

const canonicalClone = (value) => JSON.parse(canonicalizeClientValueV1(value));
const canonicalText = (value) => canonicalizeClientValueV1(value);

const prepareRows = (value, label = 'authoritativeRows') => {
  if (!plain(value)) throw new TypeError(`${label} must be a table-to-rows object`);
  const cloned = canonicalClone(value);
  for (const [table, rows] of Object.entries(cloned)) {
    if (table.length === 0 || !Array.isArray(rows) || rows.some((row) => !plain(row))) {
      throw new TypeError(`${label}.${table} must be an array of row objects`);
    }
  }
  return cloned;
};

const prepareSettlementIdentities = (value) => {
  if (!Array.isArray(value)) {
    throw new TypeError('retiredSettlementIdentities must be an array');
  }
  const identities = [];
  const seen = new Set();
  for (const identity of value) {
    if (typeof identity !== 'string' || !SETTLEMENT_ID.test(identity)) {
      throw new TypeError('retired settlement identity is invalid');
    }
    if (!seen.has(identity)) identities.push(identity);
    seen.add(identity);
  }
  return identities;
};

const prepareTargetTables = (value) => {
  if (value === null || value === undefined) return null;
  if (
    !Array.isArray(value)
    || value.length === 0
    || value.some((table) => typeof table !== 'string' || table.length === 0)
  ) throw new TypeError('optimistic rebase targetTables must be a non-empty string array');
  return new Set(value);
};

const prepareProjectionMode = (value) => {
  if (value === undefined || value === null) return 'project';
  if (value !== 'project' && value !== 'pending-only') {
    throw new TypeError("optimistic rebase projectionMode must be 'project' or 'pending-only'");
  }
  return value;
};

const operationWriteTables = (operation) => new Set(
  (operation?.plan?.steps ?? []).flatMap((step) => {
    if (!plain(step)) return [];
    for (const kind of ['Insert', 'Patch', 'Delete']) {
      const table = step[kind]?.table;
      if (typeof table === 'string' && table.length > 0) return [table];
    }
    return [];
  }),
);

const operationReadTables = (operation) => new Set(
  Array.isArray(operation?.declaredReads)
    ? operation.declaredReads.filter((table) => typeof table === 'string' && table.length > 0)
    : [],
);

const recordOrder = (left, right) => {
  const leftEpoch = left?.__optimisticSequenceEpoch === 'current' ? 1 : 0;
  const rightEpoch = right?.__optimisticSequenceEpoch === 'current' ? 1 : 0;
  const leftSequence = leftEpoch === 1
    && Number.isSafeInteger(left?.__optimisticInvocationSequence)
    ? left.__optimisticInvocationSequence
    : left.sequence;
  const rightSequence = rightEpoch === 1
    && Number.isSafeInteger(right?.__optimisticInvocationSequence)
    ? right.__optimisticInvocationSequence
    : right.sequence;
  return leftEpoch - rightEpoch
    || leftSequence - rightSequence
    || String(left.id).localeCompare(String(right.id));
};

const privateOrderFields = (record) => ({
  ...(record?.__optimisticSequenceEpoch === 'current'
    ? { __optimisticSequenceEpoch: 'current' }
    : {}),
  ...(Number.isSafeInteger(record?.__optimisticInvocationSequence)
    ? { __optimisticInvocationSequence: record.__optimisticInvocationSequence }
    : {}),
});

const remapLayer = (layer, operation, argsContract, replacements) => {
  if (layer === null || replacements.size === 0) return layer;
  return deepFreeze(rewriteOptimisticLayerIdsV1(layer, {
    operation,
    argsContract,
    replacements,
  }));
};

const prepareLayer = (layer) => {
  if (
    !plain(layer)
    || layer.format !== PRIVATE_LAYER_FORMAT_V1
    || layer.visibility !== 'private'
    || typeof layer.layerId !== 'string'
    || !Array.isArray(layer.writes)
  ) throw new TypeError('optimistic layer is not snapback.private-optimistic-layer.v1');
  return layer;
};

/**
 * Apply one immutable M1 private layer over a cloned table map. Neither the
 * base nor the evaluator-owned layer is mutated. This is deliberately a
 * write-set fold, not replacement by `declaredTableRows`: a point-read
 * workspace is not a canonical table snapshot.
 */
export function applyPrivateOptimisticLayerV1(baseRows, layerInput) {
  const rowsByTable = prepareRows(baseRows, 'baseRows');
  const layer = prepareLayer(layerInput);
  for (const write of layer.writes) {
    if (!plain(write) || typeof write.table !== 'string' || write.table.length === 0) {
      throw new TypeError('optimistic layer write is invalid');
    }
    const tableRows = rowsByTable[write.table] ?? [];
    if (!Array.isArray(tableRows)) throw new TypeError('optimistic layer table is invalid');
    if (write.operation === 'insert') {
      if (!plain(write.row) || typeof write.id !== 'string') {
        throw new TypeError('optimistic insert is invalid');
      }
      tableRows.push(canonicalClone(write.row));
    } else if (write.operation === 'patch') {
      if (typeof write.id !== 'string' || !plain(write.values)) {
        throw new TypeError('optimistic patch is invalid');
      }
      const index = tableRows.findIndex((row) => row?._id === write.id);
      if (index !== -1) {
        tableRows[index] = { ...tableRows[index], ...canonicalClone(write.values) };
      }
    } else if (write.operation === 'delete') {
      if (typeof write.id !== 'string') {
        throw new TypeError('optimistic delete is invalid');
      }
      const index = tableRows.findIndex((row) => row?._id === write.id);
      if (index !== -1) tableRows.splice(index, 1);
    } else {
      throw new TypeError(`optimistic layer carries unsupported write ${write.operation}`);
    }
    rowsByTable[write.table] = tableRows;
  }
  return deepFreeze(rowsByTable);
}

export function applyPrivateOptimisticLayersV1(baseRows, layers) {
  if (!Array.isArray(layers)) throw new TypeError('optimistic layers must be an array');
  return layers.reduce(
    (rows, layer) => applyPrivateOptimisticLayerV1(rows, layer),
    deepFreeze(prepareRows(baseRows, 'baseRows')),
  );
}

const emptySnapshot = (authoritativeRows) => deepFreeze({
  format: OPTIMISTIC_REBASE_SNAPSHOT_FORMAT_V1,
  revision: 0,
  authoritativeRows,
  visibleRows: authoritativeRows,
  layers: [],
  queuedOnly: [],
  lastRebase: null,
});

const previousPredictionSignatures = (snapshot) => new Map([
  ...snapshot.layers.map((entry) => [entry.clientMutationId, canonicalText({
    disposition: 'layered',
    classification: entry.classification,
    code: entry.code,
    writes: entry.layer.writes,
  })]),
  ...snapshot.queuedOnly.map((entry) => [entry.clientMutationId, canonicalText({
    disposition: 'queued-only',
    classification: entry.classification,
    code: entry.code,
    writes: null,
  })]),
]);

const publicReplay = ({
  record,
  admission,
  prediction,
  disposition,
  code,
  predictionChanged,
}) => deepFreeze({
  clientMutationId: record.id,
  layerId: record.id,
  sequence: record.sequence,
  outboxStatus: record.status,
  layerStatus: disposition === 'layered'
    ? (record.status === 'settled' ? 'bridging' : 'pending')
    : null,
  disposition,
  classification: prediction?.classification ?? admission?.classification ?? 'refused',
  code,
  predictionChanged,
  admission,
  prediction,
  ...privateOrderFields(record),
});

const replaySignature = ({ disposition, prediction, admission, code }) => canonicalText({
  disposition,
  classification: prediction?.classification ?? admission?.classification ?? 'refused',
  code,
  writes: prediction?.layer?.writes ?? null,
});

const replayOne = async ({
  record,
  priorLayers,
  registrationLedger,
  readMaterializationAnswer,
  previousSignatures,
  targetTables,
  idReplacements,
}) => {
  let operation;
  try {
    operation = canonicalClone(record.optimisticOperation);
    operation.args = rewriteGeneratedArgumentIdsV1(
      canonicalClone(record.args ?? operation.args ?? {}),
      record.argsContract,
      idReplacements,
    );
    operation.ctxLedger = canonicalClone(record.ctxLedger ?? operation.ctxLedger ?? null);
    operation.layerId = record.id;
  } catch {
    const admission = deepFreeze({
      format: 'snapback.local-read-admission.v1',
      classification: 'refused',
      code: 'SNAPBACK_REBASE_OPERATION_INVALID',
      details: {},
      declaredReads: [],
      reads: [],
      failures: [{ code: 'SNAPBACK_REBASE_OPERATION_INVALID' }],
      admittedRows: null,
    });
    const signature = replaySignature({
      disposition: 'queued-only', admission, prediction: null, code: admission.code,
    });
    return {
      entry: publicReplay({
        record,
        admission,
        prediction: null,
        disposition: 'queued-only',
        code: admission.code,
        predictionChanged: previousSignatures.has(record.id)
          && previousSignatures.get(record.id) !== signature,
      }),
      layer: null,
      refusal: true,
      degradation: false,
    };
  }

  if (record.settlementLane !== 're-derive') {
    const admission = deepFreeze({
      format: 'snapback.local-read-admission.v1',
      classification: 'refused',
      code: 'SNAPBACK_REBASE_SETTLEMENT_LANE_MISMATCH',
      details: { settlementLane: record.settlementLane ?? null },
      declaredReads: operation.declaredReads ?? [],
      reads: [],
      failures: [{ code: 'SNAPBACK_REBASE_SETTLEMENT_LANE_MISMATCH' }],
      admittedRows: null,
    });
    const signature = replaySignature({
      disposition: 'queued-only', admission, prediction: null, code: admission.code,
    });
    return {
      entry: publicReplay({
        record,
        admission,
        prediction: null,
        disposition: 'queued-only',
        code: admission.code,
        predictionChanged: previousSignatures.has(record.id)
          && previousSignatures.get(record.id) !== signature,
      }),
      layer: null,
      refusal: true,
      degradation: false,
    };
  }

  const writeTables = operationWriteTables(operation);
  const crossTableReads = targetTables === null
    ? []
    : [...operationReadTables(operation)].filter((table) => !targetTables.has(table));
  if (
    targetTables !== null
    && [...writeTables].some((table) => targetTables.has(table))
    && crossTableReads.length > 0
  ) {
    // A target-table projection cannot replay a later operation against a
    // prior non-target mutation without owning that other table's complete
    // authoritative/rebase lifecycle. Degrade the whole dependent operation
    // instead of evaluating it against an incorrectly filtered store.
    const admission = deepFreeze({
      format: 'snapback.local-read-admission.v1',
      classification: 'refused',
      code: 'SNAPBACK_OPTIMISTIC_CROSS_TABLE_REPLAY_UNPROVEN',
      details: { targetTables: [...targetTables].sort(), crossTableReads: crossTableReads.sort() },
      declaredReads: [...operationReadTables(operation)].sort(),
      reads: [],
      failures: [{ code: 'SNAPBACK_OPTIMISTIC_CROSS_TABLE_REPLAY_UNPROVEN' }],
      admittedRows: null,
    });
    const signature = replaySignature({
      disposition: 'queued-only', admission, prediction: null, code: admission.code,
    });
    return {
      entry: publicReplay({
        record,
        admission,
        prediction: null,
        disposition: 'queued-only',
        code: admission.code,
        predictionChanged: previousSignatures.has(record.id)
          && previousSignatures.get(record.id) !== signature,
      }),
      layer: null,
      refusal: true,
      degradation: true,
    };
  }

  const admission = await admitLocalMutationReadsV1({
    operation,
    registrationLedger,
    readMaterializationAnswer,
  });
  const initialRows = admission.admittedRows === null
    ? {}
    : applyPrivateOptimisticLayersV1(admission.admittedRows, priorLayers);
  const evaluatedPrediction = evaluateLocalMutationIrV1({
    name: operation.name,
    schema: operation.schema,
    initialRows,
    plan: operation.plan,
    args: operation.args,
    ctxLedger: operation.ctxLedger,
    authUserId: operation.authUserId,
    layerId: record.id,
    declaredEffectClass: operation.declaredEffectClass,
    readAdmission: admission.classification,
  });
  const remappedLayer = remapLayer(
    evaluatedPrediction.layer,
    operation,
    record.argsContract,
    idReplacements,
  );
  const prediction = remappedLayer === evaluatedPrediction.layer
    ? evaluatedPrediction
    : deepFreeze({ ...evaluatedPrediction, layer: remappedLayer });
  const layer = prediction.layer;
  const disposition = layer === null ? 'queued-only' : 'layered';
  const code = prediction.execution?.status === 'rejected'
    ? prediction.execution.rejectionCode
    : prediction.code;
  const signature = replaySignature({ disposition, admission, prediction, code });
  const entry = publicReplay({
    record,
    admission,
    prediction,
    disposition,
    code,
    predictionChanged: previousSignatures.has(record.id)
      && previousSignatures.get(record.id) !== signature,
  });
  return {
    entry,
    layer,
    refusal: disposition === 'queued-only'
      && (prediction.classification === 'refused' || prediction.execution?.status === 'rejected'),
    // predictable-with-partial-input is an admitted conservative prediction,
    // not queued-only degradation. Server-only is the ordinary no-effect
    // degradation M2 defines.
    degradation: prediction.classification === 'server-only',
  };
};

/**
 * Create one serialized, atomic-publication rebase engine. The engine never
 * persists a layer payload: every layer is reconstructed from the outbox's
 * immutable IR operation and sequence, so reload has one durable intent
 * authority and cannot apply an operation twice within a stack.
 */
export function createOptimisticRebaseEngineV1({
  outboxStore,
  registrationLedger,
  readMaterializationAnswer,
  initialAuthoritativeRows = {},
  targetTables = null,
  projectionMode = 'project',
} = {}) {
  if (typeof outboxStore?.outboxRecords !== 'function') {
    throw new TypeError('optimistic rebase requires an outboxRecords store seam');
  }
  if (typeof registrationLedger?.demandedMaterializations !== 'function') {
    throw new TypeError('optimistic rebase requires a registration ledger');
  }
  if (typeof readMaterializationAnswer !== 'function') {
    throw new TypeError('optimistic rebase requires readMaterializationAnswer');
  }
  const admittedTargetTables = prepareTargetTables(targetTables);
  const admittedProjectionMode = prepareProjectionMode(projectionMode);

  const listeners = new Set();
  const outcomes = [];
  let reflectedSettlementIdentities = new Set();
  let reflectedIdReplacements = new Map();
  const layerRewriteMetadata = new Map();
  let snapshot = emptySnapshot(deepFreeze(prepareRows(initialAuthoritativeRows)));
  let closed = false;
  let serialized = Promise.resolve();

  const notify = () => {
    for (const listener of [...listeners]) {
      try { listener(); } catch { /* observation cannot own rebase */ }
    }
  };

  const executeRebase = async ({
    authoritativeRows = snapshot.authoritativeRows,
    retiredSettlementIdentities = [],
    settlementIdReplacements = {},
    cause = 'authoritative-delivery',
  } = {}) => {
    if (closed) {
      const code = 'SNAPBACK_OPTIMISTIC_REBASE_CLOSED';
      const message = 'optimistic rebase engine is closed';
      const error = new Error(`${code}: ${message}`);
      error.code = code;
      error.diagnostic = Object.freeze({
        schemaVersion: 'snapback.client-diagnostic.v1',
        code,
        severity: 'error',
        message,
        details: Object.freeze({}),
      });
      throw error;
    }
    if (typeof cause !== 'string' || cause.length === 0) {
      throw new TypeError('rebase cause must be a non-empty string');
    }
    const nextBase = deepFreeze(prepareRows(authoritativeRows));
    const newlyReflected = prepareSettlementIdentities(retiredSettlementIdentities);
    const nextReflected = new Set(reflectedSettlementIdentities);
    for (const identity of newlyReflected) nextReflected.add(identity);
    if (!plain(settlementIdReplacements)) {
      throw new TypeError('settlementIdReplacements must be a string-to-string object');
    }
    const nextIdReplacements = new Map(reflectedIdReplacements);
    for (const [speculative, authoritative] of Object.entries(settlementIdReplacements)) {
      if (
        !SETTLEMENT_ID.test(speculative)
        || typeof authoritative !== 'string'
        || !SETTLEMENT_ID.test(authoritative)
      ) throw new TypeError('settlement id replacement is invalid');
      const prior = nextIdReplacements.get(speculative);
      if (prior !== undefined && prior !== authoritative) {
        throw new TypeError('settlement id replacement conflicts with prior reflection');
      }
      nextIdReplacements.set(speculative, authoritative);
    }

    const records = await outboxStore.outboxRecords();
    if (!Array.isArray(records)) throw new TypeError('outboxRecords must return an array');
    const recordsById = new Map(records.map((record) => [record?.id, record]));
    // Settlement ACK is allowed to remove durable recovery state before the
    // query that displays the mutation observes canonical reflection. Keep an
    // already-installed bridging layer as private presentation state until the
    // real matcher explicitly retires it; the layer remains recomputable data,
    // never a second durable intent authority.
    const retainedBridges = snapshot.layers.filter((entry) => (
      entry.layerStatus === 'bridging'
      && !recordsById.has(entry.clientMutationId)
      && !nextReflected.has(entry.clientMutationId)
    ));
    const ordered = [
      ...records.map((record) => ({ kind: 'record', sequence: record.sequence, record })),
      ...retainedBridges.map((entry) => ({ kind: 'bridge', sequence: entry.sequence, entry })),
    ].sort((left, right) => recordOrder(
      left.kind === 'record' ? left.record : left.entry,
      right.kind === 'record' ? right.record : right.entry,
    ));
    const previousSignatures = previousPredictionSignatures(snapshot);
    const previousIds = new Set([
      ...snapshot.layers.map((entry) => entry.clientMutationId),
      ...snapshot.queuedOnly.map((entry) => entry.clientMutationId),
    ]);
    const layers = [];
    const queuedOnly = [];
    const replayedOperations = [];
    const refusals = [];
    const degradations = [];
    const retiredIdentities = [];
    for (const identity of newlyReflected) {
      if (!previousIds.has(identity) || recordsById.has(identity)) continue;
      const previous = snapshot.layers.find((entry) => entry.clientMutationId === identity);
      if (previous) retiredIdentities.push(deepFreeze({
        settlementIdentity: identity,
        sequence: previous.sequence,
        reason: 'authoritative-delivery',
      }));
    }

    for (const item of ordered) {
      if (item.kind === 'bridge') {
        const metadata = layerRewriteMetadata.get(item.entry.clientMutationId) ?? {};
        const remappedLayer = remapLayer(
          item.entry.layer,
          metadata.operation,
          metadata.argsContract,
          nextIdReplacements,
        );
        const entry = remappedLayer === item.entry.layer
          ? item.entry
          : deepFreeze({
              ...item.entry,
              layer: remappedLayer,
              prediction: item.entry.prediction === null
                ? null
                : deepFreeze({ ...item.entry.prediction, layer: remappedLayer }),
            });
        layers.push(entry);
        replayedOperations.push(entry);
        continue;
      }
      const { record } = item;
      if (!plain(record) || typeof record.id !== 'string' || !Number.isSafeInteger(record.sequence)) {
        throw new TypeError('outbox returned an invalid stored record');
      }
      if (!['pending', 'settled'].includes(record.status)) {
        if (record.status === 'failed' && previousIds.has(record.id)) {
          retiredIdentities.push(deepFreeze({
            settlementIdentity: record.id,
            sequence: record.sequence,
            reason: 'failed',
          }));
        }
        continue;
      }
      if (record.optimisticOperation == null) {
        const tables = record.generatedMutationTables;
        const relevant = Array.isArray(tables)
          && (
            tables.length === 0
            || admittedTargetTables === null
            || tables.some((table) => admittedTargetTables.has(table))
          );
        if (relevant) {
          const entry = deepFreeze({
            clientMutationId: record.id,
            layerId: record.id,
            sequence: record.sequence,
            outboxStatus: record.status,
            layerStatus: null,
            disposition: 'queued-only',
            classification: 'server-only',
            code: 'SNAPBACK_GENERATED_IR_SERVER_ONLY',
            predictionChanged: false,
            admission: null,
            prediction: null,
            ...privateOrderFields(record),
          });
          queuedOnly.push(entry);
          replayedOperations.push(entry);
          degradations.push(entry);
        }
        continue;
      }
      layerRewriteMetadata.set(record.id, {
        operation: record.optimisticOperation,
        argsContract: record.argsContract,
      });
      let writeTables;
      if (admittedTargetTables !== null) {
        try {
          writeTables = operationWriteTables(record.optimisticOperation);
        } catch {
          writeTables = new Set();
        }
        if (![...writeTables].some((table) => admittedTargetTables.has(table))) continue;
      }
      if (nextReflected.has(record.id)) {
        if (
          !reflectedSettlementIdentities.has(record.id)
          && (previousIds.has(record.id) || newlyReflected.includes(record.id))
        ) {
          retiredIdentities.push(deepFreeze({
            settlementIdentity: record.id,
            sequence: record.sequence,
            reason: 'authoritative-delivery',
          }));
        }
        continue;
      }
      const replay = await replayOne({
        record,
        priorLayers: layers.map((entry) => entry.layer),
        registrationLedger,
        readMaterializationAnswer,
        previousSignatures,
        targetTables: admittedTargetTables,
        idReplacements: nextIdReplacements,
      });
      replayedOperations.push(replay.entry);
      if (replay.layer === null) queuedOnly.push(replay.entry);
      else if (admittedProjectionMode === 'pending-only') {
        const entry = publicReplay({
          record,
          admission: replay.entry.admission,
          prediction: null,
          disposition: 'queued-only',
          code: 'SNAPBACK_OPTIMISTIC_QUERY_MEMBERSHIP_UNPROVEN',
          predictionChanged: replay.entry.predictionChanged,
        });
        queuedOnly.push(entry);
        degradations.push(entry);
      } else layers.push(deepFreeze({ ...replay.entry, layer: replay.layer }));
      if (replay.refusal) refusals.push(replay.entry);
      if (replay.degradation) degradations.push(replay.entry);
    }

    const visibleRows = applyPrivateOptimisticLayersV1(
      nextBase,
      layers.map((entry) => entry.layer),
    );
    const revision = snapshot.revision + 1;
    const changedPredictions = replayedOperations.filter((entry) => entry.predictionChanged);
    const outcome = deepFreeze({
      format: OPTIMISTIC_REBASE_OUTCOME_FORMAT_V1,
      revision,
      cause,
      retiredIdentities,
      replayedOperations,
      changedPredictions,
      refusals,
      degradations,
    });
    const nextSnapshot = deepFreeze({
      format: OPTIMISTIC_REBASE_SNAPSHOT_FORMAT_V1,
      revision,
      authoritativeRows: nextBase,
      visibleRows,
      layers,
      queuedOnly,
      lastRebase: outcome,
    });

    // Reveal base + replayed stack + outcome together, after every async
    // admission/evaluation has completed. No subscriber can observe a torn
    // intermediate stack.
    reflectedSettlementIdentities = nextReflected;
    reflectedIdReplacements = nextIdReplacements;
    const retainedLayerIds = new Set(layers.map((entry) => entry.clientMutationId));
    for (const identity of layerRewriteMetadata.keys()) {
      if (!retainedLayerIds.has(identity)) layerRewriteMetadata.delete(identity);
    }
    snapshot = nextSnapshot;
    outcomes.push(outcome);
    if (outcomes.length > OPTIMISTIC_REBASE_OUTCOME_CAP) outcomes.shift();
    notify();
    return outcome;
  };

  const rebase = (input = {}) => {
    const operation = serialized.then(() => executeRebase(input));
    serialized = operation.catch(() => {});
    return operation;
  };

  return Object.freeze({
    rebase,
    reload(input = {}) {
      return rebase({ ...input, cause: input.cause ?? 'reload' });
    },
    refresh(input = {}) {
      return rebase({ ...input, cause: input.cause ?? 'outbox-transition' });
    },
    getSnapshot() { return snapshot; },
    inspection() {
      return deepFreeze({
        revision: snapshot.revision,
        layerCount: snapshot.layers.length,
        queuedOnlyCount: snapshot.queuedOnly.length,
        reflectedSettlementIdentities: [...reflectedSettlementIdentities],
        rebaseOutcomes: [...outcomes],
        closed,
      });
    },
    subscribe(listener) {
      if (typeof listener !== 'function') throw new TypeError('rebase listener must be a function');
      if (closed) return () => {};
      listeners.add(listener);
      let subscribed = true;
      return () => {
        if (!subscribed) return;
        subscribed = false;
        listeners.delete(listener);
      };
    },
    close() {
      if (closed) return;
      closed = true;
      listeners.clear();
      outcomes.length = 0;
    },
  });
}
