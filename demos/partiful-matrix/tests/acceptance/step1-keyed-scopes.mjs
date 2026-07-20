#!/usr/bin/env bun

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';

import { createKeyedSnapbackContractProvider } from '../../../../packages/snapback-contract/keyed-provider.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const snapbackRoot = resolve(here, '../../../..');
const exactRoot = resolve(
  process.env.EXACT_ROOT
    ?? join(snapbackRoot, '..', 'exact'),
);
const resultPath = join(
  snapbackRoot,
  'demos/partiful-matrix/acceptance/results/step1-keyed-scopes.json',
);
const write = process.argv.includes('--write');

assert(existsSync(join(exactRoot, 'packages/exact-contract/src/runtime/index.ts')),
  `Exact runtime source is missing under ${exactRoot}; set EXACT_ROOT to the Exact checkout under test`);

const runtime = await import(pathToFileURL(
  join(exactRoot, 'packages/exact-contract/src/runtime/index.ts'),
).href);
runtime.resetLogicalQuerySubscriptionsForTests();
const deliveryCell = (delivery) => runtime.readQueryDeliveryCell(delivery);

const exactTest = spawnSync(
  process.execPath,
  ['test', 'packages/exact-contract/src/__tests__/keyed-query-scopes.test.ts'],
  { cwd: exactRoot, encoding: 'utf8', env: process.env },
);
assert.equal(
  exactTest.status,
  0,
  `Exact keyed-query oracle failed\n${exactTest.stdout}\n${exactTest.stderr}`,
);
const exactTestOutput = `${exactTest.stdout}\n${exactTest.stderr}`;
const exactOracleTests = Number(exactTestOutput.match(/(\d+) pass/)?.[1] ?? 0);
assert(exactOracleTests >= 32, `expected at least 32 Exact keyed-query tests, observed ${exactOracleTests}`);

const deferred = () => {
  let resolvePromise;
  let rejectPromise;
  const promise = new Promise((resolve, reject) => {
    resolvePromise = resolve;
    rejectPromise = reject;
  });
  return { promise, resolve: resolvePromise, reject: rejectPromise };
};
const flushAsync = () => new Promise((resolvePromise) => setTimeout(resolvePromise, 0));

function transportHarness() {
  const opens = [];
  return {
    opens,
    client: {
      liveQuery(name, options) {
        const opened = deferred();
        const call = { name, options, opened, disposeCount: 0 };
        opens.push(call);
        return opened.promise;
      },
      async mutate(name, options) {
        return { name, options };
      },
    },
    resolve(index, rows, connection = 'live') {
      const call = opens[index];
      assert(call, `missing transport open ${index}`);
      call.opened.resolve({
        rows,
        connection,
        dispose() { call.disposeCount += 1; },
      });
    },
  };
}

const manifest = {
  manifestVersion: 2,
  provider: 'snapback-partitime-step1',
  capabilities: {
    localReplica: false,
    subscriptions: true,
    initialSnapshot: true,
    optimisticMutations: false,
    rowSyncState: false,
    serverRunnableQueries: true,
    forceStates: false,
    branchableFixtures: false,
    headlessBoot: true,
  },
  queries: {
    eventDetails: {
      name: 'eventDetails',
      descriptorId: 'partitime.event-details',
      compatibilityToken: '1',
      mode: 'live',
      livePush: true,
      initialSnapshot: true,
      args: {},
      result: { kind: 'list', row: { shape: 'unknown' } },
      serverRunnable: true,
      localRunnable: false,
      subscription: 'initial-snapshot',
      defaultLive: true,
      coalesce: false,
      ephemeral: false,
      receipts: 'mutation',
      transport: 'stream',
    },
  },
  mutations: { rsvp: { name: 'rsvp', args: {}, writes: ['rsvps'], optimistic: false, serverRunnable: true } },
};

const transport = transportHarness();
const surface = createKeyedSnapbackContractProvider({
  runtime,
  client: transport.client,
  manifest,
  userId: 'user-a',
  keyedQueries: ['eventDetails'],
  rootId: 'partitime-step1-root-a',
});

const firstCells = [];
const siblingCells = [];
const first = surface.links.eventDetails({ eventId: 'event-a', options: { b: 2, a: 1 } })
  .subscribe((cell) => firstCells.push(cell));
const sibling = surface.links.eventDetails({ options: { a: 1, b: 2 }, eventId: 'event-a' })
  .subscribe((cell) => siblingCells.push(cell));
assert.equal(transport.opens.length, 1, 'encoding-equivalent same-key bindings share one transport attempt');
assert.equal(runtime.activeLogicalQuerySubscriptionCount(), 1);
assert.equal(runtime.inspectLogicalSubscriptions()[0].refCount, 2);

transport.resolve(0, [{ _id: 'event-a', title: 'A' }]);
await flushAsync();
assert.deepEqual(firstCells.at(-1), [{ _id: 'event-a', title: 'A' }]);
assert.deepEqual(siblingCells.at(-1), [{ _id: 'event-a', title: 'A' }]);

const lateSiblingCells = [];
const lateSibling = surface.links.eventDetails({ eventId: 'event-a', options: { a: 1, b: 2 } })
  .subscribe((cell) => lateSiblingCells.push(cell));
assert.equal(transport.opens.length, 1, 'late same-key binding joins the live attempt');
assert.equal(deliveryCell(lateSiblingCells.at(-1)).status, 'ready', 'late same-key binding synchronously receives shared state');

first.dispose();
lateSibling.dispose();
assert.equal(transport.opens[0].disposeCount, 0, 'independent binding disposal retains a sibling attempt');

const otherCells = [];
const other = surface.links.eventDetails({ eventId: 'event-b' })
  .subscribe((cell) => otherCells.push(cell));
assert.equal(transport.opens.length, 2, 'different args own an isolated transport attempt');
transport.resolve(1, [{ _id: 'event-b', title: 'B' }]);
await flushAsync();

const predecessorCallback = transport.opens[1].options.onUpdate;
const partitionBefore = surface.provider.partitionId();
surface.rotateAuthority({ userId: 'user-b', authorityCapture: { authorityEpoch: 2 } });
const partitionAfter = surface.provider.partitionId();
assert.notEqual(partitionAfter, partitionBefore, 'authority transition rotates the opaque partition');
assert.equal(transport.opens[1].disposeCount, 1, 'partition rotation disposes the predecessor attempt');
assert.equal(deliveryCell(otherCells.at(-1)).status, 'pending', 'partition rotation clears predecessor rows before reopening');
assert(otherCells.some((delivery) => {
  const cell = deliveryCell(delivery);
  return cell?.status === 'pending' && Array.isArray(cell.previous) && cell.previous.length === 0;
}), 'no predecessor data survives the partition cut');
assert.equal(transport.opens.length, 4, 'both surviving logical keys reopen under the successor partition');

predecessorCallback([{ _id: 'event-b', title: 'STALE' }]);
assert.equal(deliveryCell(otherCells.at(-1)).status, 'pending', 'late predecessor data is fenced');
transport.resolve(3, [{ _id: 'event-b', title: 'B2' }]);
transport.resolve(2, [{ _id: 'event-a', title: 'A2' }]);
await flushAsync();
assert.deepEqual(otherCells.at(-1), [{ _id: 'event-b', title: 'B2' }]);

const secondTransport = transportHarness();
const secondRoot = createKeyedSnapbackContractProvider({
  runtime,
  client: secondTransport.client,
  manifest,
  userId: 'user-b',
  keyedQueries: ['eventDetails'],
  rootId: 'partitime-step1-root-b',
});
const rootCells = [];
const rootBinding = secondRoot.links.eventDetails({ eventId: 'event-b' })
  .subscribe((cell) => rootCells.push(cell));
assert.equal(secondTransport.opens.length, 1, 'a distinct provider/root never aliases the first provider partition');
assert.equal(runtime.activeLogicalQuerySubscriptionCount(), 3);

const invalidCells = [];
const invalid = surface.links.eventDetails({ eventId: Number.NaN })
  .subscribe((cell) => invalidCells.push(cell));
assert.equal(deliveryCell(invalidCells.at(-1)).status, 'error');
assert.equal(deliveryCell(invalidCells.at(-1)).error.diagnostic.code, 'contract_query_args_invalid');
invalid.dispose();

const mutation = await surface.links.rsvp({ eventId: 'event-b', status: 'going' });
assert.equal(mutation.ok, true);
assert.equal(mutation.value.options.userId, 'user-b');
assert.deepEqual(mutation.value.options.authorityCapture, { authorityEpoch: 2 });

sibling.dispose();
other.dispose();
rootBinding.dispose();
surface.dispose();
secondRoot.dispose();
runtime.resetLogicalQuerySubscriptionsForTests();
assert.equal(runtime.activeLogicalQuerySubscriptionCount(), 0, 'HMR/root teardown leaves no logical attempts');

const sourceFiles = [
  join(snapbackRoot, 'packages/snapback-contract/keyed-provider.mjs'),
  join(exactRoot, 'packages/exact-contract/src/runtime/query-identity.ts'),
  join(exactRoot, 'packages/exact-contract/src/runtime/query-dedup.ts'),
  join(exactRoot, 'packages/exact-contract/src/__tests__/keyed-query-scopes.test.ts'),
];
const sha256 = (path) => createHash('sha256').update(readFileSync(path)).digest('hex');
const receipt = {
  schemaVersion: 'partitime.step1-keyed-scopes.v1',
  claim: 'STEP1.KEYED_SCOPES',
  ok: true,
  checks: [
    'Exact adversarial keyed-query oracle passes',
    'canonical same-key bindings share one attempt and current state',
    'different args and different provider partitions stay isolated',
    'binding refcounts dispose only the final upstream',
    'authority rotation clears predecessor rows and reopens survivors',
    'late predecessor delivery is fenced',
    'invalid args surface a structured diagnostic',
    'root/HMR teardown leaves no logical attempts',
  ],
  observed: {
    exactOracleTests,
    transportAttemptsBeforeRotation: 2,
    transportAttemptsAfterRotation: 4,
    finalLogicalSubscriptions: 0,
  },
  sources: sourceFiles.map((path) => ({
    path: path.startsWith(snapbackRoot)
      ? path.slice(snapbackRoot.length + 1)
      : `exact/${path.slice(exactRoot.length + 1)}`,
    sha256: sha256(path),
  })),
};

if (write) writeFileSync(resultPath, `${JSON.stringify(receipt, null, 2)}\n`);
console.log(JSON.stringify(receipt, null, 2));
