// @ref LLP 0015#acceptance-rules — executable product claims, not UI inference.
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { SnapbackClient, parseSearchQueryV1 } from '@expo/snapback-client';
import { startServer } from '../../_kit/server-process.mjs';
import { assert, assertEqual, createSuite, runAcceptance } from '../../_kit/harness.mjs';
import { resolveGeneratedArtifact } from '@expo/snapback-codegen/review-surface';
import {
  AuthCoordinator,
  createMemoryAuthCustodyStorage,
} from '@expo/snapback-contract';
import { resetInstallGeneratedSeed } from '../scripts/versioned-seed.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const demoRoot = join(here, '..');
const repoRoot = join(demoRoot, '..', '..');
const generatedRoot = join(demoRoot, 'snapback', 'generated');
const generated = (name) =>
  JSON.parse(readFileSync(resolveGeneratedArtifact(generatedRoot, name), 'utf8'));
const { default: api } = await import(
  pathToFileURL(resolveGeneratedArtifact(generatedRoot, 'api.mjs')).href
);
const seedArtifact = generated('seed.artifact.json');
const suite = createSuite('backend bakeoff / Snapback app-specific extras', {
  expectedChecks: 4,
});
const cleanups = [];

async function mintSession(server, appId, email, clientStoreId) {
  const protocolHeaders = {
    'content-type': 'application/json',
    'x-snapback-auth-client-protocol': '1',
    'x-snapback-auth-invalidation-protocol': '1',
    'x-snapback-authority-descriptor-protocol': '1',
    'x-snapback-authorized-lease-protocol': '1',
  };
  const requestedResponse = await fetch(`${server.baseUrl}/auth/request-code`, {
    method: 'POST',
    headers: protocolHeaders,
    body: JSON.stringify({ email }),
  });
  const requested = await requestedResponse.json();
  assertEqual(requestedResponse.status, 200, JSON.stringify(requested));
  const mailboxResponse = await fetch(
    `${server.baseUrl}/_snapback/api/auth/mailbox?challengeId=${encodeURIComponent(requested.challengeId)}`,
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
    headers: protocolHeaders,
    body: JSON.stringify({
      challengeId: requested.challengeId,
      code: mailbox.code,
    }),
  });
  const credential = await exchangeResponse.json();
  assertEqual(exchangeResponse.status, 200, JSON.stringify(credential));
  assert(
    typeof credential.token === 'string' && credential.session?.userId,
    `invalid session credential: ${JSON.stringify(credential)}`,
  );
  const client = new SnapbackClient(server.baseUrl, {
    bearerToken: credential.token,
    authClientProtocol: 1,
    authInvalidationProtocol: 1,
    authorityDescriptorProtocol: 1,
    authorizedLeaseProtocol: 1,
    clientStoreId,
  });
  return { client, credential };
}

async function mutateSession(session, ref, args, clientMutationId) {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await session.client.mutate(ref, {
        args,
        clientMutationId,
      });
    } catch (error) {
      const code = error?.code ?? error?.diagnostic?.code;
      if (code !== 'SNAPBACK_AUTH_RESERVATION_STALE' || attempt >= 2) throw error;
      await session.client.currentAuthorizationScope();
    }
  }
}

async function diagnosticOf(action) {
  try {
    await action();
    return null;
  } catch (error) {
    return error?.code ?? error?.diagnostic?.code ?? null;
  }
}

await runAcceptance(
  suite,
  async () => {
    const scratch = mkdtempSync(join(tmpdir(), 'snapback-bakeoff-relation-'));
    const startupArtifacts = join(scratch, 'startup-artifacts.json');
    writeFileSync(startupArtifacts, `${JSON.stringify({
      formatVersion: 1,
      schema: generated('schema.manifest.json'),
      functions: generated('functions.manifest.json'),
    })}\n`, { mode: 0o600 });
    cleanups.push(() => rmSync(scratch, { recursive: true, force: true }));
    const server = await startServer({
      port: 0,
      db: ':memory:',
      cwd: repoRoot,
      startupArtifacts,
      // The bootstrap-validated prebuilt remains runnable even when this
      // dirty demo checkout cannot satisfy the harness's commit-stamp reuse
      // rule. Naming it explicitly exercises that configured-binary rung.
      serverBinary: join(repoRoot, 'target', 'debug', 'snapback'),
      provenance: {
        appId: 'backend-bakeoff',
        artifactsPath: join(demoRoot, 'snapback', 'generated', 'artifacts.json'),
      },
      captureImpersonationCapability: true,
    });
    cleanups.push(() => server.stop());
    const anonymousCoordinator = new AuthCoordinator({
      appId: 'backend-bakeoff',
      storage: createMemoryAuthCustodyStorage(),
      broadcastChannelFactory: null,
      hintStorage: null,
    });
    const db = new SnapbackClient(server.baseUrl, {
      ...server.clientOptions,
      authCoordinator: anonymousCoordinator,
      authInvalidationProtocol: 1,
      authorityDescriptorProtocol: 1,
      authorizedLeaseProtocol: 1,
      clientStoreId: 'backend-bakeoff-anonymous',
    });
    cleanups.push(() => db.closeAuth());
    await db.authSession();

    await suite.check('loads generated artifacts and deterministic seed', async () => {
      assert((await db.health()).ok, 'server is not healthy');
      await resetInstallGeneratedSeed(db, seedArtifact);
      const rows = (await db.query(api.listIncidents, {})).rows;
      assertEqual(rows.length, 2, 'seed incident count');
    });

    await suite.check(
      'bounded relations and activity helper preserve secrecy, cursors, atomicity, replay, and no-op refusal',
      async () => {
        const schema = generated('schema.manifest.json');
        const owner = await mintSession(
          server,
          schema.appId,
          'relation-owner@backend-bakeoff.test',
          'backend-bakeoff-relation-owner',
        );
        const outsider = await mintSession(
          server,
          schema.appId,
          'relation-outsider@backend-bakeoff.test',
          'backend-bakeoff-relation-outsider',
        );
        const ownerId = owner.credential.session.userId;

        const created = await owner.client.mutate(api.createIncident, {
          args: {
            title: 'Relation acceptance',
            severity: 'SEV-2',
            actorId: ownerId,
            now: 1785160001000,
          },
        });
        const incidentId = created.result;
        await owner.client.mutate(api.addComment, {
          args: {
            incidentId,
            actorId: ownerId,
            body: 'bounded comment',
            now: 1785160002000,
          },
        });

        const taskReceipts = [];
        for (const [suffix, body] of [
          ['one', 'bounded task one'],
          ['two', 'bounded task two'],
          ['three', 'bounded task three'],
        ]) {
          taskReceipts.push(await mutateSession(
            owner,
            api.addTaskWithActivity,
            { incidentId, body, actorId: ownerId },
            `cm_relation_activity_${suffix}`,
          ));
        }
        const replay = await mutateSession(
          owner,
          api.addTaskWithActivity,
          { incidentId, body: 'bounded task one', actorId: ownerId },
          'cm_relation_activity_one',
        );
        assertEqual(
          JSON.stringify(replay.result),
          JSON.stringify(taskReceipts[0].result),
          'durable replay changed the retained result',
        );

        const first = (await owner.client.query(api.incidentTasks, {
          args: { incidentId },
        })).rows[0];
        assertEqual(first.kind, 'visible', 'owner did not see parent');
        assertEqual(first.children.length, 2, 'first bounded page');
        assert(typeof first.continuation === 'string', 'first page omitted continuation');
        const second = (await owner.client.query(api.incidentTasks, {
          args: { incidentId, cursor: first.continuation },
        })).rows[0];
        assertEqual(second.children.length, 1, 'second bounded page');
        assertEqual(second.continuation, null, 'terminal page carried continuation');

        const comments = (await owner.client.query(api.incidentComments, {
          args: { incidentId },
        })).rows[0];
        const activityPage = (await owner.client.query(api.incidentActivity, {
          args: { incidentId },
        })).rows[0];
        assert(
          comments.children.some((row) => row.body === 'bounded comment'),
          'bounded comment projection missing',
        );
        assert(
          activityPage.children.some((row) => row.kind === 'task.added'),
          'bounded activity projection missing',
        );

        const allTasks = (await owner.client.query(api.allTasks, {})).rows;
        const allActivity = (await owner.client.query(api.allActivity, {})).rows;
        const atomicTask = allTasks.find(
          (row) => row._id === taskReceipts[0].result.taskId,
        );
        const atomicActivity = allActivity.find(
          (row) => row._id === taskReceipts[0].result.activityId,
        );
        assert(atomicTask && atomicActivity, 'activity helper rows missing');
        assertEqual(
          atomicTask._version,
          atomicActivity._version,
          'source and activity did not share a commit version',
        );
        assertEqual(
          allActivity.filter((row) => row._id === atomicActivity._id).length,
          1,
          'replay duplicated activity',
        );

        const activityBeforeNoop = allActivity.length;
        const noopCode = await diagnosticOf(() => mutateSession(
          owner,
          api.toggleTaskWithActivity,
          {
            incidentId,
            taskId: atomicTask._id,
            completed: false,
            actorId: ownerId,
          },
          'cm_relation_activity_noop',
        ));
        assertEqual(
          noopCode,
          'SNAPBACK_ACTIVITY_SOURCE_EFFECT_REQUIRED',
          'storage-equal activity patch was not refused',
        );
        assertEqual(
          (await owner.client.query(api.allActivity, {})).rows.length,
          activityBeforeNoop,
          'no-op appended activity',
        );
        const toggled = await mutateSession(
          owner,
          api.toggleTaskWithActivity,
          {
            incidentId,
            taskId: atomicTask._id,
            completed: true,
            actorId: ownerId,
          },
          'cm_relation_activity_toggle',
        );
        const toggledReplay = await mutateSession(
          owner,
          api.toggleTaskWithActivity,
          {
            incidentId,
            taskId: atomicTask._id,
            completed: true,
            actorId: ownerId,
          },
          'cm_relation_activity_toggle',
        );
        assertEqual(
          JSON.stringify(toggledReplay.result),
          JSON.stringify(toggled.result),
          'patch replay changed retained result',
        );

        const absent = (await owner.client.query(api.incidentTasks, {
          args: { incidentId: 'incident_missing' },
        })).rows[0];
        const invisible = (await outsider.client.query(api.incidentTasks, {
          args: { incidentId },
        })).rows[0];
        assertEqual(
          JSON.stringify(invisible),
          JSON.stringify(absent),
          'missing and invisible parent results diverged',
        );
        assertEqual(absent.parent, null, 'absent parent was not nullable');
        assertEqual(absent.continuation, null, 'absent parent minted a cursor');

        const devResponse = await fetch(
          `${server.baseUrl}/_snapback/api/host-ops`,
          {
            method: 'POST',
            headers: {
              'content-type': 'application/json',
              'x-snapback-admin-token': server.adminToken,
              'x-snapback-impersonation-capability': server.impersonationCapability,
            },
            body: JSON.stringify({
              operation: 'function.run',
              function: api.addTaskWithActivity.name,
              args: {
                incidentId,
                body: 'dev authority must refuse',
                actorId: ownerId,
              },
              userId: ownerId,
            }),
          },
        );
        const devBody = await devResponse.json();
        assertEqual(
          devBody.diagnostics?.find(
            (diagnostic) => diagnostic.severity === 'error',
          )?.code,
          'SNAPBACK_AUTH_REQUIRED',
          JSON.stringify(devBody),
        );

        await mutateSession(
          owner,
          api.deleteIncidentForAcceptance,
          { incidentId },
          'cm_relation_inactive_parent',
        );
        const inactive = (await owner.client.query(api.incidentTasks, {
          args: { incidentId },
        })).rows[0];
        assertEqual(
          JSON.stringify(inactive),
          JSON.stringify(absent),
          'inactive and missing parent results diverged',
        );
      },
    );

    await suite.check('search and derived brief execute inside the backend', async () => {
      const search = await db.search(api.searchIncidents, {
        query: parseSearchQueryV1('checkout'),
      });
      assertEqual(search.items.map((row) => row.rowId), ['incident_api'], 'search result');
      const result = await db.query(api.generateBrief, { args: { incidentId: 'incident_api' } });
      assert(/tasks complete/.test(result.rows[0].brief), 'brief missing task summary');
    });

    await suite.check('session-owned registered connection releases without admin authority', async () => {
      const session = await mintSession(
        server,
        generated('schema.manifest.json').appId,
        'registered-release@backend-bakeoff.test',
        'backend-bakeoff-registered-release',
      );
      const bundle = await session.client.fetchBundle({
        route: '/release-probe',
        mode: 'register',
        devManifestEntry: {
          route: '/release-probe',
          queries: [{ function: api.listIncidents.name, args: {} }],
        },
        authorizationNamespaces: [
          session.client.allocateLiveQueryNamespace(api.listIncidents, {}),
        ],
        authInvalidationProtocol: 1,
      });
      const released = await session.client.releaseConnection(
        bundle.connection.connectionId,
        {
          attachDeadline: bundle.connection.attachDeadline,
          timeoutMs: 2_000,
        },
      );
      assertEqual(released.released, true, 'client did not own the returned grant');
      assertEqual(released.attached, true, 'grant-owned socket did not attach before release');
    });

  },
  { cleanups },
);
