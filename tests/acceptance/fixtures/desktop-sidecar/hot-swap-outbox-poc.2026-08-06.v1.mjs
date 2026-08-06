#!/usr/bin/env node

// Bounded LLP 0129 Phase-2b design-spike witness. It characterizes the
// existing client/store seam; it does not implement sidecar hot swap.
//
// @ref LLP 0008#decision-dk-9--client-local-store-mandate-2026-07-02 —
//   independently constructed clients serialize through one store owner.

import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { SnapbackClient } from '../../../../packages/snapback-client/index.mjs';
import { createFileRqsResumeStore } from '../../../../packages/snapback-client/rqs-store-file.mjs';

const scratch = await mkdtemp(join(tmpdir(), 'snapback-hot-swap-outbox-poc-'));
const originalFetch = globalThis.fetch;
const stores = [];

try {
  // Case 1: records have no client-instance binding. A fresh client pointed
  // at another transport origin can replay through the same injected store.
  const sharedStore = createFileRqsResumeStore({
    directory: join(scratch, 'shared'),
    identity: 'app:desktop-sidecar',
  });
  stores.push(sharedStore);
  await sharedStore.whenLockSettled();
  const oldClient = new SnapbackClient('http://127.0.0.1:41001', {
    rqsStore: sharedStore,
    offlineQueue: true,
  });
  globalThis.fetch = async () => { throw new TypeError('old origin unavailable'); };
  const sharedQueued = await oldClient.mutate('createThing', {
    args: { title: 'pending' },
  });
  const freshClient = new SnapbackClient('http://127.0.0.1:41002', {
    rqsStore: sharedStore,
    offlineQueue: true,
  });
  const freshClientVisible = (await freshClient.rqsStore.outboxPending())
    .map((record) => record.id);
  const deliveries = [];
  globalThis.fetch = async (url, init) => {
    const body = JSON.parse(init.body);
    deliveries.push({ url, clientMutationId: body.clientMutationId });
    return Response.json({
      result: { ok: true },
      version: 1,
      authorityDescriptor: null,
    });
  };
  const sharedReplay = await freshClient.replayQueuedMutations();
  assert.deepEqual(freshClientVisible, [sharedQueued.clientMutationId]);
  assert.equal(deliveries[0].url, 'http://127.0.0.1:41002/mutation/createThing');
  assert.equal(deliveries[0].clientMutationId, sharedQueued.clientMutationId);
  assert.equal(sharedReplay.replayed, 1);
  assert.equal(sharedReplay.remaining, 0);

  // Case 2: the default Node/file store is keyed by the full server origin,
  // including port. A candidate on another ephemeral port selects a distinct
  // blob and therefore has an honestly empty pending view.
  process.env.SNAPBACK_CLIENT_RQS_DIR = join(scratch, 'default-by-origin');
  process.env.SNAPBACK_CLIENT_RQS_GC = 'off';
  globalThis.fetch = async () => { throw new TypeError('old origin unavailable'); };
  const defaultOld = new SnapbackClient('http://127.0.0.1:42001', {
    offlineQueue: true,
  });
  stores.push(defaultOld.rqsStore);
  await defaultOld.rqsStore.whenLockSettled();
  const defaultQueued = await defaultOld.mutate('createThing', {
    args: { title: 'pending' },
  });
  const defaultNew = new SnapbackClient('http://127.0.0.1:42002', {
    offlineQueue: true,
  });
  stores.push(defaultNew.rqsStore);
  await defaultNew.rqsStore.whenLockSettled();
  const oldOriginPending = (await defaultOld.rqsStore.outboxPending())
    .map((record) => record.id);
  const newOriginPending = (await defaultNew.rqsStore.outboxPending())
    .map((record) => record.id);
  assert.deepEqual(oldOriginPending, [defaultQueued.clientMutationId]);
  assert.deepEqual(newOriginPending, []);

  // Case 3: a second store instance over the same identity can read pending
  // work, but replay is writer-fenced until the predecessor releases custody.
  const writerDirectory = join(scratch, 'writer-handoff');
  const firstStore = createFileRqsResumeStore({
    directory: writerDirectory,
    identity: 'app:desktop-sidecar',
  });
  stores.push(firstStore);
  await firstStore.whenLockSettled();
  await firstStore.outboxEnqueue({
    id: 'cm_writer_handoff',
    function: 'createThing',
    args: {},
  });
  const secondStore = createFileRqsResumeStore({
    directory: writerDirectory,
    identity: 'app:desktop-sidecar',
  });
  stores.push(secondStore);
  await secondStore.whenLockSettled();
  const readerPending = (await secondStore.outboxPending()).map((record) => record.id);
  const readerClient = new SnapbackClient('http://127.0.0.1:43002', {
    rqsStore: secondStore,
    offlineQueue: true,
  });
  const readerReplay = await readerClient.replayQueuedMutations();
  assert.deepEqual(readerPending, ['cm_writer_handoff']);
  assert.equal(secondStore.isWriter(), false);
  assert.equal(readerReplay.stopped, true);
  await firstStore.close();
  await secondStore.whenLockSettled();
  assert.equal(secondStore.isWriter(), true);

  console.log(JSON.stringify({
    schemaVersion: 'snapback.hot-swap-outbox-poc.v1',
    status: 'PASS',
    sharedInjectedStore: {
      freshClientVisible,
      deliveredTo: deliveries[0].url,
      preservedClientMutationId: deliveries[0].clientMutationId,
      replay: sharedReplay,
    },
    defaultStoreAcrossOrigins: {
      oldOriginPending,
      newOriginPending,
      oldWriter: defaultOld.rqsStore.isWriter(),
      newWriter: defaultNew.rqsStore.isWriter(),
    },
    sameIdentityWriterHandoff: {
      readerPending,
      writerBeforeRelease: false,
      replayBeforeRelease: readerReplay,
      writerAfterRelease: secondStore.isWriter(),
    },
  }, null, 2));
} finally {
  globalThis.fetch = originalFetch;
  for (const store of stores.reverse()) {
    try { await store?.close(); } catch { /* bounded temp cleanup */ }
  }
  await rm(scratch, { recursive: true, force: true });
}
