import assert from 'node:assert/strict';

import { createCommandClient } from './commands.mjs';

const mutation = Object.freeze({
  artifactKind: 'functionReference',
  kind: 'Mutation',
  id: 'fixture:sendMessage',
  name: 'sendMessage',
  argumentSchema: {
    type: 'object',
    additionalProperties: false,
    properties: { roomId: { type: 'string' }, body: { type: 'string' }, image: { type: 'string' } },
    required: ['roomId'],
  },
});
const intent = Object.freeze({ artifactKind: 'assetUploadReference', id: 'fixture:image', name: 'imageUpload' });
const command = Object.freeze({
  kind: 'asset-bearing-command.v1',
  mutation,
  asset: Object.freeze({ input: 'image', intent, mutationArg: 'image', optional: true }),
  passthroughArgs: Object.freeze(['roomId', 'body']),
});
const file = Object.freeze({
  size: 3,
  slice() { return { async arrayBuffer() { return Uint8Array.from([1, 2, 3]).buffer; } }; },
});

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function settleWithin(promise, message) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(message)), 1_000);
    promise.then(
      (value) => { clearTimeout(timeout); resolve(value); },
      (error) => { clearTimeout(timeout); reject(error); },
    );
  });
}

function classifyDoneOutcome(outcome) {
  switch (outcome.kind) {
    case 'committed': return 'committed';
    case 'failed': return 'failed';
    case 'ambiguous': return 'ambiguous';
    case 'cancelled': return 'cancelled';
    case 'notRetryable': return 'notRetryable';
    default: throw new Error(`unknown command outcome kind ${String(outcome.kind)}`);
  }
}

function dedupeConsecutive(values) {
  return values.filter((value, index) => index === 0 || value !== values[index - 1]);
}

function assertNoCleanupRepairs(...repairLists) {
  for (const repairs of repairLists) {
    assert.ok(Array.isArray(repairs));
    for (const repair of repairs) {
      assert.equal(typeof repair.kind, 'string');
      assert.doesNotMatch(repair.kind, /delete|cleanup/iu);
      assert.equal(typeof repair.machineApplicable, 'boolean');
      assert.equal(typeof repair.requiresApproval, 'boolean');
    }
  }
}

function assetSnapshot(status, extra = {}) {
  return Object.freeze({
    assetId: status === 'creating' ? null : 'asset-1',
    assetRef: status === 'ready' ? 'asset-1' : null,
    attemptId: status === 'creating' ? null : 'attempt-1',
    attemptExpiresAtMs: null,
    status,
    diagnostic: null,
    bytesTransferred: status === 'ready' ? 3 : 0,
    totalBytes: 3,
    previewUrl: null,
    integrityBasis: 'end-to-end-verified',
    ...extra,
  });
}

function controlledAssetTask(initial = assetSnapshot('uploading')) {
  let snapshot = initial;
  const listeners = new Set();
  const terminal = deferred();
  let cancelled = 0;
  let retryTask = null;
  const task = {
    done: terminal.promise,
    snapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener);
      listener(snapshot);
      return () => listeners.delete(listener);
    },
    async cancel() {
      cancelled += 1;
      task.publish(assetSnapshot('cancelled'));
      return snapshot;
    },
    async retry() {
      assert(retryTask, 'test retry successor was not installed');
      return retryTask;
    },
    publish(next) {
      snapshot = next;
      for (const listener of [...listeners]) listener(snapshot);
      if (['ready', 'rejected', 'cancelled', 'failed'].includes(snapshot.status)) terminal.resolve(snapshot);
    },
    setRetry(next) { retryTask = next; },
    get cancelled() { return cancelled; },
  };
  return task;
}

function fixture({ task = null, invokeMutation, current = () => true, assetSourceAdapter = null } = {}) {
  const calls = [];
  const client = {
    captureAuthority: () => Object.freeze({ generation: 1 }),
    isAuthorityCaptureCurrent: current,
  };
  const assets = {
    start(options) {
      calls.push({ kind: 'asset', options });
      if (!task) throw new Error('unexpected asset start');
      return task;
    },
  };
  const commands = createCommandClient(client, {
    assets,
    assetSourceAdapter,
    invokeMutation: async (reference, args, options) => {
      calls.push({ kind: 'mutation', reference, args: { ...args }, options });
      return invokeMutation?.(reference, args, options) ?? 'message-1';
    },
  });
  return { commands, calls };
}

const noAttachmentFactResidues = [];

{
  const textTrace = [];
  const { commands } = fixture();
  const task = commands.start(command, { roomId: 'room-1', body: 'hello' });
  task.subscribe(() => textTrace.push(task.snapshot()));
  await task.done;
  assert.deepEqual(
    dedupeConsecutive(textTrace.map(({ status }) => status)),
    ['preparing', 'committing', 'succeeded'],
  );
  assert.ok(textTrace.every(({ asset }) => asset === null));

  const imageTrace = [];
  const asset = controlledAssetTask();
  const imageFixture = fixture({ task: asset });
  const imageTask = imageFixture.commands.start(command, { roomId: 'room-1', image: file });
  imageTask.subscribe(() => imageTrace.push(imageTask.snapshot()));
  await Promise.resolve();
  asset.publish(assetSnapshot('ready'));
  await imageTask.done;
  assert.deepEqual(
    dedupeConsecutive(imageTrace.map(({ status }) => status)),
    ['preparing', 'transferring', 'committing', 'succeeded'],
  );
}

{
  const mutationSettlementError = (proved) => Object.assign(
    new Error('mutation settlement was refused or lost'),
    proved ? { effectCommitted: false } : {},
  );
  const drive = async (proved) => {
    const { commands } = fixture({
      invokeMutation: async () => { throw mutationSettlementError(proved); },
    });
    return commands.start(command, { roomId: 'room-1' });
  };
  const refused = await drive(true);
  const unproved = await drive(false);
  // A caller that only awaits the promise must still be able to tell refusal from ambiguity.
  assert.equal(classifyDoneOutcome(await refused.done), 'failed');
  assert.equal(classifyDoneOutcome(await unproved.done), 'ambiguous');
}

{
  const providerClosedError = (proved) => {
    const error = new Error('SNAPBACK_REACT_PROVIDER_CLOSED: React provider is closed');
    error.code = 'SNAPBACK_REACT_PROVIDER_CLOSED';
    error.diagnostic = Object.freeze({
      schemaVersion: 'snapback.client-diagnostic.v1',
      code: 'SNAPBACK_REACT_PROVIDER_CLOSED',
      severity: 'error',
      message: 'React provider is closed',
      details: Object.freeze(proved ? { effectCommitted: false } : {}),
    });
    return error;
  };
  const drive = async (proved) => {
    const asset = controlledAssetTask();
    const { commands } = fixture({
      task: asset,
      invokeMutation: async () => { throw providerClosedError(proved); },
    });
    const task = commands.start(command, { roomId: 'room-1', image: file });
    asset.publish(assetSnapshot('ready'));
    return task;
  };
  // LLP 0180 §Mutation ambiguity scopes ambiguity to "once mutation invocation
  // begins"; refusal must be PROVEN, and a provider closed before dispatch is
  // proof — the mutation was never sent.
  const refused = await drive(true);
  const refusedOutcome = await refused.done;
  assert.equal(refusedOutcome.kind, 'failed');
  assert.equal(refusedOutcome.diagnostic.code, 'SNAPBACK_REACT_PROVIDER_CLOSED');
  assert.equal(refused.snapshot().mutation.status, 'rejected');
  assert.equal(refusedOutcome.residue.unattached, 'inferred');
  assert.notEqual(refusedOutcome.residue.unattached, 'unknown');

  const unproved = await drive(false);
  const unprovedOutcome = await unproved.done;
  assert.equal(unprovedOutcome.kind, 'ambiguous');
  assert.equal(unproved.snapshot().mutation.status, 'ambiguous');
  assert.equal(unprovedOutcome.residue.unattached, 'unknown');
}

{
  const succeededFixture = fixture();
  const succeeded = succeededFixture.commands.start(command, { roomId: 'room-1' });

  const failedFixture = fixture({
    invokeMutation: async () => { throw Object.assign(new Error('refused'), { effectCommitted: false }); },
  });
  const failed = failedFixture.commands.start(command, { roomId: 'room-1' });

  const ambiguousFixture = fixture({
    invokeMutation: async () => { throw new Error('settlement lost'); },
  });
  const ambiguous = ambiguousFixture.commands.start(command, { roomId: 'room-1' });

  const cancelledFixture = fixture();
  const cancelled = cancelledFixture.commands.start(command, { roomId: 'room-1' });
  await cancelled.cancel();

  const terminalTable = [];
  for (const task of [succeeded, failed, ambiguous, cancelled]) {
    const outcome = await task.done;
    terminalTable.push([task.snapshot().status, outcome.kind]);
  }
  terminalTable.sort(([left], [right]) => left.localeCompare(right));
  assert.deepEqual(terminalTable, [
    ['ambiguous', 'ambiguous'],
    ['cancelled', 'cancelled'],
    ['failed', 'failed'],
    ['succeeded', 'committed'],
  ]);
}

{
  const asset = controlledAssetTask();
  const pickerSource = Object.freeze({
    uri: 'content://media/external/images/media/42',
    fileName: 'picked.png',
    mimeType: 'image/png',
  });
  const { commands, calls } = fixture({
    task: asset,
    assetSourceAdapter: async (source) => {
      assert.strictEqual(source, pickerSource);
      return {
        file,
        declaredFilename: source.fileName,
        declaredContentType: source.mimeType,
        previewUrl: source.uri,
      };
    },
  });
  const task = commands.start(command, { roomId: 'room-1', image: pickerSource });
  while (calls.length === 0) await Promise.resolve();
  assert.equal(task.snapshot().status, 'transferring');
  assert.strictEqual(calls[0].options.file, file);
  assert.equal(calls[0].options.declaredFilename, 'picked.png');
  assert.equal(calls[0].options.declaredContentType, 'image/png');
  assert.equal(calls[0].options.previewUrl, pickerSource.uri);
  asset.publish(assetSnapshot('ready'));
  assert.equal((await task.done).kind, 'committed');
}

{
  const { commands, calls } = fixture();
  const task = commands.start(command, { roomId: 'room-1', body: 'hello' });
  const outcome = await task.done;
  assert.deepEqual(outcome, { kind: 'committed', result: 'message-1' });
  assert.equal(task.snapshot().status, 'succeeded');
  assert.deepEqual(calls.map(({ kind }) => kind), ['mutation']);
  assert.deepEqual(calls[0].args, { roomId: 'room-1', body: 'hello' });
  const terminalSnapshot = task.snapshot();
  const firstRefusal = task.retry();
  assert.strictEqual(firstRefusal.snapshot(), terminalSnapshot);
  assert.equal((await firstRefusal.done).kind, 'notRetryable');
  const secondRefusal = firstRefusal.retry();
  assert.strictEqual(secondRefusal.snapshot(), terminalSnapshot);
  assert.equal((await secondRefusal.done).kind, 'notRetryable');
  assert.deepEqual(calls.map(({ kind }) => kind), ['mutation']);
}

{
  const asset = controlledAssetTask();
  const { commands, calls } = fixture({ task: asset });
  const task = commands.start(command, { roomId: 'room-1', image: file });
  while (task.snapshot().status === 'preparing') await Promise.resolve();
  assert.equal(task.snapshot().status, 'transferring');
  asset.publish(assetSnapshot('ready'));
  const outcome = await task.done;
  assert.equal(outcome.kind, 'committed');
  assert.deepEqual(calls.map(({ kind }) => kind), ['asset', 'mutation']);
  assert.deepEqual(calls[1].args, { roomId: 'room-1', image: 'asset-1' });
  assert.strictEqual(calls[0].options.authorityCapture, calls[1].options.authorityCapture);
}

{
  const asset = controlledAssetTask();
  const refusal = Object.assign(new Error('message policy refused'), {
    receipt: { outcome: 'rejected' },
    diagnostic: { code: 'SNAPBACK_MESSAGE_REFUSED', message: 'message policy refused', details: { effectCommitted: false } },
  });
  const { commands } = fixture({ task: asset, invokeMutation: async () => { throw refusal; } });
  const task = commands.start(command, { roomId: 'room-1', image: file });
  asset.publish(assetSnapshot('ready'));
  const outcome = await task.done;
  assert.equal(outcome.kind, 'failed');
  assert.equal(task.snapshot().status, 'failed');
  assert.equal(task.snapshot().asset.status, 'ready', 'finalized bytes are not fabricated as rolled back');
  assert.equal(outcome.residue.assetId, 'asset-1');
  assert.equal(outcome.residue.unattached, 'inferred');
  assert.equal(typeof outcome.residue.basis, 'string');
  assert.ok(outcome.residue.basis.length > 0);
  assert.match(outcome.residue.basis, /global absence is inferred/u);
  assert.equal(typeof outcome.residue.cleanupPolicy, 'string');
  assert.ok(outcome.residue.cleanupPolicy.length > 0);
  assert.equal(outcome.repairs[0].kind, 'retryCommand');
  assertNoCleanupRepairs(task.snapshot().repairs, outcome.repairs);
  noAttachmentFactResidues.push(['proved-refusal', outcome.residue.unattached]);
}

{
  const asset = controlledAssetTask();
  const refusal = Object.assign(new Error('message policy refused'), {
    receipt: { outcome: 'rejected' },
    diagnostic: { code: 'SNAPBACK_MESSAGE_REFUSED', message: 'message policy refused', details: { effectCommitted: false } },
  });
  const { commands } = fixture({ task: asset, invokeMutation: async () => { throw refusal; } });
  const task = commands.start(command, { roomId: 'room-1', image: file });
  asset.publish(assetSnapshot('ready', {
    attachmentFact: {
      unattached: true,
      provenance: 'authoritative',
      basis: 'asset child supplied a global attachment fact',
      cleanupPolicy: 'asset child policy remains authoritative',
    },
  }));
  const outcome = await task.done;
  assert.equal(outcome.kind, 'failed');
  assert.equal(outcome.residue.unattached, 'authoritative');
  assert.equal(outcome.residue.basis, 'asset child supplied a global attachment fact');
  assert.equal(outcome.residue.cleanupPolicy, 'asset child policy remains authoritative');
  assertNoCleanupRepairs(task.snapshot().repairs, outcome.repairs);
}

{
  const successorSettlement = deferred();
  let attempt = 0;
  const { commands, calls } = fixture({
    invokeMutation: async () => {
      attempt += 1;
      if (attempt === 1) {
        throw Object.assign(new Error('proved refusal'), { effectCommitted: false });
      }
      return successorSettlement.promise;
    },
  });
  const predecessor = commands.start(command, { roomId: 'room-1' });
  const predecessorDone = predecessor.done;
  assert.equal((await predecessorDone).kind, 'failed', 'the predecessor settles before retry');

  let predecessorNotifications = 0;
  const unsubscribe = predecessor.subscribe(() => { predecessorNotifications += 1; });
  const notificationsBeforeRetry = predecessorNotifications;
  const successor = predecessor.retry();
  assert.notStrictEqual(successor, predecessor);
  assert.equal(successor.id, predecessor.id);
  assert.equal(successor.generation, predecessor.generation + 1);
  assert.notStrictEqual(successor.done, predecessorDone);

  let successorSettled = false;
  successor.done.then(() => { successorSettled = true; });
  while (calls.filter(({ kind }) => kind === 'mutation').length < 2) await Promise.resolve();
  await Promise.resolve();
  assert.equal(successorSettled, false, 'the successor owns a fresh unsettled done promise');
  successorSettlement.resolve('message-retried');
  assert.equal((await successor.done).kind, 'committed');
  assert.equal(predecessorNotifications, notificationsBeforeRetry);
  const mutationCalls = calls.filter(({ kind }) => kind === 'mutation');
  assert.equal(mutationCalls.length, 2, 'one mutation attempt runs in each generation');
  assert.equal(mutationCalls[0].options.clientMutationId, mutationCalls[1].options.clientMutationId);
  unsubscribe();
}

{
  const asset = controlledAssetTask();
  const mutationIds = [];
  let attempt = 0;
  const { commands } = fixture({
    task: asset,
    invokeMutation: async (_reference, _args, options) => {
      mutationIds.push(options.clientMutationId);
      attempt += 1;
      if (attempt === 1) throw new TypeError('socket closed without a receipt');
      return 'message-reconciled';
    },
  });
  const first = commands.start(command, { roomId: 'room-1', image: file });
  asset.publish(assetSnapshot('ready'));
  const firstOutcome = await first.done;
  assert.equal(firstOutcome.kind, 'ambiguous');
  assert.equal(firstOutcome.residue.unattached, 'unknown');
  assertNoCleanupRepairs(first.snapshot().repairs, firstOutcome.repairs);
  noAttachmentFactResidues.push(['unproved-settlement', firstOutcome.residue.unattached]);
  const successor = first.retry();
  assert.equal(successor.id, first.id);
  assert.equal(successor.generation, 1);
  assert.equal((await successor.done).kind, 'committed');
  assert.deepEqual(mutationIds, [mutationIds[0], mutationIds[0]], 'ambiguous retry reuses mutation identity');
}

{
  const asset = controlledAssetTask();
  const { commands, calls } = fixture({ task: asset });
  const task = commands.start(command, { roomId: 'room-1', image: file });
  while (task.snapshot().status === 'preparing') await Promise.resolve();
  await task.cancel();
  assert.equal((await task.done).kind, 'cancelled');
  await task.cancel();
  assert.equal(asset.cancelled, 1);
  assert.deepEqual(calls.map(({ kind }) => kind), ['asset']);
}

{
  const asset = controlledAssetTask();
  const { commands, calls } = fixture({ task: asset });
  const task = commands.start(command, { roomId: 'room-1', image: file });
  while (task.snapshot().status === 'preparing') await Promise.resolve();
  assert.equal(task.snapshot().status, 'transferring');
  assert.deepEqual(commands.inspection(), { activeCommandTasks: 1 });
  assert.equal(Object.isFrozen(commands.inspection()), true);

  const disposal = commands.dispose();
  assert.strictEqual(commands.dispose(), disposal, 'command client disposal is idempotent');
  const outcome = await settleWithin(
    task.done,
    'disposing a transferring command must settle its done promise',
  );
  await disposal;

  assert.equal(outcome.kind, 'failed');
  assert.equal(outcome.diagnostic.code, 'SNAPBACK_COMMAND_CLIENT_DISPOSED');
  assert.equal(outcome.diagnostic.details.phase, 'transferring');
  assert.equal(asset.cancelled, 1);
  assert.equal(task.snapshot().status, 'failed');
  assert.equal(task.snapshot().asset.status, 'cancelled');
  assert.equal(task.snapshot().mutation, null);
  assert.equal(task.snapshot().residue, null);
  assert.deepEqual(calls.map(({ kind }) => kind), ['asset']);
  assert.deepEqual(commands.inspection(), { activeCommandTasks: 0 });
}

{
  const asset = controlledAssetTask();
  const settlement = deferred();
  const { commands } = fixture({ task: asset, invokeMutation: () => settlement.promise });
  const task = commands.start(command, { roomId: 'room-1', image: file });
  asset.publish(assetSnapshot('ready'));
  while (task.snapshot().status !== 'committing') await Promise.resolve();
  assert.equal(commands.inspection().activeCommandTasks, 1);

  const disposal = commands.dispose();
  const outcome = await settleWithin(
    task.done,
    'disposing a committing command must settle its done promise',
  );
  await disposal;

  assert.equal(outcome.kind, 'ambiguous');
  assert.equal(outcome.diagnostic.code, 'SNAPBACK_COMMAND_CLIENT_DISPOSED_DURING_COMMIT');
  assert.equal(outcome.diagnostic.details.mutationAttemptId, task.snapshot().mutation.id);
  assert.equal(outcome.residue.unattached, 'unknown');
  assert.notEqual(outcome.residue.unattached, 'inferred');
  assert.equal(task.snapshot().status, 'ambiguous');
  assert.equal(task.snapshot().asset.status, 'ready');
  assert.equal(task.snapshot().mutation.status, 'pending');
  assert.equal(asset.cancelled, 0);
  assert.equal(commands.inspection().activeCommandTasks, 0);

  const terminal = task.snapshot();
  settlement.resolve('late-commit');
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.strictEqual(task.snapshot(), terminal);
  assert.strictEqual(await task.done, outcome);
}

{
  const asset = controlledAssetTask();
  const settlement = deferred();
  const { commands } = fixture({ task: asset, invokeMutation: () => settlement.promise });
  const task = commands.start(command, { roomId: 'room-1', image: file });
  asset.publish(assetSnapshot('ready'));
  while (task.snapshot().status !== 'committing') await Promise.resolve();
  await task.cancel();
  const terminal = task.snapshot();
  const outcome = await task.done;
  assert.equal(outcome.kind, 'ambiguous');
  assert.equal(outcome.diagnostic.code, 'SNAPBACK_COMMAND_CANCELLED_DURING_COMMIT');
  assert.equal(outcome.residue.unattached, 'unknown');
  assertNoCleanupRepairs(terminal.repairs, outcome.repairs);
  noAttachmentFactResidues.push(['cancel-during-commit', outcome.residue.unattached]);
  settlement.resolve('late-commit');
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.strictEqual(task.snapshot(), terminal);
  assert.strictEqual(await task.done, outcome);
}

{
  const asset = controlledAssetTask();
  let current = true;
  let mutations = 0;
  const { commands } = fixture({
    task: asset,
    current: () => current,
    invokeMutation: async () => { mutations += 1; return 'impossible'; },
  });
  const task = commands.start(command, { roomId: 'room-1', image: file });
  current = false;
  asset.publish(assetSnapshot('ready'));
  const outcome = await task.done;
  assert.equal(outcome.kind, 'failed');
  assert.equal(outcome.diagnostic.code, 'SNAPBACK_COMMAND_AUTHORITY_REPLACED');
  assert.equal(outcome.residue.unattached, 'unknown');
  assertNoCleanupRepairs(task.snapshot().repairs, outcome.repairs);
  noAttachmentFactResidues.push(['authority-replaced', outcome.residue.unattached]);
  assert.equal(mutations, 0, 'successor authority never adopts the predecessor task');
  const retry = task.retry();
  const retried = await retry.done;
  assert.equal(retried.kind, 'failed');
  assert.equal(retried.diagnostic.code, 'SNAPBACK_COMMAND_AUTHORITY_REPLACED');
  assert.equal(mutations, 0, 'retry revalidates the predecessor cohort instead of adopting the successor');
}

{
  const asset = controlledAssetTask();
  let mutations = 0;
  const externalClient = {
    authorityFence: null,
    bearerToken: 'predecessor-bearer',
    __authTransportGeneration: 4,
    __externalBearerTransition: null,
    captureAuthority: () => null,
    isAuthorityCaptureCurrent: (capture) => capture === null,
  };
  const commands = createCommandClient(externalClient, {
    assets: { start: () => asset },
    invokeMutation: async () => { mutations += 1; return 'impossible'; },
  });
  const task = commands.start(command, { roomId: 'room-1', image: file });
  externalClient.__authTransportGeneration = 5;
  asset.publish(assetSnapshot('ready'));
  const outcome = await task.done;
  assert.equal(outcome.kind, 'failed');
  assert.equal(outcome.diagnostic.code, 'SNAPBACK_COMMAND_AUTHORITY_REPLACED');
  assert.equal(outcome.residue.unattached, 'unknown');
  assert.equal(mutations, 0, 'external bearer replacement cannot adopt the command');
}

{
  const asset = controlledAssetTask();
  const { commands, calls } = fixture({ task: asset });
  const task = commands.start(command, { roomId: 'room-1', image: file });
  asset.publish(assetSnapshot('failed', {
    diagnostic: { code: 'SNAPBACK_AUTH_REQUIRED', message: 'session required' },
  }));
  const outcome = await task.done;
  assert.equal(outcome.kind, 'failed');
  assert.equal(outcome.diagnostic.code, 'SNAPBACK_AUTH_REQUIRED');
  assert.equal(outcome.residue, null);
  assert.equal(task.snapshot().residue, null);
  assertNoCleanupRepairs(task.snapshot().repairs, outcome.repairs);
  assert.deepEqual(calls.map(({ kind }) => kind), ['asset'], 'image refusal occurs at reservation/transfer boundary');
}

{
  const { commands, calls } = fixture();
  const task = commands.start(command, { roomId: 'room-1' });
  await task.cancel();
  assert.equal((await task.done).kind, 'cancelled');
  const refusal = task.retry();
  assert.equal((await refusal.done).kind, 'notRetryable');
  assert.strictEqual(refusal.snapshot(), task.snapshot());
  assert.equal(calls.filter(({ kind }) => kind === 'asset').length, 0);
  assert.equal(calls.filter(({ kind }) => kind === 'mutation').length, 0);
}

{
  noAttachmentFactResidues.sort(([left], [right]) => left.localeCompare(right));
  assert.deepEqual(noAttachmentFactResidues, [
    ['authority-replaced', 'unknown'],
    ['cancel-during-commit', 'unknown'],
    ['proved-refusal', 'inferred'],
    ['unproved-settlement', 'unknown'],
  ]);
  assert.ok(noAttachmentFactResidues.every(([, unattached]) => unattached !== 'authoritative'));
  const asset = controlledAssetTask();
  const { commands } = fixture({ task: asset });
  const task = commands.start(command, { roomId: 'room-1', image: file });
  asset.publish(assetSnapshot('failed', {
    diagnostic: { message: 'native binary transport rejected the body' },
  }));
  const outcome = await task.done;
  assert.equal(outcome.kind, 'failed');
  assert.equal(outcome.diagnostic.code, 'SNAPBACK_COMMAND_ASSET_FAILED');
  assert.equal(outcome.diagnostic.message, 'native binary transport rejected the body');
}

{
  const { commands } = fixture();
  const task = commands.start(command, { roomId: 'room-1', image: { path: '/transient/no-bytes' } });
  await assert.rejects(task.done, /File\/Blob-like structural source/u);
}

console.log('commands.test.mjs: command phase/outcome, retry, cancellation, residue, and authority cases passed');
