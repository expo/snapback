import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  deleteApp as deleteAdminApp,
  initializeApp as initializeAdminApp,
} from "firebase-admin/app";
import { getAuth as getAdminAuth } from "firebase-admin/auth";
import {
  FieldValue,
  Timestamp,
  getFirestore as getAdminFirestore,
} from "firebase-admin/firestore";
import {
  collection,
  doc,
  getDocFromServer,
  getDocsFromServer,
  increment,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  startAfter,
  updateDoc,
  where,
} from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import {
  actor,
  assert,
  deferred,
  hash,
  measure,
  password,
  personas,
  projectId,
  stats,
} from "./lib.mjs";

// @ref LLP 0102#app-3-linear-shaped-issue-tracker — Frozen issue-tracker workload, actor, authority, and evidence contract.
process.env.GCLOUD_PROJECT = projectId;
process.env.FIREBASE_AUTH_EMULATOR_HOST = "127.0.0.1:9321";
process.env.FIRESTORE_EMULATOR_HOST = "127.0.0.1:8321";

const monotonicStart = performance.now();
const startedAt = new Date().toISOString();
const receipts = path.resolve("receipts");
const scenarioDirectory = path.join(receipts, "scenarios");
await mkdir(scenarioDirectory, { recursive: true });

const adminApp = initializeAdminApp({ projectId }, `admin-${crypto.randomUUID()}`);
const adminAuth = getAdminAuth(adminApp);
const adminDb = getAdminFirestore(adminApp);
const scenarios = {};
const commands = [];
const milestones = {
  firstLocalReadMs: null,
  firstAuthoritativeMutationMs: null,
  firstRealtimeTransitionMs: null,
  localAcceptanceMs: null,
  hostedUrlMs: null,
  acceptanceCompletionMs: null,
};

const elapsed = () => Math.round(performance.now() - monotonicStart);
const ids = (snapshot) => snapshot.docs.map((item) => item.id);
const sorted = (values) => [...values].sort();

const completeHub = await fetch("http://127.0.0.1:4521/emulators").then((response) => response.json());
assert(
  ["auth", "firestore", "functions", "storage", "logging"].every((name) => completeHub[name]),
  "Emulator service inventory is incomplete",
);
await writeFile(path.join(receipts, "emulator-hub.json"), `${JSON.stringify(completeHub, null, 2)}\n`);
const initialIdentity = JSON.parse(await readFile(path.join(receipts, "target-identity.json"), "utf8"));
initialIdentity.services = completeHub;
initialIdentity.identityHash = hash(JSON.stringify({
  projectId,
  hub: completeHub,
  root: process.cwd(),
}));
initialIdentity.refreshedAt = new Date().toISOString();
await writeFile(path.join(receipts, "target-identity.json"), `${JSON.stringify(initialIdentity, null, 2)}\n`);

async function receipt(id, status, evidence, transport, note) {
  const value = {
    id,
    status,
    capturedAt: new Date().toISOString(),
    target: projectId,
    transport,
    evidence,
    note,
  };
  scenarios[id] = value;
  await writeFile(
    path.join(scenarioDirectory, `${id}.json`),
    `${JSON.stringify(value, null, 2)}\n`,
  );
  return value;
}

async function ensureUser(email, displayName) {
  try {
    return await adminAuth.getUserByEmail(email);
  } catch (error) {
    if (error.code !== "auth/user-not-found") throw error;
    return adminAuth.createUser({
      email,
      password,
      displayName,
      emailVerified: true,
    });
  }
}

async function clearTarget() {
  for (const name of [
    "organizations",
    "teams",
    "projects",
    "labels",
    "issues",
    "comments",
    "activities",
  ]) {
    await adminDb.recursiveDelete(adminDb.collection(name));
  }
  let page;
  do {
    page = await adminAuth.listUsers(1000);
    if (page.users.length) await adminAuth.deleteUsers(page.users.map((user) => user.uid));
  } while (page.pageToken);
}

async function seed() {
  await clearTarget();
  const users = {};
  for (const [name, email] of Object.entries(personas)) {
    users[name] = await ensureUser(email, name);
  }
  const epoch = Date.UTC(2026, 6, 28);
  const writer = adminDb.bulkWriter();
  writer.set(adminDb.doc("organizations/org-primary"), {
    name: "Acme",
    slug: "acme",
    createdAt: Timestamp.fromMillis(epoch),
  });
  writer.set(adminDb.doc("organizations/org-secondary"), {
    name: "Mallory Labs",
    slug: "mallory-labs",
    createdAt: Timestamp.fromMillis(epoch),
  });
  writer.set(adminDb.doc(`organizations/org-primary/members/${users.alice.uid}`), {
    orgId: "org-primary",
    userId: users.alice.uid,
    displayName: "Alice",
    role: "owner",
  });
  writer.set(adminDb.doc(`organizations/org-primary/members/${users.bob.uid}`), {
    orgId: "org-primary",
    userId: users.bob.uid,
    displayName: "Bob",
    role: "member",
  });
  writer.set(adminDb.doc(`organizations/org-secondary/members/${users.mallory.uid}`), {
    orgId: "org-secondary",
    userId: users.mallory.uid,
    displayName: "Mallory",
    role: "owner",
  });
  for (let index = 1; index <= 3; index += 1) {
    writer.set(adminDb.doc(`teams/team-${index}`), {
      orgId: "org-primary",
      name: ["Platform", "Product", "Operations"][index - 1],
      key: ["PLAT", "PROD", "OPS"][index - 1],
    });
  }
  for (let index = 1; index <= 4; index += 1) {
    writer.set(adminDb.doc(`projects/project-${index}`), {
      orgId: "org-primary",
      teamId: `team-${((index - 1) % 3) + 1}`,
      name: `Project ${index}`,
      state: index % 2 ? "active" : "planned",
    });
  }
  for (let index = 1; index <= 20; index += 1) {
    writer.set(adminDb.doc(`labels/label-${String(index).padStart(2, "0")}`), {
      orgId: "org-primary",
      name: `Label ${index}`,
      color: `#${(0x224466 + index * 12345).toString(16).slice(-6)}`,
    });
  }
  const statuses = ["todo", "in_progress", "review", "done"];
  for (let index = 1; index <= 500; index += 1) {
    const issueId = `issue-${String(index).padStart(3, "0")}`;
    const teamId = `team-${((index - 1) % 3) + 1}`;
    const projectIdForIssue = `project-${((index - 1) % 4) + 1}`;
    const firstLabel = `label-${String(((index - 1) % 20) + 1).padStart(2, "0")}`;
    const secondLabel = `label-${String((index % 20) + 1).padStart(2, "0")}`;
    writer.set(adminDb.doc(`issues/${issueId}`), {
      orgId: "org-primary",
      teamId,
      projectId: projectIdForIssue,
      identifier: `LIN-${String(index).padStart(3, "0")}`,
      title: index % 25 === 0
        ? `Authentication regression investigation ${index}`
        : `Production-shaped issue ${index}`,
      description: `Deterministic issue body ${index} for the frozen Firebase Linear workload.`,
      status: statuses[(index - 1) % statuses.length],
      priority: ((index - 1) % 4) + 1,
      assigneeId: index % 2 ? users.alice.uid : users.bob.uid,
      boardPosition: index,
      sequence: index,
      revision: 1,
      labelIds: [firstLabel, secondLabel],
      createdAt: Timestamp.fromMillis(epoch + index * 60_000),
      updatedAt: Timestamp.fromMillis(epoch + index * 60_000),
    });
    for (let comment = 1; comment <= 2; comment += 1) {
      const commentId = `${issueId}-comment-${comment}`;
      writer.set(adminDb.doc(`comments/${commentId}`), {
        orgId: "org-primary",
        issueId,
        authorId: comment === 1 ? users.alice.uid : users.bob.uid,
        body: `Seed comment ${comment} for ${issueId}`,
        sequence: comment,
        createdAt: Timestamp.fromMillis(epoch + index * 60_000 + comment * 1_000),
      });
    }
    writer.set(adminDb.doc(`activities/${issueId}-seed`), {
      orgId: "org-primary",
      issueId,
      actorId: users.alice.uid,
      kind: "issue_seeded",
      createdAt: Timestamp.fromMillis(epoch + index * 60_000),
    });
  }
  await writer.close();
  return users;
}

async function counts() {
  const collections = [
    "organizations",
    "teams",
    "projects",
    "labels",
    "issues",
    "comments",
    "activities",
  ];
  return Object.fromEntries(await Promise.all(collections.map(async (name) => [
    name,
    (await adminDb.collection(name).count().get()).data().count,
  ])));
}

async function expectDenied(operation, label) {
  try {
    await operation();
  } catch (error) {
    const code = String(error.code ?? error.message);
    assert(code.includes("permission-denied"), `${label}: unexpected ${code}`);
    return code;
  }
  throw new Error(`${label} unexpectedly succeeded`);
}

function issueList(client, extra = [], pageSize = 50) {
  return query(
    collection(client.db, "issues"),
    where("orgId", "==", "org-primary"),
    ...extra,
    orderBy("sequence", "desc"),
    limit(pageSize),
  );
}

async function expectedIds(filters) {
  let reference = adminDb.collection("issues").where("orgId", "==", "org-primary");
  for (const [field, operator, value] of filters) reference = reference.where(field, operator, value);
  return sorted((await reference.get()).docs.map((item) => item.id));
}

async function runBuild() {
  const started = performance.now();
  const exitStatus = await new Promise((resolve, reject) => {
    const child = spawn("npm", ["run", "build", "--silent"], {
      cwd: process.cwd(),
      stdio: "ignore",
    });
    child.once("error", reject);
    child.once("exit", (status) => resolve(status ?? 1));
  });
  const durationMs = Number((performance.now() - started).toFixed(3));
  commands.push({ command: "npm run build --silent", exitStatus, durationMs });
  assert(exitStatus === 0, `build exited ${exitStatus}`);
  return durationMs;
}

const users = await seed();
const seedCounts = await counts();
const seedReceipt = {
  schemaVersion: 1,
  projectId,
  deterministicEpochMs: Date.UTC(2026, 6, 28),
  counts: seedCounts,
  primaryOrg: {
    teams: 3,
    projects: 4,
    issues: 500,
    comments: 1000,
    labels: 20,
  },
  personas: Object.fromEntries(Object.entries(users).map(([name, user]) => [
    name,
    { uidHash: hash(user.uid), emailDomain: "example.test" },
  ])),
};
await writeFile(path.join(receipts, "seed-receipt.json"), `${JSON.stringify(seedReceipt, null, 2)}\n`);

const alice = await actor("alice");
const bob = await actor("bob");
const mallory = await actor("mallory");

try {
  const firstPage = await getDocsFromServer(issueList(alice));
  milestones.firstLocalReadMs = elapsed();
  assert(firstPage.size === 50, "First issue page must contain 50 rows");
  assert(JSON.stringify(seedCounts) === JSON.stringify({
    organizations: 2,
    teams: 3,
    projects: 4,
    labels: 20,
    issues: 500,
    comments: 1000,
    activities: 500,
  }), "Production seed counts drifted");
  await receipt("LINEAR-01-SEED", "pass", {
    authoritativeCounts: seedCounts,
    firstPageCount: firstPage.size,
    personas: seedReceipt.personas,
    seedReceipt: "receipts/seed-receipt.json",
  }, "not-applicable", "Admin SDK counts and signed-in client read prove the exact fresh-local seed.");

  const bobPage = await getDocsFromServer(issueList(bob));
  const malloryRead = await expectDenied(
    () => getDocsFromServer(issueList(mallory)),
    "Mallory primary organization read",
  );
  const targetRef = doc(mallory.db, "issues", "issue-001");
  const malloryWrite = await expectDenied(
    () => updateDoc(targetRef, { priority: 4 }),
    "Mallory primary organization write",
  );
  const aliceMembership = await getDocFromServer(
    doc(alice.db, "organizations", "org-primary", "members", alice.uid),
  );
  assert(aliceMembership.data().role === "owner", "Alice must be owner");
  assert(bobPage.size === 50, "Bob team member must read");
  await receipt("LINEAR-02-AUTHORITY", "pass", {
    aliceRole: aliceMembership.data().role,
    bobPageCount: bobPage.size,
    malloryRead,
    malloryWrite,
    ruleSource: "firestore.rules",
  }, "Firestore Security Rules", "Three native Auth-emulator principals exercised owner/member positive and outsider negative paths.");

  const filterSpecs = [
    ["status", "==", "in_progress"],
    ["assigneeId", "==", users.bob.uid],
    ["projectId", "==", "project-2"],
    ["labelIds", "array-contains", "label-04"],
  ];
  const filterEvidence = {};
  for (const [field, operator, value] of filterSpecs) {
    const actual = sorted(ids(await getDocsFromServer(issueList(alice, [where(field, operator, value)], 500))));
    const expected = await expectedIds([[field, operator, value]]);
    assert(JSON.stringify(actual) === JSON.stringify(expected), `${field} filter mismatch`);
    filterEvidence[field] = { resultCount: actual.length, expectedSetHash: hash(actual.join(",")) };
  }
  const indexesBody = await readFile("firestore.indexes.json");
  await receipt("LINEAR-03-FILTERS", "pass", {
    filters: filterEvidence,
    indexConfigSha256: hash(indexesBody),
    indexDefinitions: JSON.parse(indexesBody).indexes.length,
  }, "Firestore indexed queries", "Four client queries matched independent Admin SDK authoritative sets; compound index artifact retained.");

  const pageOne = await getDocsFromServer(issueList(alice));
  const cursor = pageOne.docs.at(-1);
  await adminDb.doc("issues/issue-pagination-501").set({
    ...pageOne.docs[0].data(),
    identifier: "LIN-501",
    title: "Concurrent pagination insert",
    sequence: 501,
    boardPosition: 501,
    revision: 1,
    createdAt: Timestamp.now(),
    updatedAt: Timestamp.now(),
  });
  const pageTwo = await getDocsFromServer(query(
    collection(alice.db, "issues"),
    where("orgId", "==", "org-primary"),
    orderBy("sequence", "desc"),
    startAfter(cursor),
    limit(50),
  ));
  const pageOneIds = ids(pageOne);
  const pageTwoIds = ids(pageTwo);
  assert(new Set([...pageOneIds, ...pageTwoIds]).size === 100, "Cursor pages duplicated");
  assert(!pageTwoIds.includes("issue-pagination-501"), "Newer insert shifted into older page");
  assert(pageTwo.docs[0].data().sequence < cursor.data().sequence, "Page two ordering invalid");
  await adminDb.doc("issues/issue-pagination-501").delete();
  await receipt("LINEAR-04-PAGINATION", "pass", {
    cursor: { id: cursor.id, sequence: cursor.data().sequence },
    pageOneCount: pageOneIds.length,
    pageTwoCount: pageTwoIds.length,
    unionCount: new Set([...pageOneIds, ...pageTwoIds]).size,
    concurrentInsertExcluded: true,
  }, "Firestore document cursor", "Stable startAfter document cursor produced 100 unique rows despite a newer concurrent insert.");

  const issue = await getDocFromServer(doc(alice.db, "issues", "issue-001"));
  const issueData = issue.data();
  const [project, assignee, issueLabels, issueComments, issueActivities] = await Promise.all([
    getDocFromServer(doc(alice.db, "projects", issueData.projectId)),
    getDocFromServer(doc(alice.db, "organizations", issueData.orgId, "members", issueData.assigneeId)),
    Promise.all(issueData.labelIds.map((labelId) => getDocFromServer(doc(alice.db, "labels", labelId)))),
    getDocsFromServer(query(collection(alice.db, "comments"), where("orgId", "==", "org-primary"), where("issueId", "==", issue.id), orderBy("createdAt", "desc"), limit(20))),
    getDocsFromServer(query(collection(alice.db, "activities"), where("orgId", "==", "org-primary"), where("issueId", "==", issue.id), orderBy("createdAt", "desc"), limit(20))),
  ]);
  assert(project.exists() && assignee.exists(), "Detail relations missing");
  assert(issueLabels.every((label) => label.exists()), "Detail labels missing");
  assert(issueComments.size === 2 && issueActivities.size === 1, "Detail collections missing");
  await receipt("LINEAR-05-DETAIL", "pass", {
    issueId: issue.id,
    projectId: project.id,
    assigneeIdHash: hash(assignee.id),
    labelIds: issueLabels.map((label) => label.id),
    commentIds: ids(issueComments),
    activityIds: ids(issueActivities),
    boundedQueryInventory: { pointReads: 5, boundedQueries: 2, maximumRows: 40 },
  }, "Firestore point reads and bounded indexed queries", "Related IDs were composed from direct authorized reads without an unbounded scan.");

  const original = { ...issueData };
  const optimisticGate = deferred(5_000, "Alice optimistic metadata");
  const authoritativeGate = deferred(8_000, "Bob authoritative reconciliation");
  const stopAlice = onSnapshot(doc(alice.db, "issues", issue.id), { includeMetadataChanges: true }, (snapshot) => {
    if (snapshot.data()?.status === "review" && snapshot.metadata.hasPendingWrites) {
      optimisticGate.resolve({ fromCache: snapshot.metadata.fromCache, hasPendingWrites: true });
    }
  }, optimisticGate.reject);
  const stopBob = onSnapshot(doc(bob.db, "issues", issue.id), { includeMetadataChanges: true }, (snapshot) => {
    if (snapshot.data()?.status === "review" && !snapshot.metadata.hasPendingWrites && !snapshot.metadata.fromCache) {
      authoritativeGate.resolve(snapshot.data());
    }
  }, authoritativeGate.reject);
  const settlement = updateDoc(doc(alice.db, "issues", issue.id), {
    status: "review",
    priority: 4,
    assigneeId: users.bob.uid,
    boardPosition: 777,
    revision: increment(1),
    updatedAt: serverTimestamp(),
  });
  const optimistic = await optimisticGate.promise;
  await settlement;
  const authoritative = await authoritativeGate.promise;
  stopAlice();
  stopBob();
  milestones.firstAuthoritativeMutationMs = elapsed();
  assert(authoritative.priority === 4 && authoritative.assigneeId === users.bob.uid && authoritative.boardPosition === 777, "Optimistic fields did not reconcile");
  await receipt("LINEAR-06-OPTIMISTIC", "pass", {
    optimisticStateAttribution: optimistic,
    settlement: "updateDoc acknowledged",
    authoritativeState: {
      status: authoritative.status,
      priority: authoritative.priority,
      assigneeIdHash: hash(authoritative.assigneeId),
      boardPosition: authoritative.boardPosition,
      revision: authoritative.revision,
    },
  }, "Firestore latency compensation plus onSnapshot", "Pending-write metadata distinguishes optimistic state; Bob observed the server-confirmed state.");

  const conflictRevision = authoritative.revision;
  const aliceMove = httpsCallable(alice.functions, "moveIssue");
  const bobMove = httpsCallable(bob.functions, "moveIssue");
  const conflictResults = await Promise.allSettled([
    aliceMove({ issueId: issue.id, expectedRevision: conflictRevision, boardPosition: 1001 }),
    bobMove({ issueId: issue.id, expectedRevision: conflictRevision, boardPosition: 1002 }),
  ]);
  const successes = conflictResults.filter((result) => result.status === "fulfilled");
  const refusals = conflictResults.filter((result) => result.status === "rejected");
  assert(successes.length === 1 && refusals.length === 1, "Revision CAS must select exactly one move");
  const conflictIssue = await adminDb.doc(`issues/${issue.id}`).get();
  const winningPosition = successes[0].value.data.boardPosition;
  assert(conflictIssue.data().boardPosition === winningPosition, "Conflict winner not authoritative");
  assert(String(refusals[0].reason.code).includes("aborted"), "Loser must receive typed aborted conflict");
  const [aliceAfterConflict, bobAfterConflict] = await Promise.all([
    getDocFromServer(doc(alice.db, "issues", issue.id)),
    getDocFromServer(doc(bob.db, "issues", issue.id)),
  ]);
  assert(aliceAfterConflict.data().boardPosition === winningPosition && bobAfterConflict.data().boardPosition === winningPosition, "Clients did not converge");
  await receipt("LINEAR-07-CONFLICT", "pass", {
    barrier: { actors: ["alice", "bob"], expectedRevision: conflictRevision },
    resultKinds: conflictResults.map((result) => result.status),
    loserCode: String(refusals[0].reason.code),
    authoritativeOutcome: {
      boardPosition: winningPosition,
      revision: conflictIssue.data().revision,
      lastActorIdHash: hash(conflictIssue.data().lastActorId),
    },
    clientsConverged: true,
    policy: "Server transaction compare-and-set: exactly one matching revision commits; the loser receives functions/aborted.",
  }, "Callable Function plus Firestore serializable transaction", "The winner may vary by scheduling, but the deterministic invariant is one commit, one typed refusal, and converged clients.");

  const commentBody = `Live comment ${crypto.randomUUID()}`;
  const commentGate = deferred(8_000, "Bob live comment");
  const activityGate = deferred(8_000, "Bob live activity");
  const stopComments = onSnapshot(query(collection(bob.db, "comments"), where("orgId", "==", "org-primary"), where("issueId", "==", issue.id), orderBy("createdAt", "desc"), limit(5)), (snapshot) => {
    const found = snapshot.docs.find((item) => item.data().body === commentBody);
    if (found && !snapshot.metadata.fromCache) commentGate.resolve(found.id);
  }, commentGate.reject);
  const stopActivities = onSnapshot(query(collection(bob.db, "activities"), where("orgId", "==", "org-primary"), where("issueId", "==", issue.id), orderBy("createdAt", "desc"), limit(5)), (snapshot) => {
    const found = snapshot.docs.find((item) => item.data().kind === "comment_added");
    if (found && !snapshot.metadata.fromCache) activityGate.resolve(found.id);
  }, activityGate.reject);
  const addComment = httpsCallable(alice.functions, "addComment");
  const commentStart = performance.now();
  const commentResult = await addComment({ issueId: issue.id, body: commentBody });
  const [liveCommentId, liveActivityId] = await Promise.all([commentGate.promise, activityGate.promise]);
  const realtimeMs = Number((performance.now() - commentStart).toFixed(3));
  stopComments();
  stopActivities();
  const [authoritativeComment, authoritativeActivity] = await Promise.all([
    adminDb.doc(`comments/${liveCommentId}`).get(),
    adminDb.doc(`activities/${liveActivityId}`).get(),
  ]);
  assert(authoritativeComment.exists && authoritativeActivity.exists, "Live records not authoritative");
  assert(commentResult.data.commentId === liveCommentId && commentResult.data.activityId === liveActivityId, "Callable and listeners disagree");
  milestones.firstRealtimeTransitionMs = elapsed();
  await receipt("LINEAR-08-LIVE", "pass", {
    secondClient: "bob",
    commentId: liveCommentId,
    activityId: liveActivityId,
    authorIdHash: hash(authoritativeComment.data().authorId),
    latencyMs: realtimeMs,
    snapshotFromCache: false,
    polling: false,
  }, "Firestore onSnapshot/WebChannel push", "Bob received both server-authored records through native listen streams.");

  await receipt("LINEAR-09-SEARCH", "gap", {
    provider: "Cloud Firestore",
    attemptedNativePath: "Firestore query operators and documented solutions inventory",
    ordinarySupportedPath: null,
    authoritativeResults: null,
    officialDocumentation: "https://firebase.google.com/docs/firestore/solutions/search",
  }, "unsupported", "GAP: Cloud Firestore does not provide native full-text search; official Firebase guidance requires a dedicated third-party search service. No client filter is misreported as backend search.");

  await receipt("LINEAR-10-OFFLINE", "pending", {
    plannedReceipt: "receipts/offline-browser.json",
    path: "Firestore persistentLocalCache with transport disabled before cold query and queued update",
  }, "Firestore IndexedDB persistent cache", "Completed by the isolated persistent-browser-profile harness.");

  const beforeMigration = await counts();
  const migrationWriter = adminDb.bulkWriter();
  const issueSnapshot = await adminDb.collection("issues").get();
  for (const issueDocument of issueSnapshot.docs) {
    const sequence = issueDocument.data().sequence;
    migrationWriter.update(issueDocument.ref, {
      customerImpact: sequence % 3 === 0 ? "high" : sequence % 3 === 1 ? "medium" : "low",
    });
  }
  await migrationWriter.close();
  const afterMigration = await counts();
  const migratedQuery = await getDocsFromServer(issueList(alice, [where("customerImpact", "==", "high")], 10));
  assert(migratedQuery.size === 10, "Migrated indexed field query failed");
  assert(beforeMigration.issues === 500 && afterMigration.issues === 500, "Migration lost issues");
  const indexConfig = JSON.parse(await readFile("firestore.indexes.json", "utf8"));
  const customerImpactIndex = indexConfig.indexes.find((index) =>
    index.fields.some((field) => field.fieldPath === "customerImpact"));
  assert(customerImpactIndex, "customerImpact index missing");
  await receipt("LINEAR-11-MIGRATION", "pass", {
    beforeCounts: beforeMigration,
    afterCounts: afterMigration,
    backfilledDocuments: issueSnapshot.size,
    queryResultCount: migratedQuery.size,
    indexProof: customerImpactIndex,
    migrationMechanism: "Admin SDK BulkWriter backfill plus committed Firestore composite index",
  }, "Firestore schemaless evolution and composite index", "The new field was backfilled across all production-shaped rows without count loss and queried through its declared index.");

  const targetIdentity = JSON.parse(await readFile(path.join(receipts, "target-identity.json"), "utf8"));
  const hub = JSON.parse(await readFile(path.join(receipts, "emulator-hub.json"), "utf8"));
  await receipt("LINEAR-12-DEPLOY", "unavailable-remote-dependency", {
    localTargetIdentity: targetIdentity.identityHash,
    localServices: hub,
    configArtifacts: ["firebase.json", ".firebaserc", "firestore.rules", "firestore.indexes.json", "storage.rules"],
    logs: ["receipts/emulator.log", "receipts/vite.log"],
    rollbackExportPlanned: "receipts/export-manifest.json",
    hostedDeployment: null,
  }, "not-applicable", "Hosted credentials are unavailable, so hosted identity/URL/logs are an environment GAP rather than a Firebase product failure. Local deploy/config/log/export evidence is retained.");

  const perfBob = await actor("bob");
  try {
    const representativeRead = await measure(async () => {
      const snapshot = await getDocsFromServer(issueList(alice));
      assert(snapshot.size === 50, "Performance list query");
    });
    const representativeDetail = await measure(async () => {
      const [issueResult, commentsResult, activitiesResult] = await Promise.all([
        getDocFromServer(doc(alice.db, "issues", "issue-250")),
        getDocsFromServer(query(collection(alice.db, "comments"), where("orgId", "==", "org-primary"), where("issueId", "==", "issue-250"), orderBy("createdAt", "desc"), limit(20))),
        getDocsFromServer(query(collection(alice.db, "activities"), where("orgId", "==", "org-primary"), where("issueId", "==", "issue-250"), orderBy("createdAt", "desc"), limit(20))),
      ]);
      assert(issueResult.exists() && commentsResult.size >= 2 && activitiesResult.size >= 1, "Performance detail");
    });
    const representativeWrite = await measure(async (index, warmup) => {
      await updateDoc(doc(alice.db, "issues", "issue-300"), {
        priority: (index % 4) + 1,
        performanceMarker: `${warmup ? "warmup" : "sample"}-${index}`,
        revision: increment(1),
        updatedAt: serverTimestamp(),
      });
    });
    const realtimeDelivery = await measure(async (index, warmup) => {
      const value = `${warmup ? "warmup" : "sample"}-${index}-${crypto.randomUUID()}`;
      const gate = deferred(8_000, "performance realtime");
      const stop = onSnapshot(doc(perfBob.db, "issues", "issue-301"), { includeMetadataChanges: true }, (snapshot) => {
        if (snapshot.data()?.performanceMarker === value && !snapshot.metadata.fromCache) gate.resolve();
      }, gate.reject);
      await updateDoc(doc(alice.db, "issues", "issue-301"), {
        performanceMarker: value,
        revision: increment(1),
        updatedAt: serverTimestamp(),
      });
      await gate.promise;
      stop();
    });
    const reconnect = await measure(async () => {
      const { disableNetwork, enableNetwork } = await import("firebase/firestore");
      await disableNetwork(perfBob.db);
      await enableNetwork(perfBob.db);
      const snapshot = await getDocsFromServer(issueList(perfBob));
      assert(snapshot.size === 50, "Performance reconnect");
    });
    const buildSamples = [];
    for (let index = 0; index < 9; index += 1) {
      const value = await runBuild();
      if (index >= 2) buildSamples.push(value);
    }
    const performanceReceipt = {
      claimScope: "Firebase local emulators on one isolated Mac; not production or hosted latency",
      dataset: {
        organizations: 2,
        teamsPerPrimaryOrg: 3,
        projectsPerPrimaryOrg: 4,
        issues: 500,
        comments: 1000,
        labels: 20,
        pageSize: 50,
        concurrentClients: 2,
      },
      warmupsPerPath: 2,
      recordedSamplesPerPath: 7,
      unit: "milliseconds",
      representativeRead,
      representativeDetail,
      representativeWrite,
      realtimeDelivery,
      reconnect,
      buildOrDeploy: stats(buildSamples),
      machine: {
        model: "Mac17,3",
        architecture: "arm64",
        memory: "32 GiB",
        os: "macOS 26.5.2 (25F84)",
        node: process.version,
        java: "OpenJDK 21.0.10",
      },
      costWindow: {
        measured: "$0 local emulator",
        hostedActualUsage: "unavailable",
        hostedListPriceEstimate: "not estimated without a deployed target workload",
      },
    };
    await writeFile(path.join(receipts, "performance.json"), `${JSON.stringify(performanceReceipt, null, 2)}\n`);
    await receipt("LINEAR-13-PERFORMANCE", "pass", performanceReceipt, "mixed native paths", "Two warmups and seven raw samples retained for every frozen local path.");
  } finally {
    await perfBob.close();
  }

  await adminDb.doc(`issues/${issue.id}`).update({
    status: original.status,
    priority: original.priority,
    assigneeId: original.assigneeId,
    boardPosition: original.boardPosition,
    title: original.title,
    updatedAt: Timestamp.fromMillis(original.updatedAt.toMillis()),
  });
  milestones.localAcceptanceMs = elapsed();
  milestones.acceptanceCompletionMs = elapsed();
  const result = {
    schemaVersion: 1,
    app: "linear",
    provider: "firebase",
    target: projectId,
    startedAt,
    finishedAt: new Date().toISOString(),
    expectedCheckCount: 14,
    completedInThisHarness: 12,
    pendingExternalChecks: ["LINEAR-10-OFFLINE", "LINEAR-14-CLEANUP"],
    scenarios,
    milestones,
    commands,
  };
  await writeFile(path.join(receipts, "acceptance-results.json"), `${JSON.stringify(result, null, 2)}\n`);
  console.log(JSON.stringify({
    milestones,
    statuses: Object.fromEntries(Object.entries(scenarios).map(([id, value]) => [id, value.status])),
  }, null, 2));
} finally {
  await Promise.allSettled([alice.close(), bob.close(), mallory.close()]);
  await deleteAdminApp(adminApp);
}
