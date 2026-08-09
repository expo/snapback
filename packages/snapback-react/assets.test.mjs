// React asset projection tests (LLP 0044 §Client upload surface, W1a):
// issued-URL external-store projection, snapshot reactivity over the headless
// task, asset-id stability across retry, authority-change blanking with
// generation-fenced late events, the ThumbHash decode checked against the
// committed Rust vector, and the renderer ladder preview → placeholder →
// rendition.

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
  useSnapbackAssetUrl,
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

function createFakeClient(activeMode = 'dev') {
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
    async authSession() { return { activeMode }; },
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

const FAKE_ISSUED_URL_CONSTRUCTION_SNAPSHOT = Object.freeze({
  url: null,
  status: 'issuing',
  diagnostic: null,
});

class FakeIssuedUrlStore {
  listeners = new Set();
  snapshot = FAKE_ISSUED_URL_CONSTRUCTION_SNAPSHOT;
  subscribeCalls = 0;
  unsubscribeCalls = 0;
  issuanceLoops = 0;
  refreshCalls = 0;

  getSnapshot = () => this.snapshot;
  getServerSnapshot = () => FAKE_ISSUED_URL_CONSTRUCTION_SNAPSHOT;

  subscribe = (listener) => {
    this.subscribeCalls += 1;
    if (this.listeners.size === 0) this.issuanceLoops += 1;
    this.listeners.add(listener);
    let subscribed = true;
    return () => {
      if (!subscribed) return;
      subscribed = false;
      this.unsubscribeCalls += 1;
      this.listeners.delete(listener);
    };
  };

  refresh = async () => {
    this.refreshCalls += 1;
  };

  publish(next) {
    this.snapshot = Object.freeze(next);
    for (const listener of [...this.listeners]) listener();
  }
}

function createFakeAssets() {
  const watchListeners = new Set();
  let watchSnapshot = Object.freeze({ status: 'connecting', record: null, mode: 'live' });
  const issuedUrlStores = new Map();
  const issuedUrlKey = (assetId, options = {}) => JSON.stringify([
    assetId,
    options.variant ?? null,
    options.widthPx ?? null,
    options.ttlMs ?? null,
  ]);
  const assets = {
    started: [],
    issuedUrlStoreCalls: 0,
    get issuedUrlStoreCount() { return issuedUrlStores.size; },
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
    publicDeliveryUrl(assetId, { variant }) {
      return `http://fixture/assets/public/${assetId}/${variant}`;
    },
    issuedUrlStore(assetId, options = {}) {
      assets.issuedUrlStoreCalls += 1;
      const key = issuedUrlKey(assetId, options);
      let store = issuedUrlStores.get(key);
      if (!store) {
        store = new FakeIssuedUrlStore();
        issuedUrlStores.set(key, store);
      }
      return store;
    },
    issuedUrlStoreFor(assetId, options = {}) {
      return issuedUrlStores.get(issuedUrlKey(assetId, options)) ?? null;
    },
    rotateIssuedUrlAuthority() {
      const predecessors = [...issuedUrlStores.values()];
      issuedUrlStores.clear();
      for (const store of predecessors) {
        store.publish(FAKE_ISSUED_URL_CONSTRUCTION_SNAPSHOT);
      }
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

async function harness({ activeMode = 'dev' } = {}) {
  const { client, barriers } = createFakeClient(activeMode);
  const binding = await prepareReactBindingForClient(client, { generatedManifest });
  const assets = createFakeAssets();
  const provider = createSnapbackReactProvider(binding, { assets });
  return { provider, assets, barriers };
}

function renderHook(provider, hook, { strict = false } = {}) {
  const output = { current: null };
  function Probe() {
    output.current = hook();
    return null;
  }
  let renderer;
  act(() => {
    const tree = (
      React.createElement(
        SnapbackProvider,
        { provider },
        React.createElement(Probe),
      )
    );
    renderer = TestRenderer.create(
      strict ? React.createElement(React.StrictMode, null, tree) : tree,
    );
  });
  return { output, renderer };
}

// --- issued URL hook: thin shared external-store projection ---------------

{
  const { provider, assets } = await harness();
  const options = { variant: 'chat', ttlMs: 30_000 };
  const { output, renderer } = renderHook(
    provider,
    () => useSnapbackAssetUrl('asset-url-render', options),
  );
  const store = assets.issuedUrlStoreFor('asset-url-render', options);
  assert.equal(output.current.url, null);
  assert.equal(output.current.status, 'issuing');
  const refresh = output.current.refresh;

  act(() => {
    store.publish({
      url: 'http://fixture/assets/signed/asset-url-render',
      status: 'ready',
      diagnostic: null,
    });
  });
  assert.equal(output.current.url, 'http://fixture/assets/signed/asset-url-render');
  assert.equal(output.current.status, 'ready');
  assert.equal(output.current.refresh, refresh, 'refresh identity is stable for one store');

  const denial = Object.freeze({
    code: 'SNAPBACK_ASSET_READ_DENIED',
    message: 'viewer is not authorized for this asset',
  });
  act(() => {
    store.publish({ url: null, status: 'denied', diagnostic: denial });
  });
  assert.equal(output.current.status, 'denied');
  assert.equal(output.current.url, null);
  assert.equal(output.current.diagnostic, denial);
  await act(async () => { await output.current.refresh(); });
  assert.equal(store.refreshCalls, 1, 'refresh forwards to the neutral store');

  assert.equal(store.listeners.size, 1);
  act(() => { renderer.unmount(); });
  assert.equal(store.listeners.size, 0, 'unmount releases neutral-store demand');
  assert.equal(store.unsubscribeCalls, 1);
  console.log('asset issued URL snapshot, denied diagnostic, refresh, unmount: ok');
}

{
  const { provider, assets } = await harness();
  const options = { variant: 'feed', widthPx: 640 };
  const outputs = [null, null];
  function Probe({ index }) {
    outputs[index] = useSnapbackAssetUrl('asset-url-shared', { ...options });
    return null;
  }
  let renderer;
  act(() => {
    renderer = TestRenderer.create(React.createElement(
      SnapbackProvider,
      { provider },
      React.createElement(React.Fragment, null,
        React.createElement(Probe, { index: 0 }),
        React.createElement(Probe, { index: 1 }),
      ),
    ));
  });
  const store = assets.issuedUrlStoreFor('asset-url-shared', options);
  assert.equal(assets.issuedUrlStoreCount, 1, 'equal keys share one client store entry');
  assert.equal(store.listeners.size, 2);
  assert.equal(store.issuanceLoops, 1, 'equal consumers drive one issuance loop');
  act(() => {
    store.publish({
      url: 'http://fixture/assets/signed/asset-url-shared',
      status: 'ready',
      diagnostic: null,
    });
  });
  assert.equal(outputs[0].url, outputs[1].url);
  act(() => { renderer.unmount(); });
  assert.equal(store.listeners.size, 0);
  console.log('asset issued URL equal keys share one neutral-store issuance loop: ok');
}

{
  const { provider, assets } = await harness();
  let latest = null;
  function InlineOptionsProbe({ tick }) {
    latest = useSnapbackAssetUrl('asset-url-inline', {
      ...(tick % 2 === 0
        ? { variant: 'chat', widthPx: 320 }
        : { widthPx: 320, variant: 'chat' }),
      ttlMs: 15_000,
    });
    return null;
  }
  const renderProbe = (tick) => React.createElement(
    SnapbackProvider,
    { provider },
    React.createElement(InlineOptionsProbe, { tick }),
  );
  let renderer;
  act(() => { renderer = TestRenderer.create(renderProbe(0)); });
  const store = assets.issuedUrlStoreFor('asset-url-inline', {
    variant: 'chat',
    widthPx: 320,
    ttlMs: 15_000,
  });
  const refresh = latest.refresh;
  const lookupCalls = assets.issuedUrlStoreCalls;
  act(() => { renderer.update(renderProbe(1)); });
  assert.equal(
    assets.issuedUrlStoreCalls,
    lookupCalls,
    'content-equal inline options retain the memoized store lookup',
  );
  assert.equal(store.subscribeCalls, 1);
  assert.equal(store.unsubscribeCalls, 0);
  assert.equal(latest.refresh, refresh);
  act(() => { renderer.unmount(); });
  assert.equal(store.listeners.size, 0);
  console.log('asset issued URL inline options are content-keyed: ok');
}

{
  const { provider, assets, barriers } = await harness();
  const options = { variant: 'chat' };
  const { output, renderer } = renderHook(
    provider,
    () => useSnapbackAssetUrl('asset-url-authority', options),
  );
  const predecessor = assets.issuedUrlStoreFor('asset-url-authority', options);
  await act(async () => {
    assets.rotateIssuedUrlAuthority();
    const assetBarrier = barriers.find(
      (entry) => entry.name.startsWith('snapback-react-assets:'),
    );
    assetBarrier.blank();
    await assetBarrier.resume();
  });
  const successor = assets.issuedUrlStoreFor('asset-url-authority', options);
  assert.notEqual(successor, predecessor);
  assert.equal(predecessor.listeners.size, 0);
  assert.equal(successor.listeners.size, 1);
  assert.equal(successor.issuanceLoops, 1);
  assert.equal(output.current.status, 'issuing');
  act(() => { renderer.unmount(); });
  console.log('asset issued URL authority generation adopts a successor store: ok');
}

// --- upload hook reactivity, retry stability, blanking ---------------------

{
  const { provider, assets } = await harness();
  const upload = { artifactKind: 'assetUploadReference', name: 'avatarUpload' };
  const { output, renderer } = renderHook(
    provider,
    () => useSnapbackAssetUpload({ upload }),
    { strict: true },
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
    { strict: true },
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
  assert.equal(output.current.delivery, 'strict');
  assert.equal(output.current.strictSrc, output.current.src);

  // Blanking (denial/deletion) empties the ladder.
  act(() => { assets.emitWatch({ status: 'blank', record: null, mode: 'live' }); });
  assert.equal(output.current.phase, 'empty');
  assert.equal(output.current.src, null);

  act(() => { renderer.unmount(); });
  console.log('asset renderer ladder preview → rendition → blank: ok');
}

{
  const { provider, assets } = await harness();
  const { output, renderer } = renderHook(
    provider,
    () => useSnapbackAssetImage({ assetId: 'asset-public', maxWidth: 760 }),
  );
  await act(async () => { await flush(); });
  act(() => {
    assets.emitWatch({
      status: 'ready',
      record: {
        assetId: 'asset-public',
        availability: 'ready',
        deliveryProfile: 'public-immutable',
        renditions: [
          { variant: 'primary', ready: true, width: 1200 },
          { variant: 'chat', ready: true, width: 640 },
          { variant: 'tiny', ready: false, width: 128 },
        ],
      },
      mode: 'live',
    });
  });
  assert.equal(output.current.phase, 'rendition');
  assert.equal(output.current.src, 'http://fixture/assets/public/asset-public/chat');
  assert.equal(output.current.delivery, 'public');
  assert.equal(
    output.current.strictSrc,
    'http://fixture/assets/records/asset-public/bytes/best?maxWidth=760',
  );
  act(() => { renderer.unmount(); });
  console.log('public-immutable renderer chooses one concrete ready rendition URL: ok');
}

{
  const { provider, assets } = await harness();
  const previewUrl = 'blob:public-pending-preview';
  const { output, renderer } = renderHook(
    provider,
    () => useSnapbackAssetImage({
      assetId: 'asset-public-pending',
      previewUrl,
      maxWidth: 480,
    }),
  );
  await act(async () => { await flush(); });
  act(() => {
    assets.emitWatch({
      status: 'ready',
      record: {
        assetId: 'asset-public-pending',
        availability: 'ready',
        deliveryProfile: 'public-immutable',
        renditions: [
          { variant: 'primary', ready: false, width: 1200 },
          { variant: 'feed', ready: false, width: 480 },
        ],
      },
      mode: 'live',
    });
  });
  assert.equal(output.current.phase, 'preview');
  assert.equal(output.current.src, previewUrl);
  assert.equal(output.current.delivery, 'pending');
  assert.equal(
    output.current.strictSrc,
    'http://fixture/assets/records/asset-public-pending/bytes/best?maxWidth=480',
  );
  assert.notEqual(output.current.src, output.current.strictSrc);

  act(() => {
    assets.emitWatch({
      status: 'ready',
      record: {
        assetId: 'asset-public-pending',
        availability: 'ready',
        deliveryProfile: 'public-immutable',
        renditions: [
          { variant: 'primary', ready: false, width: 1200 },
          { variant: 'feed', ready: true, width: 480 },
        ],
      },
      mode: 'live',
    });
  });
  assert.equal(output.current.phase, 'rendition');
  assert.equal(output.current.delivery, 'public');
  assert.equal(
    output.current.src,
    'http://fixture/assets/public/asset-public-pending/feed',
  );
  act(() => { renderer.unmount(); });

  const emptyHarness = await harness();
  const empty = renderHook(
    emptyHarness.provider,
    () => useSnapbackAssetImage({ assetId: 'asset-public-pending-empty', maxWidth: 320 }),
  );
  await act(async () => { await flush(); });
  act(() => {
    emptyHarness.assets.emitWatch({
      status: 'ready',
      record: {
        assetId: 'asset-public-pending-empty',
        availability: 'ready',
        deliveryProfile: 'public-immutable',
        renditions: [{ variant: 'feed', ready: false, width: 320 }],
      },
      mode: 'live',
    });
  });
  assert.equal(empty.output.current.phase, 'empty');
  assert.equal(empty.output.current.src, null);
  assert.equal(empty.output.current.delivery, 'pending');
  assert.equal(
    empty.output.current.strictSrc,
    'http://fixture/assets/records/asset-public-pending-empty/bytes/best?maxWidth=320',
  );
  act(() => { empty.renderer.unmount(); });
  console.log('public-immutable renderer holds underlay during rendition publication: ok');
}

{
  const { provider, assets } = await harness();
  const { output, renderer } = renderHook(
    provider,
    () => useSnapbackAssetImage({ assetId: 'asset-public-widthless', maxWidth: 640 }),
  );
  await act(async () => { await flush(); });
  act(() => {
    assets.emitWatch({
      status: 'ready',
      record: {
        assetId: 'asset-public-widthless',
        availability: 'ready',
        deliveryProfile: 'public-immutable',
        renditions: [{ variant: 'mystery-size', ready: true }],
      },
      mode: 'live',
    });
  });
  assert.equal(output.current.phase, 'rendition');
  assert.equal(output.current.delivery, 'public');
  assert.equal(
    output.current.src,
    'http://fixture/assets/public/asset-public-widthless/mystery-size',
  );
  assert.notEqual(output.current.src, output.current.strictSrc);
  act(() => { renderer.unmount(); });
  console.log('public-immutable renderer accepts a ready widthless rendition: ok');
}

{
  const warnings = [];
  const originalWarn = console.warn;
  console.warn = (...args) => { warnings.push(args); };
  try {
    const sessions = await harness({ activeMode: 'sessions' });
    const sessionImage = renderHook(
      sessions.provider,
      () => useSnapbackAssetImage({ assetId: 'asset-sessions-strict', maxWidth: 256 }),
    );
    await act(async () => { await flush(); });
    const strictRecord = {
      status: 'ready',
      record: { assetId: 'asset-sessions-strict', availability: 'ready' },
      mode: 'live',
    };
    act(() => { sessions.assets.emitWatch(strictRecord); });
    assert.equal(sessionImage.output.current.delivery, 'strict');
    assert.equal(warnings.length, 1);
    assert.equal(warnings[0].length, 1);
    assert.match(warnings[0][0], /SNAPBACK_REACT_ASSET_STRICT_DELIVERY_SESSIONS/);
    assert.match(warnings[0][0], /asset-sessions-strict/);
    act(() => { sessions.assets.emitWatch(strictRecord); });
    assert.equal(warnings.length, 1);
    act(() => { sessionImage.renderer.unmount(); });

    warnings.length = 0;
    const dev = await harness();
    const devImage = renderHook(
      dev.provider,
      () => useSnapbackAssetImage({ assetId: 'asset-dev-strict', maxWidth: 256 }),
    );
    await act(async () => { await flush(); });
    act(() => {
      dev.assets.emitWatch({
        status: 'ready',
        record: { assetId: 'asset-dev-strict', availability: 'ready' },
        mode: 'live',
      });
    });
    assert.equal(devImage.output.current.delivery, 'strict');
    assert.equal(warnings.length, 0);
    act(() => { devImage.renderer.unmount(); });
  } finally {
    console.warn = originalWarn;
  }
  console.log('sessions strict-delivery diagnostic warns once per provider asset: ok');
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
