// LLP 0189 D-8 axis-parity battery: one runner crosses the auth-mode,
// implementation, Contract-scope, and connection-topology axes that have
// historically hidden delivery and lifecycle regressions.
//
// @ref LLP 0189#decision — D-8 parity evidence belongs to the complete battery, not the
// affected landing gate.
// @ref LLP 0094#0c8-sessions-live-update-envelope-and-delivery-multiplicity — a changing commit produces one content frame whose
// envelope is live_replace in dev and authorization_invalidation in sessions.
// @ref LLP 0034#1011-keyed-contract-surfaces-serve-the-ephemeral-link-family-2026-08-10 — Contract surfaces return every manifest-declared link;
// keyed durable teardown is measured with isolated and shared lane demand.

import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { SnapbackClient } from '../../demos/_kit/client.mjs';
import {
  importGeneratedModule,
  readGeneratedJson,
} from '../../demos/_kit/generated-artifacts.mjs';
import {
  createSuite,
  eventually,
  runAcceptance,
} from '../../demos/_kit/harness.mjs';
import { startServer } from '../../demos/_kit/server-process.mjs';
import {
  AuthCoordinator,
  createKeyedSnapbackContractProvider,
  createMemoryAuthCustodyStorage,
  createSnapbackContractSurface,
} from '../../packages/snapback-contract/index.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..', '..');
const serverBinary = process.env.SNAPBACK_RUNTIME_BINARY
  ?? join(repoRoot, 'target', 'debug', 'snapback');
const planningRoom = 'room_planning';
const gameId = 'axis_parity_game';
const suite = createSuite('axis parity harness', { expectedChecks: 8 });
const cleanups = [];

const demoCells = Object.freeze([
  Object.freeze({
    auth: 'dev',
    implementation: 'declarative',
    appId: 'todo-v2',
    query: 'listTodos',
    queryArgs: {},
    expectedKind: 'live_replace',
    mutation: 'createTodo',
    mutationArgs: (index) => ({ title: `axis declarative dev ${index}`, priority: 'normal' }),
  }),
  Object.freeze({
    auth: 'dev',
    implementation: 'js',
    appId: 'todo',
    query: 'listTodos',
    queryArgs: {},
    expectedKind: 'live_replace',
    mutation: 'createTodo',
    mutationArgs: (index) => ({ title: `axis js dev ${index}` }),
  }),
  Object.freeze({
    auth: 'sessions',
    implementation: 'declarative',
    appId: 'card-game',
    query: 'myHand',
    queryArgs: { gameId },
    expectedKind: 'authorization_invalidation',
    mutation: 'acceptHandCard',
    mutationArgs: (index) => ({
      gameId,
      position: 100 + index,
      card: `axis-card-${index}`,
    }),
  }),
  Object.freeze({
    auth: 'sessions',
    implementation: 'js',
    appId: 'pointing-room',
    query: 'liveRound',
    queryArgs: { roomId: planningRoom },
    expectedKind: 'authorization_invalidation',
    mutation: 'startRound',
    mutationArgs: (index) => ({ roomId: planningRoom, topic: `axis js sessions ${index}` }),
  }),
]);

class AxisParityHarness {
  constructor() {
    this.frames = [];
    this.unsubscribeTraffic = [];
    this.realFetch = globalThis.fetch;
    this.RealWebSocket = globalThis.WebSocket;
    assert.equal(typeof this.realFetch, 'function', 'Node fetch is required');
    assert.equal(typeof this.RealWebSocket, 'function', 'Node WebSocket is required');
  }

  installWireCapture() {
    const harness = this;
    let socketSequence = 0;
    globalThis.WebSocket = class AxisParityWebSocket extends harness.RealWebSocket {
      constructor(url, protocols) {
        super(url, protocols);
        const socketId = ++socketSequence;
        this.addEventListener('message', (event) => {
          const raw = typeof event.data === 'string' ? event.data : String(event.data);
          try {
            const envelope = JSON.parse(raw);
            harness.frames.push(Object.freeze({
              socketId,
              url: String(url),
              raw,
              envelope,
              kind: envelope?.kind ?? null,
              subscriptionId: envelope?.subscription_id
                ?? envelope?.snapshot?.subscriptionId
                ?? null,
              version: envelope?.version ?? envelope?.snapshot?.version ?? null,
            }));
          } catch {
            harness.frames.push(Object.freeze({ socketId, url: String(url), raw }));
          }
        });
      }
    };

    globalThis.fetch = async (input, init = undefined) => {
      const url = typeof input === 'string' || input instanceof URL
        ? String(input)
        : String(input?.url ?? input);
      let body = null;
      if (url.includes('/live/') && url.endsWith('/unsubscribe')) {
        try { body = JSON.parse(String(init?.body ?? 'null')); } catch { body = null; }
      }
      const traffic = body === null ? null : { url, body, completed: false, status: null };
      if (traffic) harness.unsubscribeTraffic.push(traffic);
      try {
        const response = await harness.realFetch(input, init);
        if (traffic) {
          traffic.completed = true;
          traffic.status = response.status;
        }
        return response;
      } catch (error) {
        if (traffic) {
          traffic.completed = true;
          traffic.error = String(error?.message ?? error);
        }
        throw error;
      }
    };
  }

  restoreWireCapture() {
    globalThis.WebSocket = this.RealWebSocket;
    globalThis.fetch = this.realFetch;
  }

  framesFor(subscriptionId, version = undefined) {
    return this.frames.filter((frame) => (
      frame.subscriptionId === subscriptionId
      && (version === undefined || frame.version === version)
    ));
  }

  unsubscriptionsFor(subscriptionId) {
    return this.unsubscribeTraffic.filter((entry) => entry.body?.subscription_id === subscriptionId);
  }

  async openDemo(appId, auth) {
    const backendDir = join(repoRoot, 'demos', appId, 'snapback');
    const generatedRoot = join(backendDir, 'generated');
    const schema = readGeneratedJson(generatedRoot, 'schema.manifest.json');
    const functions = readGeneratedJson(generatedRoot, 'functions.manifest.json');
    const artifacts = readGeneratedJson(generatedRoot, 'artifacts.json');
    const contractManifest = readGeneratedJson(generatedRoot, 'contract-data.manifest.json');
    const { default: api } = await importGeneratedModule(generatedRoot, 'api.mjs');
    const seed = JSON.parse(await readFile(join(backendDir, 'seed.json'), 'utf8'));
    const scratch = await mkdtemp(join(tmpdir(), `snapback-axis-${appId}-`));
    const clients = [];
    let server = null;
    try {
      const serverOptions = {
        port: 0,
        db: ':memory:',
        cwd: repoRoot,
        serverBinary,
      };
      if (auth === 'sessions') {
        const carrier = join(scratch, 'startup-artifacts.json');
        await writeFile(carrier, `${JSON.stringify({ formatVersion: 1, schema, functions })}\n`, {
          mode: 0o600,
        });
        serverOptions.startupArtifacts = carrier;
        serverOptions.captureImpersonationCapability = true;
      } else {
        serverOptions.provenance = {
          appId: schema.appId,
          artifactsPath: join(generatedRoot, 'artifacts.json'),
        };
      }
      server = await startServer(serverOptions);
      const admin = auth === 'sessions'
        ? new SnapbackClient(server.baseUrl, {
            authClientProtocol: 1,
            custody: 'anonymous-public',
            adminToken: server.adminToken,
            rqsStore: null,
          })
        : new SnapbackClient(server.baseUrl, { ...server.clientOptions, rqsStore: null });
      clients.push(admin);
      if (auth === 'sessions') {
        await admin.reset(seed);
      } else {
        await admin.loadSchema(schema);
        await admin.loadFunctions(functions);
        await admin.reset();
        await admin.seed(seed);
      }
      return {
        appId,
        auth,
        server,
        admin,
        api,
        schema,
        functions,
        artifacts,
        contractManifest,
        clients,
        async close() {
          let firstError = null;
          for (const client of clients.reverse()) {
            try { await client.dispose?.(); } catch (error) { firstError ??= error; }
          }
          try { await server.stop(); } catch (error) { firstError ??= error; }
          try { await rm(scratch, { recursive: true, force: true }); } catch (error) { firstError ??= error; }
          if (firstError) throw firstError;
        },
      };
    } catch (error) {
      try { await server?.stop?.(); } catch { /* preserve the setup error */ }
      await rm(scratch, { recursive: true, force: true });
      throw error;
    }
  }

  async mintSession(context, label) {
    const coordinator = new AuthCoordinator({
      appId: context.schema.appId,
      storage: createMemoryAuthCustodyStorage({ state: { custody: {} } }),
      broadcastChannelFactory: null,
      hintStorage: null,
    });
    const client = new SnapbackClient(context.server.baseUrl, {
      authCoordinator: coordinator,
      authInvalidationProtocol: 1,
      authorityDescriptorProtocol: 1,
      authorizedLeaseProtocol: 1,
      clientStoreId: `axis-${context.appId}-${label}`,
      rqsStore: null,
    });
    context.clients.push(client);
    const requested = await client.authRequestCode(`${label}@axis-parity.test`);
    const mailboxResponse = await this.realFetch(
      `${context.server.baseUrl}/_snapback/api/auth/mailbox?challengeId=${encodeURIComponent(requested.challengeId)}`,
      {
        headers: {
          'x-snapback-admin-token': context.server.adminToken,
          'x-snapback-impersonation-capability': context.server.impersonationCapability,
        },
      },
    );
    const mailbox = await mailboxResponse.json();
    assert.equal(mailboxResponse.status, 200, JSON.stringify(mailbox));
    const credential = await client.authExchange({
      challengeId: requested.challengeId,
      code: mailbox.code,
    });
    return { client, coordinator, credential };
  }

  async mutate(session, ref, args, clientMutationId) {
    if (!session.coordinator) {
      return session.client.mutate(ref, { args, userId: 'user_ada', clientMutationId });
    }
    const authorityCapture = session.coordinator.capture();
    for (let attempt = 0; ; attempt += 1) {
      try {
        return await session.client.mutate(ref, { args, authorityCapture, clientMutationId });
      } catch (error) {
        const code = error?.code ?? error?.diagnostic?.code;
        if (code !== 'SNAPBACK_AUTH_RESERVATION_STALE' || attempt >= 2) throw error;
        await session.client.currentAuthorizationScope();
        if (!session.coordinator.isCurrent(authorityCapture)) throw error;
      }
    }
  }

  async wireCell(cell) {
    const context = await this.openDemo(cell.appId, cell.auth);
    let handle = null;
    try {
      const session = cell.auth === 'sessions'
        ? await this.mintSession(context, `${cell.implementation}-wire`)
        : { client: context.admin, coordinator: null, credential: null };
      const connectionId = `axis-${cell.auth}-${cell.implementation}-${process.pid}`;
      handle = await session.client.liveQuery(context.api[cell.query], {
        connectionId,
        args: cell.queryArgs,
        userId: cell.auth === 'dev' ? 'user_ada' : undefined,
        authorityCapture: session.coordinator?.capture() ?? null,
        transport: 'stream',
        fallbackToPoll: false,
        onUpdate() {},
        onConnectionChange() {},
      });
      const subscriptionId = handle.subscriptionId;
      assert.equal(typeof subscriptionId, 'string', 'live handle must expose its server subscription id');

      // Five changing commits let the fifth frame causally bound delivery of
      // the four versions under assertion without a fixed quiet-period sleep.
      const versions = [];
      for (let index = 1; index <= 5; index += 1) {
        const mutation = await this.mutate(
          session,
          context.api[cell.mutation],
          cell.mutationArgs(index),
          `cm_axis_${cell.auth}_${cell.implementation}_${index}`,
        );
        assert.equal(Number.isSafeInteger(mutation.version), true, 'mutation response must carry a commit version');
        versions.push(mutation.version);
        await eventually(() => {
          assert.ok(
            this.framesFor(subscriptionId, mutation.version).length >= 1,
            `no content frame for commit version ${mutation.version}`,
          );
        }, `${cell.auth}/${cell.implementation} version ${mutation.version} frame`);
      }
      const assertedVersions = versions.slice(0, -1);
      for (const version of assertedVersions) {
        const frames = this.framesFor(subscriptionId, version);
        assert.equal(frames.length, 1, `commit ${version} produced ${frames.length} content frames`);
        assert.equal(frames[0].kind, cell.expectedKind, `commit ${version} envelope kind`);
      }
      const line = [
        'CELL',
        `auth=${cell.auth}`,
        `query=${cell.implementation}`,
        `app=${cell.appId}`,
        `versions=${assertedVersions.join(',')}`,
        `frames=${assertedVersions.map((version) => this.framesFor(subscriptionId, version).length).join(',')}`,
        `kind=${cell.expectedKind}`,
        'PASS',
      ].join(' ');
      console.log(line);
      return { cell, subscriptionId, assertedVersions, line };
    } finally {
      if (handle) {
        await handle.dispose();
        await handle.settled();
      }
      await context.close();
    }
  }

  expectedLinks(manifest) {
    const links = new Set([
      ...Object.keys(manifest.queries ?? {}),
      ...Object.keys(manifest.mutations ?? {}),
    ]);
    for (const [name, descriptor] of Object.entries(manifest.queries ?? {})) {
      if (descriptor.ephemeral === true) links.add(`${name}Publish`);
    }
    return [...links].sort();
  }

  async surfaceCell(keyed) {
    const context = await this.openDemo('pointing-room', 'sessions');
    let surface = null;
    try {
      const session = await this.mintSession(context, keyed ? 'surface-keyed' : 'surface-unkeyed');
      surface = await createSnapbackContractSurface({
        runtime: contractRuntime,
        client: session.client,
        userId: session.credential.session.userId,
        authCoordinator: session.coordinator,
        manifest: context.contractManifest,
        artifactIndex: context.artifacts,
        schemaManifest: context.schema,
        functionManifest: context.functions,
        liveQueries: [
          { name: 'liveRound', args: { roomId: planningRoom } },
          { name: 'liveTally', args: { roomId: planningRoom } },
        ],
        requiredQueries: Object.keys(context.contractManifest.queries),
        keyedQueryScopes: keyed,
        connectionId: `axis-surface-${keyed ? 'keyed' : 'unkeyed'}-${process.pid}`,
        liveFallbackToPoll: false,
        ephemeralIdleLingerMs: 0,
      });
      const expected = this.expectedLinks(context.contractManifest);
      const actual = Object.keys(surface.links).sort();
      assert.deepEqual(actual, expected);
      const line = `SURFACE scope=${keyed ? 'keyed' : 'unkeyed'} links=${actual.join(',')} PASS`;
      console.log(line);
      return { keyed, expected, actual, line };
    } finally {
      await surface?.dispose?.();
      await context.close();
    }
  }

  async teardownTopology(shared) {
    const context = await this.openDemo('pointing-room', 'sessions');
    let keyed = null;
    let binding = null;
    let overlay = null;
    try {
      const session = await this.mintSession(context, shared ? 'teardown-shared' : 'teardown-isolated');
      const connectionId = `axis-teardown-${shared ? 'shared' : 'isolated'}-${process.pid}`;
      const before = new Set((await context.admin.inspect()).subscriptions.map(({ id }) => id));
      keyed = createKeyedSnapbackContractProvider({
        runtime: contractRuntime,
        client: session.client,
        manifest: context.contractManifest,
        artifactIndex: context.artifacts,
        schemaManifest: context.schema,
        functionManifest: context.functions,
        userId: session.credential.session.userId,
        initialAuthorityCapture: session.coordinator.capture(),
        keyedQueries: ['liveRound'],
        connectionId,
        liveFallbackToPoll: false,
        rootId: `axis-root-${shared ? 'shared' : 'isolated'}-${process.pid}`,
      });
      const cells = [];
      binding = keyed.links.liveRound({ roomId: planningRoom }).subscribe((cell) => cells.push(cell));
      let registration = null;
      await eventually(async () => {
        const subscriptions = (await context.admin.inspect()).subscriptions.filter((entry) => (
          entry.function === 'liveRound' && !before.has(entry.id)
        ));
        assert.equal(subscriptions.length, 1, `expected one keyed liveRound registration, got ${JSON.stringify(subscriptions)}`);
        registration = subscriptions[0];
        assert.ok(cells.some((cell) => cell.status === 'ready'), 'keyed binding has not reached ready');
      }, `${shared ? 'shared' : 'isolated'} keyed registration`);

      if (shared) {
        overlay = await session.client.subscribeEphemeral('roomPresence', {
          connectionId,
          scope: { roomId: planningRoom },
          userId: session.credential.session.userId,
          transport: 'stream',
        });
      }

      binding.dispose();
      binding = null;
      if (!shared) {
        await eventually(async () => {
          const subscriptions = (await context.admin.inspect()).subscriptions;
          assert.equal(subscriptions.some(({ id }) => id === registration.id), false);
        }, 'isolated durable registration removal');
        const line = 'TOPOLOGY durable-only unregistered=true registrationCount=0 PASS';
        console.log(line);
        return { shared, unregistered: true, line };
      }

      // Classification is causal, not a quiet-time guess: after disposal, a
      // later changing commit either observes the registration already gone,
      // or the disposed subscription receives that later commit. The latter
      // proves shared demand withheld retirement rather than merely delaying it.
      const mutation = await this.mutate(
        session,
        context.api.startRound,
        { roomId: planningRoom, topic: 'axis shared teardown sentinel' },
        'cm_axis_shared_teardown_sentinel',
      );
      let retainedFrame = null;
      let stillRegistered = false;
      await eventually(async () => {
        const subscriptions = (await context.admin.inspect()).subscriptions;
        stillRegistered = subscriptions.some(({ id }) => id === registration.id);
        retainedFrame = this.framesFor(registration.id, mutation.version)[0] ?? null;
        assert.ok(!stillRegistered || retainedFrame, 'waiting for removal or a post-disposal content frame');
      }, 'shared durable retirement classification');

      // The empirical rule commissioned by LLP 0189 D-8: while another lane
      // holds the shared connection, durable release is not an independently
      // deliverable operation. If this assertion flips, LLP 0034 §10.11 says
      // the keyed surface should return to one connection.
      assert.equal(stillRegistered, true, 'shared-demand behavior changed: revisit the one-connection keyed surface');
      assert.ok(retainedFrame, 'retained registration did not receive the post-disposal sentinel');
      assert.equal(retainedFrame.kind, 'authorization_invalidation');
      const traffic = this.unsubscriptionsFor(registration.id);
      assert.equal(traffic.length, 0, 'shared-demand constraint is withholding, not a late/failed HTTP unsubscribe');
      const line = [
        'TOPOLOGY',
        'durable+ephemeral-shared',
        'unregistered=false',
        'unsubscribeRequests=0',
        `retainedThroughVersion=${mutation.version}`,
        'constraint=shared-demand-withholds-durable-release',
        'PASS',
      ].join(' ');
      console.log(line);

      // Releasing the final shared demand closes the owned socket, and the
      // server's disconnect reaper removes the retained registration.
      overlay.dispose();
      overlay = null;
      await eventually(async () => {
        const subscriptions = (await context.admin.inspect()).subscriptions;
        assert.equal(subscriptions.some(({ id }) => id === registration.id), false);
      }, 'shared registration cleanup after final demand release');
      return { shared, unregistered: false, retainedThroughVersion: mutation.version, line };
    } finally {
      binding?.dispose?.();
      overlay?.dispose?.();
      keyed?.dispose?.();
      await context.close();
    }
  }
}

const contractRuntime = Object.freeze({
  createContractMockQueryBoundary(initialRows) {
    const rows = new Map(Object.entries(initialRows));
    const listeners = new Map();
    return {
      current: (key) => rows.get(key) ?? [],
      query: (key, project = (value) => value) => project(rows.get(key) ?? []),
      write(key, update) {
        const next = update(rows.get(key) ?? []);
        rows.set(key, next);
        for (const listener of listeners.get(key) ?? []) listener(next);
        return next;
      },
      subscribe(key, listener) {
        if (!listeners.has(key)) listeners.set(key, new Set());
        listeners.get(key).add(listener);
        return () => listeners.get(key)?.delete(listener);
      },
    };
  },
  createBoundaryContractDataProvider(_manifest, boundary, options) {
    return {
      boundary,
      subscribe(name, args, observer) {
        observer({ status: 'ready', rows: options.queries[name](args, boundary) });
        return { dispose() {} };
      },
      subscribeEphemeral(name, args, observer) {
        return options.ephemerals[name](args, observer) ?? { dispose() {} };
      },
      mutate(name, args, correlation) {
        return options.mutations[name](args, correlation);
      },
    };
  },
  createProviderQueryHandle(provider, name, args) {
    return { subscribe(observer) { return provider.subscribe(name, args, observer); } };
  },
  createProviderEphemeralHandle(provider, name, args) {
    return { subscribe(observer) { return provider.subscribeEphemeral(name, args, observer); } };
  },
  createProviderMutation(provider, name) {
    return (args) => provider.mutate(name, args);
  },
  rotatePartition(provider) {
    return provider.partitionId();
  },
});

const harness = new AxisParityHarness();
harness.installWireCapture();
cleanups.push(() => harness.restoreWireCapture());

await runAcceptance(suite, async () => {
  for (const cell of demoCells) {
    await suite.check(
      `${cell.auth} / ${cell.implementation} emits one ${cell.expectedKind} frame per commit`,
      () => harness.wireCell(cell),
    );
  }
  await suite.check('sessions unkeyed Contract surface returns its complete manifest link family', () => (
    harness.surfaceCell(false)
  ));
  await suite.check('sessions keyed Contract surface returns its complete manifest link family', () => (
    harness.surfaceCell(true)
  ));
  await suite.check('disposed keyed durable subscription unregisters on an isolated connection', () => (
    harness.teardownTopology(false)
  ));
  await suite.check('shared ephemeral demand pins disposed keyed durable registration until disconnect', () => (
    harness.teardownTopology(true)
  ));
}, {
  cleanups,
  reportExtra: {
    harnessClass: 'axis-parity',
    cadence: 'complete-battery',
    uncoveredCells: [],
  },
});
