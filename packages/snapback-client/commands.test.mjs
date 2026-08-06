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

function fixture({ task = null, invokeMutation, current = () => true } = {}) {
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
    invokeMutation: async (reference, args, options) => {
      calls.push({ kind: 'mutation', reference, args: { ...args }, options });
      return invokeMutation?.(reference, args, options) ?? 'message-1';
    },
  });
  return { commands, calls };
}

{
  const { commands, calls } = fixture();
  const task = commands.start(command, { roomId: 'room-1', body: 'hello' });
  const outcome = await task.done;
  assert.deepEqual(outcome, { kind: 'committed', result: 'message-1' });
  assert.equal(task.snapshot().status, 'succeeded');
  assert.deepEqual(calls.map(({ kind }) => kind), ['mutation']);
  assert.deepEqual(calls[0].args, { roomId: 'room-1', body: 'hello' });
  assert.equal((await task.retry().done).kind, 'notRetryable');
}

{
  const asset = controlledAssetTask();
  const { commands, calls } = fixture({ task: asset });
  const task = commands.start(command, { roomId: 'room-1', image: file });
  await Promise.resolve();
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
  assert.equal(outcome.residue.unattached, 'inferred');
  assert.match(outcome.residue.basis, /global absence is inferred/u);
  assert.equal(outcome.repairs[0].kind, 'retryCommand');
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
  const successor = first.retry();
  assert.equal(successor.id, first.id);
  assert.equal(successor.generation, 1);
  assert.equal((await successor.done).kind, 'committed');
  assert.deepEqual(mutationIds, [mutationIds[0], mutationIds[0]], 'ambiguous retry reuses mutation identity');
}

{
  const asset = controlledAssetTask();
  const { commands } = fixture({ task: asset });
  const task = commands.start(command, { roomId: 'room-1', image: file });
  await Promise.resolve();
  await task.cancel();
  assert.equal((await task.done).kind, 'cancelled');
  assert.equal(asset.cancelled, 1);
}

{
  const asset = controlledAssetTask();
  const settlement = deferred();
  const { commands } = fixture({ task: asset, invokeMutation: () => settlement.promise });
  const task = commands.start(command, { roomId: 'room-1', image: file });
  asset.publish(assetSnapshot('ready'));
  while (task.snapshot().status !== 'committing') await Promise.resolve();
  await task.cancel();
  assert.equal((await task.done).kind, 'ambiguous');
  assert.equal(task.snapshot().residue.unattached, 'unknown');
  settlement.resolve('late-commit');
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
  assert.deepEqual(calls.map(({ kind }) => kind), ['asset'], 'image refusal occurs at reservation/transfer boundary');
}

{
  const { commands } = fixture();
  const task = commands.start(command, { roomId: 'room-1', image: { path: '/transient/no-bytes' } });
  await assert.rejects(task.done, /File\/Blob-like structural source/u);
}

console.log('commands.test.mjs: command phase/outcome, retry, cancellation, residue, and authority cases passed');
