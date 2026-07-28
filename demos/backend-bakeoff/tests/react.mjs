// @ref LLP 0106#package-and-acceptance — retained, zero-skip evidence for
// React presence, optimistic ordering, SSR/hosted refusals, and exact cleanup.
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { SnapbackClient } from '@snapback/client';
import {
  AuthCoordinator,
  createMemoryAuthCustodyStorage,
} from '@snapback/contract';
import { resolveGeneratedArtifact } from '@snapback/codegen/review-surface';
import {
  SnapbackProvider,
  createSnapbackReactProvider,
  invokeSnapbackMutation,
  observeSnapbackPresence,
  observeSnapbackQueries,
  skip,
  useSnapbackPresence,
} from '@snapback/react';
import React from '../../../node_modules/react/index.js';
import { renderToString } from '../../../node_modules/react-dom/server.node.js';

import { startServer } from '../../_kit/server-process.mjs';
import { assert, assertEqual, createSuite, runAcceptance } from '../../_kit/harness.mjs';
import { prepareReactBindingForClient } from '../../../packages/snapback-client/react-binding.mjs';
import { resetInstallGeneratedSeed } from '../scripts/versioned-seed.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const demoRoot = join(here, '..');
const repoRoot = join(demoRoot, '..', '..');
const generatedRoot = join(demoRoot, 'snapback', 'generated');
const receiptPath = join(demoRoot, 'acceptance', 'results', 'react-presence.v1.json');
const generated = (name) =>
  JSON.parse(readFileSync(resolveGeneratedArtifact(generatedRoot, name), 'utf8'));
const { default: api, ephemeral } = await import(
  pathToFileURL(resolveGeneratedArtifact(generatedRoot, 'api.mjs')).href
);
const schema = generated('schema.manifest.json');
const functions = generated('functions.manifest.json');
const capabilityManifest = generated('capability.manifest.json');
const seedArtifact = generated('seed.artifact.json');
const suite = createSuite('backend bakeoff / Snapback React presence v1', {
  expectedChecks: 10,
});
const cleanups = [];
const flush = () => new Promise((resolve) => setImmediate(resolve));
const clone = (value) => structuredClone(value);

const until = async (predicate, label, timeoutMs = 5_000) => {
  const deadline = performance.now() + timeoutMs;
  while (performance.now() < deadline) {
    const value = await predicate();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`timed out waiting for ${label}`);
};

const canonicalJson = (value) => JSON.stringify(value, (_key, child) => (
  child && typeof child === 'object' && !Array.isArray(child)
    ? Object.fromEntries(Object.keys(child).sort().map((key) => [key, child[key]]))
    : child
));

const sha256 = (value) => `sha256:${createHash('sha256').update(value).digest('hex')}`;

function packageDigest(packageRoot) {
  const packagePath = relative(repoRoot, packageRoot);
  const files = execFileSync(
    'git',
    ['ls-files', '-z', '--', packagePath],
    { cwd: repoRoot },
  )
    .toString('utf8')
    .split('\0')
    .filter(Boolean)
    .map((path) => relative(packageRoot, join(repoRoot, path)))
    .sort();
  assert(files.includes('package.json'), `${packagePath} package manifest is tracked`);
  const hash = createHash('sha256');
  for (const path of files) {
    const bytes = readFileSync(join(packageRoot, path));
    hash.update(`${path}\0${bytes.byteLength}\0`);
    hash.update(bytes);
  }
  return Object.freeze({
    algorithm: 'sha256-git-tracked-package-tree.v1',
    files: Object.freeze(files),
    digest: `sha256:${hash.digest('hex')}`,
  });
}

function functionIdentity(reference) {
  return Object.freeze({
    id: reference.id,
    name: reference.name,
    kind: reference.kind,
    implementationHash: reference.implementationHash,
    argsContractHash: reference.argsContractHash,
    resultContractHash: reference.resultContractHash,
  });
}

function authCoordinator() {
  return new AuthCoordinator({
    appId: schema.appId,
    storage: createMemoryAuthCustodyStorage(),
    broadcastChannelFactory: null,
    hintStorage: null,
  });
}

async function receiptClient(server, clientStoreId) {
  const client = new SnapbackClient(server.baseUrl, {
    ...server.clientOptions,
    authCoordinator: authCoordinator(),
    authInvalidationProtocol: 1,
    authorityDescriptorProtocol: 1,
    authorizedLeaseProtocol: 1,
    clientStoreId,
  });
  cleanups.push(() => client.closeAuth());
  await client.authSession();
  return client;
}

function deterministicOptimisticClient(inspection, initialRows) {
  const handles = new Set();
  const attempts = [];
  const ordering = [];
  let rows = clone(initialRows);
  return {
    liveQuery() {},
    async inspect() { return inspection; },
    async authSession() { return { activeMode: 'sessions' }; },
    registerAuthBarrierParticipant() { return async () => {}; },
    liveStreamManager() {
      return { close() {}, async settled() {} };
    },
    disconnect() { return Promise.resolve(); },
    startLiveQuery(_reference, options) {
      const current = { rows: clone(rows), connection: 'live' };
      const handle = {
        current,
        started: async () => {},
        dispose() { handles.delete(handle); },
        settled: async () => {},
        emit(nextRows) {
          current.rows = clone(nextRows);
          options.onUpdate(clone(nextRows));
        },
      };
      handles.add(handle);
      queueMicrotask(() => options.onUpdate(clone(current.rows)));
      return Object.freeze(handle);
    },
    mutate(_reference, options) {
      let resolve;
      let reject;
      const promise = new Promise((yes, no) => {
        resolve = (result) => {
          ordering.push(`response:${attempts.length - 1}`);
          yes({ result, version: attempts.length });
        };
        reject = no;
      });
      attempts.push({ options, resolve, reject });
      return promise;
    },
    emit(nextRows, label) {
      rows = clone(nextRows);
      ordering.push(`query:${label}`);
      for (const handle of handles) handle.emit(rows);
    },
    inspection() {
      return { attempts, ordering, handles: handles.size };
    },
  };
}

const receiptExtra = {
  schemaVersion: 'snapback.react-presence-receipt.v1',
  generatedAt: new Date().toISOString(),
  sourceRevision: execFileSync('git', ['rev-parse', 'HEAD'], {
    cwd: repoRoot,
    encoding: 'utf8',
  }).trim(),
  target: null,
  app: Object.freeze({
    appId: schema.appId,
    schemaHash: schema.schemaHash,
    bundleHash: functions.bundleHash,
  }),
  functions: Object.freeze({
    query: functionIdentity(api.allTasks),
    mutation: functionIdentity(api.toggleTask),
  }),
  collection: Object.freeze({
    id: ephemeral.incidentPresence.id,
    name: ephemeral.incidentPresence.name,
    keyMode: ephemeral.incidentPresence.keyMode,
    staticPolicyDigest: sha256(canonicalJson(
      schema.ephemeralCollections.find((entry) => entry.name === 'incidentPresence'),
    )),
  }),
  packages: Object.freeze({
    client: packageDigest(join(repoRoot, 'packages', 'snapback-client')),
    react: packageDigest(join(repoRoot, 'packages', 'snapback-react')),
    contract: packageDigest(join(repoRoot, 'packages', 'snapback-contract')),
    codegen: packageDigest(join(repoRoot, 'packages', 'snapback-codegen')),
  }),
  transport: Object.freeze({
    nativeDelivery: 'websocket',
    pollingEnabled: false,
  }),
  skips: 0,
};

await runAcceptance(
  suite,
  async () => {
    const scratch = mkdtempSync(join(tmpdir(), 'snapback-bakeoff-react-'));
    const startupArtifacts = join(scratch, 'startup-artifacts.json');
    writeFileSync(startupArtifacts, `${JSON.stringify({
      formatVersion: 1,
      schema,
      functions,
    })}\n`, { mode: 0o600 });
    cleanups.push(() => rmSync(scratch, { recursive: true, force: true }));
    const server = await startServer({
      port: 0,
      db: ':memory:',
      cwd: repoRoot,
      startupArtifacts,
      serverBinary: join(repoRoot, 'target', 'debug', 'snapback'),
      provenance: {
        appId: schema.appId,
        artifactsPath: join(generatedRoot, 'artifacts.json'),
      },
    });
    cleanups.push(() => server.stop());

    const clientA = await receiptClient(server, 'react-presence-client-a');
    await resetInstallGeneratedSeed(clientA, seedArtifact);
    const clientB = await receiptClient(server, 'react-presence-client-b');
    const inspection = await clientA.inspect();
    receiptExtra.target = Object.freeze({
      targetProfileId: inspection.targetProfileId,
      target: inspection.target,
      schemaHash: inspection.schema.schemaHash,
      bundleHash: inspection.functions.bundleHash,
    });
    const generatedManifest = { schema, functions, capabilityManifest };
    const [bindingA, bindingB] = await Promise.all([
      clientA.prepareReactBinding({ generatedManifest }),
      clientB.prepareReactBinding({ generatedManifest }),
    ]);
    const connectionA = 'react_presence_receipt_a';
    const connectionB = 'react_presence_receipt_b';
    // Resolve each independent grant before the provider installs its auth
    // barrier. Otherwise the first room open can itself trigger a custody
    // handshake which correctly pauses that just-created room.
    const [grantA, grantB] = [
      await clientA.connectionGrant(connectionA),
      await clientB.connectionGrant(connectionB),
    ];
    assert(grantA.id !== grantB.id, 'independent receipt clients shared a wire grant');
    const providerA = createSnapbackReactProvider(bindingA, { connectionId: connectionA });
    const providerB = createSnapbackReactProvider(bindingB, { connectionId: connectionB });
    cleanups.push(() => providerA.dispose());
    cleanups.push(() => providerB.dispose());
    let stateA;
    let stateB;
    const scope = { incidentId: 'incident_api' };
    const observerA = observeSnapbackPresence(
      providerA,
      bindingA.ephemeral.incidentPresence,
      { scope, value: skip },
      (state) => { stateA = state; },
    );
    const observerB = observeSnapbackPresence(
      providerB,
      bindingB.ephemeral.incidentPresence,
      { scope, value: skip },
      (state) => { stateB = state; },
    );
    cleanups.push(() => observerA.dispose());
    cleanups.push(() => observerB.dispose());
    const durableVersionBefore = inspection.storage.version;

    await suite.check('two-independent-clients', async () => {
      try {
        await until(
          () => stateA?.status === 'ready' && stateB?.status === 'ready',
          'two authoritative presence rooms',
        );
      } catch (error) {
        throw new Error(`${error.message}: ${JSON.stringify({
          a: observerA.snapshot(),
          b: observerB.snapshot(),
          providerA: providerA.inspection(),
          providerB: providerB.inspection(),
        })}`);
      }
      assert(stateA.selfKey !== stateB.selfKey, 'independent clients shared a granted identity');
      await observerA.publish({
        userId: 'user_ada',
        name: 'Ada',
        color: '#2563eb',
        viewing: 'independent-client-proof',
      }, { ttlMs: 4_000 });
      await until(
        () => stateB?.entries.some((entry) => (
          entry.key === stateA.selfKey
          && entry.value.viewing === 'independent-client-proof'
        )),
        'peer WebSocket delivery',
      );
      const resources = clientA.localResourceInspection([connectionA]);
      assert(resources.socketDemand > 0, 'native WebSocket manager has no demand');
      assert(resources.managers.some((manager) => manager.open), 'native WebSocket is not open');
      await observerA.delete();
      await until(
        () => !stateB?.entries.some((entry) => entry.key === stateA.selfKey),
        'peer-observed managed delete',
      );
      return {
        clientStoreIds: ['react-presence-client-a', 'react-presence-client-b'],
        connectionIds: [connectionA, connectionB],
        grantedIds: [grantA.id, grantB.id],
        grantedIdsDistinct: true,
        delivery: 'native-websocket',
        pollingEnabled: false,
      };
    });

    await suite.check('ttl-expiry', async () => {
      const expiredBefore = (await clientA.inspect()).ephemeral.expiredEntries;
      await clientB.publishEphemeral(ephemeral.incidentPresence, {
        connectionId: connectionB,
        scope,
        value: {
          userId: 'user_grace',
          name: 'Grace',
          color: '#7c3aed',
          viewing: 'ttl-expiry-proof',
        },
        ttlMs: 500,
      });
      await until(
        () => stateA?.entries.some((entry) => entry.value.viewing === 'ttl-expiry-proof'),
        'TTL witness publication',
      );
      const witness = stateA.entries.find(
        (entry) => entry.value.viewing === 'ttl-expiry-proof',
      );
      await until(
        () => !stateA?.entries.some((entry) => entry.value.viewing === 'ttl-expiry-proof'),
        'server-stamped local expiry',
        2_500,
      );
      // Local monotonic expiry deliberately does not wait for a server sweep.
      // A subsequent room operation sweeps the authoritative room and makes
      // the distinct server-expiry witness observable.
      await clientB.publishEphemeral(ephemeral.incidentPresence, {
        connectionId: connectionB,
        scope,
        value: {
          userId: 'user_grace',
          name: 'Grace',
          color: '#7c3aed',
          viewing: 'expiry-sweep-probe',
        },
        ttlMs: 500,
      });
      await clientB.deleteEphemeral(ephemeral.incidentPresence, {
        connectionId: connectionB,
        scope,
      });
      await until(
        async () => (await clientA.inspect()).ephemeral.expiredEntries > expiredBefore,
        'server expiry counter',
      );
      return {
        ttlMs: 500,
        expiresAtMs: witness.expiresAtMs,
        serverExpiredCounterAdvanced: true,
      };
    });

    await suite.check('forced-disconnect-delete', async () => {
      const disconnectedBefore = (await clientA.inspect()).ephemeral.disconnectedEntries;
      const ttlMs = 4_000;
      await clientB.publishEphemeral(ephemeral.incidentPresence, {
        connectionId: connectionB,
        scope,
        value: {
          userId: 'user_grace',
          name: 'Grace',
          color: '#7c3aed',
          viewing: 'forced-disconnect-proof',
        },
        ttlMs,
      });
      await until(
        () => stateA?.entries.some(
          (entry) => entry.value.viewing === 'forced-disconnect-proof',
        ),
        'forced-disconnect witness publication',
      );
      const startedAt = performance.now();
      await clientB.disconnect(connectionB);
      await until(
        () => !stateA?.entries.some(
          (entry) => entry.value.viewing === 'forced-disconnect-proof',
        ),
        'peer-observed Disconnected removal',
        ttlMs / 2,
      );
      const removedAfterMs = performance.now() - startedAt;
      assert(removedAfterMs < ttlMs / 2, 'disconnect cleanup was not earlier than half TTL');
      await until(
        async () => (
          (await clientA.inspect()).ephemeral.disconnectedEntries > disconnectedBefore
        ),
        'server disconnected-entry counter',
      );
      return {
        ttlMs,
        halfTtlMs: ttlMs / 2,
        peerRemovedAfterMs: Math.ceil(removedAfterMs),
        removalReason: 'Disconnected',
      };
    });

    await suite.check('durable-version-unchanged', async () => {
      const durableVersionAfter = (await clientA.inspect()).storage.version;
      assertEqual(
        durableVersionAfter,
        durableVersionBefore,
        'ephemeral presence advanced durable storage version',
      );
      return { before: durableVersionBefore, after: durableVersionAfter };
    });

    const initialTasks = (await clientA.query(api.allTasks, {})).rows;
    const optimisticInspection = {
      targetProfileId: inspection.targetProfileId,
      target: inspection.target,
      schema,
      functions,
      capabilityManifest,
    };
    const optimisticClient = deterministicOptimisticClient(
      optimisticInspection,
      [initialTasks[0]],
    );
    const optimisticBinding = await prepareReactBindingForClient(optimisticClient, {
      generatedManifest,
    });
    const optimisticProvider = createSnapbackReactProvider(
      optimisticBinding,
      { connectionId: 'react_optimistic_receipt' },
    );
    const optimisticObserver = observeSnapbackQueries(
      optimisticProvider,
      { tasks: { ref: api.allTasks, args: {} } },
      () => {},
    );
    cleanups.push(() => optimisticObserver.dispose());
    cleanups.push(() => optimisticProvider.dispose());
    await flush();
    const task = optimisticObserver.snapshot().queries.tasks.data[0];
    const optimistic = (completed) => ({
      query: api.allTasks,
      args: {},
      update: (current, args) => current.map((row) => (
        row._id === args.taskId ? { ...row, completed: args.completed } : row
      )),
      isAuthoritative: (current, result) => current.some(
        (row) => row._id === result && row.completed === completed,
      ),
    });
    const mutationArgs = (completed) => ({
      incidentId: task.incidentId,
      taskId: task._id,
      completed,
      actorId: 'user_ada',
      now: 1785160400000,
    });

    await suite.check('rollback-over-newer-authority', async () => {
      const pending = invokeSnapbackMutation(
        optimisticProvider,
        api.toggleTask,
        mutationArgs(true),
        { optimistic: optimistic(true) },
      );
      const observed = pending.catch((error) => error);
      const newer = [{ ...task, body: `${task.body} (newer authority)`, completed: false }];
      optimisticClient.emit(newer, 'rollback-newer-authority');
      optimisticClient.inspection().attempts[0].reject(new Error('receipt rejection'));
      assertEqual((await observed).message, 'receipt rejection', 'mutation did not reject');
      const current = optimisticObserver.snapshot().queries.tasks.data[0];
      assertEqual(current.body, newer[0].body, 'rollback restored a stale mutation-start snapshot');
      assertEqual(current.completed, false, 'rollback did not preserve newer authority');
      return { preservedBody: current.body, completed: current.completed };
    });

    await suite.check('matcher-query-first', async () => {
      const pending = invokeSnapbackMutation(
        optimisticProvider,
        api.toggleTask,
        mutationArgs(true),
        { optimistic: optimistic(true) },
      );
      optimisticClient.emit(
        [{ ...task, body: `${task.body} (query first)`, completed: true }],
        'matcher-query-first',
      );
      optimisticClient.inspection().attempts[1].resolve(task._id);
      assertEqual(await pending, task._id, 'query-first result');
      assertEqual(
        optimisticObserver.snapshot().queries.tasks.data[0].completed,
        true,
        'query-first matcher removed authoritative data',
      );
      const ordering = optimisticClient.inspection().ordering;
      assert(
        ordering.indexOf('query:matcher-query-first') < ordering.indexOf('response:1'),
        'query-first ordering witness is reversed',
      );
      return { ordering: ['query', 'response'] };
    });

    await suite.check('matcher-response-first', async () => {
      optimisticClient.emit([{ ...task, completed: false }], 'response-first-base');
      const pending = invokeSnapbackMutation(
        optimisticProvider,
        api.toggleTask,
        mutationArgs(true),
        { optimistic: optimistic(true) },
      );
      optimisticClient.inspection().attempts[2].resolve(task._id);
      assertEqual(await pending, task._id, 'response-first result');
      optimisticClient.emit(
        [{ ...task, body: `${task.body} (still older)`, completed: false }],
        'response-first-nonmatch',
      );
      assertEqual(
        optimisticObserver.snapshot().queries.tasks.data[0].completed,
        true,
        'HTTP success was treated as authority and dropped the layer',
      );
      optimisticClient.emit(
        [{ ...task, body: `${task.body} (response first)`, completed: true }],
        'matcher-response-first',
      );
      assertEqual(
        optimisticObserver.snapshot().queries.tasks.data[0].completed,
        true,
        'matching authority did not retain the committed value',
      );
      const ordering = optimisticClient.inspection().ordering;
      assert(
        ordering.indexOf('response:2') < ordering.indexOf('query:matcher-response-first'),
        'response-first ordering witness is reversed',
      );
      optimisticObserver.dispose();
      await flush();
      await optimisticProvider.dispose();
      return { ordering: ['response', 'nonmatching-query', 'matching-query'] };
    });

    await suite.check('ssr-zero-demand', async () => {
      const ssrConnection = 'react_presence_receipt_ssr';
      const ssrProvider = createSnapbackReactProvider(bindingA, {
        connectionId: ssrConnection,
      });
      function PresenceProbe() {
        const state = useSnapbackPresence(bindingA.ephemeral.incidentPresence, {
          scope,
          value: skip,
        });
        return React.createElement('span', null, state.status);
      }
      const html = renderToString(
        React.createElement(
          SnapbackProvider,
          { provider: ssrProvider },
          React.createElement(PresenceProbe),
        ),
      );
      assert(html.includes('pending'), 'SSR did not render the server snapshot');
      const providerResources = ssrProvider.inspection();
      const clientResources = clientA.localResourceInspection([ssrConnection]);
      assertEqual(providerResources.presenceStores, 0, 'SSR allocated a presence store');
      assertEqual(providerResources.presenceSubscriptions, 0, 'SSR subscribed a room');
      assertEqual(clientResources.socketDemand, 0, 'SSR opened socket demand');
      assertEqual(clientResources.grantCount, 0, 'SSR minted a connection grant');
      await ssrProvider.dispose();
      return { stores: 0, subscriptions: 0, grants: 0, socketDemand: 0 };
    });

    await suite.check('hosted-refusal', async () => {
      let starts = 0;
      const hostedCapability = {
        ...capabilityManifest,
        targetProfileId: 'hosted-postgres',
      };
      const hostedClient = {
        liveQuery() {},
        async inspect() {
          return {
            targetProfileId: 'hosted-postgres',
            target: 'hosted-postgres',
            schema,
            functions,
            capabilityManifest: hostedCapability,
          };
        },
        async authSession() { return { activeMode: 'sessions' }; },
        registerAuthBarrierParticipant() { return async () => {}; },
        liveStreamManager() { return { close() {}, async settled() {} }; },
        registerEphemeralRepublisher() {
          return Object.freeze({ dispose() {} });
        },
        startEphemeralRoom() {
          starts += 1;
          throw new Error('hosted refusal performed room work');
        },
        disconnect() { return Promise.resolve(); },
      };
      const hostedBinding = await prepareReactBindingForClient(hostedClient, {
        generatedManifest: {
          schema,
          functions,
          capabilityManifest: hostedCapability,
        },
      });
      const hostedProvider = createSnapbackReactProvider(hostedBinding, {
        connectionId: 'react_presence_receipt_hosted',
      });
      const hostedObserver = observeSnapbackPresence(
        hostedProvider,
        hostedBinding.ephemeral.incidentPresence,
        { scope, value: skip },
        () => {},
      );
      assertEqual(hostedObserver.snapshot().status, 'unsupported', 'hosted state');
      assertEqual(
        hostedObserver.snapshot().diagnostic.code,
        'SNAPBACK_EPHEMERAL_EXPIRY_UNSUPPORTED',
        'hosted diagnostic',
      );
      assertEqual(starts, 0, 'hosted refusal performed room work');
      await hostedObserver.dispose();
      await hostedProvider.dispose();
      return { status: 'unsupported', starts: 0 };
    });

    await suite.check('zero-resources', async () => {
      await Promise.all([observerA.dispose(), observerB.dispose()]);
      await Promise.all([providerA.dispose(), providerB.dispose()]);
      try {
        await until(async () => {
          const serverInspection = await clientA.inspect();
          return (
            serverInspection.ephemeral.roomCount === 0
            && serverInspection.ephemeral.entryCount === 0
            && serverInspection.ephemeral.subscriberCount === 0
          );
        }, 'zero server ephemeral and connection resources');
      } catch (error) {
        const serverInspection = await clientA.inspect();
        throw new Error(`${error.message}: ${JSON.stringify({
          ephemeral: serverInspection.ephemeral,
          activeConnections: serverInspection.activeConnections,
          localA: clientA.localResourceInspection([connectionA]),
          localB: clientB.localResourceInspection([connectionB]),
        })}`);
      }
      const providerResources = [providerA.inspection(), providerB.inspection()];
      for (const resources of providerResources) {
        assertEqual(resources.stores, 0, 'provider query stores');
        assertEqual(resources.presenceStores, 0, 'provider presence stores');
        assertEqual(resources.timers, 0, 'provider timers');
        assertEqual(resources.listeners, 0, 'provider listeners');
        assertEqual(resources.serverSubscriptions, 0, 'provider durable subscriptions');
        assertEqual(resources.presenceSubscriptions, 0, 'provider room subscriptions');
      }
      const localA = clientA.localResourceInspection([connectionA]);
      const localB = clientB.localResourceInspection([connectionB]);
      for (const resources of [localA, localB]) {
        assertEqual(resources.managerCount, 0, 'client manager count');
        assertEqual(resources.grantCount, 0, 'client grant count');
        assertEqual(resources.socketDemand, 0, 'client socket demand');
        assertEqual(resources.timers, 0, 'client timers');
        assertEqual(resources.listeners, 0, 'client listeners');
      }
      const serverInspection = await clientA.inspect();
      assertEqual(serverInspection.ephemeral.roomCount, 0, 'server rooms');
      assertEqual(serverInspection.ephemeral.entryCount, 0, 'server entries');
      assertEqual(serverInspection.ephemeral.subscriberCount, 0, 'server subscribers');
      return {
        deadlineMs: 5_000,
        providers: providerResources,
        clients: { [connectionA]: localA, [connectionB]: localB },
        server: {
          rooms: serverInspection.ephemeral.roomCount,
          entries: serverInspection.ephemeral.entryCount,
          subscriptions: serverInspection.ephemeral.subscriberCount,
          exactDisconnectsAwaited: [grantA.id, grantB.id],
        },
      };
    });
  },
  {
    cleanups,
    reportExtra: receiptExtra,
    reportFile: receiptPath,
  },
);
