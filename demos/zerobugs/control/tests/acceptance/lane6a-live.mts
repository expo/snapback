import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {join, resolve} from 'node:path';

import {
  bindActorsAgainstReadyFile,
  emitActorBindingReceipt,
  type ActorId,
} from '../../scripts/bind-actors.mts';
import {loadFixtureAgainstReadyFile} from '../../scripts/load-fixture.mts';
import {
  createMutationAdapter,
  EMPTY_VISIBLE_FACTS,
  MutationPresentationController,
  type VisibleFacts,
} from '../../src/data/mutations';
import {createZerobugsDataAdapter} from '../../src/data/queries';
import type {Issue, User} from '../../src/data/types';
import {SessionController, type SessionClient} from '../../src/auth/session';
import {
  WindowController,
  issueWindowSource,
  windowIdentity,
} from '../../src/windowing/controller';
import {
  defaultListContext,
  loadOracleFixture,
  oracleIssueList,
  sourceID,
  sourceUserForPhysical,
} from '../lane3-oracle.mts';

type JsonObject = Record<string, unknown>;
type Check = Readonly<{id: string; status: 'pass'}>;

const CONTROL_ROOT = resolve(import.meta.dirname, '../..');
const DEFAULT_READY_FILE = join(CONTROL_ROOT, '.snapback/dev.ready.json');
const EXPECTED_CHECKS = 6;
const PAGE_SIZE = 31;

function record(value: unknown, label: string): JsonObject {
  assert(value && typeof value === 'object' && !Array.isArray(value), `${label} is an object`);
  return value as JsonObject;
}

function text(value: unknown, label: string): string {
  assert.equal(typeof value, 'string', `${label} is a string`);
  return value;
}

async function postJson(url: string, body: unknown, headers: HeadersInit = {}): Promise<Response> {
  return await fetch(url, {
    method: 'POST',
    headers: {'content-type': 'application/json', ...headers},
    body: JSON.stringify(body),
  });
}

async function configureBeforeAppData(readyFile: string): Promise<string> {
  const ready = record(JSON.parse(await readFile(readyFile, 'utf8')), 'ready descriptor');
  const serverUrl = text(ready.serverUrl, 'ready.serverUrl').replace(/\/$/u, '');
  const tokenPath = text(ready.adminTokenFile, 'ready.adminTokenFile');
  const adminToken = (await readFile(tokenPath, 'utf8')).trim();
  const values = new Map([
    ['loopsApiKey', 'lane6a-live-loops-provider-token-v1'],
    ['discordWebhookToken', 'lane6a-live-discord-provider-token-v1'],
    ['captureAdapterAuth', 'lane6a-live-capture-auth-v1'],
  ]);
  for (const [entry, value] of values) {
    const response = await postJson(
      `${serverUrl}/_snapback/api/config/set`,
      {entry, value},
      {'x-snapback-admin-token': adminToken},
    );
    assert.equal(response.status, 200, `required config ${entry} accepted before app data`);
    assert(!((await response.text()).includes(value)), `${entry} receipt does not disclose value`);
  }
  return serverUrl;
}

function actorUser(
  fixture: Awaited<ReturnType<typeof loadOracleFixture>>,
  actor: ActorId,
): User {
  const row = sourceUserForPhysical(fixture, fixture.actors[actor].userID);
  assert(row, `${actor} source user exists`);
  return Object.freeze({
    id: text(row.id, `${actor}.id`),
    login: text(row.login, `${actor}.login`),
    ...(typeof row.name === 'string' ? {name: row.name} : {}),
    avatar: text(row.avatar, `${actor}.avatar`),
    role: row.role === 'crew' ? 'crew' : 'user',
  });
}

function visibleFacts(issue: Issue): VisibleFacts {
  return Object.freeze({...EMPTY_VISIBLE_FACTS, issues: Object.freeze([issue])});
}

async function main(): Promise<void> {
  const readyFile = resolve(process.env.SNAPBACK_READY_FILE ?? DEFAULT_READY_FILE);
  const fixture = await loadOracleFixture();
  const checks: Check[] = [];
  let bound: Awaited<ReturnType<typeof bindActorsAgainstReadyFile>> | null = null;
  let disposeWindow: (() => void) | null = null;

  const check = async (id: string, action: () => Promise<void>): Promise<void> => {
    await action();
    checks.push(Object.freeze({id, status: 'pass'}));
  };

  try {
    await check('fresh-config-fixture-and-bindings', async () => {
      await configureBeforeAppData(readyFile);
      const loaded = await loadFixtureAgainstReadyFile(readyFile);
      bound = await bindActorsAgainstReadyFile(readyFile);
      await emitActorBindingReceipt(bound.receipt);
      assert.equal(loaded.counts.issue, fixture.tables.issue.length);
      assert.equal(Object.keys(bound.receipt.actors).length, 5);
    });

    const actor = (id: ActorId) => {
      const session = bound?.sessions.get(id);
      assert(session, `${id} session exists`);
      return session;
    };
    const ordinaryAdapter = createZerobugsDataAdapter(actor('ordinary-user').client);
    const context = defaultListContext();
    const expected = oracleIssueList(fixture, context, 'ordinary-user');
    const expectedIDs = expected.map(sourceID);
    const mutationTarget = expected.find(row => (
      row.creatorID !== fixture.actors['ordinary-user'].userID
    ));
    assert(mutationTarget, 'oracle contains a public issue not owned by the ordinary actor');
    const mutationTargetID = sourceID(mutationTarget);
    const window = new WindowController({
      identity: windowIdentity({query: 'issueListV2', args: {listContext: context}, authority: 'crew', order: {
        field: context.sortField, direction: context.sortDirection,
      }}),
      source: issueWindowSource(ordinaryAdapter, context),
      pageSize: PAGE_SIZE,
      estimateSize: () => 76,
    });
    disposeWindow = () => window.dispose();

    let initialIDs: string[] = [];
    await check('adapter-initial-window-and-outside-permalink', async () => {
      await window.loadInitial();
      const initial = window.getSnapshot();
      assert.equal(initial.phase, 'ready');
      assert.equal(initial.complete, true);
      initialIDs = initial.items.map(item => item.key);
      assert.deepEqual(initialIDs, expectedIDs.slice(0, PAGE_SIZE));
      const target = expectedIDs[Math.min(PAGE_SIZE + 7, expectedIDs.length - 1)];
      assert(target && !initialIDs.includes(target), 'permalink target begins outside the initial window');
      await window.loadPermalink(target);
      assert(window.getSnapshot().items.some(item => item.key === target));
      assert.equal(window.getSnapshot().permalinkNotFound, false);
    });

    await check('controller-bidirectional-walk-matches-lane3-oracle', async () => {
      let steps = 0;
      while (window.getSnapshot().spaceBefore > 0 && steps++ < 100) await window.loadBackward();
      steps = 0;
      while (window.getSnapshot().spaceAfter > 0 && steps++ < 100) await window.loadForward();
      const observed = window.getSnapshot().items.map(item => item.key);
      assert.deepEqual(observed, expectedIDs);
      assert.equal(new Set(observed).size, observed.length);
      assert.equal(window.getSnapshot().fullyLoaded, true);
      assert.equal(window.getSnapshot().knownTotal, expectedIDs.length);
    });

    let mutatedIssue: Issue | null = null;
    await check('reducer-paints-then-authoritative-result-settles', async () => {
      const crew = actor('crew-admin');
      const crewAdapter = createZerobugsDataAdapter(crew.client);
      const point = await crewAdapter.query('listIssueByID', {
        listContext: context,
        idField: 'id',
        idValue: mutationTargetID,
      });
      assert(point.status === 'complete' && point.value.items.length === 1);
      const issue = point.value.items[0];
      const title = 'Lane 6a optimistic then authoritative';
      const presentation = new MutationPresentationController(visibleFacts(issue));
      const mutations = createMutationAdapter(crew.client, presentation);
      const pending = mutations.invoke({
        name: 'issue.update',
        args: {id: issue.id, title, modified: 1},
        clientMutationId: 'lane6a-live-authoritative-update',
        context: {actor: actorUser(fixture, 'crew-admin')},
      });
      assert.equal(presentation.snapshot().facts.issues[0]?.title, title);
      assert.equal(presentation.snapshot().attempts[0]?.status, 'pending');
      const result = await pending;
      assert.equal(result.mutator, 'issue.update');
      assert(result.authoritativeTime !== null);
      assert.match(result.rowID ?? '', /^id_/u, 'runtime physical ids use the generic id_ prefix');
      assert.equal(presentation.snapshot().attempts[0]?.status, 'confirmed');

      const authoritative = await crewAdapter.query('listIssueByID', {
        listContext: context,
        idField: 'id',
        idValue: issue.id,
      });
      assert(authoritative.status === 'complete' && authoritative.value.items.length === 1);
      const row = authoritative.value.items[0];
      assert.equal(row.title, title);
      assert.equal(row.modified, result.authoritativeTime);
      presentation.adoptAuthoritative(visibleFacts(row));
      assert.equal(presentation.snapshot().attempts.length, 0);
      mutatedIssue = row;
    });

    await check('refusal-drops-and-rebases-optimistic-layer', async () => {
      assert(mutatedIssue, 'authoritative issue is available');
      const ordinary = actor('ordinary-user');
      const ordinaryUser = actorUser(fixture, 'ordinary-user');
      const presentation = new MutationPresentationController(visibleFacts(mutatedIssue));
      const mutations = createMutationAdapter(ordinary.client, presentation);
      const pending = mutations.invoke({
        name: 'issue.update',
        args: {id: mutatedIssue.id, title: 'must rebase away', modified: 2},
        clientMutationId: 'lane6a-live-refused-update',
        context: {actor: ordinaryUser},
      });
      assert.equal(presentation.snapshot().facts.issues[0]?.title, 'must rebase away');
      await assert.rejects(pending);
      assert.equal(presentation.snapshot().facts.issues[0]?.title, mutatedIssue.title);
      assert.equal(presentation.snapshot().attempts.length, 0);
      assert(presentation.snapshot().refusal?.refusal.code.startsWith('SNAPBACK_'));
    });

    await check('session-switch-blanks-predecessor-before-successor', async () => {
      const predecessor = actor('crew-admin');
      const successor = actor('removed-member');
      const session = new SessionController({
        client: predecessor.client as unknown as SessionClient,
      });
      await session.refresh();
      assert.equal(session.getSnapshot().current?.sourceUserID, fixture.actors['crew-admin'].sourceUserID);
      const switching = session.switchBearer(successor.token);
      assert.equal(session.getSnapshot().phase, 'transitioning');
      assert.equal(session.getSnapshot().current, null);
      await switching;
      assert.equal(session.getSnapshot().phase, 'authenticated');
      assert.equal(session.getSnapshot().current?.sourceUserID, fixture.actors['removed-member'].sourceUserID);
    });

    assert.equal(checks.length, EXPECTED_CHECKS);
    const receipt = Object.freeze({
      schemaVersion: 'zerobugs-lane6a-live.v1',
      status: 'ok',
      expectedChecks: EXPECTED_CHECKS,
      executedChecks: checks.length,
      oracleRows: expectedIDs.length,
      pageSize: PAGE_SIZE,
      checks,
    });
    process.stdout.write(`${JSON.stringify(receipt)}\n`);
  } finally {
    disposeWindow?.();
    if (bound) await bound.close();
  }
}

main().catch(error => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exitCode = 1;
});
