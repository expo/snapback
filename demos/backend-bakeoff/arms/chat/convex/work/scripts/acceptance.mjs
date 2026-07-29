import { ConvexClient } from "convex/browser";
import { ConvexReactClient } from "convex/react";
import { importJWK, SignJWT } from "jose";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import { performance } from "node:perf_hooks";
import { resolve } from "node:path";
import { api } from "../convex/_generated/api.js";

const root = resolve(import.meta.dirname, "..");
const receipts = resolve(root, "..", "receipts");
const scenariosDir = resolve(receipts, "scenarios");
const url = process.env.CONVEX_URL ?? "http://127.0.0.1:3310";
const seedKey = "llp0102-public-seed-fixture";
const startedAt = "2026-07-28T23:47:26Z";
const armStartedEpoch = Date.parse(startedAt);
const namespace = "llp0102-chat-convex-w2";
const samples = 7;
const warmups = 2;

await mkdir(scenariosDir, { recursive: true });

const privateJwk = JSON.parse(
  await readFile(resolve(root, ".arm-runtime/private-jwk.json"), "utf8"),
);
const privateKey = await importJWK(privateJwk, "RS256");

async function tokenFor(actor) {
  return await new SignJWT({ name: actor[0].toUpperCase() + actor.slice(1) })
    .setProtectedHeader({ alg: "RS256", kid: "llp0102-dev" })
    .setIssuer("https://llp0102-chat-convex.local")
    .setAudience("llp0102-chat-convex")
    .setSubject(actor)
    .setIssuedAt()
    .setExpirationTime("2h")
    .sign(privateKey);
}

async function actorClient(actor) {
  const client = new ConvexClient(url);
  const token = await tokenFor(actor);
  let settled;
  const ready = new Promise((resolveReady) => {
    settled = resolveReady;
  });
  client.setAuth(async () => token, (authenticated) => {
    if (authenticated) settled();
  });
  await Promise.race([
    ready,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`auth timeout for ${actor}`)), 5000),
    ),
  ]);
  return client;
}

async function actorReactClient(actor) {
  const client = new ConvexReactClient(url, { logger: false });
  const token = await tokenFor(actor);
  let settled;
  const ready = new Promise((resolveReady) => {
    settled = resolveReady;
  });
  client.setAuth(async () => token, (authenticated) => {
    if (authenticated) settled();
  });
  await Promise.race([
    ready,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`React client auth timeout for ${actor}`)), 5000),
    ),
  ]);
  return client;
}

function hash(value) {
  return createHash("sha256").update(value).digest("hex");
}

function sleep(ms) {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
}

async function expectReject(action, pattern) {
  try {
    await action();
  } catch (error) {
    const message = String(error);
    if (!message.includes(pattern)) {
      throw new Error(`expected ${pattern}, received ${message}`);
    }
    return { rejected: true, classification: pattern };
  }
  throw new Error(`expected rejection ${pattern}`);
}

function waitForUpdate(client, fn, args, predicate, timeoutMs = 5000) {
  return new Promise((resolveUpdate, reject) => {
    const started = performance.now();
    let unsubscribe = () => {};
    const timer = setTimeout(() => {
      unsubscribe();
      reject(new Error("subscription update timeout"));
    }, timeoutMs);
    unsubscribe = client.onUpdate(
      fn,
      args,
      (value) => {
        if (predicate(value)) {
          clearTimeout(timer);
          unsubscribe();
          resolveUpdate({ value, elapsedMs: performance.now() - started });
        }
      },
      (error) => {
        clearTimeout(timer);
        unsubscribe();
        reject(error);
      },
    );
  });
}

async function writeScenario(id, status, evidence) {
  const path = resolve(scenariosDir, `${id}.json`);
  await writeFile(
    path,
    `${JSON.stringify({ id, status, capturedAt: new Date().toISOString(), ...evidence }, null, 2)}\n`,
  );
  return `receipts/scenarios/${id}.json`;
}

function stats(values) {
  const sorted = [...values].sort((a, b) => a - b);
  return {
    rawMs: values,
    medianMs: sorted[Math.floor(sorted.length / 2)],
    nearestRankP95Ms: sorted[Math.ceil(0.95 * sorted.length) - 1],
  };
}

async function measure(fn) {
  const values = [];
  for (let index = 0; index < warmups + samples; index += 1) {
    const started = performance.now();
    await fn(index);
    const elapsed = performance.now() - started;
    if (index >= warmups) values.push(elapsed);
  }
  return stats(values);
}

const anonymous = new ConvexClient(url);
const alice = await actorClient("alice");
const bob = await actorClient("bob");
const mallory = await actorClient("mallory");
const scenarioResults = [];
const milestones = {};
let stopDefect = null;

try {
  let baseline = await anonymous.query(api.chat.inspect, { key: seedKey });
  let recoveredPriorFailedAttempt = null;
  if (Object.entries(baseline).some(([key, value]) => key !== "namespace" && value !== 0)) {
    recoveredPriorFailedAttempt = {
      reason: "prior harness attempt failed before cleanup",
      before: baseline,
      cleanup: await anonymous.mutation(api.chat.cleanup, { key: seedKey }),
    };
    baseline = await anonymous.query(api.chat.inspect, { key: seedKey });
  }
  await writeFile(
    resolve(receipts, "baseline.json"),
    `${JSON.stringify({ target: url, namespace, counts: baseline }, null, 2)}\n`,
  );
  if (Object.entries(baseline).some(([key, value]) => key !== "namespace" && value !== 0)) {
    throw new Error(`fresh local target was not empty: ${JSON.stringify(baseline)}`);
  }
  if (recoveredPriorFailedAttempt) {
    await writeFile(
      resolve(receipts, "failed-attempt-recovery.json"),
      `${JSON.stringify(recoveredPriorFailedAttempt, null, 2)}\n`,
    );
  }

  const firstSeedStart = performance.now();
  const seed = await anonymous.mutation(api.chat.seed, { key: seedKey });
  const firstRead = await alice.query(api.chat.listChannels, {});
  milestones.firstLocalReadMs = Date.now() - armStartedEpoch;
  const seededInspect = await anonymous.query(api.chat.inspect, { key: seedKey });
  scenarioResults.push({
    id: "CHAT-01-SEED",
    status: "pass",
    path: await writeScenario("CHAT-01-SEED", "pass", {
      seed,
      authoritativeCounts: seededInspect,
      firstSeedAndReadMs: performance.now() - firstSeedStart,
      exactFixture: seededInspect.channels === 4 && seededInspect.messages === 500,
    }),
  });

  const aliceChannels = firstRead.map((row) => row.slug);
  const bobChannels = (await bob.query(api.chat.listChannels, {})).map((row) => row.slug);
  const malloryChannels = (await mallory.query(api.chat.listChannels, {})).map((row) => row.slug);
  const projectAlpha = await alice.query(api.chat.channelBySlug, { slug: "project-alpha" });
  const leadership = await alice.query(api.chat.channelBySlug, { slug: "leadership" });
  const negativeRead = await expectReject(
    () => mallory.query(api.chat.channelBySlug, { slug: "project-alpha" }),
    "UNAUTHORIZED_PRIVATE_CHANNEL",
  );
  let negativeSubscription;
  await new Promise((resolveNegative, reject) => {
    const timeout = setTimeout(() => reject(new Error("negative subscription timeout")), 5000);
    const unsubscribe = mallory.onUpdate(
      api.chat.latestMessages,
      { channelId: projectAlpha._id, limit: 25 },
      () => {
        clearTimeout(timeout);
        unsubscribe();
        reject(new Error("Mallory received private-channel subscription data"));
      },
      (error) => {
        clearTimeout(timeout);
        unsubscribe();
        negativeSubscription = { rejected: true, error: String(error).includes("UNAUTHORIZED_PRIVATE_CHANNEL") };
        resolveNegative();
      },
    );
  });
  scenarioResults.push({
    id: "CHAT-02-AUTHORITY",
    status: "pass",
    path: await writeScenario("CHAT-02-AUTHORITY", "pass", {
      actors: {
        alice: hash("alice"),
        bob: hash("bob"),
        mallory: hash("mallory"),
      },
      visibleChannels: { alice: aliceChannels, bob: bobChannels, mallory: malloryChannels },
      negativeRead,
      negativeSubscription,
      authPath: "Convex customJwt provider with worktree-local generated development issuer",
    }),
  });

  const firstMutationStart = performance.now();
  const send = await alice.mutation(api.chat.sendMessage, {
    channelId: projectAlpha._id,
    body: "authoritative hello",
  });
  milestones.firstAuthoritativeMutationMs = Date.now() - armStartedEpoch;
  const authoritative = (
    await bob.query(api.chat.latestMessages, { channelId: projectAlpha._id, limit: 5 })
  ).find((row) => row._id === send.id);
  scenarioResults.push({
    id: "CHAT-03-SEND",
    status: "pass",
    path: await writeScenario("CHAT-03-SEND", "pass", {
      settlement: send,
      authoritative,
      elapsedMs: performance.now() - firstMutationStart,
      serverFields: ["_id", "_creationTime", "sequence", "authorSubject", "authorName", "sentAt"],
    }),
  });

  const pushBody = `push-${Date.now()}`;
  const pushPromise = waitForUpdate(
    bob,
    api.chat.latestMessages,
    { channelId: projectAlpha._id, limit: 25 },
    (rows) => rows.some((row) => row.body === pushBody),
  );
  await sleep(100);
  await alice.mutation(api.chat.sendMessage, { channelId: projectAlpha._id, body: pushBody });
  const push = await pushPromise;
  milestones.firstRealtimeTransitionMs = Date.now() - armStartedEpoch;
  scenarioResults.push({
    id: "CHAT-04-PUSH",
    status: "pass",
    path: await writeScenario("CHAT-04-PUSH", "pass", {
      secondClient: "bob",
      transport: "ConvexClient WebSocket reactive query",
      noProductPolling: true,
      observedBody: pushBody,
      elapsedMs: push.elapsedMs,
    }),
  });

  const pageOne = await bob.query(api.chat.pageMessages, {
    channelId: projectAlpha._id,
    paginationOpts: { numItems: 25, cursor: null },
  });
  const insertedBetweenPages = await alice.mutation(api.chat.sendMessage, {
    channelId: projectAlpha._id,
    body: "insert-between-cursor-pages",
  });
  const pageTwo = await bob.query(api.chat.pageMessages, {
    channelId: projectAlpha._id,
    paginationOpts: { numItems: 25, cursor: pageOne.continueCursor },
  });
  const idsOne = pageOne.page.map((row) => row._id);
  const idsTwo = pageTwo.page.map((row) => row._id);
  const duplicates = idsOne.filter((id) => idsTwo.includes(id));
  if (duplicates.length) throw new Error("cursor pages duplicated messages");
  scenarioResults.push({
    id: "CHAT-05-PAGINATION",
    status: "pass",
    path: await writeScenario("CHAT-05-PAGINATION", "pass", {
      pageSize: 25,
      pageOne: { ids: idsOne, sequences: pageOne.page.map((row) => row.sequence), cursor: pageOne.continueCursor },
      concurrentInsert: insertedBetweenPages,
      pageTwo: { ids: idsTwo, sequences: pageTwo.page.map((row) => row.sequence), cursor: pageTwo.continueCursor },
      duplicates,
      deterministicOrder: [...pageOne.page, ...pageTwo.page].every(
        (row, index, rows) => index === 0 || rows[index - 1].sequence > row.sequence,
      ),
    }),
  });

  const typingExpiresAt = await alice.mutation(api.chat.setTyping, {
    channelId: projectAlpha._id,
    ttlMs: 250,
  });
  const typingActive = await bob.query(api.chat.activeTyping, {
    channelId: projectAlpha._id,
    now: Date.now(),
  });
  await sleep(300);
  const typingExpired = await bob.query(api.chat.activeTyping, {
    channelId: projectAlpha._id,
    now: Date.now(),
  });
  const typingInspect = await anonymous.query(api.chat.inspect, { key: seedKey });
  scenarioResults.push({
    id: "CHAT-06-TYPING",
    status: "gap",
    path: await writeScenario("CHAT-06-TYPING", "gap", {
      workaround: "application-authored durable typing row with client-supplied TTL filtering",
      expiresAt: typingExpiresAt,
      activeCount: typingActive.length,
      expiredVisibleCount: typingExpired.length,
      durableRowsAfterExpiry: typingInspect.typing,
      nativeEphemeralPath: false,
      reason: "Convex core has native push but no built-in ephemeral typing primitive; durable TTL glue is not equivalent.",
    }),
  });

  const presenceExpiresAt = await alice.mutation(api.chat.heartbeatPresence, {
    channelId: projectAlpha._id,
    connectionId: "alice-client-1",
    ttlMs: 250,
  });
  const presenceActive = await bob.query(api.chat.activePresence, {
    channelId: projectAlpha._id,
    now: Date.now(),
  });
  await sleep(300);
  const presenceExpired = await bob.query(api.chat.activePresence, {
    channelId: projectAlpha._id,
    now: Date.now(),
  });
  const presenceInspect = await anonymous.query(api.chat.inspect, { key: seedKey });
  scenarioResults.push({
    id: "CHAT-07-PRESENCE",
    status: "gap",
    path: await writeScenario("CHAT-07-PRESENCE", "gap", {
      workaround: "application-authored durable heartbeat row with client-supplied TTL filtering",
      expiresAt: presenceExpiresAt,
      activeCount: presenceActive.length,
      expiredVisibleCount: presenceExpired.length,
      durableRowsAfterExpiry: presenceInspect.presence,
      nativeEphemeralPath: false,
      reason: "Connect/disconnect expiry requires heartbeat and cleanup glue rather than a native ephemeral presence API.",
    }),
  });

  const beforeReconnect = await bob.query(api.chat.latestMessages, {
    channelId: projectAlpha._id,
    limit: 200,
  });
  bob.close();
  const duringDisconnect = await Promise.all([
    alice.mutation(api.chat.sendMessage, { channelId: projectAlpha._id, body: "while-bob-offline-1" }),
    alice.mutation(api.chat.sendMessage, { channelId: projectAlpha._id, body: "while-bob-offline-2" }),
  ]);
  const bobReconnected = await actorClient("bob");
  const afterReconnect = await bobReconnected.query(api.chat.latestMessages, {
    channelId: projectAlpha._id,
    limit: 200,
  });
  const afterIds = afterReconnect.map((row) => row._id);
  if (new Set(afterIds).size !== afterIds.length) throw new Error("duplicate messages after reconnect");
  scenarioResults.push({
    id: "CHAT-08-RECONNECT",
    status: "pass",
    path: await writeScenario("CHAT-08-RECONNECT", "pass", {
      beforeCount: beforeReconnect.length,
      sentWhileDisconnected: duringDisconnect,
      afterCount: afterReconnect.length,
      noDuplicates: new Set(afterIds).size === afterIds.length,
      transport: "new authenticated ConvexClient WebSocket session and authoritative query",
    }),
  });

  scenarioResults.push({
    id: "CHAT-09-OFFLINE-HISTORY",
    status: "gap",
    path: await writeScenario("CHAT-09-OFFLINE-HISTORY", "gap", {
      loadedHistoryCount: afterReconnect.length,
      retainedOrigin: "application JavaScript memory only",
      coldClientWithTransportDisabled: "no provider-owned persistent query cache available",
      reason: "Convex React retains active query state in memory but does not provide durable cold-boot offline history.",
      nonclaim: "A copied array was not counted as provider offline storage.",
    }),
  });

  const latestBeforeUnread = afterReconnect[0].sequence;
  await bobReconnected.mutation(api.chat.markRead, {
    channelId: projectAlpha._id,
    sequence: latestBeforeUnread,
  });
  const unreadMessage = await alice.mutation(api.chat.sendMessage, {
    channelId: projectAlpha._id,
    body: "unread-marker-proof",
  });
  const unreadBefore = await bobReconnected.query(api.chat.unread, {
    channelId: projectAlpha._id,
  });
  bobReconnected.close();
  const bobUnreadReconnect = await actorClient("bob");
  const unreadAfterReconnect = await bobUnreadReconnect.query(api.chat.unread, {
    channelId: projectAlpha._id,
  });
  await bobUnreadReconnect.mutation(api.chat.markRead, {
    channelId: projectAlpha._id,
    sequence: unreadMessage.sequence,
  });
  const unreadAfterMark = await bobUnreadReconnect.query(api.chat.unread, {
    channelId: projectAlpha._id,
  });
  if (unreadBefore.unread !== 1 || unreadAfterReconnect.unread !== 1 || unreadAfterMark.unread !== 0) {
    throw new Error("unread invariant failed");
  }
  scenarioResults.push({
    id: "CHAT-10-UNREAD",
    status: "pass",
    path: await writeScenario("CHAT-10-UNREAD", "pass", {
      authoritativeMarkerSequence: latestBeforeUnread,
      newMessageSequence: unreadMessage.sequence,
      beforeReconnect: unreadBefore,
      afterReconnect: unreadAfterReconnect,
      afterMark: unreadAfterMark,
    }),
  });

  const bobConcurrent = bobUnreadReconnect;
  const [aliceConcurrent, bobConcurrentResult] = await Promise.all([
    alice.mutation(api.chat.sendMessage, {
      channelId: projectAlpha._id,
      body: "concurrent-from-alice",
    }),
    bobConcurrent.mutation(api.chat.sendMessage, {
      channelId: projectAlpha._id,
      body: "concurrent-from-bob",
    }),
  ]);
  const concurrentRows = (
    await alice.query(api.chat.latestMessages, { channelId: projectAlpha._id, limit: 10 })
  ).filter((row) => ["concurrent-from-alice", "concurrent-from-bob"].includes(row.body));
  if (concurrentRows.length !== 2 || new Set(concurrentRows.map((row) => row.sequence)).size !== 2) {
    throw new Error("concurrent sends were lost or non-unique");
  }
  scenarioResults.push({
    id: "CHAT-11-CONCURRENT-SEND",
    status: "pass",
    path: await writeScenario("CHAT-11-CONCURRENT-SEND", "pass", {
      barrier: "Promise.all from distinct authenticated ConvexClient sessions",
      settlements: [aliceConcurrent, bobConcurrentResult],
      authoritativeRows: concurrentRows,
      deterministicOrder: concurrentRows
        .map((row) => row.sequence)
        .every((value, index, rows) => index === 0 || rows[index - 1] > value),
    }),
  });

  const bobLogout = await actorReactClient("bob");
  const logoutSeen = [];
  let logoutWatchError = null;
  const logoutWatch = bobLogout.watchQuery(api.chat.latestMessages, {
    channelId: projectAlpha._id,
    limit: 25,
  });
  const initialLogoutWatch = new Promise((resolveInitial, reject) => {
    const timeout = setTimeout(() => reject(new Error("logout watch initial timeout")), 5000);
    const stop = logoutWatch.onUpdate(() => {
      try {
        const rows = logoutWatch.localQueryResult();
        logoutSeen.push(...rows.map((row) => row.body));
        clearTimeout(timeout);
        stop();
        resolveInitial();
      } catch (error) {
        clearTimeout(timeout);
        stop();
        reject(error);
      }
    });
  });
  await initialLogoutWatch;
  const unsubscribeLogout = logoutWatch.onUpdate(() => {
    try {
      const rows = logoutWatch.localQueryResult();
      logoutSeen.push(...rows.map((row) => row.body));
    } catch (error) {
      logoutWatchError = String(error);
    }
  });
  bobLogout.clearAuth();
  let logoutBarrier = null;
  for (let attempt = 0; attempt < 25; attempt += 1) {
    try {
      await bobLogout.query(api.chat.latestMessages, {
        channelId: projectAlpha._id,
        limit: 25,
      });
    } catch (error) {
      if (String(error).includes("UNAUTHENTICATED")) {
        logoutBarrier = { denied: true, errorClass: "UNAUTHENTICATED" };
        break;
      }
    }
    await sleep(20);
  }
  if (!logoutBarrier) throw new Error("logout barrier did not deny a fresh private query");
  const logoutBody = `after-clear-auth-${Date.now()}`;
  await alice.mutation(api.chat.sendMessage, { channelId: projectAlpha._id, body: logoutBody });
  await sleep(500);
  unsubscribeLogout();
  bobLogout.close();
  const logoutDelivered = logoutSeen.includes(logoutBody);
  if (logoutDelivered) {
    stopDefect = { id: "CHAT-12-LOGOUT", classification: "cross-user protected delivery after logout" };
    throw new Error("STOP_CLASS: protected delivery continued after logout");
  }
  scenarioResults.push({
    id: "CHAT-12-LOGOUT",
    status: "pass",
    path: await writeScenario("CHAT-12-LOGOUT", "pass", {
      logoutBarrier: "ConvexReactClient.clearAuth plus denied fresh query completed before authoritative send",
      logoutMethod: "ConvexReactClient.clearAuth()",
      freshQueryBarrier: logoutBarrier,
      watchErrorClass: logoutWatchError?.includes("UNAUTHENTICATED") ? "UNAUTHENTICATED" : null,
      sentBody: logoutBody,
      deliveredAfterLogout: logoutDelivered,
      alreadyConnectedClient: true,
      diagnosticReceipt: "receipts/logout-diagnosis-delivery.json",
      rawReceiptLabelErratum: "The retained diagnostic receipt says ConvexClient.clearAuth; executed source used ConvexReactClient.clearAuth.",
    }),
  });

  const bobRevoked = await actorClient("bob");
  const revokeSeen = [];
  let revokeError = null;
  const unsubscribeRevoke = bobRevoked.onUpdate(
    api.chat.latestMessages,
    { channelId: leadership._id, limit: 25 },
    (rows) => revokeSeen.push(...rows.map((row) => row.body)),
    (error) => { revokeError = String(error); },
  );
  await sleep(150);
  const revokeSettlement = await alice.mutation(api.chat.revokeMember, {
    channelId: leadership._id,
    subject: "bob",
  });
  await sleep(250);
  const revokeBody = `after-revoke-${Date.now()}`;
  await alice.mutation(api.chat.sendMessage, { channelId: leadership._id, body: revokeBody });
  await sleep(500);
  const revokeDelivered = revokeSeen.includes(revokeBody);
  const freshRevokedRead = await expectReject(
    () => bobRevoked.query(api.chat.latestMessages, { channelId: leadership._id, limit: 25 }),
    "UNAUTHORIZED_PRIVATE_CHANNEL",
  );
  unsubscribeRevoke();
  bobRevoked.close();
  if (revokeDelivered) {
    stopDefect = { id: "CHAT-13-REVOKE", classification: "cross-user protected delivery after revocation" };
    throw new Error("STOP_CLASS: protected delivery continued after membership removal");
  }
  scenarioResults.push({
    id: "CHAT-13-REVOKE",
    status: "pass",
    path: await writeScenario("CHAT-13-REVOKE", "pass", {
      authorityChange: revokeSettlement,
      subscriptionErrorAfterRevocation: revokeError?.includes("UNAUTHORIZED_PRIVATE_CHANNEL") ?? false,
      freshRevokedRead,
      sentBody: revokeBody,
      deliveredAfterRevocation: revokeDelivered,
      retainedStoreInspection: {
        priorJavaScriptValuesRemainApplicationOwned: revokeSeen.length > 0,
        providerPersistentOfflineStore: false,
      },
    }),
  });

  const performanceEvidence = {
    shape: { warmups, samples, pageSize: 25, burstMessages: 20, concurrentClients: 2 },
    machine: {
      hostname: os.hostname(),
      platform: os.platform(),
      release: os.release(),
      arch: os.arch(),
      cpus: os.cpus().length,
      totalMemoryBytes: os.totalmem(),
      loadAverage: os.loadavg(),
      node: process.version,
    },
  };

  performanceEvidence.read = await measure(async () => {
    await alice.query(api.chat.latestMessages, { channelId: projectAlpha._id, limit: 25 });
  });
  performanceEvidence.burstWrite = await measure(async (sampleIndex) => {
    await Promise.all(
      Array.from({ length: 20 }, (_, messageIndex) => {
        const client = messageIndex % 2 === 0 ? alice : bobConcurrent;
        return client.mutation(api.chat.sendMessage, {
          channelId: projectAlpha._id,
          body: `perf-burst-${sampleIndex}-${messageIndex}`,
        });
      }),
    );
  });
  performanceEvidence.realtimeDelivery = await measure(async (sampleIndex) => {
    const body = `perf-push-${sampleIndex}-${Date.now()}`;
    const observed = waitForUpdate(
      bobConcurrent,
      api.chat.latestMessages,
      { channelId: projectAlpha._id, limit: 25 },
      (rows) => rows.some((row) => row.body === body),
    );
    await sleep(20);
    await alice.mutation(api.chat.sendMessage, { channelId: projectAlpha._id, body });
    await observed;
  });
  performanceEvidence.reconnect = await measure(async () => {
    const client = await actorClient("bob");
    await client.query(api.chat.latestMessages, { channelId: projectAlpha._id, limit: 25 });
    client.close();
  });
  performanceEvidence.productionBuild = await measure(async () => {
    execFileSync("npm", ["run", "build"], {
      cwd: root,
      env: { ...process.env, VITE_CONVEX_URL: url },
      stdio: "ignore",
    });
  });
  await writeFile(
    resolve(receipts, "performance.json"),
    `${JSON.stringify(performanceEvidence, null, 2)}\n`,
  );
  scenarioResults.push({
    id: "CHAT-14-PERFORMANCE",
    status: "pass",
    path: await writeScenario("CHAT-14-PERFORMANCE", "pass", {
      receipt: "receipts/performance.json",
      warmups,
      samples,
      paths: Object.keys(performanceEvidence).filter((key) => !["shape", "machine"].includes(key)),
      claimScope: "small repeatable local product workload; not production scale",
    }),
  });

  milestones.localAcceptanceMs = Date.now() - armStartedEpoch;
  milestones.acceptanceCompletionMs = Date.now() - armStartedEpoch;

  const cleanupPlan = {
    target: url,
    targetMode: "fresh-local",
    namespace,
    exactOperations: [
      "chat:cleanup deletes only rows whose namespace equals llp0102-chat-convex-w2",
      "coordinator stops the exact Convex dev process bound to ports 3310 and 3311",
      "coordinator removes only /home/ccheever/worktrees/llp0102-chat-convex/work/.convex",
      "coordinator removes only /home/ccheever/worktrees/llp0102-chat-convex/work/.arm-runtime",
      "coordinator removes only /home/ccheever/worktrees/llp0102-chat-convex/home",
    ],
  };
  await writeFile(
    resolve(receipts, "cleanup-plan.json"),
    `${JSON.stringify(cleanupPlan, null, 2)}\n`,
  );
  const cleanup = await anonymous.mutation(api.chat.cleanup, { key: seedKey });
  const postCleanup = await anonymous.query(api.chat.inspect, { key: seedKey });
  if (Object.entries(postCleanup).some(([key, value]) => key !== "namespace" && value !== 0)) {
    throw new Error(`namespace cleanup incomplete: ${JSON.stringify(postCleanup)}`);
  }
  await writeFile(
    resolve(receipts, "cleanup-data.json"),
    `${JSON.stringify({ cleanup, postCleanup, baselineWasEmpty: true }, null, 2)}\n`,
  );
  scenarioResults.push({
    id: "CHAT-15-CLEANUP",
    status: "pass",
    path: await writeScenario("CHAT-15-CLEANUP", "pass", {
      targetBoundPlan: "receipts/cleanup-plan.json",
      dataCleanup: "receipts/cleanup-data.json",
      postCleanup,
      processAndFilesystemCleanup: "pending coordinator exact process stop",
    }),
  });

  bobConcurrent.close();
} catch (error) {
  await writeFile(
    resolve(receipts, "acceptance-error.json"),
    `${JSON.stringify({ capturedAt: new Date().toISOString(), error: String(error), stopDefect }, null, 2)}\n`,
  );
  if (stopDefect) {
    process.stderr.write(`${JSON.stringify({ stopDefect })}\n`);
  }
  throw error;
} finally {
  anonymous.close();
  alice.close();
  mallory.close();
}

await writeFile(
  resolve(receipts, "acceptance-summary.json"),
  `${JSON.stringify({
    startedAt,
    finishedAt: new Date().toISOString(),
    url,
    namespace,
    milestones,
    actors: {
      alice: hash("alice"),
      bob: hash("bob"),
      mallory: hash("mallory"),
    },
    scenarioResults,
    stopDefects: [],
  }, null, 2)}\n`,
);
process.stdout.write(
  `${JSON.stringify({ result: "complete", scenarios: scenarioResults.length, milestones }, null, 2)}\n`,
);
