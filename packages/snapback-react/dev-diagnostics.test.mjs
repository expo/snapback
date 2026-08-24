import assert from 'node:assert/strict';

import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';

import {
  createClientDevConsoleReporter,
  createClientDiagnosticsChannel,
  positiveDevelopmentEnvironment,
} from '../snapback-client/client-diagnostics.mjs';
import { prepareReactBindingForClient } from '../snapback-client/react-binding.mjs';
import { resultContractHash } from '../snapback-codegen/result-contracts.mjs';
import {
  SnapbackProvider,
  createSnapbackReactProvider,
  invokeSnapbackMutation,
  observeSnapbackPresence,
  observeSnapbackDiagnostics,
  skip,
  useSnapbackActivityPresence,
  useSnapbackDiagnostics,
  useSnapbackPresence,
  useSnapbackQuery,
} from './index.mjs';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const flush = () => new Promise((resolve) => setImmediate(resolve));

const queryResultContract = Object.freeze({
  kind: 'records',
  record: Object.freeze({
    kind: 'object',
    fields: Object.freeze([
      Object.freeze({ name: 'id', required: true, value: { kind: 'string', maxBytes: 64 } }),
    ]),
    allowExtra: false,
  }),
});
const mutationResultContract = Object.freeze({
  kind: 'value',
  value: Object.freeze({ kind: 'string', maxBytes: 64 }),
});
const reference = (name, kind, resultContract) => Object.freeze({
  artifactKind: 'functionReference',
  schemaVersion: 'snapback.v0',
  appId: 'react-dev-diagnostics-fixture',
  id: `react-dev-diagnostics-fixture:${name}`,
  name,
  kind,
  implementationHash: `sha256:${name}-implementation`,
  argsContractHash: `sha256:${name}-args`,
  argumentSchema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      filter: {},
      page: { type: 'array', items: { type: 'number' } },
      counter: { type: 'integer' },
      stable: { type: 'boolean' },
      title: { type: 'string' },
    },
  },
  resultContractHash: resultContractHash(resultContract),
  resultContract,
});
const items = reference('items', 'LiveQuery', queryResultContract);
const writeItem = reference('writeItem', 'Mutation', mutationResultContract);
const functions = Object.freeze({
  artifactKind: 'functionManifest',
  schemaVersion: 'snapback.v0',
  appId: 'react-dev-diagnostics-fixture',
  bundleHash: 'sha256:react-dev-diagnostics-bundle',
  functions: Object.freeze([items, writeItem]),
});
const presenceCollection = Object.freeze({
  name: 'presence',
  scopeFields: Object.freeze(['roomId']),
  scopeContract: Object.freeze({
    kind: 'object',
    fields: Object.freeze([
      Object.freeze({ name: 'roomId', required: true, value: { kind: 'string', maxBytes: 32 } }),
    ]),
    allowExtra: false,
  }),
  valueContract: Object.freeze({
    kind: 'object',
    fields: Object.freeze([
      Object.freeze({ name: 'cursor', required: true, value: { kind: 'integer', min: 0, max: 1_000 } }),
    ]),
    allowExtra: false,
  }),
  keyMode: 'Connection',
  routingFields: Object.freeze(['roomId']),
  defaultTtlMs: 1_000,
  maxTtlMs: 5_000,
  maxValueBytes: 128,
  hardMaxValueBytes: 4_096,
  sustainedHz: 10,
  burst: 20,
  dispatchMs: 33,
  publish: 'AllowAll',
  subscribe: 'AllowAll',
  maxPendingEphemeralKeys: 1_024,
});
const schema = Object.freeze({
  artifactKind: 'schemaManifest',
  schemaVersion: 'snapback.v0',
  appId: 'react-dev-diagnostics-fixture',
  schemaHash: 'sha256:react-dev-diagnostics-schema',
  ephemeralCollections: Object.freeze([presenceCollection]),
  tables: Object.freeze([]),
});
const capabilityManifest = Object.freeze({
  artifactKind: 'capabilityManifest',
  schemaVersion: 'snapback.v0',
  targetProfileId: 'local-dev-sqlite-ibex',
  supportedCapabilities: Object.freeze(['live_subscriptions']),
});

function createFakeClient({ attachReporter = true, queuedOutcome = null } = {}) {
  const channel = createClientDiagnosticsChannel({ cooldownMs: 60_000 });
  const consoleOutput = { warn: [], error: [] };
  const reporter = attachReporter && positiveDevelopmentEnvironment()
    ? createClientDevConsoleReporter(channel, {
      console: {
        warn: (line) => consoleOutput.warn.push(line),
        error: (line) => consoleOutput.error.push(line),
      },
    })
    : null;
  const liveHandles = new Set();
  const presenceHandles = new Set();
  let querySequence = 0;
  let presenceSequence = 0;
  let presencePublishes = 0;
  const client = {
    liveQuery() {},
    diagnosticsChannel: () => channel,
    async inspect() {
      return {
        targetProfileId: 'local-dev-sqlite-ibex',
        target: 'local-dev-sqlite-ibex',
        schema,
        functions,
        capabilityManifest,
      };
    },
    async authSession() { return { activeMode: 'dev' }; },
    registerAuthBarrierParticipant() { return async () => {}; },
    liveStreamManager() {
      return {
        inspection: () => ({ socketDemand: liveHandles.size + presenceHandles.size }),
        async settled() {},
      };
    },
    async releaseConnection() { return { released: true }; },
    startLiveQuery(_reference, options) {
      querySequence += 1;
      const current = {
        subscriptionId: `diagnostic-query-${querySequence}`,
        rows: Object.freeze([]),
        connection: 'live',
        freshness: 'current',
        retention: null,
      };
      const handle = {
        current,
        started: async () => {},
        dispose() { liveHandles.delete(handle); },
        settled: async () => {},
      };
      liveHandles.add(handle);
      queueMicrotask(() => options.onUpdate?.(current.rows, { kind: 'live_replace' }));
      return Object.freeze(handle);
    },
    registerEphemeralRepublisher() { return Object.freeze({ dispose() {} }); },
    startEphemeralRoom(_definition, scope) {
      presenceSequence += 1;
      let entryVersion = 0;
      const listeners = new Set();
      let current = Object.freeze({
        status: 'ready',
        entries: Object.freeze([]),
        selfKey: `presence-self-${presenceSequence}`,
        diagnostic: null,
        connection: 'live',
        reason: null,
      });
      const notify = () => {
        for (const listener of [...listeners]) listener();
      };
      const handle = {
        subscribe(listener) {
          listeners.add(listener);
          return () => listeners.delete(listener);
        },
        getSnapshot: () => current,
        getServerSnapshot: () => current,
        get grantedConnectionId() { return current.selfKey; },
        started: async () => { notify(); },
        async publish(value, { ttlMs }) {
          entryVersion += 1;
          presencePublishes += 1;
          current = Object.freeze({
            ...current,
            entries: Object.freeze([Object.freeze({
              key: current.selfKey,
              value,
              expiresAtMs: Date.now() + ttlMs,
              receivedAtMs: Date.now(),
              scopeEpoch: 1,
              entryVersion,
              scope,
            })]),
          });
          notify();
          return { accepted: true, scope_epoch: 1, entry_version: entryVersion };
        },
        async delete() { return { removed: true }; },
        testReconnect() {
          current = Object.freeze({
            ...current,
            status: 'resyncing',
            entries: Object.freeze([]),
            selfKey: null,
            connection: 'connecting',
            reason: 'socket_reconnected',
          });
          notify();
          current = Object.freeze({
            ...current,
            status: 'ready',
            entries: Object.freeze([]),
            selfKey: `presence-self-${presenceSequence}-reconnected`,
            connection: 'live',
            reason: null,
          });
          notify();
        },
        dispose() {
          listeners.clear();
          presenceHandles.delete(handle);
        },
        settled: async () => {},
      };
      presenceHandles.add(handle);
      return Object.freeze(handle);
    },
    async mutate(ref) {
      if (queuedOutcome === null) return { result: `${ref.name}:ok` };
      channel.emit({
        code: 'SNAPBACK_OFFLINE_MUTATION_QUEUED',
        severity: 'warning',
        subsystem: 'outbox',
        message: 'Offline queue rule: queued is not settled. Keep pending UI visible and drain via useSnapbackOutbox().drainNow(); see guide/sync/offline-and-retention.md#replay-and-settle-without-guessing.',
        details: { mutation: ref.name, ...queuedOutcome },
        site: ref.name,
      });
      return queuedOutcome;
    },
    disposeDiagnostics() {
      reporter?.dispose();
      channel.dispose();
    },
    test: {
      channel,
      consoleOutput,
      presencePublishes: () => presencePublishes,
      reconnectPresence() {
        for (const handle of presenceHandles) handle.testReconnect();
      },
    },
  };
  return client;
}

async function createHarness({ providerOptions = {}, ...clientOptions } = {}) {
  const client = createFakeClient(clientOptions);
  const binding = await prepareReactBindingForClient(client, {
    generatedManifest: { functions, schema, capabilityManifest },
  });
  const provider = createSnapbackReactProvider(binding, providerOptions);
  return { binding, client, provider, presence: binding.ephemeral.presence };
}

async function disposeHarness(harness, renderer = null) {
  if (renderer !== null) await act(async () => { renderer.unmount(); await flush(); });
  await harness.provider.dispose();
  harness.client.disposeDiagnostics();
}

const previousNodeEnvironment = process.env.NODE_ENV;
const previousDev = globalThis.__DEV__;
const originalConsoleWarn = console.warn;
try {
  // Fresh-but-content-equal arguments, including a fresh generated-reference
  // object, may rotate React callbacks but retain one canonical descriptor.
  globalThis.__DEV__ = true;
  process.env.NODE_ENV = 'development';
  {
    const harness = await createHarness({
      providerOptions: {
        __diagnosticsChurnTransitionThreshold: 3,
        __diagnosticsChurnWindowMs: 2_000,
      },
    });
    let renderer;
    function EqualProbe({ tick }) {
      const args = tick % 2 === 0
        ? { filter: { state: 'open' }, page: [1, 2] }
        : { page: [1, 2], filter: { state: 'open' } };
      useSnapbackQuery(Object.freeze({ ...items }), args);
      return null;
    }
    await act(async () => {
      renderer = TestRenderer.create(React.createElement(
        SnapbackProvider,
        { provider: harness.provider },
        React.createElement(EqualProbe, { tick: 0 }),
      ));
      await flush();
    });
    for (let tick = 1; tick <= 20; tick += 1) {
      await act(async () => {
        renderer.update(React.createElement(
          SnapbackProvider,
          { provider: harness.provider },
          React.createElement(EqualProbe, { tick }),
        ));
        await flush();
      });
    }
    assert.equal(
      harness.client.test.channel.snapshot().events.filter(
        (event) => event.code === 'SNAPBACK_REACT_SUBSCRIPTION_CHURN',
      ).length,
      0,
      '20 fresh content-equal renders produce no churn event',
    );
    await disposeHarness(harness, renderer);
  }

  // Genuine committed key changes trip once in history; continued churn is
  // coalesced by the channel and grows occurrence accounting. Direct console
  // remains silent because only the client reporter owns line output.
  {
    const directWarnings = [];
    console.warn = (...parts) => directWarnings.push(parts.join(' '));
    const harness = await createHarness({
      providerOptions: {
        __diagnosticsChurnTransitionThreshold: 3,
        __diagnosticsChurnWindowMs: 2_000,
      },
    });
    let renderer;
    function ChurnProbe({ counter }) {
      useSnapbackQuery(items, { counter });
      return null;
    }
    await act(async () => {
      renderer = TestRenderer.create(React.createElement(
        SnapbackProvider,
        { provider: harness.provider },
        React.createElement(ChurnProbe, { counter: 0 }),
      ));
      await flush();
    });
    for (let counter = 1; counter <= 6; counter += 1) {
      await act(async () => {
        renderer.update(React.createElement(
          SnapbackProvider,
          { provider: harness.provider },
          React.createElement(ChurnProbe, { counter }),
        ));
        await flush();
      });
    }
    const churnEvents = harness.client.test.channel.snapshot().events.filter(
      (event) => event.code === 'SNAPBACK_REACT_SUBSCRIPTION_CHURN',
    );
    assert.equal(churnEvents.length, 1, 'one coalesced history entry names the churning site');
    assert.ok(churnEvents[0].occurrence.count > 1, 'continued churn grows occurrence count');
    assert.equal(churnEvents[0].details.referenceName, 'items');
    assert.equal(churnEvents[0].details.hookKind, 'query');
    assert.equal(churnEvents[0].details.transitionCount, 3);
    assert.match(churnEvents[0].site, /ChurnProbe/u);
    assert.match(churnEvents[0].message, /stable or content-equal/u);
    assert.match(churnEvents[0].message, /Memoize or hoist/u);
    assert.match(churnEvents[0].message, /guide\/clients\/react\.md/u);
    assert.equal(harness.client.test.consoleOutput.warn.length, 1, 'dev reporter prints one line');
    assert.equal(directWarnings.length, 0, 'the React producer never writes console directly');
    await disposeHarness(harness, renderer);
    console.warn = originalConsoleWarn;
  }

  // Strict Mode's same-descriptor setup/cleanup pair is not a transition.
  {
    const harness = await createHarness({
      providerOptions: {
        __diagnosticsChurnTransitionThreshold: 1,
        __diagnosticsChurnWindowMs: 2_000,
      },
    });
    function StrictProbe() {
      useSnapbackQuery(items, { stable: true });
      return null;
    }
    let renderer;
    await act(async () => {
      renderer = TestRenderer.create(React.createElement(
        React.StrictMode,
        null,
        React.createElement(
          SnapbackProvider,
          { provider: harness.provider },
          React.createElement(StrictProbe),
        ),
      ));
      await flush();
    });
    assert.equal(harness.client.test.channel.snapshot().events.filter(
      (event) => event.code === 'SNAPBACK_REACT_SUBSCRIPTION_CHURN',
    ).length, 0);
    await disposeHarness(harness, renderer);
  }

  // Presence scope/value descriptor rotation has its own stable code.
  {
    const harness = await createHarness({
      providerOptions: {
        __diagnosticsChurnTransitionThreshold: 3,
        __diagnosticsChurnWindowMs: 2_000,
      },
    });
    let renderer;
    function PresenceProbe({ cursor }) {
      useSnapbackPresence(harness.presence, {
        scope: { roomId: 'room-1' },
        value: { cursor },
        ttlMs: 1_000,
      });
      return null;
    }
    await act(async () => {
      renderer = TestRenderer.create(React.createElement(
        SnapbackProvider,
        { provider: harness.provider },
        React.createElement(PresenceProbe, { cursor: 0 }),
      ));
      await flush();
    });
    for (let cursor = 1; cursor <= 4; cursor += 1) {
      await act(async () => {
        renderer.update(React.createElement(
          SnapbackProvider,
          { provider: harness.provider },
          React.createElement(PresenceProbe, { cursor }),
        ));
        await flush();
      });
    }
    const [event] = harness.client.test.channel.snapshot().events.filter(
      (entry) => entry.code === 'SNAPBACK_REACT_PRESENCE_PUBLISH_CHURN',
    );
    assert.ok(event, 'rotating presence values emit the presence churn code');
    assert.equal(event.details.hookKind, 'presence');
    assert.equal(event.details.referenceName, 'presence');
    await disposeHarness(harness, renderer);
  }

  // An activity helper whose thunk changes on every touch keeps one stable
  // hook descriptor, so the provider must diagnose the actual wire publishes.
  {
    const harness = await createHarness({
      providerOptions: {
        __diagnosticsChurnTransitionThreshold: 3,
        __diagnosticsChurnWindowMs: 2_000,
      },
    });
    let renderer;
    let current;
    let cursor = 0;
    function VolatileActivityProbe() {
      current = useSnapbackActivityPresence(harness.presence, {
        scope: { roomId: 'room-1' },
        value: () => ({ cursor: cursor += 1 }),
        idleMs: 1_000,
      });
      return null;
    }
    await act(async () => {
      renderer = TestRenderer.create(React.createElement(
        SnapbackProvider,
        { provider: harness.provider },
        React.createElement(VolatileActivityProbe),
      ));
      await flush();
    });
    for (let touch = 0; touch < 4; touch += 1) {
      await act(async () => {
        current.touch();
        await flush();
      });
    }
    await act(async () => { await flush(); await flush(); });
    const [event] = harness.client.test.channel.snapshot().events.filter(
      (entry) => entry.code === 'SNAPBACK_REACT_PRESENCE_VALUE_CHURN',
    );
    assert.ok(
      event,
      `volatile activity values emit the provider value-churn code: ${JSON.stringify({ events: harness.client.test.channel.snapshot().events, current })}`,
    );
    assert.equal(event.details.key, 'presence');
    assert.equal(event.details.changedPublishCount, 3);
    assert.equal(Object.hasOwn(event.details, 'value'), false, 'presence values stay redacted');
    assert.match(event.message, /value thunk appears volatile/u);
    assert.match(event.message, /memoize a stable bound value/u);
    assert.match(event.message, /guide\/recipes\/activity-presence\.md/u);
    await disposeHarness(harness, renderer);
  }

  // Two intent changes in one turn produce one actual publish. The skipped
  // predecessor must not advance the provider-level counter.
  {
    const harness = await createHarness({
      providerOptions: {
        __diagnosticsChurnTransitionThreshold: 2,
        __diagnosticsChurnWindowMs: 2_000,
      },
    });
    let renderer;
    let current;
    let cursor = 0;
    function SupersededActivityProbe() {
      current = useSnapbackActivityPresence(harness.presence, {
        scope: { roomId: 'room-1' },
        value: () => ({ cursor: cursor += 1 }),
        idleMs: 1_000,
      });
      return null;
    }
    await act(async () => {
      renderer = TestRenderer.create(React.createElement(
        SnapbackProvider,
        { provider: harness.provider },
        React.createElement(SupersededActivityProbe),
      ));
      await flush();
    });
    await act(async () => {
      current.touch();
      await flush();
    });
    await act(async () => {
      current.touch();
      current.touch();
      await flush();
      await flush();
    });
    assert.equal(
      harness.client.test.channel.snapshot().events.some(
        (entry) => entry.code === 'SNAPBACK_REACT_PRESENCE_VALUE_CHURN',
      ),
      false,
      'a superseded changed intent does not advance the wire-publish counter',
    );
    await act(async () => {
      current.touch();
      await flush();
    });
    assert.equal(
      harness.client.test.channel.snapshot().events.filter(
        (entry) => entry.code === 'SNAPBACK_REACT_PRESENCE_VALUE_CHURN',
      ).length,
      1,
      'the next actual changed publish reaches the configured threshold',
    );
    await disposeHarness(harness, renderer);
  }

  // Stable activity values retain the existing local no-op behavior and do
  // not produce the changed-value detector's warning.
  {
    const harness = await createHarness({
      providerOptions: {
        __diagnosticsChurnTransitionThreshold: 2,
        __diagnosticsChurnWindowMs: 2_000,
      },
    });
    let renderer;
    let current;
    function StableActivityProbe() {
      current = useSnapbackActivityPresence(harness.presence, {
        scope: { roomId: 'room-1' },
        value: () => ({ cursor: 1 }),
        idleMs: 1_000,
      });
      return null;
    }
    await act(async () => {
      renderer = TestRenderer.create(React.createElement(
        SnapbackProvider,
        { provider: harness.provider },
        React.createElement(StableActivityProbe),
      ));
      await flush();
    });
    for (let touch = 0; touch < 4; touch += 1) {
      await act(async () => {
        current.touch();
        await flush();
      });
    }
    assert.equal(
      harness.client.test.channel.snapshot().events.some(
        (entry) => entry.code === 'SNAPBACK_REACT_PRESENCE_VALUE_CHURN',
      ),
      false,
      'content-equal activity values remain local no-ops',
    );
    await disposeHarness(harness, renderer);
  }

  // A socket reconnect creates a new in-place room generation. Its lifecycle
  // republish establishes a fresh baseline, so changes on opposite sides of
  // the reconnect cannot combine into one warning.
  {
    const harness = await createHarness({
      providerOptions: {
        __diagnosticsChurnTransitionThreshold: 2,
        __diagnosticsChurnWindowMs: 2_000,
      },
    });
    const observer = observeSnapbackPresence(
      harness.provider,
      harness.presence,
      { scope: { roomId: 'reconnect-room' }, value: skip },
      () => {},
    );
    await flush();
    await observer.publish({ cursor: 0 }, { ttlMs: 1_000 });
    await observer.publish({ cursor: 1 }, { ttlMs: 1_000 });
    harness.client.test.reconnectPresence();
    await observer.publish({ cursor: 2 }, { ttlMs: 1_000 });
    assert.equal(
      harness.client.test.channel.snapshot().events.some(
        (entry) => entry.code === 'SNAPBACK_REACT_PRESENCE_VALUE_CHURN',
      ),
      false,
      'pre-reconnect and post-reconnect changes do not share a churn ring',
    );
    await observer.publish({ cursor: 3 }, { ttlMs: 1_000 });
    assert.equal(
      harness.client.test.channel.snapshot().events.some(
        (entry) => entry.code === 'SNAPBACK_REACT_PRESENCE_VALUE_CHURN',
      ),
      false,
      'the first change after the new generation baseline does not warn',
    );
    await observer.publish({ cursor: 4 }, { ttlMs: 1_000 });
    assert.equal(
      harness.client.test.channel.snapshot().events.filter(
        (entry) => entry.code === 'SNAPBACK_REACT_PRESENCE_VALUE_CHURN',
      ).length,
      1,
      'two post-reconnect changes still reach the configured threshold',
    );
    await observer.dispose();
    await disposeHarness(harness);
  }

  // Heartbeats are actual same-value publishes, but they neither advance nor
  // emit the changed-value warning.
  {
    const harness = await createHarness({
      providerOptions: {
        __diagnosticsChurnTransitionThreshold: 2,
        __diagnosticsChurnWindowMs: 2_000,
      },
    });
    const observer = observeSnapbackPresence(
      harness.provider,
      harness.presence,
      { scope: { roomId: 'heartbeat-room' }, value: skip },
      () => {},
    );
    await flush();
    await observer.publish({ cursor: 0 }, { ttlMs: 500 });
    await new Promise((resolve) => setTimeout(resolve, 600));
    assert.ok(
      harness.client.test.presencePublishes() >= 3,
      'the fixture observed the initial publish plus at least two heartbeats',
    );
    assert.equal(
      harness.client.test.channel.snapshot().events.some(
        (entry) => entry.code === 'SNAPBACK_REACT_PRESENCE_VALUE_CHURN',
      ),
      false,
      'heartbeats do not advance changed-value churn',
    );
    await observer.dispose();
    await disposeHarness(harness);
  }

  // A TTL-only managed-intent update does publish, but an unchanged canonical
  // value cannot count as a changed-value transition.
  {
    const harness = await createHarness({
      providerOptions: {
        __diagnosticsChurnTransitionThreshold: 1,
        __diagnosticsChurnWindowMs: 2_000,
      },
    });
    const observer = observeSnapbackPresence(
      harness.provider,
      harness.presence,
      { scope: { roomId: 'ttl-room' }, value: { cursor: 0 }, ttlMs: 500 },
      () => {},
    );
    await flush();
    await flush();
    const publishesBeforeTtlChange = harness.client.test.presencePublishes();
    observer.update({
      scope: { roomId: 'ttl-room' },
      value: { cursor: 0 },
      ttlMs: 1_000,
    });
    await flush();
    assert.equal(
      harness.client.test.presencePublishes(),
      publishesBeforeTtlChange + 1,
      'TTL-only change reaches the actual publish boundary',
    );
    assert.equal(
      harness.client.test.channel.snapshot().events.some(
        (entry) => entry.code === 'SNAPBACK_REACT_PRESENCE_VALUE_CHURN',
      ),
      false,
      'TTL-only publishes do not count as value churn',
    );
    await observer.dispose();
    await disposeHarness(harness);
  }

  // Delete clears both the ring and its last-value baseline. A later publish
  // starts a new sequence instead of inheriting the withdrawn entry's history.
  {
    const harness = await createHarness({
      providerOptions: {
        __diagnosticsChurnTransitionThreshold: 2,
        __diagnosticsChurnWindowMs: 2_000,
      },
    });
    const observer = observeSnapbackPresence(
      harness.provider,
      harness.presence,
      { scope: { roomId: 'delete-room' }, value: skip },
      () => {},
    );
    await flush();
    await observer.publish({ cursor: 0 }, { ttlMs: 1_000 });
    await observer.publish({ cursor: 1 }, { ttlMs: 1_000 });
    await observer.delete();
    await observer.publish({ cursor: 2 }, { ttlMs: 1_000 });
    await observer.publish({ cursor: 3 }, { ttlMs: 1_000 });
    assert.equal(
      harness.client.test.channel.snapshot().events.some(
        (entry) => entry.code === 'SNAPBACK_REACT_PRESENCE_VALUE_CHURN',
      ),
      false,
      'a post-delete sequence starts from a fresh baseline',
    );
    await observer.publish({ cursor: 4 }, { ttlMs: 1_000 });
    assert.equal(
      harness.client.test.channel.snapshot().events.filter(
        (entry) => entry.code === 'SNAPBACK_REACT_PRESENCE_VALUE_CHURN',
      ).length,
      1,
      'two post-delete changes still reach the configured threshold',
    );
    await observer.dispose();
    await disposeHarness(harness);
  }

  // No positive development signal means no detector, no reporter, and no
  // console line even for genuinely changing inputs.
  {
    delete globalThis.__DEV__;
    process.env.NODE_ENV = 'production';
    const directWarnings = [];
    console.warn = (...parts) => directWarnings.push(parts.join(' '));
    const harness = await createHarness({
      providerOptions: {
        __diagnosticsChurnTransitionThreshold: 1,
        __diagnosticsChurnWindowMs: 2_000,
      },
    });
    let renderer;
    function ProductionProbe({ counter }) {
      useSnapbackQuery(items, { counter });
      return null;
    }
    await act(async () => {
      renderer = TestRenderer.create(React.createElement(
        SnapbackProvider,
        { provider: harness.provider },
        React.createElement(ProductionProbe, { counter: 0 }),
      ));
      await flush();
    });
    for (let counter = 1; counter <= 3; counter += 1) {
      await act(async () => {
        renderer.update(React.createElement(
          SnapbackProvider,
          { provider: harness.provider },
          React.createElement(ProductionProbe, { counter }),
        ));
        await flush();
      });
    }
    assert.equal(harness.client.test.channel.snapshot().events.filter(
      (event) => event.code === 'SNAPBACK_REACT_SUBSCRIPTION_CHURN',
    ).length, 0);
    assert.equal(harness.client.test.consoleOutput.warn.length, 0);
    assert.equal(directWarnings.length, 0);
    await disposeHarness(harness, renderer);
    console.warn = originalConsoleWarn;
  }

  // LLP 0218 P3's queued union is authoritative. The client emits the
  // canonical fact, React emits only the compatibility diagnostic projection
  // with the same id, and the reporter prints exactly one line for the pair.
  // React arms no timer; the client-owned channel owns wedge scheduling.
  {
    globalThis.__DEV__ = true;
    process.env.NODE_ENV = 'development';
    const queuedOutcome = Object.freeze({
      status: 'queued',
      clientMutationId: 'queued-dev-diagnostic-1',
      sequence: 7,
      presentation: 'withheld',
    });
    const harness = await createHarness({ queuedOutcome });
    const originalSetTimeout = globalThis.setTimeout;
    let scheduled = 0;
    globalThis.setTimeout = (...args) => {
      scheduled += 1;
      return originalSetTimeout(...args);
    };
    let dispatch;
    try {
      dispatch = await invokeSnapbackMutation(
        harness.provider,
        writeItem,
        { title: 'offline' },
      );
    } finally {
      globalThis.setTimeout = originalSetTimeout;
    }
    assert.equal(dispatch.status, 'queued');
    assert.equal(dispatch.clientMutationId, queuedOutcome.clientMutationId);
    assert.equal(dispatch.sequence, queuedOutcome.sequence);
    assert.equal(dispatch.presentation, 'withheld');
    const queuedEvents = harness.client.test.channel.snapshot().events.filter(
      (event) => event.details.clientMutationId === queuedOutcome.clientMutationId,
    );
    assert.deepEqual(queuedEvents.map((event) => event.code).sort(), [
      'SNAPBACK_OFFLINE_MUTATION_QUEUED',
      'SNAPBACK_REACT_MUTATION_QUEUED',
    ]);
    assert.equal(harness.client.test.consoleOutput.warn.length, 1, 'queued pair dedups to one line');
    assert.match(harness.client.test.consoleOutput.warn[0], /SNAPBACK_OFFLINE_MUTATION_QUEUED/u);
    assert.equal(scheduled, 0, 'the React queued projection schedules no wedge timer');
    await disposeHarness(harness);
  }

  // onDiagnostic/inspection retain v1 while the hook and framework-neutral
  // observer share the exact frozen v2 channel projection, including active
  // conditions produced by the client-owned wedge detector.
  {
    const projectedV1 = [];
    const harness = await createHarness({
      attachReporter: false,
      providerOptions: { onDiagnostic: (event) => projectedV1.push(event) },
    });
    const observerSnapshots = [];
    const observer = observeSnapbackDiagnostics(
      harness.provider,
      (snapshot) => observerSnapshots.push(snapshot),
    );
    let hookSnapshot = null;
    function DiagnosticsProbe() {
      hookSnapshot = useSnapbackDiagnostics();
      return null;
    }
    let renderer;
    await act(async () => {
      renderer = TestRenderer.create(React.createElement(
        SnapbackProvider,
        { provider: harness.provider },
        React.createElement(DiagnosticsProbe),
      ));
      await flush();
    });
    const error = new Error('optimistic projection could not rebase');
    error.code = 'SNAPBACK_REACT_OPTIMISTIC_REBASE_FAILED';
    error.diagnostic = Object.freeze({
      schemaVersion: 'snapback.client-diagnostic.v1',
      code: error.code,
      severity: 'error',
      message: error.message,
      details: Object.freeze({ query: 'items' }),
    });
    await act(async () => {
      harness.provider.registry.recordDiagnostic(error);
      await flush();
    });
    assert.equal(projectedV1.length, 1);
    assert.equal(projectedV1[0].schemaVersion, 'snapback.client-diagnostic.v1');
    assert.equal(harness.provider.inspection().diagnostics.at(-1), projectedV1[0]);
    const v2 = hookSnapshot.events.find((event) => event.code === error.code);
    assert.equal(v2.schemaVersion, 'snapback.client-diagnostic.v2');
    assert.equal(v2.subsystem, 'react');
    assert.equal(observer.snapshot(), hookSnapshot, 'hook and observer share one frozen snapshot');

    await act(async () => {
      harness.client.test.channel.setActiveCondition('queue-head:test:1', {
        code: 'SNAPBACK_REACT_MUTATION_QUEUE_WEDGED',
        severity: 'warning',
        subsystem: 'outbox',
        message: 'Durable outbox queue-head rule: the head has not advanced. Drain with useSnapbackOutbox().drainNow(); see guide/sync/offline-and-retention.md#replay-and-settle-without-guessing.',
        details: { clientMutationId: 'test', headSequence: 1, queueDepth: 1 },
        site: 'queue-head:test:1',
      });
      await flush();
    });
    assert.equal(
      hookSnapshot.activeConditions['queue-head:test:1'].code,
      'SNAPBACK_REACT_MUTATION_QUEUE_WEDGED',
    );
    assert.equal(observer.snapshot(), hookSnapshot);
    assert.ok(Object.isFrozen(hookSnapshot));
    assert.ok(observerSnapshots.length >= 3, 'observer receives initial, error, and condition snapshots');
    observer.dispose();
    await disposeHarness(harness, renderer);
  }
} finally {
  console.warn = originalConsoleWarn;
  if (previousNodeEnvironment === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = previousNodeEnvironment;
  if (previousDev === undefined) delete globalThis.__DEV__;
  else globalThis.__DEV__ = previousDev;
}

console.log('dev-diagnostics.test.mjs: churn, queued projection, channel parity, and production silence pass');
