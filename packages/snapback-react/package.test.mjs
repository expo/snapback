import assert from 'node:assert/strict';
import React, { StrictMode } from 'react';
import TestRenderer, { act } from 'react-test-renderer';

import { useSnapbackQuery } from './index.mjs';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const flush = () => new Promise((resolve) => setImmediate(resolve));
const observers = new Map();
let subscriptionSequence = 0;
let disposed = 0;
let latestQuery = null;
const provider = {
  backend: 'react-package-test',
  externalStoreProtocol: 'snapback.external-store.v1',
  async subscribe(name, args, userId, observer) {
    const id = ++subscriptionSequence;
    observers.set(id, observer);
    observer([{ id: args.eventId ?? 'feed', userId }], 'live');
    return {
      rows: [{ id: args.eventId ?? 'feed', userId }],
      dispose() {
        disposed += 1;
        observers.delete(id);
      },
    };
  },
  async mutate(name, args) { return { name, args }; },
};

function Probe({ eventId }) {
  const query = useSnapbackQuery({
    provider,
    name: 'eventDetails',
    args: { eventId },
    userId: 'alice',
  });
  latestQuery = query;
  return React.createElement('output', {
    status: query.status,
    connection: query.connection,
    value: query.rows[0]?.id ?? 'none',
  });
}

function Pair({ first, second }) {
  return React.createElement(
    React.Fragment,
    null,
    React.createElement(Probe, { key: 'first', eventId: first }),
    React.createElement(Probe, { key: 'second', eventId: second }),
  );
}

function InvalidProviderProbe({ invalidProvider }) {
  useSnapbackQuery({ provider: invalidProvider, name: 'eventDetails' });
  return null;
}

for (const invalidProvider of [
  { ...provider, externalStoreProtocol: undefined },
  { ...provider, externalStoreProtocol: 'snapback.external-store.v2' },
]) {
  await assert.rejects(
    async () => {
      await act(async () => {
        TestRenderer.create(React.createElement(InvalidProviderProbe, { invalidProvider }));
        await flush();
      });
    },
    (error) => error?.code === 'SNAPBACK_EXTERNAL_STORE_INCOMPATIBLE',
    'missing and incompatible provider protocols refuse before subscribing',
  );
}
assert.equal(subscriptionSequence, 0, 'protocol refusal never starts an upstream subscription');

let renderer;
await act(async () => {
  renderer = TestRenderer.create(React.createElement(StrictMode, null, React.createElement(Probe, { eventId: 'a' })));
  await flush();
});
let output = renderer.root.findByType('output');
assert.equal(output.props.status, 'ready');
assert.equal(output.props.connection, 'live');
assert.equal(output.props.value, 'a');
assert(subscriptionSequence >= 2, 'React StrictMode replays the shared store subscription');
assert(disposed >= 1, 'StrictMode cleanup disposes its first handle');

await act(async () => {
  await latestQuery.mutate('createEvent', { eventId: 'optimistic' }, {
    id: 'connection-only-does-not-reconcile',
    optimisticRows: (rows) => [...rows, { id: 'optimistic' }],
  });
  await flush();
});
assert(latestQuery.rows.some((row) => row.id === 'optimistic'));
const activeObserver = [...observers.values()][0];
await act(async () => {
  activeObserver([{ id: 'a', userId: 'alice' }], 'stale', { kind: 'connection' });
  await flush();
});
assert.equal(latestQuery.connection, 'stale');
assert(
  latestQuery.rows.some((row) => row.id === 'optimistic'),
  'a connection-only transition cannot retire a confirmed optimistic layer',
);
await act(async () => {
  activeObserver([{ id: 'a', userId: 'alice' }], 'live', { kind: 'authoritative' });
  await flush();
});
assert(!latestQuery.rows.some((row) => row.id === 'optimistic'));

await act(async () => {
  renderer.update(React.createElement(StrictMode, null, React.createElement(Pair, { first: 'a', second: 'a' })));
  await flush();
});
assert.equal(observers.size, 1, 'same-key sibling components share one logical upstream attempt');

await act(async () => {
  renderer.update(React.createElement(StrictMode, null, React.createElement(Pair, { first: 'b', second: 'b' })));
  await flush();
});
assert.equal(observers.size, 1, 'replacement same-key siblings still share one attempt');
assert(renderer.root.findAllByType('output').every((node) => node.props.value === 'b'));

await act(async () => {
  renderer.update(React.createElement(StrictMode, null, React.createElement(Pair, { first: 'a', second: 'b' })));
  await flush();
});
assert.equal(observers.size, 2, 'different keys remain independently subscribed');
assert.deepEqual(renderer.root.findAllByType('output').map((node) => node.props.value), ['a', 'b'], 'A to B to A identity replay remains live');

const subscriptionsBeforeUnmount = subscriptionSequence;
await act(async () => { renderer.unmount(); await flush(); });
assert.equal(observers.size, 0, 'unmount leaves no upstream subscriptions');
assert(disposed >= subscriptionsBeforeUnmount, 'every resolved handle is disposed');

console.log('package.test.mjs: React external-store binding passes StrictMode, identity, and unmount checks');
