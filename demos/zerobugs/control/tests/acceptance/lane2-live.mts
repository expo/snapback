import assert from 'node:assert/strict';
import {join, resolve} from 'node:path';
import {pathToFileURL} from 'node:url';

import {createExternalSessionClient, SnapbackClient} from '@expo/snapback-client';

import {
  actorEmail,
  bindActorsAgainstReadyFile,
  emitActorBindingReceipt,
} from '../../scripts/bind-actors.mts';
import {mintDevSession} from '../../scripts/load-fixture.mts';

const CONTROL_ROOT = resolve(import.meta.dirname, '../..');
const DEFAULT_READY_FILE = join(CONTROL_ROOT, '.snapback/dev.ready.json');

function fail(message: string): never {
  throw new Error(`ZBUGS_LANE2_LIVE_FAILED: ${message}`);
}

function diagnosticCode(error: unknown): string | null {
  if (!error || typeof error !== 'object') return null;
  const value = error as {
    code?: unknown;
    diagnostic?: {code?: unknown};
  };
  if (typeof value.diagnostic?.code === 'string') return value.diagnostic.code;
  return typeof value.code === 'string' ? value.code : null;
}

async function expectRefused(action: () => Promise<unknown>, label: string): Promise<string> {
  let caught: unknown = null;
  try {
    await action();
  } catch (error) {
    caught = error;
  }
  if (!caught) fail(`${label} unexpectedly succeeded`);
  const code = diagnosticCode(caught);
  if (!code || !code.startsWith('SNAPBACK_')) {
    fail(`${label} did not return a stable Snapback diagnostic`);
  }
  return code;
}

async function endExternalSession(baseUrl: string, bearer: string): Promise<void> {
  const response = await fetch(`${baseUrl}/auth/logout`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${bearer}`,
      'content-type': 'application/json',
      'x-snapback-auth-client-protocol': '1',
    },
    body: '{}',
  });
  assert.equal(response.status, 204, 'external session logout status');
  assert.equal(await response.text(), '', 'external session logout body');
}

async function main(): Promise<void> {
  const readyFile = resolve(process.env.SNAPBACK_READY_FILE ?? DEFAULT_READY_FILE);
  const generatedApiPath = join(CONTROL_ROOT, 'snapback/generated/api.mjs');
  const {default: api} = await import(pathToFileURL(generatedApiPath).href);
  const bound = await bindActorsAgainstReadyFile(readyFile);
  const checks: Array<{id: string; status: 'pass'}> = [];
  const extraClients: Array<{closeAuth: () => Promise<unknown>}> = [];
  const check = async (id: string, action: () => Promise<void>): Promise<void> => {
    await action();
    checks.push({id, status: 'pass'});
  };

  try {
    await emitActorBindingReceipt(bound.receipt);

    await check('five-frozen-actors-bind-and-rebinding-refuses', async () => {
      assert.equal(Object.keys(bound.receipt.actors).length, 5);
      assert.equal(bound.receipt.rebindingRefused, true);
      assert.equal(
        new Set(Object.values(bound.receipt.actors).map(actor => actor.principal)).size,
        5,
      );
    });

    const unbound = await mintDevSession(
      readyFile,
      'zerobugs-unbound-principal@acceptance.invalid',
    );
    const unboundClient = createExternalSessionClient(unbound.baseUrl, {
      bearerToken: unbound.token,
      clientStoreId: 'zerobugs-lane2-unbound',
      rqsStore: null,
    });
    extraClients.push(unboundClient);

    await check('unbound-principal-refused', async () => {
      await expectRefused(
        () => unboundClient.query(api.acceptanceActorBindingSelf, {args: {}}),
        'unbound principal path',
      );
    });

    await check('binding-surface-is-closed-to-frozen-five', async () => {
      await expectRefused(
        () => unboundClient.mutate(api.acceptanceBindActor, {args: {actor: 'attacker'}}),
        'unknown actor binding',
      );
    });

    const ordinary = bound.sessions.get('ordinary-user');
    const creator = bound.sessions.get('creator');
    const assignee = bound.sessions.get('assignee');
    const crew = bound.sessions.get('crew-admin');
    const removed = bound.sessions.get('removed-member');
    if (!ordinary || !creator || !assignee || !crew || !removed) {
      fail('bound actor client set is incomplete');
    }

    await check('crew-guard-admits-crew-and-refuses-ordinary', async () => {
      const admitted = await crew.client.query(api.acceptanceCrewGuard, {args: {}});
      assert.equal(admitted.rows[0]?.sourceUserID, bound.receipt.actors['crew-admin'].sourceUserID);
      assert.equal(admitted.rows[0]?.role, 'crew');
      await expectRefused(
        () => ordinary.client.query(api.acceptanceCrewGuard, {args: {}}),
        'ordinary crew guard',
      );
    });

    await check('ownership-admits-creator-and-refuses-assignee', async () => {
      const admitted = await creator.client.query(api.acceptanceOwnershipGuard, {args: {}});
      assert.equal(admitted.rows[0]?.sourceIssueID, 'zbav1_internal_issue');
      assert.equal(admitted.rows[0]?.sourceUserID, bound.receipt.actors.creator.sourceUserID);
      await expectRefused(
        () => assignee.client.query(api.acceptanceOwnershipGuard, {args: {}}),
        'assignee ownership guard',
      );
    });

    const anonymous = new SnapbackClient(crew.baseUrl, {
      custody: 'anonymous-public',
      adminToken: null,
    });
    extraClients.push(anonymous);
    await check('anonymous-refused-on-principal-bound-path', async () => {
      await expectRefused(
        () => anonymous.query(api.acceptanceActorBindingSelf, {args: {}}),
        'anonymous principal path',
      );
    });

    const last = ordinary.token.at(-1);
    const forgedBearer = `${ordinary.token.slice(0, -1)}${last === 'a' ? 'b' : 'a'}`;
    const attacker = createExternalSessionClient(ordinary.baseUrl, {
      bearerToken: forgedBearer,
      clientStoreId: 'zerobugs-lane2-attacker',
      rqsStore: null,
    });
    extraClients.push(attacker);
    await check('forged-or-expired-bearer-refused', async () => {
      await expectRefused(
        () => attacker.query(api.acceptanceActorBindingSelf, {args: {}}),
        'forged bearer principal path',
      );
    });

    await check('logout-route-and-user-switch-retire-predecessor-overlay', async () => {
      const actorA = await crew.client.query(api.acceptancePrivateOverlay, {args: {}});
      assert.equal(actorA.rows.length, 1);
      assert.equal(actorA.rows[0].sourceUserID, bound.receipt.actors['crew-admin'].sourceUserID);

      // createExternalSessionClient intentionally has no AuthCoordinator, so
      // authLogout() is unavailable. End the adopted bearer through the
      // shipped session endpoint, then use its external-custody switch barrier.
      await endExternalSession(crew.baseUrl, crew.token);
      await expectRefused(
        () => crew.client.query(api.acceptancePrivateOverlay, {args: {}}),
        'logged-out predecessor path',
      );

      const staleToken = createExternalSessionClient(crew.baseUrl, {
        bearerToken: crew.token,
        clientStoreId: 'zerobugs-lane2-ended-session',
        rqsStore: null,
      });
      extraClients.push(staleToken);
      await expectRefused(
        () => staleToken.query(api.acceptancePrivateOverlay, {args: {}}),
        'ended session bearer',
      );

      const successor = await mintDevSession(readyFile, actorEmail('removed-member'));
      assert.equal(successor.principal, removed.principal);
      await crew.client.replaceBearerToken(successor.token);
      const actorB = await crew.client.query(api.acceptancePrivateOverlay, {args: {}});
      assert.equal(actorB.rows.length, 1);
      assert.equal(actorB.rows[0].sourceUserID, bound.receipt.actors['removed-member'].sourceUserID);
      assert.notEqual(actorB.rows[0].sourceUserID, actorA.rows[0].sourceUserID);
      assert.notEqual(actorB.rows[0].userID, actorA.rows[0].userID);
    });

    await check('private-overlay-has-no-caller-selected-identity-bypass', async () => {
      await expectRefused(
        () => crew.client.query(api.acceptancePrivateOverlay, {
          args: {userID: bound.receipt.actors['crew-admin'].sourceUserID},
        }),
        'caller-selected private user id',
      );
      await expectRefused(
        () => crew.client.query(api.fixtureInspectTable, {args: {table: 'viewState'}}),
        'post-binding broad fixture inspection',
      );
    });

    const receipt = {
      schemaVersion: 'zerobugs-lane2-live.v1',
      status: 'ok',
      expectedChecks: 9,
      executedChecks: checks.length,
      actorBindings: bound.receipt.actors,
      checks,
    };
    assert.equal(receipt.executedChecks, receipt.expectedChecks);
    process.stdout.write(`${JSON.stringify(receipt)}\n`);
  } finally {
    const cleanup = await Promise.allSettled([
      ...extraClients.map(client => client.closeAuth()),
      bound.close(),
    ]);
    const rejected = cleanup.find(result => result.status === 'rejected');
    if (rejected?.status === 'rejected') throw rejected.reason;
  }
}

main().catch(error => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exitCode = 1;
});
