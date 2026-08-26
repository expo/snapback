import { spawn } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';

import {
  assertExpoCarrierPostBootInvariants,
  expoCarrierPostBootInvariantNames,
} from '../qualification-invariants.mjs';

const serverExecuteOnce = (directory, id) => {
  const server = new DatabaseSync(join(directory, 'qualification-server.sqlite'));
  server.exec(`CREATE TABLE IF NOT EXISTS executions (
    client_mutation_id TEXT PRIMARY KEY NOT NULL,
    execution_count INTEGER NOT NULL,
    result_json TEXT NOT NULL
  ) WITHOUT ROWID`);
  let row = server.prepare(
    'SELECT execution_count, result_json FROM executions WHERE client_mutation_id = ?',
  ).get(id);
  if (row === undefined) {
    const result = { ok: true, clientMutationId: id };
    server.prepare(
      'INSERT INTO executions (client_mutation_id, execution_count, result_json) VALUES (?, 1, ?)',
    ).run(id, JSON.stringify(result));
    row = { execution_count: 1, result_json: JSON.stringify(result) };
  }
  server.close();
  return JSON.parse(row.result_json);
};

const serverExecutionCount = (directory, id) => {
  const server = new DatabaseSync(join(directory, 'qualification-server.sqlite'), { readOnly: true });
  const count = server.prepare(
    'SELECT execution_count FROM executions WHERE client_mutation_id = ?',
  ).get(id)?.execution_count ?? 0;
  server.close();
  return count;
};

export async function verifyRecoveredCycle({
  directory,
  store,
  phase,
  armed,
  reportedHostWatermarks,
  openIndependentStore,
}) {
  const projected = await store.materializationTransaction('readonly', (view) => ({
    generationValues: [
      view.entries.get('generation')?.rows?.[0]?.generation ?? null,
      view.materializations.get('generation')?.generation ?? null,
      view.pageSets.get('generation')?.generation ?? null,
      view.memberships.get('generation')?.generation ?? null,
    ],
    recoveredHostWatermarks: [...view.entries.keys()]
      .filter((key) => key.startsWith('host-watermark:'))
      .map((key) => key.slice('host-watermark:'.length)),
  }));
  const records = await store.outboxRecords();
  const mutation = records.find((record) => record.id === armed.clientMutationId) ?? null;
  const partialSettlement = mutation?.status === 'pending'
    ? mutation.settlement != null || mutation.settledAt != null
    : mutation?.status === 'settled'
      ? mutation.settlement == null || !Number.isSafeInteger(mutation.settledAt)
      : true;
  let independentOwnerRefused = false;
  try {
    const second = await openIndependentStore(directory);
    await second.close();
  } catch (error) {
    independentOwnerRefused = error?.code === 'SNAPBACK_EXPO_SQLITE_STORE_OWNER_UNAVAILABLE';
  }
  const result = serverExecuteOnce(directory, armed.clientMutationId);
  if (mutation?.status === 'pending') {
    await store.outboxDurablyConsume(
      armed.clientMutationId,
      { result },
      'qualification-user',
    );
  }
  const republished = (await store.outboxRecords()).find(
    (record) => record.id === armed.clientMutationId,
  );
  await store.outboxMarkAcknowledgementsReady(
    [armed.clientMutationId],
    undefined,
    undefined,
    null,
    armed.enqueueTarget,
  );
  const ackReadyObserved = (await store.outboxPendingAcknowledgements(
    'qualification-user',
    64,
    null,
    armed.enqueueTarget,
  ))
    .includes(armed.clientMutationId);
  await store.outboxConfirmAcknowledgements(
    [armed.clientMutationId],
    undefined,
    undefined,
    null,
    armed.enqueueTarget,
  );
  const removedAfterAckProof = !(await store.outboxRecords())
    .some((record) => record.id === armed.clientMutationId)
    && !(await store.outboxPendingAcknowledgements(
      'qualification-user',
      64,
      null,
      armed.enqueueTarget,
    ))
      .includes(armed.clientMutationId);
  const currentMeta = await store.readStoreMeta();
  const record = {
    generation: {
      values: projected.generationValues,
      allowed: phase === 'authority-wipe-before-successor' ? [null] : [1, 2],
    },
    reportedHostWatermarks,
    recoveredHostWatermarks: projected.recoveredHostWatermarks,
    writer: {
      recoveredOwner: (await store.inspection()).writer,
      independentOwnerRefused,
    },
    predecessor: {
      renderable: (await store.load(armed.predecessorKey)) !== null,
      handleKeyRotated: currentMeta.handleKey !== armed.predecessorHandleKey,
    },
    expectedClientMutationId: armed.clientMutationId,
    mutation: {
      clientMutationId: mutation?.id ?? null,
      recoveredStatus: mutation?.status ?? null,
      partialSettlement,
    },
    server: { executionCount: serverExecutionCount(directory, armed.clientMutationId) },
    settlement: {
      republished: republished?.status === 'settled'
        && republished?.settlement?.result?.clientMutationId === armed.clientMutationId,
      ackReadyObserved,
      removedAfterAckProof,
    },
    evaluatedInvariants: expoCarrierPostBootInvariantNames,
  };
  const verdict = assertExpoCarrierPostBootInvariants(record);
  return Object.freeze({ ...record, verdict });
}

const messageStream = (processHandle) => {
  const queued = [];
  const waiting = [];
  let buffer = '';
  let terminalError = null;
  const settle = (value) => {
    const waiter = waiting.shift();
    if (waiter) waiter.resolve(value);
    else queued.push(value);
  };
  processHandle.stdout.on('data', (chunk) => {
    buffer += chunk;
    while (buffer.includes('\n')) {
      const newline = buffer.indexOf('\n');
      const line = buffer.slice(0, newline);
      buffer = buffer.slice(newline + 1);
      if (line.length > 0) settle(JSON.parse(line));
    }
  });
  processHandle.once('error', (error) => {
    terminalError = error;
    for (const waiter of waiting.splice(0)) waiter.reject(error);
  });
  processHandle.once('exit', (code, signal) => {
    if (signal === 'SIGKILL') return;
    terminalError ??= new Error(`worker exited ${code}/${signal}: ${buffer}`);
    for (const waiter of waiting.splice(0)) waiter.reject(terminalError);
  });
  return Object.freeze({
    next() {
      if (queued.length > 0) return Promise.resolve(queued.shift());
      if (terminalError) return Promise.reject(terminalError);
      return new Promise((resolveMessage, reject) => waiting.push({ resolve: resolveMessage, reject }));
    },
  });
};

const kill = async (processHandle) => {
  processHandle.kill('SIGKILL');
  await new Promise((resolveExit) => processHandle.once('exit', resolveExit));
};

export async function runBrokenStoreNegativeControl({
  directory,
  workerPath,
  openStore,
}) {
  const phase = 'pending-durable-before-delivery';
  const worker = spawn(process.execPath, [workerPath, JSON.stringify({
    command: 'phase',
    phase,
    directory,
    databaseName: 'qualification.sqlite',
    storeImplementation: 'drop-generation-membership-write',
  })], { stdio: ['ignore', 'pipe', 'pipe'] });
  const messages = messageStream(worker);
  const armed = await messages.next();
  if (armed.status !== 'armed') throw new Error(`negative-control worker did not arm: ${armed.status}`);
  let cutReady;
  while (cutReady === undefined) {
    const message = await messages.next();
    if (message.status === 'cut-ready') cutReady = message;
    else if (message.status === 'error') throw new Error(`negative-control worker failed: ${message.message}`);
  }
  await kill(worker);
  const recovered = await openStore(directory);
  let failure = null;
  try {
    await verifyRecoveredCycle({
      directory,
      store: recovered,
      phase,
      armed,
      reportedHostWatermarks: [],
      openIndependentStore: openStore,
    });
  } catch (error) {
    failure = error;
  } finally {
    await recovered.close();
  }
  return Object.freeze({
    expectedHarnessVerdict: 'fail',
    observedHarnessVerdict: failure === null ? 'pass' : 'fail',
    storeImplementation: 'drop-generation-membership-write',
    cutBoundary: cutReady.boundary,
    failureMessage: failure?.message ?? null,
  });
}
