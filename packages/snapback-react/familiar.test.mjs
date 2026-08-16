import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';

import { SnapbackDiagnosticError } from '@expo/snapback-client';
import { prepareReactBindingForClient } from '@expo/snapback-client/react-binding';
import { defineJsMutation } from '@expo/snapback-codegen/define';
import { resultContractHash } from '@expo/snapback-codegen/result-contracts';

import {
  SnapbackProvider,
  skip,
  useAuth,
  useAction,
  useCurrentPrincipal,
  useMutation,
  useQuery,
  useQueryState,
} from './familiar.mjs';
import {
  FAMILIAR_QUERY_ERROR_CLASSES,
  classifyFamiliarQueryState,
} from './familiar-error-classes.mjs';
import {
  createSnapbackReactCoreProvider,
  skip as canonicalSkip,
  useSnapbackAuth,
  useSnapbackCurrentPrincipal,
  useSnapbackQuery,
} from './implementation.mjs';
import { SnapbackProvider as RootCanonicalProvider } from './index.mjs';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const flush = () => new Promise((resolve) => setImmediate(resolve));
const withoutExpectedReactErrorLog = async (callback) => {
  const prior = console.error;
  console.error = () => {};
  try {
    return await callback();
  } finally {
    console.error = prior;
  }
};
const currentRows = Object.freeze([{ id: 'todo-1' }]);
const resultContract = Object.freeze({
  kind: 'records',
  record: Object.freeze({
    kind: 'object',
    fields: Object.freeze([
      Object.freeze({ name: 'id', required: true, value: { kind: 'string', maxBytes: 64 } }),
    ]),
    allowExtra: false,
  }),
});
const scalarResultContract = Object.freeze({
  kind: 'value',
  value: Object.freeze({
    kind: 'object',
    fields: Object.freeze([
      Object.freeze({ name: 'id', required: true, value: { kind: 'string', maxBytes: 64 } }),
    ]),
    allowExtra: false,
  }),
});

const reference = (
  name,
  kind,
  authoringProfile = 'snapback-familiar-ts-v1',
  contract = resultContract,
) => Object.freeze({
  artifactKind: 'functionReference',
  schemaVersion: 'snapback.v0',
  appId: 'familiar-react-fixture',
  id: `familiar-react-fixture:${name}`,
  name,
  kind,
  authoringProfile,
  retention: kind === 'LiveQuery' ? 'none' : 'none',
  delivery: ({ LiveQuery: 'live', Mutation: 'mutation', Action: 'action' })[kind],
  implementationHash: `sha256:${name}-implementation`,
  argsContractHash: `sha256:${name}-args`,
  argsContract: { fields: [] },
  resultContractHash: resultContractHash(contract),
  resultContract: contract,
});

const liveRef = reference('todos.list', 'LiveQuery');
const scalarLiveRef = reference(
  'todos.get',
  'LiveQuery',
  'snapback-familiar-ts-v1',
  scalarResultContract,
);
const mutationRef = reference('todos.create', 'Mutation');
const actionRef = reference('todos.rebuild', 'Action');
const explicitLiveRef = reference('todos.explicit', 'LiveQuery', 'snapback-explicit-v1');
const functions = Object.freeze({
  artifactKind: 'functionManifest',
  schemaVersion: 'snapback.v0',
  appId: 'familiar-react-fixture',
  bundleHash: 'sha256:familiar-react-fixture-bundle',
  functions: Object.freeze([liveRef, scalarLiveRef, mutationRef, actionRef, explicitLiveRef]),
});

async function fixture() {
  const diagnosticEvents = [];
  const actionCalls = [];
  const mutationCalls = [];
  let mutationFailure = null;
  let queryInstance = 0;
  const diagnosticsChannel = Object.freeze({
    emit(event) {
      diagnosticEvents.push(event);
      return event;
    },
  });
  const client = {
    liveQuery() {},
    async inspect() {
      return {
        targetProfileId: 'local-dev-sqlite-ibex',
        target: 'local-dev-sqlite-ibex',
        schema: { schemaHash: 'sha256:familiar-react-schema' },
        functions,
        capabilityManifest: {
          artifactKind: 'capabilityManifest',
          schemaVersion: 'snapback.v0',
          targetProfileId: 'local-dev-sqlite-ibex',
          supportedCapabilities: ['live_subscriptions'],
        },
      };
    },
    async authSession() { return { activeMode: 'dev' }; },
    diagnosticsChannel() { return diagnosticsChannel; },
    allocateLiveQueryNamespace(ref) {
      queryInstance += 1;
      return Object.freeze({
        clientStoreId: 'familiar-react-store',
        queryKey: ref.id,
        queryInstanceId: queryInstance,
      });
    },
    registerAuthBarrierParticipant() { return async () => {}; },
    liveStreamManager() { return { inspection: () => ({ socketDemand: 0 }) }; },
    startLiveQuery(ref, options) {
      let disposed = false;
      const rows = ref.id === scalarLiveRef.id
        ? Object.freeze([Object.freeze({ id: 'todo-1' })])
        : currentRows;
      const current = { rows, connection: 'live', retention: 'none' };
      queueMicrotask(() => {
        if (!disposed) options.onUpdate?.(current.rows, {});
      });
      return Object.freeze({
        current,
        started: async () => {},
        dispose() { disposed = true; },
        settled: async () => {},
      });
    },
    async releaseConnection() { return { released: true, attached: true }; },
    async run(ref, options) {
      actionCalls.push({ ref, options });
      return `ran:${ref.name}`;
    },
    async mutate(ref, options) {
      mutationCalls.push({ ref, options });
      if (mutationFailure !== null) throw mutationFailure;
      return `mutated:${ref.name}`;
    },
  };
  const binding = await prepareReactBindingForClient(client, { generatedManifest: functions });
  const listeners = new Set();
  const metrics = { descriptors: 0, subscriptions: 0, demands: 0, mutations: [] };
  let state = Object.freeze({
    status: 'ready',
    data: currentRows,
    error: null,
    connection: 'live',
    freshness: 'current',
    retention: null,
  });
  const skippedState = Object.freeze({
    status: 'skipped',
    data: undefined,
    error: null,
    connection: 'idle',
    freshness: 'unknown',
    retention: null,
  });
  const registry = Object.freeze({
    descriptor(ref, args) {
      metrics.descriptors += 1;
      return Object.freeze({ reference: ref, args, skipped: args === skip });
    },
    subscribe(descriptor, listener) {
      metrics.subscriptions += 1;
      if (!descriptor.skipped) metrics.demands += 1;
      listeners.add(listener);
      let released = false;
      return Object.freeze({
        release() {
          if (released) return;
          released = true;
          listeners.delete(listener);
          if (!descriptor.skipped) metrics.demands -= 1;
        },
      });
    },
    snapshot(descriptor) {
      if (!descriptor.skipped) return state;
      return skippedState;
    },
    mutationReference(ref) { return ref; },
    runMutation(ref, args, _optimistic, options) {
      metrics.mutations.push({ ref, args, options });
      return client.mutate(ref, { args, queue: options.queue });
    },
  });
  const provider = Object.freeze({
    kind: 'snapback.react-provider.v1',
    providerInstanceId: 'familiar-provider',
    binding,
    registry,
    start() { return provider; },
    async dispose() {},
  });
  return {
    actionCalls,
    client,
    diagnosticEvents,
    metrics,
    mutationCalls,
    provider,
    setMutationFailure(error) { mutationFailure = error; },
    setState(next) {
      state = Object.freeze(next);
      for (const listener of [...listeners]) listener();
    },
  };
}

function HookHost({ provider, children }) {
  return React.createElement(SnapbackProvider, { provider }, children);
}

class Boundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) { return { error }; }

  render() {
    return this.state.error === null ? this.props.children : null;
  }
}

test('the S6.2 projection table is total over every committed row', () => {
  const state = (overrides) => ({
    status: 'pending', data: undefined, error: null, connection: 'connecting',
    freshness: 'unknown', retention: null, ...overrides,
  });
  for (const row of [
    state({ status: 'ready', data: currentRows, connection: 'live', freshness: 'current' }),
    state({ status: 'refreshing', data: currentRows, connection: 'live', freshness: 'current' }),
  ]) assert.equal(classifyFamiliarQueryState(row), 'data');
  for (const row of [
    state({ status: 'ready', data: currentRows, connection: 'disconnected', freshness: 'current' }),
    state({ status: 'refreshing', data: currentRows, connection: 'stale', freshness: 'current' }),
    state({ status: 'refreshing', data: currentRows, connection: 'live', freshness: 'retained' }),
    state({ status: 'ready', data: currentRows, connection: 'live', freshness: 'snapshot' }),
    state({ status: 'pending' }),
    state({ status: 'skipped', connection: 'idle' }),
  ]) assert.equal(classifyFamiliarQueryState(row), 'empty');
  assert.equal(classifyFamiliarQueryState(state({ status: 'blocked' })), 'route');
  assert.equal(classifyFamiliarQueryState(state({
    status: 'error', connection: 'error', error: { code: 'SNAPBACK_REACT_QUERY_FAILED' },
  })), 'route');
  assert.equal(classifyFamiliarQueryState(state({
    status: 'error', connection: 'closed', error: { code: 'SNAPBACK_REACT_PROVIDER_CLOSED' },
  })), 'route');
  assert.equal(classifyFamiliarQueryState(state({
    status: 'error', connection: 'disconnected', error: { code: 'SNAPBACK_AUTH_PERMISSION_DENIED' },
  })), 'route');
  assert.equal(classifyFamiliarQueryState(state({
    status: 'error', connection: 'disconnected', error: { code: 'SNAPBACK_APP_REFUSAL' },
  })), 'throw');
});

test('mounted socket loss hides last-current data without throwing', async () => {
  const f = await fixture();
  const renders = [];
  const Probe = () => (renders.push(useQuery(liveRef, {})), null);
  let renderer;
  await act(async () => {
    renderer = TestRenderer.create(React.createElement(HookHost, { provider: f.provider }, React.createElement(Probe)));
    await flush();
  });
  assert.deepEqual(renders.at(-1), currentRows);
  await act(async () => {
    f.setState({
      status: 'refreshing', data: currentRows, error: null, connection: 'disconnected',
      freshness: 'current', retention: null,
    });
    await flush();
  });
  assert.equal(renders.at(-1), undefined);
  await act(async () => { renderer.unmount(); await flush(); });
});

test('authenticated-then-denied mounts as undefined with the useQueryState route', async () => {
  const f = await fixture();
  const previousNodeEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = 'development';
  const renders = [];
  const Probe = () => (renders.push(useQuery(liveRef, {})), null);
  let renderer;
  try {
    await act(async () => {
      renderer = TestRenderer.create(React.createElement(HookHost, { provider: f.provider }, React.createElement(Probe)));
      await flush();
    });
    await act(async () => {
      f.setState({
        status: 'error', data: undefined,
        error: { code: 'SNAPBACK_AUTH_PERMISSION_DENIED', message: 'denied' },
        connection: 'disconnected', freshness: 'unknown', retention: null,
      });
      await flush();
    });
    assert.equal(renders.at(-1), undefined);
    assert.equal(f.diagnosticEvents.at(-1).code, 'SNAPBACK_AUTH_PERMISSION_DENIED');
    assert.equal(f.diagnosticEvents.at(-1).details.route, 'useQueryState');
  } finally {
    process.env.NODE_ENV = previousNodeEnv;
    await act(async () => { renderer?.unmount(); await flush(); });
  }
});

test('throwing query classes rebuild SnapbackDiagnosticError during render', async () => {
  const f = await fixture();
  f.setState({
    status: 'error', data: undefined,
    error: { code: 'SNAPBACK_APP_REFUSAL', message: 'declared refusal', details: { appCode: 'NO_ROWS' } },
    connection: 'disconnected', freshness: 'unknown', retention: null,
  });
  const boundary = React.createRef();
  let attempts = 0;
  const recovered = [];
  const Probe = () => {
    attempts += 1;
    recovered.push(useQuery(liveRef, {}));
    return null;
  };
  let renderer;
  await withoutExpectedReactErrorLog(() => act(async () => {
    renderer = TestRenderer.create(React.createElement(
      HookHost,
      { provider: f.provider },
      React.createElement(Boundary, { ref: boundary }, React.createElement(Probe)),
    ));
    await flush();
  }));
  assert(boundary.current.state.error instanceof SnapbackDiagnosticError);
  assert.equal(boundary.current.state.error.code, 'SNAPBACK_APP_REFUSAL');
  assert(attempts >= 2, 'React retry rethrows while the canonical state stays throwing');
  await act(async () => {
    f.setState({
      status: 'ready', data: currentRows, error: null, connection: 'live',
      freshness: 'current', retention: null,
    });
    renderer.update(React.createElement(
      HookHost,
      { provider: f.provider },
      React.createElement(Boundary, { key: 'reset' }, React.createElement(Probe)),
    ));
    await flush();
  });
  assert.deepEqual(recovered.at(-1), currentRows);
  await act(async () => { renderer.unmount(); await flush(); });
});

test('string and symbol skip lower to one canonical zero-demand state', async () => {
  for (const spelling of ['skip', skip]) {
    const f = await fixture();
    const renders = [];
    const Probe = () => (renders.push(useQuery(liveRef, spelling)), null);
    let renderer;
    await act(async () => {
      renderer = TestRenderer.create(React.createElement(HookHost, { provider: f.provider }, React.createElement(Probe)));
      await flush();
    });
    assert.equal(renders.at(-1), undefined);
    assert.equal(f.metrics.demands, 0);
    await act(async () => { renderer.unmount(); await flush(); });
  }
});

test('cross-profile admission refuses before resources while canonical hooks admit familiar refs', async () => {
  const mismatch = await fixture();
  const boundary = React.createRef();
  const BadProbe = () => (useQuery(explicitLiveRef, {}), null);
  let badRenderer;
  await withoutExpectedReactErrorLog(() => act(async () => {
    badRenderer = TestRenderer.create(React.createElement(
      HookHost,
      { provider: mismatch.provider },
      React.createElement(Boundary, { ref: boundary }, React.createElement(BadProbe)),
    ));
    await flush();
  }));
  assert.equal(boundary.current.state.error?.code, 'SNAPBACK_CLIENT_REFERENCE_PROFILE_MISMATCH');
  assert.equal(mismatch.metrics.descriptors, 0);
  assert.equal(mismatch.metrics.subscriptions, 0);
  await act(async () => { badRenderer.unmount(); await flush(); });

  const admitted = await fixture();
  const canonicalProvider = createSnapbackReactCoreProvider(admitted.provider.binding, {
    connectionId: 'familiar-canonical-admission',
  });
  const states = [];
  const CanonicalProbe = () => (states.push(useSnapbackQuery(liveRef, {})), null);
  let renderer;
  await act(async () => {
    renderer = TestRenderer.create(React.createElement(
      HookHost,
      { provider: canonicalProvider },
      React.createElement(CanonicalProbe),
    ));
    await flush();
  });
  assert.equal(states.at(-1).status, 'ready');
  assert.deepEqual(states.at(-1).data, currentRows);
  await act(async () => { renderer.unmount(); await flush(); });
  await canonicalProvider.dispose();
});

test('scalar familiar query contracts project the one internal row as one object', async () => {
  const admitted = await fixture();
  const provider = createSnapbackReactCoreProvider(admitted.provider.binding, {
    connectionId: 'familiar-scalar-query',
  });
  const values = [];
  const Probe = () => (values.push(useQuery(scalarLiveRef, {})), null);
  let renderer;
  await act(async () => {
    renderer = TestRenderer.create(React.createElement(
      HookHost,
      { provider },
      React.createElement(Probe),
    ));
    await flush();
  });
  assert.deepEqual(values.at(-1), { id: 'todo-1' });
  await act(async () => { renderer.unmount(); await flush(); });
  await provider.dispose();
});

test('settled mutations use queue:false and harden pre-custody transport rejection', async () => {
  const f = await fixture();
  let mutate;
  const Probe = () => { mutate = useMutation(mutationRef); return null; };
  let renderer;
  await act(async () => {
    renderer = TestRenderer.create(React.createElement(HookHost, { provider: f.provider }, React.createElement(Probe)));
    await flush();
  });
  assert.equal(await mutate({ title: 'one' }), 'mutated:todos.create');
  assert.equal(f.metrics.mutations.at(-1).options.queue, false);
  f.setMutationFailure(new TypeError('offline before dispatch'));
  await assert.rejects(mutate({ title: 'two' }), (error) => (
    error instanceof SnapbackDiagnosticError
      && error.operation === 'mutation'
      && error.diagnostic.details.route.dispatch === 'useSnapbackMutation'
      && error.diagnostic.details.route.status === 'useSnapbackOutbox().mutationStatus'
  ));
  assert.equal(f.metrics.mutations.at(-1).options.queue, false);
  await act(async () => { renderer.unmount(); await flush(); });
});

test('actions call the provider client only at invocation and own no task state', async () => {
  const f = await fixture();
  let run;
  const Probe = () => { run = useAction(actionRef); return null; };
  let renderer;
  await act(async () => {
    renderer = TestRenderer.create(React.createElement(HookHost, { provider: f.provider }, React.createElement(Probe)));
    await flush();
  });
  assert.equal(f.actionCalls.length, 0);
  assert.equal(await run({}), 'ran:todos.rebuild');
  assert.deepEqual(f.actionCalls[0], { ref: actionRef, options: { args: {} } });
  assert.equal('task' in run, false);
  await act(async () => { renderer.unmount(); await flush(); });
});

test('familiar entry preserves canonical identities and allocates no second owner', () => {
  assert.equal(SnapbackProvider, RootCanonicalProvider);
  assert.equal(useQueryState, useSnapbackQuery);
  assert.equal(useAuth, useSnapbackAuth);
  assert.equal(useCurrentPrincipal, useSnapbackCurrentPrincipal);
  assert.equal(skip, canonicalSkip);
  const source = readFileSync(new URL('familiar.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /\b(?:createContext|SnapbackClient|createCache|createOutbox|AuthCoordinator|createTask)\b/u);
  assert.doesNotMatch(source, /\bnew\s+(?!SnapbackDiagnosticError\b)/u);
});

test('the closed error table covers all registered auth denials and reserves app refusal codes', () => {
  const registry = JSON.parse(readFileSync(
    new URL('../../guide/reference/diagnostics-registry.json', import.meta.url),
    'utf8',
  )).diagnostics;
  const unavailable = new Set(FAMILIAR_QUERY_ERROR_CLASSES.authorizationDenialCodes);
  const registeredDenials = Object.values(registry)
    .filter(({ code, httpStatus }) => code.startsWith('SNAPBACK_AUTH_') && [401, 403].includes(httpStatus))
    .map(({ code }) => code);
  for (const code of registeredDenials) assert(unavailable.has(code), code);

  const throwingCodes = new Set(Object.keys(registry).filter((code) => (
    classifyFamiliarQueryState({
      status: 'error', data: undefined, error: { code }, connection: 'disconnected',
      freshness: 'unknown', retention: null,
    }) === 'throw'
  )));
  for (const code of unavailable) assert.equal(throwingCodes.has(code), false, code);

  assert.throws(
    () => defineJsMutation({
      args: {}, writes: ['todos'], handler: async () => null,
      refusals: ['SNAPBACK_APP_CODE_FORBIDDEN'],
    }),
    /must not use the reserved SNAPBACK_ namespace/u,
  );
});
