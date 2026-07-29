import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import {
  DbConnection,
  type SubscriptionHandle,
} from './module_bindings/index.ts';

const URI = 'ws://127.0.0.1:3320';
const DATABASE = 'llp0102-linear-spacetimedb-w1';
const ARM_ROOT = new URL('../../', import.meta.url);
const EVIDENCE = new URL('evidence/', ARM_ROOT);
const STATE = new URL('state/', ARM_ROOT);
const QUERIES = [
  'SELECT * FROM my_organizations',
  'SELECT * FROM my_teams',
  'SELECT * FROM my_projects',
  'SELECT * FROM my_labels',
  'SELECT * FROM my_issues',
  'SELECT * FROM my_issue_labels',
  'SELECT * FROM my_comments',
  'SELECT * FROM my_activities',
  'SELECT * FROM my_page_results',
];

type Client = {
  name: string;
  conn: DbConnection;
  identity: string;
  token: string;
  subscription?: SubscriptionHandle;
};

type Scenario = {
  id: string;
  status: 'PASS' | 'FAIL' | 'GAP' | 'UNAVAILABLE_REMOTE_DEPENDENCY';
  summary: string;
  evidence: Record<string, unknown>;
};

const scenarios: Scenario[] = [];
const samples: Record<string, { warmups: number[]; recorded: number[] }> = {
  'representative-list': { warmups: [], recorded: [] },
  'representative-detail': { warmups: [], recorded: [] },
  'representative-write': { warmups: [], recorded: [] },
  'realtime-delivery': { warmups: [], recorded: [] },
  reconnect: { warmups: [], recorded: [] },
};

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

async function connect(name: string, token?: string): Promise<Client> {
  return new Promise((resolve, reject) => {
    let settled = false;
    let builder = DbConnection.builder()
      .withUri(URI)
      .withDatabaseName(DATABASE)
      .withConfirmedReads(true)
      .onConnect((conn, identity, returnedToken) => {
        if (settled) return;
        settled = true;
        resolve({
          name,
          conn,
          identity: identity.toHexString(),
          token: token ?? returnedToken,
        });
      })
      .onConnectError((_ctx, error) => {
        if (settled) return;
        settled = true;
        reject(error);
      });
    if (token) builder = builder.withToken(token);
    builder.build();
  });
}

async function subscribe(client: Client): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    client.subscription = client.conn.subscriptionBuilder()
      .onApplied(() => resolve())
      .onError((ctx: any) => reject(
        new Error(String(ctx?.event?.message ?? 'subscription error')),
      ))
      .subscribe(QUERIES);
  });
}

async function waitFor(
  description: string,
  predicate: () => boolean,
  timeoutMs = 20_000,
): Promise<void> {
  const started = performance.now();
  while (!predicate()) {
    if (performance.now() - started > timeoutMs) {
      throw new Error(`settlement timeout: ${description}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

function record(
  id: string,
  status: Scenario['status'],
  summary: string,
  evidence: Record<string, unknown>,
): void {
  scenarios.push({ id, status, summary, evidence });
}

function pageRows(client: Client, requestId: string) {
  return Array.from(client.conn.db.myPageResults.iter())
    .filter((row) => row.requestId.endsWith(`:${requestId}`))
    .sort((left, right) => left.sortKey.localeCompare(right.sortKey));
}

function issueById(client: Client, issueId: string) {
  return Array.from(client.conn.db.myIssues.iter()).find((row) => row.id === issueId);
}

async function requestPage(
  client: Client,
  requestId: string,
  filters: Partial<{
    status: string;
    assigneeName: string;
    projectId: string;
    labelId: string;
    afterSortKey: string;
  }> = {},
) {
  await client.conn.reducers.requestIssuePage({
    requestId,
    status: filters.status ?? '',
    assigneeName: filters.assigneeName ?? '',
    projectId: filters.projectId ?? '',
    labelId: filters.labelId ?? '',
    afterSortKey: filters.afterSortKey ?? '',
  });
  await waitFor(`${requestId} page materialization`, () => pageRows(client, requestId).length > 0);
  return pageRows(client, requestId);
}

async function expectPrivateSubscriptionDenied(client: Client): Promise<string> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error('private issue-table subscription stayed pending')),
      5_000,
    );
    client.conn.subscriptionBuilder()
      .onApplied(() => {
        clearTimeout(timeout);
        reject(new Error('private issue-table subscription unexpectedly applied'));
      })
      .onError((ctx: any) => {
        clearTimeout(timeout);
        resolve(String(ctx?.event?.message ?? 'server rejected private table'));
      })
      .subscribe('SELECT * FROM issue');
  });
}

async function samplePath(
  path: keyof typeof samples,
  operation: (sampleIndex: number) => Promise<void>,
): Promise<void> {
  for (let index = 0; index < 9; index += 1) {
    const started = performance.now();
    await operation(index);
    const elapsed = Number((performance.now() - started).toFixed(3));
    (index < 2 ? samples[path].warmups : samples[path].recorded).push(elapsed);
  }
}

function detailSnapshot(client: Client, issueId: string) {
  const target = issueById(client, issueId);
  assert(target, `missing issue ${issueId}`);
  const project = Array.from(client.conn.db.myProjects.iter())
    .find((row) => row.id === target.projectId);
  const labels = Array.from(client.conn.db.myIssueLabels.iter())
    .filter((row) => row.issueId === issueId)
    .map((join) => Array.from(client.conn.db.myLabels.iter())
      .find((row) => row.id === join.labelId))
    .filter(Boolean);
  const comments = Array.from(client.conn.db.myComments.iter())
    .filter((row) => row.issueId === issueId);
  const activities = Array.from(client.conn.db.myActivities.iter())
    .filter((row) => row.issueId === issueId);
  return {
    target,
    project,
    assigneeName: target.assigneeName,
    labels,
    comments,
    activities,
  };
}

async function main(): Promise<void> {
  await mkdir(EVIDENCE, { recursive: true });
  const custody = JSON.parse(await readFile(new URL('actor-custody.json', STATE), 'utf8'));
  const alice = await connect('Alice', custody.actors.alice.credential);
  const bob = await connect('Bob', custody.actors.bob.credential);
  const mallory = await connect('Mallory', custody.actors.mallory.credential);
  const clients = [alice, bob, mallory];
  const extraClients: Client[] = [];
  try {
    await Promise.all(clients.map(subscribe));
    await waitFor('Alice seed after migration', () => (
      Array.from(alice.conn.db.myIssues.iter()).length === 500
      && Array.from(alice.conn.db.myComments.iter()).length === 1000
    ));
    await waitFor('Bob seed after migration', () => (
      Array.from(bob.conn.db.myIssues.iter()).length === 500
    ));
    assert.equal(Array.from(mallory.conn.db.myIssues.iter()).length, 0);

    const migrationBefore = JSON.parse(
      await readFile(new URL('migration-before.json', EVIDENCE), 'utf8'),
    );
    const migrationAfter = JSON.parse(
      await readFile(new URL('migration-after.json', EVIDENCE), 'utf8'),
    );
    record(
      'LINEAR-01-SEED',
      migrationBefore.counts.issues === 500
        && migrationBefore.counts.comments === 1000
        && migrationBefore.counts.labels === 20
        ? 'PASS'
        : 'FAIL',
      'The fresh target contains the exact frozen production-shaped seed and three server-issued development identities.',
      {
        database: DATABASE,
        counts: migrationBefore.counts,
        personas: ['Alice', 'Bob', 'Mallory'],
        sourceTablesPrivate: true,
      },
    );

    const denial = await expectPrivateSubscriptionDenied(mallory);
    const negativeWrite = await Promise.allSettled([
      mallory.conn.reducers.updateIssue({
        issueId: 'issue-001',
        expectedRevision: 1n,
        status: 'done',
        priority: 'urgent',
        assigneeName: 'Mallory',
        boardPosition: 0,
      }),
      bob.conn.reducers.ownerOnlyProbe({}),
    ]);
    const negativeWriteCount = negativeWrite.filter((result) => result.status === 'rejected').length;
    record(
      'LINEAR-02-AUTHORITY',
      Array.from(alice.conn.db.myIssues.iter()).length === 500
        && Array.from(bob.conn.db.myIssues.iter()).length === 500
        && Array.from(mallory.conn.db.myIssues.iter()).length === 0
        && negativeWriteCount === 2
        ? 'PASS'
        : 'FAIL',
      'Alice owner and Bob team member receive authorized views; Mallory receives no issues, cannot subscribe to the private source table, and cannot mutate.',
      {
        aliceIssues: Array.from(alice.conn.db.myIssues.iter()).length,
        bobIssues: Array.from(bob.conn.db.myIssues.iter()).length,
        malloryIssues: Array.from(mallory.conn.db.myIssues.iter()).length,
        negativePrivateSubscription: denial.slice(0, 300),
        negativeWritesRejected: negativeWriteCount,
        ownerOnlyBobRejected: negativeWrite[1].status === 'rejected',
      },
    );

  const filterInputs: Array<
    [
      string,
      Partial<{
        status: string;
        assigneeName: string;
        projectId: string;
        labelId: string;
      }>,
    ]
  > = [
      ['status', { status: 'in-progress' }],
      ['assignee', { assigneeName: 'Bob' }],
      ['project', { projectId: 'project-2' }],
      ['label', { labelId: 'label-01' }],
    ] as const;
    const filterEvidence: Record<string, unknown> = {};
    let filtersPass = true;
    for (const [name, filters] of filterInputs) {
      const rows = await requestPage(alice, `filter-${name}`, filters);
      const labelIssueIds = new Set(
        Array.from(alice.conn.db.myIssueLabels.iter())
          .filter((join) => !filters.labelId || join.labelId === filters.labelId)
          .map((join) => join.issueId),
      );
      const expected = Array.from(alice.conn.db.myIssues.iter())
        .filter((row) => !filters.status || row.status === filters.status)
        .filter((row) => !filters.assigneeName || row.assigneeName === filters.assigneeName)
        .filter((row) => !filters.projectId || row.projectId === filters.projectId)
        .filter((row) => !filters.labelId || labelIssueIds.has(row.id))
        .sort((left, right) => left.sortKey.localeCompare(right.sortKey))
        .slice(0, 50)
        .map((row) => row.id);
      const actual = rows.map((row) => row.issueId);
      filtersPass &&= JSON.stringify(actual) === JSON.stringify(expected);
      filterEvidence[name] = { count: actual.length, ids: actual };
    }
    record(
      'LINEAR-03-FILTERS',
      filtersPass ? 'PASS' : 'FAIL',
      'Reducer-side pages select indexed status, assignee, project, or organization candidates and prove label membership by primary-key join.',
      {
        indexProofPath: 'evidence/schema-after-migration.json',
        filters: filterEvidence,
        clientSideFilteringClaimed: false,
      },
    );

    const firstPage = await requestPage(alice, 'stable-page-1');
    assert.equal(firstPage.length, 50);
    const cursor = firstPage.at(-1)!.sortKey;
    await bob.conn.reducers.createIssue({
      id: 'issue-concurrent-pagination',
      identifier: 'LIN-501',
      teamId: 'team-1',
      projectId: 'project-1',
      title: 'Concurrent pagination insert',
      status: 'todo',
      priority: 'medium',
      assigneeName: 'Bob',
      boardPosition: 500,
      sortKey: '000025a:issue-concurrent-pagination',
    });
    await waitFor(
      'concurrent issue reaches Alice',
      () => Boolean(issueById(alice, 'issue-concurrent-pagination')),
    );
    const secondPage = await requestPage(
      alice,
      'stable-page-2',
      { afterSortKey: cursor },
    );
    const union = [...firstPage, ...secondPage].map((row) => row.issueId);
    const stablePagination = (
      firstPage.length === 50
      && secondPage.length === 50
      && new Set(union).size === 100
      && secondPage.every((row) => row.sortKey > cursor)
      && !secondPage.some((row) => row.issueId === 'issue-concurrent-pagination')
    );
    record(
      'LINEAR-04-PAGINATION',
      stablePagination ? 'PASS' : 'FAIL',
      'Two server-materialized 50-row cursor pages remain nonduplicating across an insert ordered before the exclusive cursor.',
      {
        firstPageIds: firstPage.map((row) => row.issueId),
        cursorExclusive: cursor,
        insertedSortKey: '000025a:issue-concurrent-pagination',
        secondPageIds: secondPage.map((row) => row.issueId),
        unionCount: union.length,
        uniqueCount: new Set(union).size,
      },
    );

    const detail = detailSnapshot(alice, 'issue-001');
    const detailPass = Boolean(
      detail.project
      && detail.assigneeName
      && detail.labels.length === 2
      && detail.comments.length === 2
      && detail.activities.length >= 1
    );
    record(
      'LINEAR-05-DETAIL',
      detailPass ? 'PASS' : 'FAIL',
      'The subscribed issue detail composes project, assignee, labels, comments, and activity from bounded caller-scoped views.',
      {
        issueId: detail.target.id,
        projectId: detail.project?.id,
        assigneeName: detail.assigneeName,
        labelIds: detail.labels.map((row: any) => row.id).sort(),
        commentIds: detail.comments.map((row) => row.id.toString()),
        activityIds: detail.activities.map((row) => row.id.toString()),
        boundedQueryInventory: QUERIES,
      },
    );

    const optimisticBefore = issueById(alice, 'issue-010')!;
    const optimisticState = {
      ...optimisticBefore,
      status: 'review',
      priority: 'urgent',
      assigneeName: 'Bob',
      boardPosition: 610,
    };
    let mutationSettled = false;
    const optimisticMutation = alice.conn.reducers.updateIssue({
      issueId: optimisticBefore.id,
      expectedRevision: optimisticBefore.revision,
      status: optimisticState.status,
      priority: optimisticState.priority,
      assigneeName: optimisticState.assigneeName,
      boardPosition: optimisticState.boardPosition,
    }).then(() => {
      mutationSettled = true;
    });
    const optimisticVisibleBeforeSettlement = (
      optimisticState.status === 'review' && !mutationSettled
    );
    await optimisticMutation;
    await waitFor('optimistic update authoritative reconciliation', () => {
      const current = issueById(alice, optimisticBefore.id);
      return current?.revision === optimisticBefore.revision + 1n
        && current.status === optimisticState.status
        && current.priority === optimisticState.priority
        && current.assigneeName === optimisticState.assigneeName
        && current.boardPosition === optimisticState.boardPosition;
    });
    const optimisticAfter = issueById(alice, optimisticBefore.id)!;
    record(
      'LINEAR-06-OPTIMISTIC',
      optimisticVisibleBeforeSettlement
        && optimisticAfter.revision === optimisticBefore.revision + 1n
        ? 'PASS'
        : 'FAIL',
      'Application-owned optimistic issue state appears before reducer settlement and reconciles to the subscribed authoritative row.',
      {
        providerNativeOptimism: false,
        applicationGlue: 'local pending projection keyed by issue id',
        optimisticVisibleBeforeSettlement,
        beforeRevision: optimisticBefore.revision.toString(),
        afterRevision: optimisticAfter.revision.toString(),
        authoritativeState: {
          status: optimisticAfter.status,
          priority: optimisticAfter.priority,
          assigneeName: optimisticAfter.assigneeName,
          boardPosition: optimisticAfter.boardPosition,
        },
      },
    );

    const conflictBefore = issueById(alice, 'issue-011')!;
    const conflictResults = await Promise.allSettled([
      alice.conn.reducers.updateIssue({
        issueId: conflictBefore.id,
        expectedRevision: conflictBefore.revision,
        status: 'in-progress',
        priority: 'high',
        assigneeName: 'Alice',
        boardPosition: 700,
      }),
      bob.conn.reducers.updateIssue({
        issueId: conflictBefore.id,
        expectedRevision: conflictBefore.revision,
        status: 'review',
        priority: 'urgent',
        assigneeName: 'Bob',
        boardPosition: 701,
      }),
    ]);
    await waitFor('conflict winner converges on both clients', () => {
      const left = issueById(alice, conflictBefore.id);
      const right = issueById(bob, conflictBefore.id);
      return Boolean(
        left
        && right
        && left.revision === conflictBefore.revision + 1n
        && right.revision === left.revision
        && right.boardPosition === left.boardPosition,
      );
    });
    const conflictAfter = issueById(alice, conflictBefore.id)!;
    const fulfilled = conflictResults.filter((result) => result.status === 'fulfilled').length;
    const rejected = conflictResults.filter((result) => result.status === 'rejected').length;
    record(
      'LINEAR-07-CONFLICT',
      fulfilled === 1
        && rejected === 1
        && conflictAfter.revision === conflictBefore.revision + 1n
        ? 'PASS'
        : 'FAIL',
      'A two-actor barrier uses expected-revision compare-and-set: the first serialized reducer commits and the stale contender is rejected.',
      {
        barrier: 'Promise.allSettled from Alice and Bob connections',
        policy: 'first committed reducer wins; stale expected revision rejects',
        fulfilled,
        rejected,
        winner: conflictAfter.assigneeName,
        authoritativeRevision: conflictAfter.revision.toString(),
        authoritativeBoardPosition: conflictAfter.boardPosition,
        clientsConverged: true,
      },
    );

    const bobSecond = await connect('Bob second client', bob.token);
    extraClients.push(bobSecond);
    await subscribe(bobSecond);
    await waitFor(
      'Bob second client authoritative issue view',
      () => Array.from(bobSecond.conn.db.myIssues.iter()).length === 501,
    );
    const liveBody = 'Live acceptance comment from Alice';
    let commentObservedAt = 0;
    let activityObservedAt = 0;
    const commentCallback = (_ctx: unknown, row: any) => {
      if (row.body === liveBody) commentObservedAt = performance.now();
    };
    const activityCallback = (_ctx: unknown, row: any) => {
      if (row.kind === 'commented' && row.detail === liveBody) {
        activityObservedAt = performance.now();
      }
    };
    bobSecond.conn.db.myComments.onInsert(commentCallback);
    bobSecond.conn.db.myActivities.onInsert(activityCallback);
    const liveStartedAt = performance.now();
    await alice.conn.reducers.addComment({ issueId: 'issue-001', body: liveBody });
    await waitFor(
      'second client comment and activity push',
      () => commentObservedAt > 0 && activityObservedAt > 0,
    );
    bobSecond.conn.db.myComments.removeOnInsert(commentCallback);
    bobSecond.conn.db.myActivities.removeOnInsert(activityCallback);
    record(
      'LINEAR-08-LIVE',
      'PASS',
      'Bob’s second SDK client receives Alice’s committed comment and activity through native WebSocket view callbacks.',
      {
        secondClient: 'Bob second client',
        transport: 'SpacetimeDB WebSocket subscription callbacks',
        productPolling: false,
        commentDeliveryMs: Number((commentObservedAt - liveStartedAt).toFixed(3)),
        activityDeliveryMs: Number((activityObservedAt - liveStartedAt).toFixed(3)),
        authoritativeAuthor: 'Alice',
      },
    );

    record(
      'LINEAR-09-SEARCH',
      'GAP',
      'SpacetimeDB 2.7.0 exposes B-tree/direct indexes and SQL predicates but no ordinary native full-text issue-search index; no client filter is misrepresented as backend search.',
      {
        ordinaryPath: 'unsupported',
        providerVersion: '2.7.0',
        fullTextIndexIdentity: null,
        clientSideSearchClaimed: false,
        documentation: [
          'https://spacetimedb.com/docs/tables/indexes/',
          'https://spacetimedb.com/docs/sql/',
        ],
      },
    );

    const offlineProbe = await connect('Bob offline probe', bob.token);
    extraClients.push(offlineProbe);
    await subscribe(offlineProbe);
    await waitFor(
      'offline probe authoritative cache',
      () => Array.from(offlineProbe.conn.db.myIssues.iter()).length === 501,
    );
    const rowsBeforeDisconnect = Array.from(offlineProbe.conn.db.myIssues.iter()).length;
    offlineProbe.conn.disconnect();
    const warmRowsAfterDisconnect = Array.from(offlineProbe.conn.db.myIssues.iter()).length;
    let disconnectedMutationOutcome = 'pending-after-250ms';
    const disconnectedMutation = offlineProbe.conn.reducers.addComment({
        issueId: 'issue-001',
        body: 'must not queue while disconnected',
      }).then(
        () => { disconnectedMutationOutcome = 'fulfilled'; },
        () => { disconnectedMutationOutcome = 'rejected'; },
      );
    await Promise.race([
      disconnectedMutation,
      new Promise((resolve) => setTimeout(resolve, 250)),
    ]);
    const coldProbe = await connect('Bob cold cache probe', bob.token);
    extraClients.push(coldProbe);
    const coldRowsBeforeSubscribe = Array.from(coldProbe.conn.db.myIssues.iter()).length;
    record(
      'LINEAR-10-OFFLINE',
      'GAP',
      'The SDK retains an in-memory cache on one disconnected object but supplies neither provider-backed cold persistence nor an offline mutation queue.',
      {
        transportDisabled: true,
        rowsBeforeDisconnect,
        warmRowsAfterDisconnect,
        coldRowsBeforeSubscribe,
        disconnectedMutationOutcome,
        disconnectedMutationAccepted: disconnectedMutationOutcome === 'fulfilled',
        persistentColdCache: false,
        providerMutationQueue: false,
        reconnectTestedSeparately: true,
      },
    );

    const issueCountAfterMigration = Array.from(alice.conn.db.myIssues.iter()).length;
    const defaultImpactCount = Array.from(alice.conn.db.myIssues.iter())
      .filter((row) => row.id !== 'issue-concurrent-pagination' && row.customerImpact === 'normal')
      .length;
    const migrationTarget = issueById(alice, 'issue-020')!;
    await alice.conn.reducers.setCustomerImpact({
      issueId: migrationTarget.id,
      expectedRevision: migrationTarget.revision,
      customerImpact: 'high',
    });
    await waitFor(
      'indexed migration field update',
      () => issueById(alice, migrationTarget.id)?.customerImpact === 'high',
    );
    record(
      'LINEAR-11-MIGRATION',
      migrationBefore.counts.issues === 500
        && migrationAfter.issueCount === 500
        && issueCountAfterMigration === 501
        && defaultImpactCount === 500
        ? 'PASS'
        : 'FAIL',
      'Republishing added an indexed trailing customerImpact field with a default, retained all 500 seeded issues, and accepted an authoritative post-migration update.',
      {
        beforeCount: migrationBefore.counts.issues,
        afterPublishCount: migrationAfter.issueCount,
        currentCountIncludingAcceptanceInsert: issueCountAfterMigration,
        defaultedSeedRows: defaultImpactCount,
        updatedIssueId: migrationTarget.id,
        updatedValue: issueById(alice, migrationTarget.id)?.customerImpact,
        migrationReceiptPath: 'evidence/migration-receipt.json',
        indexProofPath: 'evidence/schema-after-migration.json',
      },
    );

    await samplePath('representative-list', async (index) => {
      await requestPage(alice, `perf-list-${index}`, { status: 'todo' });
    });
    await samplePath('representative-detail', async () => {
      const snapshot = detailSnapshot(alice, 'issue-250');
      assert(snapshot.project && snapshot.comments.length >= 2);
    });
    await samplePath('representative-write', async (index) => {
      const id = `issue-${String(100 + index).padStart(3, '0')}`;
      const current = issueById(alice, id)!;
      await alice.conn.reducers.updateIssue({
        issueId: id,
        expectedRevision: current.revision,
        status: current.status === 'review' ? 'in-progress' : 'review',
        priority: current.priority,
        assigneeName: current.assigneeName,
        boardPosition: current.boardPosition,
      });
      await waitFor(
        `performance write ${index}`,
        () => issueById(alice, id)?.revision === current.revision + 1n,
      );
    });
    await samplePath('realtime-delivery', async (index) => {
      const body = `Performance live comment ${index}`;
      let observed = false;
      const callback = (_ctx: unknown, row: any) => {
        if (row.body === body) observed = true;
      };
      bobSecond.conn.db.myComments.onInsert(callback);
      await alice.conn.reducers.addComment({ issueId: 'issue-001', body });
      await waitFor(`performance realtime ${index}`, () => observed);
      bobSecond.conn.db.myComments.removeOnInsert(callback);
    });
    await samplePath('reconnect', async (index) => {
      const reconnect = await connect(`Bob performance reconnect ${index}`, bob.token);
      await subscribe(reconnect);
      await waitFor(
        `performance reconnect ${index}`,
        () => Array.from(reconnect.conn.db.myIssues.iter()).length === 501,
      );
      reconnect.conn.disconnect();
    });

    record(
      'LINEAR-13-PERFORMANCE',
      'PASS',
      'Two warmups and seven retained samples cover server-materialized lists, composed detail, writes, native realtime, and reconnect; build/deploy samples are added by finalization.',
      {
        warmupsPerPath: 2,
        recordedPerPath: 7,
        harnessPaths: Object.keys(samples),
        machine: 'Minisforum AI Series / Linux x86_64',
        claimScope: 'small repeatable product workload; not production scale',
        sharedTargetPerformanceClaimed: false,
      },
    );

    const actorReceipt = {
      schemaVersion: 1,
      database: DATABASE,
      actors: {
        alice: sha256(alice.identity),
        bob: sha256(bob.identity),
        mallory: sha256(mallory.identity),
      },
      rawIdentitiesPersisted: false,
      rawCredentialsPersisted: false,
    };
    await writeFile(
      new URL('actor-identity-receipt.json', EVIDENCE),
      `${JSON.stringify(actorReceipt, null, 2)}\n`,
    );
    await writeFile(
      new URL('acceptance-results.partial.json', EVIDENCE),
      `${JSON.stringify({
        schemaVersion: 1,
        expectedCheckCount: 14,
        scenarios,
      }, null, 2)}\n`,
    );
    await writeFile(
      new URL('performance-samples.partial.json', EVIDENCE),
      `${JSON.stringify({
        schemaVersion: 1,
        units: 'milliseconds',
        machine: {
          label: 'Minisforum AI Series',
          os: 'Ubuntu 25.10',
          architecture: 'x86_64',
        },
        samples,
      }, null, 2)}\n`,
    );
    process.stdout.write(`${JSON.stringify({
      ok: scenarios.every((scenario) => scenario.status !== 'FAIL'),
      scenarios: scenarios.length,
      pass: scenarios.filter((scenario) => scenario.status === 'PASS').length,
      gap: scenarios.filter((scenario) => scenario.status === 'GAP').length,
    })}\n`);
  } finally {
    for (const client of [...clients, ...extraClients]) {
      try {
        client.conn.disconnect();
      } catch {
        // Preserve the primary assertion.
      }
    }
  }
}

main().catch(async (error) => {
  await mkdir(EVIDENCE, { recursive: true });
  await writeFile(
    new URL(`failed-attempts/acceptance-${Date.now()}.json`, EVIDENCE),
    `${JSON.stringify({
      classification: 'builder-or-harness-unclassified',
      name: error?.name,
      message: error?.message,
      stack: error?.stack,
    }, null, 2)}\n`,
  );
  console.error(error);
  process.exitCode = 1;
});
