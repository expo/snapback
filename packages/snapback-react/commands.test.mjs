import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';

import { prepareReactBindingForClient } from '../snapback-client/react-binding.mjs';
import {
  SnapbackProvider,
  bindSnapbackSurface,
  createSnapbackReactProvider,
  invokeSnapbackCommand,
  useSnapbackCommand,
} from './index.mjs';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const fixtureRoot = new URL('./fixtures/conversation/app/snapback/generated/', import.meta.url);
const json = (name) => JSON.parse(readFileSync(new URL(name, fixtureRoot)));
const app = json('app.descriptor.json');
const functions = json('functions.manifest.json');
const schema = json('schema.manifest.json');
const capabilityManifest = json('capability.manifest.json');
const mediaFixtureRoot = new URL(
  '../../tests/acceptance/fixtures/media-profile/snapback/generated/',
  import.meta.url,
);
const mediaJson = (name) => JSON.parse(readFileSync(new URL(name, mediaFixtureRoot)));
const mediaApp = mediaJson('app.descriptor.json');
const mediaFunctions = mediaJson('functions.manifest.json');
const mediaSchema = mediaJson('schema.manifest.json');
const mediaCapabilityManifest = mediaJson('capability.manifest.json');
const file = Object.freeze({
  size: 4,
  slice() { return { async arrayBuffer() { return new ArrayBuffer(4); } }; },
});
const pickerSource = Object.freeze({
  uri: 'content://media/external/images/media/42',
  fileName: 'picked.png',
  mimeType: 'image/png',
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

function readyAssetTask(assetId = 'asset-command-1') {
  const snapshot = Object.freeze({
    assetId,
    assetRef: assetId,
    attemptId: `attempt-${assetId}`,
    attemptExpiresAtMs: null,
    status: 'ready',
    diagnostic: null,
    bytesTransferred: 4,
    totalBytes: 4,
    previewUrl: null,
    integrityBasis: 'end-to-end-verified',
  });
  return Object.freeze({
    done: Promise.resolve(snapshot),
    snapshot: () => snapshot,
    subscribe(listener) { listener(snapshot); return () => {}; },
    async cancel() { return snapshot; },
    async retry() { throw new Error('not used'); },
  });
}

function transferringAssetTask() {
  const terminal = deferred();
  const listeners = new Set();
  let cancelled = 0;
  let snapshot = Object.freeze({
    assetId: 'asset-command-disposal',
    assetRef: null,
    attemptId: 'attempt-command-disposal',
    attemptExpiresAtMs: null,
    status: 'uploading',
    diagnostic: null,
    bytesTransferred: 1,
    totalBytes: 4,
    previewUrl: null,
    integrityBasis: 'end-to-end-verified',
  });
  const publish = (next) => {
    snapshot = Object.freeze(next);
    for (const listener of [...listeners]) listener(snapshot);
    if (['ready', 'rejected', 'cancelled', 'failed'].includes(snapshot.status)) {
      terminal.resolve(snapshot);
    }
  };
  return {
    done: terminal.promise,
    snapshot: () => snapshot,
    subscribe(listener) { listeners.add(listener); listener(snapshot); return () => listeners.delete(listener); },
    async cancel() {
      cancelled += 1;
      publish({ ...snapshot, status: 'cancelled' });
      return snapshot;
    },
    async retry() { throw new Error('not used'); },
    get cancelled() { return cancelled; },
  };
}

function fakeClient({ assetTask = null } = {}) {
  const mutations = [];
  const assets = [];
  const capture = Object.freeze({ generation: 1 });
  const client = {
    authProtocols: {},
    liveQuery() {},
    captureAuthority: () => capture,
    isAuthorityCaptureCurrent: (candidate) => candidate === capture,
    async inspect() {
      return {
        targetProfileId: 'local-dev-sqlite-ibex',
        target: 'local-dev-sqlite-ibex',
        schema,
        functions,
        capabilityManifest,
      };
    },
    async authSession() { return { activeMode: 'sessions' }; },
    registerAuthBarrierParticipant() { return async () => {}; },
    async releaseConnection() { return { released: true }; },
    async mutate(reference, options) {
      mutations.push({ reference, options });
      return { result: { messageId: `message-${mutations.length}` }, version: mutations.length };
    },
  };
  return {
    client,
    mutations,
    assets,
    assetClient: {
      start(options) {
        assets.push(options);
        return assetTask ?? readyAssetTask();
      },
    },
  };
}

function matchesDiagnosticCode(expected) {
  return (error) => {
    assert.equal(error.code, expected);
    assert.equal(error.diagnostic.code, expected);
    return true;
  };
}

const fixture = fakeClient();
const binding = await prepareReactBindingForClient(fixture.client, { generatedManifest: app });
assert.strictEqual(binding.commands.send.mutation, binding.references.sendMessage);
const provider = createSnapbackReactProvider(binding, {
  assets: fixture.assetClient,
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

const tamperedCommand = structuredClone(app.commands.send);
tamperedCommand.passthroughArgs = [...tamperedCommand.passthroughArgs, 'tampered'];
assert.throws(
  () => invokeSnapbackCommand(provider, tamperedCommand, {}),
  matchesDiagnosticCode('SNAPBACK_REACT_COMMAND_INVALID'),
);

const foreignApp = structuredClone(app);
foreignApp.identity.descriptor = `sha256:${'f'.repeat(64)}`;
const foreignPassthroughArgs = [...foreignApp.commands.send.passthroughArgs].reverse();
foreignApp.commands.send.passthroughArgs = foreignPassthroughArgs;
foreignApp.surfaces.conversation.commands.send.reference.passthroughArgs = [...foreignPassthroughArgs];
const foreignFixture = fakeClient();
const foreignBinding = await prepareReactBindingForClient(
  foreignFixture.client,
  { generatedManifest: foreignApp },
);
assert.throws(
  () => invokeSnapbackCommand(provider, foreignBinding.commands.send, {}),
  matchesDiagnosticCode('SNAPBACK_REACT_COMMAND_INVALID'),
);

const hook = { current: null };
function Probe() {
  hook.current = useSnapbackCommand(app.commands.send);
  return null;
}
let renderer;
act(() => {
  renderer = TestRenderer.create(
    React.createElement(
      SnapbackProvider,
      { provider },
      React.createElement(Probe),
    ),
  );
});

const direct = hook.current({
  conversationId: 'conversation-one',
  senderId: 'user-ada',
  body: 'text only',
});
assert.deepEqual(await direct.done, {
  kind: 'committed',
  result: { messageId: 'message-1' },
});
assert.equal(fixture.assets.length, 0);

const surface = bindSnapbackSurface(
  provider,
  app.surfaces.conversation,
  { conversationId: 'conversation-one' },
  { presence: {} },
);
assert.strictEqual(surface.commands.send, surface.snapshot().commands.send);
const mutationCountBeforeInvalidInput = fixture.mutations.length;
const assetCountBeforeInvalidInput = fixture.assets.length;
assert.throws(
  () => surface.commands.send({ conversationId: 'conversation-two', body: 'invalid rebind' }),
  matchesDiagnosticCode('SNAPBACK_REACT_SURFACE_INPUT_INVALID'),
);
assert.equal(fixture.mutations.length, mutationCountBeforeInvalidInput);
assert.equal(fixture.assets.length, assetCountBeforeInvalidInput);

const imageWithoutBody = surface.commands.send({ image: pickerSource });
assert.equal((await imageWithoutBody.done).kind, 'committed');
assert.equal(Object.hasOwn(fixture.mutations.at(-1).options.args, 'body'), false);

const mutationCountBeforeUndefinedBody = fixture.mutations.length;
const assetCountBeforeUndefinedBody = fixture.assets.length;
assert.throws(
  () => surface.commands.send({ body: undefined, image: pickerSource }),
  matchesDiagnosticCode('SNAPBACK_REACT_ARGS_INVALID'),
);
assert.equal(fixture.mutations.length, mutationCountBeforeUndefinedBody);
assert.equal(fixture.assets.length, assetCountBeforeUndefinedBody);

const image = surface.commands.send({ body: 'with image', image: pickerSource });
assert.equal((await image.done).kind, 'committed');
assert.equal(fixture.assets.length, 2);
assert.strictEqual(fixture.assets.at(-1).authorityCapture, fixture.mutations.at(-1).options.authorityCapture);
assert.equal(fixture.assets.at(-1).declaredFilename, pickerSource.fileName);
assert.equal(fixture.assets.at(-1).declaredContentType, pickerSource.mimeType);
assert.equal(fixture.assets.at(-1).previewUrl, pickerSource.uri);
assert.deepEqual({ ...fixture.mutations.at(-1).options.args }, {
  conversationId: 'conversation-one',
  senderId: 'user-ada',
  body: 'with image',
  image: 'asset-command-1',
});
assert.equal(fixture.mutations.at(-1).options.queue, false);

await surface.dispose();
act(() => renderer.unmount());
await provider.dispose();

const disposalAsset = transferringAssetTask();
const disposalFixture = fakeClient({ assetTask: disposalAsset });
const disposalBinding = await prepareReactBindingForClient(
  disposalFixture.client,
  { generatedManifest: app },
);
const disposalProvider = createSnapbackReactProvider(disposalBinding, {
  assets: disposalFixture.assetClient,
});
const disposalTask = invokeSnapbackCommand(disposalProvider, disposalBinding.commands.send, {
  conversationId: 'conversation-disposal',
  senderId: 'user-ada',
  body: 'dispose during transfer',
  image: file,
});
while (disposalTask.snapshot().status === 'preparing') await Promise.resolve();
assert.equal(disposalTask.snapshot().status, 'transferring');
assert.equal(disposalProvider.inspection().commandTasks, 1);

const disposalDone = disposalTask.done;
await disposalProvider.dispose();
const disposalOutcome = await settleWithin(
  disposalDone,
  'provider disposal must settle an in-flight command task',
);
assert.equal(disposalOutcome.kind, 'failed');
assert.equal(disposalOutcome.diagnostic.code, 'SNAPBACK_COMMAND_CLIENT_DISPOSED');
assert.equal(disposalAsset.cancelled, 1);
assert.equal(disposalTask.snapshot().asset.status, 'cancelled');
assert.equal(disposalProvider.inspection().commandTasks, 0);
assert.equal(disposalFixture.mutations.length, 0);

await assert.rejects(
  disposalProvider.registry.runCommandMutation(
    disposalBinding.references.sendMessage,
    { conversationId: 'conversation-disposal', senderId: 'user-ada', body: 'closed' },
    { clientMutationId: 'closed-provider-attempt', authorityCapture: null },
  ),
  (error) => {
    assert.equal(error.code, 'SNAPBACK_REACT_PROVIDER_CLOSED');
    assert.equal(error.diagnostic.code, 'SNAPBACK_REACT_PROVIDER_CLOSED');
    assert.equal(error.diagnostic.details.effectCommitted, false);
    return true;
  },
);

// Real generated media-command descriptors project through both the hook and
// imperative React seams while retaining the one headless command owner.
{
  const mutations = [];
  const assetStarts = [];
  const capture = Object.freeze({ generation: 'media-react-1' });
  const mediaClient = {
    authProtocols: {},
    liveQuery() {},
    captureAuthority: () => capture,
    isAuthorityCaptureCurrent: (candidate) => candidate === capture,
    async inspect() {
      return {
        targetProfileId: 'local-dev-sqlite-ibex',
        target: 'local-dev-sqlite-ibex',
        schema: mediaSchema,
        functions: mediaFunctions,
        capabilityManifest: mediaCapabilityManifest,
      };
    },
    async authSession() { return { activeMode: 'sessions' }; },
    registerAuthBarrierParticipant() { return async () => {}; },
    async releaseConnection() { return { released: true }; },
    async mutate(reference, options) {
      mutations.push({ reference, options });
      const table = reference.name === 'createPostMutation' ? 'post' : 'message';
      return { result: { _id: `${table}-${mutations.length}` }, version: mutations.length };
    },
  };
  const mediaBinding = await prepareReactBindingForClient(
    mediaClient,
    { generatedManifest: mediaApp },
  );
  let assetSequence = 0;
  const mediaProvider = createSnapbackReactProvider(mediaBinding, {
    assets: {
      start(options) {
        const assetId = `asset-media-react-${assetSequence}`;
        assetSequence += 1;
        assetStarts.push({ assetId, options });
        return readyAssetTask(assetId);
      },
    },
  });
  let createPost;
  function MediaCommandProbe() {
    createPost = useSnapbackCommand(mediaApp.commands.createPost);
    return null;
  }
  let mediaRenderer;
  act(() => {
    mediaRenderer = TestRenderer.create(React.createElement(
      SnapbackProvider,
      { provider: mediaProvider },
      React.createElement(MediaCommandProbe),
    ));
  });
  let postAssetOffset = 0;
  for (const count of [1, 2, 3, 4]) {
    const postTask = createPost({
      body: `${count}-item image/video web post`,
      media: Array.from({ length: count }, () => file),
    });
    assert.equal((await postTask.done).kind, 'committed');
    assert.equal(postTask.snapshot().status, 'committed');
    assert.deepEqual(
      postTask.snapshot().items.map(({ ordinal }) => ordinal),
      Array.from({ length: count }, (_, ordinal) => ordinal),
    );
    const expectedItems = Array.from({ length: count }, (_, ordinal) => ({
      ordinal,
      assetId: `asset-media-react-${postAssetOffset + ordinal}`,
    }));
    assert.deepEqual(mutations.at(-1).options.args.assetIds, expectedItems.map(({ assetId }) => assetId));
    assert.deepEqual(mutations.at(-1).options.mediaCommand.items, expectedItems);
    postAssetOffset += count;
  }

  const messageTask = invokeSnapbackCommand(
    mediaProvider,
    mediaApp.commands.sendMessage,
    {
      conversationId: 'conversation-media',
      text: 'multi-media message',
      media: [file, file, file],
      recipients: ['principal-recipient'],
    },
  );
  assert.equal((await messageTask.done).kind, 'committed');
  assert.equal(messageTask.snapshot().items.length, 3);
  assert.deepEqual(mutations.at(-1).options.mediaCommand.principals, ['principal-recipient']);
  assert.equal(assetStarts.length, 13);
  assert.equal(
    assetStarts.every(({ options }) => options.upload.name === 'sharedMediaUpload'),
    true,
  );
  assert.equal(
    assetStarts.every(({ options }) => options.authorityCapture === capture),
    true,
  );
  act(() => mediaRenderer.unmount());
  await mediaProvider.dispose();
}

console.log('commands.test.mjs: hook/surface commands and provider disposal share command ownership');
