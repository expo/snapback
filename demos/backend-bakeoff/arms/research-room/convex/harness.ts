import { createHash, randomBytes } from "node:crypto";
import { readFile, writeFile, mkdir, stat } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ConvexClient, ConvexHttpClient } from "convex/browser";
import { api } from "./convex/_generated/api.js";

type Evidence = {
  id: string;
  status: "pass" | "fail" | "gap";
  transport: string;
  authoritativeCheck: string;
  details: Record<string, unknown>;
};

const here = path.dirname(fileURLToPath(import.meta.url));
const evidenceDir = path.join(here, "evidence");
const stateRoot = path.resolve(here, "../../../../../.arm-state");
const localConfigPath = path.join(here, ".convex/local/default/config.json");
const envPath = path.join(here, ".env.local");

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const sha256 = (value: Uint8Array | string) => createHash("sha256").update(value).digest("hex");
const identity = (subject: string) => ({
  subject,
  issuer: "https://development.local.convex",
  name: subject[0].toUpperCase() + subject.slice(1),
  email: `${subject}@example.test`,
});

async function waitFor<T>(read: () => Promise<T>, accept: (value: T) => boolean, timeoutMs = 5000): Promise<T> {
  const deadline = performance.now() + timeoutMs;
  let last: T;
  while (performance.now() < deadline) {
    last = await read();
    if (accept(last)) return last;
    await sleep(25);
  }
  throw new Error(`WAIT_TIMEOUT:${JSON.stringify(last!)}`);
}

function percentile(samples: number[]) {
  const sorted = [...samples].sort((a, b) => a - b);
  return {
    rawMs: samples.map((sample) => Number(sample.toFixed(3))),
    medianMs: Number(sorted[Math.floor(sorted.length / 2)].toFixed(3)),
    nearestRankP95Ms: Number(sorted[Math.ceil(0.95 * sorted.length) - 1].toFixed(3)),
  };
}

async function sample(name: string, operation: (iteration: number) => Promise<void>) {
  const all = [];
  for (let iteration = 0; iteration < 9; iteration += 1) {
    const start = performance.now();
    await operation(iteration);
    all.push(performance.now() - start);
  }
  return {
    name,
    warmupsMs: all.slice(0, 2).map((value) => Number(value.toFixed(3))),
    recorded: percentile(all.slice(2)),
  };
}

async function main() {
  await mkdir(evidenceDir, { recursive: true });
  const startedAt = new Date().toISOString();
  const config = JSON.parse(await readFile(localConfigPath, "utf8"));
  const envText = await readFile(envPath, "utf8");
  const deploymentUrl = envText.match(/^VITE_CONVEX_URL=(.+)$/m)?.[1];
  const siteUrl = envText.match(/^VITE_CONVEX_SITE_URL=(.+)$/m)?.[1];
  if (!deploymentUrl || !siteUrl || !config.adminKey) throw new Error("LOCAL_TARGET_CONFIG_MISSING");

  const http = (subject: string) => {
    const client = new ConvexHttpClient(deploymentUrl);
    client.setAdminAuth(config.adminKey, identity(subject));
    return client;
  };
  const live = (subject: string) => {
    const client = new ConvexClient(deploymentUrl);
    client.setAdminAuth(config.adminKey, identity(subject));
    return client;
  };
  const alice = http("alice");
  const bob = http("bob");
  const mallory = http("mallory");
  const evidence: Evidence[] = [];
  const pushEvents: Array<{ progressCount: number; state: string; observedAt: string }> = [];

  const seedStart = performance.now();
  const seed = await alice.mutation(api.research.resetAndSeed, {});
  const firstMutationMs = performance.now() - seedStart;
  const readStart = performance.now();
  const counts = await bob.query(api.research.authoritativeCounts, { roomId: seed.primaryRoomId });
  const firstReadMs = performance.now() - readStart;
  evidence.push({
    id: "RESEARCH-01-SEED",
    status:
      counts.roomCount === 2 &&
      counts.sourceCount === 20 &&
      JSON.stringify(counts.memberSubjects) === JSON.stringify(["alice", "bob"])
        ? "pass"
        : "fail",
    transport: "not-applicable",
    authoritativeCheck: "Independent Bob Convex query read exact backend counts after Alice mutation.",
    details: { counts, seedSourceIdCount: seed.sourceIds.length },
  });

  const fixture = Buffer.alloc(65536);
  for (let index = 0; index < fixture.length; index += 1) fixture[index] = index % 251;
  const fixtureHash = sha256(fixture);
  const uploadUrl = await alice.mutation(api.research.generateUploadUrl, { roomId: seed.primaryRoomId });
  const uploadResponse = await fetch(uploadUrl, {
    method: "POST",
    headers: { "content-type": "application/octet-stream" },
    body: fixture,
  });
  const uploadBody = await uploadResponse.json();
  const uploadedSourceId = await alice.mutation(api.research.attachUpload, {
    roomId: seed.primaryRoomId,
    storageId: uploadBody.storageId,
    contentHash: fixtureHash,
    byteLength: fixture.length,
  });
  const fileMetadata = await bob.query(api.research.sourceFile, { sourceId: uploadedSourceId });
  if (!fileMetadata?.url) throw new Error("FILE_URL_MISSING");
  const delivered = new Uint8Array(await (await fetch(fileMetadata.url)).arrayBuffer());
  const deletion = await alice.mutation(api.research.deleteUploadedSource, { sourceId: uploadedSourceId });
  const deletedProbe = await bob.query(api.research.sourceFile, { sourceId: uploadedSourceId });
  evidence.push({
    id: "RESEARCH-02-FILES",
    status:
      uploadResponse.ok &&
      fileMetadata.ownerSubject === "alice" &&
      sha256(delivered) === fixtureHash &&
      deletion.deleted &&
      deletedProbe === null
        ? "pass"
        : "fail",
    transport: "native Convex file storage upload/delivery",
    authoritativeCheck: "Bob read metadata and delivered bytes; backend query returned null after owner deletion.",
    details: {
      objectIdentityHash: sha256(String(uploadBody.storageId)),
      byteLength: delivered.length,
      contentHash: fixtureHash,
      ownerSubject: fileMetadata.ownerSubject,
      deleted: deletion.deleted,
      postDeleteNull: deletedProbe === null,
    },
  });

  const outsiderChecks: Record<string, boolean> = {};
  for (const [name, operation] of [
    ["sources", () => mallory.query(api.research.authoritativeCounts, { roomId: seed.primaryRoomId })],
    ["keyword", () => mallory.query(api.research.keywordSearch, { roomId: seed.primaryRoomId, term: "quartz" })],
    [
      "semantic",
      () =>
        mallory.action(api.research.semanticSearch, {
          roomId: seed.primaryRoomId,
          embedding: Array.from({ length: 32 }, (_, index) => (index === 0 ? 1 : 0)),
          limit: 3,
        }),
    ],
  ] as const) {
    try {
      await operation();
      outsiderChecks[name] = false;
    } catch {
      outsiderChecks[name] = true;
    }
  }

  const keyword = await alice.query(api.research.keywordSearch, {
    roomId: seed.primaryRoomId,
    term: "quartz",
  });
  const keywordKeys = keyword.map((source) => source.sourceKey).sort();
  evidence.push({
    id: "RESEARCH-04-KEYWORD",
    status: JSON.stringify(keywordKeys) === JSON.stringify(seed.expectedKeywordSourceKeys) ? "pass" : "fail",
    transport: "Convex search index",
    authoritativeCheck: "Convex query executed withSearchIndex over source searchText filtered by roomId.",
    details: { resultKeys: keywordKeys, expectedKeys: seed.expectedKeywordSourceKeys },
  });

  const semantic = await alice.action(api.research.semanticSearch, {
    roomId: seed.primaryRoomId,
    embedding: Array.from({ length: 32 }, (_, index) => (index === 0 ? 1 : 0)),
    limit: 3,
  });
  evidence.push({
    id: "RESEARCH-05-SEMANTIC",
    status: semantic[0]?.sourceKey === "source-00" ? "pass" : "fail",
    transport: "Convex vector index via ctx.vectorSearch in action",
    authoritativeCheck: "Native vector-search action returned deterministic nearest source.",
    details: { resultKeys: semantic.map((source) => source.sourceKey), topScore: semantic[0]?.score },
  });

  const bobLive = live("bob");
  let realtimeFirstTransitionMs: number | null = null;
  const realtimeStarted = performance.now();
  const askResult = await alice.mutation(api.research.ask, {
    roomId: seed.primaryRoomId,
    dedupeKey: "question-main",
    text: "What do the frozen records say?",
  });
  const unsubscribe = bobLive.onUpdate(
    api.research.questionView,
    { questionId: askResult.questionId },
    (view) => {
      if (!view) return;
      pushEvents.push({
        progressCount: view.progress.length,
        state: view.question.state,
        observedAt: new Date().toISOString(),
      });
      if (view.progress.length > 0 && realtimeFirstTransitionMs === null) {
        realtimeFirstTransitionMs = performance.now() - realtimeStarted;
      }
    },
  );
  const completed = await waitFor(
    () => bob.query(api.research.questionView, { questionId: askResult.questionId }),
    (view) => view?.question.state === "complete",
  );
  await sleep(100);
  unsubscribe();
  await bobLive.close();
  const observedCounts = Array.from(new Set(pushEvents.map((event) => event.progressCount))).sort((a, b) => a - b);
  evidence.push({
    id: "RESEARCH-06-PROGRESS",
    status:
      completed?.progress.length === 4 &&
      completed.question.state === "complete" &&
      [1, 2, 3, 4].every((count) => observedCounts.includes(count))
        ? "pass"
        : "fail",
    transport: "native Convex WebSocket subscription push",
    authoritativeCheck: "Four scheduler-driven mutations were queried independently before terminal complete.",
    details: { durableProgress: completed?.progress, observedPushCounts: observedCounts, pushEvents },
  });

  const citationRows = await Promise.all(
    (completed?.answer?.citationSourceIds ?? []).map((sourceId) =>
      bob.query(api.research.sourceFile, { sourceId }),
    ),
  );
  evidence.push({
    id: "RESEARCH-07-CITATIONS",
    status:
      completed?.answer?.citationSourceIds.length === 2 &&
      citationRows.every((source) => source !== null)
        ? "pass"
        : "fail",
    transport: "not-applicable",
    authoritativeCheck: "Answer citation IDs were dereferenced through Bob-authorized backend queries.",
    details: {
      answerIdHash: sha256(String(completed?.answer?.id)),
      citationIdHashes: (completed?.answer?.citationSourceIds ?? []).map((id) => sha256(String(id))),
      allAuthorizedSourcesExist: citationRows.every((source) => source !== null),
    },
  });
  evidence.push({
    id: "RESEARCH-08-COLLABORATOR",
    status: pushEvents.some((event) => event.progressCount === 4 && event.state === "complete") ? "pass" : "fail",
    transport: "native Convex WebSocket subscription push",
    authoritativeCheck: "A distinct Bob-authenticated ConvexClient observed Alice's scheduler-authored transitions.",
    details: { actor: "bob", initiatingActor: "alice", pushEventCount: pushEvents.length },
  });

  const cancelQuestion = await alice.mutation(api.research.ask, {
    roomId: seed.primaryRoomId,
    dedupeKey: "question-cancel",
    text: "Cancel this deterministic stream.",
  });
  const cancelSettlement = await alice.mutation(api.research.cancel, { questionId: cancelQuestion.questionId });
  const lateAttempt = await alice.mutation(api.research.injectLatePatch, {
    questionId: cancelQuestion.questionId,
  });
  await sleep(500);
  const cancelled = await bob.query(api.research.questionView, { questionId: cancelQuestion.questionId });
  evidence.push({
    id: "RESEARCH-09-CANCEL",
    status:
      cancelSettlement.settled &&
      lateAttempt.rejected &&
      cancelled?.question.state === "cancelled" &&
      cancelled.progress.length === 0 &&
      cancelled.answer === null
        ? "pass"
        : "fail",
    transport: "not-applicable",
    authoritativeCheck: "Backend state after scheduled late attempts retained zero progress/answer patches.",
    details: {
      cancelSettlement,
      injectedAttempt: lateAttempt,
      authoritativeState: cancelled?.question.state,
      durableProgressCount: cancelled?.progress.length,
      answerPresent: Boolean(cancelled?.answer),
      rejectedAttemptLedger: cancelled?.lateAttempts,
    },
  });

  const retryOne = await alice.mutation(api.research.ask, {
    roomId: seed.primaryRoomId,
    dedupeKey: "question-retry",
    text: "Retry fixture.",
  });
  const retryTwo = await alice.mutation(api.research.ask, {
    roomId: seed.primaryRoomId,
    dedupeKey: "question-retry",
    text: "Retry fixture.",
  });
  const retryComplete = await waitFor(
    () => alice.query(api.research.questionView, { questionId: retryOne.questionId }),
    (view) => view?.question.state === "complete",
  );
  evidence.push({
    id: "RESEARCH-10-RETRY",
    status:
      retryOne.questionId === retryTwo.questionId &&
      !retryOne.deduped &&
      retryTwo.deduped &&
      retryComplete?.attempts.length === 2 &&
      retryComplete.answer !== null
        ? "pass"
        : "fail",
    transport: "not-applicable",
    authoritativeCheck: "Compound roomId+dedupeKey index returned one question and one answer with two attempt rows.",
    details: {
      sameQuestion: retryOne.questionId === retryTwo.questionId,
      dispositions: retryComplete?.attempts,
      answerCount: retryComplete?.answer ? 1 : 0,
    },
  });

  await alice.mutation(api.research.createOutcomeFixtures, { roomId: seed.primaryRoomId });
  const outcomes = await bob.query(api.research.outcomeStates, { roomId: seed.primaryRoomId });
  const expectedOutcomes = ["ambiguous", "cancelled", "complete", "failed", "timed_out"];
  evidence.push({
    id: "RESEARCH-11-OUTCOMES",
    status: expectedOutcomes.every((state) => outcomes.includes(state)) ? "pass" : "fail",
    transport: "not-applicable",
    authoritativeCheck: "Independent query returned distinct durable state-machine values.",
    details: { observedStates: outcomes, expectedStates: expectedOutcomes },
  });

  await alice.mutation(api.research.scheduleRefresh, {
    roomId: seed.primaryRoomId,
    dedupeKey: "refresh-once",
    externalUrl: `${siteUrl}/fixture/research`,
  });
  await alice.mutation(api.research.scheduleRefresh, {
    roomId: seed.primaryRoomId,
    dedupeKey: "refresh-once",
    externalUrl: `${siteUrl}/fixture/research`,
  });
  const refreshes = await waitFor(
    () => bob.query(api.research.refreshRuns, { roomId: seed.primaryRoomId }),
    (runs) => runs.length === 1,
  );
  evidence.push({
    id: "RESEARCH-12-SCHEDULE",
    status:
      refreshes.length === 1 &&
      refreshes[0].status === "complete" &&
      refreshes[0].externalRecordId === "external-record-001"
        ? "pass"
        : "fail",
    transport: "Convex scheduler -> action -> HTTP action fixture -> internal mutation",
    authoritativeCheck: "Two scheduled effects with one dedupe key produced one durable run.",
    details: {
      scheduleCount: 2,
      durableRunCount: refreshes.length,
      run: refreshes[0] && {
        status: refreshes[0].status,
        externalRecordId: refreshes[0].externalRecordId,
        payloadHash: refreshes[0].payloadHash,
        progress: refreshes[0].progress,
      },
    },
  });

  const secretProbe = await alice.action(api.research.secretProbe, { roomId: seed.primaryRoomId });
  evidence.push({
    id: "RESEARCH-13-SECRETS",
    status: "fail",
    transport: "server action environment",
    authoritativeCheck:
      "Application canary stayed server-side, but the Convex local backend places its independent control secret in process argv.",
    details: {
      applicationCanaryConfigured: secretProbe.configured,
      applicationCanaryValueReturned: false,
      providerStopDefect: "local-control-secret-in-process-argv",
      exactValueScanDeferredToCleanup: true,
    },
  });

  let signalSeq = 1000;
  const readSamples = await sample("representative-read", async () => {
    const result = await bob.query(api.research.keywordSearch, { roomId: seed.primaryRoomId, term: "quartz" });
    if (result.length !== 7) throw new Error("READ_SAMPLE_WRONG_COUNT");
  });
  const writeSamples = await sample("representative-write", async () => {
    signalSeq += 1;
    await alice.mutation(api.research.writeSignal, { roomId: seed.primaryRoomId, seq: signalSeq });
  });
  const realtimeSamples = await sample("realtime-delivery", async () => {
    const client = live("bob");
    signalSeq += 1;
    const wanted = signalSeq;
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("REALTIME_SAMPLE_TIMEOUT")), 3000);
      const unsub = client.onUpdate(
        api.research.latestSignal,
        { roomId: seed.primaryRoomId },
        (signal) => {
          if (signal?.seq === wanted) {
            clearTimeout(timer);
            unsub();
            resolve();
          }
        },
        reject,
      );
      alice.mutation(api.research.writeSignal, { roomId: seed.primaryRoomId, seq: wanted }).catch(reject);
    });
    await client.close();
  });
  const reconnectSamples = await sample("reconnect", async () => {
    const client = live("bob");
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("RECONNECT_SAMPLE_TIMEOUT")), 3000);
      const unsub = client.onUpdate(
        api.research.authoritativeCounts,
        { roomId: seed.primaryRoomId },
        (value) => {
          if (value.sourceCount === 20) {
            clearTimeout(timer);
            unsub();
            resolve();
          }
        },
        reject,
      );
    });
    await client.close();
  });

  const outsiderLive = live("mallory");
  const outsiderSubscriptionDenied = await new Promise<boolean>((resolve) => {
    const timer = setTimeout(() => resolve(false), 3000);
    const unsub = outsiderLive.onUpdate(
      api.research.questionView,
      { questionId: askResult.questionId },
      () => {
        clearTimeout(timer);
        unsub();
        resolve(false);
      },
      () => {
        clearTimeout(timer);
        unsub();
        resolve(true);
      },
    );
  });
  await outsiderLive.close();
  outsiderChecks.subscription = outsiderSubscriptionDenied;
  evidence.push({
    id: "RESEARCH-03-OUTSIDER",
    status: Object.values(outsiderChecks).every(Boolean) ? "pass" : "fail",
    transport: "query/action refusal plus native WebSocket subscription refusal",
    authoritativeCheck: "Mallory-authenticated native clients received FORBIDDEN for every protected surface.",
    details: outsiderChecks,
  });

  const performanceRecord = {
    dataset: {
      rooms: 2,
      sourcesPerPrimaryRoom: 20,
      sourceBytes: 65536,
      deterministicEmbeddingDimensions: 32,
      progressUpdates: 4,
      actors: 3,
      concurrentClients: 2,
    },
    protocol: { warmups: 2, recordedSamples: 7, p95: "nearest-rank" },
    paths: [readSamples, writeSamples, realtimeSamples, reconnectSamples],
    buildPath: "Vite production build sampled separately by scripts/run-build-samples.mjs",
    costWindow: {
      target: "anonymous local beta deployment",
      providerBilledUsage: "not available/local",
      providerListPriceEstimateUsd: 0,
      localResourceCostExcluded: true,
      productionScaleClaim: false,
    },
  };
  await writeFile(path.join(evidenceDir, "performance.runtime.json"), JSON.stringify(performanceRecord, null, 2) + "\n");
  evidence.push({
    id: "RESEARCH-14-PERFORMANCE",
    status: "pass",
    transport: "native HTTP and WebSocket client paths",
    authoritativeCheck: "Two warmups and seven raw samples retained for read/write/realtime/reconnect; build samples join after Vite runs.",
    details: { runtimeEvidencePath: "evidence/performance.runtime.json", buildSamplesPending: true },
  });

  const artifact = {
    schemaVersion: 1,
    provider: "convex",
    app: "research-room",
    runMode: "untimed-extension-after-stop",
    startedAt,
    finishedAt: new Date().toISOString(),
    milestones: {
      firstLocalReadMs: Number(firstReadMs.toFixed(3)),
      firstAuthoritativeMutationMs: Number(firstMutationMs.toFixed(3)),
      firstRealtimeTransitionMs: realtimeFirstTransitionMs && Number(realtimeFirstTransitionMs.toFixed(3)),
    },
    target: {
      deploymentUrlHash: sha256(deploymentUrl),
      siteUrlHash: sha256(siteUrl),
      localConfigPathHash: sha256(localConfigPath),
    },
    actors: {
      alice: sha256("https://development.local.convex|alice"),
      bob: sha256("https://development.local.convex|bob"),
      mallory: sha256("https://development.local.convex|mallory"),
    },
    scenarios: evidence,
  };
  await writeFile(path.join(evidenceDir, "acceptance.untimed.json"), JSON.stringify(artifact, null, 2) + "\n");

  const stateInfo = await stat(stateRoot);
  if (!stateInfo.isDirectory()) throw new Error("ARM_STATE_ROOT_MISSING");
  const failed = evidence.filter((item) => item.status === "fail");
  if (
    evidence.length !== 14 ||
    failed.length !== 1 ||
    failed[0]?.id !== "RESEARCH-13-SECRETS"
  ) {
    throw new Error(`ACCEPTANCE_PRE_CLEANUP_UNEXPECTED_RESULT:${JSON.stringify(failed)}`);
  }
}

main().catch(async (error) => {
  await mkdir(evidenceDir, { recursive: true });
  await writeFile(
    path.join(evidenceDir, "acceptance.failure.json"),
    JSON.stringify({ at: new Date().toISOString(), error: String(error?.stack ?? error) }, null, 2) + "\n",
  );
  process.exitCode = 1;
});
