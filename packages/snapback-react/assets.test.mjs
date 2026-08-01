// React asset projection tests (LLP 0044 §Client upload surface, W1a):
// snapshot reactivity over the headless task, asset-id stability across
// retry, authority-change blanking with generation-fenced late events, the
// ThumbHash decode checked against the committed Rust vector, and the
// renderer ladder preview → placeholder → rendition.

import assert from 'node:assert/strict';
import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';

import { prepareReactBindingForClient } from '../snapback-client/react-binding.mjs';
import { resultContractHash } from '../snapback-codegen/result-contracts.mjs';
import {
  SnapbackProvider,
  createSnapbackReactProvider,
  placeholderToDataURL,
  thumbHashToApproximateAspectRatio,
  thumbHashToRGBA,
  useSnapbackAssetImage,
  useSnapbackAssetUpload,
} from './index.mjs';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const flush = () => new Promise((resolve) => setImmediate(resolve));

// The committed Rust encoder vectors (see
// packages/snapback-codegen/asset-thumbhash-vector.test.mjs and the pinned
// src/assets_image.rs test): solid #c82814 32x32, and a 64x32 landscape.
const SOLID_RED_VECTOR = 'FTsDBwAwZIZ3d4eHiGd3l4h3CIpjoDgG';
const LANDSCAPE_VECTOR = 'SBcGFIZwh3d0iHeHeHePiwi4hw';

const fixtureResultContract = Object.freeze({
  kind: 'records',
  record: Object.freeze({
    kind: 'object',
    fields: Object.freeze([
      Object.freeze({
        name: 'id',
        required: true,
        value: { kind: 'string', maxBytes: 1_024 },
      }),
    ]),
    allowExtra: false,
  }),
});

function reference(name) {
  return Object.freeze({
    artifactKind: 'functionReference',
    schemaVersion: 'snapback.v0',
    appId: 'asset-fixture',
    id: `asset-fixture:${name}`,
    name,
    kind: 'LiveQuery',
    implementationHash: `sha256:implementation-${name}`,
    argsContractHash: `sha256:args-${name}`,
    resultContractHash: resultContractHash(fixtureResultContract),
    resultContract: fixtureResultContract,
  });
}

const generatedManifest = Object.freeze({
  artifactKind: 'functionManifest',
  schemaVersion: 'snapback.v0',
  appId: 'asset-fixture',
  bundleHash: 'sha256:asset-fixture-bundle',
  functions: Object.freeze([reference('feed')]),
});

function createFakeClient() {
  const barriers = [];
  const client = {
    authProtocols: {},
    liveQuery() {},
    async inspect() {
      return {
        targetProfileId: 'local-dev-sqlite-ibex',
        target: 'local-dev-sqlite-ibex',
        schema: { schemaHash: 'sha256:schema' },
        functions: generatedManifest,
        capabilityManifest: {
          artifactKind: 'capabilityManifest',
          schemaVersion: 'snapback.v0',
          targetProfileId: 'local-dev-sqlite-ibex',
          supportedCapabilities: ['live_subscriptions'],
        },
      };
    },
    async authSession() { return { activeMode: 'dev' }; },
    registerAuthBarrierParticipant(participant) {
      barriers.push(participant);
      return async () => {};
    },
    async releaseConnection() { return { released: true }; },
  };
  return { client, barriers };
}

class FakeTask {
  #listeners = new Set();

  constructor(snapshot) {
    this.current = Object.freeze({
      assetId: 'asset-1',
      assetRef: 'asset-1',
      attemptId: 'attempt-1',
      attemptExpiresAtMs: null,
      status: 'creating',
      diagnostic: null,
      bytesTransferred: 0,
      totalBytes: 10,
      previewUrl: null,
      integrityBasis: 'end-to-end-verified',
      ...snapshot,
    });
    this.paused = false;
  }

  snapshot() { return this.current; }

  subscribe(listener) {
    this.#listeners.add(listener);
    listener(this.current);
    return () => this.#listeners.delete(listener);
  }

  emit(patch) {
    this.current = Object.freeze({ ...this.current, ...patch });
    for (const listener of [...this.#listeners]) listener(this.current);
  }

  pause() { this.paused = true; this.emit({ status: 'paused' }); }

  resume() { this.paused = false; this.emit({ status: 'uploading' }); }

  async cancel() { this.emit({ status: 'cancelled' }); return this.current; }

  async retry() {
    // Successor keeps the SAME asset id (0044: retry never re-identifies).
    const successor = new FakeTask({
      assetId: this.current.assetId,
      assetRef: this.current.assetId,
      attemptId: 'attempt-2',
      status: 'uploading',
    });
    this.retried = successor;
    return successor;
  }
}

function createFakeAssets() {
  const watchListeners = new Set();
  let watchSnapshot = Object.freeze({ status: 'connecting', record: null, mode: 'live' });
  const assets = {
    started: [],
    start({ upload, file }) {
      const task = new FakeTask({ totalBytes: file.size, status: 'uploading' });
      task.upload = upload;
      assets.started.push(task);
      return task;
    },
    resumePersisted() { return null; },
    deliveryUrl(assetId, { maxWidth }) {
      return `http://fixture/assets/records/${assetId}/bytes/best?maxWidth=${maxWidth}`;
    },
    watchStore() {
      return {
        getSnapshot: () => watchSnapshot,
        subscribe(listener) {
          watchListeners.add(listener);
          return () => watchListeners.delete(listener);
        },
        dispose() {},
      };
    },
    emitWatch(next) {
      watchSnapshot = Object.freeze(next);
      for (const listener of [...watchListeners]) listener(watchSnapshot);
    },
  };
  return assets;
}

const file = Object.freeze({
  size: 10,
  slice: () => ({ arrayBuffer: async () => new ArrayBuffer(10) }),
});

async function harness() {
  const { client, barriers } = createFakeClient();
  const binding = await prepareReactBindingForClient(client, { generatedManifest });
  const assets = createFakeAssets();
  const provider = createSnapbackReactProvider(binding, { assets });
  return { provider, assets, barriers };
}

function renderHook(provider, hook) {
  const output = { current: null };
  function Probe() {
    output.current = hook();
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
  return { output, renderer };
}

// --- upload hook reactivity, retry stability, blanking ---------------------

{
  const { provider, assets } = await harness();
  const upload = { artifactKind: 'assetUploadReference', name: 'avatarUpload' };
  const { output, renderer } = renderHook(
    provider,
    () => useSnapbackAssetUpload({ upload }),
  );
  assert.equal(output.current.state.status, 'idle');

  let task;
  act(() => { task = output.current.start(file); });
  assert.equal(output.current.state.status, 'uploading');
  assert.equal(output.current.state.assetId, 'asset-1');
  assert.equal(assets.started.length, 1);
  assert.equal(assets.started[0].upload, upload);

  act(() => { task.emit({ bytesTransferred: 6 }); });
  assert.equal(output.current.state.bytesTransferred, 6);

  act(() => { output.current.pause(); });
  assert.equal(output.current.state.status, 'paused');
  act(() => { output.current.resume(); });
  assert.equal(output.current.state.status, 'uploading');

  // Retry adopts the successor; the asset id never changes.
  await act(async () => { await output.current.retry(); await flush(); });
  assert.equal(output.current.state.attemptId, 'attempt-2');
  assert.equal(output.current.state.assetId, 'asset-1');

  const successor = task.retried;
  act(() => { successor.emit({ status: 'ready' }); });
  assert.equal(output.current.state.status, 'ready');

  act(() => { renderer.unmount(); });
  console.log('asset upload hook reactivity, retry stability: ok');
}

{
  const { provider, barriers } = await harness();
  const upload = { artifactKind: 'assetUploadReference', name: 'avatarUpload' };
  const { output, renderer } = renderHook(
    provider,
    () => useSnapbackAssetUpload({ upload }),
  );
  let task;
  act(() => { task = output.current.start(file); });
  assert.equal(output.current.state.status, 'uploading');

  // Authority replacement blanks synchronously; the asset barrier
  // participant is registered beside the registry's own.
  const assetBarrier = barriers.find((entry) => entry.name.startsWith('snapback-react-assets:'));
  assert.ok(assetBarrier, 'asset barrier participant must register');
  act(() => { assetBarrier.blank(); });
  assert.equal(output.current.state.status, 'blanked');
  assert.equal(output.current.state.assetId, null);

  // A late event from the orphaned task is generation-fenced.
  act(() => { task.emit({ status: 'ready' }); });
  assert.equal(output.current.state.status, 'blanked');

  act(() => { renderer.unmount(); });
  console.log('asset upload authority blanking + generation fence: ok');
}

// --- ThumbHash decode against the committed Rust vector --------------------

{
  const bytes = Uint8Array.from(Buffer.from(SOLID_RED_VECTOR, 'base64'));
  const { w, h, rgba } = thumbHashToRGBA(bytes);
  assert.ok(w >= 3 && h >= 3 && w <= 32 && h <= 32);
  // Every pixel of the solid-red vector must decode red-dominant + opaque.
  for (let i = 0; i < w * h * 4; i += 4) {
    assert.ok(rgba[i] > rgba[i + 1], `red > green at ${i}`);
    assert.ok(rgba[i] > rgba[i + 2], `red > blue at ${i}`);
    assert.equal(rgba[i + 3], 255, `opaque at ${i}`);
  }
  const dataUrl = placeholderToDataURL(SOLID_RED_VECTOR);
  assert.ok(dataUrl.startsWith('data:image/png;base64,'));
  // The PNG must round-trip its signature bytes.
  const png = Buffer.from(dataUrl.slice('data:image/png;base64,'.length), 'base64');
  assert.deepEqual([...png.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  assert.ok(
    thumbHashToApproximateAspectRatio(
      Uint8Array.from(Buffer.from(LANDSCAPE_VECTOR, 'base64')),
    ) > 1,
  );
  console.log('thumbhash decode vs committed Rust vectors: ok');
}

// --- renderer ladder -------------------------------------------------------

{
  const { provider, assets } = await harness();
  const { output, renderer } = renderHook(
    provider,
    () => useSnapbackAssetImage({
      assetId: 'asset-9',
      placeholder: SOLID_RED_VECTOR,
      previewUrl: 'blob:preview-1',
      maxWidth: 256,
    }),
  );
  await act(async () => { await flush(); });
  // Preview wins while present and the record is not ready.
  assert.equal(output.current.phase, 'preview');
  assert.equal(output.current.src, 'blob:preview-1');

  // Readiness over the watch store flips to the delivered rendition.
  act(() => {
    assets.emitWatch({
      status: 'ready',
      record: { assetId: 'asset-9', availability: 'ready' },
      mode: 'live',
    });
  });
  assert.equal(output.current.phase, 'rendition');
  assert.equal(
    output.current.src,
    'http://fixture/assets/records/asset-9/bytes/best?maxWidth=256',
  );

  // Blanking (denial/deletion) empties the ladder.
  act(() => { assets.emitWatch({ status: 'blank', record: null, mode: 'live' }); });
  assert.equal(output.current.phase, 'empty');
  assert.equal(output.current.src, null);

  act(() => { renderer.unmount(); });
  console.log('asset renderer ladder preview → rendition → blank: ok');
}

{
  const { provider } = await harness();
  const { output, renderer } = renderHook(
    provider,
    () => useSnapbackAssetImage({ placeholder: SOLID_RED_VECTOR }),
  );
  assert.equal(output.current.phase, 'placeholder');
  assert.ok(output.current.src.startsWith('data:image/png;base64,'));
  assert.ok(Math.abs(output.current.aspectRatio - 1) < 0.35);
  act(() => { renderer.unmount(); });
  console.log('asset renderer placeholder-only ladder: ok');
}

// --- server-provided placeholder (the record view's media block) -----------

{
  const { provider, assets } = await harness();
  const { output, renderer } = renderHook(
    provider,
    () => useSnapbackAssetImage({ assetId: 'asset-11', maxWidth: 128 }),
  );
  await act(async () => { await flush(); });
  // No prop placeholder: idle until the watched record supplies one.
  assert.equal(output.current.phase, 'empty');
  // A pending record carrying media.placeholder renders the server
  // placeholder with no prop involved.
  act(() => {
    assets.emitWatch({
      status: 'ready',
      record: {
        assetId: 'asset-11',
        availability: 'pending',
        media: { placeholder: { algo: 'thumbhash.v1', value: SOLID_RED_VECTOR } },
      },
      mode: 'live',
    });
  });
  assert.equal(output.current.phase, 'placeholder');
  assert.ok(output.current.src.startsWith('data:image/png;base64,'));
  // Readiness keeps the server placeholder as the rendition underlay.
  act(() => {
    assets.emitWatch({
      status: 'ready',
      record: {
        assetId: 'asset-11',
        availability: 'ready',
        media: { placeholder: { algo: 'thumbhash.v1', value: SOLID_RED_VECTOR } },
      },
      mode: 'live',
    });
  });
  assert.equal(output.current.phase, 'rendition');
  assert.ok(output.current.placeholderSrc.startsWith('data:image/png;base64,'));
  assert.ok(Math.abs(output.current.aspectRatio - 1) < 0.35);
  // An unknown algorithm is ignored, never mis-decoded.
  act(() => {
    assets.emitWatch({
      status: 'ready',
      record: {
        assetId: 'asset-11',
        availability: 'pending',
        media: { placeholder: { algo: 'blurhash.v9', value: 'nonsense' } },
      },
      mode: 'live',
    });
  });
  assert.equal(output.current.phase, 'empty');
  act(() => { renderer.unmount(); });
  console.log('asset renderer server-provided placeholder: ok');
}

console.log('assets.test.mjs passed');
process.exit(0);
