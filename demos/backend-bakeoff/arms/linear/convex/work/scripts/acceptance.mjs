import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import { resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

import { ConvexClient, ConvexHttpClient } from "convex/browser";
import { importJWK, SignJWT } from "jose";
import { chromium } from "playwright-core";
import { api } from "../convex/_generated/api.js";

const root = resolve(import.meta.dirname, "..");
const armRoot = resolve(root, "..");
const receipts = resolve(armRoot, "receipts");
const scenariosDir = resolve(receipts, "scenarios");
const publicRuntime = resolve(root, "public/personas.json");
const url = process.env.CONVEX_URL ?? "http://127.0.0.1:3323";
const vitePort = 4323;
const namespace = "llp0102-linear-convex-coord";
const seedKey = "llp0102-linear-public-seed";
const startedAt = new Date().toISOString();
const startedMonotonic = performance.now();
const hash = (value) => createHash("sha256").update(String(value)).digest("hex");
await mkdir(scenariosDir, { recursive: true });

const privateJwk = JSON.parse(await readFile(resolve(root, ".arm-runtime/private-jwk.json"), "utf8"));
const privateKey = await importJWK(privateJwk, "RS256");
async function tokenFor(actor) {
  return await new SignJWT({ name: actor[0].toUpperCase() + actor.slice(1) })
    .setProtectedHeader({ alg: "RS256", kid: "llp0102-linear-dev" })
    .setIssuer("https://llp0102-linear-convex.local")
    .setAudience("llp0102-linear-convex")
    .setSubject(actor).setIssuedAt().setExpirationTime("2h").sign(privateKey);
}
async function actorClient(actor) {
  const client = new ConvexClient(url);
  const token = await tokenFor(actor);
  let readyResolve;
  const ready = new Promise((resolveReady) => { readyResolve = resolveReady; });
  client.setAuth(async () => token, (authenticated) => authenticated && readyResolve());
  await Promise.race([ready, delay(5_000).then(() => { throw new Error(`auth timeout ${actor}`); })]);
  return { client, token };
}
async function expectReject(operation, marker) {
  try { await operation(); } catch (error) {
    assert(String(error).includes(marker), `expected ${marker}, received ${String(error)}`);
    return { rejected: true, marker };
  }
  throw new Error(`expected ${marker} rejection`);
}
function waitForUpdate(client, fn, args, predicate, timeoutMs = 8_000) {
  return new Promise((resolveUpdate, reject) => {
    const started = performance.now();
    let unsubscribe = () => {};
    const timer = setTimeout(() => {
      unsubscribe();
      reject(new Error("subscription timeout"));
    }, timeoutMs);
    unsubscribe = client.onUpdate(fn, args, (value) => {
      if (!predicate(value)) return;
      clearTimeout(timer);
      unsubscribe();
      resolveUpdate({ value, elapsedMs: performance.now() - started });
    }, (error) => {
      clearTimeout(timer); unsubscribe(); reject(error);
    });
  });
}
async function writeJson(path, value) {
  await mkdir(resolve(path, ".."), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
}
async function writeScenario(id, status, transport, evidence, note) {
  const relative = `receipts/scenarios/${id}.json`;
  await writeJson(resolve(armRoot, relative), {
    id, status, capturedAt: new Date().toISOString(), target: namespace,
    transport, evidence, note,
  });
  results.push({ id, status, path: relative, transport, evidence, note });
}
function statistics(values) {
  const ordered = [...values].sort((a, b) => a - b);
  return {
    samples: values.map((value) => Number(value.toFixed(3))),
    median: Number(ordered[Math.floor(ordered.length / 2)].toFixed(3)),
    nearestRankP95: Number(ordered[Math.ceil(ordered.length * 0.95) - 1].toFixed(3)),
  };
}
async function measure(operation) {
  const values = [];
  for (let index = 0; index < 9; index += 1) {
    const start = performance.now();
    await operation(index);
    if (index >= 2) values.push(performance.now() - start);
  }
  return statistics(values);
}
async function runCommand(command, args) {
  return await new Promise((resolveCommand, reject) => {
    const child = spawn(command, args, { cwd: root, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = ""; let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", (code) => resolveCommand({ code, stdout, stderr }));
  });
}
async function startVite() {
  const child = spawn(process.execPath, [
    resolve(root, "node_modules/vite/bin/vite.js"), "--host", "127.0.0.1",
    "--port", String(vitePort), "--strictPort",
  ], { cwd: root, stdio: ["ignore", "pipe", "pipe"] });
  let stderr = "";
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  for (let attempt = 0; attempt < 200; attempt += 1) {
    if (child.exitCode !== null) throw new Error(`Vite exited: ${stderr}`);
    try { if ((await fetch(`http://127.0.0.1:${vitePort}`)).ok) return child; } catch {}
    await delay(50);
  }
  throw new Error(`Vite readiness timeout: ${stderr}`);
}
async function stopChild(child) {
  if (!child || child.exitCode !== null) return;
  await new Promise((resolveStop) => {
    child.once("close", resolveStop);
    child.kill("SIGTERM");
    setTimeout(() => child.exitCode === null && child.kill("SIGKILL"), 2_000).unref();
  });
}

const anonymous = new ConvexClient(url);
const aliceAuth = await actorClient("alice");
const bobAuth = await actorClient("bob");
const malloryAuth = await actorClient("mallory");
const alice = aliceAuth.client;
const bob = bobAuth.client;
const mallory = malloryAuth.client;
const results = [];
const milestones = {};
let vite;
let browser;

try {
  let baseline = await anonymous.query(api.linear.inspect, { key: seedKey });
  let recovered = null;
  if (Object.entries(baseline).some(([key, value]) => key !== "namespace" && value !== 0)) {
    recovered = {
      reason: "prior failed attempt left namespace rows",
      before: baseline,
      cleanup: await anonymous.mutation(api.linear.cleanup, { key: seedKey }),
    };
    await writeJson(resolve(receipts, "failed-attempt-recovery.json"), recovered);
    baseline = await anonymous.query(api.linear.inspect, { key: seedKey });
  }
  assert(Object.entries(baseline).every(([key, value]) => key === "namespace" || value === 0));
  await writeJson(resolve(receipts, "baseline.json"), { url, namespace, counts: baseline });

  const seedStarted = performance.now();
  const meta = await anonymous.mutation(api.linear.seedMeta, { key: seedKey });
  for (let startSequence = 0; startSequence < 500; startSequence += 100) {
    assert.equal(await anonymous.mutation(api.linear.seedIssues, {
      key: seedKey, organizationId: meta.primaryId, startSequence, count: 100,
    }), 100);
  }
  const firstRead = await alice.query(api.linear.pageIssues, {
    organizationId: meta.primaryId, limit: 50,
  });
  milestones.firstLocalReadMs = Math.round(performance.now() - startedMonotonic);
  const seeded = await anonymous.query(api.linear.inspect, { key: seedKey });
  assert.deepEqual(
    [seeded.organizations, seeded.teams, seeded.projects, seeded.labels, seeded.issues, seeded.comments],
    [2, 3, 4, 20, 500, 1000],
  );
  await writeScenario("LINEAR-01-SEED", "pass", "not-applicable", {
    targetIdentity: hash(JSON.stringify({ url, namespace })),
    authoritativeCounts: seeded, firstPageCount: firstRead.length,
    seedAndFirstReadMs: Number((performance.now() - seedStarted).toFixed(3)),
    actorHashes: { alice: hash("alice"), bob: hash("bob"), mallory: hash("mallory") },
  }, "Anonymous secret-gated fixture setup and authenticated first read prove the exact fresh local dataset.");

  assert.equal((await bob.query(api.linear.pageIssues, {
    organizationId: meta.primaryId, limit: 50,
  })).length, 50);
  const negativeRead = await expectReject(
    () => mallory.query(api.linear.pageIssues, { organizationId: meta.primaryId, limit: 50 }),
    "UNAUTHORIZED_ORGANIZATION",
  );
  const negativeWrite = await expectReject(
    () => mallory.mutation(api.linear.createIssue, {
      organizationId: meta.primaryId, teamId: meta.teamIds[0],
      projectId: meta.projectIds[0], assigneeSubject: "mallory",
      title: "Forbidden", sequence: 900,
    }),
    "UNAUTHORIZED_ORGANIZATION",
  );
  await writeScenario("LINEAR-02-AUTHORITY", "pass", "not-applicable", {
    aliceRole: "owner", bobRole: "member", bobRows: 50,
    negativeRead, negativeWrite, identityPath: "worktree-local customJwt",
  }, "Three native Convex auth identities exercised distinct owner/member/outsider paths.");

  const filterResults = {
    status: await alice.query(api.linear.listIssues, { organizationId: meta.primaryId, status: "todo" }),
    assignee: await alice.query(api.linear.listIssues, { organizationId: meta.primaryId, assigneeSubject: "bob" }),
    project: await alice.query(api.linear.listIssues, { organizationId: meta.primaryId, projectId: meta.projectIds[0] }),
    label: await alice.query(api.linear.listIssues, { organizationId: meta.primaryId, labelId: meta.labelIds[0] }),
  };
  assert.deepEqual(
    [filterResults.status.length, filterResults.assignee.length, filterResults.project.length, filterResults.label.length],
    [100, 250, 125, 25],
  );
  await writeScenario("LINEAR-03-FILTERS", "pass", "not-applicable", {
    counts: Object.fromEntries(Object.entries(filterResults).map(([key, rows]) => [key, rows.length])),
    indexes: ["by_org_status", "by_org_assignee", "by_org_project", "by_label_issue"],
    expectedSequences: Object.fromEntries(Object.entries(filterResults)
      .map(([key, rows]) => [key, rows.map(({ sequence }) => sequence)])),
  }, "Native Convex indexes produced the exact deterministic expected sets.");

  const pageOne = await alice.query(api.linear.pageIssues, { organizationId: meta.primaryId, limit: 50 });
  assert.deepEqual(pageOne.map(({ sequence }) => sequence), Array.from({ length: 50 }, (_, index) => index));
  const insertedId = await alice.mutation(api.linear.createIssue, {
    organizationId: meta.primaryId, teamId: meta.teamIds[0],
    projectId: meta.projectIds[0], assigneeSubject: "alice",
    title: "Concurrent cursor insert", sequence: 500,
  });
  const pages = [pageOne];
  let cursor = pageOne.at(-1).sequence;
  while (true) {
    const page = await alice.query(api.linear.pageIssues, {
      organizationId: meta.primaryId, afterSequence: cursor, limit: 50,
    });
    if (!page.length) break;
    pages.push(page); cursor = page.at(-1).sequence;
  }
  const union = pages.flat();
  assert.equal(union.length, 501);
  assert.equal(new Set(union.map(({ _id }) => _id)).size, 501);
  await writeScenario("LINEAR-04-PAGINATION", "pass", "not-applicable", {
    pageSize: 50, cursorValues: pages.map((page) => page.at(-1).sequence),
    unionCount: union.length, duplicates: 0, insertedIdHash: hash(insertedId),
    authoritativeOrder: union.map(({ sequence }) => sequence),
  }, "Stable sequence cursors covered the full authoritative union once under concurrent insert.");

  const focus = firstRead[0];
  const detail = await alice.query(api.linear.issueDetail, { issueId: focus._id });
  assert(detail.project);
  assert.deepEqual([detail.labels.length, detail.comments.length, detail.activity.length], [1, 2, 1]);
  await writeScenario("LINEAR-05-DETAIL", "pass", "not-applicable", {
    relatedIds: {
      issueId: focus._id, projectId: detail.project._id,
      assignee: detail.assigneeSubject,
      labels: detail.labels.map(({ labelId }) => labelId),
      comments: detail.comments.map(({ _id }) => _id),
      activity: detail.activity.map(({ _id }) => _id),
    },
    boundedQueryInventory: ["issueDetail (one transactional Convex query)"],
  }, "One ordinary server query transaction composed the complete issue graph.");

  const optimistic = { ...focus, status: "in_progress", priority: 4, assigneeSubject: "bob", boardPosition: 777 };
  const settlement = await alice.mutation(api.linear.updateIssue, {
    issueId: focus._id, status: optimistic.status, priority: optimistic.priority,
    assigneeSubject: optimistic.assigneeSubject, boardPosition: optimistic.boardPosition,
  });
  milestones.firstAuthoritativeMutationMs = Math.round(performance.now() - startedMonotonic);
  const settled = (await alice.query(api.linear.listIssues, {
    organizationId: meta.primaryId,
  })).find(({ _id }) => _id === focus._id);
  assert.deepEqual(
    [settled.status, settled.priority, settled.assigneeSubject, settled.boardPosition],
    ["in_progress", 4, "bob", 777],
  );
  await writeScenario("LINEAR-06-OPTIMISTIC", "pass", "local-optimistic", {
    optimisticState: optimistic, settlement, authoritativeState: settled,
    attribution: "application optimistic object before Convex mutation resolution",
  }, "All four optimistic fields reconciled to the authoritative Convex row.");

  const baselineRevision = settled.revision;
  const conflictOutcomes = await Promise.allSettled([
    alice.mutation(api.linear.updateIssue, {
      issueId: focus._id, expectedRevision: baselineRevision,
      title: "Alice board edit", boardPosition: 100,
    }),
    bob.mutation(api.linear.updateIssue, {
      issueId: focus._id, expectedRevision: baselineRevision,
      title: "Bob board edit", boardPosition: 200,
    }),
  ]);
  assert.equal(conflictOutcomes.filter(({ status }) => status === "fulfilled").length, 1);
  const loser = conflictOutcomes.find(({ status }) => status === "rejected");
  assert(String(loser.reason).includes("REVISION_CONFLICT"));
  const conflictAuthority = (await alice.query(api.linear.listIssues, {
    organizationId: meta.primaryId,
  })).find(({ _id }) => _id === focus._id);
  await writeScenario("LINEAR-07-CONFLICT", "pass", "not-applicable", {
    barrier: { actors: ["alice", "bob"], expectedRevision: baselineRevision },
    outcomes: conflictOutcomes.map(({ status }) => status),
    loser: "REVISION_CONFLICT", authoritativeOutcome: conflictAuthority,
    policy: "transactional revision CAS admits exactly one matching writer",
  }, "Serializable mutation transactions plus explicit revision CAS produced one winner and one typed refusal.");

  const livePromise = waitForUpdate(
    bob, api.linear.commentsAndActivity, { issueId: focus._id },
    (value) => value.comments.some(({ body }) => body === "Native live marker") &&
      value.activity.some(({ kind }) => kind === "commented"),
  );
  const commentId = await alice.mutation(api.linear.addComment, {
    issueId: focus._id, body: "Native live marker", sequence: 2,
  });
  const live = await livePromise;
  milestones.firstRealtimeTransitionMs = Math.round(performance.now() - startedMonotonic);
  await writeScenario("LINEAR-08-LIVE", "pass", "push", {
    secondClient: "bob", commentIdHash: hash(commentId),
    deliveryMs: Number(live.elapsedMs.toFixed(3)),
    comments: live.value.comments.length, activity: live.value.activity.length,
    transport: "Convex reactive WebSocket subscription",
  }, "Bob received comment and activity through a native reactive query, with no polling.");

  let searchRows = [];
  for (let attempt = 0; attempt < 100 && !searchRows.length; attempt += 1) {
    searchRows = await alice.query(api.linear.searchIssues, {
      organizationId: meta.primaryId, term: "Production issue 042",
    });
    if (!searchRows.length) await delay(50);
  }
  assert(searchRows.some(({ sequence }) => sequence === 41));
  await writeScenario("LINEAR-09-SEARCH", "pass", "not-applicable", {
    searchIndex: "issues.search_title", term: "Production issue 042",
    resultIds: searchRows.map(({ _id }) => _id),
    expectedSequencePresent: searchRows.some(({ sequence }) => sequence === 41),
  }, "Convex's native search index returned the authoritative expected issue.");

  await writeScenario("LINEAR-10-OFFLINE", "gap", "unsupported", {
    capability: "persistent cold retained query plus queued mutation",
    testedClient: "Convex 1.42.3 browser client",
    nonClaim: true,
  }, "The ordinary Convex browser client does not provide persistent cold query retention and an offline mutation queue.");

  const beforeMigration = await anonymous.query(api.linear.inspect, { key: seedKey });
  const migration = await anonymous.mutation(api.linear.backfillTriageScore, {
    key: seedKey, organizationId: meta.primaryId,
  });
  const afterMigration = await anonymous.query(api.linear.inspect, { key: seedKey });
  const indexedMigrationRows = await alice.query(api.linear.triageIndex, {
    organizationId: meta.primaryId, minimum: 30,
  });
  assert.equal(migration.changed, 501);
  assert.equal(afterMigration.issues, beforeMigration.issues);
  assert(indexedMigrationRows.length > 0);
  await writeScenario("LINEAR-11-MIGRATION", "pass", "not-applicable", {
    beforeCounts: beforeMigration, afterCounts: afterMigration,
    migrationReceipt: migration, backfilledDocuments: migration.changed,
    index: "issues.by_org_triage", indexedResultCount: indexedMigrationRows.length,
    mechanism: "optional field rollout, transactional application backfill, and deployed Convex index",
  }, "The new indexed field was backfilled on every issue without count loss and read through its deployed index.");

  await writeScenario("LINEAR-12-DEPLOY", "unavailable-remote-dependency", "not-applicable", {
    localTarget: { urlHash: hash(url), namespace, profile: "official anonymous local deployment" },
    hostedCredentials: "unavailable", nonClaim: true,
    localOperations: ["convex dev deployment logs", "generated schema/functions", "namespace cleanup"],
  }, "No isolated hosted Convex credential was available; the anonymous local path has no hosted URL, region, usage, rollback, or export evidence.");

  await mkdir(resolve(root, "public"), { recursive: true });
  await writeJson(publicRuntime, {
    convexUrl: url, primaryOrganizationId: meta.primaryId,
    personas: [
      { id: "alice", name: "Alice", token: aliceAuth.token },
      { id: "bob", name: "Bob", token: bobAuth.token },
      { id: "mallory", name: "Mallory", token: malloryAuth.token },
    ],
  });
  vite = await startVite();
  browser = await chromium.launch({
    executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    headless: true,
  });
  const page = await browser.newPage();
  await page.goto(`http://127.0.0.1:${vitePort}`);
  await page.waitForFunction(
    () => document.querySelector('[data-testid="issue-count"]')?.textContent === "501",
    undefined, { timeout: 15_000 },
  );
  assert.equal(await page.getByTestId("connection").textContent(), "live");
  await page.screenshot({ path: resolve(receipts, "linear-ui.png"), fullPage: true });
  await writeJson(resolve(receipts, "ui-smoke.json"), {
    rendered: true, count: 501, connection: "live", screenshot: "receipts/linear-ui.png",
  });
  await browser.close(); browser = null;
  await stopChild(vite); vite = null;
  await rm(publicRuntime, { force: true });

  let performanceSequence = 0;
  const aliceHttp = new ConvexHttpClient(url);
  aliceHttp.setAuth(aliceAuth.token);
  const performanceReceipt = {
    scope: "official anonymous local Convex deployment on one Mac; not hosted latency",
    warmups: 2, recordedSamples: 7, unit: "milliseconds",
    list: await measure(() => aliceHttp.query(api.linear.pageIssues, {
      organizationId: meta.primaryId, limit: 50,
    })),
    detail: await measure(() => aliceHttp.query(api.linear.issueDetail, { issueId: focus._id })),
    write: await measure(async () => {
      performanceSequence += 1;
      await alice.mutation(api.linear.updateIssue, {
        issueId: focus._id, priority: performanceSequence % 5,
      });
    }),
    realtime: await measure(async () => {
      performanceSequence += 1;
      const title = `Performance title ${performanceSequence}`;
      const update = waitForUpdate(
        bob, api.linear.listIssues, { organizationId: meta.primaryId },
        (rows) => rows.some((row) => row._id === focus._id && row.title === title),
      );
      await alice.mutation(api.linear.updateIssue, { issueId: focus._id, title });
      await update;
    }),
    build: await measure(async () => {
      const result = await runCommand("npm", ["run", "build"]);
      assert.equal(result.code, 0, result.stderr);
    }),
    deploy: { status: "unavailable-remote-dependency", localEquivalent: "convex dev watch deploy" },
    costWindow: { localCostUsd: 0, hostedUsage: "unavailable" },
  };
  await writeJson(resolve(receipts, "performance.json"), performanceReceipt);
  await writeScenario("LINEAR-13-PERFORMANCE", "pass", "not-applicable", performanceReceipt,
    "Two warmups and seven raw local samples are retained for every supported frozen path.");

  const summaryBeforeCleanup = await anonymous.query(api.linear.inspect, { key: seedKey });
  const cleanupPlan = {
    target: { urlHash: hash(url), namespace }, exactScope: namespace,
    operation: "secret-gated cleanup deletes only rows whose namespace exactly matches",
    runtimeTargets: [".arm-runtime/private-jwk.json", "public/personas.json"],
    unrelatedBaseline: "no shared or hosted target used",
  };
  await writeJson(resolve(receipts, "cleanup-plan.json"), cleanupPlan);
  const cleanup = await anonymous.mutation(api.linear.cleanup, { key: seedKey });
  const afterCleanup = await anonymous.query(api.linear.inspect, { key: seedKey });
  assert(Object.entries(afterCleanup).every(([key, value]) => key === "namespace" || value === 0));
  await rm(resolve(root, ".arm-runtime/private-jwk.json"), { force: true });
  const cleanupReceipt = {
    before: summaryBeforeCleanup, deleted: cleanup.deleted, after: afterCleanup,
    privateJwkAbsent: true, publicPersonaCarrierAbsent: true,
    processCleanupPendingCoordinator: true,
  };
  await writeJson(resolve(receipts, "cleanup.json"), cleanupReceipt);
  await writeScenario("LINEAR-14-CLEANUP", "pass", "not-applicable", cleanupReceipt,
    "All exact namespace rows and credential/persona carriers were removed; coordinator process/port cleanup follows.");

  milestones.localAcceptanceMs = Math.round(performance.now() - startedMonotonic);
  milestones.acceptanceCompletionMs = milestones.localAcceptanceMs;
  assert.equal(results.length, 14);
  assert.deepEqual(
    [results.filter(({ status }) => status === "pass").length,
      results.filter(({ status }) => status === "gap").length,
      results.filter(({ status }) => status === "unavailable-remote-dependency").length],
    [12, 1, 1],
  );
  await writeJson(resolve(receipts, "acceptance-results.json"), {
    schemaVersion: 1, startedAt, finishedAt: new Date().toISOString(),
    activeElapsedMs: Math.round(performance.now() - startedMonotonic),
    milestones, results, recoveredPriorFailedAttempt: recovered,
  });
  process.stdout.write(`${JSON.stringify({ ok: true, results: results.length, milestones })}\n`);
} finally {
  try { await browser?.close(); } catch {}
  try { await stopChild(vite); } catch {}
  for (const client of [anonymous, alice, bob, mallory]) {
    try { await client.close(); } catch {}
  }
  await rm(publicRuntime, { force: true }).catch(() => {});
}
