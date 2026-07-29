import { spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import { performance } from 'node:perf_hooks';
import { resolve } from 'node:path';

globalThis.window = globalThis;
Object.defineProperty(globalThis, 'navigator', {
  configurable: true,
  value: { onLine: true },
});
globalThis.location = { href: 'https://llp0102.invalid/' };
globalThis.addEventListener = () => {};
globalThis.removeEventListener = () => {};
Object.defineProperty(globalThis, 'BroadcastChannel', {
  configurable: true,
  value: undefined,
});

const { init, id, StoreInterface } = await import('@instantdb/core');
const { init: initAdmin } = await import('@instantdb/admin');
const root = resolve(import.meta.dirname, '..');
const runtimeDir = resolve(root, '.arm-runtime');
const evidenceDir = resolve(root, '../evidence');
const receiptDir = resolve(root, '../receipts');
for (const directory of [runtimeDir, evidenceDir, receiptDir]) {
  mkdirSync(directory, { recursive: true });
}
const target = JSON.parse(readFileSync(resolve(runtimeDir, 'target.json'), 'utf8'));
const startedAt = new Date().toISOString();
const sha = (value) => createHash('sha256').update(String(value)).digest('hex');
const targetIdSha256 = sha(target.appId);
const admin = initAdmin({
  appId: target.appId,
  adminToken: target.adminToken,
  disableValidation: true,
});

class MemoryStore extends StoreInterface {
  constructor(appId, storeName) {
    super(appId, storeName);
    this.values = new Map();
  }
  async getItem(key) { return this.values.get(key) ?? null; }
  async setItem(key, value) { this.values.set(key, value); }
  async multiSet(pairs) {
    for (const [key, value] of pairs) this.values.set(key, value);
  }
  async removeItem(key) { this.values.delete(key); }
  async getAllKeys() { return [...this.values.keys()]; }
}

class AlwaysOnline {
  static async getIsOnline() { return true; }
  static listen() { return () => {}; }
}

const sleep = (ms) => new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
async function withTimeout(promise, ms, label) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`timeout: ${label}`)), ms);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
function assert(condition, message) {
  if (!condition) throw new Error(message);
}
const clients = new Set();
async function makeClient(label, refreshToken) {
  const db = init(
    {
      appId: target.appId,
      devtool: false,
      __extraDedupeKey: `llp0102-linear-${label}-${randomUUID()}`,
    },
    MemoryStore,
    AlwaysOnline,
  );
  clients.add(db);
  await withTimeout(
    new Promise((resolveReady) => {
      let unsubscribe = () => {};
      unsubscribe = db.subscribeAuth(() => {
        unsubscribe();
        resolveReady();
      });
    }),
    20_000,
    `${label} auth init`,
  );
  const auth = refreshToken
    ? await db.auth.signInWithToken(refreshToken)
    : await db.auth.signInAsGuest();
  await withTimeout(
    new Promise((resolveConnected) => {
      let unsubscribe = () => {};
      unsubscribe = db.subscribeConnectionStatus((status) => {
        if (status === 'authenticated') {
          unsubscribe();
          resolveConnected();
        }
      });
    }),
    25_000,
    `${label} WebSocket auth`,
  );
  return {
    label,
    db,
    id: auth.user.id,
    refreshToken: auth.user.refresh_token,
  };
}
function closeClient(actor) {
  actor.db.shutdown();
  clients.delete(actor.db);
}
const queryOnce = (actor, query) =>
  withTimeout(actor.db.queryOnce(query), 25_000, `${actor.label} query`);
function waitForQuery(actor, query, predicate, label, waitMs = 25_000) {
  return withTimeout(
    new Promise((resolveWait, reject) => {
      let unsubscribe = () => {};
      unsubscribe = actor.db.subscribeQuery(query, (result) => {
        if (result.error) {
          unsubscribe();
          reject(new Error(`${label}: ${result.error.message}`));
        } else if (predicate(result)) {
          unsubscribe();
          resolveWait(result);
        }
      });
    }),
    waitMs,
    label,
  );
}
async function deniedOrEmpty(actor, query, label) {
  return withTimeout(
    new Promise((resolveCheck) => {
      let unsubscribe = () => {};
      unsubscribe = actor.db.subscribeQuery(query, (result) => {
        if (result.error) {
          unsubscribe();
          resolveCheck({ denied: true, empty: true, errorClass: 'permission' });
          return;
        }
        const rows = result.data ? Object.values(result.data)[0] : null;
        if (Array.isArray(rows)) {
          unsubscribe();
          resolveCheck({ denied: false, empty: rows.length === 0, errorClass: null });
        }
      });
    }),
    25_000,
    label,
  );
}
const scenarios = [];
function record(idValue, result, summary, evidence) {
  scenarios.push({ id: idValue, result, summary, evidence });
}
const hashes = (rows) => rows.map((row) => sha(row.id)).sort();

const actorsPath = resolve(runtimeDir, 'actors.json');
const priorActors = existsSync(actorsPath)
  ? JSON.parse(readFileSync(actorsPath, 'utf8'))
  : {};
const alice = await makeClient('alice', priorActors.alice?.refreshToken);
const bob = await makeClient('bob', priorActors.bob?.refreshToken);
const mallory = await makeClient('mallory', priorActors.mallory?.refreshToken);
const actorRuntime = Object.fromEntries(
  [alice, bob, mallory].map((actor) => [
    actor.label,
    { id: actor.id, refreshToken: actor.refreshToken },
  ]),
);
writeFileSync(actorsPath, JSON.stringify(actorRuntime, null, 2) + '\n', { mode: 0o600 });
chmodSync(actorsPath, 0o600);
const actorHashes = Object.fromEntries(
  Object.entries(actorRuntime).map(([name, actor]) => [
    name,
    { idSha256: sha(actor.id), authKind: 'InstantDB native guest auth' },
  ]),
);

const beforeSeed = await admin.query({
  organizations: {}, memberships: {}, teams: {}, projects: {}, labels: {},
  issues: {}, comments: {}, activities: {},
});
assert(
  Object.values(beforeSeed).every((rows) => rows.length === 0),
  'fresh target was not empty before seed',
);

const primaryOrg = { id: id(), slug: 'primary', name: 'Primary Organization' };
const secondaryOrg = { id: id(), slug: 'secondary', name: 'Secondary Organization' };
const memberships = [
  { id: id(), key: 'primary:alice', org: primaryOrg.id, userId: alice.id, role: 'owner' },
  { id: id(), key: 'primary:bob', org: primaryOrg.id, userId: bob.id, role: 'member' },
  { id: id(), key: 'secondary:alice', org: secondaryOrg.id, userId: alice.id, role: 'owner' },
];
const teams = Array.from({ length: 3 }, (_, index) => ({
  id: id(), key: `primary:team:${index}`, name: `Team ${index + 1}`,
}));
const projects = Array.from({ length: 4 }, (_, index) => ({
  id: id(), key: `primary:project:${index}`, name: `Project ${index + 1}`,
}));
const labels = Array.from({ length: 20 }, (_, index) => ({
  id: id(), key: `primary:label:${index}`, name: `label-${String(index).padStart(2, '0')}`,
  color: `hsl(${index * 18} 70% 50%)`,
}));

await admin.transact([
  admin.tx.organizations[primaryOrg.id].update({
    slug: primaryOrg.slug, name: primaryOrg.name, ownerId: alice.id,
  }),
  admin.tx.organizations[secondaryOrg.id].update({
    slug: secondaryOrg.slug, name: secondaryOrg.name, ownerId: alice.id,
  }),
]);
await admin.transact(memberships.map((membership) =>
  admin.tx.memberships[membership.id]
    .update({ key: membership.key, userId: membership.userId, role: membership.role })
    .link({ organization: membership.org, user: membership.userId }),
));
await admin.transact(teams.map((team) =>
  admin.tx.teams[team.id]
    .update({ key: team.key, name: team.name, orgId: primaryOrg.id })
    .link({ organization: primaryOrg.id }),
));
await admin.transact(projects.map((project) =>
  admin.tx.projects[project.id]
    .update({ key: project.key, name: project.name, orgId: primaryOrg.id })
    .link({ organization: primaryOrg.id }),
));
await admin.transact(labels.map((label) =>
  admin.tx.labels[label.id]
    .update({ key: label.key, name: label.name, color: label.color, orgId: primaryOrg.id })
    .link({ organization: primaryOrg.id }),
));

const statuses = ['backlog', 'todo', 'in_progress', 'done'];
const priorities = ['urgent', 'high', 'normal', 'low'];
const issueFixture = [];
for (let offset = 0; offset < 500; offset += 25) {
  const txs = [];
  for (let index = offset; index < offset + 25; index += 1) {
    const issueId = id();
    const commentA = id();
    const commentB = id();
    const activityId = id();
    const assigneeId = index % 2 === 0 ? alice.id : bob.id;
    const issue = {
      id: issueId,
      issueNumber: index + 1,
      status: statuses[index % statuses.length],
      priority: priorities[index % priorities.length],
      assigneeId,
      project: projects[index % projects.length],
      team: teams[index % teams.length],
      labelIds: [labels[index % labels.length].id, labels[(index + 1) % labels.length].id],
      comments: [commentA, commentB],
      activity: activityId,
      createdOrder: index + 1,
    };
    issueFixture.push(issue);
    txs.push(
      admin.tx.issues[issueId]
        .update({
          issueNumber: issue.issueNumber,
          title: `Issue ${String(issue.issueNumber).padStart(3, '0')} native sync`,
          description: `Production-shaped issue ${issue.issueNumber} for InstantDB.`,
          status: issue.status,
          priority: issue.priority,
          assigneeId,
          orgId: primaryOrg.id,
          teamId: issue.team.id,
          projectId: issue.project.id,
          boardPosition: index,
          revision: 0,
          moveNonce: `seed-${index}`,
          createdOrder: issue.createdOrder,
          updatedAt: new Date(Date.UTC(2026, 6, 1, 0, 0, index)),
        })
        .link({
          organization: primaryOrg.id,
          team: issue.team.id,
          project: issue.project.id,
          assignee: assigneeId,
          labels: issue.labelIds,
        }),
      admin.tx.comments[commentA]
        .update({
          authorId: alice.id,
          body: `Comment A for issue ${issue.issueNumber}`,
          clientNonce: `seed-comment-${index}-a`,
          createdOrder: 10_000 + index * 2,
          createdAt: new Date(Date.UTC(2026, 6, 2, 0, 0, index)),
        })
        .link({ issue: issueId }),
      admin.tx.comments[commentB]
        .update({
          authorId: bob.id,
          body: `Comment B for issue ${issue.issueNumber}`,
          clientNonce: `seed-comment-${index}-b`,
          createdOrder: 10_001 + index * 2,
          createdAt: new Date(Date.UTC(2026, 6, 2, 1, 0, index)),
        })
        .link({ issue: issueId }),
      admin.tx.activities[activityId]
        .update({
          actorId: alice.id,
          kind: 'issue.created',
          detail: `Created issue ${issue.issueNumber}`,
          clientNonce: `seed-activity-${index}`,
          createdOrder: 20_000 + index,
          createdAt: new Date(Date.UTC(2026, 6, 3, 0, 0, index)),
        })
        .link({ issue: issueId }),
    );
  }
  await admin.transact(txs);
}

const seedAuthority = await admin.query({
  organizations: {}, memberships: {}, teams: {}, projects: {}, labels: {},
  issues: {}, comments: {}, activities: {},
});
const seedCounts = Object.fromEntries(
  Object.entries(seedAuthority).map(([namespace, rows]) => [namespace, rows.length]),
);
assert(
  JSON.stringify(seedCounts) === JSON.stringify({
    organizations: 2, memberships: 3, teams: 3, projects: 4, labels: 20,
    issues: 500, comments: 1000, activities: 500,
  }),
  `authoritative seed counts drifted: ${JSON.stringify(seedCounts)}`,
);
writeFileSync(
  resolve(receiptDir, 'seed-receipt.json'),
  JSON.stringify({
    operation: 'seed-frozen-linear-workload',
    targetIdSha256,
    actorHashes,
    authoritativeCounts: seedCounts,
    finishedAt: new Date().toISOString(),
  }, null, 2) + '\n',
);
record('LINEAR-01-SEED', 'PASS', 'Exact production-shaped dataset and personas exist.', {
  targetIdSha256, authoritativeCounts: seedCounts, receipt: '../receipts/seed-receipt.json',
});

const aliceOrgs = await queryOnce(alice, { organizations: {} });
const bobOrgs = await queryOnce(bob, { organizations: {} });
const malloryOrgs = await queryOnce(mallory, { organizations: {} });
const malloryIssues = await deniedOrEmpty(mallory, { issues: {} }, 'Mallory issue read');
assert(aliceOrgs.data.organizations.length === 2, 'Alice owner view mismatch');
assert(bobOrgs.data.organizations.length === 1, 'Bob member view mismatch');
assert(malloryOrgs.data.organizations.length === 0 && malloryIssues.empty, 'STOP: outsider read disclosed');
const authorityIssue = issueFixture[0];
const originalAuthorityPriority = authorityIssue.priority;
await alice.db.transact(alice.db.tx.issues[authorityIssue.id].update({
  priority: 'high', revision: 1, moveNonce: 'authority-alice', updatedAt: new Date(),
}));
await bob.db.transact(bob.db.tx.issues[authorityIssue.id].update({
  priority: 'urgent', revision: 2, moveNonce: 'authority-bob', updatedAt: new Date(),
}));
let negativeWriteDenied = false;
try {
  await mallory.db.transact(mallory.db.tx.issues[authorityIssue.id].update({
    priority: 'low', revision: 3, moveNonce: 'authority-mallory', updatedAt: new Date(),
  }));
} catch {
  negativeWriteDenied = true;
}
assert(negativeWriteDenied, 'STOP: outsider issue write succeeded');
await admin.transact(admin.tx.issues[authorityIssue.id].update({
  priority: originalAuthorityPriority, revision: 0, moveNonce: 'seed-0',
}));
record('LINEAR-02-AUTHORITY', 'PASS', 'Owner, member, and outsider have distinct allowed views and writes.', {
  organizationViews: { alice: 2, bob: 1, mallory: 0 },
  positiveWrites: ['alice-owner', 'bob-member'],
  negativeRead: malloryIssues,
  negativeWriteDenied,
});

const filterCases = [
  ['status', { status: 'todo' }],
  ['assignee', { assigneeId: alice.id }],
  ['project', { projectId: projects[0].id }],
  ['label', { 'labels.id': labels[0].id }],
];
const filterEvidence = {};
for (const [name, where] of filterCases) {
  const member = await queryOnce(alice, {
    issues: { $: { where, order: { createdOrder: 'asc' } } },
  });
  const authority = await admin.query({
    issues: { $: { where, order: { createdOrder: 'asc' } } },
  });
  assert(
    JSON.stringify(hashes(member.data.issues)) === JSON.stringify(hashes(authority.issues)),
    `${name} filter diverged from authority`,
  );
  filterEvidence[name] = {
    count: member.data.issues.length,
    resultSetSha256: sha(hashes(authority.issues).join(':')),
  };
}
record('LINEAR-03-FILTERS', 'PASS', 'Indexed native filters matched authoritative expected sets.', {
  filters: filterEvidence,
  indexProof: 'instant.schema.base.ts indexed status, assigneeId, projectId; relation predicate uses indexed label id',
  transport: 'native InstaQL backend where predicates; no client filtering',
});

const pageQuery = {
  issues: { $: { first: 50, order: { createdOrder: 'desc' } } },
};
const page1 = await queryOnce(alice, pageQuery);
const firstCursor = page1.pageInfo.issues.endCursor;
const insertedId = id();
await admin.transact(
  admin.tx.issues[insertedId]
    .update({
      issueNumber: 501,
      title: 'Concurrent pagination insert',
      description: 'Inserted after page one.',
      status: 'todo',
      priority: 'normal',
      assigneeId: bob.id,
      orgId: primaryOrg.id,
      teamId: teams[0].id,
      projectId: projects[0].id,
      boardPosition: 501,
      revision: 0,
      moveNonce: 'pagination-insert',
      createdOrder: 1_000_000,
      updatedAt: new Date(),
    })
    .link({
      organization: primaryOrg.id,
      team: teams[0].id,
      project: projects[0].id,
      assignee: bob.id,
      labels: [labels[0].id],
    }),
);
const page2 = await queryOnce(alice, {
  issues: { $: { first: 50, after: firstCursor, order: { createdOrder: 'desc' } } },
});
const page1Ids = new Set(page1.data.issues.map((issue) => issue.id));
const page2Ids = new Set(page2.data.issues.map((issue) => issue.id));
const overlap = [...page1Ids].filter((issueId) => page2Ids.has(issueId));
assert(page1Ids.size === 50 && page2Ids.size === 50, 'pagination page size mismatch');
assert(overlap.length === 0 && !page2Ids.has(insertedId), 'cursor pagination duplicated or shifted');
await admin.transact(admin.tx.issues[insertedId].delete());
record('LINEAR-04-PAGINATION', 'PASS', 'Stable 50-row cursor pagination remained nonduplicating under insert.', {
  cursorValues: {
    page1EndSha256: sha(JSON.stringify(firstCursor)),
    page2EndSha256: sha(JSON.stringify(page2.pageInfo.issues.endCursor)),
  },
  pageSizes: [50, 50],
  overlapCount: overlap.length,
  concurrentNewerRowOnPage2: page2Ids.has(insertedId),
  authoritativeOrder: 'unique indexed createdOrder desc',
});

const detailIssue = issueFixture[7];
const detail = await queryOnce(alice, {
  issues: {
    $: { where: { id: detailIssue.id } },
    project: {},
    assignee: {},
    labels: {},
    comments: {},
    activities: {},
  },
});
const detailRow = detail.data.issues[0];
const relationCounts = {
  issues: detail.data.issues.length,
  project: detailRow.project.length,
  assignee: detailRow.assignee.length,
  labels: detailRow.labels.length,
  comments: detailRow.comments.length,
  activities: detailRow.activities.length,
};
assert(
  JSON.stringify(relationCounts) === JSON.stringify({
    issues: 1, project: 1, assignee: 1, labels: 2, comments: 2, activities: 1,
  }),
  `detail composition mismatch: ${JSON.stringify(relationCounts)}`,
);
record('LINEAR-05-DETAIL', 'PASS', 'One bounded native query composed all required issue detail.', {
  relatedIdHashes: {
    project: hashes(detailRow.project), assignee: hashes(detailRow.assignee),
    labels: hashes(detailRow.labels), comments: hashes(detailRow.comments),
    activities: hashes(detailRow.activities),
  },
  boundedQueryInventory: {
    topLevel: 'issues where id equals one exact id',
    nestedRelations: ['project', 'assignee', 'labels', 'comments', 'activities'],
    returnedCounts: relationCounts,
  },
});

const optimisticIssue = issueFixture[10];
const optimisticQuery = { issues: { $: { where: { id: optimisticIssue.id } } } };
let settled = false;
let localBeforeSettlement = false;
const stopOptimistic = optimisticIssue
  ? alice.db.subscribeQuery(optimisticQuery, (result) => {
      const row = result.data?.issues?.[0];
      if (row?.moveNonce === 'optimistic-proof' && !settled) localBeforeSettlement = true;
    })
  : () => {};
const optimisticPromise = alice.db.transact(
  alice.db.tx.issues[optimisticIssue.id]
    .update({
      status: 'done',
      priority: 'urgent',
      assigneeId: bob.id,
      boardPosition: 77,
      revision: 1,
      moveNonce: 'optimistic-proof',
      updatedAt: new Date(),
    })
    .link({ assignee: bob.id }),
);
for (let attempt = 0; attempt < 30 && !localBeforeSettlement; attempt += 1) await sleep(10);
const optimisticSettlement = await optimisticPromise;
settled = true;
stopOptimistic();
const optimisticAuthority = (await admin.query({
  issues: { $: { where: { id: optimisticIssue.id } }, assignee: {} },
})).issues[0];
assert(
  optimisticAuthority.status === 'done' &&
    optimisticAuthority.priority === 'urgent' &&
    optimisticAuthority.assigneeId === bob.id &&
    optimisticAuthority.boardPosition === 77,
  'optimistic update did not reconcile authoritatively',
);
record('LINEAR-06-OPTIMISTIC', 'PASS', 'Four optimistic fields reconciled to authority.', {
  optimisticStateAttribution: {
    source: 'InstantDB subscribeQuery local materialization',
    observedBeforeTransactPromiseSettlement: localBeforeSettlement,
  },
  settlement: optimisticSettlement.status,
  authoritativeState: {
    status: optimisticAuthority.status,
    priority: optimisticAuthority.priority,
    assigneeIdSha256: sha(optimisticAuthority.assigneeId),
    boardPosition: optimisticAuthority.boardPosition,
  },
});

const conflictIssue = issueFixture[11];
const aliceNonce = `alice-${randomUUID()}`;
const bobNonce = `bob-${randomUUID()}`;
await Promise.all([
  alice.db.transact(alice.db.tx.issues[conflictIssue.id].update({
    boardPosition: 301, priority: 'high', revision: 1,
    moveNonce: aliceNonce, updatedAt: new Date(),
  })),
  bob.db.transact(bob.db.tx.issues[conflictIssue.id].update({
    boardPosition: 302, priority: 'low', revision: 1,
    moveNonce: bobNonce, updatedAt: new Date(),
  })),
]);
const conflictAuthority = (await admin.query({
  issues: { $: { where: { id: conflictIssue.id } } },
})).issues[0];
assert([aliceNonce, bobNonce].includes(conflictAuthority.moveNonce), 'conflict wrote torn values');
const [aliceConflict, bobConflict] = await Promise.all([
  queryOnce(alice, { issues: { $: { where: { id: conflictIssue.id } } } }),
  queryOnce(bob, { issues: { $: { where: { id: conflictIssue.id } } } }),
]);
assert(
  aliceConflict.data.issues[0].moveNonce === conflictAuthority.moveNonce &&
    bobConflict.data.issues[0].moveNonce === conflictAuthority.moveNonce,
  'clients did not reconcile conflict winner',
);
record('LINEAR-07-CONFLICT', 'PASS', 'Concurrent whole-record updates converged under InstantDB last-write-wins.', {
  twoActorBarrier: 'Promise.all dispatched Alice and Bob native transactions',
  documentedPolicy: 'InstantDB last-write-wins; moveNonce identifies the authoritative whole-record winner',
  winner: conflictAuthority.moveNonce === aliceNonce ? 'alice' : 'bob',
  authoritativeOutcome: {
    boardPosition: conflictAuthority.boardPosition,
    priority: conflictAuthority.priority,
    moveNonceSha256: sha(conflictAuthority.moveNonce),
  },
  clientReconciliation: { alice: true, bob: true },
});

const liveCommentId = id();
const liveActivityId = id();
const liveQuery = {
  comments: { $: { where: { id: liveCommentId } } },
  activities: { $: { where: { id: liveActivityId } } },
};
const liveDelivery = waitForQuery(
  bob,
  liveQuery,
  (result) => result.data.comments.length === 1 && result.data.activities.length === 1,
  'Bob native comment/activity delivery',
);
await alice.db.transact([
  alice.db.tx.comments[liveCommentId]
    .update({
      authorId: alice.id,
      body: 'Live comment from Alice',
      clientNonce: `live-comment-${liveCommentId}`,
      createdOrder: 90_000,
      createdAt: new Date(),
    })
    .link({ issue: detailIssue.id }),
  alice.db.tx.activities[liveActivityId]
    .update({
      actorId: alice.id,
      kind: 'comment.created',
      detail: 'Alice added a live comment',
      clientNonce: `live-activity-${liveActivityId}`,
      createdOrder: 90_001,
      createdAt: new Date(),
    })
    .link({ issue: detailIssue.id }),
]);
await liveDelivery;
const liveAuthority = await admin.query({
  comments: { $: { where: { id: liveCommentId } } },
  activities: { $: { where: { id: liveActivityId } } },
});
assert(liveAuthority.comments.length === 1 && liveAuthority.activities.length === 1, 'live authority missing');
record('LINEAR-08-LIVE', 'PASS', 'Comment and activity reached Bob through native realtime.', {
  secondClient: 'Bob distinct native guest client',
  transportAttribution: 'InstantDB WebSocket query subscription',
  productPolling: false,
  authority: { comments: 1, activities: 1 },
});

record('LINEAR-09-SEARCH', 'GAP', 'InstantDB exposes indexed comparison/pattern queries but no ordinary native full-text issue-search facility.', {
  nonclaim: true,
  clientSideSearchUsed: false,
  indexedTitleAvailable: true,
  providerOrdinaryPath: 'No documented full-text index/query path in pinned SDK/CLI; $like/$ilike pattern matching was not relabeled full text.',
  authoritativeResults: null,
});

writeFileSync(
  resolve(evidenceDir, 'pre-offline-results.json'),
  JSON.stringify({
    targetIdSha256,
    actorHashes,
    scenarios,
    offlinePending: true,
    capturedAt: new Date().toISOString(),
  }, null, 2) + '\n',
);

const beforeMigration = await admin.query({ issues: {}, comments: {} });
copyFileSync(resolve(root, 'instant.schema.evolved.ts'), resolve(root, 'instant.schema.ts'));
const migrationStart = new Date().toISOString();
const migrationPush = spawnSync(process.execPath, [resolve(root, 'scripts/push-config.mjs')], {
  cwd: root,
  env: process.env,
  encoding: 'utf8',
});
if (migrationPush.status !== 0) {
  throw new Error(`indexed-field migration push failed: ${migrationPush.stderr.slice(-1000)}`);
}
const afterMigration = await admin.query({ issues: {}, comments: {} });
assert(
  beforeMigration.issues.length === afterMigration.issues.length &&
    beforeMigration.comments.length === afterMigration.comments.length,
  'migration lost seeded data',
);
const migrationReceipt = {
  operation: 'add-optional-indexed-estimatePoints',
  startedAt: migrationStart,
  finishedAt: new Date().toISOString(),
  targetIdSha256,
  beforeCounts: { issues: beforeMigration.issues.length, comments: beforeMigration.comments.length },
  afterCounts: { issues: afterMigration.issues.length, comments: afterMigration.comments.length },
  indexProof: 'instant.schema.evolved.ts: estimatePoints is number().indexed().optional()',
  cliReceipt: 'latest receipts/config-push-*.json',
};
writeFileSync(
  resolve(receiptDir, 'migration.json'),
  JSON.stringify(migrationReceipt, null, 2) + '\n',
);
record('LINEAR-11-MIGRATION', 'PASS', 'An indexed field was added without losing seeded data.', migrationReceipt);

const reconnectToken = bob.refreshToken;
const detailPerformanceQuery = {
  issues: {
    $: { where: { id: detailIssue.id } },
    project: {}, assignee: {}, labels: {}, comments: {}, activities: {},
  },
};
const nearestRank = (values, percentile) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.ceil(percentile * sorted.length) - 1];
};
const stats = (values) => ({
  rawMs: values,
  medianMs: nearestRank(values, 0.5),
  nearestRankP95Ms: nearestRank(values, 0.95),
});
const samples = {
  representativeList: [],
  representativeDetail: [],
  representativeWrite: [],
  realtimeDelivery: [],
  reconnect: [],
};
const perfCreated = [];
for (let iteration = 0; iteration < 9; iteration += 1) {
  const recorded = iteration >= 2;
  let begin = performance.now();
  const listResult = await queryOnce(alice, pageQuery);
  const listMs = performance.now() - begin;
  assert(listResult.data.issues.length === 50, 'performance list mismatch');

  begin = performance.now();
  const detailResult = await queryOnce(alice, detailPerformanceQuery);
  const detailMs = performance.now() - begin;
  assert(detailResult.data.issues.length === 1, 'performance detail mismatch');

  begin = performance.now();
  await alice.db.transact(alice.db.tx.issues[optimisticIssue.id].update({
    priority: iteration % 2 ? 'normal' : 'high',
    revision: 100 + iteration,
    moveNonce: `perf-write-${iteration}`,
    updatedAt: new Date(),
  }));
  const writeMs = performance.now() - begin;

  const perfCommentId = id();
  const perfActivityId = id();
  perfCreated.push(['comments', perfCommentId], ['activities', perfActivityId]);
  begin = performance.now();
  const delivery = waitForQuery(
    bob,
    {
      comments: { $: { where: { id: perfCommentId } } },
      activities: { $: { where: { id: perfActivityId } } },
    },
    (result) => result.data.comments.length === 1 && result.data.activities.length === 1,
    `performance realtime ${iteration}`,
  );
  await alice.db.transact([
    alice.db.tx.comments[perfCommentId]
      .update({
        authorId: alice.id, body: `perf-${iteration}`,
        clientNonce: `perf-comment-${perfCommentId}`,
        createdOrder: 91_000 + iteration, createdAt: new Date(),
      })
      .link({ issue: detailIssue.id }),
    alice.db.tx.activities[perfActivityId]
      .update({
        actorId: alice.id, kind: 'perf', detail: `perf-${iteration}`,
        clientNonce: `perf-activity-${perfActivityId}`,
        createdOrder: 92_000 + iteration, createdAt: new Date(),
      })
      .link({ issue: detailIssue.id }),
  ]);
  await delivery;
  const realtimeMs = performance.now() - begin;

  begin = performance.now();
  const reconnectClient = await makeClient(`perf-reconnect-${iteration}`, reconnectToken);
  const reconnectResult = await queryOnce(reconnectClient, pageQuery);
  closeClient(reconnectClient);
  const reconnectMs = performance.now() - begin;
  assert(reconnectResult.data.issues.length === 50, 'performance reconnect mismatch');

  if (recorded) {
    samples.representativeList.push(listMs);
    samples.representativeDetail.push(detailMs);
    samples.representativeWrite.push(writeMs);
    samples.realtimeDelivery.push(realtimeMs);
    samples.reconnect.push(reconnectMs);
  }
}
for (const [namespace, entityId] of perfCreated) {
  await admin.transact(admin.tx[namespace][entityId].delete());
}
const performanceEvidence = {
  claimScope: 'small repeatable product workload; not production scale',
  warmups: 2,
  recordedSamples: 7,
  rawSamples: samples,
  statistics: Object.fromEntries(
    Object.entries(samples).map(([name, values]) => [name, stats(values)]),
  ),
  machine: {
    hostname: os.hostname(), platform: `${os.platform()} ${os.release()} ${os.arch()}`,
    cpus: os.cpus().length, memoryBytes: os.totalmem(), loadAverageAtCapture: os.loadavg(),
    node: process.version,
  },
  target: {
    provider: 'InstantDB hosted temporary app',
    targetIdSha256,
    region: 'provider-selected; not exposed',
    plan: 'official temporary/free',
  },
  costWindow: {
    from: target.provisionedAt,
    through: 'scoped cleanup',
    actualProviderChargeUsd: 0,
    actualUsageAvailability: 'Temporary app created without account/billing; no metered bill surface.',
    listPriceEstimateUsd: 0,
    estimateBasis: 'Official CLI temporary application; automatic deletion after more than 24 hours.',
    extrapolationCountedAsMeasured: false,
  },
  buildOrDeploy: 'evidence/performance-build.json (captured separately with 2+7 runs)',
};
writeFileSync(
  resolve(evidenceDir, 'performance-partial.json'),
  JSON.stringify(performanceEvidence, null, 2) + '\n',
);
record('LINEAR-13-PERFORMANCE', 'PASS', 'Frozen runtime samples and cost window retained; build samples are finalized separately.', {
  warmups: 2,
  recordedSamples: 7,
  paths: Object.keys(samples),
  rawReceipt: 'performance-partial.json',
  costWindow: performanceEvidence.costWindow,
});

const backupData = await admin.query({
  organizations: {}, memberships: {}, teams: {}, projects: {}, labels: {},
  issues: {}, comments: {}, activities: {},
});
const backupSummary = Object.fromEntries(
  Object.entries(backupData).map(([namespace, rows]) => [
    namespace,
    {
      count: rows.length,
      canonicalIdSetSha256: sha(rows.map((row) => row.id).sort().join(':')),
    },
  ]),
);
const operationsReceipt = {
  operation: 'hosted-operations-inspection',
  targetIdSha256,
  deploymentIdentity: {
    mode: 'official hosted temporary app',
    namespace: target.title,
    region: 'provider-selected; not exposed',
  },
  configuration: {
    schema: 'instant.schema.ts',
    permissions: 'instant.perms.ts',
    pushReceipts: 'receipts/config-push-*.json',
  },
  exportPath: {
    mechanism: 'app-scoped @instantdb/admin authoritative query snapshot',
    summary: backupSummary,
    restorableArtifactRetained: false,
    note: 'A data-bearing raw export was intentionally not committed.',
  },
  logs: { inspectable: false, reason: 'Temporary app token/CLI exposes no deployment log surface.' },
  rollback: { inspectable: false, reason: 'CLI exposes push/pull but no deployment rollback primitive.' },
  capturedAt: new Date().toISOString(),
};
writeFileSync(
  resolve(receiptDir, 'operations.json'),
  JSON.stringify(operationsReceipt, null, 2) + '\n',
);
record('LINEAR-12-DEPLOY', 'GAP', 'Hosted identity/config/export are inspectable, but logs and rollback are not exposed to the temporary app token.', {
  targetIdSha256,
  deploymentReceipt: '../receipts/target-provision-redacted.json',
  operationsReceipt: '../receipts/operations.json',
  logs: operationsReceipt.logs,
  rollback: operationsReceipt.rollback,
  nonclaim: true,
});

writeFileSync(
  resolve(evidenceDir, 'acceptance-results.json'),
  JSON.stringify({
    schemaVersion: 1,
    app: 'linear',
    provider: 'instantdb',
    expectedCheckCount: 14,
    completedFunctionalCheckCount: scenarios.length,
    startedAt,
    capturedAt: new Date().toISOString(),
    targetIdSha256,
    actorHashes,
    scenarioResults: scenarios,
    offlinePending: true,
    cleanupPending: true,
    stopDefects: [],
  }, null, 2) + '\n',
);
for (const db of clients) {
  try { db.shutdown(); } catch {}
}
process.stdout.write(JSON.stringify({
  ok: true,
  targetIdSha256,
  completedBeforeOfflineAndCleanup: scenarios.length,
  pass: scenarios.filter((scenario) => scenario.result === 'PASS').length,
  gap: scenarios.filter((scenario) => scenario.result === 'GAP').length,
}) + '\n');
process.exit(0);
