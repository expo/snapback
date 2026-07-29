// @ref LLP 0112#evidence-and-acceptance — this receipt bundles and drives the
// actual Signal Desk adapter, not a lower-level provider fixture.
import { createHash } from 'node:crypto';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { SnapbackClient } from '@snapback/client';
import { resolveGeneratedArtifact } from '@snapback/codegen/review-surface';
import {
  AuthCoordinator,
  createMemoryAuthCustodyStorage,
} from '@snapback/contract';
import { build } from 'esbuild';

import { startServer } from '../../_kit/server-process.mjs';
import { assert, assertEqual, createSuite, runAcceptance } from '../../_kit/harness.mjs';
import { resetInstallGeneratedSeed } from '../scripts/versioned-seed.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const demoRoot = join(here, '..');
const repoRoot = join(demoRoot, '..', '..');
const generatedRoot = join(demoRoot, 'snapback', 'generated');
const receiptPath = join(
  demoRoot,
  'acceptance',
  'results',
  'react-query-group.v1.json',
);
const generated = (name) => JSON.parse(
  readFileSync(resolveGeneratedArtifact(generatedRoot, name), 'utf8'),
);
const schema = generated('schema.manifest.json');
const functions = generated('functions.manifest.json');
const capabilityManifest = generated('capability.manifest.json');
const routes = generated('routes.manifest.json');
const seedArtifact = generated('seed.artifact.json');
const generatedApiPath = resolveGeneratedArtifact(generatedRoot, 'api.mjs');
const generatedDeclarationPath = resolveGeneratedArtifact(generatedRoot, 'api.d.ts');
const { groups: generatedGroups } = await import(pathToFileURL(generatedApiPath).href);
const generatedWorkspaceGroup = generatedGroups['/'];
const suite = createSuite('backend bakeoff / real Snapback adapter query group v1', {
  expectedChecks: 3,
});
const cleanups = [];

const until = async (predicate, label, timeoutMs = 5_000) => {
  const deadline = performance.now() + timeoutMs;
  while (performance.now() < deadline) {
    const value = await predicate();
    if (value) return value;
    await new Promise((resolveWait) => setTimeout(resolveWait, 10));
  }
  throw new Error(`timed out waiting for ${label}`);
};

const digest = (path) => `sha256:${createHash('sha256')
  .update(readFileSync(path))
  .digest('hex')}`;

const adapterSource = join(demoRoot, 'src', 'backends', 'snapback.ts');
const routeSource = join(demoRoot, 'snapback', 'routes.mjs');
const receiptExtra = {
  schemaVersion: 'snapback.real-adapter-query-group-receipt.v1',
  generatedAt: new Date().toISOString(),
  appId: schema.appId,
  generated: {
    artifactManifest: {
      path: 'snapback/generated/artifacts.json',
      sha256: digest(join(generatedRoot, 'artifacts.json')),
    },
    routeSource: {
      path: 'snapback/routes.mjs',
      sha256: digest(routeSource),
    },
    runtime: {
      path: 'snapback/generated/api.mjs',
      sha256: digest(generatedApiPath),
    },
    declarations: {
      path: 'snapback/generated/api.d.ts',
      sha256: digest(generatedDeclarationPath),
    },
    group: {
      id: generatedWorkspaceGroup.id,
      route: generatedWorkspaceGroup.route,
      definitionHash: generatedWorkspaceGroup.definitionHash,
      queryNames: generatedWorkspaceGroup.queries.map((query) => query.name),
    },
  },
  binding: null,
  adapter: {
    source: {
      path: 'src/backends/snapback.ts',
      sha256: digest(adapterSource),
    },
    compiledBundleSha256: null,
    kind: null,
    label: null,
    transport: null,
    setupCompleted: false,
  },
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

await runAcceptance(
  suite,
  async () => {
    const scratch = mkdtempSync(join(tmpdir(), 'snapback-real-adapter-'));
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
    const admin = sessionClient(server, 'real-adapter-admin');
    await admin.authSession();
    await resetInstallGeneratedSeed(admin, seedArtifact);

    const runtimeRoot = join(demoRoot, '.snapback');
    mkdirSync(runtimeRoot, { recursive: true });
    const bundlePath = join(
      runtimeRoot,
      `signal-desk-snapback-adapter-${process.pid}.mjs`,
    );
    cleanups.push(() => rmSync(bundlePath, { force: true }));
    await build({
      entryPoints: [adapterSource],
      outfile: bundlePath,
      bundle: true,
      packages: 'external',
      platform: 'node',
      format: 'esm',
      target: 'node24',
      define: {
        __SNAPBACK_URL__: JSON.stringify(server.baseUrl),
      },
      logLevel: 'silent',
    });
    receiptExtra.adapter.compiledBundleSha256 = digest(bundlePath);
    const { SnapbackAdapter } = await import(pathToFileURL(bundlePath).href);
    const productClient = await mintSession(
      server,
      'real-adapter@backend-bakeoff.test',
      'real-adapter-product',
    );
    await productClient.authSession();
    const bindingProbe = await productClient.prepareReactBinding({
      generatedManifest: { schema, functions, capabilityManifest, routes },
    });
    receiptExtra.binding = {
      preparation: 'SnapbackClient.prepareReactBinding',
      evidence: 'exact generated-manifest admission before adapter setup',
      generatedManifest: {
        schemaHash: schema.schemaHash,
        bundleHash: functions.bundleHash,
        targetProfileId: capabilityManifest.targetProfileId,
        routeCount: routes.routes.length,
      },
      result: {
        appId: bindingProbe.appId,
        profile: bindingProbe.profile,
        authMode: bindingProbe.authMode,
        routeManifestHash: bindingProbe.routeManifestHash,
        registeredBundleAvailable: bindingProbe.registeredBundleAvailable,
        deploymentIdentity: bindingProbe.deploymentIdentity,
        groupIds: Object.values(bindingProbe.groups).map((group) => group.id),
      },
    };
    const adapter = new SnapbackAdapter(productClient, { fallbackToLive: false });
    receiptExtra.adapter.kind = adapter.kind;
    receiptExtra.adapter.label = adapter.label;
    receiptExtra.adapter.transport = adapter.transport;
    cleanups.push(async () => {
      adapter.dispose();
      await adapter.settled();
    });
    try {
      await adapter.setup();
    } catch (error) {
      console.error('real adapter setup diagnostic', JSON.stringify({
        code: error?.code ?? null,
        diagnostic: error?.diagnostic ?? null,
        details: error?.details ?? null,
      }));
      throw error;
    }
    receiptExtra.adapter.setupCompleted = true;

    await suite.check('generated-registered-bundle-boot', async () => {
      const inspection = adapter.inspection();
      assertEqual(inspection.group?.source, 'registered-bundle', 'group source');
      assertEqual(inspection.group?.boot?.source, 'registered-bundle', 'boot source');
      assert(
        Number.isSafeInteger(inspection.group?.boot?.commitVersion),
        'registered boot omitted its commit version',
      );
      assert(
        typeof inspection.provider?.providerInstanceId === 'string',
        'registered boot omitted its provider custody witness',
      );
      receiptExtra.adoption = {
        source: inspection.group.source,
        bootSource: inspection.group.boot.source,
        commitVersion: inspection.group.boot.commitVersion,
        generation: inspection.group.boot.generation,
        versionStream: inspection.group.boot.versionStream,
        opaquePreparation: true,
        providerCustody: true,
        adapterConsumer: 'SnapbackAdapter.subscribeWorkspace',
      };
      return {
        source: inspection.group.source,
        commitVersion: inspection.group.boot.commitVersion,
        providerCustody: true,
      };
    });

    let snapshot = null;
    const unsubscribe = await adapter.subscribeWorkspace((value) => {
      snapshot = value;
    });
    cleanups.push(() => unsubscribe());

    await suite.check('real-adapter-mutation-and-live-delivery', async () => {
      try {
        await until(
          () => snapshot?.incidents.length === 2,
          'real adapter initial workspace',
        );
      } catch (error) {
        console.error('real adapter delivery diagnostic', JSON.stringify({
          snapshot,
          inspection: adapter.inspection(),
        }));
        throw error;
      }
      const body = 'Real generated-group adapter witness';
      await adapter.addComment({
        actorId: 'user_ada',
        incidentId: 'incident_api',
        body,
      });
      await until(
        () => snapshot?.comments.some((comment) => comment.body === body),
        'real adapter live mutation delivery',
      );
      return {
        initialIncidentCount: 2,
        mutation: 'addComment',
        liveBody: body,
      };
    });

    await suite.check('real-adapter-cleanup', async () => {
      unsubscribe();
      adapter.dispose();
      await adapter.settled();
      const provider = adapter.inspection().provider;
      assertEqual(provider?.terminal, true, 'provider terminal state');
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
        assertEqual(provider?.[field], 0, `provider ${field}`);
      }
      await until(
        async () => (await admin.inspect()).subscriptions.length === 0,
        'server registered-subscription cleanup',
      );
      return {
        terminal: true,
        stores: 0,
        consumers: 0,
        serverSubscriptions: 0,
        preparedRegistrations: 0,
      };
    });

  },
  {
    cleanups,
    reportExtra: receiptExtra,
    reportFile: receiptPath,
  },
);
