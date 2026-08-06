import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';

import { prepareReactBindingForClient } from '../snapback-client/react-binding.mjs';
import {
  SnapbackProvider,
  bindSnapbackSurface,
  createSnapbackReactProvider,
  useSnapbackCommand,
} from './index.mjs';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const fixtureRoot = new URL('./fixtures/conversation/app/snapback/generated/', import.meta.url);
const json = (name) => JSON.parse(readFileSync(new URL(name, fixtureRoot)));
const app = json('app.descriptor.json');
const functions = json('functions.manifest.json');
const schema = json('schema.manifest.json');
const capabilityManifest = json('capability.manifest.json');
const file = Object.freeze({
  size: 4,
  slice() { return { async arrayBuffer() { return new ArrayBuffer(4); } }; },
});

function readyAssetTask() {
  const snapshot = Object.freeze({
    assetId: 'asset-command-1',
    assetRef: 'asset-command-1',
    attemptId: 'attempt-command-1',
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

function fakeClient() {
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
        return readyAssetTask();
      },
    },
  };
}

const fixture = fakeClient();
const binding = await prepareReactBindingForClient(fixture.client, { generatedManifest: app });
assert.strictEqual(binding.commands.send.mutation, binding.references.sendMessage);
const provider = createSnapbackReactProvider(binding, { assets: fixture.assetClient });

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
const image = surface.commands.send({ body: 'with image', image: file });
assert.equal((await image.done).kind, 'committed');
assert.equal(fixture.assets.length, 1);
assert.strictEqual(fixture.assets[0].authorityCapture, fixture.mutations[1].options.authorityCapture);
assert.deepEqual(fixture.mutations[1].options.args, {
  conversationId: 'conversation-one',
  senderId: 'user-ada',
  body: 'with image',
  image: 'asset-command-1',
});
assert.equal(fixture.mutations[1].options.queue, false);

await surface.dispose();
act(() => renderer.unmount());
await provider.dispose();

console.log('commands.test.mjs: hook and surface commands share the provider-owned command children');
