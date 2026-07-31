// Campfire React query-group rerun arm — retained acceptance.
//
// The arm exists so a successor matrix rerun can measure the LLP 0112/0114
// React/query-group path, which the Diary 0032–0039 headless-client method
// was structurally blind to. Every product read in this suite goes through a
// real React render of `src/CampfireRoom.mjs`: the registered generated
// group renders through `useSnapbackQueries`, mutations settle through
// `useSnapbackMutation`, and live deltas re-render the committed tree. The
// suite fails if the arm stops using the React surface (structural pin) or
// the registered group (no `fallbackToLive`; rendered boot provenance must
// say `registered-bundle`).
//
// @ref LLP 0115#sequencing — item 5's measurement correction: at least one
// arm must consume the 0114 React surface and a registered 0112 group or
// the reactive-boundary watch trigger is unmeasurable.
// @ref LLP 0112#evidence-and-acceptance — the receipt distinguishes
// generated source, binding preparation, register-mode adoption, and real
// arm consumption.

import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import React from '../../../node_modules/react/index.js';
import TestRenderer from '../../../node_modules/react-test-renderer/index.js';

// React 19 schedules the initial mount; without an act environment the test
// renderer's tree never flushes (the package suites use the same setting).
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const { act } = TestRenderer;

// Live deltas arrive over a real socket, so their store notifications cannot
// all be act-wrapped; `untilRendered` flushes them inside act immediately
// afterwards. Silence exactly that known advisory and keep every other
// console.error visible.
const consoleError = console.error;
console.error = (...args) => {
  if (typeof args[0] === 'string' && args[0].includes('was not wrapped in act')) return;
  consoleError(...args);
};

import { SnapbackClient } from '../../../packages/snapback-client/index.mjs';
import {
  AuthCoordinator,
  createMemoryAuthCustodyStorage,
} from '../../../packages/snapback-contract/index.mjs';
import { resolveGeneratedArtifact } from '../../../packages/snapback-codegen/review-surface.mjs';
import {
  SnapbackProvider,
  createSnapbackReactProvider,
} from '../../../packages/snapback-react/index.mjs';

import { startServer } from '../../_kit/server-process.mjs';
import { assert, assertEqual, createSuite, runAcceptance } from '../../_kit/harness.mjs';
import { CampfireRoom } from '../src/CampfireRoom.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const demoRoot = join(here, '..');
const repoRoot = join(demoRoot, '..', '..');
const generatedRoot = join(demoRoot, 'snapback', 'generated');
const receiptPath = join(demoRoot, 'acceptance', 'results', 'react-arm.v1.json');
const generated = (name) => JSON.parse(
  readFileSync(resolveGeneratedArtifact(generatedRoot, name), 'utf8'),
);
const schema = generated('schema.manifest.json');
const functions = generated('functions.manifest.json');
const capabilityManifest = generated('capability.manifest.json');
const routes = generated('routes.manifest.json');
const seedArtifact = generated('seed.artifact.json');
const generatedApiPath = resolveGeneratedArtifact(generatedRoot, 'api.mjs');
const apiModule = await import(pathToFileURL(generatedApiPath).href);
const api = apiModule.default;
const generatedGroup = apiModule.groups['/rooms/:roomId'];

const suite = createSuite('campfire / React query-group rerun arm v1', {
  expectedChecks: 7,
});
const cleanups = [];
const e = React.createElement;
const roomId = 'room_campfire';
const userKey = 'quinn';

const sleep = (milliseconds) => new Promise((resolveSleep) => {
  setTimeout(resolveSleep, milliseconds);
});

const until = async (predicate, label, timeoutMs = 10_000) => {
  const deadline = performance.now() + timeoutMs;
  for (;;) {
    const value = await predicate();
    if (value) return value;
    if (performance.now() >= deadline) throw new Error(`timed out waiting for ${label}`);
    await sleep(10);
  }
};

// Rendered-tree conditions: give React act-flushed time slices so live
// deltas arriving over the socket re-render before each probe.
const untilRendered = (predicate, label, timeoutMs = 10_000) => until(async () => {
  await act(async () => {
    await sleep(10);
  });
  return predicate();
}, label, timeoutMs);

const digest = (path) => `sha256:${createHash('sha256')
  .update(readFileSync(path))
  .digest('hex')}`;

// Flattened text of one rendered test instance (host children included).
const textOf = (instance) => {
  const parts = [];
  const walk = (node) => {
    if (typeof node === 'string') {
      parts.push(node);
      return;
    }
    if (Array.isArray(node)) {
      for (const child of node) walk(child);
      return;
    }
    if (node && node.children) walk(node.children);
  };
  walk(instance.children);
  return parts.join('');
};

const componentSourcePath = join(demoRoot, 'src', 'CampfireRoom.mjs');
const routeSourcePath = join(demoRoot, 'snapback', 'routes.mjs');
const receiptExtra = {
  schemaVersion: 'campfire.react-arm-receipt.v1',
  generatedAt: new Date().toISOString(),
  sourceRevision: execFileSync('git', ['rev-parse', 'HEAD'], {
    cwd: repoRoot,
    encoding: 'utf8',
  }).trim(),
  appId: schema.appId,
  generated: {
    artifactManifest: {
      path: 'snapback/generated/artifacts.json',
      sha256: digest(join(generatedRoot, 'artifacts.json')),
    },
    routeSource: { path: 'snapback/routes.mjs', sha256: digest(routeSourcePath) },
    runtime: { path: 'snapback/generated/api.mjs', sha256: digest(generatedApiPath) },
    group: {
      id: generatedGroup.id,
      route: generatedGroup.route,
      definitionHash: generatedGroup.definitionHash,
      queryNames: generatedGroup.queries.map((query) => query.name),
    },
  },
  arm: {
    component: { path: 'src/CampfireRoom.mjs', sha256: digest(componentSourcePath) },
    consumption: 'useSnapbackQueries(preparedGroup) + useSnapbackMutation over a TestRenderer render',
    headlessReads: 'shared-pagination-and-summary-contract check only; every product read renders through React',
  },
  binding: null,
  adoption: null,
  skips: 0,
};

const sessionClient = (server, clientStoreId) => new SnapbackClient(server.baseUrl, {
  ...server.clientOptions,
  authCoordinator: new AuthCoordinator({
    appId: schema.appId,
    storage: createMemoryAuthCustodyStorage(),
    broadcastChannelFactory: null,
    hintStorage: null,
  }),
  authInvalidationProtocol: 1,
  authorityDescriptorProtocol: 1,
  authorizedLeaseProtocol: 1,
  clientStoreId,
});

async function mintSession(server, email, clientStoreId) {
  const headers = {
    'content-type': 'application/json',
    'x-snapback-auth-client-protocol': '1',
    'x-snapback-auth-invalidation-protocol': '1',
    'x-snapback-authority-descriptor-protocol': '1',
    'x-snapback-authorized-lease-protocol': '1',
  };
  const requestedResponse = await fetch(`${server.baseUrl}/auth/request-code`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ email }),
  });
  const requested = await requestedResponse.json();
  assertEqual(requestedResponse.status, 200, JSON.stringify(requested));
  const mailboxResponse = await fetch(
    `${server.baseUrl}/_snapback/api/auth/mailbox?challengeId=${
      encodeURIComponent(requested.challengeId)
    }`,
    {
      headers: {
        'x-snapback-admin-token': server.adminToken,
        'x-snapback-impersonation-capability': server.impersonationCapability,
      },
    },
  );
  const mailbox = await mailboxResponse.json();
  assertEqual(mailboxResponse.status, 200, JSON.stringify(mailbox));
  const exchangeResponse = await fetch(`${server.baseUrl}/auth/exchange`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      challengeId: requested.challengeId,
      code: mailbox.code,
    }),
  });
  const credential = await exchangeResponse.json();
  assertEqual(exchangeResponse.status, 200, JSON.stringify(credential));
  assert(typeof credential.token === 'string', 'session exchange omitted its credential');
  return new SnapbackClient(server.baseUrl, {
    bearerToken: credential.token,
    authClientProtocol: 1,
    authInvalidationProtocol: 1,
    authorityDescriptorProtocol: 1,
    authorizedLeaseProtocol: 1,
    clientStoreId,
  });
}

// @ref LLP 0109#63-reset-install-and-clear — destructive demo isolation is
// explicit reset-install against the previewed predecessor stream.
async function resetInstallGeneratedSeed(client, artifact) {
  const preview = await client.previewVersionedSeed(artifact, {
    operation: 'install',
    requestedMode: 'sessions',
  });
  const stream = preview?.requested?.dataVersionStream;
  return client.resetInstallVersionedSeed(artifact, {
    requestedMode: 'sessions',
    expectedDataVersionStream: typeof stream === 'string'
      ? { state: 'present', value: stream }
      : { state: 'absent' },
  });
}

await runAcceptance(
  suite,
  async () => {
    const scratch = mkdtempSync(join(tmpdir(), 'snapback-campfire-arm-'));
    cleanups.push(() => rmSync(scratch, { recursive: true, force: true }));
    const startupArtifacts = join(scratch, 'startup-artifacts.json');
    writeFileSync(startupArtifacts, `${JSON.stringify({
      formatVersion: 1,
      schema,
      functions,
    })}\n`, { mode: 0o600 });
    const server = await startServer({
      port: 0,
      db: ':memory:',
      cwd: repoRoot,
      startupArtifacts,
      serverBinary: join(repoRoot, 'target', 'debug', 'snapback'),
      captureImpersonationCapability: true,
      provenance: {
        appId: schema.appId,
        artifactsPath: join(generatedRoot, 'artifacts.json'),
      },
    });
    cleanups.push(() => server.stop());
    const provisioner = new SnapbackClient(server.baseUrl, server.clientOptions);
    await provisioner.ensureApp({
      schema,
      functions,
      routes,
      intent: 'provision',
      requestedMode: 'sessions',
    });
    const admin = sessionClient(server, 'campfire-arm-admin');
    cleanups.push(() => admin.closeAuth());
    await admin.authSession();
    await resetInstallGeneratedSeed(admin, seedArtifact);

    const productClient = await mintSession(
      server,
      'campfire-arm@campfire.test',
      'campfire-react-arm',
    );
    await productClient.authSession();
    const binding = await productClient.prepareReactBinding({
      generatedManifest: { schema, functions, capabilityManifest, routes },
    });
    receiptExtra.binding = {
      preparation: 'SnapbackClient.prepareReactBinding',
      registeredBundleAvailable: binding.registeredBundleAvailable,
      routeManifestHash: binding.routeManifestHash,
      groupIds: Object.values(binding.groups).map((group) => group.id),
    };

    await suite.check('generated-group-register-eligible', async () => {
      const routeEntry = routes.routes.find((entry) => entry.route === '/rooms/:roomId');
      assert(routeEntry, 'generated routes manifest lost the room route');
      assertEqual(routeEntry.registerGroupEligible, true, 'route register eligibility');
      const bindingGroup = binding.groups['/rooms/:roomId'];
      assert(bindingGroup, 'prepared binding generated no room query group');
      assertEqual(bindingGroup.id, generatedGroup.id, 'group id parity');
      assertEqual(
        bindingGroup.definitionHash,
        generatedGroup.definitionHash,
        'group definition-hash parity',
      );
      assertEqual(
        JSON.stringify(generatedGroup.queries.map((query) => query.name)),
        JSON.stringify(['liveMessages', 'liveReactions']),
        'generated child names',
      );
      assertEqual(binding.registeredBundleAvailable, true, 'registered bundle capability');
      return {
        route: routeEntry.route,
        registerGroupEligible: true,
        groupId: bindingGroup.id,
        children: ['liveMessages', 'liveReactions'],
      };
    });

    // No `fallbackToLive`: if the target ever stops advertising
    // registered_bundle_boot_v1, this preparation refuses and the arm fails
    // loudly instead of silently downgrading to ordinary live boot.
    const prepared = await binding.prepareQueryGroup(generatedGroup, { roomId });
    const provider = createSnapbackReactProvider(binding, { preparedGroup: prepared });
    cleanups.push(() => provider.dispose());

    let latest = null;
    let renderer;
    await act(async () => {
      renderer = TestRenderer.create(e(
        SnapbackProvider,
        { provider },
        e(CampfireRoom, {
          api,
          group: prepared,
          roomId,
          userKey,
          onState: (state) => { latest = state; },
        }),
      ));
    });
    let unmounted = false;
    const unmount = async () => {
      if (unmounted) return;
      unmounted = true;
      await act(async () => {
        renderer.unmount();
      });
    };
    cleanups.push(unmount);
    const find = (testID) => renderer.root.findByProps({ testID });
    const findAll = (testID) => renderer.root.findAllByProps({ testID });
    const treeReady = () => findAll('room-summary').length > 0
      && findAll('message-4').length > 0;

    await suite.check('registered-bundle-boot-rendered-through-react', async () => {
      await untilRendered(treeReady, 'the seeded room to render through the React surface');
      assertEqual(textOf(find('boot-provenance')), 'registered-bundle', 'rendered boot provenance');
      assertEqual(prepared.source, 'registered-bundle', 'prepared group source');
      assert(
        Number.isSafeInteger(latest.room.boot?.commitVersion),
        'group state omitted its registered commit version',
      );
      assertEqual(textOf(find('room-label')), roomId, 'rendered room label');
      assertEqual(
        textOf(find('room-counts')),
        '4 messages · 1 reactions',
        'rendered seeded counts',
      );
      assertEqual(
        textOf(find('room-participants')),
        'ada, grace, lin',
        'rendered seeded participants',
      );
      assertEqual(
        textOf(find('message-1')),
        'ada: Anyone bring marshmallows?',
        'first seeded message',
      );
      assert(
        !textOf(find('message-list')).includes('stays out of the campfire room'),
        'the lounge room leaked into the campfire group',
      );
      const inspection = provider.inspection();
      assertEqual(inspection.preparedGroupSource, 'registered-bundle', 'provider group source');
      assertEqual(inspection.preparedRegistrations, 0, 'both children adopted their registrations');
      assert(inspection.consumers >= 2, 'the React render is not the consumer');
      receiptExtra.adoption = {
        source: prepared.source,
        boot: latest.room.boot,
        renderedBootProvenance: 'registered-bundle',
        consumers: inspection.consumers,
        armConsumer: 'CampfireRoom via useSnapbackQueries(preparedGroup)',
      };
      return {
        source: prepared.source,
        commitVersion: latest.room.boot.commitVersion,
        consumers: inspection.consumers,
      };
    });

    await suite.check('send-message-live-rerender', async () => {
      const body = 'S’mores are ready — come back to the fire';
      await act(async () => {
        find('draft-input').props.onChange(body);
      });
      await untilRendered(
        () => find('draft-input').props.value === body,
        'the draft to re-render',
      );
      let pendingSend;
      await act(async () => {
        pendingSend = find('send-message').props.onPress();
      });
      const result = await pendingSend;
      assertEqual(typeof result.messageId, 'string', 'sendMessage result contract messageId');
      assertEqual(result.sequence, 5, 'sendMessage result contract sequence');
      await untilRendered(
        () => findAll('message-5').length > 0
          && textOf(find('message-5')) === `quinn: ${body}`,
        'the live message delta to re-render the React tree',
      );
      await untilRendered(
        () => textOf(find('room-counts')) === '5 messages · 1 reactions',
        'the live summary to count the new message',
      );
      assert(
        textOf(find('room-participants')).includes('quinn'),
        'the live summary missed the new participant',
      );
      return { sequence: result.sequence, renderedBody: textOf(find('message-5')) };
    });

    await suite.check('reaction-toggle-live-rerender', async () => {
      let pendingOn;
      await act(async () => {
        pendingOn = find('toggle-reaction-1').props.onPress();
      });
      const on = await pendingOn;
      assertEqual(on.active, true, 'toggleReaction on');
      assertEqual(typeof on.reactionId, 'string', 'toggleReaction result contract reactionId');
      await untilRendered(
        () => textOf(find('room-counts')) === '5 messages · 2 reactions',
        'the live summary to count the reaction',
      );
      let pendingOff;
      await act(async () => {
        pendingOff = find('toggle-reaction-1').props.onPress();
      });
      const off = await pendingOff;
      assertEqual(off.active, false, 'toggleReaction off');
      assertEqual(off.reactionId, on.reactionId, 'toggle removed the same reaction row');
      await untilRendered(
        () => textOf(find('room-counts')) === '5 messages · 1 reactions',
        'the live summary to release the reaction',
      );
      return { toggled: on.reactionId, finalCounts: textOf(find('room-counts')) };
    });

    await suite.check('shared-pagination-and-summary-contract', async () => {
      // The one deliberate headless block: the Diary 0025/0034 shared
      // pagination and derived-summary contracts are backend contracts kept
      // for parity with the paired arms, not part of the React-surface pin.
      const summaryRows = (await productClient.query(api.roomSummary, {
        args: { roomId },
      })).rows;
      assertEqual(summaryRows.length, 1, 'roomSummary row count');
      assertEqual(summaryRows[0].name, 'Campfire', 'roomSummary room name');
      assertEqual(summaryRows[0].messageCount, 5, 'roomSummary message count');
      assertEqual(summaryRows[0].reactionCount, 1, 'roomSummary reaction count');
      const firstPage = (await productClient.query(api.messagePage, {
        args: { roomId, limit: 2 },
      })).rows;
      assertEqual(
        JSON.stringify(firstPage.map((message) => message.sequence)),
        JSON.stringify([5, 4]),
        'newest-first first page',
      );
      const cursor = firstPage[firstPage.length - 1].sequence;
      const secondPage = (await productClient.query(api.messagePage, {
        args: { roomId, beforeSequence: cursor, limit: 2 },
      })).rows;
      assertEqual(
        JSON.stringify(secondPage.map((message) => message.sequence)),
        JSON.stringify([3, 2]),
        'exclusive-cursor second page',
      );
      return { pages: [[5, 4], [3, 2]], cursor };
    });

    await suite.check('react-surface-structural-pin', async () => {
      const source = readFileSync(componentSourcePath, 'utf8');
      assert(
        source.includes("from '../../../packages/snapback-react/index.mjs'"),
        'the arm component no longer imports the first-class React bindings',
      );
      assert(
        source.includes('useSnapbackQueries(group)'),
        'the arm component no longer consumes the prepared query group hook',
      );
      assert(
        source.includes('useSnapbackMutation('),
        'the arm component no longer mutates through the React surface',
      );
      assert(
        !/snapback-client|SnapbackClient|startLiveQuery|\.liveQuery\(|\.query\(/.test(source),
        'the arm component reached for the headless client',
      );
      return {
        component: 'src/CampfireRoom.mjs',
        sha256: receiptExtra.arm.component.sha256,
        reactSurfaceOnly: true,
      };
    });

    await suite.check('cleanup-zero-resources', async () => {
      await unmount();
      await provider.dispose();
      const inspection = provider.inspection();
      assertEqual(inspection.terminal, true, 'provider terminal state');
      for (const field of [
        'stores',
        'consumers',
        'serverSubscriptions',
        'leases',
        'reservations',
        'timers',
        'listeners',
        'preparedRegistrations',
      ]) {
        assertEqual(inspection[field], 0, `provider ${field}`);
      }
      await until(
        async () => (await admin.inspect()).subscriptions.length === 0,
        'server registered-subscription cleanup',
      );
      return { terminal: true, serverSubscriptions: 0 };
    });
  },
  {
    cleanups,
    reportExtra: receiptExtra,
    reportFile: receiptPath,
  },
);
