import { execFileSync } from "node:child_process";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";
import { localConfig } from "./local-config.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const work = path.resolve(here, "..");
const arm = path.resolve(work, "..");
const receipts = path.join(arm, "receipts");
const runState = JSON.parse(await readFile(path.join(work, "run-state.json"), "utf8"));
const config = localConfig();
const passphrase = `${randomBytes(24).toString("base64url")}aA1!`;
const receiptName = process.env.LINEAR_ACCEPTANCE_RECEIPT ?? "acceptance.json";

await mkdir(receipts, { recursive: true });

const seedOutput = execFileSync(process.execPath, [path.join(here, "seed.mjs")], {
  cwd: work,
  env: { ...process.env, LINEAR_TEST_PASSPHRASE: passphrase },
  encoding: "utf8",
  stdio: ["ignore", "pipe", "pipe"]
});
const seed = JSON.parse(seedOutput);
const admin = createClient(config.apiUrl, config.serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
});
const actors = {
  alice: await actorClient("alice"),
  bob: await actorClient("bob"),
  mallory: await actorClient("mallory"),
  bobSecond: await actorClient("bob")
};
const primaryOrganization = seed.primaryOrganization;
const actorHashes = Object.fromEntries(
  Object.entries(actors)
    .filter(([name]) => name !== "bobSecond")
    .map(([name, actor]) => [name, sha256(actor.userId)])
);
const results = {};
const observations = {};
let firstReadMs = null;
let firstMutationMs = null;
let firstRealtimeMs = null;
let performance = null;

await scenario("LINEAR-01-SEED", async () => {
  const expected = {
    organizations: 2,
    teams: 3,
    projects: 4,
    labels: 20,
    issues: 500,
    issue_labels: 1000,
    comments: 1000,
    activities: 1000
  };
  const counts = {};
  for (const table of Object.keys(expected)) {
    const result = await admin.from(table).select("*", { count: "exact", head: true });
    must(!result.error, result.error?.message);
    counts[table] = result.count;
    must(result.count === expected[table], `${table}: expected ${expected[table]}, got ${result.count}`);
  }
  const memberships = await admin
    .from("organization_members")
    .select("organization_id,user_id,role")
    .eq("organization_id", primaryOrganization);
  must(!memberships.error && memberships.data.length === 2, memberships.error?.message ?? "primary memberships missing");
  const personaRoles = Object.fromEntries(memberships.data.map((row) => [sha256(row.user_id), row.role]));
  must(personaRoles[actorHashes.alice] === "owner", "Alice owner role missing");
  must(personaRoles[actorHashes.bob] === "member", "Bob member role missing");
  must(!personaRoles[actorHashes.mallory], "Mallory unexpectedly belongs to primary organization");
  firstReadMs ??= elapsed();
  return {
    namespace: runState.namespace,
    targetIdentityHash: targetIdentity().identityHash,
    authoritativeCounts: counts,
    seedReceipt: { exactWorkload: true, deterministicIds: true },
    personas: {
      alice: { idHash: actorHashes.alice, role: "owner" },
      bob: { idHash: actorHashes.bob, role: "member" },
      mallory: { idHash: actorHashes.mallory, role: "outsider" }
    }
  };
});

await scenario("LINEAR-02-AUTHORITY", async () => {
  const [aliceRead, bobRead, malloryRead] = await Promise.all([
    actors.alice.client.from("issues").select("id").eq("organization_id", primaryOrganization).limit(50),
    actors.bob.client.from("issues").select("id").eq("organization_id", primaryOrganization).limit(50),
    actors.mallory.client.from("issues").select("id").eq("organization_id", primaryOrganization).limit(50)
  ]);
  must(!aliceRead.error && aliceRead.data.length === 50, aliceRead.error?.message ?? "Alice read failed");
  must(!bobRead.error && bobRead.data.length === 50, bobRead.error?.message ?? "Bob read failed");
  must(!malloryRead.error && malloryRead.data.length === 0, malloryRead.error?.message ?? "Mallory leaked rows");

  const issue = await authoritativeIssue(1);
  const bobWrite = await updateIssue(actors.bob.client, issue, {
    status: "in_progress",
    priority: 3,
    assigneeId: actors.bob.userId,
    boardPosition: 1001,
    action: "authority.bob-positive"
  });
  must(!bobWrite.error, bobWrite.error?.message);
  firstMutationMs ??= elapsed();
  const afterBob = await authoritativeIssue(1);
  must(afterBob.status === "in_progress" && afterBob.assignee_id === actors.bob.userId, "Bob write did not settle");

  const aliceWrite = await updateIssue(actors.alice.client, afterBob, {
    status: "review",
    priority: 4,
    assigneeId: actors.alice.userId,
    boardPosition: 1002,
    action: "authority.alice-owner-positive"
  });
  must(!aliceWrite.error, aliceWrite.error?.message);
  const afterAlice = await authoritativeIssue(1);
  must(afterAlice.status === "review" && afterAlice.assignee_id === actors.alice.userId, "Alice owner write did not settle");

  const denied = await updateIssue(actors.mallory.client, afterAlice, {
    status: "done",
    priority: 0,
    assigneeId: actors.mallory.userId,
    boardPosition: 1,
    action: "authority.mallory-negative"
  });
  must(Boolean(denied.error), "Mallory write unexpectedly succeeded");
  const afterDenied = await authoritativeIssue(1);
  must(afterDenied.revision === afterAlice.revision, "Mallory changed authoritative revision");
  return {
    positiveTransitions: {
      bob: { revision: afterBob.revision, role: "team member" },
      alice: { revision: afterAlice.revision, role: "organization owner" }
    },
    negativeRead: { malloryRows: malloryRead.data.length },
    negativeWrite: {
      rejected: true,
      errorCode: denied.error.code,
      authoritativeRevisionUnchanged: afterDenied.revision
    }
  };
});

await scenario("LINEAR-03-FILTERS", async () => {
  const projects = await admin.from("projects").select("id").eq("organization_id", primaryOrganization).order("id").limit(1);
  const labels = await admin.from("labels").select("id").eq("organization_id", primaryOrganization).order("id").limit(1);
  must(!projects.error && projects.data[0] && !labels.error && labels.data[0], "filter fixtures missing");

  const filters = {};
  for (const [name, column, value] of [
    ["status", "status", "in_progress"],
    ["assignee", "assignee_id", actors.bob.userId],
    ["project", "project_id", projects.data[0].id]
  ]) {
    const [actual, repeated, authoritative] = await Promise.all([
      actors.bob.client.from("issues").select("id,issue_number").eq("organization_id", primaryOrganization)
        .eq(column, value).order("issue_number").order("id").limit(1000),
      actors.bob.client.from("issues").select("id,issue_number").eq("organization_id", primaryOrganization)
        .eq(column, value).order("issue_number").order("id").limit(1000),
      admin.from("issues").select("id,issue_number").eq("organization_id", primaryOrganization)
        .eq(column, value).order("issue_number").order("id").limit(1000)
    ]);
    must(!actual.error && !repeated.error && !authoritative.error, actual.error?.message ?? repeated.error?.message ?? authoritative.error?.message);
    const ids = actual.data.map(({ id }) => id);
    must(equal(ids, repeated.data.map(({ id }) => id)), `${name} filter was nondeterministic`);
    must(equal(ids, authoritative.data.map(({ id }) => id)), `${name} expected set mismatch`);
    filters[name] = { count: ids.length, firstIdHash: sha256(ids[0]), deterministicRepeat: true };
  }

  const [labelRows, labelRepeat, labelAuthority] = await Promise.all([
    actors.bob.client.from("issue_labels").select("issue_id").eq("label_id", labels.data[0].id).order("issue_id"),
    actors.bob.client.from("issue_labels").select("issue_id").eq("label_id", labels.data[0].id).order("issue_id"),
    admin.from("issue_labels").select("issue_id").eq("label_id", labels.data[0].id).order("issue_id")
  ]);
  must(!labelRows.error && !labelRepeat.error && !labelAuthority.error, labelRows.error?.message ?? "label filter failed");
  const labelIds = labelRows.data.map(({ issue_id }) => issue_id);
  must(equal(labelIds, labelRepeat.data.map(({ issue_id }) => issue_id)), "label filter was nondeterministic");
  must(equal(labelIds, labelAuthority.data.map(({ issue_id }) => issue_id)), "label expected set mismatch");
  filters.label = { count: labelIds.length, firstIdHash: sha256(labelIds[0]), deterministicRepeat: true };

  const indexDefinitions = sqlLines(
    "select indexname || ':' || indexdef from pg_indexes " +
    "where schemaname = 'public' and tablename in ('issues','issue_labels') order by indexname"
  );
  for (const name of [
    "issues_organization_status_order_idx",
    "issues_organization_assignee_order_idx",
    "issues_organization_project_order_idx",
    "issue_labels_label_issue_idx"
  ]) {
    must(indexDefinitions.some((definition) => definition.startsWith(`${name}:`)), `missing index ${name}`);
  }
  return {
    filters,
    queryPlanOrIndexProof: indexDefinitions,
    serverSide: "PostgREST equality predicates and ordered SQL results; no client-side filtering"
  };
});

await scenario("LINEAR-04-PAGINATION", async () => {
  const baseline = await admin.from("issues").select("id,created_at")
    .eq("organization_id", primaryOrganization)
    .order("created_at", { ascending: false }).order("id", { ascending: false }).limit(100);
  must(!baseline.error && baseline.data.length === 100, baseline.error?.message ?? "pagination baseline failed");
  const first = await issuePage(actors.bob.client, null, null);
  must(!first.error && first.data.length === 50, first.error?.message ?? "first page failed");
  const cursor = first.data.at(-1);

  const concurrentId = randomUUID();
  const project = await admin.from("projects").select("id,team_id").eq("organization_id", primaryOrganization).limit(1).single();
  must(!project.error, project.error?.message);
  const concurrentCreatedAt = "2027-01-01T00:00:00.000Z";
  const inserted = await admin.from("issues").insert({
    id: concurrentId,
    organization_id: primaryOrganization,
    team_id: project.data.team_id,
    project_id: project.data.id,
    assignee_id: actors.alice.userId,
    issue_number: 501,
    title: "Concurrent pagination insert",
    description: "Inserted between cursor page requests.",
    status: "todo",
    priority: 2,
    board_position: 501000,
    created_at: concurrentCreatedAt,
    updated_at: concurrentCreatedAt
  });
  must(!inserted.error, inserted.error?.message);
  const second = await issuePage(actors.bob.client, cursor.created_at, cursor.id);
  must(!second.error && second.data.length === 50, second.error?.message ?? "second page failed");
  const union = [...first.data, ...second.data].map(({ id }) => id);
  must(new Set(union).size === 100, "cursor pages duplicated an issue");
  must(!union.includes(concurrentId), "concurrent newer insert destabilized cursor");
  must(equal(union, baseline.data.map(({ id }) => id)), "page union differed from authoritative pre-insert ordering");
  const removed = await admin.from("issues").delete().eq("id", concurrentId);
  must(!removed.error, removed.error?.message);
  return {
    cursorValues: { createdAt: cursor.created_at, idHash: sha256(cursor.id) },
    pageUnion: { count: union.length, unique: new Set(union).size, concurrentInsertExcluded: true },
    authoritativeOrder: "created_at DESC, id DESC tuple cursor matched the authoritative pre-insert top 100",
    harnessCleanup: "concurrent issue 501 removed after proof"
  };
});

await scenario("LINEAR-05-DETAIL", async () => {
  const issue = await authoritativeIssue(10);
  const [project, assignee, labelLinks, comments, activities] = await Promise.all([
    actors.bob.client.from("projects").select("id,name").eq("id", issue.project_id).single(),
    actors.bob.client.from("profiles").select("user_id,display_name").eq("user_id", issue.assignee_id).maybeSingle(),
    actors.bob.client.from("issue_labels").select("label_id,labels(id,name)").eq("issue_id", issue.id).order("label_id").limit(10),
    actors.bob.client.from("comments").select("id,author_id,body,sequence").eq("issue_id", issue.id).order("sequence").limit(10),
    actors.bob.client.from("activities").select("id,actor_id,kind,sequence").eq("issue_id", issue.id).order("sequence").limit(20)
  ]);
  for (const result of [project, assignee, labelLinks, comments, activities]) must(!result.error, result.error?.message);
  must(project.data.id === issue.project_id, "detail project mismatch");
  must(!issue.assignee_id || assignee.data?.user_id === issue.assignee_id, "detail assignee mismatch");
  must(labelLinks.data.length === 2, `expected two labels, got ${labelLinks.data.length}`);
  must(comments.data.length === 2, `expected two comments, got ${comments.data.length}`);
  must(activities.data.length === 2, `expected two seed activities, got ${activities.data.length}`);

  const authority = await Promise.all([
    admin.from("projects").select("id").eq("id", issue.project_id).single(),
    admin.from("issue_labels").select("label_id").eq("issue_id", issue.id).order("label_id"),
    admin.from("comments").select("id").eq("issue_id", issue.id).order("sequence"),
    admin.from("activities").select("id").eq("issue_id", issue.id).order("sequence")
  ]);
  for (const result of authority) must(!result.error, result.error?.message);
  must(equal(labelLinks.data.map(({ label_id }) => label_id), authority[1].data.map(({ label_id }) => label_id)), "detail labels differ from authority");
  must(equal(comments.data.map(({ id }) => id), authority[2].data.map(({ id }) => id)), "detail comments differ from authority");
  must(equal(activities.data.map(({ id }) => id), authority[3].data.map(({ id }) => id)), "detail activities differ from authority");
  return {
    authoritativeRelatedIds: {
      issueIdHash: sha256(issue.id),
      projectIdHash: sha256(project.data.id),
      assigneeIdHash: issue.assignee_id ? sha256(issue.assignee_id) : null,
      labelIdHashes: labelLinks.data.map(({ label_id }) => sha256(label_id)),
      commentIdHashes: comments.data.map(({ id }) => sha256(id)),
      activityIdHashes: activities.data.map(({ id }) => sha256(id))
    },
    boundedQueryInventory: [
      "issues equality / single",
      "projects equality / single",
      "profiles equality / maybeSingle",
      "issue_labels with labels relation / limit 10",
      "comments ordered sequence / limit 10",
      "activities ordered sequence / limit 20"
    ]
  };
});

await scenario("LINEAR-06-OPTIMISTIC", async () => {
  const issue = await authoritativeIssue(20);
  const optimistic = {
    status: "review",
    priority: 4,
    assigneeId: actors.bob.userId,
    boardPosition: 2020
  };
  const response = await updateIssue(actors.alice.client, issue, {
    ...optimistic,
    action: "issue.optimistic-update"
  });
  must(!response.error, response.error?.message);
  const settlement = response.data;
  const authoritative = await authoritativeIssue(20);
  must(authoritative.status === optimistic.status, "status did not settle");
  must(authoritative.priority === optimistic.priority, "priority did not settle");
  must(authoritative.assignee_id === optimistic.assigneeId, "assignee did not settle");
  must(Number(authoritative.board_position) === optimistic.boardPosition, "board position did not settle");
  must(authoritative.revision === settlement.revision, "settlement revision differed from authority");
  return {
    optimisticStateAttribution: {
      origin: "React/application-local projection before network response",
      value: optimistic,
      providerOwned: false
    },
    settlement: {
      origin: "linear_update_issue PostgreSQL RPC response",
      revision: settlement.revision,
      activitySequence: settlement.activitySequence
    },
    authoritativeState: {
      origin: "independent service-role read",
      status: authoritative.status,
      priority: authoritative.priority,
      assigneeIdHash: sha256(authoritative.assignee_id),
      boardPosition: Number(authoritative.board_position),
      revision: authoritative.revision
    }
  };
});

await scenario("LINEAR-07-CONFLICT", async () => {
  const issue = await authoritativeIssue(30);
  const alicePosition = 30001;
  const bobPosition = 30002;
  const [aliceMove, bobMove] = await Promise.all([
    updateIssue(actors.alice.client, issue, {
      status: issue.status,
      priority: issue.priority,
      assigneeId: issue.assignee_id,
      boardPosition: alicePosition,
      action: "board.move.alice"
    }),
    updateIssue(actors.bob.client, issue, {
      status: issue.status,
      priority: issue.priority,
      assigneeId: issue.assignee_id,
      boardPosition: bobPosition,
      action: "board.move.bob"
    })
  ]);
  must(!aliceMove.error && !bobMove.error, aliceMove.error?.message ?? bobMove.error?.message);
  const authoritative = await authoritativeIssue(30);
  must(authoritative.revision === issue.revision + 2, `expected revision ${issue.revision + 2}, got ${authoritative.revision}`);
  const receiptsBySequence = [aliceMove.data, bobMove.data].sort((left, right) => left.activitySequence - right.activitySequence);
  const winner = receiptsBySequence.at(-1);
  must(Number(authoritative.board_position) === Number(winner.boardPosition), "highest activity sequence did not identify last commit");
  const [aliceFresh, bobFresh] = await Promise.all([
    actors.alice.client.from("issues").select("board_position,revision").eq("id", issue.id).single(),
    actors.bob.client.from("issues").select("board_position,revision").eq("id", issue.id).single()
  ]);
  must(!aliceFresh.error && !bobFresh.error, aliceFresh.error?.message ?? bobFresh.error?.message);
  must(Number(aliceFresh.data.board_position) === Number(authoritative.board_position), "Alice did not reconcile");
  must(Number(bobFresh.data.board_position) === Number(authoritative.board_position), "Bob did not reconcile");
  return {
    twoActorBarrier: "Promise.all launched Alice and Bob RPCs in the same event-loop turn",
    actorReceipts: {
      alice: { activitySequence: aliceMove.data.activitySequence, revision: aliceMove.data.revision, boardPosition: Number(aliceMove.data.boardPosition) },
      bob: { activitySequence: bobMove.data.activitySequence, revision: bobMove.data.revision, boardPosition: Number(bobMove.data.boardPosition) }
    },
    deterministicRule: "PostgreSQL row lock serializes writes; highest committed activity identity is last-writer-wins",
    authoritativeOutcome: { revision: authoritative.revision, boardPosition: Number(authoritative.board_position) },
    clientReconciliation: { alice: true, bob: true }
  };
});

await scenario("LINEAR-08-LIVE", async () => {
  const issue = await authoritativeIssue(40);
  const commentEvents = [];
  const activityEvents = [];
  const commentsChannel = await subscribePostgres(
    actors.bobSecond.client,
    "comments",
    `issue_id=eq.${issue.id}`,
    commentEvents
  );
  const activitiesChannel = await subscribePostgres(
    actors.bobSecond.client,
    "activities",
    `issue_id=eq.${issue.id}`,
    activityEvents
  );
  const deliveryAttempts = [];
  let inserted;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const body = `native-live-${attempt}-${randomUUID()}`;
    inserted = await actors.alice.client
      .from("comments")
      .insert({ issue_id: issue.id, body })
      .select("id,issue_id,author_id,body,sequence")
      .single();
    must(!inserted.error, inserted.error?.message);
    const commentReceived = await waitFor(
      () => commentEvents.some((row) => row.id === inserted.data.id),
      10_000
    );
    const activityReceived = commentReceived && await waitFor(
      () => activityEvents.some((row) => row.detail?.commentId === inserted.data.id),
      10_000
    );
    deliveryAttempts.push({
      attempt,
      commentIdHash: sha256(inserted.data.id),
      commentReceived,
      activityReceived
    });
    if (commentReceived && activityReceived) break;
  }
  must(deliveryAttempts.at(-1).commentReceived, "comment realtime remained unavailable after cold-start retries");
  must(deliveryAttempts.at(-1).activityReceived, "activity realtime remained unavailable after cold-start retries");
  firstRealtimeMs ??= elapsed();
  const [commentAuthority, activityAuthority] = await Promise.all([
    admin.from("comments").select("id,author_id,body,sequence").eq("id", inserted.data.id).single(),
    admin.from("activities").select("id,actor_id,kind,detail,sequence")
      .contains("detail", { commentId: inserted.data.id }).single()
  ]);
  must(!commentAuthority.error && !activityAuthority.error, commentAuthority.error?.message ?? activityAuthority.error?.message);
  must(commentAuthority.data.author_id === actors.alice.userId, "live comment authority author mismatch");
  must(activityAuthority.data.kind === "comment.created", "live activity kind mismatch");
  await Promise.all([
    actors.bobSecond.client.removeChannel(commentsChannel),
    actors.bobSecond.client.removeChannel(activitiesChannel)
  ]);
  return {
    secondClient: "independent Bob supabase-js client and WebSocket channels",
    transportAttribution: "Supabase Realtime Postgres Changes over WebSocket; no product polling",
    received: { comments: 1, activities: 1 },
    coldStartDeliveryAttempts: deliveryAttempts,
    authority: {
      commentIdHash: sha256(commentAuthority.data.id),
      activityIdHash: sha256(activityAuthority.data.id),
      authorIdHash: sha256(commentAuthority.data.author_id),
      activitySequence: activityAuthority.data.sequence
    }
  };
});

await scenario("LINEAR-09-SEARCH", async () => {
  const searched = await actors.bob.client.rpc("linear_search_issues", {
    requested_organization: primaryOrganization,
    search_query: "realtime cursor",
    requested_limit: 50
  });
  must(!searched.error, searched.error?.message);
  must(searched.data.length === 50, `expected 50 full-text matches, got ${searched.data.length}`);
  must(searched.data.every((issue) => issue.issue_number % 10 === 0), "search returned a nonmatching issue");
  const authority = sqlLines(
    `select issue_number from public.issues where organization_id = '${primaryOrganization}' ` +
    "and search_document @@ websearch_to_tsquery('english', 'realtime cursor') order by " +
    "ts_rank(search_document, websearch_to_tsquery('english', 'realtime cursor')) desc, issue_number, id limit 50"
  ).map(Number);
  must(equal(searched.data.map(({ issue_number }) => issue_number), authority), "search result differed from SQL authority");
  const indexIdentity = sqlLines(
    "select indexname || ':' || indexdef from pg_indexes where schemaname = 'public' " +
    "and tablename = 'issues' and indexname = 'issues_search_document_idx'"
  );
  must(indexIdentity.length === 1 && indexIdentity[0].includes("USING gin"), "GIN search index missing");
  return {
    indexOrServiceIdentity: indexIdentity[0],
    queryPath: "PostgreSQL websearch_to_tsquery + generated weighted tsvector through PostgREST RPC",
    authoritativeResults: authority,
    clientSideFiltering: false
  };
});

results["LINEAR-10-OFFLINE"] = await offlineGap();
observations["LINEAR-10-OFFLINE"] = results["LINEAR-10-OFFLINE"].evidence;

await scenario("LINEAR-11-MIGRATION", async () => {
  const beforeCounts = await workloadCounts();
  must(beforeCounts.issues === 500 && beforeCounts.comments >= 1001, "pre-migration seeded data unexpectedly changed");
  const beforeColumn = sqlLines(
    "select column_name from information_schema.columns where table_schema='public' " +
    "and table_name='issues' and column_name='estimate_points'"
  );
  must(beforeColumn.length === 0, "estimate_points already existed before evolution");
  const migrationPath = path.join(work, "supabase", "evolution", "20260729042000_add_estimate_points.sql");
  const migrationSource = await readFile(migrationPath, "utf8");
  const commandOutput = execFileSync(process.execPath, [path.join(here, "apply-evolution.mjs")], {
    cwd: work,
    env: process.env,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  });
  const afterCounts = await workloadCounts();
  must(equal(Object.values(beforeCounts), Object.values(afterCounts)), "migration changed workload counts");
  const indexProof = sqlLines(
    "select indexname || ':' || indexdef from pg_indexes where schemaname='public' " +
    "and tablename='issues' and indexname='issues_organization_estimate_idx'"
  );
  must(indexProof.length === 1, "evolution index missing");
  const columnProof = sqlLines(
    "select column_name || ':' || data_type || ':' || is_nullable from information_schema.columns " +
    "where table_schema='public' and table_name='issues' and column_name='estimate_points'"
  );
  must(columnProof[0] === "estimate_points:integer:NO", `unexpected column proof ${columnProof[0]}`);
  const postgrest = await retry(async () =>
    await actors.bob.client.from("issues").select("id,estimate_points").eq("organization_id", primaryOrganization).limit(1)
  );
  must(!postgrest.error && postgrest.data[0].estimate_points === 0, postgrest.error?.message ?? "PostgREST schema cache did not reload");
  const receipt = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    beforeCounts,
    afterCounts,
    migration: {
      path: "work/supabase/evolution/20260729042000_add_estimate_points.sql",
      sha256: sha256(migrationSource),
      command: JSON.parse(commandOutput)
    },
    columnProof,
    indexProof
  };
  await receiptFile("migration.json", receipt);
  return {
    beforeCounts,
    migrationReceipt: "receipts/migration.json",
    afterCounts,
    indexProof
  };
});

results["LINEAR-12-DEPLOY"] = await localDeploymentGap();
observations["LINEAR-12-DEPLOY"] = results["LINEAR-12-DEPLOY"].evidence;

await scenario("LINEAR-13-PERFORMANCE", async () => {
  performance = await measurePerformance();
  return performance;
});

results["LINEAR-14-CLEANUP"] = {
  status: "pending",
  note: "Acceptance frozen before exact project-bound cleanup.",
  evidence: {
    targetBoundPlan: "../cleanup-plan.json",
    projectId: runState.projectId
  }
};

const identity = targetIdentity();
const scenarioReceipt = {
  schemaVersion: 1,
  expectedCheckCount: 14,
  provider: "supabase",
  app: "linear",
  generatedAt: new Date().toISOString(),
  targetIdentityHash: identity.identityHash,
  results,
  observations,
  milestones: {
    firstLocalReadMs: firstReadMs,
    firstAuthoritativeMutationMs: firstMutationMs,
    firstRealtimeTransitionMs: firstRealtimeMs,
    localAcceptanceMs: elapsed()
  }
};

await Promise.all([
  receiptFile(receiptName, scenarioReceipt),
  receiptFile("target-identity.json", identity),
  receiptFile("seed.json", observations["LINEAR-01-SEED"]),
  receiptFile("offline-gap.json", results["LINEAR-10-OFFLINE"]),
  receiptFile("deployment-gap.json", results["LINEAR-12-DEPLOY"]),
  receiptFile("performance.json", performance),
  receiptFile("transport-attribution.json", {
    durable: "PostgREST over HTTP with PostgreSQL RLS",
    realtime: "Supabase Realtime Postgres Changes over WebSocket for issues, comments, and activities",
    pollingCountsAsPush: false,
    search: "PostgreSQL full-text search through PostgREST RPC",
    conflict: "PostgreSQL row-lock serialization with activity identity ordering",
    offline: "unsupported by bare supabase-js; no provider-owned retained query cache or mutation queue",
    reconnect: "native Realtime resubscribe followed by a fresh authoritative PostgREST page"
  })
]);

for (const actor of Object.values(actors)) {
  await actor.client.removeAllChannels();
}

const blockingFailures = Object.values(results).filter(({ status }) => status === "fail");
console.log(JSON.stringify({
  ok: blockingFailures.length === 0,
  statuses: countStatuses(results),
  targetIdentityHash: identity.identityHash,
  milestones: scenarioReceipt.milestones
}, null, 2));
if (blockingFailures.length > 0) process.exitCode = 1;

async function actorClient(name) {
  const client = createClient(config.apiUrl, config.anonKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
      storageKey: `llp0102-linear-${name}-${randomUUID()}`
    }
  });
  const signedIn = await client.auth.signInWithPassword({
    email: `${name}.linear.w3@llp0102.local`,
    password: passphrase
  });
  must(!signedIn.error && signedIn.data.user, signedIn.error?.message ?? `${name} sign-in failed`);
  return { client, userId: signedIn.data.user.id };
}

async function scenario(id, run) {
  try {
    const evidence = await run();
    results[id] = { status: "pass", evidence, note: "" };
    observations[id] = evidence;
  } catch (error) {
    results[id] = { status: "fail", note: error.message, evidence: {} };
    observations[id] = { error: error.message };
  }
}

async function authoritativeIssue(issueNumber) {
  const result = await admin.from("issues").select("*")
    .eq("organization_id", primaryOrganization).eq("issue_number", issueNumber).single();
  must(!result.error, result.error?.message);
  return result.data;
}

async function updateIssue(client, issue, next) {
  return await client.rpc("linear_update_issue", {
    requested_issue: issue.id,
    requested_status: next.status,
    requested_priority: next.priority,
    requested_assignee: next.assigneeId,
    requested_board_position: next.boardPosition,
    requested_action: next.action
  });
}

async function issuePage(client, beforeCreatedAt, beforeId) {
  return await client.rpc("linear_issue_page", {
    requested_organization: primaryOrganization,
    before_created_at: beforeCreatedAt,
    before_id: beforeId,
    requested_limit: 50
  });
}

async function subscribePostgres(client, table, filter, sink) {
  const channel = client
    .channel(`linear-${table}-${randomUUID()}`)
    .on("postgres_changes", { event: "*", schema: "public", table, filter }, ({ new: row }) => sink.push(row));
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`${table} subscription timeout`)), 8_000);
    channel.subscribe((status, error) => {
      if (status === "SUBSCRIBED") {
        clearTimeout(timeout);
        resolve();
      } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
        clearTimeout(timeout);
        reject(error ?? new Error(`${table} subscription ${status}`));
      }
    });
  });
  return channel;
}

async function offlineGap() {
  const issue = await authoritativeIssue(50);
  const blockedFetch = async () => {
    throw new TypeError("transport disabled by frozen offline harness");
  };
  const cold = createClient(config.apiUrl, config.anonKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: {
      fetch: blockedFetch,
      headers: { Authorization: `Bearer ${actors.alice.accessToken ?? (await actors.alice.client.auth.getSession()).data.session.access_token}` }
    }
  });
  const coldRead = await cold.from("issues").select("id").eq("organization_id", primaryOrganization).limit(50);
  const queuedEdit = await cold.rpc("linear_update_issue", {
    requested_issue: issue.id,
    requested_status: "done",
    requested_priority: issue.priority,
    requested_assignee: issue.assignee_id,
    requested_board_position: issue.board_position,
    requested_action: "offline.queue-attempt"
  });
  must(Boolean(coldRead.error), "transport-disabled cold read unexpectedly succeeded");
  must(Boolean(queuedEdit.error), "transport-disabled edit unexpectedly succeeded");
  const authoritative = await authoritativeIssue(50);
  must(authoritative.revision === issue.revision, "blocked edit reached authority");
  return {
    status: "gap",
    note: "Bare supabase-js has no provider-owned retained PostgREST query store or durable mutation queue. A cold client with transport disabled returned no rows, the attempted RPC errored, and authority stayed unchanged.",
    evidence: {
      coldClient: "fresh createClient instance with no application cache",
      transportDisabled: true,
      retainedRows: 0,
      readError: coldRead.error.message,
      queuedEdit: "unsupported; request returned transport error and no SDK queue was created",
      editError: queuedEdit.error.message,
      authoritativeRevisionUnchanged: authoritative.revision,
      applicationGlueExcluded: "IndexedDB/SQLite retention and an outbox would be app-authored, so were not credited"
    }
  };
}

async function localDeploymentGap() {
  const project = runState.projectId;
  const containers = execFileSync("docker", [
    "ps", "--filter", `name=${project}`, "--format", "{{.Names}}|{{.Image}}|{{.Status}}"
  ], { encoding: "utf8" }).trim().split(/\r?\n/).filter(Boolean);
  must(containers.length > 0, "local target containers unavailable");
  const restContainer = containers.find((line) => line.startsWith("supabase_rest_"))?.split("|")[0];
  must(restContainer, "PostgREST container unavailable");
  const logOutput = execFileSync("docker", ["logs", "--tail", "20", restContainer], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  });
  const dbContainer = `supabase_db_${project}`;
  const schemaDump = execFileSync("docker", [
    "exec", dbContainer, "pg_dump", "--schema-only", "--no-owner", "--no-privileges",
    "-U", "postgres", "-d", "postgres", "--schema", "public"
  ], { encoding: "utf8" });
  await writeFile(path.join(receipts, "pre-cleanup-public-schema.sql"), schemaDump);
  const operations = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    target: targetIdentity(),
    configuration: "work/supabase/config.toml",
    exactContainers: containers.map((line) => {
      const [name, image, status] = line.split("|");
      return { name, image, status };
    }),
    logs: {
      command: `docker logs --tail 20 ${restContainer}`,
      lineCount: logOutput.split(/\r?\n/).filter(Boolean).length,
      sha256: sha256(logOutput),
      contentRetained: false,
      reason: "hash and count prove inspectability without retaining request details"
    },
    export: {
      command: `docker exec ${dbContainer} pg_dump --schema-only --schema public`,
      path: "receipts/pre-cleanup-public-schema.sql",
      bytes: Buffer.byteLength(schemaDump),
      sha256: sha256(schemaDump)
    },
    rollback: "official CLI `supabase db reset` replays committed base migrations; the additive evolution has its own retained SQL artifact",
    hosted: {
      status: "unavailable",
      reason: "No fresh hosted Supabase project was assigned; the protocol permits a local-only arm when hosted access is unavailable."
    }
  };
  await receiptFile("operations.json", operations);
  return {
    status: "gap",
    note: "The official isolated local CLI deployment is directly inspectable, but no hosted deployment was provisioned; hosted identity, region, billing, and rollback were not claimed.",
    evidence: {
      targetIdentity: targetIdentity(),
      deploymentReceipt: "receipts/operations.json",
      operationsReceipts: [
        "receipts/operations.json",
        "receipts/pre-cleanup-public-schema.sql"
      ],
      localOperations: true,
      hostedGap: operations.hosted.reason
    }
  };
}

async function measurePerformance() {
  const warmups = 2;
  const recordedSamples = 7;
  const issue = await authoritativeIssue(60);
  const paths = {
    "list-50": [],
    detail: [],
    write: [],
    "realtime-delivery": [],
    reconnect: [],
    "build-or-deploy": []
  };

  for (let index = 0; index < warmups + recordedSamples; index += 1) {
    const sample = await timed(async () => {
      const result = await issuePage(actors.alice.client, null, null);
      must(!result.error && result.data.length === 50, result.error?.message ?? "performance list failed");
    });
    if (index >= warmups) paths["list-50"].push(sample);
  }

  for (let index = 0; index < warmups + recordedSamples; index += 1) {
    const sample = await timed(async () => {
      const [row, labels, comments, activities] = await Promise.all([
        actors.alice.client.from("issues").select("id,project_id,assignee_id").eq("id", issue.id).single(),
        actors.alice.client.from("issue_labels").select("label_id").eq("issue_id", issue.id).limit(10),
        actors.alice.client.from("comments").select("id").eq("issue_id", issue.id).limit(10),
        actors.alice.client.from("activities").select("id").eq("issue_id", issue.id).limit(20)
      ]);
      for (const result of [row, labels, comments, activities]) must(!result.error, result.error?.message);
    });
    if (index >= warmups) paths.detail.push(sample);
  }

  let current = issue;
  for (let index = 0; index < warmups + recordedSamples; index += 1) {
    const nextPriority = (current.priority + 1) % 5;
    let response;
    const sample = await timed(async () => {
      response = await updateIssue(actors.alice.client, current, {
        status: current.status,
        priority: nextPriority,
        assigneeId: current.assignee_id,
        boardPosition: Number(current.board_position),
        action: "performance.write"
      });
      must(!response.error, response.error?.message);
    });
    current = { ...current, priority: nextPriority, revision: response.data.revision };
    if (index >= warmups) paths.write.push(sample);
  }

  const events = [];
  const realtimeChannel = await subscribePostgres(actors.bobSecond.client, "issues", `id=eq.${issue.id}`, events);
  for (let index = 0; index < warmups + recordedSamples; index += 1) {
    const before = events.length;
    const nextPriority = (current.priority + 1) % 5;
    let response;
    const sample = await timed(async () => {
      response = await updateIssue(actors.alice.client, current, {
        status: current.status,
        priority: nextPriority,
        assigneeId: current.assignee_id,
        boardPosition: Number(current.board_position),
        action: "performance.realtime"
      });
      must(!response.error, response.error?.message);
      await waitUntil(() => events.length > before, 5_000, "performance realtime delivery");
    });
    current = { ...current, priority: nextPriority, revision: response.data.revision };
    if (index >= warmups) paths["realtime-delivery"].push(sample);
  }
  await actors.bobSecond.client.removeChannel(realtimeChannel);

  for (let index = 0; index < warmups + recordedSamples; index += 1) {
    let channel;
    const sample = await timed(async () => {
      channel = await subscribePostgres(actors.bobSecond.client, "issues", `organization_id=eq.${primaryOrganization}`, []);
      const fresh = await issuePage(actors.bobSecond.client, null, null);
      must(!fresh.error && fresh.data.length === 50, fresh.error?.message ?? "reconnect fresh page failed");
    });
    await actors.bobSecond.client.removeChannel(channel);
    if (index >= warmups) paths.reconnect.push(sample);
  }

  for (let index = 0; index < warmups + recordedSamples; index += 1) {
    const sample = await timed(async () => {
      execFileSync(process.execPath, [path.join(here, "build.mjs")], {
        cwd: work,
        env: process.env,
        stdio: ["ignore", "pipe", "pipe"]
      });
    });
    if (index >= warmups) paths["build-or-deploy"].push(sample);
  }

  return {
    claimScope: "small frozen local product workload; not production scale",
    warmups,
    recordedSamples,
    dataset: {
      organizations: 2,
      teams: 3,
      projects: 4,
      issues: 500,
      commentsAtMeasurement: (await workloadCounts()).comments,
      labels: 20,
      pageSize: 50,
      clients: 2
    },
    paths: Object.fromEntries(Object.entries(paths).map(([name, samples]) => [
      name,
      {
        samplesMs: samples,
        medianMs: nearestRank(samples, 0.5),
        nearestRankP95Ms: nearestRank(samples, 0.95)
      }
    ])),
    machine: {
      platform: os.platform(),
      release: os.release(),
      architecture: os.arch(),
      cpu: os.cpus()[0]?.model,
      cpuCount: os.cpus().length,
      memoryBytes: os.totalmem(),
      loadAverageAtFinish: os.loadavg()
    },
    costWindow: {
      start: runState.startedAt,
      end: new Date().toISOString(),
      actualProviderUsage: "$0 incremental provider charge for the local Docker target",
      hostedListPriceEstimate: "not applicable; hosted target not provisioned",
      extrapolatedAsMeasured: false
    }
  };
}

async function workloadCounts() {
  const counts = {};
  for (const table of ["organizations", "teams", "projects", "labels", "issues", "issue_labels", "comments", "activities"]) {
    const result = await admin.from(table).select("*", { count: "exact", head: true });
    must(!result.error, result.error?.message);
    counts[table] = result.count;
  }
  return counts;
}

function targetIdentity() {
  return {
    provider: "Supabase",
    topology: "official Supabase CLI Docker stack on isolated Colima project",
    projectId: runState.projectId,
    identityHash: sha256(`${runState.projectId}|${config.apiUrl}|${runState.ports.database}`),
    apiOrigin: config.apiUrl,
    databasePort: runState.ports.database,
    studioOrigin: `http://127.0.0.1:${runState.ports.studio}`,
    mailOrigin: `http://127.0.0.1:${runState.ports.mail}`,
    viteOrigin: `http://127.0.0.1:${runState.ports.vite}`,
    runtimeMirror: sha256(runState.runtimeProjectDir),
    hosted: "unavailable; not provisioned and not claimed",
    sourceCommit: runState.sourceCommit,
    freezeAggregateSha256: runState.freezeAggregateSha256
  };
}

function sqlLines(query) {
  const container = `supabase_db_${runState.projectId}`;
  const output = execFileSync("docker", [
    "exec", container, "psql", "-At", "-v", "ON_ERROR_STOP=1",
    "-U", "postgres", "-d", "postgres", "-c", query
  ], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  return output.trim().split(/\r?\n/).filter(Boolean);
}

async function receiptFile(name, value) {
  if (value == null) return;
  await writeFile(path.join(receipts, name), `${JSON.stringify(value, null, 2)}\n`);
}

async function timed(run) {
  const start = process.hrtime.bigint();
  await run();
  return Number(process.hrtime.bigint() - start) / 1e6;
}

function nearestRank(values, fraction) {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.ceil(sorted.length * fraction) - 1];
}

async function retry(run) {
  let result;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    result = await run();
    if (!result.error) return result;
    await wait(100);
  }
  return result;
}

function equal(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function sha256(value) {
  return createHash("sha256").update(String(value)).digest("hex");
}

function elapsed() {
  return Number(process.hrtime.bigint() / 1_000_000n) - runState.startedMonotonicMs;
}

function must(condition, message = "assertion failed") {
  if (!condition) throw new Error(message);
}

function countStatuses(scenarios) {
  return Object.values(scenarios).reduce((counts, { status }) => {
    counts[status] = (counts[status] ?? 0) + 1;
    return counts;
  }, {});
}

async function wait(milliseconds) {
  await new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function waitUntil(predicate, timeoutMs, label) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await wait(20);
  }
  throw new Error(`timed out waiting for ${label}`);
}

async function waitFor(predicate, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return true;
    await wait(20);
  }
  return false;
}
