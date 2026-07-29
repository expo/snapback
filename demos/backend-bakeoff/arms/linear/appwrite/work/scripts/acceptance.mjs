import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright-core";
import { Permission, Query, Role } from "node-appwrite";
import {
  actorClient,
  allRows,
  databaseId,
  ownerWrite,
  primaryRead,
  primaryTeamId,
  primaryWrite,
  runtime,
  tableIds,
  tables,
} from "./admin-client.mjs";
import { receiptsRoot, vitePort, projectId } from "./constants.mjs";

// @ref LLP 0102#app-3-linear-shaped-issue-tracker — Frozen workload and evidence contract.
const baseline = JSON.parse(await readFile(path.resolve(receiptsRoot, "baseline.v1.json")));
const startedEpoch = Date.parse(baseline.capturedAt);
const startedAt = new Date().toISOString();
const scenarioRoot = path.resolve(receiptsRoot, "scenarios");
await mkdir(scenarioRoot, { recursive: true });
const scenarios = {};
const milestone = {
  firstLocalReadMs: null,
  firstAuthoritativeMutationMs: null,
  firstRealtimeTransitionMs: null,
  localAcceptanceMs: null,
  hostedUrlMs: null,
  acceptanceCompletionMs: null,
};
const elapsed = () => Date.now() - startedEpoch;
const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};
const hash = (value) => createHash("sha256").update(value).digest("hex");
async function receipt(id, status, transport, evidence, note) {
  const value = {
    id,
    status,
    checkedAt: new Date().toISOString(),
    projectId,
    transport,
    evidence,
    note,
  };
  scenarios[id] = value;
  await writeFile(path.resolve(scenarioRoot, `${id}.json`), `${JSON.stringify(value, null, 2)}\n`);
  return value;
}
async function count(tableId) {
  return (await tables.listRows({
    databaseId,
    tableId,
    queries: [Query.limit(1)],
    total: true,
  })).total;
}

for (const [tableId, floor] of [[tableIds.comments, 1000], [tableIds.activities, 500]]) {
  const extras = await tables.listRows({
    databaseId,
    tableId,
    queries: [
      Query.equal("org_id", ["org-primary"]),
      Query.greaterThan("sequence", floor),
      Query.limit(500),
    ],
    total: true,
  });
  for (const row of extras.rows) {
    await tables.deleteRow({ databaseId, tableId, rowId: row.$id });
  }
}
await tables.updateRow({
  databaseId,
  tableId: tableIds.issues,
  rowId: "issue-500",
  data: {
    title: "Issue 500 deterministic search fixture",
    search_text: "Issue 500 deterministic search fixture Production-shaped Appwrite issue body 500",
    revision: 1,
  },
  permissions: primaryWrite,
});
const seedCounts = Object.fromEntries(await Promise.all(
  Object.entries(tableIds).map(async ([name, tableId]) => [name, await count(tableId)]),
));
const expectedCounts = {
  organizations: 2,
  teams: 3,
  projects: 4,
  members: 2,
  labels: 20,
  issueLabels: 1000,
  issues: 500,
  comments: 1000,
  activities: 500,
};
assert(JSON.stringify(seedCounts) === JSON.stringify(expectedCounts), "Seed counts changed");
milestone.firstLocalReadMs = elapsed();
await receipt(
  "LINEAR-01-SEED",
  "pass",
  "not-applicable",
  {
    authoritativeAdminCounts: seedCounts,
    actors: 3,
    concurrentClients: 2,
    pageSize: 50,
    targetIdentity: { endpointHash: hash("http://127.0.0.1:8091/v1"), projectIdHash: hash(projectId) },
  },
  "Admin authority directly verified the exact frozen dataset after native Auth users and Teams were provisioned.",
);

const [alice, bob, mallory] = await Promise.all([
  actorClient("alice"),
  actorClient("bob"),
  actorClient("mallory"),
]);
const aliceOrganizations = await alice.tables.listRows({
  databaseId,
  tableId: tableIds.organizations,
  queries: [Query.limit(10)],
  total: true,
});
const bobIssues = await bob.tables.listRows({
  databaseId,
  tableId: tableIds.issues,
  queries: [Query.equal("org_id", ["org-primary"]), Query.limit(1)],
  total: true,
});
const malloryIssues = await mallory.tables.listRows({
  databaseId,
  tableId: tableIds.issues,
  queries: [Query.equal("org_id", ["org-primary"]), Query.limit(1)],
  total: true,
});
const originalOrg = await tables.getRow({
  databaseId,
  tableId: tableIds.organizations,
  rowId: "org-primary",
});
await alice.tables.updateRow({
  databaseId,
  tableId: tableIds.organizations,
  rowId: "org-primary",
  data: { name: "Primary by Alice" },
});
let bobOwnerDenied = false;
try {
  await bob.tables.updateRow({
    databaseId,
    tableId: tableIds.organizations,
    rowId: "org-primary",
    data: { name: "Forbidden Bob owner edit" },
  });
} catch (error) {
  bobOwnerDenied = error.code === 401 || error.code === 403 || error.code === 404;
}
let malloryDirectDenied = false;
try {
  await mallory.tables.getRow({
    databaseId,
    tableId: tableIds.issues,
    rowId: "issue-500",
  });
} catch (error) {
  malloryDirectDenied = error.code === 401 || error.code === 403 || error.code === 404;
}
await tables.updateRow({
  databaseId,
  tableId: tableIds.organizations,
  rowId: "org-primary",
  data: { name: originalOrg.name },
  permissions: ownerWrite,
});
assert(
  aliceOrganizations.total === 1 &&
  bobIssues.total === 500 &&
  malloryIssues.total === 0 &&
  bobOwnerDenied &&
  malloryDirectDenied,
  "Actor authority proof failed",
);
milestone.firstAuthoritativeMutationMs = elapsed();
await receipt(
  "LINEAR-02-AUTHORITY",
  "pass",
  "not-applicable",
  {
    aliceVisibleOrganizations: aliceOrganizations.rows.map((row) => row.$id),
    bobVisibleIssueTotal: bobIssues.total,
    malloryVisibleIssueTotal: malloryIssues.total,
    aliceOwnerMutation: "committed-and-restored",
    bobOwnerMutationDenied: bobOwnerDenied,
    malloryDirectIssueReadDenied: malloryDirectDenied,
    teamRoles: { alice: "owner", bob: "member", mallory: "outsider" },
  },
  "Native Auth sessions and Team-role permissions directly distinguished owner, member, and outsider.",
);

const filterSpecs = {
  status: [
    Query.equal("org_id", ["org-primary"]),
    Query.equal("status", ["todo"]),
    Query.orderDesc("sequence"),
    Query.limit(50),
  ],
  assignee: [
    Query.equal("org_id", ["org-primary"]),
    Query.equal("assignee_id", ["bob"]),
    Query.orderDesc("sequence"),
    Query.limit(50),
  ],
  project: [
    Query.equal("org_id", ["org-primary"]),
    Query.equal("project_id", ["project-2"]),
    Query.orderDesc("sequence"),
    Query.limit(50),
  ],
};
const filterResults = {};
for (const [name, queries] of Object.entries(filterSpecs)) {
  const result = await bob.tables.listRows({
    databaseId,
    tableId: tableIds.issues,
    queries,
    total: true,
  });
  filterResults[name] = { total: result.total, ids: result.rows.map((row) => row.$id) };
  assert(result.rows.length === 50, `${name} filter did not return a full page`);
}
const labelRows = await bob.tables.listRows({
  databaseId,
  tableId: tableIds.issueLabels,
  queries: [
    Query.equal("org_id", ["org-primary"]),
    Query.equal("label_id", ["label-01"]),
    Query.orderDesc("sequence"),
    Query.limit(50),
  ],
  total: true,
});
assert(labelRows.rows.length === 50 && labelRows.total === 50, "Label junction filter failed");
await receipt(
  "LINEAR-03-FILTERS",
  "pass",
  "not-applicable",
  {
    indexedResults: filterResults,
    label: {
      total: labelRows.total,
      issueIds: labelRows.rows.map((row) => row.issue_id),
      implementation: "indexed issue_labels junction table",
    },
    committedIndexes: [
      "org_status_sequence_idx",
      "org_assignee_sequence_idx",
      "org_project_sequence_idx",
      "org_label_sequence_idx",
    ],
  },
  "Status, assignee, project, and label filters executed through committed Appwrite TablesDB indexes.",
);

const page1 = await bob.tables.listRows({
  databaseId,
  tableId: tableIds.issues,
  queries: [
    Query.equal("org_id", ["org-primary"]),
    Query.orderDesc("sequence"),
    Query.limit(50),
  ],
  total: true,
});
const cursor = page1.rows.at(-1).$id;
await tables.createRow({
  databaseId,
  tableId: tableIds.issues,
  rowId: "issue-concurrent",
  data: {
    org_id: "org-primary",
    team_id: "team-1",
    project_id: "project-1",
    identifier: "LIN-501",
    title: "Concurrent pagination insert",
    description: "Inserted after page one",
    search_text: "Concurrent pagination insert",
    status: "todo",
    priority: 1,
    assignee_id: "alice",
    board_position: 501,
    sequence: 501,
    label_ids: ["label-01"],
    revision: 1,
  },
  permissions: primaryWrite,
});
const page2 = await bob.tables.listRows({
  databaseId,
  tableId: tableIds.issues,
  queries: [
    Query.equal("org_id", ["org-primary"]),
    Query.orderDesc("sequence"),
    Query.cursorAfter(cursor),
    Query.limit(50),
  ],
  total: false,
});
const overlap = page1.rows.filter((row) => page2.rows.some((other) => other.$id === row.$id));
assert(page1.rows.length === 50 && page2.rows.length === 50 && overlap.length === 0, "Cursor pagination unstable");
await tables.deleteRow({ databaseId, tableId: tableIds.issues, rowId: "issue-concurrent" });
await receipt(
  "LINEAR-04-PAGINATION",
  "pass",
  "not-applicable",
  {
    pageSize: 50,
    cursor,
    page1Ids: page1.rows.map((row) => row.$id),
    page2Ids: page2.rows.map((row) => row.$id),
    overlapCount: overlap.length,
    concurrentNewerInsertExcludedFromPage2: !page2.rows.some((row) => row.$id === "issue-concurrent"),
  },
  "A 50-row cursor boundary remained duplicate-free under a concurrent newer insert.",
);

const detailIssue = await bob.tables.getRow({
  databaseId,
  tableId: tableIds.issues,
  rowId: "issue-500",
});
const [detailProject, detailAssignee, detailLabels, detailComments, detailActivities] = await Promise.all([
  bob.tables.getRow({ databaseId, tableId: tableIds.projects, rowId: detailIssue.project_id }),
  bob.tables.getRow({ databaseId, tableId: tableIds.members, rowId: `member-${detailIssue.assignee_id}` }),
  Promise.all(detailIssue.label_ids.map((labelId) =>
    bob.tables.getRow({ databaseId, tableId: tableIds.labels, rowId: labelId }))),
  bob.tables.listRows({
    databaseId,
    tableId: tableIds.comments,
    queries: [Query.equal("issue_id", ["issue-500"]), Query.orderAsc("sequence"), Query.limit(50)],
    total: true,
  }),
  bob.tables.listRows({
    databaseId,
    tableId: tableIds.activities,
    queries: [Query.equal("issue_id", ["issue-500"]), Query.orderAsc("sequence"), Query.limit(50)],
    total: true,
  }),
]);
assert(
  detailProject.$id === detailIssue.project_id &&
  detailAssignee.user_id === detailIssue.assignee_id &&
  detailLabels.length === 2 &&
  detailComments.total === 2 &&
  detailActivities.total === 1,
  "Issue detail composition failed",
);
await receipt(
  "LINEAR-05-DETAIL",
  "pass",
  "not-applicable",
  {
    issueId: detailIssue.$id,
    projectId: detailProject.$id,
    assigneeId: detailAssignee.user_id,
    labelIds: detailLabels.map((row) => row.$id),
    commentIds: detailComments.rows.map((row) => row.$id),
    activityIds: detailActivities.rows.map((row) => row.$id),
    composition: "application-authored bounded TablesDB point reads and indexed queries",
  },
  "Issue detail composed project, assignee, labels, comments, and activity through bounded provider reads.",
);

const chromePath = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const browserRoot = path.resolve(".browser-runtime");
await mkdir(browserRoot, { recursive: true });
const context = await chromium.launchPersistentContext(path.resolve(browserRoot, "bob"), {
  executablePath: chromePath,
  headless: true,
});
const page = context.pages()[0] ?? await context.newPage();
let realtimeSockets = 0;
page.on("websocket", (socket) => {
  if (socket.url().includes("/v1/realtime")) realtimeSockets += 1;
});
await page.goto(`http://127.0.0.1:${vitePort}`);
await page.waitForTimeout(1_000);
const restoredSessionReady = await page.locator('.shell[data-ready="true"]').isVisible().catch(() => false);
if (!restoredSessionReady) {
  await page.getByLabel("Email").fill(runtime.personas.bob.email);
  await page.getByLabel("Password").fill(runtime.personas.bob.password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
}
await page.locator('.shell[data-ready="true"][data-issue-count="50"]').waitFor({ timeout: 30_000 });

const beforeOptimistic = await tables.getRow({
  databaseId,
  tableId: tableIds.issues,
  rowId: "issue-500",
});
const optimisticTitle = `Optimistic Appwrite edit ${Date.now()}`;
await page.route("**/v1/tablesdb/**", async (route) => {
  if (["PATCH", "PUT"].includes(route.request().method())) {
    await new Promise((resolve) => setTimeout(resolve, 700));
  }
  await route.continue();
});
await page.getByLabel("Issue title").fill(optimisticTitle);
await page.getByRole("button", { name: "Edit first issue" }).click();
await page.locator('.shell[data-pending="true"]').waitFor({ timeout: 5_000 });
const optimisticVisible = await page.locator('article[data-issue-id="issue-500"] strong').textContent();
const authorityDuringOptimism = await tables.getRow({
  databaseId,
  tableId: tableIds.issues,
  rowId: "issue-500",
});
await page.locator('.shell[data-pending="false"]').waitFor({ timeout: 30_000 });
await page.unroute("**/v1/tablesdb/**");
const settled = await tables.getRow({
  databaseId,
  tableId: tableIds.issues,
  rowId: "issue-500",
});
assert(
  optimisticVisible === optimisticTitle &&
  authorityDuringOptimism.title === beforeOptimistic.title &&
  settled.title === optimisticTitle,
  "Optimistic settlement proof failed",
);
await receipt(
  "LINEAR-06-OPTIMISTIC",
  "pass",
  "local-optimistic",
  {
    issueId: "issue-500",
    beforeTitle: beforeOptimistic.title,
    optimisticVisible,
    authorityDuringOptimism: authorityDuringOptimism.title,
    settledAuthority: settled.title,
    revisionBefore: beforeOptimistic.revision,
    revisionAfter: settled.revision,
    implementation: "application-authored React optimistic state over Appwrite TablesDB update",
  },
  "The UI exposed an optimistic title before Appwrite authority changed, then reconciled to independently inspected authority.",
);

const conflictBase = await tables.getRow({
  databaseId,
  tableId: tableIds.issues,
  rowId: "issue-500",
});
const [aliceTx, bobTx] = await Promise.all([
  alice.tables.createTransaction(),
  bob.tables.createTransaction(),
]);
const aliceTitle = `Alice transaction ${Date.now()}`;
const bobTitle = `Bob transaction ${Date.now()}`;
await Promise.all([
  alice.tables.updateRow({
    databaseId,
    tableId: tableIds.issues,
    rowId: "issue-500",
    data: { title: aliceTitle, search_text: aliceTitle, revision: conflictBase.revision + 1 },
    transactionId: aliceTx.$id,
  }),
  bob.tables.updateRow({
    databaseId,
    tableId: tableIds.issues,
    rowId: "issue-500",
    data: { title: bobTitle, search_text: bobTitle, revision: conflictBase.revision + 1 },
    transactionId: bobTx.$id,
  }),
]);
const commitResults = await Promise.allSettled([
  alice.tables.updateTransaction({ transactionId: aliceTx.$id, commit: true }),
  bob.tables.updateTransaction({ transactionId: bobTx.$id, commit: true }),
]);
const conflictAuthority = await tables.getRow({
  databaseId,
  tableId: tableIds.issues,
  rowId: "issue-500",
});
const committed = commitResults.filter((result) => result.status === "fulfilled").length;
const rejected = commitResults.filter((result) => result.status === "rejected").map((result) => ({
  code: result.reason.code,
  type: result.reason.type,
  message: result.reason.message,
}));
assert(
  committed === 1 &&
  rejected.length === 1 &&
  rejected[0].code === 409 &&
  [aliceTitle, bobTitle].includes(conflictAuthority.title),
  `Native conflict outcome unexpected: ${JSON.stringify({ commitResults, conflictAuthority })}`,
);
await tables.updateRow({
  databaseId,
  tableId: tableIds.issues,
  rowId: "issue-500",
  data: {
    title: beforeOptimistic.title,
    search_text: beforeOptimistic.search_text,
    revision: conflictAuthority.revision + 1,
  },
  permissions: primaryWrite,
});
await receipt(
  "LINEAR-07-CONFLICT",
  "pass",
  "not-applicable",
  {
    issueId: "issue-500",
    transactionIds: [hash(aliceTx.$id), hash(bobTx.$id)],
    committed,
    rejected,
    authoritativeWinnerTitle: conflictAuthority.title,
    authoritativeWinnerRevision: conflictAuthority.revision,
    restored: true,
  },
  "Two actor-scoped Appwrite transactions staged updates to one row; exactly one committed and the other received a native 409 conflict.",
);

await page.evaluate(async () => {
  const { Channel, databaseId, realtime } = await import("/src/appwrite.ts");
  window.__linearEvents = [];
  window.__linearSubscription = await realtime.subscribe([
    Channel.tablesdb(databaseId).table("comments").row(),
    Channel.tablesdb(databaseId).table("activities").row(),
  ], (event) => {
    window.__linearEvents.push({
      channels: event.channels,
      events: event.events,
      payloadId: event.payload?.$id,
    });
  });
});
const liveMarker = Date.now();
const liveCommentId = `live-comment-${liveMarker}`;
const liveActivityId = `live-activity-${liveMarker}`;
const liveTx = await alice.tables.createTransaction();
await Promise.all([
  alice.tables.createRow({
    databaseId,
    tableId: tableIds.comments,
    rowId: liveCommentId,
    data: {
      org_id: "org-primary",
      issue_id: "issue-500",
      author_id: "alice",
      body: `Live comment ${liveMarker}`,
      sequence: 1001,
    },
    permissions: primaryRead,
    transactionId: liveTx.$id,
  }),
  alice.tables.createRow({
    databaseId,
    tableId: tableIds.activities,
    rowId: liveActivityId,
    data: {
      org_id: "org-primary",
      issue_id: "issue-500",
      actor_id: "alice",
      kind: "comment.created",
      description: `Comment ${liveCommentId} created`,
      sequence: 501,
    },
    permissions: primaryRead,
    transactionId: liveTx.$id,
  }),
]);
const liveStart = performance.now();
await alice.tables.updateTransaction({ transactionId: liveTx.$id, commit: true });
await page.waitForFunction(
  ([commentId, activityId]) =>
    (window.__linearEvents ?? []).some((event) => event.payloadId === commentId) &&
    (window.__linearEvents ?? []).some((event) => event.payloadId === activityId),
  [liveCommentId, liveActivityId],
  { timeout: 30_000 },
);
const liveLatencyMs = Number((performance.now() - liveStart).toFixed(3));
const liveEvents = await page.evaluate(() => window.__linearEvents);
const [liveComment, liveActivity] = await Promise.all([
  tables.getRow({ databaseId, tableId: tableIds.comments, rowId: liveCommentId }),
  tables.getRow({ databaseId, tableId: tableIds.activities, rowId: liveActivityId }),
]);
assert(
  liveComment.body === `Live comment ${liveMarker}` &&
  liveActivity.kind === "comment.created" &&
  realtimeSockets > 0,
  "Realtime authority failed",
);
milestone.firstRealtimeTransitionMs = elapsed();
await receipt(
  "LINEAR-08-LIVE",
  "pass",
  "push",
  {
    secondClient: "Bob persistent browser",
    actor: "Alice native session",
    realtimeWebSockets: realtimeSockets,
    productPolling: false,
    latencyMs: liveLatencyMs,
    commentId: liveCommentId,
    activityId: liveActivityId,
    receivedEvents: liveEvents.filter((event) =>
      [liveCommentId, liveActivityId].includes(event.payloadId)),
    authority: { commentBody: liveComment.body, activityKind: liveActivity.kind },
  },
  "Bob received both committed rows through Appwrite Realtime WebSocket push, with independent Admin authority and no product polling.",
);

const search = await bob.tables.listRows({
  databaseId,
  tableId: tableIds.issues,
  queries: [Query.search("search_text", "deterministic search fixture"), Query.limit(50)],
  total: true,
});
assert(search.total >= 499 && search.rows.length === 50, `Full-text search failed: ${search.total}`);
await receipt(
  "LINEAR-09-SEARCH",
  "pass",
  "not-applicable",
  {
    query: "deterministic search fixture",
    resultTotal: search.total,
    returnedIds: search.rows.map((row) => row.$id),
    index: "search_text_idx/fulltext",
    nativePath: "TablesDB fulltext index plus Query.search",
  },
  "Appwrite's ordinary TablesDB full-text index returned authoritative backend search results.",
);

const beforeOfflineIds = await page.locator("article").evaluateAll((nodes) =>
  nodes.map((node) => node.getAttribute("data-issue-id")));
await context.setOffline(true);
await page.reload({ waitUntil: "domcontentloaded" }).catch(() => {});
await page.waitForTimeout(1_000);
const coldOfflineCount = await page.locator("article").count();
let offlineWriteRejected = false;
try {
  await page.evaluate(async () => {
    const { databaseId, tables } = await import("/src/appwrite.ts");
    await tables.updateRow({
      databaseId,
      tableId: "issues",
      rowId: "issue-500",
      data: { title: "This write must not queue" },
    });
  });
} catch {
  offlineWriteRejected = true;
}
await context.setOffline(false);
await page.reload();
await page.locator('.shell[data-ready="true"][data-issue-count="50"]').waitFor({ timeout: 30_000 });
const afterReconnectIds = await page.locator("article").evaluateAll((nodes) =>
  nodes.map((node) => node.getAttribute("data-issue-id")));
assert(
  beforeOfflineIds.length === 50 &&
  coldOfflineCount === 0 &&
  offlineWriteRejected &&
  afterReconnectIds.length === 50 &&
  new Set(afterReconnectIds).size === 50,
  "Offline GAP evidence or reconnect proof failed",
);
await receipt(
  "LINEAR-10-OFFLINE",
  "gap",
  "unsupported",
  {
    warmLoadedRows: beforeOfflineIds.length,
    coldOfflineReloadRows: coldOfflineCount,
    offlineWriteRejected,
    providerCacheDatabaseObserved: false,
    queuedMutationObserved: false,
    reconnectRows: afterReconnectIds.length,
    reconnectUniqueRows: new Set(afterReconnectIds).size,
  },
  "GAP: the Appwrite Web SDK retained the Auth session but supplied neither a TablesDB offline cache nor a mutation queue; reconnect refetched 50 authoritative rows.",
);

const beforeMigration = Object.fromEntries(await Promise.all(
  Object.entries(tableIds).map(async ([name, tableId]) => [name, await count(tableId)]),
));
await tables.createStringColumn({
  databaseId,
  tableId: tableIds.issues,
  key: "customer_impact",
  size: 16,
  required: false,
  xdefault: "low",
});
async function waitForColumn(key) {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    const column = await tables.getColumn({ databaseId, tableId: tableIds.issues, key });
    if (column.status === "available") return column;
    if (column.status === "failed") throw new Error(`Column ${key} failed`);
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Column ${key} did not become available`);
}
await waitForColumn("customer_impact");
await tables.updateRows({
  databaseId,
  tableId: tableIds.issues,
  data: { customer_impact: "low" },
  queries: [Query.equal("org_id", ["org-primary"])],
});
await tables.createIndex({
  databaseId,
  tableId: tableIds.issues,
  key: "org_impact_sequence_idx",
  type: "key",
  columns: ["org_id", "customer_impact", "sequence"],
  orders: ["ASC", "ASC", "DESC"],
});
async function waitForIndex(key) {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    const index = await tables.getIndex({ databaseId, tableId: tableIds.issues, key });
    if (index.status === "available") return index;
    if (index.status === "failed") throw new Error(`Index ${key} failed`);
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Index ${key} did not become available`);
}
const migrationIndex = await waitForIndex("org_impact_sequence_idx");
const migrated = await bob.tables.listRows({
  databaseId,
  tableId: tableIds.issues,
  queries: [
    Query.equal("org_id", ["org-primary"]),
    Query.equal("customer_impact", ["low"]),
    Query.orderDesc("sequence"),
    Query.limit(50),
  ],
  total: true,
});
const afterMigration = Object.fromEntries(await Promise.all(
  Object.entries(tableIds).map(async ([name, tableId]) => [name, await count(tableId)]),
));
assert(
  migrated.total === 500 &&
  JSON.stringify(beforeMigration) === JSON.stringify(afterMigration),
  "Migration lost rows or failed backfill",
);
await receipt(
  "LINEAR-11-MIGRATION",
  "pass",
  "not-applicable",
  {
    beforeCounts: beforeMigration,
    afterCounts: afterMigration,
    backfilledRows: migrated.total,
    queryPageSize: migrated.rows.length,
    index: {
      key: migrationIndex.key,
      type: migrationIndex.type,
      columns: migrationIndex.attributes ?? migrationIndex.columns,
      orders: migrationIndex.orders,
      status: migrationIndex.status,
    },
    schemaTransactionSupport: false,
  },
  "The new indexed field became available, all 500 issue rows were queryable through it, and production-shaped counts were preserved.",
);

const composeOutput = (await import("node:child_process")).execFileSync(
  "docker",
  [
    "ps",
    "--filter", "label=com.docker.compose.project=llp0102-linear-appwrite-w2",
    "--format", "{{json .}}",
  ],
  { encoding: "utf8" },
);
const composeContainers = composeOutput.trim().split("\n").filter(Boolean).map((line) =>
  JSON.parse(line));
await receipt(
  "LINEAR-12-DEPLOY",
  "unavailable-remote-dependency",
  "not-applicable",
  {
    local: {
      status: "pass",
      productVersion: "1.9.6",
      endpoint: "redacted-to-hash",
      projectIdHash: hash(projectId),
      composeProject: "llp0102-linear-appwrite-w2",
      runningContainers: composeContainers.length,
      database: "MongoDB 8.2.5",
      deploymentPath: "official Appwrite web installer and Docker Compose",
    },
    hosted: {
      status: "credential-unavailable",
      targetMutated: false,
      url: null,
    },
    officialDocs: [
      "https://appwrite.io/docs/advanced/self-hosting/installation",
      "https://appwrite.io/docs/products/databases/transactions",
      "https://appwrite.io/docs/products/databases/queries",
      "https://appwrite.io/docs/apis/realtime/subscribe",
    ],
  },
  "Hosted Appwrite Cloud credentials were unavailable; the official isolated local deployment is directly evidenced, and no hosted product claim is made.",
);

await context.close();
milestone.localAcceptanceMs = elapsed();
milestone.acceptanceCompletionMs = milestone.localAcceptanceMs;
await receipt(
  "LINEAR-13-PERFORMANCE",
  "pending",
  "not-applicable",
  { planned: "two warmups plus seven recorded samples for read, detail, write, realtime, reconnect, and build" },
  "Pending the frozen performance pass.",
);
await receipt(
  "LINEAR-14-CLEANUP",
  "pending",
  "not-applicable",
  { planned: "target-bound Compose, installer, UI, CLI, browser, port, volume, and network cleanup" },
  "Pending evidence export and cleanup.",
);
const aggregate = {
  schemaVersion: 1,
  startedAt,
  finishedAt: new Date().toISOString(),
  projectId,
  milestones: milestone,
  scenarios,
  pendingExternalChecks: ["LINEAR-13-PERFORMANCE", "LINEAR-14-CLEANUP"],
  assistanceEvents: [
    {
      kind: "cross-arm-reference",
      source: "Todo and Chat Appwrite calibration arms",
      reason: "Parent required prior-arm inspection; official installer, Auth/Teams, TablesDB, Realtime, and cleanup patterns informed this arm.",
    },
    {
      kind: "official-documentation-refresh",
      sources: [
        "Appwrite installation",
        "TablesDB queries and permissions",
        "Transactions",
        "Realtime subscriptions",
      ],
    },
  ],
};
await writeFile(
  path.resolve(receiptsRoot, "acceptance-results.v1.json"),
  `${JSON.stringify(aggregate, null, 2)}\n`,
);
console.log(JSON.stringify({
  ok: true,
  milestones: milestone,
  statuses: Object.values(scenarios).map(({ id, status }) => ({ id, status })),
}, null, 2));
