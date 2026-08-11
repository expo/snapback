import assert from 'node:assert/strict';

import { createKeyedSnapbackContractProvider } from './keyed-provider.mjs';
import { createSnapbackContractSurface } from './index.mjs';
import {
  createSnapbackProviderDiagnostic,
  createSnapbackProviderDiagnosticCollector,
  createSnapbackProviderDiagnosticError,
} from './diagnostics.mjs';

const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
};

const runtime = {
  createProviderQueryHandle(provider, name, args) {
    return { subscribe(observer) { return provider.subscribe(name, args, observer); } };
  },
  createProviderMutation(provider, name) {
    return (args) => provider.mutate(name, args, { actionInvocationId: 'action-1' });
  },
  rotatePartition(provider) {
    runtime.rotations.push(provider.partitionId());
    return provider.partitionId();
  },
  rotations: [],
};

const manifest = {
  artifactKind: 'contractDataManifest',
  manifestVersion: 2,
  provider: 'snapback-test',
  queries: {
    eventDetails: { name: 'eventDetails', mode: 'live', livePush: true },
    eventWall: { name: 'eventWall', mode: 'live', livePush: true },
  },
  mutations: { rsvp: { name: 'rsvp' } },
};

const opens = [];
const client = {
  liveQuery(name, options) {
    const opened = deferred();
    opens.push({ name, options, opened, disposed: 0 });
    return opened.promise;
  },
  async mutate(name, options) {
    return { name, options };
  },
};

const surface = createKeyedSnapbackContractProvider({
  runtime,
  client,
  manifest,
  userId: 'user-a',
  keyedQueries: ['eventDetails', 'eventWall'],
  rootId: 'root-test',
});

const firstCells = [];
const secondCells = [];
const first = surface.links.eventDetails({ eventId: 'event-a' }).subscribe((cell) => firstCells.push(cell));
const second = surface.links.eventDetails({ eventId: 'event-b' }).subscribe((cell) => secondCells.push(cell));
await Promise.resolve();
assert.deepEqual(opens.map(({ options }) => options.args), [
  { eventId: 'event-a' },
  { eventId: 'event-b' },
], 'binding-time arguments, not boot arguments, select the transport scope');

opens[0].opened.resolve({
  rows: [{ _id: 'event-a' }],
  connection: 'live',
  dispose() { opens[0].disposed += 1; },
});
opens[1].opened.resolve({
  rows: [{ _id: 'event-b' }],
  connection: 'live',
  dispose() { opens[1].disposed += 1; },
});
await Promise.resolve();
assert.deepEqual(firstCells.at(-1).value, [{ _id: 'event-a' }]);
assert.deepEqual(secondCells.at(-1).value, [{ _id: 'event-b' }]);

opens[0].options.onUpdate([{ _id: 'event-a', title: 'new' }]);
assert.deepEqual(firstCells.at(-1).value, [{ _id: 'event-a', title: 'new' }]);
assert.deepEqual(secondCells.at(-1).value, [{ _id: 'event-b' }], 'different scopes stay isolated');

const partitionBefore = surface.provider.partitionId();
const partitionAfter = surface.rotateAuthority({ userId: 'user-b', authorityCapture: { epoch: 2 } });
assert.notEqual(partitionAfter, partitionBefore);
assert.equal(runtime.rotations.length, 1);

const mutation = await surface.links.rsvp({ eventId: 'event-b', status: 'going' });
assert.equal(mutation.ok, true);
assert.equal(mutation.value.options.userId, 'user-b');
assert.equal(mutation.value.options.queue, false);
assert.deepEqual(mutation.value.options.authorityCapture, { epoch: 2 });
assert.equal(mutation.value.options.correlation.actionInvocationId, 'action-1');
assert.equal(mutation.value.options.correlation.rootId, 'root-test');

const lateCells = [];
const late = surface.links.eventWall({ eventId: 'event-a' }).subscribe((cell) => lateCells.push(cell));
await Promise.resolve();
late.dispose();
opens[2].opened.resolve({
  rows: [{ _id: 'late' }],
  connection: 'live',
  dispose() { opens[2].disposed += 1; },
});
await Promise.resolve();
assert.equal(opens[2].disposed, 1, 'a handle that resolves after binding disposal is immediately closed');
assert.equal(lateCells.length, 1, 'late initial data cannot publish after disposal');

const unconfigured = [];
const denied = surface.links.eventWall({ eventId: 'event-c' }).subscribe((cell) => unconfigured.push(cell));
denied.dispose();
assert.equal(opens.length, 4, 'configured second descriptor opens normally');

first.dispose();
second.dispose();
surface.dispose();
assert.equal(opens[0].disposed, 1);
assert.equal(opens[1].disposed, 1);
assert.equal(surface.disposed, true);

const factoryOpens = [];
const factorySurface = await createSnapbackContractSurface({
  runtime,
  client: {
    liveQuery(name, options) {
      factoryOpens.push({ name, options });
      return Promise.resolve({ rows: [{ _id: options.args.eventId }], connection: 'live', dispose() {} });
    },
    async mutate() {},
  },
  userId: 'factory-user',
  manifest,
  liveQueries: [{ name: 'eventDetails', args: { eventId: 'legacy-boot-scope' } }],
  keyedQueryScopes: true,
});
assert.equal(factoryOpens.length, 0, 'keyed surface does not preopen a boot-scoped singleton');
const factoryCells = [];
const factoryBinding = factorySurface.links.eventDetails({ eventId: 'binding-scope' })
  .subscribe((cell) => factoryCells.push(cell));
await Promise.resolve();
assert.deepEqual(factoryOpens[0].options.args, { eventId: 'binding-scope' });
factoryBinding.dispose();
await factorySurface.dispose();

// The capability-scoped entrypoint keeps the same fail-closed generated
// artifact identity checks as the full surface.
assert.throws(
  () => createKeyedSnapbackContractProvider({
    runtime,
    client,
    manifest: { ...manifest, bundleHash: 'old-bundle' },
    functionManifest: { bundleHash: 'current-bundle' },
    userId: 'artifact-user',
  }),
  (error) => error?.code === 'SNAPBACK_STALE_CONTRACT_DATA_BUNDLE_HASH',
);

// Exact-compatible force states are local-only, scope-aware, and restore the
// newest suppressed live cell. A binding mounted while forced must not
// allocate a Snapback transport until the force is released.
const forceOpens = [];
const forceSurface = createKeyedSnapbackContractProvider({
  runtime,
  client: {
    liveQuery(name, options) {
      const handle = {
        rows: [{ _id: options.args.eventId, title: 'baseline' }],
        connection: 'live',
        dispose() {},
      };
      forceOpens.push({ name, options, handle });
      return Promise.resolve(handle);
    },
    async mutate() {},
  },
  manifest,
  userId: 'force-user',
  keyedQueries: ['eventDetails'],
});
const forcedCell = { status: 'error', error: { message: 'forced' }, connection: 'disconnected' };
const scopedForce = forceSurface.provider.forceQueryState(
  'eventDetails',
  forcedCell,
  { scope: { eventId: 'event-a' } },
);
const forcedCells = [];
const unforcedCells = [];
const forcedSubscription = forceSurface.links.eventDetails({ eventId: 'event-a' })
  .subscribe((cell) => forcedCells.push(cell));
const unforcedSubscription = forceSurface.links.eventDetails({ eventId: 'event-b' })
  .subscribe((cell) => unforcedCells.push(cell));
await Promise.resolve();
await Promise.resolve();
assert.equal(forceOpens.length, 1, 'a scope mounted under force stays local-only');
assert.equal(forceOpens[0].options.args.eventId, 'event-b');
assert.deepEqual(forcedCells, [forcedCell]);
assert.equal(unforcedCells.at(-1).value[0]._id, 'event-b');

scopedForce.dispose();
await Promise.resolve();
await Promise.resolve();
assert.equal(forceOpens.length, 2, 'releasing the force starts the deferred live source');
assert.equal(forcedCells.at(-1).value[0]._id, 'event-a');

const broadcastForce = forceSurface.provider.forceQueryState('eventDetails', forcedCell);
assert.deepEqual(forcedCells.at(-1), forcedCell);
assert.deepEqual(unforcedCells.at(-1), forcedCell);
forceOpens[1].options.onUpdate([{ _id: 'event-a', title: 'suppressed newest' }]);
assert.deepEqual(forcedCells.at(-1), forcedCell, 'live cells stay suppressed while forced');
broadcastForce.dispose();
assert.equal(forcedCells.at(-1).value[0].title, 'suppressed newest');
assert.equal(unforcedCells.at(-1).value[0].title, 'baseline');
forcedSubscription.dispose();
unforcedSubscription.dispose();
forceSurface.dispose();

// The provider handoff is Exact DataProviderDiagnostic-compatible, carries a
// source Exact can recover from a thrown refusal, and emits one report per
// root/instance/cause rather than one entry per reactive tick.
const diagnosticSource = {
  file: 'demos/partiful-matrix/surfaces/contract/event.contract',
  line: 30,
  column: 5,
  generatedFrom: 'snapback/generated/api.mjs#rsvp',
};
const diagnostic = createSnapbackProviderDiagnostic(
  'SNAPBACK_CONTRACT_MUTATION_FAILED',
  'the RSVP action was rejected',
  {
    provider: 'snapback-partitime',
    owner: 'provider',
    mutationName: 'rsvp',
    source: diagnosticSource,
    details: { rollbackReason: 'event_full' },
  },
);
assert.equal(diagnostic.provider, 'snapback-partitime');
assert.equal(diagnostic.owner, 'provider');
assert.equal(diagnostic.mutationName, 'rsvp');
assert.deepEqual(diagnostic.source, diagnosticSource);
assert.equal(diagnostic.details.target_surface, 'Contract/Exact');

const diagnosticFailure = createSnapbackProviderDiagnosticError(
  diagnostic.code,
  diagnostic.message,
  {
    provider: diagnostic.provider,
    owner: diagnostic.owner,
    mutationName: diagnostic.mutationName,
    source: diagnostic.source,
  },
);
assert.equal(diagnosticFailure.code, diagnostic.code);
assert.equal(diagnosticFailure.source, diagnosticFailure.diagnostic.source);

const diagnosticCollector = createSnapbackProviderDiagnosticCollector({ rootId: 'partitime-root' });
const firstReport = diagnosticCollector.record(diagnosticFailure, {
  instanceId: 'rsvp-binding-1',
  causeCode: 'event_full',
});
const repeatedReport = diagnosticCollector.record(diagnosticFailure, {
  instanceId: 'rsvp-binding-1',
  causeCode: 'event_full',
});
assert.equal(firstReport, repeatedReport);
assert.equal(diagnosticCollector.diagnostics().length, 1);
assert.equal(firstReport.occurrences, 2);
assert(firstReport.diagnosticDedupeKey.includes('rsvp-binding-1'));
diagnosticCollector.record(diagnosticFailure, {
  instanceId: 'rsvp-binding-1',
  causeCode: 'network_timeout',
});
assert.equal(diagnosticCollector.diagnostics().length, 2);

console.log('snapback keyed Contract provider: binding args, isolation, rotation, and late disposal pass');
